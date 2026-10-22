// =====================================================================
// _shared/conversas.ts
// Caixa de entrada com SUGESTÃO de resposta:
// - gravarMensagem: salva a mensagem (cliente ou eu) e cria a conversa
// - gerarSugestao: monta o histórico + roteiro, esconde os dados pessoais
//   e pede UMA sugestão ao Gemini. Só SUGERE: nada é enviado aqui.
// =====================================================================
import { Conta, db, graphGet } from "./ig.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// O nome do modelo muda com frequência: troque pelo secret GEMINI_MODEL se precisar.
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";

const HISTORICO = 20;          // últimas N mensagens mandadas pra IA
const ESPERA_AGRUPAR_MS = 4000; // cliente manda 3 mensagens seguidas = 1 sugestão só

export type Conversa = {
  id: string; conta_id: string; instagram_user_id: string; nome: string | null; username: string | null;
  ultima_do_cliente_em: string | null;
};

// Acha (ou cria) a conversa da pessoa. Na criação, tenta buscar nome e @.
export async function conversaDe(conta: Conta, igUserId: string): Promise<Conversa | null> {
  const { data: existe } = await db.from("conversas").select("*")
    .eq("conta_id", conta.id).eq("instagram_user_id", igUserId).maybeSingle();
  if (existe) return existe as Conversa;

  // A API só libera o perfil depois que a pessoa mandou mensagem: melhor esforço
  const perfil = await graphGet(conta.token, `/${igUserId}`, { fields: "name,username" });
  const { data, error } = await db.from("conversas").upsert({
    conta_id: conta.id,
    instagram_user_id: igUserId,
    nome: perfil.ok ? perfil.data?.name ?? null : null,
    username: perfil.ok ? perfil.data?.username ?? null : null,
  }, { onConflict: "conta_id,instagram_user_id" }).select().single();
  if (error) { console.error("[conversa] não criou:", error.message); return null; }
  return data as Conversa;
}

// Salva uma mensagem. Devolve o id, ou null se ela já estava salva
// (o mesmo "mid" chega de novo como eco ou reenvio do Meta).
export async function gravarMensagem(
  conversa: Conversa, autor: "cliente" | "eu", texto: string, mid: string | null, quando: Date,
): Promise<string | null> {
  const linha = {
    conversa_id: conversa.id, conta_id: conversa.conta_id, autor, texto,
    criada_em: quando.toISOString(), instagram_message_id: mid,
  };
  const { data, error } = await db.from("mensagens")
    .upsert(linha, { onConflict: "instagram_message_id", ignoreDuplicates: true })
    .select("id").maybeSingle();
  if (error) { console.error("[mensagem] não gravou:", error.message); return null; }
  return data?.id ?? null;
}

// Texto que vai pro histórico quando a mensagem não é só texto
export function textoDoEvento(msg: any, postback: any): string {
  if (msg?.text) return String(msg.text);
  if (postback?.title) return `[tocou no botão: ${postback.title}]`;
  const tipo = msg?.attachments?.[0]?.type;
  if (tipo) return `[${{ image: "imagem", video: "vídeo", audio: "áudio", file: "arquivo", share: "post compartilhado", story_mention: "menção no story" }[tipo as string] ?? "anexo"}]`;
  if (msg?.attachment || msg?.is_echo) return "[mensagem automática]";
  return "";
}

