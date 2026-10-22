// =====================================================================
// _shared/conversas.ts
// Caixa de entrada com SUGESTÃO de resposta:
// - gravarMensagem: salva a mensagem (cliente ou eu) e cria a conversa
// - gerarSugestao: monta o histórico + roteiro, esconde os dados pessoais
//   e pede UMA sugestão ao Gemini. Só SUGERE: nada é enviado aqui.
// =====================================================================
import { Conta, db, graphGet } from "./ig.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// Opcional: força um modelo na frente da fila (secret GEMINI_MODEL). Sem ele,
// a fila é montada sozinha: Flash > Flash-Lite > Gemma (ver "Gemini" abaixo).
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "";

const HISTORICO = 20;          // últimas N mensagens mandadas pra IA
const ESPERA_AGRUPAR_MS = 4000; // cliente manda 3 mensagens seguidas = 1 sugestão só

export type Conversa = {
  id: string; conta_id: string; instagram_user_id: string; nome: string | null; username: string | null;
  ultima_do_cliente_em: string | null;
};

// Acha (ou cria) a conversa da pessoa. Na criação, usa o perfil recebido
// ou tenta buscar nome e @ na API.
export async function conversaDe(
  conta: Conta, igUserId: string, perfilConhecido?: { nome?: string | null; username?: string | null },
): Promise<Conversa | null> {
  const { data: existe } = await db.from("conversas").select("*")
    .eq("conta_id", conta.id).eq("instagram_user_id", igUserId).maybeSingle();
  if (existe) return existe as Conversa;

  let nome = perfilConhecido?.nome ?? null;
  let username = perfilConhecido?.username ?? null;
  if (!nome) {
    // A API só libera o perfil depois que a pessoa mandou mensagem: melhor esforço
    const perfil = await graphGet(conta.token, `/${igUserId}`, { fields: "name,username" });
    if (perfil.ok) { nome = perfil.data?.name ?? null; username = username ?? perfil.data?.username ?? null; }
  }
  const { data, error } = await db.from("conversas").upsert({
    conta_id: conta.id, instagram_user_id: igUserId, nome, username,
  }, { onConflict: "conta_id,instagram_user_id" }).select().single();
  if (error) { console.error("[conversa] não criou:", error.message); return null; }
  return data as Conversa;
}

export type Midia = { tipo: string; url: string | null };

// Salva uma mensagem. Devolve o id, ou null se ela já estava salva
// (o mesmo "mid" chega de novo como eco ou reenvio do Meta).
export async function gravarMensagem(
  conversa: Conversa, autor: "cliente" | "eu", texto: string, mid: string | null, quando: Date, midia?: Midia | null,
): Promise<string | null> {
  const linha = {
    conversa_id: conversa.id, conta_id: conversa.conta_id, autor, texto,
    criada_em: quando.toISOString(), instagram_message_id: mid,
    midia_tipo: midia?.tipo ?? null, midia_url: midia?.url ?? null,
  };
  const { data, error } = await db.from("mensagens")
    .upsert(linha, { onConflict: "instagram_message_id", ignoreDuplicates: true })
    .select("id").maybeSingle();
  if (error) { console.error("[mensagem] não gravou:", error.message); return null; }
  return data?.id ?? null;
}

const NOMES_ANEXO: Record<string, string> = {
  image: "imagem", video: "vídeo", audio: "áudio", file: "arquivo", share: "post compartilhado",
  story_mention: "menção no story", ig_reel: "reels", reel: "reels", like_heart: "❤️", sticker: "figurinha",
};

// Texto que vai pro histórico quando a mensagem não é só texto
export function textoDoEvento(msg: any, postback: any): string {
  if (msg?.text) return String(msg.text);
  if (postback?.title) return `[tocou no botão: ${postback.title}]`;
  const tipo = msg?.attachments?.[0]?.type;
  if (tipo === "like_heart") return "❤️";
  if (tipo) return `[${NOMES_ANEXO[tipo as string] ?? "anexo"}]`;
  if (msg?.attachment || msg?.is_echo) return "[mensagem automática]";
  return "";
}

