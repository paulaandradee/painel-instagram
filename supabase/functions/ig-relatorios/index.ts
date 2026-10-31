// =====================================================================
// ig-relatorios: coleta de métricas e relatórios de desempenho
// Só contas com o recurso 'relatorios' (ig_contas.recursos).
//
// Robô (pg_cron, todo dia ~06h15 de Brasília, com x-sched-key):
//   - guarda os seguidores do dia (a Meta não dá o passado), o alcance e os
//     novos seguidores por dia, e as métricas dos posts dos últimos 45 dias
//   - segunda-feira: relatório SEMANAL da semana anterior (seg a dom)
//   - dia 1º: relatório MENSAL do mês anterior
//   - cada coleta fica anotada em "coletas" (o painel avisa se falhar)
// Painel (pessoa logada que edita a conta):
//   { acao: "gerar", conta_id, tipo: "semanal"|"mensal"|"personalizado", inicio, fim }
//   { acao: "coletar", conta_id }
// As sugestões (resumo, hipóteses, recomendações) vêm do Gemini gratuito,
// só com números e legendas da própria conta, e são marcadas como sugestão.
// =====================================================================
import { checkSchedKey, Conta, db, graphGet, json, todasContas } from "../_shared/ig.ts";
import { contaDoUsuario, CORS, ehLeitor, reply, requireUser, SO_LEITURA } from "../_shared/painel.ts";
import { chamarGemini, ultimaFalha } from "../_shared/conversas.ts";

const DIA_S = 86400;
const BRT_MS = 3 * 3600 * 1000; // Brasília = UTC-3
const DIAS_POSTS = 45;
const METRICAS_CONTA = ["reach", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves", "views", "profile_views"];

// ---------------- Datas (sempre no dia de Brasília) ----------------
const hojeBrt = () => new Date(Date.now() - BRT_MS).toISOString().slice(0, 10);
const somarDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_S * 1000).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (DIA_S * 1000)) + 1;
// meia-noite de Brasília daquele dia, em segundos unix
const unixBrt = (iso: string) => Math.floor((Date.parse(`${iso}T00:00:00Z`) + BRT_MS) / 1000);

async function emLotes<T, R>(itens: T[], tamanho: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  return out;
}

// ---------------- Coleta ----------------
// Série por dia (o valor com end_time do dia X se refere ao dia anterior)
async function serie(conta: Conta, metric: string, dias: number): Promise<Map<string, number>> {
  const fim = Math.floor(Date.now() / 1000);
  const r = await graphGet(conta.token, `/${conta.ig_user_id}/insights`, { metric, period: "day", since: String(fim - dias * DIA_S), until: String(fim) });
  const pontos = new Map<string, number>();
  if (!r.ok) throw new Error(`${metric}: ${r.error?.message ?? "falhou"}`);
  for (const v of r.data?.data?.[0]?.values ?? []) {
    const dia = new Date(new Date(v.end_time).getTime() - DIA_S * 1000 - BRT_MS).toISOString().slice(0, 10);
    pontos.set(dia, Number(v.value ?? 0));
  }
  return pontos;
}

const tipoDoPost = (p: any) => p.media_product_type === "REELS" ? "Reels" : p.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : p.media_type === "VIDEO" ? "Vídeo" : "Foto";

// Métricas de um post. Cada grupo separado: se a Meta não tiver um, os outros vêm.
async function metricasDoPost(conta: Conta, p: any) {
  const m: Record<string, number> = {};
  const pedir = async (metric: string) => {
    const r = await graphGet(conta.token, `/${p.id}/insights`, { metric });
    if (r.ok) for (const d of r.data?.data ?? []) m[d.name] = Number(d.values?.[0]?.value ?? d.total_value?.value ?? 0);
    return r.ok;
  };
  if (!(await pedir("reach,saved,shares,views,total_interactions"))) await pedir("reach,saved,shares");
  await pedir("follows,profile_visits");
  if (p.media_product_type === "REELS") await pedir("ig_reels_avg_watch_time");
  const curtidas = Number(p.like_count ?? 0), comentarios = Number(p.comments_count ?? 0);
  return {
    conta_id: conta.id, media_id: p.id, publicado_em: p.timestamp, tipo: tipoDoPost(p), link: p.permalink,
    legenda: String(p.caption ?? "").slice(0, 300),
    miniatura: p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url,
    curtidas, comentarios, salvos: m.saved ?? null, compartilhamentos: m.shares ?? null, alcance: m.reach ?? null,
    views: m.views ?? null, interacoes: m.total_interactions ?? null, seguidores: m.follows ?? null,
    visitas_perfil: m.profile_visits ?? null,
    tempo_medio_s: m.ig_reels_avg_watch_time != null ? Math.round(m.ig_reels_avg_watch_time / 100) / 10 : null,
    atualizado_em: new Date().toISOString(),
  };
}

