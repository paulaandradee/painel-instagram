// =====================================================================
// ig-token-refresh: renova o token long-lived (~60 dias)
// Roda ~1x por semana via pg_cron. Protegido por x-sched-key.
// Atenção: o endpoint de renovação NÃO leva a versão no caminho.
// =====================================================================
import { checkSchedKey, db, getToken, json } from "../_shared/ig.ts";

Deno.serve(async (req) => {
  if (!checkSchedKey(req)) return json({ ok: false, erro: "não autorizado" }, 401);

  const token = await getToken();
  const now = new Date().toISOString();

  try {
    const qs = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token });
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?${qs}`);
    const data = await r.json();

    if (!r.ok || !data?.access_token) {
      const erro = data?.error?.message ?? JSON.stringify(data);
      await db.from("ig_token_status").upsert({ id: "main", last_ok: false, last_error: erro, updated_at: now });
      return json({ ok: false, erro }, 500);
    }

    const expiresAt = new Date(Date.now() + Number(data.expires_in ?? 0) * 1000).toISOString();

    // Guarda o token novo (as funções passam a usar este)
    await db.from("ig_token_store").upsert({ id: "main", access_token: data.access_token, updated_at: now });
    await db.from("ig_token_status").upsert({
      id: "main", expires_at: expiresAt, last_ok: true, last_error: null, last_refreshed_at: now, updated_at: now,
    });

    return json({ ok: true, expires_at: expiresAt });
  } catch (e) {
    await db.from("ig_token_status").upsert({ id: "main", last_ok: false, last_error: String(e), updated_at: now });
    return json({ ok: false, erro: String(e) }, 500);
  }
});
