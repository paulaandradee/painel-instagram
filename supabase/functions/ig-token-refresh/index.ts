// =====================================================================
// ig-token-refresh: renova o token long-lived (~60 dias) de CADA conta
// Roda ~1x por semana via pg_cron. Protegido por x-sched-key.
// Atenção: o endpoint de renovação NÃO leva a versão no caminho.
// =====================================================================
import { checkSchedKey, db, json, todasContas } from "../_shared/ig.ts";

Deno.serve(async (req) => {
  if (!checkSchedKey(req)) return json({ ok: false, erro: "não autorizado" }, 401);

  const resultado: Record<string, unknown> = {};
  for (const conta of await todasContas()) {
    const now = new Date().toISOString();
    try {
      const qs = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: conta.token });
      const r = await fetch(`https://graph.instagram.com/refresh_access_token?${qs}`);
      const data = await r.json();

      if (!r.ok || !data?.access_token) {
        const erro = data?.error?.message ?? JSON.stringify(data);
        await db.from("ig_contas").update({ token_ok: false, token_erro: erro }).eq("id", conta.id);
        resultado[conta.username ?? conta.id] = { ok: false, erro };
        continue;
      }

      const expiraEm = new Date(Date.now() + Number(data.expires_in ?? 0) * 1000).toISOString();
      await db.from("ig_contas_token").upsert({ conta_id: conta.id, access_token: data.access_token, updated_at: now });
      await db.from("ig_contas").update({
        token_expira_em: expiraEm, token_ok: true, token_erro: null, token_renovado_em: now,
      }).eq("id", conta.id);
      resultado[conta.username ?? conta.id] = { ok: true, expira_em: expiraEm };
    } catch (e) {
      await db.from("ig_contas").update({ token_ok: false, token_erro: String(e) }).eq("id", conta.id);
      resultado[conta.username ?? conta.id] = { ok: false, erro: String(e) };
    }
  }
  return json({ ok: true, contas: resultado });
});
