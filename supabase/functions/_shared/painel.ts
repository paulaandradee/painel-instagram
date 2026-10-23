// =====================================================================
// _shared/painel.ts
// Ajudas pras funções chamadas pelo PAINEL (ig-insights, ig-media,
// ig-repescagem, painel-admin): CORS, quem está logado e se essa pessoa
// tem acesso à conta pedida.
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Conta, contaPorId, db, ENV } from "./ig.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Devolve o id de quem está logado no painel (ou null).
// A chave anônima sozinha não basta.
export async function requireUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const client = createClient(ENV.SUPABASE_URL, ENV.SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(jwt);
  return !error && data?.user ? data.user.id : null;
}

export async function ehAdmin(userId: string): Promise<boolean> {
  const { data } = await db.from("painel_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}

// Acesso só de visualização (tabela painel_leitores): vê tudo, não altera nada
export async function ehLeitor(userId: string): Promise<boolean> {
  const { data } = await db.from("painel_leitores").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}
export const SO_LEITURA = "Seu acesso é só de visualização.";

// A conta, se a pessoa tiver acesso a ela (membro); senão null
export async function contaDoUsuario(userId: string, contaId: string): Promise<Conta | null> {
  if (!contaId) return null;
  const { data } = await db.from("ig_membros").select("conta_id").eq("user_id", userId).eq("conta_id", contaId).maybeSingle();
  if (!data) return null;
  return contaPorId(contaId);
}

export function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
