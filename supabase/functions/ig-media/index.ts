// =====================================================================
// ig-media: lista os posts da conta (com miniatura) pro seletor
// "Em quais posts" do editor. Só responde pra quem está logado.
// =====================================================================
import { ENV, graphGet } from "../_shared/ig.ts";
import { CORS, reply, requireUser } from "../_shared/painel.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await requireUser(req))) return reply({ ok: false, erro: "não autorizado" }, 401);

  if (!ENV.IG_ACCOUNT_ID) return reply({ ok: false, posts: [], erro: "IG_ACCOUNT_ID não configurado" });

  const r = await graphGet(`/${ENV.IG_ACCOUNT_ID}/media`, {
    fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
    limit: "50",
  });
  if (!r.ok) return reply({ ok: false, posts: [], erro: r.error?.message ?? "falha ao listar posts" });

  const posts = (r.data?.data ?? []).map((p: any) => ({
    id: p.id,
    legenda: (p.caption ?? "").slice(0, 120),
    tipo: p.media_type,
    // vídeo usa a thumbnail; foto usa a própria mídia
    miniatura: p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url,
    link: p.permalink,
    data: p.timestamp,
  }));

  return reply({ ok: true, posts });
});
