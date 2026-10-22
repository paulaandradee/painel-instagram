// =====================================================================
// ig-repescagem: responde comentários dos últimos 7 dias que ficaram
// sem DM (feitos antes da automação ligar, ou que o webhook perdeu).
// Corpo (POST): { automation_id, acao: "previa" | "enviar", responder_publico?: bool }
// - "previa": só lê e conta. Não envia nada.
// - "enviar": coloca na fila com freio (o ig-scheduler manda aos poucos).
// Respeita: palavra-chave, posts da automação, 1 DM por pessoa por dia,
// quem já recebeu desta automação não recebe de novo.
// Só responde pra quem está logado no painel.
// =====================================================================
import { Automation, Conta, chaveFreio, db, ehDaConta, ENV, graphGet, keywordMatches, logDelivery, registrarInteracao, upsertLead } from "../_shared/ig.ts";
import { contaDoUsuario, CORS, reply, requireUser } from "../_shared/painel.ts";

const DIA_MS = 24 * 3600 * 1000;
// A Meta aceita resposta privada até 7 dias depois do comentário.
// Deixamos 6 horas de folga pra fila ter tempo de enviar.
const JANELA_MS = 7 * DIA_MS - 6 * 3600 * 1000;
const MAX_POSTS = 30;             // posts lidos quando a automação vale pra todos
const MAX_PAGINAS = 10;           // até 500 comentários por post
const LIMITE_LISTA = 300;         // pessoas mostradas na prévia

type Candidato = { comment_id: string; ig_user_id: string; username: string; texto: string; quando: string; palavra: string; post: string };

// Posts a varrer: os escolhidos na automação, ou os recentes com comentário
async function postsAlvo(conta: Conta, auto: Automation): Promise<string[]> {
  if (auto.media_ids?.length) return auto.media_ids;
  const r = await graphGet(conta.token, `/${conta.ig_user_id}/media`, { fields: "id,comments_count", limit: "50" });
  if (!r.ok) return [];
  return (r.data?.data ?? []).filter((p: any) => Number(p.comments_count) > 0).slice(0, MAX_POSTS).map((p: any) => p.id);
}

// Comentários dos últimos 7 dias de um post
async function comentariosRecentes(conta: Conta, postId: string) {
  const desde = Date.now() - JANELA_MS;
  const out: any[] = [];
  let after: string | undefined;
  for (let pag = 0; pag < MAX_PAGINAS; pag++) {
    const params: Record<string, string> = { fields: "id,text,timestamp,from", limit: "50" };
    if (after) params.after = after;
    const r = await graphGet(conta.token, `/${postId}/comments`, params);
    if (!r.ok) break;
    for (const c of r.data?.data ?? []) {
      if (new Date(c.timestamp).getTime() >= desde) out.push({ ...c, post: postId });
    }
    after = r.data?.paging?.cursors?.after;
    if (!after || !r.data?.paging?.next) break;
  }
  return out;
}

async function montar(conta: Conta, auto: Automation) {
  const resumo = { posts: 0, comentarios: 0, sem_palavra: 0, da_conta: 0, ja_receberam: 0, recebeu_hoje: 0, ja_na_fila: 0, repetidos: 0 };
  const posts = await postsAlvo(conta, auto);
  resumo.posts = posts.length;

  // lê os posts em lotes de 5
  const todos: any[] = [];
  for (let i = 0; i < posts.length; i += 5) {
    const lotes = await Promise.all(posts.slice(i, i + 5).map((p) => comentariosRecentes(conta, p)));
    lotes.forEach((l) => todos.push(...l));
  }
  resumo.comentarios = todos.length;

  // mais antigo primeiro: é o que expira antes
  todos.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // o que já existe no banco
  const ids = [...new Set(todos.map((c) => c.from?.id).filter(Boolean))];
  const desde24h = new Date(Date.now() - DIA_MS).toISOString();
  const desde8d = new Date(Date.now() - 8 * DIA_MS).toISOString();
  // consulta em blocos de 150 ids (lista longa demais estoura o tamanho da URL)
  async function idsQue(filtro: (q: any) => any) {
    const achados = new Set<string>();
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await filtro(db.from("ig_deliveries").select("ig_user_id").eq("conta_id", conta.id).eq("status", "ok").in("ig_user_id", ids.slice(i, i + 150)));
      (data ?? []).forEach((x: any) => achados.add(x.ig_user_id));
    }
    return achados;
  }
  const [jaRecebeu, recebeuHoje, fila] = await Promise.all([
    idsQue((q) => q.eq("automation_id", auto.id)),                         // já recebeu desta automação
    idsQue((q) => q.eq("canal", "private_reply").gte("ts", desde24h)),     // recebeu alguma DM nas últimas 24h
    // itens desta automação que já estão (ou estiveram) na fila nos últimos 8 dias
    db.from("ig_send_queue").select("comment_id, ig_user_id").eq("automation_id", auto.id).gte("created_at", desde8d).limit(1000),
  ]);
  const naFilaComent = new Set((fila.data ?? []).map((x: any) => x.comment_id));
  const naFilaPessoa = new Set((fila.data ?? []).map((x: any) => x.ig_user_id));

  const escolhidos: Candidato[] = [];
  const vistos = new Set<string>();
  for (const c of todos) {
    const uid = c.from?.id;
    if (!uid) continue;
    if (ehDaConta(conta, uid)) { resumo.da_conta++; continue; } // respostas da própria conta
    const palavra = auto.match_any ? "*" : keywordMatches(c.text ?? "", auto.keyword);
    if (!palavra) { resumo.sem_palavra++; continue; }
    if (jaRecebeu.has(uid)) { resumo.ja_receberam++; continue; }
    if (naFilaComent.has(c.id) || naFilaPessoa.has(uid)) { resumo.ja_na_fila++; continue; }
    const teste = ENV.TEST_IG_ACCOUNTS.includes(uid);
    if (recebeuHoje.has(uid) && !teste) { resumo.recebeu_hoje++; continue; }
    if (vistos.has(uid)) { resumo.repetidos++; continue; } // 1 DM por pessoa
    vistos.add(uid);
    escolhidos.push({
      comment_id: c.id, ig_user_id: uid, username: c.from?.username ?? "",
      texto: String(c.text ?? "").slice(0, 140), quando: c.timestamp, palavra, post: c.post,
    });
  }
  return { escolhidos, resumo };
}

