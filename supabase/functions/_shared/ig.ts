// =====================================================================
// _shared/ig.ts
// Peças usadas por várias funções: banco, chamadas ao Instagram,
// o FREIO, o envio de um passo do fluxo (sendStep) e a entrega da
// automação (deliverAutomation).
// =====================================================================
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ---------- Variáveis de ambiente (segredos) ----------
export const ENV = {
  SUPABASE_URL: Deno.env.get("SUPABASE_URL") ?? "",
  SERVICE_ROLE: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  IG_ACCESS_TOKEN: Deno.env.get("IG_ACCESS_TOKEN") ?? "",
  IG_ACCOUNT_ID: Deno.env.get("IG_ACCOUNT_ID") ?? "",
  APP_SECRET: Deno.env.get("APP_SECRET") ?? "",
  APP_SECRET_ENFORCE: (Deno.env.get("APP_SECRET_ENFORCE") ?? "false").toLowerCase() === "true",
  VERIFY_TOKEN: Deno.env.get("VERIFY_TOKEN") ?? "",
  GRAPH_API_VERSION: Deno.env.get("GRAPH_API_VERSION") ?? "v21.0",
  SCHED_SECRET: Deno.env.get("SCHED_SECRET") ?? "",
  TEST_IG_ACCOUNTS: (Deno.env.get("TEST_IG_ACCOUNTS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean),
};

export const GRAPH = `https://graph.instagram.com/${ENV.GRAPH_API_VERSION}`;

// Chave do contador do freio (linha em ig_send_budget)
export const BUDGET_KEY = "private_reply";

// Limites do Instagram
export const BUTTON_TITLE_MAX = 20;   // título de botão é cortado em 20
export const TEMPLATE_BUTTONS_MAX = 3; // botões ANEXADOS (button template)
export const QUICK_REPLIES_MAX = 13;  // pílulas (quick_reply)

// ---------- Banco (service_role ignora o RLS) ----------
export const db: SupabaseClient = createClient(ENV.SUPABASE_URL, ENV.SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ---------- Tipos do fluxo (ver seção 7 do LEIA-ME) ----------
export type FlowButton = { title: string; next?: number | string; url?: string };
export type FlowStep = {
  id: number | string;
  message: string;
  buttons?: FlowButton[];
  assets?: string[];
  collect?: { field: "email" | "telefone" | string; next?: number | string };
  delay?: { seconds: number; next: number | string };
};
export type Automation = {
  id: string;
  nome: string;
  keyword: string;
  match_any: boolean;
  active: boolean;
  media_ids: string[];
  public_reply: string;
  public_reply_variants: string[];
  flow: { steps: FlowStep[] };
  asset_ids: string[];
};

// Destinatário: por comentário (resposta privada) ou por id (DM normal)
export type Recipient = { comment_id: string } | { id: string };

// ---------- Token: usa o renovado (banco) ou o segredo ----------
let cachedToken: string | null = null;
export async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  try {
    const { data } = await db.from("ig_token_store").select("access_token").eq("id", "main").maybeSingle();
    if (data?.access_token) {
      cachedToken = data.access_token;
      return cachedToken!;
    }
  } catch (_) { /* cai no segredo */ }
  cachedToken = ENV.IG_ACCESS_TOKEN;
  return cachedToken;
}

// ---------- Chamadas à API do Instagram ----------
export type GraphResult = { ok: boolean; data?: any; error?: any; status: number };

export async function graphPost(path: string, body: unknown): Promise<GraphResult> {
  const token = await getToken();
  try {
    const r = await fetch(`${GRAPH}${path}?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.error) return { ok: false, error: data?.error ?? data, status: r.status };
    return { ok: true, data, status: r.status };
  } catch (e) {
    return { ok: false, error: { message: String(e) }, status: 0 };
  }
}

export async function graphGet(path: string, params: Record<string, string> = {}): Promise<GraphResult> {
  const token = await getToken();
  const qs = new URLSearchParams({ ...params, access_token: token });
  try {
    const r = await fetch(`${GRAPH}${path}?${qs}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.error) return { ok: false, error: data?.error ?? data, status: r.status };
    return { ok: true, data, status: r.status };
  } catch (e) {
    return { ok: false, error: { message: String(e) }, status: 0 };
  }
}

// Falha "dura" = bloqueio / limite da Meta. Alimenta o disjuntor.
export function isHardError(err: any): boolean {
  const code = Number(err?.code);
  return [4, 17, 32, 368, 613].includes(code) || Number(err?.error_subcode) === 2446079;
}

function errText(err: any): string {
  if (!err) return "erro desconhecido";
  return `${err.code ?? ""} ${err.error_subcode ?? ""} ${err.message ?? JSON.stringify(err)}`.trim();
}

// ---------- O FREIO ----------
// Sem as funções take_send_slot/record_send_result no banco, o freio
// falha FECHADO: nada sai e tudo vai pra fila. Rode o 02_freio.sql!
export async function takeSlot(): Promise<boolean> {
  const { data, error } = await db.rpc("take_send_slot", { p_key: BUDGET_KEY });
  if (error) {
    console.error("[freio] take_send_slot falhou (rodou o 02_freio.sql?):", error.message);
    return false;
  }
  return data === true;
}

export async function recordResult(ok: boolean, hard: boolean) {
  const { error } = await db.rpc("record_send_result", { p_key: BUDGET_KEY, p_ok: ok, p_hard: hard });
  if (error) console.error("[freio] record_send_result falhou:", error.message);
}

// ---------- Palavra-chave (mesma regra no webhook e na repescagem) ----------
function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // tira acentos
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Devolve a palavra que casou (ou null). Palavras separadas por vírgula.
export function keywordMatches(text: string, keywordCsv: string): string | null {
  const t = ` ${norm(text)} `;
  for (const kw of (keywordCsv ?? "").split(",")) {
    const k = norm(kw);
    if (k && t.includes(` ${k} `)) return kw.trim();
  }
  return null;
}

// ---------- Logs e leads ----------
export async function logDelivery(row: {
  ig_user_id: string; automation_id?: string | null; canal: string; tipo: string; status: string; motivo?: string;
}) {
  await db.from("ig_deliveries").insert(row);
}

export async function upsertLead(ig_user_id: string, fields: Record<string, unknown>) {
  await db.from("ig_leads").upsert({ ig_user_id, ...fields, updated_at: new Date().toISOString() }, {
    onConflict: "ig_user_id",
  });
}

// Soma 1 no contador de interações (criar = cria o lead se não existir)
export async function registrarInteracao(igUserId: string, criar: boolean) {
  const { error } = await db.rpc("registrar_interacao", { p_user: igUserId, p_criar: criar });
  if (error) console.warn("[lead] registrar_interacao falhou (rodou o 06_interacoes.sql?):", error.message);
}

// Busca nome e @ do perfil. A API só libera depois que a pessoa
// mandou mensagem pra conta, então é "melhor esforço".
export async function completarPerfil(igUserId: string) {
  const { data: lead } = await db.from("ig_leads").select("nome, username").eq("ig_user_id", igUserId).maybeSingle();
  if (!lead || (lead.nome && lead.username)) return;
  const r = await graphGet(`/${igUserId}`, { fields: "name,username" });
  if (!r.ok) return;
  const campos: Record<string, unknown> = {};
  if (r.data?.name && !lead.nome) campos.nome = r.data.name;
  if (r.data?.username && !lead.username) campos.username = r.data.username;
  if (Object.keys(campos).length) await db.from("ig_leads").update(campos).eq("ig_user_id", igUserId);
}

async function rememberMid(mid?: string) {
  if (mid) await db.from("ig_bot_sends").upsert({ mid }, { onConflict: "mid" });
}

// ---------- Ajudas do fluxo ----------
export function firstStep(auto: Automation): FlowStep | null {
  // A Mensagem 1 é SEMPRE o primeiro item do array (não procura id === 0)
  return auto.flow?.steps?.[0] ?? null;
}

export function findStep(auto: Automation, stepId: string | number): FlowStep | null {
  return auto.flow?.steps?.find((s) => String(s.id) === String(stepId)) ?? null;
}

export function stepPayload(autoId: string, next: string | number) {
  return `STEP:${autoId}:${next}`;
}

export function parsePayload(payload?: string): { autoId: string; stepId: string } | null {
  if (!payload || !payload.startsWith("STEP:")) return null;
  const [, autoId, stepId] = payload.split(":");
  if (!autoId || stepId === undefined) return null;
  return { autoId, stepId };
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

// ---------- sendStep: manda UM passo do fluxo ----------
// Monta a mensagem com os botões ANEXADOS (button template).
// Se o Instagram recusar: tenta pílulas (quick_reply), e por último texto puro.
export async function sendStep(
  auto: Automation,
  step: FlowStep,
  recipient: Recipient,
  igUserId: string,
): Promise<{ ok: boolean; hard: boolean; error?: string; tipo: string }> {
  // Botões válidos: com url (link) OU com next (avança). Sem destino = descartado.
  const buttons = (step.buttons ?? []).filter((b) => (b.url && b.url.trim()) || (b.next !== undefined && b.next !== null && b.next !== ""));
  const hasLink = buttons.some((b) => b.url);
  const tipo = hasLink ? "link" : buttons.length ? "flow" : "text";
  const text = step.message?.trim() || " ";

  let res: GraphResult | null = null;

  if (buttons.length) {
    // 1) Button template (botões colados no balão), no máximo 3
    const tplButtons = buttons.slice(0, TEMPLATE_BUTTONS_MAX).map((b) =>
      b.url
        ? { type: "web_url", url: b.url.trim(), title: cut(b.title || "Acessar", BUTTON_TITLE_MAX) }
        : { type: "postback", title: cut(b.title || "Continuar", BUTTON_TITLE_MAX), payload: stepPayload(auto.id, b.next!) }
    );
    res = await graphPost("/me/messages", {
      recipient,
      message: {
        attachment: { type: "template", payload: { template_type: "button", text: cut(text, 640), buttons: tplButtons } },
      },
    });

    // 2) Fallback: pílulas (quick_reply). Link não vira pílula: vai no texto.
    if (!res.ok && !isHardError(res.error)) {
      console.warn("[sendStep] button template recusado, tentando quick_reply:", errText(res.error));
      const links = buttons.filter((b) => b.url).map((b) => `${b.title || "Acessar"}: ${b.url}`);
      const qrs = buttons.filter((b) => !b.url).slice(0, QUICK_REPLIES_MAX).map((b) => ({
        content_type: "text",
        title: cut(b.title || "Continuar", BUTTON_TITLE_MAX),
        payload: stepPayload(auto.id, b.next!),
      }));
      const qrText = [text, ...links].join("\n\n");
      res = qrs.length
        ? await graphPost("/me/messages", { recipient, message: { text: qrText, quick_replies: qrs } })
        : await graphPost("/me/messages", { recipient, message: { text: qrText } });
    }

    // 3) Último recurso: texto puro (com os links no texto)
    if (!res.ok && !isHardError(res.error)) {
      console.warn("[sendStep] quick_reply recusado, mandando texto puro:", errText(res.error));
      const links = buttons.filter((b) => b.url).map((b) => `${b.title || "Acessar"}: ${b.url}`);
      res = await graphPost("/me/messages", { recipient, message: { text: [text, ...links].join("\n\n") } });
    }
  } else {
    res = await graphPost("/me/messages", { recipient, message: { text } });
  }

  if (!res.ok) {
    return { ok: false, hard: isHardError(res.error), error: errText(res.error), tipo };
  }

  await rememberMid(res.data?.message_id);

  // Arquivos do passo. A Mensagem 1 usa asset_ids da automação.
  // Atenção: numa resposta a comentário o Instagram só deixa mandar UMA
  // mensagem antes da pessoa responder. Por isso arquivos só seguem
  // quando já temos o id da pessoa (DM aberta). Ver LEIA-ME.
  const assetIds = step.assets?.length ? step.assets : (step === firstStep(auto) ? auto.asset_ids : []);
  if (assetIds?.length && "id" in recipient) {
    const { data: assets } = await db.from("ig_assets").select("*").in("id", assetIds);
    for (const a of assets ?? []) {
      const r = await graphPost("/me/messages", {
        recipient,
        message: { attachment: { type: a.tipo, payload: { url: a.public_url } } },
      });
      if (r.ok) await rememberMid(r.data?.message_id);
      else console.warn("[sendStep] arquivo não enviado:", a.nome, errText(r.error));
    }
  }

  // Atualiza o lead: em que passo está, se recebeu link
  if (igUserId) {
    const lead: Record<string, unknown> = { automation_id: auto.id, flow_step: String(step.id), last_dm_at: new Date().toISOString() };
    if (hasLink) lead.link_sent = true;
    if (step.collect?.field) {
      lead.expecting = { field: step.collect.field, automation_id: auto.id, next: step.collect.next ?? null };
    }
    await upsertLead(igUserId, lead);
  }

  // Passo com atraso: agenda o próximo
  if (step.delay?.seconds && step.delay.next !== undefined && igUserId) {
    await db.from("ig_scheduled").insert({
      ig_user_id: igUserId,
      automation_id: auto.id,
      step_id: String(step.delay.next),
      send_at: new Date(Date.now() + step.delay.seconds * 1000).toISOString(),
    });
  }

  return { ok: true, hard: false, tipo };
}

// ---------- deliverAutomation: entrega a Mensagem 1 (via comentário) ----------
// Passa pelo FREIO antes. Sem ficha: vai pra fila e retorna "throttled".
export async function deliverAutomation(
  auto: Automation,
  ctx: { commentId: string; igUserId: string; username?: string },
): Promise<"ok" | "throttled" | "erro"> {
  const step = firstStep(auto);
  if (!step) {
    await logDelivery({ ig_user_id: ctx.igUserId, automation_id: auto.id, canal: "private_reply", tipo: "flow", status: "erro", motivo: "automação sem passos no fluxo" });
    return "erro";
  }

  const temFicha = await takeSlot();
  if (!temFicha) {
    const { error } = await db.from("ig_send_queue").upsert({
      comment_id: ctx.commentId,
      automation_id: auto.id,
      ig_user_id: ctx.igUserId,
      username: ctx.username ?? null,
      status: "pendente",
    }, { onConflict: "comment_id", ignoreDuplicates: true });
    if (error) {
      await logDelivery({ ig_user_id: ctx.igUserId, automation_id: auto.id, canal: "private_reply", tipo: "flow", status: "erro", motivo: "falhou ao enfileirar: " + error.message });
      return "erro";
    }
    await logDelivery({ ig_user_id: ctx.igUserId, automation_id: auto.id, canal: "private_reply", tipo: "flow", status: "na_fila", motivo: "freio sem ficha" });
    return "throttled";
  }

  const r = await sendStep(auto, step, { comment_id: ctx.commentId }, ctx.igUserId);
  await recordResult(r.ok, r.hard);
  await logDelivery({
    ig_user_id: ctx.igUserId, automation_id: auto.id, canal: "private_reply", tipo: r.tipo,
    status: r.ok ? "ok" : "erro", motivo: r.error,
  });
  return r.ok ? "ok" : "erro";
}

// ---------- Resposta pública no comentário (com variação A/B) ----------
export async function replyToComment(auto: Automation, commentId: string) {
  const options = [auto.public_reply, ...(auto.public_reply_variants ?? [])].map((s) => (s ?? "").trim()).filter(Boolean);
  if (!options.length) return;
  const message = options[Math.floor(Math.random() * options.length)];
  const r = await graphPost(`/${commentId}/replies`, { message });
  if (!r.ok) console.warn("[comentário] resposta pública falhou:", errText(r.error));
}

// ---------- Proteção dos robôs agendados ----------
export function checkSchedKey(req: Request): boolean {
  return !!ENV.SCHED_SECRET && req.headers.get("x-sched-key") === ENV.SCHED_SECRET;
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });
}