async function coletarPosts(conta: Conta, dias: number) {
  const desde = Date.now() - dias * DIA_S * 1000;
  const lista: any[] = [];
  let after: string | undefined;
  for (let pagina = 0; pagina < 6; pagina++) {
    const params: Record<string, string> = {
      fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count", limit: "50",
    };
    if (after) params.after = after;
    const r = await graphGet(conta.token, `/${conta.ig_user_id}/media`, params);
    if (!r.ok) throw new Error(`posts: ${r.error?.message ?? "falhou"}`);
    const dados = r.data?.data ?? [];
    lista.push(...dados.filter((p: any) => new Date(p.timestamp).getTime() >= desde));
    after = r.data?.paging?.cursors?.after;
    const maisVelho = dados[dados.length - 1];
    if (!after || !maisVelho || new Date(maisVelho.timestamp).getTime() < desde) break;
  }
  const linhas = await emLotes(lista, 8, (p) => metricasDoPost(conta, p));
  if (linhas.length) {
    const { error } = await db.from("metricas_posts").upsert(linhas, { onConflict: "conta_id,media_id" });
    if (error) throw new Error(`gravar posts: ${error.message}`);
  }
  return linhas.length;
}

async function coletar(conta: Conta, diasPosts = DIAS_POSTS): Promise<string> {
  const hoje = hojeBrt();
  const { count } = await db.from("metricas_diarias").select("dia", { count: "exact", head: true }).eq("conta_id", conta.id);
  const dias = count ? 7 : 30; // primeira vez: busca os últimos 30 dias
  const perfil = await graphGet(conta.token, `/${conta.ig_user_id}`, { fields: "followers_count" });
  if (!perfil.ok) throw new Error(`perfil: ${perfil.error?.message ?? "falhou"}`);
  const [alcance, novos] = await Promise.all([serie(conta, "reach", dias), serie(conta, "follower_count", dias).catch(() => new Map<string, number>())]);
  const diasTodos = new Set([...alcance.keys(), ...novos.keys()]);
  const linhas = [...diasTodos].filter((d) => d < hoje).map((dia) => ({
    conta_id: conta.id, dia, alcance: alcance.get(dia) ?? null, novos_seguidores: novos.get(dia) ?? null, atualizado_em: new Date().toISOString(),
  }));
  if (linhas.length) {
    const { error } = await db.from("metricas_diarias").upsert(linhas, { onConflict: "conta_id,dia", ignoreDuplicates: false });
    if (error) throw new Error(`gravar dias: ${error.message}`);
  }
  // seguidores de hoje (foto); não apaga o alcance que já estiver no dia
  const { error: e2 } = await db.from("metricas_diarias").upsert(
    { conta_id: conta.id, dia: hoje, seguidores: Number(perfil.data?.followers_count ?? 0), atualizado_em: new Date().toISOString() },
    { onConflict: "conta_id,dia" },
  );
  if (e2) throw new Error(`gravar seguidores: ${e2.message}`);
  const posts = await coletarPosts(conta, diasPosts);
  return `${linhas.length} dias, ${posts} posts, ${perfil.data?.followers_count} seguidores`;
}

// ---------------- Relatório ----------------
type Totais = Record<string, number>;