// Quantas DMs o freio ainda deixa sair hoje
async function capacidadeHoje(conta: Conta) {
  const { data } = await db.from("ig_send_budget").select("day_count, cap_day, day_start").eq("id", chaveFreio(conta.id)).maybeSingle();
  if (!data) return null;
  const virou = Date.now() - new Date(data.day_start).getTime() >= DIA_MS;
  const { count } = await db.from("ig_send_queue").select("id", { count: "exact", head: true }).eq("conta_id", conta.id).eq("status", "pendente");
  return Math.max(0, Number(data.cap_day) - (virou ? 0 : Number(data.day_count)) - (count ?? 0));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const userId = await requireUser(req);
  if (!userId) return reply({ ok: false, erro: "não autorizado" }, 401);

  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }
  const { data: auto } = await db.from("ig_automations").select("*").eq("id", corpo.automation_id ?? "").maybeSingle();
  if (!auto) return reply({ ok: false, erro: "Automação não encontrada" });
  // Só repesca em conta que a pessoa pode acessar
  const conta = await contaDoUsuario(userId, auto.conta_id);
  if (!conta) return reply({ ok: false, erro: "Sem acesso a esta conta, ou conta sem token." });
  if (!(auto as Automation).flow?.steps?.length) return reply({ ok: false, erro: "Essa automação ainda não tem mensagem" });

  const { escolhidos, resumo } = await montar(conta, auto as Automation);
  const capacidade = await capacidadeHoje(conta);

  if (corpo.acao !== "enviar") {
    return reply({
      ok: true, acao: "previa", ativa: !!auto.active, total: escolhidos.length, capacidade_hoje: capacidade,
      resumo, pessoas: escolhidos.slice(0, LIMITE_LISTA),
    });
  }

  // Enviar: coloca na fila (o ig-scheduler manda aos poucos, com o freio)
  const responder = !!corpo.responder_publico;
  let enfileirados = 0;
  for (const c of escolhidos) {
    const { error } = await db.from("ig_send_queue").upsert({
      conta_id: conta.id, comment_id: c.comment_id, automation_id: auto.id, ig_user_id: c.ig_user_id, username: c.username,
      status: "pendente", comment_ts: c.quando, responder_publico: responder, origem: "repescagem",
    }, { onConflict: "comment_id", ignoreDuplicates: true });
    if (error) continue;
    enfileirados++;
    // marca o comentário como processado (se o Meta reenviar, o webhook ignora)
    await db.from("ig_processed_events").upsert({ event_id: `comment:${c.comment_id}` }, { onConflict: "event_id", ignoreDuplicates: true });
    await registrarInteracao(conta.id, c.ig_user_id, true);
    await upsertLead(conta.id, c.ig_user_id, {
      username: c.username || null, last_source: "comment", last_keyword: c.palavra, automation_id: auto.id,
    });
    await logDelivery({ conta_id: conta.id, ig_user_id: c.ig_user_id, automation_id: auto.id, canal: "private_reply", tipo: "flow", status: "na_fila", motivo: "repescagem" });
  }
  return reply({ ok: true, acao: "enviar", enfileirados, capacidade_hoje: capacidade });
});
