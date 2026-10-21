// =====================================================================
// ig-insights: métricas pro dashboard
// Devolve: seguidores, novos seguidores por dia e alcance por dia
// (últimos 15 dias). Só responde pra quem está logado no painel.
// =====================================================================
import { ENV, graphGet } from "../_shared/ig.ts";
import { CORS, reply, requireUser } from "../_shared/painel.ts";

// Converte a resposta de insights em [{ dia: "AAAA-MM-DD", valor: n }]
function serie(data: any, metric: string) {
  const m = (data?.data ?? []).find((d: any) => d.name === metric);
  return (m?.values ?? []).map((v: any) => ({ dia: String(v.end_time ?? "").slice(0, 10), valor: Number(v.value ?? 0) }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await requireUser(req))) return reply({ ok: false, erro: "não autorizado" }, 401);

  if (!ENV.IG_ACCOUNT_ID) return reply({ ok: false, conectado: false, erro: "IG_ACCOUNT_ID não configurado" });

  const until = Math.floor(Date.now() / 1000);
  const since = until - 15 * 24 * 3600;

  // Perfil (seguidores)
  const perfil = await graphGet(`/${ENV.IG_ACCOUNT_ID}`, { fields: "username,followers_count,media_count" });
  if (!perfil.ok) return reply({ ok: false, conectado: false, erro: perfil.error?.message ?? "falha ao ler o perfil" });

  // Novos seguidores por dia (cada métrica separada: se uma falhar, a outra ainda vem)
  const seg = await graphGet(`/${ENV.IG_ACCOUNT_ID}/insights`, {
    metric: "follower_count", period: "day", since: String(since), until: String(until),
  });
  const alc = await graphGet(`/${ENV.IG_ACCOUNT_ID}/insights`, {
    metric: "reach", period: "day", since: String(since), until: String(until),
  });

  return reply({
    ok: true,
    conectado: true,
    username: perfil.data?.username,
    seguidores: perfil.data?.followers_count ?? 0,
    posts: perfil.data?.media_count ?? 0,
    novos_seguidores: seg.ok ? serie(seg.data, "follower_count") : [],
    alcance: alc.ok ? serie(alc.data, "reach") : [],
  });
});
