// =====================================================================
// drive: Google Drive dos conteúdos (contas com o recurso 'drive')
// Credenciais só nos secrets: GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.
// O refresh token fica em drive_conexao (o painel nunca lê).
// Permissão pedida ao Google: drive.file (só enxerga o que ele mesmo criou).
//
// GET  /drive/callback       volta do login do Google (sem login do painel)
// POST { acao, ... }         pessoa logada no painel:
//   status                   conectado? e-mail, espaço usado
//   conectar { volta }       (administradora) link para autorizar no Google
//   desconectar              (administradora)
//   pasta { conteudo_id }    cria/confere a pasta do conteúdo e as 5 subpastas
//   pastas_faltando { conta_id }   cria as que faltam (até 60 conteúdos)
//   upload_iniciar { conteudo_id, subpasta, nome, tipo, tamanho }
//                            abre um envio direto navegador → Drive (o arquivo
//                            não passa por aqui) e devolve a URL e o nome final
//   upload_concluir { conteudo_id, subpasta, drive_id, nome_original }
// Pastas: CLIENTES SOCIAL MEDIA / <conta> / 2026 / 11 - Novembro /
//         04-11 - Título / 01 - Briefing e Roteiro ... 05 - Publicados
// Nada fica público: os links abrem só para quem tem acesso no Drive.
// =====================================================================
import { checkSchedKey, db, json } from "../_shared/ig.ts";
import { contaDoUsuario, CORS, ehAdmin, ehLeitor, reply, requireUser, SO_LEITURA } from "../_shared/painel.ts";

