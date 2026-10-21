// =====================================================================
// ig-scheduler: o CARTEIRO (roda a cada 1 minuto via pg_cron)
// 1) Esvazia a fila do freio (ig_send_queue)
// 2) Manda os passos com atraso que já venceram (ig_scheduled)
// Protegido pelo header x-sched-key = SCHED_SECRET.
// =====================================================================
import {
  Automation, checkSchedKey, db, findStep, firstStep, json, logDelivery, recordResult,
  sendStep, takeSlot, upsertLead,
} from "../_shared/ig.ts";

const MAX_TENTATIVAS = 5;
const SETE_DIAS_MS = 7 * 24 * 3600 * 1000; // resposta a comentário só vale ~7 dias

async function drainQueue() {
  const resumo = { enviados: 0, erros: 0, expirados: 0, segurados: 0 };
  const { data: itens } = await db.from("ig_send_queue")
    .select("*").eq("status", "pendente").order("created_at", { ascending: true }).limit(20);

  for (const item of itens ?? []) {
    // Comentário velho demais: o Instagram não aceita mais resposta privada
    if (Date.now() - new Date(item.created_at).getTime() > SETE_DIAS_MS) {
      await db.from("ig_send_queue").update({ status: "expirado" }).eq("id", item.id);
      resumo.expirados++;
      continue;
    }

    // Pede ficha ao freio. Sem ficha, para por aqui (tenta no próximo minuto).
    if (!(await takeSlot())) { resumo.segurados++; break; }

    const { data: auto } = await db.from("ig_automations").select("*").eq("id", item.automation_id).maybeSingle();
    const step = auto ? firstStep(auto as Automation) : null;
    if (!auto || !step) {
      await db.from("ig_send_queue").update({ status: "erro", last_error: "automação ou passo 0 não encontrado" }).eq("id", item.id);
      resumo.erros++;
      continue;
    }

    const r = await sendStep(auto as Automation, step, { comment_id: item.comment_id }, item.ig_user_id);
    await recordResult(r.ok, r.hard);
    await logDelivery({
      ig_user_id: item.ig_user_id, automation_id: auto.id, canal: "private_reply", tipo: r.tipo,
      status: r.ok ? "ok" : "erro", motivo: r.error ? `fila: ${r.error}` : "fila",
    });

    if (r.ok) {
      await db.from("ig_send_queue").update({ status: "enviado", sent_at: new Date().toISOString() }).eq("id", item.id);
      await upsertLead(item.ig_user_id, { username: item.username, last_source: "comment" });
      resumo.enviados++;
    } else {
      const tentativas = (item.tentativas ?? 0) + 1;
      await db.from("ig_send_queue").update({
        tentativas, last_error: r.error, status: tentativas >= MAX_TENTATIVAS ? "erro" : "pendente",
      }).eq("id", item.id);
      resumo.erros++;
      if (r.hard) break; // bloqueio: para de insistir agora
    }
  }
  return resumo;
}

async function sendDueSteps() {
  let enviados = 0;
  const { data: due } = await db.from("ig_scheduled")
    .select("*").eq("sent", false).lte("send_at", new Date().toISOString()).limit(50);

  for (const job of due ?? []) {
    // "Reserva" o item antes de mandar, pra não mandar duas vezes
    const { data: claimed } = await db.from("ig_scheduled")
      .update({ sent: true }).eq("id", job.id).eq("sent", false).select("id");
    if (!claimed?.length) continue;

    const { data: auto } = await db.from("ig_automations").select("*").eq("id", job.automation_id).maybeSingle();
    const step = auto ? findStep(auto as Automation, job.step_id) : null;
    if (!auto || !step) continue;

    const r = await sendStep(auto as Automation, step, { id: job.ig_user_id }, job.ig_user_id);
    await logDelivery({ ig_user_id: job.ig_user_id, automation_id: auto.id, canal: "dm", tipo: r.tipo, status: r.ok ? "ok" : "erro", motivo: r.error ?? "passo com atraso" });
    if (r.ok) enviados++;
  }
  return enviados;
}

Deno.serve(async (req) => {
  if (!checkSchedKey(req)) return json({ ok: false, erro: "não autorizado" }, 401);
  const fila = await drainQueue();
  const atrasados = await sendDueSteps();
  return json({ ok: true, fila, atrasados });
});
