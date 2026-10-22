// =====================================================================
// instagram-webhook: o CÉREBRO
// - GET: aperto de mão com o Meta (hub.challenge)
// - POST: recebe comentários, mensagens, toques em botão (postback e
//   quick_reply) e responde sozinho às AUTOMAÇÕES. Mensagens do direct
//   também vão pra caixa de entrada (tabela mensagens) com uma sugestão
//   da IA, que só sai quando alguém clicar em Enviar no painel.
// Várias contas: cada evento diz qual conta recebeu (entry.id). O webhook
// usa só as automações, os leads e o token DESSA conta.
// Precisa ser PÚBLICA: publique com --no-verify-jwt.
// =====================================================================
import {
  Automation, completarPerfil, Conta, contaPorIgId, db, deliverAutomation, ehDaConta, ENV, findStep, graphGet, json,
  keywordMatches, logDelivery, parsePayload, registrarInteracao, replyToComment, sendStep, upsertLead,
} from "../_shared/ig.ts";
import { conversaDe, gerarSugestao, gravarMensagem, midiaDoEvento, textoDoEvento } from "../_shared/conversas.ts";

// Roda depois de responder 200 pro Meta (a sugestão demora alguns segundos)
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
function emSegundoPlano(p: Promise<unknown>) {
  const seguro = p.catch((e) => console.error("[segundo plano] erro:", e));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(seguro);
}

