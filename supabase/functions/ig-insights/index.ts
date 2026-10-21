// =====================================================================
// ig-insights: a aba "Análises" do painel
// Corpo (POST): { periodo: 7 | 30 | 90, atualizar?: bool, comentarios?: bool }
// Devolve: perfil, totais do período, séries por dia (alcance e novos
// seguidores), posts do período com métricas e o ranking de quem mais
// comenta.
// O resultado fica guardado (ig_analises_cache) por 6 horas; "atualizar"
// força buscar de novo. O ranking de comentários só roda quando pedido.
// Só responde pra quem está logado no painel.
// =====================================================================
import { db, ENV, graphGet } from "../_shared/ig.ts";
import { CORS, reply, requireUser } from "../_shared/painel.ts";

const DIA = 86400;
const VALIDADE_MS = 6 * 3600 * 1000;
const MAX_POSTS = 150;            // posts analisados por período
const MAX_POSTS_COMENTARIOS = 60; // posts lidos no ranking de comentários (período)
const MAX_POSTS_TODOS = 150;      // posts lidos no ranking "todos os posts"
const MAX_PAGINAS_COMENTARIOS = 10; // até 500 comentários por post

type Ponto = { dia: string; valor: number };

// O Instagram aceita no máximo ~30 dias por chamada: divide o período
function janelas(dias: number): [number, number][] {
  const fim = Math.floor(Date.now() / 1000);
  const r: [number, number][] = [];
  for (let s = fim - dias * DIA; s < fim; s += 30 * DIA) r.push([s, Math.min(s + 30 * DIA, fim)]);
  return r;
}

// Faz várias promessas em lotes (não estoura o limite da API)
async function emLotes<T, R>(itens: T[], tamanho: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  return out;
}

// Pede o período inteiro numa chamada; se o Instagram recusar, divide em blocos de 30 dias
async function periodoOuBlocos(params: Record<string, string>, dias: number) {
  const fim = Math.floor(Date.now() / 1000);
  const inteiro = await graphGet(`/${ENV.IG_ACCOUNT_ID}/insights`, { ...params, since: String(fim - dias * DIA), until: String(fim) });
  if (inteiro.ok) return { res: [inteiro], blocos: false };
  const res = await Promise.all(janelas(dias).map(([s, u]) =>
    graphGet(`/${ENV.IG_ACCOUNT_ID}/insights`, { ...params, since: String(s), until: String(u) })));
  return { res, blocos: true };
}

// Série por dia (alcance ou novos seguidores).
// O valor com end_time do dia X se refere ao dia anterior: ajusta.
async function serieDiaria(metric: string, dias: number): Promise<Ponto[]> {
  const pontos = new Map<string, number>();
  const { res } = await periodoOuBlocos({ metric, period: "day" }, dias);
  for (const r of res) {
    if (!r.ok) continue;
    for (const v of r.data?.data?.[0]?.values ?? []) {
      const dia = new Date(new Date(v.end_time).getTime() - DIA * 1000).toISOString().slice(0, 10);
      pontos.set(dia, Number(v.value ?? 0));
    }
  }
  return [...pontos].sort(([a], [b]) => a.localeCompare(b)).map(([dia, valor]) => ({ dia, valor }));
}

