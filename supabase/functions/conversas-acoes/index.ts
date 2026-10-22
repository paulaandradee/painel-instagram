// =====================================================================
// conversas-acoes: pedidos da aba Conversas (pessoa logada).
// Corpo (POST):
// - { acao: "sugerir", conversa_id }
//     gera uma sugestão na hora (conversa antiga, ou "outra sugestão").
// - { acao: "analisar_dia", conta_id, dia: "AAAA-MM-DD" }
//     a IA lê as conversas do dia (sem dados pessoais) e devolve resumo,
//     dúvidas, objeções e perfil dos leads; guarda em analises_conversas.
// - { acao: "repescar", conta_id, etapa: "previa" | "trazer" }
//     lê as conversas do Direct dos últimos 7 dias em que a ÚLTIMA
//     mensagem é da cliente (sem resposta) e traz para o painel.
//     Nada é enviado: cada uma ganha sugestão quando você abrir.
// A API não diz se a mensagem foi lida nem em qual pasta está
// (Principal, Geral): "sem resposta" é o que dá para saber.
// =====================================================================
import { contaDoUsuario, CORS, reply, requireUser } from "../_shared/painel.ts";
import { Conta, db, ehDaConta, graphGet } from "../_shared/ig.ts";
import { analisarDia, Conversa, conversaDe, gerarSugestao, Midia, ultimaFalha } from "../_shared/conversas.ts";

const DIA_MS = 24 * 3600 * 1000;
const JANELA_MS = 7 * DIA_MS;
const MAX_PAGINAS = 10;     // até 250 conversas lidas
const MAX_TRAZER = 150;     // conversas trazidas por vez
const LIMITE_LISTA = 100;   // pessoas mostradas na prévia

type Candidata = { ig_user_id: string; username: string | null; texto: string; quando: string; mensagens: any[] };

const ehMinha = (conta: Conta, de: any) =>
  ehDaConta(conta, de?.id) || (!!conta.username && de?.username?.toLowerCase() === conta.username.toLowerCase());

// Texto e mídia de uma mensagem da API de conversas
function lerMensagem(m: any): { texto: string; midia: Midia | null } {
  const a = m?.attachments?.data?.[0];
  let midia: Midia | null = null;
  if (a?.image_data?.url) midia = { tipo: "image", url: a.image_data.url };
  else if (a?.video_data?.url) midia = { tipo: "video", url: a.video_data.url };
  else if (a?.audio_data?.url) midia = { tipo: "audio", url: a.audio_data.url };
  else if (a?.file_url) midia = { tipo: "file", url: a.file_url };
  const rotulo: Record<string, string> = { image: "[imagem]", video: "[vídeo]", audio: "[áudio]", file: "[arquivo]" };
  const texto = String(m?.message ?? "").trim() || (midia ? rotulo[midia.tipo] : m?.story ? "[resposta ao story]" : "[mensagem]");
  return { texto, midia };
}

// Lê as conversas recentes. Tenta com anexos; se a API recusar o campo, sem.
async function conversasRecentes(conta: Conta) {
  const desde = Date.now() - JANELA_MS;
  const campos = [
    "id,updated_time,participants,messages.limit(20){id,created_time,from,message,story,attachments}",
    "id,updated_time,participants,messages.limit(20){id,created_time,from,message}",
  ];
  for (const fields of campos) {
    const lidas: any[] = [];
    let after: string | undefined;
    let falhou = false;
    for (let pag = 0; pag < MAX_PAGINAS; pag++) {
      const params: Record<string, string> = { platform: "instagram", fields, limit: "25" };
      if (after) params.after = after;
      const r = await graphGet(conta.token, "/me/conversations", params);
      if (!r.ok) { console.warn("[repescar dm] API recusou:", JSON.stringify(r.error)); falhou = pag === 0; break; }
      const pagina = r.data?.data ?? [];
      lidas.push(...pagina);
      const maisVelha = pagina[pagina.length - 1]?.updated_time;
      if (!pagina.length || (maisVelha && new Date(maisVelha).getTime() < desde)) break;
      after = r.data?.paging?.cursors?.after;
      if (!after || !r.data?.paging?.next) break;
    }
    if (!falhou) return lidas;
  }
  return null;
}

async function candidatas(conta: Conta) {
  const desde = Date.now() - JANELA_MS;
  const lidas = await conversasRecentes(conta);
  if (!lidas) return null;
  const resumo = { lidas: lidas.length, respondidas: 0, antigas: 0 };
  const lista: Candidata[] = [];
  for (const c of lidas) {
    const msgs: any[] = c.messages?.data ?? [];      // a mais nova primeiro
    const ultima = msgs[0];
    if (!ultima) continue;
    if (ehMinha(conta, ultima.from)) { resumo.respondidas++; continue; }
    if (new Date(ultima.created_time).getTime() < desde) { resumo.antigas++; continue; }
    const cliente = (c.participants?.data ?? []).find((p: any) => !ehMinha(conta, p)) ?? ultima.from;
    if (!cliente?.id) continue;
    lista.push({
      ig_user_id: String(cliente.id), username: cliente.username ?? null,
      texto: lerMensagem(ultima).texto.slice(0, 140), quando: ultima.created_time, mensagens: msgs,
    });
  }
  return { lista, resumo };
}

