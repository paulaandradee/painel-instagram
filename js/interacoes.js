// =====================================================================
// interacoes.js: a aba "Interações" (planilha de leads)
// - busca, filtros (origem, automação, etiqueta) e ordenação por coluna
// - etiquetas editáveis direto na tabela
// - exportar CSV (abre no Excel / Google Planilhas)
// - excluir dados de uma pessoa (pedido de exclusão da LGPD)
// =====================================================================
(function () {
  const ORIGENS = { comment: "Comentário", dm: "Direct", story_reply: "Story" };
  const POR_PAGINA = 50;

  let leads = [];        // todos os leads carregados
  let autos = [];        // automações (pra mostrar a etapa da conversa)
  let exemplo = false;   // true = dados fictícios só pra visualizar
  let limite = POR_PAGINA;
  const filtro = { texto: "", origem: "", automacao: "", etiqueta: "" };
  const ordem = { campo: "ultima", desc: true };

  // ---------------- Ajudas ----------------
  const ultima = (l) => l.last_interaction_at || l.updated_at || l.created_at;
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function relativo(iso) {
    if (!iso) return "";
    const seg = (Date.now() - new Date(iso).getTime()) / 1000;
    if (seg < 60) return "agora";
    if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
    if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
    if (seg < 172800) return "ontem";
    if (seg < 30 * 86400) return `há ${Math.floor(seg / 86400)} dias`;
    return dataCurta(iso);
  }
  const dataCurta = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "");
  const dataCompleta = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "");

  function formatarTelefone(t) {
    const d = String(t || "").replace(/\D/g, "");
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return t || "";
  }
  const linkWhats = (t) => { const d = String(t || "").replace(/\D/g, ""); return `https://wa.me/${d.length <= 11 ? "55" + d : d}`; };

  function etapa(l) {
    const a = autos.find((x) => x.id === l.automation_id);
    const i = (a?.flow?.steps || []).findIndex((s) => String(s.id) === String(l.flow_step));
    return i >= 0 ? `Mensagem ${i + 1}` : "";
  }
  const nomeAutomacao = (l) => l.automacao_nome || autos.find((x) => x.id === l.automation_id)?.nome || "";

  // ---------------- Dados fictícios (só pra visualizar) ----------------
  function leadsExemplo() {
    const h = (horas) => new Date(Date.now() - horas * 3600e3).toISOString();
    const base = [
      ["Ana Souza", "ana.souza", "comment", "quero", "ana@exemplo.com", "", ["cliente"], 5, 3, true, 2, 300],
      ["Bruno Lima", "brunolima", "dm", "guia", "", "61990000001", ["quente"], 3, 2, true, 26, 100],
      ["", "carla_m", "comment", "quero", "", "", [], 1, 1, false, 50, 50],
      ["Diego Alves", "diego.alves", "story_reply", "link", "diego@exemplo.com", "61990000002", ["quente", "parceria"], 8, 4, true, 4, 900],
      ["Elisa Rocha", "elisarocha", "comment", "guia", "", "", ["frio"], 2, 1, true, 200, 400],
      ["Fábio Nunes", "fabionunes", "comment", "quero", "fabio@exemplo.com", "", [], 4, 3, true, 9, 30],
    ];
    return base.map(([nome, username, origem, palavra, email, tel, tags, inter, env, link, ult, cri], i) => ({
      ig_user_id: `exemplo-${i}`, nome, username, last_source: origem, last_keyword: palavra, email, telefone: tel,
      tags, interacoes: inter, mensagens_enviadas: env, link_sent: link, automacao_nome: "Exemplo: guia gratuito",
      last_interaction_at: h(ult), updated_at: h(ult), created_at: h(cri), flow_step: null,
    }));
  }

  // ---------------- Carregar ----------------
  async function carregar(forcarExemplo = false) {
    const alvo = $("#aba-interacoes");
    alvo.innerHTML = `<div class="texto-2">Carregando...</div>`;
    exemplo = forcarExemplo;
    limite = POR_PAGINA;
    let falhou = false;
    try { autos = await Dados.automacoes(); } catch { autos = []; }
    if (exemplo) leads = leadsExemplo();
    else {
      try { leads = await Dados.leads(); } catch (e) { console.warn(e); leads = []; falhou = true; }
    }

    if (!leads.length) {
      alvo.innerHTML = `
        <div class="cartao vazio">
          <div class="vazio-icone" data-icone="pessoas"></div>
          <h2 class="subtitulo">Nenhuma interação ainda</h2>
          <p>${falhou
            ? "Não foi possível ler o banco agora. Confira a conexão com o Supabase."
            : "Quando alguém comentar a palavra de uma automação ou conversar com você pelo direct, a pessoa aparece aqui, com origem, contato e histórico."}</p>
          <button class="btn btn-p" data-acao="exemplo">Ver um exemplo com dados fictícios</button>
        </div>`;
      pintarIcones(alvo);
      return;
    }
    renderEstrutura();
    renderTabela();
  }

  // ---------------- Filtrar e ordenar ----------------
  function filtrados() {
    const t = norm(filtro.texto);
    const lista = leads.filter((l) => {
      if (filtro.origem && l.last_source !== filtro.origem) return false;
      if (filtro.automacao && nomeAutomacao(l) !== filtro.automacao) return false;
      if (filtro.etiqueta && !(l.tags || []).includes(filtro.etiqueta)) return false;
      if (t) {
        const alvo = norm([l.nome, l.username, l.email, l.telefone, l.last_keyword, nomeAutomacao(l), ...(l.tags || [])].join(" "));
        if (!alvo.includes(t)) return false;
      }
      return true;
    });
    const valor = {
      pessoa: (l) => norm(l.nome || l.username),
      origem: (l) => ORIGENS[l.last_source] || "",
      palavra: (l) => norm(l.last_keyword),
      automacao: (l) => norm(nomeAutomacao(l)),
      contato: (l) => (l.email ? 2 : 0) + (l.telefone ? 1 : 0),
      interacoes: (l) => Number(l.interacoes || 0),
      enviadas: (l) => Number(l.mensagens_enviadas || 0),
      etapa: (l) => etapa(l),
      link: (l) => (l.link_sent ? 1 : 0),
      primeira: (l) => l.created_at || "",
      ultima: (l) => ultima(l) || "",
    }[ordem.campo];
    return lista.sort((a, b) => {
      const va = valor(a), vb = valor(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return ordem.desc ? -c : c;
    });
  }

  // ---------------- Desenhar ----------------
  function renderEstrutura() {
    const alvo = $("#aba-interacoes");
    const seteDias = Date.now() - 7 * 864e5;
    const comContato = leads.filter((l) => l.email || l.telefone).length;
    const novos = leads.filter((l) => new Date(l.created_at).getTime() >= seteDias).length;
    const totalInter = leads.reduce((s, l) => s + Number(l.interacoes || 0), 0);
    const nomesAuto = [...new Set(leads.map(nomeAutomacao).filter(Boolean))].sort();
    const etiquetas = [...new Set(leads.flatMap((l) => l.tags || []))].sort();
    const opc = (lista, sel, vazio) => `<option value="">${vazio}</option>` + lista.map((v) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");

    alvo.innerHTML = `
      ${exemplo ? `<div class="faixa faixa-info" style="margin-bottom:16px"><span data-icone="info"></span><span>Exemplo com dados fictícios, só pra visualizar. Mudanças aqui não são salvas. <a href="#" data-acao="sair-exemplo">Voltar</a></span></div>` : ""}
      <div class="resumo-mini">
        <div class="cartao"><span class="rotulo">Leads</span><div class="numero">${leads.length.toLocaleString("pt-BR")}</div></div>
        <div class="cartao"><span class="rotulo">Com contato</span><div class="numero">${comContato.toLocaleString("pt-BR")}</div></div>
        <div class="cartao"><span class="rotulo">Novos (7 dias)</span><div class="numero">${novos.toLocaleString("pt-BR")}</div></div>
        <div class="cartao"><span class="rotulo">Interações</span><div class="numero">${totalInter.toLocaleString("pt-BR")}</div></div>
      </div>
      <div class="barra-ferramentas">
        <input class="input" id="int-busca" type="search" placeholder="Buscar por nome, @, e-mail, telefone, palavra..." value="${esc(filtro.texto)}" aria-label="Buscar">
        <select class="select" id="int-origem" aria-label="Filtrar por origem">${opc(Object.keys(ORIGENS), filtro.origem, "Todas as origens").replace(/>(comment|dm|story_reply)</g, (_, k) => `>${ORIGENS[k]}<`)}</select>
        <select class="select" id="int-auto" aria-label="Filtrar por automação">${opc(nomesAuto, filtro.automacao, "Todas as automações")}</select>
        <select class="select" id="int-etiqueta" aria-label="Filtrar por etiqueta">${opc(etiquetas, filtro.etiqueta, "Todas as etiquetas")}</select>
        <button class="btn" data-acao="csv"><span data-icone="baixar"></span> Exportar CSV</button>
      </div>
      <div class="tabela-wrap"><table class="planilha" id="int-tabela"></table></div>
      <div class="rodape-tabela" id="int-rodape"></div>`;
    pintarIcones(alvo);
  }

  function renderTabela() {
    const lista = filtrados();
    const visiveis = lista.slice(0, limite);
    const col = (campo, titulo, classe = "") => {
      const seta = ordem.campo === campo ? `<span class="seta">${ordem.desc ? "↓" : "↑"}</span>` : "";
      return `<th data-ordem="${campo}" class="${classe}" aria-sort="${ordem.campo === campo ? (ordem.desc ? "descending" : "ascending") : "none"}">${titulo}${seta}</th>`;
    };
    const linhas = visiveis.map((l) => {
      const nome = l.nome || (l.username ? `@${l.username}` : "Sem nome");
      const inicial = (l.nome || l.username || "?").trim().charAt(0).toUpperCase();
      const perfil = l.username ? `<a href="https://instagram.com/${encodeURIComponent(l.username)}" target="_blank" rel="noopener">@${esc(l.username)}</a>` : `<span class="vazio-cel pequeno">sem @</span>`;
      const contato = [
        l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : "",
        l.telefone ? `<a href="${linkWhats(l.telefone)}" target="_blank" rel="noopener" title="Abrir no WhatsApp">${esc(formatarTelefone(l.telefone))}</a>` : "",
      ].join("");
      const tags = (l.tags || []).map((t, i) => `<span class="etiqueta">${esc(t)}<button type="button" data-acao="tag-rem" data-i="${i}" aria-label="Remover etiqueta ${esc(t)}">×</button></span>`).join("");
      const ult = ultima(l);
      return `
        <tr data-id="${esc(l.ig_user_id)}">
          <td><div class="pessoa"><span class="avatar" aria-hidden="true">${esc(inicial)}</span><div>
            ${l.nome ? `<div class="nome-l">${esc(l.nome)}</div>${perfil}` : l.username ? `<div class="nome-l">${perfil}</div>` : `<div class="nome-l">Sem nome</div>`}
          </div></div></td>
          <td>${l.last_source ? `<span class="chip origem-${esc(l.last_source)}">${esc(ORIGENS[l.last_source] || l.last_source)}</span>` : ""}</td>
          <td>${l.last_keyword && l.last_keyword !== "*" ? `<span class="chip">${esc(l.last_keyword)}</span>` : l.last_keyword === "*" ? `<span class="pequeno texto-2">qualquer</span>` : ""}</td>
          <td class="pequeno">${esc(nomeAutomacao(l))}</td>
          <td class="contato">${contato || `<span class="vazio-cel pequeno">sem contato</span>`}</td>
          <td><div class="etiquetas">${tags}<button type="button" class="btn-etiqueta" data-acao="tag-add" aria-label="Adicionar etiqueta">+ etiqueta</button></div></td>
          <td class="num">${Number(l.interacoes || 0)}</td>
          <td class="num">${Number(l.mensagens_enviadas || 0)}</td>
          <td class="pequeno">${esc(etapa(l))}</td>
          <td>${l.link_sent ? `<span class="status on">Sim</span>` : `<span class="status off">Não</span>`}</td>
          <td class="pequeno" title="${esc(dataCompleta(l.created_at))}">${esc(dataCurta(l.created_at))}</td>
          <td class="pequeno" title="${esc(dataCompleta(ult))}">${esc(relativo(ult))}</td>
          <td><button type="button" class="btn btn-icone btn-fantasma btn-perigo" data-acao="apagar" aria-label="Excluir dados de ${esc(nome)}" title="Excluir dados (LGPD)">${icone("lixo")}</button></td>
        </tr>`;
    }).join("");

    $("#int-tabela").innerHTML = `
      <thead><tr>
        ${col("pessoa", "Pessoa")}${col("origem", "Origem")}${col("palavra", "Palavra")}${col("automacao", "Automação")}
        ${col("contato", "Contato")}<th>Etiquetas</th>${col("interacoes", "Interações", "num")}${col("enviadas", "DMs enviadas", "num")}
        ${col("etapa", "Etapa")}${col("link", "Recebeu link")}${col("primeira", "Primeira vez")}${col("ultima", "Última vez")}<th><span class="so-leitor">Ações</span></th>
      </tr></thead>
      <tbody>${linhas || `<tr><td colspan="13" class="texto-2" style="text-align:center;padding:28px">Ninguém encontrado com esses filtros.</td></tr>`}</tbody>`;

    $("#int-rodape").innerHTML = `
      <span class="pequeno texto-2">Mostrando ${visiveis.length.toLocaleString("pt-BR")} de ${lista.length.toLocaleString("pt-BR")}${lista.length !== leads.length ? ` (filtrado de ${leads.length.toLocaleString("pt-BR")})` : ""}</span>
      ${lista.length > limite ? `<button class="btn btn-p" data-acao="mais">Carregar mais</button>` : ""}`;
  }

  // ---------------- CSV ----------------
  function exportarCSV() {
    const lista = filtrados();
    const cab = ["Nome", "Usuário", "Origem", "Palavra", "Automação", "E-mail", "Telefone", "Etiquetas", "Interações", "DMs enviadas", "Etapa", "Recebeu link", "Primeira vez", "Última vez"];
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = lista.map((l) => [
      l.nome, l.username ? `@${l.username}` : "", ORIGENS[l.last_source] || "", l.last_keyword === "*" ? "qualquer" : l.last_keyword,
      nomeAutomacao(l), l.email, formatarTelefone(l.telefone), (l.tags || []).join(", "), l.interacoes || 0, l.mensagens_enviadas || 0,
      etapa(l), l.link_sent ? "Sim" : "Não", dataCompleta(l.created_at), dataCompleta(ultima(l)),
    ].map(cel).join(";"));
    // ";" e BOM: abre certinho no Excel em português
    const csv = "﻿" + [cab.map(cel).join(";"), ...linhas].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `interacoes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    aviso(`${lista.length} linha${lista.length === 1 ? "" : "s"} exportada${lista.length === 1 ? "" : "s"}.`, "ok");
  }

  // ---------------- Pedir um texto (nova etiqueta) ----------------
  function pedirTexto(titulo, placeholder) {
    return new Promise((resolve) => {
      const fundo = document.createElement("div");
      fundo.className = "modal-fundo";
      fundo.innerHTML = `
        <form class="cartao modal">
          <h3 class="subtitulo">${esc(titulo)}</h3>
          <input class="input" style="margin:14px 0 18px" placeholder="${esc(placeholder)}" maxlength="30">
          <div class="linha" style="justify-content:flex-end">
            <button type="button" class="btn" data-r="0">Cancelar</button>
            <button type="submit" class="btn btn-primario">Adicionar</button>
          </div>
        </form>`;
      const input = $("input", fundo);
      const fechar = (v) => { fundo.remove(); resolve(v); };
      fundo.addEventListener("click", (e) => { if (e.target === fundo || e.target.dataset.r === "0") fechar(null); });
      $("form", fundo).addEventListener("submit", (e) => { e.preventDefault(); fechar(input.value.trim() || null); });
      document.body.appendChild(fundo);
      input.focus();
    });
  }

  // ---------------- Eventos (uma vez só, por delegação) ----------------
  const raiz = $("#aba-interacoes");
  let espera = null;

  raiz.addEventListener("input", (e) => {
    if (e.target.id !== "int-busca") return;
    clearTimeout(espera);
    espera = setTimeout(() => { filtro.texto = e.target.value; limite = POR_PAGINA; renderTabela(); }, 150);
  });

  raiz.addEventListener("change", (e) => {
    const mapa = { "int-origem": "origem", "int-auto": "automacao", "int-etiqueta": "etiqueta" };
    if (!mapa[e.target.id]) return;
    filtro[mapa[e.target.id]] = e.target.value;
    limite = POR_PAGINA;
    renderTabela();
  });

  raiz.addEventListener("click", async (e) => {
    const th = e.target.closest("th[data-ordem]");
    if (th) {
      const c = th.dataset.ordem;
      if (ordem.campo === c) ordem.desc = !ordem.desc;
      else { ordem.campo = c; ordem.desc = !["pessoa", "origem", "palavra", "automacao", "etapa"].includes(c); }
      renderTabela();
      return;
    }

    const b = e.target.closest("[data-acao]");
    if (!b) return;
    const acao = b.dataset.acao;
    if (acao === "exemplo") { e.preventDefault(); return carregar(true); }
    if (acao === "sair-exemplo") { e.preventDefault(); return carregar(false); }
    if (acao === "csv") return exportarCSV();
    if (acao === "mais") { limite += POR_PAGINA; return renderTabela(); }

    const id = b.closest("tr[data-id]")?.dataset.id;
    const lead = leads.find((l) => l.ig_user_id === id);
    if (!lead) return;

    if (acao === "tag-add" || acao === "tag-rem") {
      let tags = [...(lead.tags || [])];
      if (acao === "tag-add") {
        const nova = await pedirTexto("Nova etiqueta", "Ex: cliente, quente, parceria");
        if (!nova || tags.some((t) => norm(t) === norm(nova))) return;
        tags.push(nova);
      } else tags.splice(Number(b.dataset.i), 1);
      try {
        if (!exemplo) await Dados.salvarEtiquetas(lead.ig_user_id, tags);
        lead.tags = tags;
        renderEstrutura();
        renderTabela();
      } catch { aviso("Não foi possível salvar a etiqueta agora.", "erro"); }
      return;
    }

    if (acao === "apagar") {
      const quem = lead.nome || (lead.username ? `@${lead.username}` : "esta pessoa");
      const ok = await confirmar(
        "Excluir dados desta pessoa?",
        `Todos os dados de ${quem} (contato, etiquetas e histórico de envios) serão apagados de vez. Use isto pra atender um pedido de exclusão (LGPD).`,
        "Excluir dados", true,
      );
      if (!ok) return;
      try {
        if (!exemplo) await Dados.apagarLead(lead.ig_user_id);
        leads = leads.filter((l) => l !== lead);
        aviso("Dados excluídos.", "ok");
        if (!leads.length) return carregar(exemplo);
        renderEstrutura();
        renderTabela();
      } catch { aviso("Não foi possível excluir agora.", "erro"); }
    }
  });

  window.Interacoes = { carregar };
})();
