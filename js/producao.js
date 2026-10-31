// =====================================================================
// producao.js: "Produção de Conteúdo" (Kanban)
// - 6 colunas que agrupam as 18 etapas da ficha (ficha.js)
// - arrastar para outra coluna muda a etapa (para a primeira da coluna);
//   dentro do cartão dá para escolher a etapa exata
// - é o MESMO registro do Calendário e da Ficha: mudou aqui, muda lá,
//   e o histórico anota quem mudou (23_ficha_conteudo.sql)
// - só contas com o recurso 'producao'; só visualização: sem arrastar
// =====================================================================
(function () {
  const ORIGENS = { autoral: "Autoral", remix: "Remix", curadoria: "Curadoria", terceiros: "Terceiros", ia: "Apoio de IA" };
  const FORMATOS = { reels: "🎬", carrossel: "🖼️", post: "📷", story: "⏱️", live: "🔴", outro: "✨" };

  let filtroConta = "todas";
  let filtroCampanha = "";
  let mostrar = memoria.ler("prod_mostrar", "ativos"); // ativos | todos
  let busca = "";
  let itens = [], campanhas = [], tarefas = [];
  const membros = new Map(); // user_id -> e-mail (responsáveis)
  let arrastando = null;

  const colunas = () => window.Ficha.ETAPAS;
  const contasProd = () => App.contas.filter((c) => c.recursos?.includes("producao"));
  const nomeConta = (id) => `@${App.contas.find((c) => c.id === id)?.username || "conta"}`;
  const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dataCurta = (s) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", ""); };
  const colunaDe = (etapa) => colunas().findIndex(([, l]) => l.some(([k]) => k === etapa));

  // ---------------- Dados ----------------
  async function ler() {
    const ids = filtroConta === "todas" ? contasProd().map((c) => c.id) : [filtroConta];
    if (!ids.length) { itens = []; return; }
    let q = sb.from("conteudos").select("*").in("conta_id", ids).order("data", { ascending: true, nullsFirst: false }).limit(500);
    if (mostrar === "ativos") q = q.neq("etapa", "finalizado");
    const [c, k, t] = await Promise.all([
      q,
      sb.from("campanhas").select("id, nome, conta_id").in("conta_id", ids).order("criado_em"),
      sb.from("tarefas").select("conteudo_id, status, data").in("conta_id", ids).not("conteudo_id", "is", null).limit(3000),
    ]);
    if (c.error) throw c.error;
    itens = c.data ?? []; campanhas = k.data ?? []; tarefas = t.data ?? [];
    // e-mails de quem é responsável (uma consulta por conta)
    const r = await Promise.all(ids.map((id) => sb.rpc("membros_da_conta", { p_conta: id })));
    r.forEach((x) => (x.data ?? []).forEach((p) => membros.set(p.user_id, p.email)));
  }

  async function carregar() {
    const alvo = $("#prod-corpo");
    if (!alvo) return;
    if (!App.remoto || !contasProd().length) {
      alvo.innerHTML = `<div class="cartao vazio"><div class="vazio-icone" data-icone="grade"></div><h2 class="subtitulo">Produção não ligada</h2><p>Nenhuma conta sua tem o recurso de Produção.</p></div>`;
      pintarIcones(alvo);
      return;
    }
    if (filtroConta !== "todas" && !contasProd().some((c) => c.id === filtroConta)) filtroConta = "todas";
    try { await ler(); }
    catch (e) {
      console.warn(e);
      alvo.innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>Não foi possível ler a produção. Rodou o 23_ficha_conteudo.sql?</span></div>`;
      return;
    }
    render();
  }

  // ---------------- Desenhar ----------------
  function cartao(c) {
    const ts = tarefas.filter((t) => t.conteudo_id === c.id);
    const feitas = ts.filter((t) => t.status === "feita").length;
    const atrasadas = ts.filter((t) => t.status !== "feita" && t.data && t.data < hoje()).length;
    const camp = campanhas.find((k) => k.id === c.campanha_id);
    const [, lista] = colunas()[Math.max(0, colunaDe(c.etapa))];
    const resp = [["resp_gravacao", "🎥"], ["resp_edicao", "✂️"], ["resp_aprovacao", "✅"]]
      .filter(([k]) => c[k]).map(([k, e]) => `${e} ${esc((membros.get(c[k]) || "alguém").split("@")[0])}`).join(" · ");
    return `<div class="pd-card ${atrasadas ? "atrasado" : ""}" draggable="${!App.leitor}" data-id="${esc(c.id)}">
      <button class="pd-abrir" data-abrir="${esc(c.id)}" title="Abrir a ficha">
        <span class="pequeno texto-2">#${esc(c.numero)} · ${c.data ? esc(dataCurta(c.data)) : "sem data"}${contasProd().length > 1 && filtroConta === "todas" ? ` · ${esc(nomeConta(c.conta_id))}` : ""}</span>
        <strong class="pd-titulo">${FORMATOS[c.formato] || "✨"} ${esc(c.titulo || c.tema || "Sem título")}</strong>
      </button>
      <div class="chips">${c.origem ? `<span class="chip">${esc(ORIGENS[c.origem])}</span>` : ""}${camp ? `<span class="chip chip-destaque">${esc(camp.nome)}</span>` : ""}${ts.length ? `<span class="chip">${feitas}/${ts.length} tarefas</span>` : ""}${atrasadas ? `<span class="chip pd-chip-atraso">${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}</span>` : ""}</div>
      ${resp ? `<div class="pequeno texto-2 pd-resp">${resp}</div>` : ""}
      <select class="select pd-etapa" data-etapa="${esc(c.id)}" aria-label="Etapa" ${App.leitor ? "disabled" : ""}>
        ${lista.map(([k, n]) => `<option value="${k}" ${k === c.etapa ? "selected" : ""}>${esc(n)}</option>`).join("")}
      </select>
    </div>`;
  }

  function render() {
    const alvo = $("#prod-corpo");
    const t = busca.trim().toLowerCase();
    const lista = itens.filter((c) => (!filtroCampanha || c.campanha_id === filtroCampanha)
      && (!t || `${c.titulo} ${c.tema} ${c.pilar}`.toLowerCase().includes(t)));
    const porColuna = colunas().map(() => []);
    lista.forEach((c) => porColuna[Math.max(0, colunaDe(c.etapa))].push(c));
    const seletorConta = contasProd().length > 1 ? `<select class="select" data-pd="conta" aria-label="Conta">
        <option value="todas">Todas as contas</option>${contasProd().map((c) => `<option value="${esc(c.id)}" ${c.id === filtroConta ? "selected" : ""}>@${esc(c.username)}</option>`).join("")}</select>` : "";
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <input class="input" type="search" data-pd="busca" placeholder="Buscar por título ou pilar..." aria-label="Buscar" value="${esc(busca)}">
        ${seletorConta}
        <select class="select" data-pd="campanha" aria-label="Campanha"><option value="">Todas as campanhas</option>${campanhas.map((k) => `<option value="${esc(k.id)}" ${k.id === filtroCampanha ? "selected" : ""}>${esc(k.nome)}</option>`).join("")}</select>
        <div class="segmentado" role="group" aria-label="Quais mostrar">
          <button class="${mostrar === "ativos" ? "ativo" : ""}" data-mostrar="ativos" aria-pressed="${mostrar === "ativos"}">Em andamento</button>
          <button class="${mostrar === "todos" ? "ativo" : ""}" data-mostrar="todos" aria-pressed="${mostrar === "todos"}">Com finalizados</button>
        </div>
        <button class="btn btn-primario so-edicao" data-pd-novo><span data-icone="mais"></span> Novo conteúdo</button>
      </div>
      <p class="pequeno texto-2" style="margin:0 0 12px">${lista.length} ${lista.length === 1 ? "conteúdo" : "conteúdos"}. Arraste o cartão para outra coluna ou escolha a etapa exata no cartão. Muda também na ficha e no Calendário.</p>
      <div class="pd-quadro">
        ${colunas().map(([nome], i) => `
          <section class="pd-coluna" data-coluna="${i}" aria-label="${esc(nome)}">
            <header class="pd-coluna-topo"><strong>${esc(nome)}</strong><span class="pd-conta">${porColuna[i].length}</span></header>
            <div class="pd-itens">${porColuna[i].map(cartao).join("") || `<p class="pequeno texto-3 pd-vazio">Nada aqui.</p>`}</div>
          </section>`).join("")}
      </div>`;
    pintarIcones(alvo);
  }

  // ---------------- Mudar etapa ----------------
  async function mudarEtapa(id, etapa) {
    const c = itens.find((x) => x.id === id);
    if (!c || c.etapa === etapa) return;
    const antes = c.etapa;
    c.etapa = etapa;
    render();
    const { error } = await sb.from("conteudos").update({ etapa }).eq("id", id);
    if (error) { c.etapa = antes; render(); return aviso("Não foi possível mudar a etapa agora.", "erro"); }
    aviso(`Etapa: ${window.Ficha.ETAPA[etapa]}.`, "ok");
  }

  // ---------------- Eventos ----------------
  const raiz = $("#prod-corpo");
  const recarregar = () => carregar();

  raiz.addEventListener("click", (e) => {
    const abrir = e.target.closest("[data-abrir]");
    if (abrir) { const c = itens.find((x) => x.id === abrir.dataset.abrir); if (c) window.Ficha.abrir(c, recarregar); return; }
    if (e.target.closest("[data-pd-novo]")) {
      const conta = filtroConta !== "todas" ? filtroConta : (contasProd().find((c) => c.id === App.conta?.id) ?? contasProd()[0]).id;
      return window.Ficha.abrir({ conta_id: conta, data: null }, recarregar);
    }
    const m = e.target.closest("[data-mostrar]");
    if (m) { mostrar = m.dataset.mostrar; memoria.gravar("prod_mostrar", mostrar); return carregar(); }
  });
  raiz.addEventListener("change", (e) => {
    if (e.target.dataset.etapa) return mudarEtapa(e.target.dataset.etapa, e.target.value);
    if (e.target.dataset.pd === "conta") { filtroConta = e.target.value; filtroCampanha = ""; return carregar(); }
    if (e.target.dataset.pd === "campanha") { filtroCampanha = e.target.value; return render(); }
  });
  raiz.addEventListener("input", (e) => {
    if (e.target.dataset.pd !== "busca") return;
    busca = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const b = $("[data-pd=busca]", raiz); b.focus(); b.setSelectionRange(pos, pos);
  });

  raiz.addEventListener("dragstart", (e) => {
    const card = e.target.closest?.(".pd-card");
    if (!card || App.leitor || e.target.closest("select")) return;
    arrastando = card.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", arrastando);
    card.classList.add("arrastando");
  });
  raiz.addEventListener("dragend", () => {
    arrastando = null;
    $$(".arrastando, .soltar-aqui", raiz).forEach((el) => el.classList.remove("arrastando", "soltar-aqui"));
  });
  raiz.addEventListener("dragover", (e) => {
    const col = e.target.closest(".pd-coluna");
    if (!col || !arrastando) return;
    e.preventDefault();
    $$(".soltar-aqui", raiz).forEach((el) => { if (el !== col) el.classList.remove("soltar-aqui"); });
    col.classList.add("soltar-aqui");
  });
  raiz.addEventListener("drop", (e) => {
    const col = e.target.closest(".pd-coluna");
    if (!col || !arrastando) return;
    e.preventDefault();
    const id = arrastando;
    arrastando = null;
    col.classList.remove("soltar-aqui");
    const c = itens.find((x) => x.id === id);
    const i = Number(col.dataset.coluna);
    if (!c || colunaDe(c.etapa) === i) return;
    mudarEtapa(id, colunas()[i][1][0][0]); // primeira etapa da coluna
  });

  window.Producao = { carregar };
})();