// Totais de um período. Até 30 dias: uma chamada (alcance sem repetir pessoas).
// Mais que isso: soma blocos (alcance aproximado, a mesma pessoa pode contar 2x).
async function totais(conta: Conta, inicio: string, fim: string): Promise<{ t: Totais; aproximado: boolean; faltaram: string[] }> {
  const blocos: [string, string][] = [];
  for (let a = inicio; a <= fim; a = somarDias(a, 30)) blocos.push([a, [somarDias(a, 29), fim].sort()[0]]);
  const t: Totais = {};
  const faltaram: string[] = [];
  await Promise.all(METRICAS_CONTA.map(async (m) => {
    let ok = false;
    for (const [a, b] of blocos) {
      const r = await graphGet(conta.token, `/${conta.ig_user_id}/insights`, {
        metric: m, metric_type: "total_value", period: "day", since: String(unixBrt(a)), until: String(unixBrt(somarDias(b, 1))),
      });
      if (!r.ok) continue;
      ok = true;
      t[m] = (t[m] ?? 0) + Number(r.data?.data?.[0]?.total_value?.value ?? 0);
    }
    if (!ok) faltaram.push(m);
  }));
  return { t, aproximado: blocos.length > 1, faltaram };
}

const NOMES: Record<string, string> = {
  reach: "alcance", accounts_engaged: "contas_engajadas", total_interactions: "interacoes", likes: "curtidas", comments: "comentarios",
  shares: "compartilhamentos", saves: "salvos", views: "visualizacoes", profile_views: "visitas_perfil",
};
const traduzir = (t: Totais) => Object.fromEntries(Object.entries(t).map(([k, v]) => [NOMES[k] ?? k, v]));

function media(lista: any[], campo: string) {
  const v = lista.map((p) => p[campo]).filter((x) => typeof x === "number");
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}
function agrupar(posts: any[], chave: (p: any) => string) {
  const g = new Map<string, any[]>();
  posts.forEach((p) => { const k = chave(p); g.set(k, [...(g.get(k) ?? []), p]); });
  return [...g].map(([nome, l]) => ({
    nome, posts: l.length, views: media(l, "views"), alcance: media(l, "alcance"), salvos: media(l, "salvos"),
    compartilhamentos: media(l, "compartilhamentos"), seguidores: media(l, "seguidores"),
  })).sort((a, b) => b.posts - a.posts);
}

