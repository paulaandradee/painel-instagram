// =====================================================================
// painel-admin: contas de Instagram e acessos (só para administradoras)
// Corpo (POST): { acao, ... }
// - "estado": lista contas, pessoas e quem acessa o quê
// - "conectar_conta": { token } valida o token, cadastra a conta e assina
//   os eventos (comentários, mensagens, botões) para o webhook
// - "criar_pessoa": { email, senha, contas: [ids], leitor }
// - "definir_acessos": { user_id, contas: [ids], leitor }
//   leitor = true: só visualização (vê tudo, não altera nada)
// - "remover_pessoa": { user_id }
// =====================================================================
import { db, graphGet, graphPost } from "../_shared/ig.ts";
import { CORS, ehAdmin, reply, requireUser } from "../_shared/painel.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function estado() {
  const [{ data: contas }, { data: membros }, { data: admins }, { data: leitores }, usuarios] = await Promise.all([
    db.from("ig_contas").select("id, username, nome, ativo, token_expira_em, token_ok, token_erro, criado_em").order("criado_em"),
    db.from("ig_membros").select("user_id, conta_id"),
    db.from("painel_admins").select("user_id"),
    db.from("painel_leitores").select("user_id"),
    db.auth.admin.listUsers({ perPage: 200 }),
  ]);
  const adm = new Set((admins ?? []).map((a: any) => a.user_id));
  const leit = new Set((leitores ?? []).map((a: any) => a.user_id));
  const pessoas = (usuarios.data?.users ?? []).map((u: any) => ({
    id: u.id,
    email: u.email,
    admin: adm.has(u.id),
    leitor: leit.has(u.id),
    ultimo_acesso: u.last_sign_in_at,
    contas: (membros ?? []).filter((m: any) => m.user_id === u.id).map((m: any) => m.conta_id),
  })).sort((a: any, b: any) => Number(b.admin) - Number(a.admin) || String(a.email).localeCompare(String(b.email)));
  return { ok: true, contas: contas ?? [], pessoas };
}

// Só aceita contas que existem
async function filtrarContas(ids: unknown): Promise<string[]> {
  const lista = Array.isArray(ids) ? ids.map(String) : [];
  if (!lista.length) return [];
  const { data } = await db.from("ig_contas").select("id").in("id", lista);
  return (data ?? []).map((c: any) => c.id);
}

async function definirAcessos(userId: string, contas: string[], leitor: boolean) {
  await db.from("ig_membros").delete().eq("user_id", userId);
  if (contas.length) await db.from("ig_membros").insert(contas.map((conta_id) => ({ user_id: userId, conta_id })));
  // administradora nunca fica só na visualização
  if (leitor && !(await ehAdmin(userId))) await db.from("painel_leitores").upsert({ user_id: userId });
  else await db.from("painel_leitores").delete().eq("user_id", userId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const userId = await requireUser(req);
  if (!userId) return reply({ ok: false, erro: "não autorizado" }, 401);
  if (!(await ehAdmin(userId))) return reply({ ok: false, erro: "Só administradoras podem fazer isso." }, 403);

  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }

  try {
    switch (corpo.acao) {
      case "estado":
        return reply(await estado());

      case "conectar_conta": {
        const token = String(corpo.token ?? "").trim();
        if (token.length < 20) return reply({ ok: false, erro: "Cole o token completo gerado no Meta for Developers." });
        const me = await graphGet(token, "/me", { fields: "user_id,username,name,account_type" });
        if (!me.ok || !me.data?.user_id) {
          return reply({ ok: false, erro: "O Instagram recusou esse token. Gere de novo no Meta for Developers e cole o token inteiro." });
        }
        if (!["BUSINESS", "MEDIA_CREATOR"].includes(String(me.data.account_type))) {
          return reply({ ok: false, erro: "Essa conta não é profissional. No Instagram, mude para conta comercial ou de criador." });
        }
        // cadastra (ou atualiza) a conta e guarda o token trancado
        const { data: conta, error } = await db.from("ig_contas").upsert({
          ig_user_id: String(me.data.user_id), app_scoped_id: String(me.data.id ?? ""),
          username: me.data.username, nome: me.data.name ?? me.data.username, ativo: true,
          token_ok: true, token_erro: null,
        }, { onConflict: "ig_user_id" }).select().single();
        if (error || !conta) return reply({ ok: false, erro: "Não foi possível salvar a conta: " + (error?.message ?? "") });
        await db.from("ig_contas_token").upsert({ conta_id: conta.id, access_token: token, updated_at: new Date().toISOString() });
        // quem conectou passa a ter acesso
        await db.from("ig_membros").upsert({ user_id: userId, conta_id: conta.id }, { onConflict: "user_id,conta_id", ignoreDuplicates: true });
        // assina os eventos para o webhook
        const sub = await graphPost(token, "/me/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks", {});
        return reply({
          ok: true, conta: { id: conta.id, username: conta.username },
          eventos_assinados: sub.ok,
          aviso: sub.ok ? "" : "A conta foi salva, mas os eventos não foram assinados: " + (sub.error?.message ?? "erro desconhecido"),
        });
      }

      case "criar_pessoa": {
        const email = String(corpo.email ?? "").trim().toLowerCase();
        const senha = String(corpo.senha ?? "");
        if (!EMAIL_RE.test(email)) return reply({ ok: false, erro: "E-mail inválido." });
        if (senha.length < 8) return reply({ ok: false, erro: "A senha precisa ter pelo menos 8 caracteres." });
        const { data, error } = await db.auth.admin.createUser({ email, password: senha, email_confirm: true });
        if (error || !data?.user) {
          const ja = /already|registered|exists/i.test(error?.message ?? "");
          return reply({ ok: false, erro: ja ? "Já existe uma pessoa com esse e-mail." : "Não foi possível criar: " + (error?.message ?? "") });
        }
        await definirAcessos(data.user.id, await filtrarContas(corpo.contas), corpo.leitor === true);
        return reply({ ok: true, user_id: data.user.id });
      }

      case "definir_acessos": {
        const alvo = String(corpo.user_id ?? "");
        if (!alvo) return reply({ ok: false, erro: "Pessoa não informada." });
        await definirAcessos(alvo, await filtrarContas(corpo.contas), corpo.leitor === true);
        return reply({ ok: true });
      }

      case "remover_pessoa": {
        const alvo = String(corpo.user_id ?? "");
        if (alvo === userId) return reply({ ok: false, erro: "Você não pode remover o seu próprio acesso." });
        if (await ehAdmin(alvo)) return reply({ ok: false, erro: "Não dá para remover uma administradora por aqui." });
        const { error } = await db.auth.admin.deleteUser(alvo);
        if (error) return reply({ ok: false, erro: "Não foi possível remover: " + error.message });
        return reply({ ok: true });
      }

      default:
        return reply({ ok: false, erro: "Ação desconhecida." }, 400);
    }
  } catch (e) {
    return reply({ ok: false, erro: "Erro inesperado: " + String(e) }, 500);
  }
});