const CLIENT_ID = (Deno.env.get("GOOGLE_CLIENT_ID") ?? "").trim(); // espaço colado junto quebra o login
const CLIENT_SECRET = (Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "").trim();
const CALLBACK = `${Deno.env.get("SUPABASE_URL")}/functions/v1/drive/callback`;
const PAINEL = "https://paulaandradee.github.io/painel-instagram/";
const ORIGENS_OK = [/^https:\/\/paulaandradee\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const API = "https://www.googleapis.com/drive/v3";
const PASTA = "application/vnd.google-apps.folder";
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const SUBPASTAS = ["01 - Briefing e Roteiro", "02 - Gravações", "03 - Edição", "04 - Aprovados", "05 - Publicados"];
const MAX_BYTES = 2 * 1024 ** 3; // 2 GB por arquivo

// ---------------- Token do Google ----------------
let acesso: { token: string; expira: number } | null = null;

async function tokenDeAcesso(): Promise<string> {
  if (acesso && acesso.expira > Date.now() + 60e3) return acesso.token;
  const { data } = await db.from("drive_conexao").select("refresh_token").eq("id", "principal").maybeSingle();
  if (!data) throw new Erro("O Google Drive não está conectado.", 409);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: data.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    console.error("[drive] renovar token:", JSON.stringify(j).slice(0, 300));
    throw new Erro(j.error === "invalid_grant" ? "A autorização do Google expirou ou foi removida. Conecte o Drive de novo." : "O Google não liberou o acesso agora.", 409);
  }
  acesso = { token: j.access_token, expira: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
  return acesso.token;
}

class Erro extends Error { constructor(msg: string, public status = 400) { super(msg); } }

async function google(caminho: string, init: RequestInit = {}) {
  const r = await fetch(caminho.startsWith("http") ? caminho : `${API}${caminho}`, {
    ...init, headers: { Authorization: `Bearer ${await tokenDeAcesso()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

// ---------------- Pastas ----------------
const limpo = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);

async function garantirPasta(chave: string, nome: string, pai: string | null, ligacao: { conta_id?: string; conteudo_id?: string } = {}) {
  const { data: salva } = await db.from("drive_pastas").select("*").eq("chave", chave).maybeSingle();
  if (salva) {
    const g = await google(`/files/${salva.drive_id}?fields=id,name,parents,trashed,webViewLink`);
    if (g.ok && !g.j.trashed) {
      // mudou o nome (título) ou o lugar (data)? renomeia ou move; o ID continua o mesmo
      const mover = pai && !(g.j.parents ?? []).includes(pai);
      if (g.j.name !== nome || mover) {
        const qs = new URLSearchParams({ fields: "id,name,parents,webViewLink" });
        if (mover) { qs.set("addParents", pai!); if (g.j.parents?.length) qs.set("removeParents", g.j.parents.join(",")); }
        const p = await google(`/files/${salva.drive_id}?${qs}`, { method: "PATCH", body: JSON.stringify({ name: nome }) });
        if (!p.ok) console.warn("[drive] não renomeou/moveu:", JSON.stringify(p.j).slice(0, 200));
        await db.from("drive_pastas").update({ nome, pai_drive_id: pai, link: p.j.webViewLink ?? salva.link }).eq("chave", chave);
      }
      return { id: salva.drive_id as string, link: (g.j.webViewLink ?? salva.link) as string };
    }
    // apagada no Drive: cria de novo
  }
  const c = await google("/files?fields=id,webViewLink", {
    method: "POST", body: JSON.stringify({ name: nome, mimeType: PASTA, ...(pai ? { parents: [pai] } : {}) }),
  });
  if (!c.ok) { console.error("[drive] criar pasta:", JSON.stringify(c.j).slice(0, 300)); throw new Erro(`Não foi possível criar a pasta "${nome}" no Drive.`, 502); }
  await db.from("drive_pastas").upsert({
    chave, nome, drive_id: c.j.id, pai_drive_id: pai, link: c.j.webViewLink, conta_id: ligacao.conta_id ?? null, conteudo_id: ligacao.conteudo_id ?? null,
  }, { onConflict: "chave" });
  return { id: c.j.id as string, link: c.j.webViewLink as string };
}

async function pastaDoConteudo(conteudo: any) {
  const { data: conta } = await db.from("ig_contas").select("id, nome, username").eq("id", conteudo.conta_id).single();
  if (!conta) throw new Erro("Conta não encontrada.", 404);
  const raiz = await garantirPasta("raiz", "CLIENTES SOCIAL MEDIA", null);
  const pConta = await garantirPasta(`conta:${conta.id}`, limpo(conta.nome || `@${conta.username}`), raiz.id, { conta_id: conta.id });
  let pai: string;
  if (conteudo.data) {
    const [a, m] = conteudo.data.split("-");
    const pAno = await garantirPasta(`ano:${conta.id}:${a}`, a, pConta.id, { conta_id: conta.id });
    pai = (await garantirPasta(`mes:${conta.id}:${a}-${m}`, `${m} - ${MESES[Number(m) - 1]}`, pAno.id, { conta_id: conta.id })).id;
  } else {
    pai = (await garantirPasta(`sem_data:${conta.id}`, "Ideias sem data", pConta.id, { conta_id: conta.id })).id;
  }
  const titulo = limpo(conteudo.titulo || conteudo.tema || `Conteúdo ${conteudo.numero}`);
  const nome = conteudo.data ? `${conteudo.data.slice(8, 10)}-${conteudo.data.slice(5, 7)} - ${titulo}` : titulo;
  const liga = { conta_id: conta.id, conteudo_id: conteudo.id };
  const pasta = await garantirPasta(`conteudo:${conteudo.id}`, nome, pai, liga);
  const subs = [];
  for (let i = 0; i < SUBPASTAS.length; i++) {
    const s = await garantirPasta(`sub:${conteudo.id}:${i + 1}`, SUBPASTAS[i], pasta.id, liga);
    subs.push({ n: i + 1, nome: SUBPASTAS[i], id: s.id, link: s.link });
  }
  if (conteudo.drive_pasta_url !== pasta.link) await db.from("conteudos").update({ drive_pasta_url: pasta.link }).eq("id", conteudo.id);
  return { link: pasta.link, subpastas: subs.map(({ n, nome, link }) => ({ n, nome, link })), ids: subs };
}

// ---------------- Nomes com versão ----------------
function nomeFinal(sub: number, original: string, tipo: string, jaTem: number) {
  const ext = (original.match(/\.([a-z0-9]{1,6})$/i)?.[1] ?? "").toLowerCase();
  const fim = ext ? `.${ext}` : "";
  const pre = tipo.startsWith("video/") ? "Video" : tipo.startsWith("image/") ? "Imagem" : tipo.startsWith("audio/") ? "Audio" : "Arquivo";
  const nn = String(jaTem + 1).padStart(2, "0");
  if (sub === 2) return `${pre}_Bruto_${nn}${fim}`;
  if (sub === 3) return `${pre}_Edicao_V${nn}${fim}`;
  if (sub === 4) return `${pre}_Final_Aprovado${jaTem ? `_V${nn}` : ""}${fim}`;
  return limpo(original) || `Arquivo_${nn}${fim}`;
}

// ---------------- Quem pode ----------------
async function conteudoPermitido(userId: string, conteudoId: string) {
  const { data: c } = await db.from("conteudos").select("*").eq("id", conteudoId).maybeSingle();
  if (!c) throw new Erro("Conteúdo não encontrado.", 404);
  if (!(await contaDoUsuario(userId, c.conta_id))) throw new Erro("Sem acesso a esta conta.", 403);
  const { data: conta } = await db.from("ig_contas").select("recursos").eq("id", c.conta_id).single();
  if (!conta?.recursos?.includes("drive")) throw new Erro("O Drive não está ligado para esta conta.", 403);
  return c;
}

// ---------------- Login do Google ----------------
async function callback(url: URL) {
  const voltar = (q: string) => Response.redirect(`${PAINEL}#drive?${q}`, 302);
  const estado = url.searchParams.get("state") ?? "";
  const { data: e } = await db.from("drive_estados").select("*").eq("estado", estado).maybeSingle();
  await db.from("drive_estados").delete().eq("estado", estado);
  if (!e || Date.now() - new Date(e.criado_em).getTime() > 15 * 60e3) return voltar("drive=expirou");
  if (url.searchParams.get("error")) return voltar("drive=cancelado");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: url.searchParams.get("code") ?? "", client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: CALLBACK, grant_type: "authorization_code" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) { console.error("[drive] troca do código:", JSON.stringify(j).slice(0, 300)); return voltar("drive=erro"); }
  acesso = { token: j.access_token, expira: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
  const sobre = await google("/about?fields=user(emailAddress)");
  await db.from("drive_conexao").upsert({ id: "principal", refresh_token: j.refresh_token, email: sobre.j?.user?.emailAddress ?? null, conectado_por: e.user_id, conectado_em: new Date().toISOString() });
  return voltar("drive=conectado");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/callback")) return callback(url);

  // Diagnóstico (só com a chave do robô): as credenciais do Google estão certas?
  // Um código falso devolve "invalid_grant" se o cliente existe e a chave confere,
  // e "invalid_client" se o ID ou a chave secreta estão errados.
  if (req.headers.get("x-sched-key")) {
    if (!checkSchedKey(req)) return json({ ok: false }, 401);
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: "teste", client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: CALLBACK, grant_type: "authorization_code" }),
    });
    const j = await r.json().catch(() => ({}));
    const { count } = await db.from("drive_conexao").select("id", { count: "exact", head: true });
    // { link_para: <user_id da administradora> }: devolve um link de autorização pronto (vale 15 min)
    let link = null;
    let pedido: any = {};
    try { pedido = await req.json(); } catch { /* sem corpo */ }
    if (pedido?.link_para && (await ehAdmin(String(pedido.link_para)))) {
      const estado = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
      await db.from("drive_estados").insert({ estado, user_id: String(pedido.link_para) });
      link = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: CALLBACK, response_type: "code", access_type: "offline", prompt: "consent",
        scope: "https://www.googleapis.com/auth/drive.file", state: estado, include_granted_scopes: "true",
      })}`;
    }
    return json({
      ok: true, tem_id: !!CLIENT_ID, tem_chave: !!CLIENT_SECRET, formato_id: /\.apps\.googleusercontent\.com$/.test(CLIENT_ID.trim()),
      espacos_no_secret: (Deno.env.get("GOOGLE_CLIENT_ID") ?? "") !== CLIENT_ID || (Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "") !== CLIENT_SECRET,
      google: j.error ?? "?", google_detalhe: j.error_description ?? "", callback: CALLBACK, conectado: !!count, link,
    });
  }

  const userId = await requireUser(req);
  if (!userId) return reply({ ok: false, erro: "não autorizado" }, 401);
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }
  const acao = String(corpo.acao ?? "");
  if (!CLIENT_ID || !CLIENT_SECRET) return reply({ ok: false, configurado: false, erro: "Faltam os secrets GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no Supabase." }, 200);

  try {
    if (acao === "status") {
      const { data } = await db.from("drive_conexao").select("email, conectado_em").eq("id", "principal").maybeSingle();
      if (!data) return reply({ ok: true, configurado: true, conectado: false });
      const sobre = await google("/about?fields=storageQuota");
      const q = sobre.j?.storageQuota ?? {};
      const raiz = (await db.from("drive_pastas").select("link").eq("chave", "raiz").maybeSingle()).data;
      return reply({ ok: true, configurado: true, conectado: true, email: data.email, conectado_em: data.conectado_em,
        espaco: { usado: Number(q.usage ?? 0), limite: q.limit ? Number(q.limit) : null }, raiz: raiz?.link ?? null });
    }
    if (acao === "conectar" || acao === "desconectar") {
      if (!(await ehAdmin(userId))) throw new Erro("Só a administradora conecta o Drive.", 403);
      if (acao === "desconectar") {
        const { data } = await db.from("drive_conexao").select("refresh_token").eq("id", "principal").maybeSingle();
        if (data) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(data.refresh_token)}`, { method: "POST" }).catch(() => {});
        await db.from("drive_conexao").delete().eq("id", "principal");
        acesso = null;
        return reply({ ok: true });
      }
      const estado = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
      await db.from("drive_estados").delete().lt("criado_em", new Date(Date.now() - 3600e3).toISOString());
      await db.from("drive_estados").insert({ estado, user_id: userId });
      const qs = new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: CALLBACK, response_type: "code", access_type: "offline", prompt: "consent",
        scope: "https://www.googleapis.com/auth/drive.file", state: estado, include_granted_scopes: "true",
      });
      return reply({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${qs}` });
    }

    if (await ehLeitor(userId)) throw new Erro(SO_LEITURA, 403);

    if (acao === "pasta") {
      const c = await conteudoPermitido(userId, String(corpo.conteudo_id ?? ""));
      const p = await pastaDoConteudo(c);
      return reply({ ok: true, link: p.link, subpastas: p.subpastas });
    }
    if (acao === "pastas_faltando") {
      const contaId = String(corpo.conta_id ?? "");
      if (!(await contaDoUsuario(userId, contaId))) throw new Erro("Sem acesso a esta conta.", 403);
      const { data: lista } = await db.from("conteudos").select("*").eq("conta_id", contaId).order("data", { nullsFirst: false }).limit(60);
      const { data: feitas } = await db.from("drive_pastas").select("conteudo_id").like("chave", "conteudo:%").eq("conta_id", contaId);
      const tem = new Set((feitas ?? []).map((f) => f.conteudo_id));
      let criadas = 0;
      for (const c of lista ?? []) {
        if (tem.has(c.id)) continue;
        await conteudoPermitido(userId, c.id);
        await pastaDoConteudo(c);
        criadas++;
      }
      return reply({ ok: true, criadas });
    }
    if (acao === "upload_iniciar") {
      const c = await conteudoPermitido(userId, String(corpo.conteudo_id ?? ""));
      const sub = Number(corpo.subpasta);
      if (!(sub >= 1 && sub <= 5)) throw new Erro("Escolha a subpasta.");
      const tamanho = Number(corpo.tamanho ?? 0), tipo = String(corpo.tipo || "application/octet-stream");
      if (!(tamanho > 0)) throw new Erro("Arquivo vazio.");
      if (tamanho > MAX_BYTES) throw new Erro("Arquivo maior que 2 GB.");
      const origem = req.headers.get("origin") ?? "";
      if (!ORIGENS_OK.some((r) => r.test(origem))) throw new Erro("Origem não permitida.", 403);
      const sobre = await google("/about?fields=storageQuota");
      const q = sobre.j?.storageQuota;
      if (q?.limit && Number(q.limit) - Number(q.usage ?? 0) < tamanho) throw new Erro("Não há espaço suficiente no Google Drive.", 507);
      const p = await pastaDoConteudo(c);
      const destino = p.ids.find((s) => s.n === sub)!;
      const { count } = await db.from("arquivos").select("id", { count: "exact", head: true }).eq("conteudo_id", c.id).eq("subpasta", sub);
      const nome = nomeFinal(sub, String(corpo.nome ?? "arquivo"), tipo, count ?? 0);
      const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType,webViewLink,parents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await tokenDeAcesso()}`, "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": tipo, "X-Upload-Content-Length": String(tamanho), Origin: origem,
        },
        body: JSON.stringify({ name: nome, parents: [destino.id] }),
      });
      const local = r.headers.get("location");
      if (!r.ok || !local) { console.error("[drive] abrir envio:", r.status, (await r.text()).slice(0, 300)); throw new Erro("O Drive não abriu o envio agora.", 502); }
      return reply({ ok: true, url: local, nome, subpasta: destino.nome });
    }
    if (acao === "upload_concluir") {
      const c = await conteudoPermitido(userId, String(corpo.conteudo_id ?? ""));
      const sub = Number(corpo.subpasta);
      const { data: pasta } = await db.from("drive_pastas").select("drive_id").eq("chave", `sub:${c.id}:${sub}`).maybeSingle();
      const g = await google(`/files/${encodeURIComponent(String(corpo.drive_id ?? ""))}?fields=id,name,size,mimeType,webViewLink,parents`);
      if (!g.ok || !pasta || !(g.j.parents ?? []).includes(pasta.drive_id)) throw new Erro("Não encontrei o arquivo na pasta do conteúdo.", 404);
      const { count } = await db.from("arquivos").select("id", { count: "exact", head: true }).eq("conteudo_id", c.id).eq("subpasta", sub);
      const { data, error } = await db.from("arquivos").upsert({
        conta_id: c.conta_id, conteudo_id: c.id, subpasta: sub, drive_id: g.j.id, nome: g.j.name, nome_original: String(corpo.nome_original ?? "").slice(0, 200),
        tipo_mime: g.j.mimeType, tamanho: g.j.size ? Number(g.j.size) : null, versao: (count ?? 0) + 1, link: g.j.webViewLink, enviado_por: userId,
      }, { onConflict: "drive_id" }).select().single();
      if (error) throw new Erro("O arquivo subiu, mas não ficou registrado. Tente de novo.", 500);
      return reply({ ok: true, arquivo: data });
    }
    return reply({ ok: false, erro: "ação desconhecida" }, 400);
  } catch (e) {
    if (e instanceof Erro) return reply({ ok: false, erro: e.message }, e.status);
    console.error("[drive]", e);
    return reply({ ok: false, erro: "Não foi possível falar com o Google Drive agora." }, 500);
  }
});
