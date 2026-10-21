// =====================================================================
// _shared/painel.ts
// Ajudas pras funções chamadas pelo PAINEL (ig-insights, ig-media):
// CORS e checagem de que quem chama está logado.
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ENV } from "./ig.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Só deixa passar quem está logado no painel (a chave anônima sozinha não basta)
export async function requireUser(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const client = createClient(ENV.SUPABASE_URL, ENV.SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(jwt);
  return !error && !!data?.user;
}

export function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