// A mídia do evento (pro painel mostrar a foto, o áudio...). Os links do
// Instagram expiram depois de um tempo; aí o painel mostra só o texto.
export function midiaDoEvento(msg: any): Midia | null {
  const a = msg?.attachments?.[0];
  if (!a?.type) return null;
  const url = a.payload?.url ?? null;
  if (a.type === "like_heart") return { tipo: "like_heart", url: null };
  if (!url) return null;
  return { tipo: a.type, url };
}

// ---------- Anonimização: nada de nome, @, e-mail ou telefone pra IA ----------
const escRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function anonimizar(texto: string, conversa: Pick<Conversa, "nome" | "username">): string {
  // e-mail e telefone primeiro (senão o nome dentro do e-mail vira "Cliente@...")
  let t = texto
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail]")
    .replace(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g, "[telefone]");
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
  return t.replace(/@[A-Za-z0-9._]{2,30}/g, "@perfil"); // outros @
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
  const limpo = texto
    .replace(/,?[ \t]*\[(?:primeiro\s+)?nome\]/gi, "")   // "Oiii, [nome]!" vira "Oiii!"
    .replace(/^[ \t]*,[ \t]*/gm, "")                      // "[Nome], eu ouvi" vira "eu ouvi"
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

// ---------- Gemini ----------
// O plano gratuito tem cota pequena por modelo (o Flash dá só umas dezenas
// por dia). Por isso há uma fila de modelos: o melhor primeiro e, quando um
// estoura a cota, o próximo. Os nomes vêm da lista do próprio Google (eles
// mudam com frequência); GEMINI_MODEL, se existir, vai na frente.
const API = "https://generativelanguage.googleapis.com/v1beta";
const PAUSA_COTA_MS = 15 * 60 * 1000;          // modelo que estourou fica de lado por 15 min
const descansando = new Map<string, number>(); // modelo -> até quando
let cadeia: string[] | null = null;
let motivoFalha: "limite" | "erro" | null = null;

// Por que a última sugestão falhou (o painel mostra um aviso melhor)
export const ultimaFalha = () => motivoFalha;

const versao = (n: string) => (n.match(/\d+(\.\d+)?/)?.[0] ?? "0").split(".").map(Number);
const maisNovo = (a: string, b: string) => {
  const [x, y] = [versao(a), versao(b)];
  return (y[0] - x[0]) || ((y[1] ?? 0) - (x[1] ?? 0));
};