// Totais do período (cada métrica separada: se uma falhar, as outras vêm)
const METRICAS_CONTA = ["reach", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves", "views", "profile_views"];
// aproximado = algum total precisou ser somado em blocos (conta a mesma pessoa mais de uma vez)
async function totais(dias: number): Promise<{ soma: Record<string, number>; aproximado: boolean }> {
  const soma: Record<string, number> = {};
  let aproximado = false;
  await Promise.all(METRICAS_CONTA.map(async (m) => {
    const { res, blocos } = await periodoOuBlocos({ metric: m, metric_type: "total_value", period: "day" }, dias);
    for (const r of res) {
      if (!r.ok) continue;
      soma[m] = (soma[m] ?? 0) + Number(r.data?.data?.[0]?.total_value?.value ?? 0);
    }
    if (blocos && ["reach", "accounts_engaged"].includes(m)) aproximado = true;
  }));
  return { soma, aproximado };
}

// Só os ids dos posts mais recentes (pro ranking "todos os posts")
async function idsRecentes(max: number) {
  const ids: { id: string }[] = [];
  let after: string | undefined;
  while (ids.length < max) {
    const params: Record<string, string> = { fields: "id", limit: "50" };
    if (after) params.after = after;
    const r = await graphGet(`/${ENV.IG_ACCOUNT_ID}/media`, params);
    if (!r.ok) break;
    ids.push(...(r.data?.data ?? []).map((p: any) => ({ id: p.id })));
    after = r.data?.paging?.cursors?.after;
    if (!after || !r.data?.paging?.next) break;
  }
  return ids.slice(0, max);
}

// Posts publicados no período, com as métricas de cada um
async function postsDoPeriodo(dias: number) {
  const desde = Date.now() - dias * DIA * 1000;
  const lista: any[] = [];
  let after: string | undefined;
  for (let pagina = 0; pagina < 6 && lista.length < MAX_POSTS; pagina++) {
    const params: Record<string, string> = {
      fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
      limit: "50",
    };
    if (after) params.after = after;
    const r = await graphGet(`/${ENV.IG_ACCOUNT_ID}/media`, params);
    if (!r.ok) break;
    const dados = r.data?.data ?? [];
    lista.push(...dados.filter((p: any) => new Date(p.timestamp).getTime() >= desde));
    after = r.data?.paging?.cursors?.after;
    const maisVelho = dados[dados.length - 1];
    if (!after || !maisVelho || new Date(maisVelho.timestamp).getTime() < desde) break;
  }

  return await emLotes(lista.slice(0, MAX_POSTS), 10, async (p: any) => {
    // métricas do post; se o lote todo falhar, tenta o básico
    let ins = await graphGet(`/${p.id}/insights`, { metric: "reach,saved,shares,views,total_interactions" });
    if (!ins.ok) ins = await graphGet(`/${p.id}/insights`, { metric: "reach,saved,shares" });
    const m: Record<string, number> = {};
    for (const d of ins.ok ? ins.data?.data ?? [] : []) m[d.name] = Number(d.values?.[0]?.value ?? 0);
    const curtidas = Number(p.like_count ?? 0), comentarios = Number(p.comments_count ?? 0);
    return {
      id: p.id,
      legenda: (p.caption ?? "").slice(0, 140),
      tipo: p.media_product_type === "REELS" ? "Reels" : p.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : p.media_type === "VIDEO" ? "Vídeo" : "Foto",
      miniatura: p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url,
      link: p.permalink,
      data: p.timestamp,
      curtidas,
      comentarios,
      salvos: m.saved ?? 0,
      compartilhamentos: m.shares ?? 0,
      alcance: m.reach ?? 0,
      views: m.views ?? 0,
      interacoes: m.total_interactions ?? curtidas + comentarios + (m.saved ?? 0) + (m.shares ?? 0),
    };
  });
}

// Ranking de quem mais comenta (lê os comentários dos posts do período)
async function comentaristas(posts: { id: string }[], meuUsername: string, maxPosts: number) {
  const contagem = new Map<string, number>();
  let total = 0;
  const alvo = posts.slice(0, maxPosts);
  await emLotes(alvo, 5, async (p) => {
    let after: string | undefined;
    for (let pag = 0; pag < MAX_PAGINAS_COMENTARIOS; pag++) {
      // "username" no comentário vem vazio nesta API: quem comentou vem em "from"
      const params: Record<string, string> = { fields: "from", limit: "50" };
      if (after) params.after = after;
      const r = await graphGet(`/${p.id}/comments`, params);
      if (!r.ok) break;
      for (const c of r.data?.data ?? []) {
        const u = c.from?.username;
        // ignora as respostas da própria conta
        if (!u || u === meuUsername || c.from?.id === ENV.IG_ACCOUNT_ID) continue;
        contagem.set(u, (contagem.get(u) ?? 0) + 1);
        total++;
      }
      after = r.data?.paging?.cursors?.after;
      if (!after || !r.data?.paging?.next) break;
    }
  });
  const ranking = [...contagem].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([username, n]) => ({ username, total: n }));
  return { posts_analisados: alvo.length, comentarios_analisados: total, pessoas: contagem.size, ranking };
}