async function gerar(conta: Conta, tipo: string, inicio: string, fim: string, origem: "automatico" | "manual") {
  const avisos: string[] = [];
  const n = diasEntre(inicio, fim);
  const antIni = somarDias(inicio, -n), antFim = somarDias(inicio, -1);
  const [atual, anterior] = await Promise.all([totais(conta, inicio, fim), totais(conta, antIni, antFim)]);
  if (atual.aproximado) avisos.push("Período maior que 30 dias: o alcance foi somado em blocos e pode contar a mesma pessoa mais de uma vez.");
  if (atual.faltaram.length) avisos.push(`A Meta não devolveu: ${atual.faltaram.map((m) => NOMES[m] ?? m).join(", ")}.`);

  // seguidores: fotos guardadas no começo e no fim
  const { data: dias } = await db.from("metricas_diarias").select("*").eq("conta_id", conta.id)
    .gte("dia", somarDias(antIni, -1)).lte("dia", somarDias(fim, 1)).order("dia");
  const doPeriodo = (dias ?? []).filter((d) => d.dia >= inicio && d.dia <= fim);
  const foto = (alvo: string, depois: boolean) => {
    const l = (dias ?? []).filter((d) => d.seguidores != null && (depois ? d.dia >= alvo : d.dia <= alvo));
    return depois ? l[0] : l[l.length - 1];
  };
  const fIni = foto(somarDias(inicio, -1), false) ?? foto(inicio, true);
  const fFim = foto(somarDias(fim, 1), false);
  const ganhos = doPeriodo.reduce((s, d) => s + (d.novos_seguidores ?? 0), 0);
  const seguidores = {
    inicio: fIni && fIni.dia <= somarDias(inicio, 1) ? fIni.seguidores : null,
    fim: fFim && fFim.dia >= fim ? fFim.seguidores : (fFim?.seguidores ?? null),
    ganhos_no_periodo: doPeriodo.some((d) => d.novos_seguidores != null) ? ganhos : null,
  } as Record<string, number | null>;
  seguidores.crescimento_liquido = seguidores.inicio != null && seguidores.fim != null ? (seguidores.fim as number) - (seguidores.inicio as number) : null;
  if (seguidores.crescimento_liquido == null) avisos.push("Sem a foto de seguidores do começo do período (o painel só guarda a partir da primeira coleta): o crescimento mostrado são os novos seguidores informados pela Meta, sem descontar quem deixou de seguir.");

  // posts publicados no período e o que é autoral ou remix (pela ficha ligada)
  const { data: posts } = await db.from("metricas_posts").select("*").eq("conta_id", conta.id)
    .gte("publicado_em", new Date(unixBrt(inicio) * 1000).toISOString()).lt("publicado_em", new Date(unixBrt(somarDias(fim, 1)) * 1000).toISOString())
    .order("publicado_em");
  const lista = posts ?? [];
  const ids = lista.map((p) => p.media_id);
  const { data: fichas } = ids.length
    ? await db.from("conteudos").select("id, numero, titulo, origem, pilar, ig_media_id").eq("conta_id", conta.id).in("ig_media_id", ids)
    : { data: [] as any[] };
  const ficha = (id: string) => (fichas ?? []).find((f) => f.ig_media_id === id);
  const comFicha = lista.map((p) => ({ ...p, origem: ficha(p.media_id)?.origem ?? null, conteudo: ficha(p.media_id) ?? null }));
  const ORIGEM: Record<string, string> = { autoral: "Autoral", remix: "Remix", curadoria: "Curadoria", terceiros: "Terceiros", ia: "Com IA" };
  const semFicha = comFicha.filter((p) => !p.origem).length;
  if (lista.length && semFicha) avisos.push(`${semFicha} de ${lista.length} posts não estão ligados a uma ficha: entram como "Não classificado" na comparação autoral × remix.`);
  const chaveOrdem = (p: any) => p.views ?? p.alcance ?? 0;

  const dados = {
    periodo: { inicio, fim, dias: n }, anterior: { inicio: antIni, fim: antFim },
    totais: traduzir(atual.t), totais_anterior: traduzir(anterior.t),
    seguidores,
    alcance_por_dia: doPeriodo.map((d) => ({ dia: d.dia, alcance: d.alcance, novos: d.novos_seguidores })),
    posts: comFicha.map((p) => ({
      id: p.media_id, data: p.publicado_em, tipo: p.tipo, link: p.link, legenda: (p.legenda ?? "").slice(0, 120), origem: p.origem,
      conteudo: p.conteudo ? { id: p.conteudo.id, numero: p.conteudo.numero, titulo: p.conteudo.titulo } : null,
      views: p.views, alcance: p.alcance, curtidas: p.curtidas, comentarios: p.comentarios, compartilhamentos: p.compartilhamentos,
      salvos: p.salvos, seguidores: p.seguidores, visitas_perfil: p.visitas_perfil, tempo_medio_s: p.tempo_medio_s,
    })),
    melhores: [...comFicha].sort((a, b) => chaveOrdem(b) - chaveOrdem(a)).slice(0, 5).map((p) => p.media_id),
    por_formato: agrupar(comFicha, (p) => p.tipo ?? "Outro"),
    por_origem: agrupar(comFicha, (p) => (p.origem ? ORIGEM[p.origem] ?? p.origem : "Não classificado")),
    limitacoes: [
      "Métricas de posts são as mais recentes coletadas (continuam crescendo depois do período).",
      "Seguidores por post, visitas ao perfil e tempo médio só aparecem quando a Meta libera para o tipo de post.",
      "Retenção detalhada (curva de audiência) não é liberada pela API.",
    ],
  };

  // Sugestões da IA (só números e legendas da própria conta)
  let analise: any = null;
  const sistema = "Você é analista de social media. Escreva em português do Brasil, frases curtas. Use SOMENTE os números recebidos; nunca invente números. Hipóteses são hipóteses, não conclusões. Responda só JSON no formato {\"resumo\": string, \"hipoteses\": string[], \"recomendacoes\": string[], \"proximos_experimentos\": string[]} com no máximo 4 itens por lista.";
  const pedido = `Conta @${conta.username}: perfil cristão devocional para mulheres (Deus não busca desempenho, busca coração). Relatório ${tipo} de ${inicio} a ${fim}.\n` +
    `Totais: ${JSON.stringify(dados.totais)}\nPeríodo anterior (${antIni} a ${antFim}): ${JSON.stringify(dados.totais_anterior)}\n` +
    `Seguidores: ${JSON.stringify(seguidores)}\nPor formato (médias): ${JSON.stringify(dados.por_formato)}\nAutoral x remix (médias): ${JSON.stringify(dados.por_origem)}\n` +
    `Posts: ${JSON.stringify(dados.posts.map((p) => ({ data: p.data?.slice(0, 10), tipo: p.tipo, origem: p.origem, legenda: p.legenda, views: p.views, alcance: p.alcance, salvos: p.salvos, compartilhamentos: p.compartilhamentos, seguidores: p.seguidores })))}`;
  let motivoIa = "";
  try {
    const r = await chamarGemini(sistema, pedido, true);
    if (!r) motivoIa = ultimaFalha() === "limite" ? "limite gratuito do dia atingido" : "a IA não respondeu";
    else {
      const bruto = r.slice(r.indexOf("{"), r.lastIndexOf("}") + 1);
      try { analise = JSON.parse(bruto); } catch { motivoIa = "resposta da IA em formato inválido"; console.warn("[relatório] IA:", r.slice(0, 300)); }
    }
  } catch (e) { motivoIa = "falha ao chamar a IA"; console.warn("[relatório] análise da IA falhou:", e); }
  if (!analise) avisos.push(`As sugestões da IA não ficaram prontas (${motivoIa}). Os números estão completos.`);

  const status = atual.faltaram.length >= METRICAS_CONTA.length ? "erro" : avisos.some((a) => a.startsWith("A Meta") || a.startsWith("As sugestões")) ? "parcial" : "ok";
  const { data, error } = await db.from("relatorios").upsert({
    conta_id: conta.id, tipo, inicio, fim, dados, analise, status, avisos, origem, gerado_em: new Date().toISOString(),
  }, { onConflict: "conta_id,tipo,inicio,fim" }).select("id").single();
  if (error) throw new Error(`gravar relatório: ${error.message}`);
  return data.id as string;
}

