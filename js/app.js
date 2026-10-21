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
};

// =====================================================================
// CAMADA DE DADOS: toda chamada é tolerante a falha
// =====================================================================
const CHAVE_AUTOS_LOCAL = "teste_local_automacoes";
const CHAVE_ARQS_LOCAL = "teste_local_arquivos";

const Dados = {
  async automacoes() {
    if (!App.remoto) return memoria.ler(CHAVE_AUTOS_LOCAL, []);
    const { data, error } = await sb.from("ig_automations").select("*").order("updated_at", { ascending: false });
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
  async contagens() {
    const r = { leads: 0, ativas: 0, dms7: 0 };
    if (!App.remoto) {
      r.ativas = memoria.ler(CHAVE_AUTOS_LOCAL, []).filter((a) => a.active).length;
      return r;
    }
    const seteDias = new Date(Date.now() - 7 * 864e5).toISOString();
    const [leads, ativas, dms] = await Promise.allSettled([
      sb.from("ig_leads").select("ig_user_id", { count: "exact", head: true }),
      sb.from("ig_automations").select("id", { count: "exact", head: true }).eq("active", true),
      sb.from("ig_deliveries").select("id", { count: "exact", head: true }).eq("status", "ok").gte("ts", seteDias),
    ]);
    r.leads = leads.value?.count ?? 0;
    r.ativas = ativas.value?.count ?? 0;
    r.dms7 = dms.value?.count ?? 0;
    return r;
  },

  // Métricas do Instagram (função ig-insights). null = não conectado.
  async insights() {
    if (!App.remoto) return null;
    try {
      const { data, error } = await sb.functions.invoke("ig-insights");
      if (error || !data?.ok) return null;
      return data;
    } catch { return null; }
  },

  // Posts da conta (função ig-media). null = não conectado.
  async posts() {
    if (!App.remoto) return null;
    try {
      const { data, error } = await sb.functions.invoke("ig-media");
      if (error || !data?.ok) return null;
      return data.posts ?? [];
    } catch { return null; }
  },

  async arquivos() {
    if (!App.remoto) return memoria.ler(CHAVE_ARQS_LOCAL, []);
    const { data, error } = await sb.from("ig_assets").select("*").order("created_at", { ascending: false });
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
    const { data, error } = await sb.from("ig_assets").insert(a).select().single();
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
  navegar();
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
  const valida = ["inicio", "calendario", "instagram"].includes(rota) ? rota : "inicio";
  $$(".secao").forEach((s) => (s.hidden = s.id !== `secao-${valida}`));
  $$(".menu-item[data-rota]").forEach((m) => m.classList.toggle("ativo", m.dataset.rota === valida));
  $("#lateral").classList.remove("aberta");
  if (valida === "inicio") carregarInicio();
  if (valida === "instagram") trocarAba(abaInstagram);
}

function trocarAba(aba) {
  abaInstagram = aba;
  memoria.gravar("aba_instagram", aba);
  $$(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === aba));
  $("#aba-metricas").hidden = aba !== "metricas";
  $("#aba-automacoes").hidden = aba !== "automacoes";
  if (aba === "metricas") carregarMetricas();
  if (aba === "automacoes") carregarAutomacoes();
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
  return `<div class="grafico">${barras}</div>
    <div class="grafico-eixo"><span>${esc(fmtDia(serie[0].dia))}</span><span>${esc(fmtDia(serie[serie.length - 1].dia))}</span></div>`;
}

// Números fictícios só pra ver como fica (claramente marcados)
function exemploFicticio() {
  const hoje = new Date();
  const dias = [...Array(15)].map((_, i) => {
    const d = new Date(hoje.getTime() - (14 - i) * 864e5);
    return d.toISOString().slice(0, 10);
  });
  return {
    seguidores: 12480,
    novos_seguidores: dias.map((dia, i) => ({ dia, valor: 20 + Math.round(15 * Math.sin(i / 2) + i * 2) })),
    alcance: dias.map((dia, i) => ({ dia, valor: 1800 + Math.round(600 * Math.cos(i / 3) + i * 40) })),
  };
}

async function carregarMetricas(forcarExemplo = false) {
  const alvo = $("#aba-metricas");
  alvo.innerHTML = `<div class="texto-2">Carregando...</div>`;
  let leads = 0;
  try { leads = (await Dados.contagens()).leads; } catch { /* zero */ }
  const dados = forcarExemplo ? exemploFicticio() : await Dados.insights();

  if (!dados) {
    alvo.innerHTML = `
      <div class="grade-cartoes" style="margin-bottom:16px">
        <div class="cartao"><span class="rotulo">Leads captados</span><div class="numero">${leads.toLocaleString("pt-BR")}</div></div>
      </div>
      <div class="cartao vazio">
        <div class="vazio-icone" data-icone="grafico"></div>
        <h2 class="subtitulo">Conecte seu Instagram pra ver as métricas</h2>
        <p>Assim que o Supabase e a API do Instagram estiverem configurados (veja o LEIA-ME), seguidores e alcance aparecem aqui.</p>
        <button class="btn btn-p" id="ver-exemplo">Ver um exemplo com números fictícios</button>
      </div>`;
    pintarIcones(alvo);
    $("#ver-exemplo").onclick = () => carregarMetricas(true);
    return;
  }

  const novos = (dados.novos_seguidores ?? []).slice(-15);
  const alcance = (dados.alcance ?? []).slice(-15);
  const somaNovos = novos.reduce((s, p) => s + p.valor, 0);
  alvo.innerHTML = `
    ${forcarExemplo ? `<div class="faixa faixa-info" style="margin-bottom:16px"><span data-icone="info"></span><span>Exemplo com números fictícios, só pra visualizar. <a href="#" id="sair-exemplo">Voltar</a></span></div>` : ""}
    <div class="grade-cartoes">
      <div class="cartao"><span class="rotulo">Seguidores</span><div class="numero">${(dados.seguidores ?? 0).toLocaleString("pt-BR")}</div></div>
      <div class="cartao"><span class="rotulo">Novos (15 dias)</span><div class="numero">${somaNovos.toLocaleString("pt-BR")}</div></div>
      <div class="cartao"><span class="rotulo">Leads captados</span><div class="numero">${leads.toLocaleString("pt-BR")}</div></div>
    </div>
    <div class="grade-graficos">
      <div class="cartao"><span class="rotulo">Novos seguidores por dia</span>${graficoBarras(novos, "novos seguidores")}</div>
      <div class="cartao"><span class="rotulo">Alcance por dia</span>${graficoBarras(alcance, "contas alcançadas")}</div>
    </div>`;
  pintarIcones(alvo);
  const voltar = $("#sair-exemplo");
  if (voltar) voltar.onclick = (e) => { e.preventDefault(); carregarMetricas(); };
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
    return `
      <div class="cartao item-auto" data-id="${esc(a.id)}">
        <label class="switch" title="Ligar ou desligar"><input type="checkbox" data-acao="ligar" ${a.active ? "checked" : ""}><span class="trilho"></span></label>
        <div class="info">
          <div class="nome">${esc(a.nome || "Sem nome")}</div>
          <div class="chips">${palavras || '<span class="chip">Sem palavra</span>'}</div>
        </div>
        <span class="status ${a.active ? "on" : "off"}">${a.active ? "Ligada" : "Desligada"}</span>
        <button class="btn btn-p" data-acao="editar"><span data-icone="lapis"></span> Editar</button>
        <button class="btn btn-icone btn-fantasma btn-perigo" data-acao="apagar" aria-label="Apagar"><span data-icone="lixo"></span></button>
      </div>`;
  }).join("");
  pintarIcones(alvo);
  alvo._lista = lista;
}

$("#lista-automacoes").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-acao]");
  if (!btn || btn.dataset.acao === "ligar") return;
  if (btn.dataset.acao === "nova") return window.Editor.abrir(null);
  const id = btn.closest("[data-id]")?.dataset.id;
  const auto = ($("#lista-automacoes")._lista || []).find((a) => a.id === id);
  if (!auto) return;
  if (btn.dataset.acao === "editar") window.Editor.abrir(auto);
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
  $$(".aba").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.aba)));
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