async function modelos(): Promise<string[]> {
  if (cadeia) return cadeia;
  let nomes: string[] = [];
  try {
    const r = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": GEMINI_API_KEY } });
    const data = await r.json().catch(() => ({}));
    nomes = (data?.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m: any) => String(m.name).replace(/^models\//, ""));
  } catch (e) { console.warn("[sugestão] não listou os modelos:", e); }
  const tem = (n: string) => nomes.includes(n);
  const flash = tem("gemini-flash-latest") ? "gemini-flash-latest"
    : nomes.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort(maisNovo)[0];
  const lite = tem("gemini-flash-lite-latest") ? "gemini-flash-lite-latest"
    : nomes.filter((n) => /^gemini-[\d.]+-flash-lite$/.test(n)).sort(maisNovo)[0];
  // Gemma: o maior da versão mais nova (ex.: gemma-3-27b-it)
  const tamanho = (n: string) => Number(n.match(/-(\d+)b-/)?.[1] ?? 0);
  const gemma = nomes.filter((n) => /^gemma-\d.*-it$/.test(n))
    .sort((a, b) => maisNovo(a, b) || tamanho(b) - tamanho(a))[0];
  // sem a lista (falhou), usa os apelidos que o Google mantém
  cadeia = [...new Set([
    GEMINI_MODEL, flash || "gemini-flash-latest", lite || (nomes.length ? "" : "gemini-flash-lite-latest"), gemma,
  ].filter(Boolean) as string[])];
  console.log("[sugestão] modelos na fila:", cadeia.join(" > "));
  return cadeia;
}

// Um pedido a UM modelo. Devolve o texto, "pular" (cota, fora do ar, modelo
// inexistente: tenta o próximo) ou null (resposta vazia).
async function pedirAoModelo(modelo: string, sistema: string, pedido: string): Promise<string | "pular" | null> {
  // Gemma não aceita instrução de sistema: vai junto do pedido
  const ehGemma = modelo.startsWith("gemma");
  const corpo = ehGemma
    ? { contents: [{ role: "user", parts: [{ text: `${sistema}\n\n---\n\n${pedido}` }] }] }
    : { system_instruction: { parts: [{ text: sistema }] }, contents: [{ role: "user", parts: [{ text: pedido }] }] };
  const r = await fetch(`${API}/models/${modelo}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    // Folga grande: os modelos Flash "pensam" antes e isso conta neste limite
    body: JSON.stringify({ ...corpo, generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const cota = r.status === 429;
    if (cota) descansando.set(modelo, Date.now() + PAUSA_COTA_MS);
    console.warn(`[sugestão] ${modelo} recusou (${r.status}${cota ? ", cota do plano gratuito" : ""}):`, JSON.stringify(data?.error?.message ?? data).slice(0, 200));
    motivoFalha = cota ? "limite" : motivoFalha ?? "erro";
    return "pular";
  }
  const texto = (data?.candidates?.[0]?.content?.parts ?? [])
    .filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("").trim();
  // tira aspas e rótulos que o modelo às vezes coloca em volta
  const limpo = texto.replace(/^(resposta|sugest[aã]o|voc[eê]|atendente)\s*:\s*/i, "").replace(/^["“]|["”]$/g, "").trim();
  if (!limpo) console.warn(`[sugestão] ${modelo} respondeu vazio:`, JSON.stringify(data?.candidates?.[0]?.finishReason ?? data?.promptFeedback ?? data).slice(0, 300));
  return limpo || null;
}

async function chamarGemini(sistema: string, pedido: string): Promise<string | null> {
  if (!GEMINI_API_KEY) { console.warn("[sugestão] falta o secret GEMINI_API_KEY"); motivoFalha = "erro"; return null; }
  motivoFalha = null;
  const lista = await modelos();
  // os que estão descansando vão pro fim (se todos estiverem, tenta mesmo assim)
  const agora = Date.now();
  const ordem = [...lista.filter((m) => (descansando.get(m) ?? 0) <= agora), ...lista.filter((m) => (descansando.get(m) ?? 0) > agora)];
  for (const modelo of ordem) {
    try {
      const r = await pedirAoModelo(modelo, sistema, pedido);
      if (r === "pular") continue;
      if (r) { motivoFalha = null; if (modelo !== lista[0]) console.log("[sugestão] saiu pelo modelo reserva", modelo); return r; }
    } catch (e) {
      console.error(`[sugestão] erro ao chamar ${modelo}:`, e);
      motivoFalha = motivoFalha ?? "erro";
    }
  }
  console.error("[sugestão] nenhum modelo conseguiu sugerir", ultimaFalha() === "limite" ? "(cota do plano gratuito esgotada)" : "");
  return null;
}

// Gera e salva UMA sugestão pra conversa. Devolve o texto (ou null).
// mensagemId = a mensagem que disparou (webhook): espera uns segundos e só
// segue se ela ainda for a última. Sem mensagemId (pedido do painel): na hora.
export async function gerarSugestao(conversa: Conversa, mensagemId: string | null): Promise<string | null> {
  console.log("[sugestão] começando, conversa", conversa.id);
  if (mensagemId) {
    // Se ela mandar outra mensagem nesse meio-tempo, só a última gera sugestão
    await new Promise((r) => setTimeout(r, ESPERA_AGRUPAR_MS));
    const { data: ultima } = await db.from("mensagens").select("id")
      .eq("conversa_id", conversa.id).order("criada_em", { ascending: false }).limit(1).maybeSingle();
    if (ultima?.id !== mensagemId) { console.log("[sugestão] pulada: chegou mensagem mais nova na conversa"); return null; }
  }

  const [{ data: msgs }, { data: roteiro }] = await Promise.all([
    db.from("mensagens").select("autor, texto").eq("conversa_id", conversa.id)
      .order("criada_em", { ascending: false }).limit(HISTORICO),
    db.from("abordagem").select("texto").eq("conta_id", conversa.conta_id).maybeSingle(),
  ]);
  if (!msgs?.length) return null;

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
  if (!bruta) return null;
  const sugestao = colocarNome(bruta, conversa.nome);
  const { error } = await db.from("sugestoes").insert({
    conversa_id: conversa.id, conta_id: conversa.conta_id, texto_sugerido: sugestao,
  });
  if (error) { console.error("[sugestão] não gravou:", error.message); return null; }
  console.log("[sugestão] salva");
  return sugestao;
}
