// =====================================================================
// app.js: login, menu, Início, Métricas, lista de automações e a
// camada de dados (Supabase ou, no modo de teste local, o navegador).
// =====================================================================

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// localStorage pode falhar (aba anônima, bloqueio): sempre com try/catch
const memoria = {
  ler(k, padrao) { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } },
  gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  apagar(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

// ---------- Ícones (SVG em linha, sem depender de nada) ----------
const ICONES = {
  raio: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  casa: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>',
  sair: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  voltar: '<path d="M15 18l-6-6 6-6"/>',
  lixo: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  lapis: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  imagem: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>',
  arquivo: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  grade: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  baixar: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  crm: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 16v-3M11 16v-6M15 16v-4M19 16V8"/><path d="M3 8h18"/>',
  notion: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h5"/>',
  cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  repescar: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  jardim: '<path d="M12 21v-8"/><path d="M12 17c-2.6-.2-4-1.4-4.6-3.2M12 16c2.4-.2 3.8-1.2 4.4-2.8"/><path d="M6.5 4c0 5 1.2 9 5.5 9s5.5-4 5.5-9c-1.6.5-2.8 1.3-3.4 2.4C13.4 5 12.8 4 12 3.2 11.2 4 10.6 5 10 6.4 9.4 5.3 8.1 4.5 6.5 4z"/>',
  pessoas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
};
function icone(nome) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome] ?? ""}</svg>`;
}
function pintarIcones(raiz = document) {
  $$("[data-icone]", raiz).forEach((el) => { if (!el.dataset.pintado) { el.innerHTML = icone(el.dataset.icone); el.dataset.pintado = "1"; } });
}

// ---------- Avisos (toast) e confirmação ----------
function aviso(texto, tipo = "") {
  const t = document.createElement("div");
  t.className = `toast ${tipo}`;
  t.textContent = texto;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), tipo === "atencao" ? 6500 : 3800);
}

function confirmar(titulo, texto, botaoOk = "Confirmar", perigo = false) {
  return new Promise((resolve) => {
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `
      <div class="cartao modal">
        <h3 class="subtitulo">${esc(titulo)}</h3>
        <p class="texto-2" style="margin:8px 0 20px">${esc(texto)}</p>
        <div class="linha" style="justify-content:flex-end">
          <button class="btn" data-r="0">Cancelar</button>
          <button class="btn ${perigo ? "btn-perigo" : "btn-primario"}" data-r="1">${esc(botaoOk)}</button>
        </div>
      </div>`;
    const fechar = (r) => { fundo.remove(); resolve(r); };
    fundo.addEventListener("click", (e) => {
      if (e.target === fundo) return fechar(false);
      const b = e.target.closest("[data-r]");
      if (b) fechar(b.dataset.r === "1");
    });
    document.body.appendChild(fundo);
    $("[data-r='1']", fundo).focus();
  });
}

// ---------- Modo: teste local ou produção ----------
const CFG = window.APP_CONFIG || {};
// No localhost, "?modo=producao" no endereço usa o Supabase de verdade (login e banco)
const FORCAR_PRODUCAO = new URLSearchParams(location.search).get("modo") === "producao";
const MODO_LOCAL = !FORCAR_PRODUCAO &&
  (location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname));
const SUPABASE_CONFIGURADO =
  /^https:\/\//.test(CFG.SUPABASE_URL || "") && !/SEU_|SUA_/.test(`${CFG.SUPABASE_URL}${CFG.SUPABASE_ANON_KEY}`);

let sb = null;
try {
  if (SUPABASE_CONFIGURADO && window.supabase?.createClient) sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
} catch (e) { console.warn("Supabase não iniciou:", e); }

const App = {
  usuario: null,
  remoto: false, // true = lê e grava no Supabase; false = modo de teste local (navegador)
  contas: [],    // contas de Instagram que esta pessoa pode ver
  conta: null,   // a conta escolhida no momento
  admin: false,  // administradora: conecta contas e libera pessoas
};

// Filtra uma consulta pela conta, se houver
const daConta = (consulta, contaId) => (contaId ? consulta.eq("conta_id", contaId) : consulta);

// =====================================================================
// CAMADA DE DADOS: toda chamada é tolerante a falha
// =====================================================================
const CHAVE_AUTOS_LOCAL = "teste_local_automacoes";
const CHAVE_ARQS_LOCAL = "teste_local_arquivos";
const CHAVE_LEADS_LOCAL = "teste_local_leads";

const Dados = {
  // Contas que a pessoa pode ver (o banco só devolve as liberadas pra ela)
  async contas() {
    if (!App.remoto) return [{ id: "local", username: "sua_conta", nome: "Conta de teste" }];
    const { data } = await sb.from("ig_contas").select("id, username, nome, ativo").eq("ativo", true).order("criado_em");
    return data ?? [];
  },

  async souAdmin() {
    if (!App.remoto) return false;
    const { data } = await sb.from("painel_admins").select("user_id").eq("user_id", App.usuario.id).maybeSingle();
    return !!data;
  },

  // Contas e acessos (função painel-admin, só administradoras)
  async admin(acao, extra = {}) {
    if (!App.remoto) return null;
    try {
      const { data, error } = await sb.functions.invoke("painel-admin", { body: { acao, ...extra } });
      if (error) {
        let msg = "Não foi possível falar com o servidor agora.";
        try { const corpo = await error.context?.json?.(); if (corpo?.erro) msg = corpo.erro; } catch { /* mantém */ }
        return { ok: false, erro: msg };
      }
      return data;
    } catch { return { ok: false, erro: "Não foi possível falar com o servidor agora." }; }
  },

  async automacoes() {
    if (!App.remoto) return memoria.ler(CHAVE_AUTOS_LOCAL, []);
    const { data, error } = await sb.from("ig_automations").select("*").eq("conta_id", App.conta.id).order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  // Retorna { automacao, local } (local = salvo só no navegador)
  async salvarAutomacao(a) {
    if (!App.remoto) {
      const lista = memoria.ler(CHAVE_AUTOS_LOCAL, []);
      const item = { ...a, id: a.id || `local-${Date.now()}`, updated_at: new Date().toISOString() };
      const i = lista.findIndex((x) => x.id === item.id);
      if (i >= 0) lista[i] = item; else lista.unshift(item);
      memoria.gravar(CHAVE_AUTOS_LOCAL, lista);
      return { automacao: item, local: true };
    }
    const linha = { ...a };
    if (!linha.id) delete linha.id;
    delete linha.created_at; delete linha.updated_at;
    linha.conta_id = linha.conta_id || App.conta.id; // toda automação é de uma conta
    const { data, error } = await sb.from("ig_automations").upsert(linha).select().single();
    if (error) throw error;
    return { automacao: data, local: false };
  },

  async apagarAutomacao(id) {
    if (!App.remoto) {
      memoria.gravar(CHAVE_AUTOS_LOCAL, memoria.ler(CHAVE_AUTOS_LOCAL, []).filter((x) => x.id !== id));
      return;
    }
    const { error } = await sb.from("ig_automations").delete().eq("id", id);
    if (error) throw error;
  },

  async ligarDesligar(id, active) {
    if (!App.remoto) {
      const lista = memoria.ler(CHAVE_AUTOS_LOCAL, []);
      const a = lista.find((x) => x.id === id);
      if (a) a.active = active;
      memoria.gravar(CHAVE_AUTOS_LOCAL, lista);
      return;
    }
    const { error } = await sb.from("ig_automations").update({ active }).eq("id", id);
    if (error) throw error;
  },

  // Números do Início. Qualquer falha vira zero.
  // contaId: só desta conta (Análises, Interações). Sem contaId: todas as contas que a pessoa acessa (Início).
  async contagens(contaId) {
    const r = { leads: 0, ativas: 0, dms7: 0 };
    if (!App.remoto) {
      r.ativas = memoria.ler(CHAVE_AUTOS_LOCAL, []).filter((a) => a.active).length;
      return r;
    }
    const seteDias = new Date(Date.now() - 7 * 864e5).toISOString();
    const [leads, ativas, dms] = await Promise.allSettled([
      daConta(sb.from("ig_leads").select("ig_user_id", { count: "exact", head: true }), contaId),
      daConta(sb.from("ig_automations").select("id", { count: "exact", head: true }).eq("active", true), contaId),
      daConta(sb.from("ig_deliveries").select("id", { count: "exact", head: true }).eq("status", "ok").gte("ts", seteDias), contaId),
    ]);
    r.leads = leads.value?.count ?? 0;
    r.ativas = ativas.value?.count ?? 0;
    r.dms7 = dms.value?.count ?? 0;
    return r;
  },

  // Análises do Instagram (função ig-insights). null = não conectado.
  // opcoes: { atualizar: true } busca de novo; { comentarios: true } monta o ranking
  async analises(periodo, opcoes = {}) {
    if (!App.remoto) return null;
    try {
      const { data, error } = await sb.functions.invoke("ig-insights", {
        body: { conta_id: App.conta.id, periodo, atualizar: !!opcoes.atualizar, comentarios: !!opcoes.comentarios, escopo: opcoes.escopo || "periodo" },
      });
      if (error || !data?.ok) return null;
      return data;
    } catch { return null; }
  },

  // Validade do token do Instagram (gravada pela renovação automática)
  async tokenStatus() {
    if (!App.remoto) return null;
    const { data } = await sb.from("ig_contas").select("token_expira_em, token_ok").eq("id", App.conta.id).maybeSingle();
    return data ? { expires_at: data.token_expira_em, last_ok: data.token_ok } : null;
  },

  // Repescagem (função ig-repescagem). acao: "previa" ou "enviar". null = não conectado.
  async repescagem(automationId, acao, responderPublico = false) {
    if (!App.remoto) return null;
    try {
      const { data, error } = await sb.functions.invoke("ig-repescagem", {
        body: { automation_id: automationId, acao, responder_publico: responderPublico },
      });
      if (error) return { ok: false, erro: "Não foi possível falar com o servidor agora." };
      return data;
    } catch { return { ok: false, erro: "Não foi possível falar com o servidor agora." }; }
  },

  // DMs entregues nas últimas 24h
  async entregas24h() {
    if (!App.remoto) return 0;
    const { count } = await sb.from("ig_deliveries").select("id", { count: "exact", head: true })
      .eq("conta_id", App.conta.id).eq("status", "ok").gte("ts", new Date(Date.now() - 864e5).toISOString());
    return count ?? 0;
  },

  // Posts da conta (função ig-media). null = não conectado.
  async posts() {
    if (!App.remoto) return null;
    try {
      const { data, error } = await sb.functions.invoke("ig-media", { body: { conta_id: App.conta.id } });
      if (error || !data?.ok) return null;
      (data.posts ?? []).forEach((p) => { Dados._fotos[p.id] = p; });
      return data.posts ?? [];
    } catch { return null; }
  },

  // Fotos dos posts vinculados: { idDoPost: { miniatura, link, legenda } }
  // Guarda em memória pra não buscar de novo a cada tela.
  _fotos: {},
  async miniaturas(ids) {
    const faltam = [...new Set(ids)].filter((id) => !(id in Dados._fotos));
    if (App.remoto && faltam.length) {
      try {
        for (let i = 0; i < faltam.length; i += 50) {
          const { data } = await sb.functions.invoke("ig-media", { body: { conta_id: App.conta.id, ids: faltam.slice(i, i + 50) } });
          (data?.posts ?? []).forEach((p) => { Dados._fotos[p.id] = p; });
        }
      } catch { /* sem foto, fica o ícone */ }
    }
    const r = {};
    ids.forEach((id) => { if (Dados._fotos[id]) r[id] = Dados._fotos[id]; });
    return r;
  },

  // Planilha de leads. O banco devolve no máximo 1000 linhas por vez: pagina.
  async leads() {
    if (!App.remoto) return memoria.ler(CHAVE_LEADS_LOCAL, []);
    const todos = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await sb.from("ig_leads_painel").select("*").eq("conta_id", App.conta.id)
        .order("updated_at", { ascending: false }).range(de, de + 999);
      if (error) throw error;
      todos.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return todos;
  },

  async salvarEtiquetas(igUserId, tags) {
    if (!App.remoto) {
      const lista = memoria.ler(CHAVE_LEADS_LOCAL, []);
      const l = lista.find((x) => x.ig_user_id === igUserId);
      if (l) l.tags = tags;
      memoria.gravar(CHAVE_LEADS_LOCAL, lista);
      return;
    }
    const { error } = await sb.from("ig_leads").update({ tags }).eq("conta_id", App.conta.id).eq("ig_user_id", igUserId);
    if (error) throw error;
  },

  // Exclusão (LGPD): apaga o lead e o histórico dele
  async apagarLead(igUserId) {
    if (!App.remoto) {
      memoria.gravar(CHAVE_LEADS_LOCAL, memoria.ler(CHAVE_LEADS_LOCAL, []).filter((x) => x.ig_user_id !== igUserId));
      return;
    }
    const { error } = await sb.rpc("apagar_dados_lead", { p_conta: App.conta.id, p_quem: igUserId });
    if (error) throw error;
  },

  async arquivos() {
    if (!App.remoto) return memoria.ler(CHAVE_ARQS_LOCAL, []);
    const { data, error } = await sb.from("ig_assets").select("*").eq("conta_id", App.conta.id).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async adicionarArquivo(a) {
    if (!App.remoto) {
      const lista = memoria.ler(CHAVE_ARQS_LOCAL, []);
      const item = { ...a, id: `local-arq-${Date.now()}` };
      lista.unshift(item);
      memoria.gravar(CHAVE_ARQS_LOCAL, lista);
      return item;
    }
    const { data, error } = await sb.from("ig_assets").insert({ ...a, conta_id: App.conta.id }).select().single();
    if (error) throw error;
    return data;
  },
};

// =====================================================================
// LOGIN
// =====================================================================
function mostrarLogin() {
  App.usuario = null;
  $("#app").hidden = true;
  $("#editor").hidden = true;
  $("#tela-login").hidden = false;
  $("#aviso-login-local").hidden = !MODO_LOCAL;
  if (MODO_LOCAL) $("#login-senha").placeholder = "5 dígitos (ex: 12345)";
  setTimeout(() => $("#login-email").focus(), 50);
}

function erroLogin(msg) {
  const el = $("#login-erro");
  el.textContent = msg;
  el.hidden = !msg;
}

async function aoEnviarLogin(e) {
  e.preventDefault();
  erroLogin("");
  const email = $("#login-email").value.trim();
  const senha = $("#login-senha").value;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erroLogin("Digite um e-mail válido.");

  // Modo de teste local: qualquer e-mail + senha de 5 dígitos
  if (MODO_LOCAL) {
    if (!/^\d{5}$/.test(senha)) return erroLogin("No modo de teste local, a senha precisa ter exatamente 5 dígitos (só números).");
    memoria.gravar("login_local", { email });
    return entrar({ email });
  }

  // Produção: Supabase Auth
  if (!sb) return erroLogin("O sistema ainda não está conectado ao Supabase. Veja o LEIA-ME.");
  const btn = $("#btn-entrar");
  btn.disabled = true; btn.textContent = "Entrando...";
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error || !data?.user) return erroLogin("E-mail ou senha incorretos.");
    entrar(data.user);
  } catch {
    erroLogin("Não foi possível conectar agora. Tente de novo em instantes.");
  } finally {
    btn.disabled = false; btn.textContent = "Entrar";
  }
}

function entrar(usuario) {
  App.usuario = usuario;
  App.remoto = !MODO_LOCAL && !!sb;
  $("#tela-login").hidden = true;
  $("#app").hidden = false;
  $("#usuario-email").textContent = usuario.email ?? "";
  $("#aviso-modo-local").hidden = App.remoto;
  $("#login-senha").value = "";
  if (!location.hash) location.hash = "#inicio";
  prepararContas().then(navegar);
}

// Carrega as contas da pessoa, a conta escolhida e se ela é administradora
async function prepararContas() {
  try { [App.contas, App.admin] = await Promise.all([Dados.contas(), Dados.souAdmin()]); }
  catch { App.contas = []; App.admin = false; }
  const salva = memoria.ler("conta_atual", null);
  App.conta = App.contas.find((c) => c.id === salva) || App.contas[0] || null;
  $("#menu-acessos").hidden = !App.admin;
  renderSeletorConta();
}

// Seletor no topo da seção Instagram (só aparece com mais de uma conta)
function renderSeletorConta() {
  const alvo = $("#ig-contas");
  const semConta = !App.conta;
  $("#ig-sem-conta").hidden = !semConta;
  $(".abas").hidden = semConta;
  if (App.contas.length < 2) { alvo.innerHTML = ""; return; }
  alvo.innerHTML = `<div class="segmentado seletor-conta" role="group" aria-label="Conta de Instagram">${App.contas.map((c) =>
    `<button class="${c.id === App.conta?.id ? "ativo" : ""}" data-conta="${esc(c.id)}" aria-pressed="${c.id === App.conta?.id}">@${esc(c.username || "conta")}</button>`).join("")}</div>`;
}

function trocarConta(id) {
  const c = App.contas.find((x) => x.id === id);
  if (!c || c.id === App.conta?.id) return;
  App.conta = c;
  memoria.gravar("conta_atual", c.id);
  window.Analises?.reset();   // análises guardadas eram da outra conta
  window.Editor?.limparPosts(); // posts do seletor eram da outra conta
  renderSeletorConta();
  trocarAba(abaInstagram);
  carregarStatusIg();
}

async function sair() {
  const editor = window.Editor;
  if (editor?.aberto() && !(await editor.fechar())) return;
  memoria.apagar("login_local");
  if (sb && !MODO_LOCAL) { try { await sb.auth.signOut(); } catch { /* segue */ } }
  history.replaceState(null, "", location.pathname + location.search);
  mostrarLogin();
}

// =====================================================================
// NAVEGAÇÃO (menu lateral, sem recarregar a página)
// =====================================================================
let abaInstagram = memoria.ler("aba_instagram", "automacoes");

function navegar() {
  if (!App.usuario) return;
  const rota = (location.hash || "#inicio").slice(1);
  const rotas = ["inicio", "calendario", "instagram"].concat(App.admin ? ["acessos"] : []);
  const valida = rotas.includes(rota) ? rota : "inicio";
  $$(".secao").forEach((s) => (s.hidden = s.id !== `secao-${valida}`));
  $$(".menu-item[data-rota]").forEach((m) => m.classList.toggle("ativo", m.dataset.rota === valida));
  $("#lateral").classList.remove("aberta");
  if (valida === "inicio") carregarInicio();
  if (valida === "instagram" && App.conta) { trocarAba(abaInstagram); carregarStatusIg(); }
  if (valida === "acessos") window.Acessos.carregar();
}

// Pílulas no topo da seção Instagram: validade do token e entregas em 24h
async function carregarStatusIg() {
  const alvo = $("#ig-status");
  if (!App.remoto || !App.conta) { alvo.innerHTML = ""; return; }
  let token = null, entregas = 0;
  try { [token, entregas] = await Promise.all([Dados.tokenStatus(), Dados.entregas24h()]); } catch { /* sem pílulas */ }
  let pilulaToken = "";
  if (token?.expires_at) {
    const dias = Math.ceil((new Date(token.expires_at).getTime() - Date.now()) / 864e5);
    const nivel = dias <= 3 ? "erro" : dias <= 14 ? "atencao" : "";
    const texto = dias > 0 ? `Token ${dias} dia${dias === 1 ? "" : "s"}` : "Token vencido";
    pilulaToken = `<span class="pilula-status ${nivel}" title="Validade do acesso ao Instagram. A renovação é automática toda semana."><span class="ponto"></span>${texto}</span>`;
  } else if (token?.last_ok === false) {
    pilulaToken = `<span class="pilula-status erro"><span class="ponto"></span>Token com erro</span>`;
  }
  alvo.innerHTML = `${pilulaToken}<span class="pilula-status" title="DMs entregues nas últimas 24 horas">✉️ ${entregas.toLocaleString("pt-BR")} entrega${entregas === 1 ? "" : "s"} 24h</span>`;
}

function trocarAba(aba) {
  abaInstagram = aba;
  memoria.gravar("aba_instagram", aba);
  $$(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === aba));
  $("#aba-metricas").hidden = aba !== "metricas";
  $("#aba-automacoes").hidden = aba !== "automacoes";
  $("#aba-interacoes").hidden = aba !== "interacoes";
  $("#aba-conversas").hidden = aba !== "conversas";
  $("#aba-relatorio").hidden = aba !== "relatorio";
  if (aba !== "conversas") window.Conversas?.parar(); // desliga o tempo real fora da aba
  if (aba === "metricas") window.Analises.carregar();
  if (aba === "automacoes") carregarAutomacoes();
  if (aba === "interacoes") window.Interacoes.carregar();
  if (aba === "conversas") window.Conversas.carregar();
  if (aba === "relatorio") window.Relatorio.carregar();
}

// =====================================================================
// INÍCIO
// =====================================================================
async function carregarInicio() {
  let c = { leads: 0, ativas: 0, dms7: 0 };
  try { c = await Dados.contagens(); } catch { /* zeros */ }
  $("#n-leads").textContent = c.leads.toLocaleString("pt-BR");
  $("#n-ativas").textContent = c.ativas.toLocaleString("pt-BR");
  $("#n-dms").textContent = c.dms7.toLocaleString("pt-BR");
}

// =====================================================================
// MÉTRICAS
// =====================================================================
function graficoBarras(serie, rotulo) {
  if (!serie?.length) return `<div class="texto-2 pequeno" style="padding:30px 0; text-align:center">Sem dados no período.</div>`;
  const max = Math.max(1, ...serie.map((p) => p.valor));
  const fmtDia = (d) => { const [, m, dd] = d.split("-"); return `${dd}/${m}`; };
  const barras = serie.map((p) => `
    <div class="barra-alvo" data-dica="${esc(fmtDia(p.dia))}: ${p.valor.toLocaleString("pt-BR")} ${esc(rotulo)}">
      <div class="barra" style="height:${Math.max(1.5, (p.valor / max) * 100)}%"></div>
    </div>`).join("");
  // muitas barras (1 ano) = espaço menor entre elas, senão somem
  const espaco = serie.length > 120 ? 0 : serie.length > 45 ? 1 : 3;
  return `<div class="grafico" style="gap:${espaco}px">${barras}</div>
    <div class="grafico-eixo"><span>${esc(fmtDia(serie[0].dia))}</span><span>${esc(fmtDia(serie[serie.length - 1].dia))}</span></div>`;
}

// Dica flutuante dos gráficos (hover)
document.addEventListener("mousemove", (e) => {
  const alvo = e.target.closest?.("[data-dica]");
  const dica = $("#dica");
  if (!alvo) { dica.hidden = true; return; }
  const r = alvo.getBoundingClientRect();
  dica.textContent = alvo.dataset.dica;
  dica.style.left = `${r.left + r.width / 2}px`;
  dica.style.top = `${r.top + r.height - (alvo.querySelector(".barra")?.offsetHeight ?? 0) - 4}px`;
  dica.hidden = false;
});

// =====================================================================
// LISTA DE AUTOMAÇÕES
// =====================================================================
async function carregarAutomacoes() {
  const alvo = $("#lista-automacoes");
  let lista = [];
  let falhou = false;
  try { lista = await Dados.automacoes(); } catch (e) { console.warn(e); falhou = true; }

  if (!lista.length) {
    alvo.innerHTML = `
      <div class="cartao vazio">
        <div class="vazio-icone" data-icone="chat"></div>
        <h2 class="subtitulo">Nenhuma automação ainda</h2>
        <p>${falhou ? "Não foi possível ler o banco agora. Confira a configuração do Supabase." : "Crie a primeira: escolha uma palavra, escreva a mensagem e veja a prévia ao vivo."}</p>
        <button class="btn btn-primario" data-acao="nova"><span data-icone="mais"></span> Nova automação</button>
      </div>`;
    pintarIcones(alvo);
    return;
  }

  alvo.innerHTML = lista.map((a) => {
    const palavras = a.match_any
      ? `<span class="chip chip-destaque">Qualquer palavra</span>`
      : (a.keyword || "").split(",").map((k) => k.trim()).filter(Boolean).map((k) => `<span class="chip">${esc(k)}</span>`).join("");
    // Foto do post vinculado (o primeiro; "+N" se tiver mais)
    const medias = a.media_ids || [];
    const thumb = medias.length
      ? `<div class="thumb" data-thumb="${esc(medias[0])}" title="${medias.length} post${medias.length > 1 ? "s" : ""} vinculado${medias.length > 1 ? "s" : ""}">${icone("imagem")}${medias.length > 1 ? `<span class="mais">+${medias.length - 1}</span>` : ""}</div>`
      : `<div class="thumb thumb-todos" title="Vale pra todos os posts">${icone("grade")}</div>`;
    return `
      <div class="cartao item-auto" data-id="${esc(a.id)}">
        ${thumb}
        <div class="info">
          <div class="nome">${esc(a.nome || "Sem nome")}</div>
          <div class="chips">${palavras || '<span class="chip">Sem palavra</span>'}
            <span class="chip">${medias.length ? `${medias.length} post${medias.length > 1 ? "s" : ""}` : "Todos os posts"}</span></div>
        </div>
        <label class="switch" title="Ligar ou desligar"><input type="checkbox" data-acao="ligar" ${a.active ? "checked" : ""}><span class="trilho"></span></label>
        <span class="status ${a.active ? "on" : "off"}">${a.active ? "Ligada" : "Desligada"}</span>
        <button class="btn btn-p" data-acao="repescar" title="Responder comentários dos últimos 7 dias que ficaram sem DM"><span data-icone="repescar"></span> Repescar</button>
        <button class="btn btn-p" data-acao="editar"><span data-icone="lapis"></span> Editar</button>
        <button class="btn btn-icone btn-fantasma btn-perigo" data-acao="apagar" aria-label="Apagar"><span data-icone="lixo"></span></button>
      </div>`;
  }).join("");
  pintarIcones(alvo);
  alvo._lista = lista;

  // Busca as fotos depois de desenhar (a lista aparece na hora, as fotos chegam em seguida)
  const ids = lista.map((a) => (a.media_ids || [])[0]).filter(Boolean);
  if (ids.length) {
    Dados.miniaturas(ids).then((fotos) => {
      $$("[data-thumb]", alvo).forEach((el) => {
        const f = fotos[el.dataset.thumb];
        if (!f?.miniatura) return;
        el.querySelector("svg")?.remove();
        el.insertAdjacentHTML("afterbegin", `<img src="${esc(f.miniatura)}" alt="${esc(f.legenda || "Post vinculado")}" loading="lazy">`);
        if (f.link) { el.style.cursor = "pointer"; el.onclick = () => window.open(f.link, "_blank", "noopener"); }
      });
    });
  }
}

$("#lista-automacoes").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-acao]");
  if (!btn || btn.dataset.acao === "ligar") return;
  if (btn.dataset.acao === "nova") return window.Editor.abrir(null);
  const id = btn.closest("[data-id]")?.dataset.id;
  const auto = ($("#lista-automacoes")._lista || []).find((a) => a.id === id);
  if (!auto) return;
  if (btn.dataset.acao === "editar") window.Editor.abrir(auto);
  if (btn.dataset.acao === "repescar") window.Repescagem.abrir(auto);
  if (btn.dataset.acao === "apagar") {
    const ok = await confirmar("Apagar automação?", `"${auto.nome || "Sem nome"}" vai parar de responder e não dá pra desfazer.`, "Apagar", true);
    if (!ok) return;
    try { await Dados.apagarAutomacao(id); aviso("Automação apagada."); } catch { aviso("Não foi possível apagar agora.", "erro"); }
    carregarAutomacoes();
  }
});

$("#lista-automacoes").addEventListener("change", async (e) => {
  if (e.target.dataset.acao !== "ligar") return;
  const id = e.target.closest("[data-id]").dataset.id;
  try {
    await Dados.ligarDesligar(id, e.target.checked);
    aviso(e.target.checked ? "Automação ligada." : "Automação desligada.");
  } catch { aviso("Não foi possível alterar agora.", "erro"); }
  carregarAutomacoes();
});

// =====================================================================
// INÍCIO DO APP
// =====================================================================
async function iniciar() {
  pintarIcones();
  $("#form-login").addEventListener("submit", aoEnviarLogin);
  $("#btn-sair").addEventListener("click", sair);
  $("#btn-menu").addEventListener("click", () => $("#lateral").classList.toggle("aberta"));
  // Menu lateral recolhível (lembra a escolha)
  $("#app").classList.toggle("recolhido", memoria.ler("menu_recolhido", false));
  $("#btn-recolher").addEventListener("click", () => {
    const r = !$("#app").classList.contains("recolhido");
    $("#app").classList.toggle("recolhido", r);
    $("#btn-recolher").setAttribute("aria-label", r ? "Abrir o menu" : "Recolher o menu");
    memoria.gravar("menu_recolhido", r);
  });
  $$(".aba").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.aba)));
  $("#ig-contas").addEventListener("click", (e) => { const b = e.target.closest("[data-conta]"); if (b) trocarConta(b.dataset.conta); });
  $("#btn-nova").addEventListener("click", () => window.Editor.abrir(null));
  $("#atalho-nova").addEventListener("click", () => { location.hash = "#instagram"; trocarAba("automacoes"); window.Editor.abrir(null); });
  window.addEventListener("hashchange", navegar);

  if (MODO_LOCAL) {
    const login = memoria.ler("login_local", null);
    return login?.email ? entrar({ email: login.email }) : mostrarLogin();
  }

  if (!sb) return mostrarLogin();
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) entrar(data.session.user); else mostrarLogin();
  } catch { mostrarLogin(); }

  // Se a sessão do Supabase expirar, volta pro login
  sb.auth.onAuthStateChange((_evento, sessao) => {
    if (!sessao && App.usuario) mostrarLogin();
  });
}

document.addEventListener("DOMContentLoaded", iniciar);
