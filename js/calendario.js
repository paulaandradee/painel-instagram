// =====================================================================
// calendario.js: o "Calendário" (planejamento de conteúdo do time)
// - mês em grade (domingo a sábado); no celular vira lista por dia
// - cada conteúdo: data (opcional), conta, formato, tema, legenda, notas,
//   etapas (gravar, editar, legenda, publicado) e status
// - etapas puxam o status: gravar+editar+legenda = Pronto; publicado = Publicado
// - arrastar um conteúdo muda a data; soltar em "Ideias sem data" tira a data
// - todo mundo da conta vê; a tela se atualiza sozinha a cada 30s
// =====================================================================
(function () {
  const FORMATOS = {
    reels: ["🎬", "Reels"], carrossel: ["🖼️", "Carrossel"], post: ["📷", "Post"],
    story: ["⏱️", "Story"], live: ["🔴", "Live"], outro: ["✨", "Outro"],
  };
  const STATUS = { a_fazer: "A fazer", pronto: "Pronto", publicado: "Publicado" };
  const ETAPAS = [["etapa_gravar", "Gravar"], ["etapa_editar", "Editar"], ["etapa_legenda", "Legenda"], ["etapa_publicado", "Publicado"]];
  const LEGENDA_MAX = 2200; // limite do Instagram
  const ATUALIZA_MS = 30e3;
  const CHAVE_LOCAL = "teste_local_conteudos";
  const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

  let mes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let filtroConta = memoria.ler("cal_conta", "todas");
  let itens = [];
  let relogio = null;
  let arrastando = null;

  // ---------------- Datas ----------------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const deIso = (s) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); };
  const somarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const etapasFeitas = (c) => ETAPAS.filter(([k]) => c[k]).length;

  // Etapas puxam o status
  function statusDasEtapas(c) {
    if (c.etapa_publicado) return "publicado";
    if (c.etapa_gravar && c.etapa_editar && c.etapa_legenda) return "pronto";
    return "a_fazer";
  }

  const contas = () => App.contas.length ? App.contas : [{ id: "local", username: "sua_conta" }];
  const nomeConta = (id) => `@${contas().find((c) => c.id === id)?.username || "conta"}`;
  const variasContas = () => contas().length > 1;

  // ---------------- Dados ----------------
  async function ler(de, ate) {
    if (!App.remoto) {
      return memoria.ler(CHAVE_LOCAL, []).filter((c) => !c.data || (c.data >= de && c.data <= ate));
    }
    let q = sb.from("conteudos").select("*").or(`data.is.null,and(data.gte.${de},data.lte.${ate})`)
      .order("data", { ascending: true, nullsFirst: false }).order("criado_em", { ascending: true }).limit(1000);
    if (filtroConta !== "todas") q = q.eq("conta_id", filtroConta);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  async function salvar(item) {
    if (!App.remoto) {
      const lista = memoria.ler(CHAVE_LOCAL, []);
      const novo = { ...item, id: item.id || `local-${Date.now()}`, atualizado_em: new Date().toISOString() };
      const i = lista.findIndex((x) => x.id === novo.id);
      if (i >= 0) lista[i] = novo; else lista.push(novo);
      memoria.gravar(CHAVE_LOCAL, lista);
      return;
    }
    const linha = { ...item };
    if (!linha.id) delete linha.id;
    delete linha.criado_em; delete linha.atualizado_em; delete linha.criado_por;
    const { error } = await sb.from("conteudos").upsert(linha);
    if (error) throw error;
  }

  async function apagar(id) {
    if (!App.remoto) { memoria.gravar(CHAVE_LOCAL, memoria.ler(CHAVE_LOCAL, []).filter((x) => x.id !== id)); return; }
    const { error } = await sb.from("conteudos").delete().eq("id", id);
    if (error) throw error;
  }

  // ---------------- Carregar ----------------
  function faixaDoMes() {
    const inicio = somarDias(mes, -mes.getDay());
    const ultimo = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const fim = somarDias(ultimo, 6 - ultimo.getDay());
    return { inicio, fim };
  }

  async function carregar(silencioso = false) {
    const alvo = $("#cal-corpo");
    if (!alvo) return;
    if (!App.conta && App.remoto) {
      alvo.innerHTML = `<div class="cartao vazio"><div class="vazio-icone" data-icone="calendario"></div>
        <h2 class="subtitulo">Nenhuma conta liberada pra você</h2><p>Peça para a administradora liberar o acesso em "Contas e acessos".</p></div>`;
      pintarIcones(alvo);
      return;
    }
    if (filtroConta !== "todas" && !contas().some((c) => c.id === filtroConta)) filtroConta = "todas";
    const { inicio, fim } = faixaDoMes();
    try { itens = await ler(iso(inicio), iso(fim)); }
    catch (e) {
      console.warn(e);
      if (!silencioso) alvo.innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>Não foi possível ler o calendário. Rodou o 13_calendario.sql no Supabase?</span></div>`;
      return;
    }
    render();
    clearInterval(relogio);
    relogio = setInterval(() => {
      // não atualiza com um formulário aberto nem no meio de um arraste
      if (!document.hidden && !$(".modal-fundo") && !arrastando && !$("#secao-calendario").hidden) carregar(true);
    }, ATUALIZA_MS);
  }

  function parar() { clearInterval(relogio); }

  // ---------------- Desenhar ----------------
  function card(c) {
    const [emoji, formato] = FORMATOS[c.formato] || FORMATOS.outro;
    const feitas = etapasFeitas(c);
    const tema = c.tema || "(sem tema)";
    return `<button class="cal-card st-${esc(c.status)}" draggable="true" data-id="${esc(c.id)}"
        aria-label="${esc(`${formato}: ${tema}. ${STATUS[c.status]}. ${feitas} de 4 etapas.`)}" title="${esc(`${formato}: ${tema}`)}">
      <span class="cal-card-tema">${emoji} ${esc(tema)}</span>
      <span class="cal-card-meta"><span class="cal-status">${c.status === "publicado" ? "✓ " : ""}${STATUS[c.status]}</span> · ${feitas}/4${filtroConta === "todas" && variasContas() ? ` · ${esc(nomeConta(c.conta_id))}` : ""}</span>
    </button>`;
  }

  function render() {
    const alvo = $("#cal-corpo");
    const { inicio, fim } = faixaDoMes();
    const hoje = iso(new Date());
    const mesIso = iso(mes).slice(0, 7);
    const porDia = new Map();
    itens.filter((c) => c.data).forEach((c) => { if (!porDia.has(c.data)) porDia.set(c.data, []); porDia.get(c.data).push(c); });
    const semData = itens.filter((c) => !c.data);
    const doMes = itens.filter((c) => c.data && c.data.startsWith(mesIso));
    const cont = (s) => doMes.filter((c) => c.status === s).length;

    // grade
    let celulas = "";
    for (let d = inicio; d <= fim; d = somarDias(d, 1)) {
      const k = iso(d);
      const lista = porDia.get(k) || [];
      celulas += `<div class="cal-dia ${k.slice(0, 7) !== mesIso ? "fora" : ""} ${k === hoje ? "hoje" : ""}" data-dia="${k}">
        <div class="cal-dia-topo"><span class="cal-num">${d.getDate()}</span>
          <button class="cal-mais" data-novo="${k}" aria-label="Novo conteúdo em ${d.toLocaleDateString("pt-BR")}" title="Novo conteúdo neste dia">+</button></div>
        <div class="cal-itens">${lista.map(card).join("")}</div>
      </div>`;
    }

    // lista (celular): só os dias do mês com conteúdo
    const diasComItem = [...porDia.keys()].filter((k) => k.startsWith(mesIso)).sort();
    const agenda = diasComItem.length
      ? diasComItem.map((k) => `<div class="cal-agenda-dia ${k === hoje ? "hoje" : ""}">
          <div class="cal-agenda-data">${esc(deIso(k).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", ""))}</div>
          <div class="cal-itens">${porDia.get(k).map(card).join("")}</div></div>`).join("")
      : `<p class="texto-2 pequeno">Nada planejado neste mês ainda.</p>`;

    const seletor = variasContas() ? `<div class="segmentado" role="group" aria-label="Conta">
        <button class="${filtroConta === "todas" ? "ativo" : ""}" data-cal-conta="todas" aria-pressed="${filtroConta === "todas"}">Todas</button>
        ${contas().map((c) => `<button class="${filtroConta === c.id ? "ativo" : ""}" data-cal-conta="${esc(c.id)}" aria-pressed="${filtroConta === c.id}">@${esc(c.username || "conta")}</button>`).join("")}
      </div>` : "";

    alvo.innerHTML = `
      <div class="cal-topo">
        <div class="linha cal-nav">
          <button class="btn btn-icone btn-fantasma" data-cal="anterior" aria-label="Mês anterior">‹</button>
          <strong class="cal-titulo">${esc(mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))}</strong>
          <button class="btn btn-icone btn-fantasma" data-cal="proximo" aria-label="Próximo mês">›</button>
          ${mesIso !== hoje.slice(0, 7) ? `<button class="btn btn-p" data-cal="hoje">Hoje</button>` : ""}
        </div>
        ${seletor}
        <button class="btn btn-primario" data-novo=""><span data-icone="mais"></span> Novo conteúdo</button>
      </div>
      <p class="pequeno texto-2 cal-resumo">Neste mês: <strong>${doMes.length}</strong> ${doMes.length === 1 ? "conteúdo" : "conteúdos"} · ${cont("a_fazer")} a fazer · ${cont("pronto")} ${cont("pronto") === 1 ? "pronto" : "prontos"} · ${cont("publicado")} ${cont("publicado") === 1 ? "publicado" : "publicados"}</p>

      <div class="cal-layout">
        <div class="cartao cal-mes">
          <div class="cal-grade">
            ${SEMANA.map((s) => `<div class="cal-semana">${s}</div>`).join("")}
            ${celulas}
          </div>
          <div class="cal-agenda">${agenda}</div>
        </div>
        <aside class="cartao cal-ideias" data-dia="">
          <div class="linha-entre"><h2 class="titulo-card">💡 Ideias sem data</h2>
            <button class="btn btn-p" data-novo="" title="Nova ideia sem data">+ Ideia</button></div>
          <p class="pequeno texto-2" style="margin:4px 0 10px">Arraste uma ideia para um dia do calendário quando ela tiver data.</p>
          <div class="cal-itens">${semData.length ? semData.map(card).join("") : `<p class="pequeno texto-2">Nenhuma ideia guardada.</p>`}</div>
        </aside>
      </div>`;
    pintarIcones(alvo);
  }

  // ---------------- Formulário ----------------
  function abrirEditor(item) {
    const novo = !item.id;
    const c = {
      conta_id: filtroConta !== "todas" ? filtroConta : (App.conta?.id || contas()[0].id),
      data: null, formato: "reels", tema: "", legenda: "", notas: "", status: "a_fazer",
      etapa_gravar: false, etapa_editar: false, etapa_legenda: false, etapa_publicado: false,
      ...item,
    };
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `
      <form class="cartao modal modal-largo cal-form" novalidate aria-labelledby="cal-form-titulo">
        <div class="linha-entre" style="margin-bottom:12px">
          <h3 class="subtitulo" id="cal-form-titulo">${novo ? "Novo conteúdo" : "Editar conteúdo"}</h3>
          <button type="button" class="btn btn-icone btn-fantasma" data-f="fechar" aria-label="Fechar">✕</button>
        </div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="cf-data">Data</label>
            <input class="input" type="date" id="cf-data" value="${esc(c.data || "")}">
            <div class="ajuda">Em branco = ideia sem data.</div></div>
          <div class="campo"><label class="rotulo" for="cf-formato">Formato</label>
            <select class="select" id="cf-formato">${Object.entries(FORMATOS).map(([k, [e, n]]) => `<option value="${k}" ${k === c.formato ? "selected" : ""}>${e} ${n}</option>`).join("")}</select></div>
          ${variasContas() ? `<div class="campo"><label class="rotulo" for="cf-conta">Conta</label>
            <select class="select" id="cf-conta">${contas().map((x) => `<option value="${esc(x.id)}" ${x.id === c.conta_id ? "selected" : ""}>@${esc(x.username || "conta")}</option>`).join("")}</select></div>` : ""}
        </div>
        <div class="campo"><label class="rotulo" for="cf-tema">Tema</label>
          <input class="input" id="cf-tema" maxlength="160" placeholder="Ex: 3 sinais de que você pode trabalhar de casa" value="${esc(c.tema)}"></div>
        <div class="campo"><div class="linha-entre"><label class="rotulo" for="cf-legenda">Legenda</label><span class="contador" id="cf-cont">0/${LEGENDA_MAX}</span></div>
          <textarea class="textarea" id="cf-legenda" rows="6" maxlength="${LEGENDA_MAX}" placeholder="Rascunho da legenda...">${esc(c.legenda)}</textarea></div>
        <div class="campo"><span class="rotulo">Etapas</span>
          <div class="cal-etapas">${ETAPAS.map(([k, n]) => `<label class="cal-etapa"><input type="checkbox" data-etapa="${k}" ${c[k] ? "checked" : ""}> ${n}</label>`).join("")}</div></div>
        <div class="campo"><label class="rotulo" for="cf-status">Status</label>
          <select class="select" id="cf-status">${Object.entries(STATUS).map(([k, n]) => `<option value="${k}" ${k === c.status ? "selected" : ""}>${n}</option>`).join("")}</select>
          <div class="ajuda">Muda sozinho pelas etapas: gravar, editar e legenda = Pronto; publicado = Publicado. Dá para trocar na mão.</div></div>
        <div class="campo"><label class="rotulo" for="cf-notas">Observações</label>
          <textarea class="textarea" id="cf-notas" rows="2" placeholder="Referências, links, quem grava...">${esc(c.notas)}</textarea></div>
        <div class="linha" style="justify-content:space-between;margin-top:6px">
          ${novo ? "<span></span>" : `<button type="button" class="btn btn-perigo btn-fantasma" data-f="apagar"><span data-icone="lixo"></span> Excluir</button>`}
          <div class="linha"><button type="button" class="btn" data-f="fechar">Cancelar</button>
            <button type="submit" class="btn btn-primario">Salvar</button></div>
        </div>
      </form>`;
    pintarIcones(fundo);
    const f = (s) => $(s, fundo);
    const contar = () => { f("#cf-cont").textContent = `${f("#cf-legenda").value.length}/${LEGENDA_MAX}`; };
    contar();
    const fechar = () => { fundo.remove(); document.removeEventListener("keydown", tecla); };
    const tecla = (e) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", tecla);

    fundo.addEventListener("input", (e) => { if (e.target.id === "cf-legenda") contar(); });
    fundo.addEventListener("change", (e) => {
      // etapa marcada/desmarcada: o status acompanha
      if (e.target.dataset.etapa) {
        const etapas = {};
        $$("[data-etapa]", fundo).forEach((x) => { etapas[x.dataset.etapa] = x.checked; });
        f("#cf-status").value = statusDasEtapas(etapas);
      }
      // escolheu "Publicado" na mão: marca a etapa também
      if (e.target.id === "cf-status" && e.target.value === "publicado") f("[data-etapa=etapa_publicado]").checked = true;
    });
    fundo.addEventListener("click", async (e) => {
      if (e.target === fundo || e.target.closest("[data-f=fechar]")) return fechar();
      if (e.target.closest("[data-f=apagar]")) {
        const ok = await confirmar("Excluir conteúdo?", `"${c.tema || "Sem tema"}" sai do calendário para todo o time. Não dá para desfazer.`, "Excluir", true);
        if (!ok) return;
        try { await apagar(c.id); aviso("Conteúdo excluído."); fechar(); carregar(); }
        catch { aviso("Não foi possível excluir agora.", "erro"); }
      }
    });
    f("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const tema = f("#cf-tema").value.trim();
      if (!tema) { aviso("Dê um tema para o conteúdo.", "atencao"); f("#cf-tema").focus(); return; }
      const salvo = {
        ...(c.id ? { id: c.id } : {}),
        conta_id: f("#cf-conta")?.value || c.conta_id,
        data: f("#cf-data").value || null,
        formato: f("#cf-formato").value,
        tema, legenda: f("#cf-legenda").value, notas: f("#cf-notas").value.trim(),
        status: f("#cf-status").value,
      };
      $$("[data-etapa]", fundo).forEach((x) => { salvo[x.dataset.etapa] = x.checked; });
      const btn = $("button[type=submit]", fundo);
      btn.disabled = true; btn.textContent = "Salvando...";
      try {
        await salvar(salvo);
        aviso(novo ? "Conteúdo criado." : "Conteúdo salvo.", "ok");
        fechar();
        // criou num mês que não está na tela? vai pra ele
        if (salvo.data && salvo.data.slice(0, 7) !== iso(mes).slice(0, 7)) { const d = deIso(salvo.data); mes = new Date(d.getFullYear(), d.getMonth(), 1); }
        carregar();
      } catch (err) {
        console.warn(err);
        btn.disabled = false; btn.textContent = "Salvar";
        aviso("Não foi possível salvar agora.", "erro");
      }
    });
    document.body.appendChild(fundo);
    f("#cf-tema").focus();
  }

  // ---------------- Eventos ----------------
  const raiz = $("#cal-corpo");

  raiz.addEventListener("click", (e) => {
    const cartao = e.target.closest(".cal-card");
    if (cartao) { const c = itens.find((x) => x.id === cartao.dataset.id); if (c) abrirEditor(c); return; }
    const novo = e.target.closest("[data-novo]");
    if (novo) return abrirEditor({ data: novo.dataset.novo || null });
    const contaBtn = e.target.closest("[data-cal-conta]");
    if (contaBtn) { filtroConta = contaBtn.dataset.calConta; memoria.gravar("cal_conta", filtroConta); return carregar(); }
    const nav = e.target.closest("[data-cal]");
    if (nav) {
      const a = nav.dataset.cal;
      if (a === "anterior") mes = new Date(mes.getFullYear(), mes.getMonth() - 1, 1);
      if (a === "proximo") mes = new Date(mes.getFullYear(), mes.getMonth() + 1, 1);
      if (a === "hoje") mes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      return carregar();
    }
    // clique no espaço vazio de um dia: novo conteúdo naquele dia
    const dia = e.target.closest(".cal-dia");
    if (dia && !e.target.closest(".cal-card")) abrirEditor({ data: dia.dataset.dia });
  });

  // Arrastar e soltar: muda a data (ou tira, soltando em "Ideias sem data")
  raiz.addEventListener("dragstart", (e) => {
    const cartao = e.target.closest?.(".cal-card");
    if (!cartao) return;
    arrastando = cartao.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", arrastando);
    cartao.classList.add("arrastando");
  });
  raiz.addEventListener("dragend", () => {
    arrastando = null;
    $$(".arrastando, .soltar-aqui", raiz).forEach((el) => el.classList.remove("arrastando", "soltar-aqui"));
  });
  raiz.addEventListener("dragover", (e) => {
    const alvo = e.target.closest(".cal-dia, .cal-ideias");
    if (!alvo || !arrastando) return;
    e.preventDefault();
    $$(".soltar-aqui", raiz).forEach((el) => { if (el !== alvo) el.classList.remove("soltar-aqui"); });
    alvo.classList.add("soltar-aqui");
  });
  raiz.addEventListener("drop", async (e) => {
    const alvo = e.target.closest(".cal-dia, .cal-ideias");
    if (!alvo || !arrastando) return;
    e.preventDefault();
    const c = itens.find((x) => x.id === arrastando);
    const novaData = alvo.dataset.dia || null;
    arrastando = null;
    alvo.classList.remove("soltar-aqui");
    if (!c || (c.data || null) === novaData) return;
    try {
      c.data = novaData;
      render();
      await salvar({ ...c });
      aviso(novaData ? `Movido para ${deIso(novaData).toLocaleDateString("pt-BR")}.` : "Virou ideia sem data.", "ok");
    } catch { aviso("Não foi possível mover agora.", "erro"); }
    carregar(true);
  });

  window.Calendario = { carregar, parar };
})();
