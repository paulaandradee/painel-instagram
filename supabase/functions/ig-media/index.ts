// =====================================================================
// ig-media: posts da conta (com miniatura)
// Corpo (POST): { conta_id, ids?: [...] }
// - Sem ids: lista os 50 posts mais recentes (seletor do editor).
// - Com ids: busca esses posts específicos, mesmo os antigos (fotos na
//   lista de automações).
// Só responde pra quem tem acesso à conta.
// =====================================================================
import { graphGet } from "../_shared/ig.ts";
import { contaDoUsuario, CORS, reply, requireUser } from "../_shared/painel.ts";

const CAMPOS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";

// Formato que o painel usa
function formatar(p: any) {
  return {
    id: p.id,
    legenda: (p.caption ?? "").slice(0, 120),
    tipo: p.media_type,
    // vídeo usa a thumbnail; foto e carrossel usam a própria mídia
    miniatura: p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url,
    link: p.permalink,
    data: p.timestamp,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const userId = await requireUser(req);
  if (!userId) return reply({ ok: false, erro: "não autorizado" }, 401);

  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }
  const conta = await contaDoUsuario(userId, String(corpo.conta_id ?? ""));
  if (!conta) return reply({ ok: false, posts: [], erro: "Sem acesso a esta conta, ou conta sem token." });

  const ids: string[] = (corpo.ids ?? []).map(String).filter((s: string) => /^\d+$/.test(s));

  // Posts específicos (no máximo 50 por chamada)
  if (ids.length) {
    const resultados = await Promise.all(
      [...new Set(ids)].slice(0, 50).map((id) => graphGet(conta.token, `/${id}`, { fields: CAMPOS })),
    );
    const posts = resultados.filter((r) => r.ok).map((r) => formatar(r.data));
    return reply({ ok: true, posts });
  }

  // Posts mais recentes
  const r = await graphGet(conta.token, `/${conta.ig_user_id}/media`, { fields: CAMPOS, limit: "50" });
  if (!r.ok) return reply({ ok: false, posts: [], erro: r.error?.message ?? "falha ao listar posts" });
  return reply({ ok: true, posts: (r.data?.data ?? []).map(formatar) });
});
