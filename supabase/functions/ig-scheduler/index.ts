// =====================================================================
// ig-scheduler: o CARTEIRO (roda a cada 1 minuto via pg_cron)
// 1) Esvazia a fila do freio (ig_send_queue), cada conta com o seu freio
// 2) Manda os passos com atraso que já venceram (ig_scheduled)
// Protegido pelo header x-sched-key = SCHED_SECRET.
// =====================================================================
import {
  Automation, checkSchedKey, confirmarPeloEco, db, findStep, firstStep, json, logDelivery, recordResult,
  replyToComment, saiuDesde, sendStep, takeSlot, upsertLead,
} from "../_shared/ig.ts";

const MAX_TENTATIVAS = 2;   // erro claro (não ambíguo): no máximo 2 tentativas
const PAUSA_MIN_MS = 8000;  // entre um envio e outro da fila: 8 a 25s, sorteado
const PAUSA_MAX_MS = 25000; // (rajada certinha parece robô pro Instagram)
const SETE_DIAS_MS = 7 * 24 * 3600 * 1000; // resposta a comentário só vale ~7 dias

async function drainQueue() {
  const resumo = { enviados: 0, erros: 0, expirados: 0, segurados: 0 };
  const { data: itens } = await db.from("ig_send_queue")
    .select("*").eq("status", "pendente").order("created_at", { ascending: true }).limit(30);

  // Contas cujo freio já disse "não" neste minuto: pula só elas
  const travadas = new Set<string>();

  let jaEnviou = false;
  for (const item of itens ?? []) {
    if (travadas.has(item.conta_id)) { resumo.segurados++; continue; }

    // Comentário velho demais: o Instagram não aceita mais resposta privada.
    // Conta a partir do comentário (repescagem) ou de quando entrou na fila.
    if (Date.now() - new Date(item.comment_ts ?? item.created_at).getTime() > SETE_DIAS_MS) {
      await db.from("ig_send_queue").update({ status: "expirado" }).eq("id", item.id);
      resumo.expirados++;
      continue;
    }

    // Pede ficha ao freio DA CONTA. Sem ficha, tenta essa conta no próximo minuto.
    if (!(await takeSlot(item.conta_id))) { travadas.add(item.conta_id); resumo.segurados++; continue; }

    // "Reserva" o item: se outra rodada já pegou, pula (nada sai em dobro)
    const { data: reservado } = await db.from("ig_send_queue")
      .update({ status: "enviando" }).eq("id", item.id).eq("status", "pendente").select("id");
    if (!reservado?.length) continue;

    const { data: auto } = await db.from("ig_automations").select("*").eq("id", item.automation_id).maybeSingle();
    const step = auto ? firstStep(auto as Automation) : null;
    if (!auto || !step) {
      await db.from("ig_send_queue").update({ status: "erro", last_error: "automação ou passo 0 não encontrado" }).eq("id", item.id);
      resumo.erros++;
      continue;
    }

    // Já saiu uma mensagem pra essa pessoa desde que entrou na fila? Não manda de novo.
    if (await saiuDesde(item.conta_id, item.ig_user_id, item.created_at)) {
      await recordResult(item.conta_id, true, false); // devolve a ficha como uso normal
      await db.from("ig_send_queue").update({ status: "enviado", last_error: "já tinha saído (eco)" }).eq("id", item.id);
      continue;
    }

    // Espaça os envios com um intervalo sorteado
    if (jaEnviou) await new Promise((ok) => setTimeout(ok, PAUSA_MIN_MS + Math.random() * (PAUSA_MAX_MS - PAUSA_MIN_MS)));
    jaEnviou = true;

    const inicio = new Date(Date.now() - 5000).toISOString();
    const r = await sendStep(auto as Automation, step, { comment_id: item.comment_id }, item.ig_user_id);

    // Erro ambíguo: a DM pode ter saído. Confere pelo eco e NUNCA tenta de novo.
    if (!r.ok && r.ambiguo) {
      const saiu = await confirmarPeloEco(item.conta_id, item.ig_user_id, inicio);
      await recordResult(item.conta_id, saiu, false);
      await logDelivery({
        conta_id: item.conta_id, ig_user_id: item.ig_user_id, automation_id: auto.id, canal: "private_reply", tipo: r.tipo,
        status: saiu ? "ok" : "incerto", motivo: `fila: ${saiu ? "entregue (confirmado pelo eco)" : "sem confirmação"}; Instagram: ${r.error}`,
      });
      await db.from("ig_send_queue").update({
        status: saiu ? "enviado" : "incerto", tentativas: (item.tentativas ?? 0) + 1, last_error: r.error,
        ...(saiu ? { sent_at: new Date().toISOString() } : {}),
      }).eq("id", item.id);
      if (saiu) {
        await upsertLead(item.conta_id, item.ig_user_id, { username: item.username, last_source: "comment" });
        if (item.responder_publico) await replyToComment(auto as Automation, item.comment_id);
        resumo.enviados++;
      } else resumo.erros++;
      continue;
    }

    await recordResult(item.conta_id, r.ok, r.hard);
    await logDelivery({
      conta_id: item.conta_id, ig_user_id: item.ig_user_id, automation_id: auto.id, canal: "private_reply", tipo: r.tipo,
      status: r.ok ? "ok" : "erro", motivo: r.error ? `fila: ${r.error}` : "fila",
    });

    if (r.ok) {
      await db.from("ig_send_queue").update({ status: "enviado", sent_at: new Date().toISOString() }).eq("id", item.id);
      await upsertLead(item.conta_id, item.ig_user_id, { username: item.username, last_source: "comment" });
      // Responde no comentário junto com a DM (fila do freio ou repescagem)
      if (item.responder_publico) await replyToComment(auto as Automation, item.comment_id);
      resumo.enviados++;
    } else {
      const tentativas = (item.tentativas ?? 0) + 1;
      await db.from("ig_send_queue").update({
        tentativas, last_error: r.error, status: tentativas >= MAX_TENTATIVAS ? "erro" : "pendente",
      }).eq("id", item.id);
      resumo.erros++;
      if (r.hard) travadas.add(item.conta_id); // bloqueio: para de insistir nesta conta agora
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
    await logDelivery({ conta_id: job.conta_id, ig_user_id: job.ig_user_id, automation_id: auto.id, canal: "dm", tipo: r.tipo, status: r.ok ? "ok" : "erro", motivo: r.error ?? "passo com atraso" });
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