// ---------- Anonimização: nada de nome, @, e-mail ou telefone pra IA ----------
const escRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function anonimizar(texto: string, conversa: Pick<Conversa, "nome" | "username">): string {
  let t = texto;
  const termos = new Set<string>();
  if (conversa.username) { termos.add(`@${conversa.username}`); termos.add(conversa.username); }
  if (conversa.nome) {
    termos.add(conversa.nome);
    // cada parte do nome ("Ana", "Souza"), menos as curtinhas ("de", "da")
    for (const parte of conversa.nome.split(/\s+/)) if (parte.length >= 3) termos.add(parte);
  }
  // os mais longos primeiro: "Ana Souza" antes de "Ana"
  for (const termo of [...termos].sort((a, b) => b.length - a.length)) {
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}_.])${escRegex(termo)}(?![\\p{L}\\p{N}_])`, "giu"), "Cliente");
  }
  return t
    .replace(/@[A-Za-z0-9._]{2,30}/g, "@perfil")                      // outros @
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/g, "[e-mail]")
    .replace(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g, "[telefone]");
}

// A IA escreve [nome]; aqui, já fora do Google, entra o primeiro nome.
// Sem nome conhecido, o marcador sai ("Oiii, [nome]!" vira "Oiii!").
const MARCADOR_NOME = /\[(?:primeiro\s+)?nome\]/gi;

export function colocarNome(texto: string, nome: string | null): string {
  const primeiro = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (primeiro) {
    const bonito = primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
    return texto.replace(MARCADOR_NOME, bonito);
  }
  return texto
    .replace(/,?[ \t]*\[(?:primeiro\s+)?nome\][ \t]*(?=[!?.,])/gi, "")
    .replace(MARCADOR_NOME, "")
    .replace(/^[ \t]*,[ \t]*/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// ---------- Gemini ----------
async function chamarGemini(sistema: string, pedido: string): Promise<string | null> {
  if (!GEMINI_API_KEY) { console.warn("[sugestão] falta o secret GEMINI_API_KEY"); return null; }
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sistema }] },
        contents: [{ role: "user", parts: [{ text: pedido }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("[sugestão] Gemini recusou:", r.status, JSON.stringify(data?.error ?? data)); return null; }
    const texto = (data?.candidates?.[0]?.content?.parts ?? [])
      .filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("").trim();
    // tira aspas e rótulos que o modelo às vezes coloca em volta
    return texto.replace(/^(resposta|sugest[aã]o|voc[eê])\s*:\s*/i, "").replace(/^["“]|["”]$/g, "").trim() || null;
  } catch (e) {
    console.error("[sugestão] erro ao chamar o Gemini:", e);
    return null;
  }
}

// Gera e salva UMA sugestão pra conversa. Roda em segundo plano depois que
// a mensagem da cliente chega. mensagemId = a mensagem que disparou.
export async function gerarSugestao(conversa: Conversa, mensagemId: string) {
  // Espera um pouco: se ela mandar outra mensagem nesse meio-tempo, só a última gera sugestão
  await new Promise((r) => setTimeout(r, ESPERA_AGRUPAR_MS));
  const { data: ultima } = await db.from("mensagens").select("id")
    .eq("conversa_id", conversa.id).order("criada_em", { ascending: false }).limit(1).maybeSingle();
  if (ultima?.id !== mensagemId) return;

  const [{ data: msgs }, { data: roteiro }] = await Promise.all([
    db.from("mensagens").select("autor, texto").eq("conversa_id", conversa.id)
      .order("criada_em", { ascending: false }).limit(HISTORICO),
    db.from("abordagem").select("texto").eq("conta_id", conversa.conta_id).maybeSingle(),
  ]);
  if (!msgs?.length) return;

  const historico = [...msgs].reverse()
    .map((m) => `${m.autor === "cliente" ? "Cliente" : "Atendente"}: ${anonimizar(m.texto, conversa)}`)
    .join("\n");

  const sistema = [
    "Você ajuda o time a responder mensagens do direct do Instagram.",
    "Escreva UMA sugestão de resposta para a Atendente mandar agora à Cliente.",
    "Regras:",
    "- Português do Brasil, curta (de preferência até 3 frases; mais só quando o roteiro pedir uma explicação), natural, como uma pessoa digitando no direct.",
    "- Siga o tom e as orientações do roteiro de atendimento abaixo.",
    "- Não invente preços, prazos, links ou informações que não estejam no roteiro ou na conversa. Se faltar informação, faça uma pergunta ou diga que vai verificar.",
    "- O nome da pessoa foi removido de propósito. Para chamá-la pelo nome, escreva exatamente [nome] (ele é preenchido depois). Nunca escreva \"Cliente\" na resposta.",
    "- Devolva só o texto da mensagem, sem aspas, sem explicações, sem opções alternativas.",
    "",
    "ROTEIRO DE ATENDIMENTO DO TIME:",
    (roteiro?.texto ?? "").trim() || "(sem roteiro cadastrado: seja cordial, objetiva e prestativa)",
  ].join("\n");

  const pedido = `Conversa até agora (da mais antiga para a mais recente):\n\n${historico}\n\nEscreva a próxima mensagem da Atendente.`;

  const bruta = await chamarGemini(sistema, pedido);
  if (!bruta) return;
  const sugestao = colocarNome(bruta, conversa.nome);
  const { error } = await db.from("sugestoes").insert({
    conversa_id: conversa.id, conta_id: conversa.conta_id, texto_sugerido: sugestao,
  });
  if (error) console.error("[sugestão] não gravou:", error.message);
}
