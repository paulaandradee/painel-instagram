// =====================================================================
// enviar-resposta: manda pelo direct o texto que VOCÊ revisou no painel.
// Recebe { conversa_id, texto, sugestao_id? }.
// - Só quem está logado e tem acesso à conta.
// - Respeita a janela de 24h da Meta: passou de 24h desde a última
//   mensagem da cliente, devolve erro e não envia.
// - Salva a mensagem enviada com autor "eu".
// =====================================================================
import { contaDoUsuario, CORS, reply, requireUser } from "../_shared/painel.ts";
import { db, graphPost } from "../_shared/ig.ts";
import { Conversa, gravarMensagem } from "../_shared/conversas.ts";

const JANELA_MS = 24 * 3600 * 1000;
const TEXTO_MAX = 1000; // limite do Instagram por mensagem

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, erro: "use POST" }, 405);

  const userId = await requireUser(req);
  if (!userId) return reply({ ok: false, erro: "Faça login de novo." }, 401);

  let body: any;
  try { body = await req.json(); } catch { return reply({ ok: false, erro: "Pedido inválido." }, 400); }
  const conversaId = String(body?.conversa_id ?? "");
  const texto = String(body?.texto ?? "").trim();
  const sugestaoId = body?.sugestao_id ? String(body.sugestao_id) : null;

  if (!conversaId) return reply({ ok: false, erro: "Falta a conversa." }, 400);
  if (!texto) return reply({ ok: false, erro: "A mensagem está vazia." }, 400);
  if (texto.length > TEXTO_MAX) return reply({ ok: false, erro: `A mensagem passou de ${TEXTO_MAX} caracteres.` }, 400);

  const { data: conversa } = await db.from("conversas").select("*").eq("id", conversaId).maybeSingle();
  if (!conversa) return reply({ ok: false, erro: "Conversa não encontrada." }, 404);

  const conta = await contaDoUsuario(userId, conversa.conta_id);
  if (!conta) return reply({ ok: false, erro: "Você não tem acesso a esta conta." }, 403);

  // Janela de 24h: conta a partir da última mensagem DA CLIENTE
  const ultimaCliente = conversa.ultima_do_cliente_em ? new Date(conversa.ultima_do_cliente_em).getTime() : 0;
  if (!ultimaCliente || Date.now() - ultimaCliente > JANELA_MS) {
    return reply({
      ok: false,
      codigo: "janela_24h",
      erro: "Passaram mais de 24h desde a última mensagem da cliente. O Instagram não deixa enviar: espere ela escrever de novo.",
    }, 409);
  }

  const r = await graphPost(conta.token, "/me/messages", {
    recipient: { id: conversa.instagram_user_id },
    message: { text: texto },
  });
  if (!r.ok) {
    console.error("[enviar-resposta] Instagram recusou:", JSON.stringify(r.error));
    // 10 / 2534022 = fora da janela de mensagens, pelo lado da Meta
    const foraDaJanela = Number(r.error?.code) === 10 || Number(r.error?.error_subcode) === 2534022;
    return reply({
      ok: false,
      codigo: foraDaJanela ? "janela_24h" : "instagram",
      erro: foraDaJanela
        ? "O Instagram recusou: a janela de 24h dessa conversa está fechada."
        : `O Instagram recusou o envio: ${r.error?.message ?? "erro desconhecido"}`,
    }, 502);
  }

  const mid: string | null = r.data?.message_id ?? null;
  await gravarMensagem(conversa as Conversa, "eu", texto, mid, new Date());
  if (sugestaoId) await db.from("sugestoes").update({ usada: true }).eq("id", sugestaoId).eq("conversa_id", conversa.id);

  return reply({ ok: true, message_id: mid });
});