async function guardar(chave: string, dados: unknown) {
  const atualizado_em = new Date().toISOString();
  await db.from("ig_analises_cache").upsert({ chave, dados, atualizado_em });
  return atualizado_em;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await requireUser(req))) return reply({ ok: false, erro: "não autorizado" }, 401);
  if (!ENV.IG_ACCOUNT_ID) return reply({ ok: false, conectado: false, erro: "IG_ACCOUNT_ID não configurado" });

  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo = padrões */ }
  const periodo = [7, 30, 90, 365].includes(Number(corpo.periodo)) ? Number(corpo.periodo) : 30;
  const chave = `analise:${periodo}`;
  // ranking: dos posts do período, ou dos últimos 150 posts ("todos")
  const todos = corpo.escopo === "todos";
  const chaveCom = todos ? "comentarios:todos" : `comentarios:${periodo}`;

  const { data: cache } = await db.from("ig_analises_cache").select("*").in("chave", [chave, chaveCom]);
  const emCache = cache?.find((c) => c.chave === chave);
  const comCache = cache?.find((c) => c.chave === chaveCom);

  let dados: any;
  let atualizado_em: string;
  const fresco = emCache && Date.now() - new Date(emCache.atualizado_em).getTime() < VALIDADE_MS;

  if (fresco && !corpo.atualizar) {
    dados = emCache.dados;
    atualizado_em = emCache.atualizado_em;
  } else {
    const perfil = await graphGet(`/${ENV.IG_ACCOUNT_ID}`, { fields: "username,followers_count,media_count,profile_picture_url" });
    if (!perfil.ok) return reply({ ok: false, conectado: false, erro: perfil.error?.message ?? "falha ao ler o perfil" });

    const [alcance, novos, { soma: tot, aproximado }, posts] = await Promise.all([
      serieDiaria("reach", periodo),
      serieDiaria("follower_count", periodo),
      totais(periodo),
      postsDoPeriodo(periodo),
    ]);

    dados = {
      perfil: {
        username: perfil.data?.username,
        seguidores: perfil.data?.followers_count ?? 0,
        posts: perfil.data?.media_count ?? 0,
        foto: perfil.data?.profile_picture_url ?? null,
      },
      totais: {
        alcance: tot.reach ?? 0,
        contas_engajadas: tot.accounts_engaged ?? 0,
        interacoes: tot.total_interactions ?? 0,
        curtidas: tot.likes ?? 0,
        comentarios: tot.comments ?? 0,
        compartilhamentos: tot.shares ?? 0,
        salvos: tot.saves ?? 0,
        views: tot.views ?? 0,
        visitas_perfil: tot.profile_views ?? 0,
        novos_seguidores: novos.reduce((s, p) => s + p.valor, 0),
      },
      aproximado,
      series: { alcance, novos_seguidores: novos },
      posts,
    };
    atualizado_em = await guardar(chave, dados);
  }

  // Ranking de comentários: só calcula quando pedido (demora mais)
  let ranking = comCache ? { ...comCache.dados, escopo: todos ? "todos" : "periodo", atualizado_em: comCache.atualizado_em } : null;
  if (corpo.comentarios) {
    const alvo = todos ? await idsRecentes(MAX_POSTS_TODOS) : dados.posts ?? [];
    const r = await comentaristas(alvo, dados.perfil?.username ?? "", todos ? MAX_POSTS_TODOS : MAX_POSTS_COMENTARIOS);
    ranking = { ...r, escopo: todos ? "todos" : "periodo", atualizado_em: await guardar(chaveCom, r) };
  }

  return reply({ ok: true, conectado: true, periodo, atualizado_em, ...dados, comentaristas: ranking });
});
