// =====================================================================
// enviar-resposta: manda pelo direct o que VOCÊ revisou no painel.
// Recebe { conversa_id, texto?, sugestao_id?, midia?: { tipo, url }, coracao? }.
// coracao: manda o 🧡 sozinho (aparece grande no Direct).
// - Só quem está logado e tem acesso à conta.
// - Janela da Meta, contada da última mensagem da cliente:
//   até 24h: envio normal; de 24h a 7 dias: com a etiqueta HUMAN_AGENT
//   (precisa da permissão Human Agent liberada no app da Meta);
//   depois de 7 dias: não envia.
// - Mídia: só arquivos da pasta "midias" desta conta (subidos pelo painel).
// - Salva o que saiu com autor "eu".
// =====================================================================
import { contaDoUsuario, CORS, reply, requireUser } from "../_shared/painel.ts";
import { db, ENV, graphPost, isAmbiguous } from "../_shared/ig.ts";
import { Conversa, gravarMensagem, Midia } from "../_shared/conversas.ts";

const HORA_MS = 3600 * 1000;
const JANELA_NORMAL_MS = 24 * HORA_MS;
const JANELA_HUMANA_MS = 7 * 24 * HORA_MS;
const TEXTO_MAX = 1000; // limite do Instagram por mensagem
const TIPOS_MIDIA = ["image", "video", "audio", "file"];
const ROTULO: Record<string, string> = { image: "[imagem]", video: "[vídeo]", audio: "[áudio]", file: "[arquivo]" };
const CORACAO = "🧡";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, erro: "use POST" }, 405);

  const userId = await requireUser(req);
  if (!userId) return reply({ ok: false, erro: "Faça login de novo." }, 401);

  let body: any;
  try { body = await req.json(); } catch { return reply({ ok: false, erro: "Pedido inválido." }, 400); }
  const conversaId = String(body?.conversa_id ?? "");
  const texto = String(body?.texto ?? "").trim();
  const sugestaoId = body?.sugestao_id ? String(body.sugestao_id) : null;
  const coracao = body?.coracao === true;
  const midiaPedida = body?.midia && TIPOS_MIDIA.includes(body.midia.tipo) ? { tipo: String(body.midia.tipo), url: String(body.midia.url ?? "") } : null;

  if (!conversaId) return reply({ ok: false, erro: "Falta a conversa." }, 400);
  if (!texto && !midiaPedida && !coracao) return reply({ ok: false, erro: "A mensagem está vazia." }, 400);
  if (texto.length > TEXTO_MAX) return reply({ ok: false, erro: `A mensagem passou de ${TEXTO_MAX} caracteres.` }, 400);

  const { data: conversa } = await db.from("conversas").select("*").eq("id", conversaId).maybeSingle();
  if (!conversa) return reply({ ok: false, erro: "Conversa não encontrada." }, 404);

  const conta = await contaDoUsuario(userId, conversa.conta_id);
  if (!conta) return reply({ ok: false, erro: "Você não tem acesso a esta conta." }, 403);

  // A mídia tem que ser um arquivo desta conta na nossa pasta (nada de link de fora)
  if (midiaPedida) {
    const prefixo = `${ENV.SUPABASE_URL}/storage/v1/object/public/midias/${conversa.conta_id}/`;
    if (!midiaPedida.url.startsWith(prefixo)) return reply({ ok: false, erro: "Arquivo inválido. Anexe de novo pelo painel." }, 400);
  }

  // Janela da Meta: conta a partir da última mensagem DA CLIENTE
  const ultimaCliente = conversa.ultima_do_cliente_em ? new Date(conversa.ultima_do_cliente_em).getTime() : 0;
  const passou = ultimaCliente ? Date.now() - ultimaCliente : Infinity;
  if (passou > JANELA_HUMANA_MS) {
    return reply({
      ok: false, codigo: "janela_fechada",
      erro: "Passaram mais de 7 dias desde a última mensagem da cliente. O Instagram não deixa enviar: espere ela escrever de novo.",
    }, 409);
  }
  const humano = passou > JANELA_NORMAL_MS;
  const etiqueta = humano ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {};

  // Monta os envios: mídia (ou coração) primeiro, depois o texto
  const envios: { message: unknown; texto: string; midia: Midia | null }[] = [];
  // O coração da marca é o 🧡 (o "like_heart" da API só existe em vermelho)
  if (coracao) envios.push({ message: { text: CORACAO }, texto: CORACAO, midia: null });
  if (midiaPedida) {
    envios.push({
      message: { attachment: { type: midiaPedida.tipo, payload: { url: midiaPedida.url } } },
      texto: ROTULO[midiaPedida.tipo], midia: midiaPedida,
    });
  }
  if (texto) envios.push({ message: { text: texto }, texto, midia: null });

  const ids: string[] = [];
  for (const e of envios) {
    const r = await graphPost(conta.token, "/me/messages", {
      recipient: { id: conversa.instagram_user_id }, message: e.message, ...etiqueta,
    });
    if (!r.ok) {
      console.error("[enviar-resposta] Instagram recusou:", JSON.stringify(r.error));
      if (isAmbiguous(r)) {
        // Erro desconhecido do Instagram: a mensagem pode ter saído. Não deixa reenviar às cegas.
        return reply({
          ok: false, codigo: "incerto", enviados: ids.length,
          erro: "O Instagram respondeu com um erro desconhecido, mas a mensagem pode ter saído. Confira no Direct (ou espere alguns segundos: se saiu, ela aparece aqui) antes de enviar de novo.",
        }, 502);
      }
      const foraDaJanela = Number(r.error?.code) === 10 || Number(r.error?.error_subcode) === 2534022;
      const semPermissao = humano && (foraDaJanela || [3, 200, 230].includes(Number(r.error?.code)));
      const erro = semPermissao
        ? "Esta conversa passou de 24h. Para responder até 7 dias, o app precisa da permissão Human Agent liberada no Meta for Developers (veja o LEIA-ME)."
        : foraDaJanela
        ? "O Instagram recusou: a janela de resposta dessa conversa está fechada."
        : `O Instagram recusou o envio: ${r.error?.message ?? "erro desconhecido"}`;
      // O que já saiu antes do erro fica salvo
      return reply({ ok: false, codigo: semPermissao ? "human_agent" : foraDaJanela ? "janela_fechada" : "instagram", erro, enviados: ids.length }, 502);
    }
    const mid: string | null = r.data?.message_id ?? null;
    if (mid) ids.push(mid);
    await gravarMensagem(conversa as Conversa, "eu", e.texto, mid, new Date(), e.midia);
  }

  if (sugestaoId && texto) await db.from("sugestoes").update({ usada: true }).eq("id", sugestaoId).eq("conversa_id", conversa.id);

  return reply({ ok: true, message_ids: ids, human_agent: humano });
});
