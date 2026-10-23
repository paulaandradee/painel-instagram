// =====================================================================
// _shared/ig.ts
// Peças usadas por várias funções: banco, contas de Instagram, chamadas
// à API, o FREIO, o envio de um passo do fluxo (sendStep) e a entrega
// da automação (deliverAutomation).
// O painel tem VÁRIAS contas: tudo aqui recebe a conta (ou a automação,
// que sabe de qual conta é) e usa o token e o freio dela.
// =====================================================================
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ---------- Variáveis de ambiente (segredos) ----------
export const ENV = {
  SUPABASE_URL: Deno.env.get("SUPABASE_URL") ?? "",
  SERVICE_ROLE: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  // Antigos (uma conta só): usados apenas como reserva da primeira conta
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
  conta_id: string;
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

// ---------- Contas de Instagram ----------
export type Conta = { id: string; ig_user_id: string; app_scoped_id: string | null; username: string | null; token: string };

const cacheContas = new Map<string, Conta>();

async function montarConta(linha: any): Promise<Conta | null> {
  if (!linha) return null;
  const { data: t } = await db.from("ig_contas_token").select("access_token").eq("conta_id", linha.id).maybeSingle();
  // reserva: a primeira conta ainda pode usar o segredo antigo
  const token = t?.access_token || (linha.ig_user_id === ENV.IG_ACCOUNT_ID ? ENV.IG_ACCESS_TOKEN : "");
  if (!token) { console.warn("[conta] sem token:", linha.username); return null; }
  const c: Conta = { id: linha.id, ig_user_id: linha.ig_user_id, app_scoped_id: linha.app_scoped_id, username: linha.username, token };
  cacheContas.set(c.id, c);
  return c;
}

export async function contaPorId(id: string): Promise<Conta | null> {
  if (!id) return null;
  if (cacheContas.has(id)) return cacheContas.get(id)!;
  const { data } = await db.from("ig_contas").select("*").eq("id", id).eq("ativo", true).maybeSingle();
  return montarConta(data);
}

// O Meta identifica a conta pelo id dela (pode vir em qualquer um dos dois formatos)
export async function contaPorIgId(igId: string): Promise<Conta | null> {
  if (!igId) return null;
  for (const c of cacheContas.values()) if (c.ig_user_id === igId || c.app_scoped_id === igId) return c;
  const { data } = await db.from("ig_contas").select("*").eq("ativo", true)
    .or(`ig_user_id.eq.${igId},app_scoped_id.eq.${igId}`).maybeSingle();
  return montarConta(data);
}

export async function todasContas(): Promise<Conta[]> {
  const { data } = await db.from("ig_contas").select("*").eq("ativo", true);
  const out: Conta[] = [];
  for (const l of data ?? []) { const c = await montarConta(l); if (c) out.push(c); }
  return out;
}

// É a própria conta (comentário ou mensagem dela mesma)?
export function ehDaConta(conta: Conta, igId?: string) {
  return !!igId && (igId === conta.ig_user_id || igId === conta.app_scoped_id);
}

// ---------- Chamadas à API do Instagram (sempre com o token da conta) ----------
export type GraphResult = { ok: boolean; data?: any; error?: any; status: number };

export async function graphPost(token: string, path: string, body: unknown): Promise<GraphResult> {
  try {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`, {
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

export async function graphGet(token: string, path: string, params: Record<string, string> = {}): Promise<GraphResult> {
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

// Erro "ambíguo": o Instagram respondeu erro, mas a mensagem PODE ter saído.
// Visto em 22/10/2026: erro 1 "An unknown error has occurred" com a DM
// entregue, e a fila tentou de novo 5 vezes (5 DMs iguais). Nesses casos
// nunca tentar de novo nem cair no formato reserva: confirmar pelo eco.
export function isAmbiguous(res: GraphResult): boolean {
  const code = Number(res.error?.code);
  return res.status === 0 || res.status >= 500 || code === 1 || code === 2;
}

// A conta mandou alguma mensagem pra essa pessoa desde "desde"? O webhook
// grava o eco de tudo que sai (tabela mensagens), então isso confirma a entrega.
export async function saiuDesde(contaId: string, igUserId: string, desde: string): Promise<boolean> {
  const { data: conv } = await db.from("conversas").select("id")
    .eq("conta_id", contaId).eq("instagram_user_id", igUserId).maybeSingle();
  if (!conv) return false;
  const { count } = await db.from("mensagens").select("id", { count: "exact", head: true })
    .eq("conversa_id", conv.id).eq("autor", "eu").gte("criada_em", desde);
  return (count ?? 0) > 0;
}

// Depois de um erro ambíguo: espera o eco chegar e confere se a mensagem saiu
export async function confirmarPeloEco(contaId: string, igUserId: string, desde: string): Promise<boolean> {
  for (const espera of [4000, 6000]) {
    await new Promise((r) => setTimeout(r, espera));
    if (await saiuDesde(contaId, igUserId, desde)) return true;
  }
  return false;
}

function errText(err: any): string {
  if (!err) return "erro desconhecido";
  return `${err.code ?? ""} ${err.error_subcode ?? ""} ${err.message ?? JSON.stringify(err)}`.trim();
}

// ---------- O FREIO (um contador por conta: o limite da Meta é por conta) ----------
// Sem as funções take_send_slot/record_send_result no banco, o freio
// falha FECHADO: nada sai e tudo vai pra fila. Rode o 02_freio.sql!
export const chaveFreio = (contaId: string) => `private_reply:${contaId}`;

export async function takeSlot(contaId: string): Promise<boolean> {
  const { data, error } = await db.rpc("take_send_slot", { p_key: chaveFreio(contaId) });
  if (error) {
    console.error("[freio] take_send_slot falhou (rodou o 02_freio.sql?):", error.message);
    return false;
  }
  return data === true;
}

export async function recordResult(contaId: string, ok: boolean, hard: boolean) {
  const { error } = await db.rpc("record_send_result", { p_key: chaveFreio(contaId), p_ok: ok, p_hard: hard });
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

// ---------- Logs e leads (sempre da conta) ----------
export async function logDelivery(row: {
  conta_id: string; ig_user_id: string; automation_id?: string | null; canal: string; tipo: string; status: string; motivo?: string;
}) {
  await db.from("ig_deliveries").insert(row);
}

export async function upsertLead(contaId: string, ig_user_id: string, fields: Record<string, unknown>) {
  await db.from("ig_leads").upsert(
    { conta_id: contaId, ig_user_id, ...fields, updated_at: new Date().toISOString() },
    { onConflict: "conta_id,ig_user_id" },
  );
}

// Soma 1 no contador de interações (criar = cria o lead se não existir)
export async function registrarInteracao(contaId: string, igUserId: string, criar: boolean) {
  const { error } = await db.rpc("registrar_interacao", { p_conta: contaId, p_user: igUserId, p_criar: criar });
  if (error) console.warn("[lead] registrar_interacao falhou (rodou o 09_contas_parte1.sql?):", error.message);
}

// Busca nome e @ do perfil. A API só libera depois que a pessoa
// mandou mensagem pra conta, então é "melhor esforço".
export async function completarPerfil(conta: Conta, igUserId: string) {
  const { data: lead } = await db.from("ig_leads").select("nome, username")
    .eq("conta_id", conta.id).eq("ig_user_id", igUserId).maybeSingle();
  if (!lead || (lead.nome && lead.username)) return;
  const r = await graphGet(conta.token, `/${igUserId}`, { fields: "name,username" });
  if (!r.ok) return;
  const campos: Record<string, unknown> = {};
  if (r.data?.name && !lead.nome) campos.nome = r.data.name;
  if (r.data?.username && !lead.username) campos.username = r.data.username;
  if (Object.keys(campos).length) await db.from("ig_leads").update(campos).eq("conta_id", conta.id).eq("ig_user_id", igUserId);
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
): Promise<{ ok: boolean; hard: boolean; error?: string; tipo: string; ambiguo?: boolean }> {
  const conta = await contaPorId(auto.conta_id);
  if (!conta) return { ok: false, hard: false, error: "conta sem token ou desativada", tipo: "text" };
  // Só cai no formato reserva quando o Instagram RECUSOU com certeza
  const tentarReserva = (r: GraphResult) => !r.ok && !isHardError(r.error) && !isAmbiguous(r);
  const post = (body: unknown) => graphPost(conta.token, "/me/messages", body);

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
    res = await post({
      recipient,
      message: {
        attachment: { type: "template", payload: { template_type: "button", text: cut(text, 640), buttons: tplButtons } },
      },
    });

    // 2) Fallback: pílulas (quick_reply). Link não vira pílula: vai no texto.
    if (tentarReserva(res)) {
      console.warn("[sendStep] button template recusado, tentando quick_reply:", errText(res.error));
      const links = buttons.filter((b) => b.url).map((b) => `${b.title || "Acessar"}: ${b.url}`);
      const qrs = buttons.filter((b) => !b.url).slice(0, QUICK_REPLIES_MAX).map((b) => ({
        content_type: "text",
        title: cut(b.title || "Continuar", BUTTON_TITLE_MAX),
        payload: stepPayload(auto.id, b.next!),
      }));
      const qrText = [text, ...links].join("\n\n");
      res = qrs.length
        ? await post({ recipient, message: { text: qrText, quick_replies: qrs } })
        : await post({ recipient, message: { text: qrText } });
    }

    // 3) Último recurso: texto puro (com os links no texto)
    if (tentarReserva(res)) {
      console.warn("[sendStep] quick_reply recusado, mandando texto puro:", errText(res.error));
      const links = buttons.filter((b) => b.url).map((b) => `${b.title || "Acessar"}: ${b.url}`);
      res = await post({ recipient, message: { text: [text, ...links].join("\n\n") } });
    }
  } else {
    res = await post({ recipient, message: { text } });
  }

  if (!res.ok) {
    return { ok: false, hard: isHardError(res.error), error: errText(res.error), tipo, ambiguo: isAmbiguous(res) };
  }

  await rememberMid(res.data?.message_id);

  // Arquivos do passo. A Mensagem 1 usa asset_ids da automação.
  // Atenção: numa resposta a comentário o Instagram só deixa mandar UMA
  // mensagem antes da pessoa responder. Por isso arquivos só seguem
  // quando já temos o id da pessoa (DM aberta). Ver LEIA-ME.
  const assetIds = step.assets?.length ? step.assets : (step === firstStep(auto) ? auto.asset_ids : []);
  if (assetIds?.length && "id" in recipient) {
    const { data: assets } = await db.from("ig_assets").select("*").eq("conta_id", conta.id).in("id", assetIds);
    for (const a of assets ?? []) {
      const r = await post({ recipient, message: { attachment: { type: a.tipo, payload: { url: a.public_url } } } });
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
    await upsertLead(conta.id, igUserId, lead);
  }

  // Passo com atraso: agenda o próximo
  if (step.delay?.seconds && step.delay.next !== undefined && igUserId) {
    await db.from("ig_scheduled").insert({
      conta_id: conta.id,
      ig_user_id: igUserId,
      automation_id: auto.id,
      step_id: String(step.delay.next),
      send_at: new Date(Date.now() + step.delay.seconds * 1000).toISOString(),
    });
  }

  return { ok: true, hard: false, tipo };
}

// ---------- deliverAutomation: entrega a Mensagem 1 (via comentário) ----------
// Passa pelo FREIO da conta antes. Sem ficha: vai pra fila e retorna "throttled".
export async function deliverAutomation(
  auto: Automation,
  ctx: { commentId: string; igUserId: string; username?: string },
): Promise<"ok" | "throttled" | "erro" | "incerto"> {
  const base = { conta_id: auto.conta_id, ig_user_id: ctx.igUserId, automation_id: auto.id, canal: "private_reply" };
  const step = firstStep(auto);
  if (!step) {
    await logDelivery({ ...base, tipo: "flow", status: "erro", motivo: "automação sem passos no fluxo" });
    return "erro";
  }

  const temFicha = await takeSlot(auto.conta_id);
  if (!temFicha) {
    const { error } = await db.from("ig_send_queue").upsert({
      conta_id: auto.conta_id,
      comment_id: ctx.commentId,
      automation_id: auto.id,
      ig_user_id: ctx.igUserId,
      username: ctx.username ?? null,
      status: "pendente",
      responder_publico: true, // a resposta no comentário sai junto com a DM
    }, { onConflict: "comment_id", ignoreDuplicates: true });
    if (error) {
      await logDelivery({ ...base, tipo: "flow", status: "erro", motivo: "falhou ao enfileirar: " + error.message });
      return "erro";
    }
    await logDelivery({ ...base, tipo: "flow", status: "na_fila", motivo: "freio sem ficha" });
    return "throttled";
  }

  const inicio = new Date(Date.now() - 5000).toISOString();
  const r = await sendStep(auto, step, { comment_id: ctx.commentId }, ctx.igUserId);
  if (!r.ok && r.ambiguo) {
    // Pode ter saído: confere pelo eco e NUNCA tenta de novo
    const saiu = await confirmarPeloEco(auto.conta_id, ctx.igUserId, inicio);
    await recordResult(auto.conta_id, saiu, false);
    await logDelivery({ ...base, tipo: r.tipo, status: saiu ? "ok" : "incerto", motivo: `${saiu ? "entregue (confirmado pelo eco)" : "sem confirmação"}; Instagram: ${r.error}` });
    return saiu ? "ok" : "incerto";
  }
  await recordResult(auto.conta_id, r.ok, r.hard);
  await logDelivery({ ...base, tipo: r.tipo, status: r.ok ? "ok" : "erro", motivo: r.error });
  return r.ok ? "ok" : "erro";
}

// ---------- Resposta pública no comentário (com variação A/B) ----------
export async function replyToComment(auto: Automation, commentId: string) {
  const options = [auto.public_reply, ...(auto.public_reply_variants ?? [])].map((s) => (s ?? "").trim()).filter(Boolean);
  if (!options.length) return;
  const conta = await contaPorId(auto.conta_id);
  if (!conta) return;
  const message = options[Math.floor(Math.random() * options.length)];
  const r = await graphPost(conta.token, `/${commentId}/replies`, { message });
  if (!r.ok) console.warn("[comentário] resposta pública falhou:", errText(r.error));
}

// ---------- Proteção dos robôs agendados ----------
export function checkSchedKey(req: Request): boolean {
  return !!ENV.SCHED_SECRET && req.headers.get("x-sched-key") === ENV.SCHED_SECRET;
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });
}