// Semana anterior (segunda a domingo) e mês anterior, no dia de Brasília
function semanaAnterior(hoje: string) {
  const dow = new Date(`${hoje}T00:00:00Z`).getUTCDay(); // 0 = domingo
  const segundaDestaSemana = somarDias(hoje, -((dow + 6) % 7));
  return [somarDias(segundaDestaSemana, -7), somarDias(segundaDestaSemana, -1)];
}
function mesAnterior(hoje: string) {
  const [a, m] = hoje.split("-").map(Number);
  const ini = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 10);
  const fim = new Date(Date.UTC(a, m - 1, 0)).toISOString().slice(0, 10);
  return [ini, fim];
}

async function contasComRelatorio(): Promise<Conta[]> {
  const { data } = await db.from("ig_contas").select("id").eq("ativo", true).contains("recursos", ["relatorios"]);
  const ids = new Set((data ?? []).map((c) => c.id));
  return (await todasContas()).filter((c) => ids.has(c.id));
}

async function temRecurso(contaId: string) {
  const { data } = await db.from("ig_contas").select("recursos").eq("id", contaId).maybeSingle();
  return !!data?.recursos?.includes("relatorios");
}

async function anotar(conta: Conta, ok: boolean, detalhe: string) {
  await db.from("coletas").insert({ conta_id: conta.id, ok, detalhe: detalhe.slice(0, 500) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ---------- Robô diário ----------
  if (req.headers.get("x-sched-key")) {
    if (!checkSchedKey(req)) return json({ ok: false, erro: "não autorizado" }, 401);
    const hoje = hojeBrt();
    const resultado: Record<string, unknown> = {};
    // pedido avulso pela chave do robô: { gerar: { tipo, inicio, fim } } (ex.: refazer um mês)
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* corpo vazio = rotina diária */ }
    const g = corpo?.gerar;
    if (g && /^\d{4}-\d{2}-\d{2}$/.test(g.inicio) && /^\d{4}-\d{2}-\d{2}$/.test(g.fim) && ["semanal", "mensal", "personalizado"].includes(g.tipo)) {
      for (const conta of await contasComRelatorio()) {
        try { resultado[conta.username ?? conta.id] = await gerar(conta, g.tipo, g.inicio, g.fim, "manual"); }
        catch (e) { resultado[conta.username ?? conta.id] = `erro: ${e}`; }
      }
      return json({ ok: true, resultado });
    }
    for (const conta of await contasComRelatorio()) {
      const r: Record<string, unknown> = {};
      try { r.coleta = await coletar(conta); await anotar(conta, true, String(r.coleta)); }
      catch (e) { r.coleta = `erro: ${e}`; await anotar(conta, false, String(e)); }
      const pedidos: [string, string[]][] = [];
      if (new Date(`${hoje}T00:00:00Z`).getUTCDay() === 1) pedidos.push(["semanal", semanaAnterior(hoje)]);
      if (hoje.endsWith("-01")) pedidos.push(["mensal", mesAnterior(hoje)]);
      for (const [tipo, [ini, fim]] of pedidos) {
        const { data: ja } = await db.from("relatorios").select("id").eq("conta_id", conta.id).eq("tipo", tipo).eq("inicio", ini).eq("fim", fim).maybeSingle();
        if (ja) continue;
        try { r[tipo] = await gerar(conta, tipo, ini, fim, "automatico"); }
        catch (e) { r[tipo] = `erro: ${e}`; await anotar(conta, false, `relatório ${tipo}: ${e}`); }
      }
      resultado[conta.username ?? conta.id] = r;
    }
    await db.rpc("limpar_coletas");
    return json({ ok: true, hoje, resultado });
  }

  // ---------- Painel ----------
  const userId = await requireUser(req);
  if (!userId) return reply({ ok: false, erro: "não autorizado" }, 401);
  if (await ehLeitor(userId)) return reply({ ok: false, erro: SO_LEITURA }, 403);
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }
  const conta = await contaDoUsuario(userId, String(corpo.conta_id ?? ""));
  if (!conta) return reply({ ok: false, erro: "Sem acesso a esta conta." }, 403);
  if (!(await temRecurso(conta.id))) return reply({ ok: false, erro: "Relatórios não estão ligados para esta conta." }, 403);

  try {
    if (corpo.acao === "coletar") {
      const detalhe = await coletar(conta, Number(corpo.dias_posts) > 0 ? Math.min(Number(corpo.dias_posts), 120) : DIAS_POSTS);
      await anotar(conta, true, `manual: ${detalhe}`);
      return reply({ ok: true, detalhe });
    }
    if (corpo.acao === "gerar") {
      const hoje = hojeBrt();
      const tipo = ["semanal", "mensal", "personalizado"].includes(corpo.tipo) ? corpo.tipo : "personalizado";
      let [inicio, fim] = tipo === "semanal" && !corpo.inicio ? semanaAnterior(hoje) : tipo === "mensal" && !corpo.inicio ? mesAnterior(hoje) : [String(corpo.inicio ?? ""), String(corpo.fim ?? "")];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || inicio > fim) return reply({ ok: false, erro: "Período inválido." }, 400);
      if (fim >= hoje) fim = somarDias(hoje, -1);
      if (diasEntre(inicio, fim) > 93) return reply({ ok: false, erro: "Período de no máximo 93 dias." }, 400);
      // posts do período (e um pouco antes) atualizados antes de calcular
      const diasPosts = Math.min(120, diasEntre(inicio, hoje) + 1);
      try { await coletar(conta, diasPosts); } catch (e) { console.warn("[relatório] coleta antes de gerar falhou:", e); }
      const id = await gerar(conta, tipo, inicio, fim, "manual");
      return reply({ ok: true, id });
    }
    return reply({ ok: false, erro: "ação desconhecida" }, 400);
  } catch (e) {
    console.error("[relatórios]", e);
    await anotar(conta, false, String(e));
    return reply({ ok: false, erro: "Não foi possível agora. Tente de novo em alguns minutos." }, 500);
  }
});