// Traz uma conversa: cria (se precisar) e grava as mensagens que faltam
async function trazer(conta: Conta, c: Candidata): Promise<boolean> {
  const conversa = await conversaDe(conta, c.ig_user_id, { username: c.username });
  if (!conversa) return false;
  const linhas = [...c.mensagens].reverse().map((m) => {   // da mais antiga para a mais nova
    const { texto, midia } = lerMensagem(m);
    return {
      conversa_id: conversa.id, conta_id: conta.id, autor: ehMinha(conta, m.from) ? "eu" : "cliente",
      texto, criada_em: new Date(m.created_time).toISOString(), instagram_message_id: m.id,
      midia_tipo: midia?.tipo ?? null, midia_url: midia?.url ?? null,
    };
  });
  const { error } = await db.from("mensagens").upsert(linhas, { onConflict: "instagram_message_id", ignoreDuplicates: true });
  if (error) { console.error("[repescar dm] não gravou mensagens:", error.message); return false; }
  // sem resposta = aguardando (mesmo se estava arquivada)
  await db.from("conversas").update({ status: "aguardando" }).eq("id", conversa.id);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, erro: "use POST" }, 405);
  const userId = await requireUser(req);
  if (!userId) return reply({ ok: false, erro: "Faça login de novo." }, 401);

  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }

  // ---------------- Sugestão na hora ----------------
  if (corpo.acao === "sugerir") {
    const { data: conversa } = await db.from("conversas").select("*").eq("id", String(corpo.conversa_id ?? "")).maybeSingle();
    if (!conversa) return reply({ ok: false, erro: "Conversa não encontrada." }, 404);
    if (!(await contaDoUsuario(userId, conversa.conta_id))) return reply({ ok: false, erro: "Você não tem acesso a esta conta." }, 403);
    const texto = await gerarSugestao(conversa as Conversa, null);
    if (!texto) {
      const erro = ultimaFalha() === "limite"
        ? "O limite gratuito da IA foi atingido agora. Tente de novo mais tarde, ou escreva a resposta à mão."
        : "A IA não conseguiu sugerir agora. Tente de novo em instantes.";
      return reply({ ok: false, codigo: ultimaFalha() ?? "erro", erro }, 502);
    }
    return reply({ ok: true, texto });
  }

  // ---------------- Análise das conversas do dia ----------------
  if (corpo.acao === "analisar_dia") {
    const conta = await contaDoUsuario(userId, String(corpo.conta_id ?? ""));
    if (!conta) return reply({ ok: false, erro: "Sem acesso a esta conta." }, 403);
    const dia = String(corpo.dia ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return reply({ ok: false, erro: "Dia inválido." }, 400);
    const r = await analisarDia(conta.id, dia);
    if (!r.ok) {
      const erro = r.motivo === "limite"
        ? "O limite gratuito da IA foi atingido agora. Tente de novo mais tarde."
        : "A IA não conseguiu analisar agora. Tente de novo em instantes.";
      return reply({ ok: false, codigo: r.motivo, erro }, 502);
    }
    return reply(r);
  }

  // ---------------- Repescagem do Direct ----------------
  if (corpo.acao === "repescar") {
    const conta = await contaDoUsuario(userId, String(corpo.conta_id ?? ""));
    if (!conta) return reply({ ok: false, erro: "Sem acesso a esta conta, ou conta sem token." }, 403);
    const r = await candidatas(conta);
    if (!r) return reply({ ok: false, erro: "Não foi possível ler as conversas do Instagram agora." }, 502);
    const { lista, resumo } = r;

    if (corpo.etapa !== "trazer") {
      return reply({
        ok: true, etapa: "previa", total: lista.length, resumo,
        pessoas: lista.slice(0, LIMITE_LISTA).map(({ mensagens: _m, ...p }) => p),
      });
    }

    let trazidas = 0;
    const lote = lista.slice(0, MAX_TRAZER);
    for (let i = 0; i < lote.length; i += 5) {
      const res = await Promise.all(lote.slice(i, i + 5).map((c) => trazer(conta, c).catch(() => false)));
      trazidas += res.filter(Boolean).length;
    }
    return reply({ ok: true, etapa: "trazer", trazidas, restantes: Math.max(0, lista.length - lote.length) });
  }

  return reply({ ok: false, erro: "Ação desconhecida." }, 400);
});