// ---------- Assinatura do Meta (HMAC SHA-256 com o APP_SECRET) ----------
async function signatureOk(req: Request, raw: string): Promise<boolean> {
  const header = req.headers.get("x-hub-signature-256") ?? "";
  if (!ENV.APP_SECRET || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(ENV.APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = header.slice(7);
  // comparação em tempo constante
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ---------- "Já processei esse id?" (evita duplicados) ----------
async function firstTime(eventId: string): Promise<boolean> {
  const { error } = await db.from("ig_processed_events").insert({ event_id: eventId });
  return !error; // erro de chave duplicada = já processado
}

// Acha a automação certa DA CONTA. Prioridade: post específico > todos os
// posts; palavra-chave > "qualquer palavra".
async function findAutomation(conta: Conta, text: string, mediaId?: string): Promise<{ auto: Automation; keyword: string } | null> {
  const { data } = await db.from("ig_automations").select("*").eq("conta_id", conta.id).eq("active", true);
  let best: { auto: Automation; keyword: string; score: number } | null = null;
  for (const auto of (data ?? []) as Automation[]) {
    const medias = auto.media_ids ?? [];
    if (medias.length && (!mediaId || !medias.includes(mediaId))) continue;
    const kw = auto.match_any ? null : keywordMatches(text, auto.keyword);
    if (!auto.match_any && !kw) continue;
    const score = (medias.length ? 2 : 0) + (kw ? 1 : 0);
    if (!best || score > best.score) best = { auto, keyword: kw ?? "*", score };
  }
  return best ? { auto: best.auto, keyword: best.keyword } : null;
}

// Regra do "1 por dia" (por conta): já recebeu uma DM ok nas últimas 24h?
async function receivedToday(conta: Conta, igUserId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from("ig_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("conta_id", conta.id).eq("ig_user_id", igUserId).eq("canal", "private_reply").eq("status", "ok").gte("ts", since);
  return (count ?? 0) > 0;
}

// Relatório: a conta respondeu o comentário de alguém (1 por pessoa por dia)
async function contarRespostaComentario(conta: Conta, parentId: string) {
  const r = await graphGet(conta.token, `/${parentId}`, { fields: "from" });
  const autor: string | undefined = r.ok ? r.data?.from?.id : undefined;
  if (!autor || ehDaConta(conta, autor)) return;
  const { error } = await db.rpc("registrar_atendimento", { p_conta: conta.id, p_user: autor, p_canal: "comentario" });
  if (error) console.warn("[relatório] não contou a resposta (rodou o 12_midias_relatorio.sql?):", error.message);
}

// =====================================================================
// COMENTÁRIO
// =====================================================================
async function handleComment(conta: Conta, value: any) {
  const commentId: string = value?.id;
  const fromId: string = value?.from?.id;
  const username: string = value?.from?.username;
  const text: string = value?.text ?? "";
  const mediaId: string | undefined = value?.media?.id;
  if (!commentId || !fromId) return;

  // 1) duplicado?
  if (!(await firstTime(`comment:${commentId}`))) return;

  // 2) comentário da própria conta: não dispara automação. Se for resposta
  //    a alguém (automação ou alguém do time), conta no relatório.
  if (ehDaConta(conta, fromId)) {
    if (value?.parent_id) await contarRespostaComentario(conta, String(value.parent_id));
    return;
  }

  // 3) acha a automação da conta
  const found = await findAutomation(conta, text, mediaId);
  if (!found) return;
  const { auto, keyword } = found;

  // Conta a interação (cria o lead, mesmo que a regra do 1 por dia pule o envio)
  await registrarInteracao(conta.id, fromId, true);
  if (username) await upsertLead(conta.id, fromId, { username });

  // 4) regra do 1 por dia (contas de teste ignoram)
  const isTest = ENV.TEST_IG_ACCOUNTS.includes(fromId);
  if (!isTest && (await receivedToday(conta, fromId))) {
    await logDelivery({ conta_id: conta.id, ig_user_id: fromId, automation_id: auto.id, canal: "private_reply", tipo: "flow", status: "erro", motivo: "pulado: já recebeu DM nas últimas 24h" });
    return;
  }

  // 5) entrega
  const result = await deliverAutomation(auto, { commentId, igUserId: fromId, username });

  // Só marca o lead e responde no comentário se saiu ou está garantido na fila
  if (result === "ok" || result === "throttled") {
    await replyToComment(auto, commentId);
    await upsertLead(conta.id, fromId, {
      username, last_source: "comment", last_keyword: keyword, automation_id: auto.id,
    });
  } else if (result === "incerto") {
    // O Instagram deu erro ambíguo e o eco não confirmou: a DM PODE ter saído.
    // Não libera o comentário para nova tentativa (melhor faltar que repetir).
    await upsertLead(conta.id, fromId, { username, last_source: "comment", last_keyword: keyword, automation_id: auto.id });
  } else {
    // Falhou: libera o id pra que um reenvio do Meta possa tentar de novo
    await db.from("ig_processed_events").delete().eq("event_id", `comment:${commentId}`);
  }
}

// =====================================================================
// MENSAGEM / POSTBACK / QUICK_REPLY
// =====================================================================
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function handleMessage(conta: Conta, ev: any) {
  const senderId: string = ev?.sender?.id;
  const msg = ev?.message;
  const postback = ev?.postback;

  const quando = ev?.timestamp ? new Date(Number(ev.timestamp)) : new Date();

  // Echo = mensagem que a própria conta mandou (bot, painel ou você no celular).
  // Não dispara automação; só entra no histórico da conversa como "eu".
  if (msg?.is_echo) {
    const clienteId: string | undefined = ev?.recipient?.id;
    const texto = textoDoEvento(msg, null);
    if (clienteId && texto && !ehDaConta(conta, clienteId)) {
      try {
        const conversa = await conversaDe(conta, clienteId);
        if (conversa) await gravarMensagem(conversa, "eu", texto, msg?.mid ?? null, quando, midiaDoEvento(msg));
      } catch (e) { console.error("[caixa de entrada] eco não gravado:", e); }
    }
    return;
  }
  if (!senderId || ehDaConta(conta, senderId)) return;

  const mid: string | undefined = msg?.mid ?? postback?.mid;
  if (mid) {
    // Se o mid é um envio nosso, ignora
    const { data: own } = await db.from("ig_bot_sends").select("mid").eq("mid", mid).maybeSingle();
    if (own) return;
    if (!(await firstTime(`msg:${mid}`))) return;
  }

  // Caixa de entrada: salva a mensagem e, se for texto escrito (não toque
  // em botão), pede uma SUGESTÃO de resposta. Nada é enviado sozinho.
  // Uma falha aqui nunca pode travar as automações logo abaixo.
  const textoConversa = textoDoEvento(msg, postback);
  if (textoConversa) {
    try {
      const conversa = await conversaDe(conta, senderId);
      const novaId = conversa ? await gravarMensagem(conversa, "cliente", textoConversa, mid ?? null, quando, midiaDoEvento(msg)) : null;
      const tocouBotao = !!(postback || msg?.quick_reply);
      if (conversa && novaId && msg?.text && !tocouBotao) emSegundoPlano(gerarSugestao(conversa, novaId));
    } catch (e) { console.error("[caixa de entrada] mensagem não gravada:", e); }
  }

  const source = msg?.reply_to?.story ? "story_reply" : "dm";

  // Conta a interação (só de quem já é lead da conta) e tenta completar nome e @
  await registrarInteracao(conta.id, senderId, false);
  await completarPerfil(conta, senderId);

  // Automação pelo id, só se for desta conta
  const autoDaConta = async (id: string) => {
    const { data } = await db.from("ig_automations").select("*").eq("id", id).eq("conta_id", conta.id).maybeSingle();
    return data as Automation | null;
  };

  // ---- Toque em botão: postback OU quick_reply (trate os DOIS) ----
  const payload: string | undefined = postback?.payload ?? msg?.quick_reply?.payload;
  const parsed = parsePayload(payload);
  if (parsed) {
    const auto = await autoDaConta(parsed.autoId);
    if (!auto) return;
    const step = findStep(auto, parsed.stepId);
    if (!step) return;
    await upsertLead(conta.id, senderId, { last_source: source, expecting: null });
    const r = await sendStep(auto, step, { id: senderId }, senderId);
    await logDelivery({ conta_id: conta.id, ig_user_id: senderId, automation_id: auto.id, canal: "dm", tipo: r.tipo, status: r.ok ? "ok" : "erro", motivo: r.error });
    return;
  }

  // ---- Coleta de dado: o passo anterior pediu email/telefone ----
  const text: string = (msg?.text ?? "").trim();
  if (!text) return;

  const { data: lead } = await db.from("ig_leads").select("*").eq("conta_id", conta.id).eq("ig_user_id", senderId).maybeSingle();
  const exp = lead?.expecting as { field: string; automation_id: string; next: string | number | null } | null;
  if (exp?.field) {
    const auto = await autoDaConta(exp.automation_id);
    let value = text;
    let valid = true;
    if (exp.field === "email") { value = text.toLowerCase(); valid = EMAIL_RE.test(value); }
    if (exp.field === "telefone") { value = text.replace(/\D/g, ""); valid = value.length >= 10 && value.length <= 13; }

    if (!valid) {
      const pedido = exp.field === "email"
        ? "Hmm, esse e-mail parece estranho. Pode mandar de novo? (ex: nome@exemplo.com)"
        : "Hmm, esse número parece estranho. Pode mandar de novo com DDD?";
      if (auto) await sendStep(auto, { id: "retry", message: pedido }, { id: senderId }, "");
      return;
    }

    const fields: Record<string, unknown> = { expecting: null, last_source: source };
    if (exp.field === "email" || exp.field === "telefone") fields[exp.field] = value;
    else fields.extra = { ...(lead?.extra ?? {}), [exp.field]: value };
    await upsertLead(conta.id, senderId, fields);

    if (auto && exp.next !== null && exp.next !== undefined) {
      const next = findStep(auto, exp.next);
      if (next) {
        const r = await sendStep(auto, next, { id: senderId }, senderId);
        await logDelivery({ conta_id: conta.id, ig_user_id: senderId, automation_id: auto.id, canal: "dm", tipo: r.tipo, status: r.ok ? "ok" : "erro", motivo: r.error });
      }
    }
    return;
  }

  // Mensagem solta que não é botão nem dado pedido: silêncio.
}

// =====================================================================
// Servidor
// =====================================================================
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // a) Verificação (GET)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === ENV.VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("verificação falhou", { status: 403 });
  }

  if (req.method !== "POST") return new Response("ok", { status: 200 });

  // b) Recebimento (POST)
  const raw = await req.text();
  const sigOk = await signatureOk(req, raw);
  if (!sigOk) {
    if (ENV.APP_SECRET_ENFORCE) {
      console.warn("[webhook] assinatura inválida: BLOQUEADO (APP_SECRET_ENFORCE=true)");
      return new Response("assinatura inválida", { status: 401 });
    }
    console.warn("[webhook] assinatura inválida: processando mesmo assim (modo teste, APP_SECRET_ENFORCE=false)");
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, erro: "json inválido" }, 400); }

  // Processa cada evento sem deixar um erro derrubar os outros
  for (const entry of body?.entry ?? []) {
    // De qual conta é este evento?
    const conta = await contaPorIgId(String(entry?.id ?? ""))
      ?? await contaPorIgId(String(entry?.messaging?.[0]?.recipient?.id ?? ""));
    if (!conta) { console.warn("[webhook] conta não cadastrada no painel:", entry?.id); continue; }

    for (const change of entry?.changes ?? []) {
      if (change?.field === "comments") {
        try { await handleComment(conta, change.value); } catch (e) { console.error("[comentário] erro:", e); }
      }
    }
    for (const ev of entry?.messaging ?? []) {
      try { await handleMessage(conta, ev); } catch (e) { console.error("[mensagem] erro:", e); }
    }
  }

  // Responde 200 sempre (senão o Meta fica reenviando)
  return json({ ok: true });
});
