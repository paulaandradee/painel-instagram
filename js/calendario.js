// =====================================================================
// calendario.js: o "Calendário" (planejamento de conteúdo do time)
// - visões Mês, Semana, Dia e Lista (no celular o mês vira lista por dia)
// - conteúdo: data (opcional), conta, formato, tema, legenda, notas,
//   etapas (gravar, editar, legenda, publicado) e status
// - contas com o recurso 'producao' (ig_contas.recursos) abrem a Ficha
//   completa (ficha.js) e mostram tarefas (gravação, edição, aprovação...),
//   compromissos e campanhas; as outras seguem com o formulário simples
// - etapas puxam o status: gravar+editar+legenda = Pronto; publicado = Publicado
// - arrastar um conteúdo ou tarefa muda a data; soltar em "Ideias sem
//   data" tira a data do conteúdo
// - sessões de estudo da Formação (só a administradora vê): cor própria,
//   clique abre a sessão, arrastar remarca
// - todo mundo da conta vê; a tela se atualiza sozinha a cada 30s
// Mudar uma data aqui nunca mexe em nada já agendado na Meta.
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
  const VISOES = { mes: "Mês", semana: "Semana", dia: "Dia", lista: "Lista" };
  // Filtros: o que cada um mostra
  const FILTROS = {
    tudo: "Tudo", conteudos: "Conteúdos", estudos: "Estudos", gravacao: "Gravações", edicao: "Edições",
    aprovacao: "Aprovações", campanhas: "Campanhas", compromisso: "Compromissos",
  };
  const TIPOS_TAREFA = {
    roteiro: "✍️ Roteiro", arte: "🎨 Arte", gravacao: "🎥 Gravação", edicao: "✂️ Edição", aprovacao: "✅ Aprovação",
    agendamento: "🗓️ Agendamento", analise: "📊 Análise", compromisso: "📌 Compromisso", outro: "• Tarefa",
  };

  let ref = new Date();          // um dia dentro do período mostrado
  let visao = memoria.ler("cal_visao", "mes");
  let filtroConta = memoria.ler("cal_conta", "todas");
  let filtroTipo = memoria.ler("cal_tipo", "tudo");
  let itens = [];                // conteúdos
  let tarefas = [];
  let campanhas = [];
  let estudos = [];              // sessões da Formação no período
  let relogio = null;
  let arrastando = null;         // { tipo: "conteudo" | "tarefa" | "estudo", id }

  // ---------------- Datas ----------------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const deIso = (s) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); };
  const somarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
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
  const temProducao = (contaId) => !!contas().find((c) => c.id === contaId)?.recursos?.includes("producao");
  // contas na tela agora (o filtro de conta)
  const contasVisiveis = () => (filtroConta === "todas" ? contas() : contas().filter((c) => c.id === filtroConta));
  const producaoNaTela = () => App.remoto && contasVisiveis().some((c) => temProducao(c.id));
  const temEstudos = () => App.remoto && App.admin;
  const recursosAvancados = () => producaoNaTela() || temEstudos();

  // Quais filtros fazem sentido para quem está vendo
  function filtrosDisponiveis() {
    return Object.keys(FILTROS).filter((k) => {
      if (k === "estudos") return temEstudos();
      if (["gravacao", "edicao", "aprovacao", "campanhas", "compromisso"].includes(k)) return producaoNaTela();
      return true;
    });
  }

  // ---------------- Período da visão ----------------
  function periodo() {
    if (visao === "semana") { const inicio = somarDias(ref, -ref.getDay()); return { inicio, fim: somarDias(inicio, 6) }; }
    if (visao === "dia") return { inicio: ref, fim: ref };
    const mes = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    if (visao === "lista") return { inicio: mes, fim: ultimo };
    return { inicio: somarDias(mes, -mes.getDay()), fim: somarDias(ultimo, 6 - ultimo.getDay()) };
  }

  function tituloPeriodo() {
    const { inicio, fim } = periodo();
    if (visao === "semana") {
      const mesmoMes = inicio.getMonth() === fim.getMonth();
      return `${inicio.getDate()}${mesmoMes ? "" : ` de ${inicio.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}`} a ${fim.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })}`;
    }
    if (visao === "dia") return ref.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    return ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }

  function andar(passo) {
    if (visao === "semana") ref = somarDias(ref, 7 * passo);
    else if (visao === "dia") ref = somarDias(ref, passo);
    else ref = new Date(ref.getFullYear(), ref.getMonth() + passo, 1);
  }

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

  async function lerTarefas(de, ate) {
    if (!producaoNaTela()) return [];
    let q = sb.from("tarefas").select("*").gte("data", de).lte("data", ate).order("data").limit(1000);
    if (filtroConta !== "todas") q = q.eq("conta_id", filtroConta);
    const { data, error } = await q;
    if (error) { console.warn(error); return []; }
    return data ?? [];
  }

  async function lerCampanhas(de, ate) {
    if (!producaoNaTela()) return [];
    let q = sb.from("campanhas").select("*").order("inicio");
    if (filtroConta !== "todas") q = q.eq("conta_id", filtroConta);
    const { data, error } = await q;
    if (error) { console.warn(error); return []; }
    // só as que têm início, lançamento ou fim no período
    return (data ?? []).filter((k) => [k.inicio, k.lancamento, k.fim].some((d) => d && d >= de && d <= ate));
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
    delete linha.criado_em; delete linha.atualizado_em; delete linha.criado_por; delete linha.numero;
    const { error } = await sb.from("conteudos").upsert(linha);
    if (error) throw error;
  }

  // Só a data (arrastar): não mexe no resto da ficha
  async function mudarData(c, data) {
    if (!App.remoto) return salvar({ ...c, data });
    const { error } = await sb.from("conteudos").update({ data }).eq("id", c.id);
    if (error) throw error;
  }

  async function apagar(id) {
    if (!App.remoto) { memoria.gravar(CHAVE_LOCAL, memoria.ler(CHAVE_LOCAL, []).filter((x) => x.id !== id)); return; }
    const { error } = await sb.from("conteudos").delete().eq("id", id);
    if (error) throw error;
  }

  // ---------------- Carregar ----------------
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
    if (!recursosAvancados()) visao = "mes";
    if (!filtrosDisponiveis().includes(filtroTipo)) filtroTipo = "tudo";
    const { inicio, fim } = periodo();
    const [de, ate] = [iso(inicio), iso(fim)];
    try {
      [itens, tarefas, campanhas, estudos] = await Promise.all([
        ler(de, ate), lerTarefas(de, ate), lerCampanhas(de, ate),
        temEstudos() ? window.Formacao?.sessoesEntre(de, ate) ?? [] : [],
      ]);
    } catch (e) {
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

  // ---------------- Cartões ----------------
  function card(c) {
    const [emoji, formato] = FORMATOS[c.formato] || FORMATOS.outro;
    const tema = c.titulo || c.tema || "(sem tema)";
    const conta = filtroConta === "todas" && variasContas() ? ` · ${esc(nomeConta(c.conta_id))}` : "";
    if (temProducao(c.conta_id)) {
      const etapa = window.Ficha?.ETAPA[c.etapa] ?? c.etapa;
      return `<button class="cal-card st-${esc(c.status)}" draggable="${!App.leitor}" data-id="${esc(c.id)}"
          aria-label="${esc(`${formato}: ${tema}. ${etapa}.`)}" title="${esc(`${formato}: ${tema}`)}">
        <span class="cal-card-tema">${c.hora ? `${esc(hhmm(c.hora))} ` : ""}${emoji} ${esc(tema)}</span>
        <span class="cal-card-meta"><span class="cal-status">${esc(etapa)}</span>${c.origem ? ` · ${esc(window.Ficha?.ORIGENS[c.origem] ?? c.origem)}` : ""}${conta}</span>
      </button>`;
    }
    const feitas = etapasFeitas(c);
    return `<button class="cal-card st-${esc(c.status)}" draggable="${!App.leitor}" data-id="${esc(c.id)}"
        aria-label="${esc(`${formato}: ${tema}. ${STATUS[c.status]}. ${feitas} de 4 etapas.`)}" title="${esc(`${formato}: ${tema}`)}">
      <span class="cal-card-tema">${emoji} ${esc(tema)}</span>
      <span class="cal-card-meta"><span class="cal-status">${c.status === "publicado" ? "✓ " : ""}${STATUS[c.status]}</span> · ${feitas}/4${conta}</span>
    </button>`;
  }

  function cardTarefa(t) {
    const dono = itens.find((c) => c.id === t.conteudo_id);
    const nome = t.titulo || TIPOS_TAREFA[t.tipo].replace(/^\S+\s/, "");
    return `<button class="cal-card cal-tarefa tp-${esc(t.tipo)} st-${esc(t.status)}" draggable="${!App.leitor}" data-tarefa="${esc(t.id)}"
        aria-label="${esc(`${TIPOS_TAREFA[t.tipo]}: ${nome}${dono ? `, de ${dono.titulo || dono.tema}` : ""}. ${t.status === "feita" ? "Feita" : "A fazer"}.`)}"
        title="${esc(`${TIPOS_TAREFA[t.tipo]}: ${nome}${dono ? ` · ${dono.titulo || dono.tema}` : ""}`)}">
      <span class="cal-card-tema">${t.hora ? `${esc(hhmm(t.hora))} ` : ""}${esc(TIPOS_TAREFA[t.tipo].split(" ")[0])} ${t.status === "feita" ? "✓ " : ""}${esc(nome)}</span>
      ${dono ? `<span class="cal-card-meta">${esc(dono.titulo || dono.tema)}</span>` : ""}
    </button>`;
  }

  function cardCampanha(k, dia) {
    const marco = dia === k.lancamento ? "🚀 Lançamento" : dia === k.fim ? "🏁 Fim" : "🎯 Início";
    return `<button class="cal-card cal-campanha" data-campanha="${esc(k.id)}" title="${esc(`Campanha: ${k.nome}`)}">
      <span class="cal-card-tema">${esc(marco)}: ${esc(k.nome)}</span><span class="cal-card-meta">Campanha</span></button>`;
  }

  function cardEstudo(s) {
    const hora = hhmm(s.inicio);
    const st = s.status === "feita" ? "✓ Feita" : s.status === "nao_feita" ? "Não feita" : "Estudo";
    return `<button class="cal-card cal-estudo st-${esc(s.status)}" draggable="true" data-estudo="${esc(s.id)}"
        aria-label="${esc(`Estudo, ${hora}: ${s.tema}. ${st}.`)}" title="${esc(`🎓 ${hora} · ${s.tema}`)}">
      <span class="cal-card-tema">${esc(hora)} 🎓 ${esc(s.tema)}</span>
      <span class="cal-card-meta">${st}${s.flexivel ? " · flexível" : ""}</span>
    </button>`;
  }

  // Tudo o que aparece num dia, já filtrado e em ordem de horário
  function itensPorDia() {
    const ver = (k) => filtroTipo === "tudo" || filtroTipo === k;
    const mapa = new Map();
    const por = (dia, hora, html) => { if (!dia) return; if (!mapa.has(dia)) mapa.set(dia, []); mapa.get(dia).push({ hora: hhmm(hora) || "99", html }); };
    if (ver("conteudos")) itens.forEach((c) => por(c.data, c.hora, card(c)));
    if (ver("estudos") && temEstudos()) estudos.forEach((s) => por(s.data, s.inicio, cardEstudo(s)));
    tarefas.forEach((t) => {
      const tipo = ["gravacao", "edicao", "aprovacao", "compromisso"].includes(t.tipo) ? t.tipo : null;
      if (filtroTipo === "tudo" || filtroTipo === tipo) por(t.data, t.hora, cardTarefa(t));
    });
    if (ver("campanhas")) campanhas.forEach((k) => [...new Set([k.inicio, k.lancamento, k.fim])].forEach((d) => por(d, null, cardCampanha(k, d))));
    mapa.forEach((l) => l.sort((a, b) => a.hora.localeCompare(b.hora)));
    return mapa;
  }
  const htmlDia = (mapa, k) => (mapa.get(k) || []).map((x) => x.html).join("");

  // ---------------- Desenhar ----------------
  function render() {
    const alvo = $("#cal-corpo");
    const { inicio, fim } = periodo();
    const hoje = iso(new Date());
    const mesIso = iso(ref).slice(0, 7);
    const porDia = itensPorDia();
    const semData = itens.filter((c) => !c.data);
    const doMes = itens.filter((c) => c.data && c.data.startsWith(mesIso));
    const cont = (s) => doMes.filter((c) => c.status === s).length;
    const estudosDoMes = estudos.filter((s) => s.data.startsWith(mesIso));
    const avancado = recursosAvancados();
    const maisBtn = (k, d) => `<button class="cal-mais so-edicao" data-novo="${k}" aria-label="Novo conteúdo em ${d.toLocaleDateString("pt-BR")}" title="Novo conteúdo neste dia">+</button>`;

    // lista por dia (visão Lista, Dia e o mês no celular)
    const agendaDe = (dias, vazio) => (dias.length
      ? dias.map((k) => `<div class="cal-agenda-dia ${k === hoje ? "hoje" : ""}" data-dia="${k}">
          <div class="cal-agenda-data">${esc(deIso(k).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", ""))}</div>
          <div class="cal-itens">${htmlDia(porDia, k)}</div></div>`).join("")
      : `<p class="texto-2 pequeno">${vazio}</p>`);
    const diasComItem = [...porDia.keys()].filter((k) => k >= iso(inicio) && k <= iso(fim) && (visao !== "mes" || k.startsWith(mesIso))).sort();

    let corpo;
    if (visao === "mes" || visao === "semana") {
      let celulas = "";
      for (let d = inicio; d <= fim; d = somarDias(d, 1)) {
        const k = iso(d);
        celulas += `<div class="cal-dia ${visao === "mes" && k.slice(0, 7) !== mesIso ? "fora" : ""} ${k === hoje ? "hoje" : ""}" data-dia="${k}">
          <div class="cal-dia-topo"><span class="cal-num">${d.getDate()}</span>${maisBtn(k, d)}</div>
          <div class="cal-itens">${htmlDia(porDia, k)}</div>
        </div>`;
      }
      corpo = `
        <div class="cartao cal-mes ${visao === "semana" ? "cal-vista-semana" : ""}">
          <div class="cal-grade">${SEMANA.map((s, i) => `<div class="cal-semana">${s}${visao === "semana" ? ` ${somarDias(inicio, i).getDate()}` : ""}</div>`).join("")}${celulas}</div>
          <div class="cal-agenda">${agendaDe(diasComItem, visao === "mes" ? "Nada planejado neste mês ainda." : "Nada planejado nesta semana.")}</div>
        </div>`;
    } else if (visao === "dia") {
      const k = iso(ref);
      corpo = `<div class="cartao cal-mes cal-vista-dia" data-dia="${k}">
          <div class="linha-entre" style="margin-bottom:8px"><strong>${esc(tituloPeriodo())}</strong>${maisBtn(k, ref)}</div>
          <div class="cal-itens">${htmlDia(porDia, k) || `<p class="texto-2 pequeno">Nada neste dia.</p>`}</div></div>`;
    } else {
      corpo = `<div class="cartao cal-mes cal-vista-lista">${agendaDe(diasComItem, "Nada neste mês com esse filtro.")}</div>`;
    }

    const seletor = variasContas() ? `<div class="segmentado" role="group" aria-label="Conta">
        <button class="${filtroConta === "todas" ? "ativo" : ""}" data-cal-conta="todas" aria-pressed="${filtroConta === "todas"}">Todas</button>
        ${contas().map((c) => `<button class="${filtroConta === c.id ? "ativo" : ""}" data-cal-conta="${esc(c.id)}" aria-pressed="${filtroConta === c.id}">@${esc(c.username || "conta")}</button>`).join("")}
      </div>` : "";
    const seletorVisao = avancado ? `<div class="segmentado" role="group" aria-label="Visão">
        ${Object.entries(VISOES).map(([k, n]) => `<button class="${visao === k ? "ativo" : ""}" data-cal-visao="${k}" aria-pressed="${visao === k}">${n}</button>`).join("")}
      </div>` : "";
    const filtros = filtrosDisponiveis();
    const seletorTipo = avancado && filtros.length > 1 ? `<div class="chips-periodo cal-filtros" role="group" aria-label="O que mostrar">
        ${filtros.map((k) => `<button class="chip-periodo ${filtroTipo === k ? "ativo" : ""}" data-cal-tipo="${k}" aria-pressed="${filtroTipo === k}">${FILTROS[k]}</button>`).join("")}
      </div>` : "";
    const ehHoje = visao === "dia" ? iso(ref) === hoje : visao === "semana" ? hoje >= iso(inicio) && hoje <= iso(fim) : mesIso === hoje.slice(0, 7);
    const tarefasPend = tarefas.filter((t) => t.status !== "feita" && t.data && t.data < hoje).length;

    alvo.innerHTML = `
      <div class="cal-topo">
        <div class="linha cal-nav">
          <button class="btn btn-icone btn-fantasma" data-cal="anterior" aria-label="Anterior">‹</button>
          <strong class="cal-titulo">${esc(tituloPeriodo())}</strong>
          <button class="btn btn-icone btn-fantasma" data-cal="proximo" aria-label="Próximo">›</button>
          ${ehHoje ? "" : `<button class="btn btn-p" data-cal="hoje">Hoje</button>`}
        </div>
        ${seletorVisao}
        ${seletor}
        <div class="linha cal-novos">
          ${producaoNaTela() ? `<button class="btn btn-p so-edicao" data-nova-tarefa="" title="Tarefa ou compromisso fora de um conteúdo"><span data-icone="mais"></span> Compromisso</button>` : ""}
          <button class="btn btn-primario so-edicao" data-novo=""><span data-icone="mais"></span> Novo conteúdo</button>
        </div>
      </div>
      ${seletorTipo}
      <p class="pequeno texto-2 cal-resumo">Neste mês: <strong>${doMes.length}</strong> ${doMes.length === 1 ? "conteúdo" : "conteúdos"} · ${cont("a_fazer")} a fazer · ${cont("pronto")} ${cont("pronto") === 1 ? "pronto" : "prontos"} · ${cont("publicado")} ${cont("publicado") === 1 ? "publicado" : "publicados"}${temEstudos() && visao === "mes" ? ` · <span class="cal-estudo-rotulo">🎓 ${estudosDoMes.length} ${estudosDoMes.length === 1 ? "sessão" : "sessões"} de estudo</span>` : ""}${tarefasPend ? ` · <strong class="cal-atrasadas">${tarefasPend} ${tarefasPend === 1 ? "tarefa atrasada" : "tarefas atrasadas"}</strong>` : ""}</p>

      <div class="cal-layout ${visao === "mes" || visao === "semana" ? "" : "sem-ideias"}">
        ${corpo}
        ${visao === "mes" || visao === "semana" ? `<aside class="cartao cal-ideias" data-dia="">
          <div class="linha-entre"><h2 class="titulo-card">💡 Ideias sem data</h2>
            <button class="btn btn-p so-edicao" data-novo="" title="Nova ideia sem data">+ Ideia</button></div>
          <p class="pequeno texto-2" style="margin:4px 0 10px">Arraste uma ideia para um dia do calendário quando ela tiver data.</p>
          <div class="cal-itens">${semData.length ? semData.map(card).join("") : `<p class="pequeno texto-2">Nenhuma ideia guardada.</p>`}</div>
        </aside>` : ""}
      </div>`;
    pintarIcones(alvo);
  }

  // ---------------- Abrir: ficha completa ou formulário simples ----------------
  function contaPadrao() { return filtroConta !== "todas" ? filtroConta : (App.conta?.id || contas()[0].id); }

  function abrirConteudo(item) {
    const contaId = item.conta_id || contaPadrao();
    if (App.remoto && temProducao(contaId) && window.Ficha) return window.Ficha.abrir({ ...item, conta_id: contaId }, () => carregar(true));
    return abrirEditor(item);
  }

  // ---------------- Formulário simples (contas sem 'producao') ----------------
  function abrirEditor(item) {
    const novo = !item.id;
    const c = {
      conta_id: contaPadrao(),
      data: null, formato: "reels", tema: "", legenda: "", notas: "", status: "a_fazer",
      etapa_gravar: false, etapa_editar: false, etapa_legenda: false, etapa_publicado: false,
      ...item,
    };
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `
      <form class="cartao modal modal-largo cal-form" novalidate aria-labelledby="cal-form-titulo">
        <div class="linha-entre" style="margin-bottom:12px">
          <h3 class="subtitulo" id="cal-form-titulo">${App.leitor ? "Conteúdo" : novo ? "Novo conteúdo" : "Editar conteúdo"}</h3>
          <button type="button" class="btn btn-icone btn-fantasma" data-f="fechar" aria-label="Fechar">✕</button>
        </div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="cf-data">Data</label>
            <input class="input" type="date" id="cf-data" value="${esc(c.data || "")}">
            <div class="ajuda">Em branco = ideia sem data.</div></div>
          <div class="campo"><label class="rotulo" for="cf-formato">Formato</label>
            <select class="select" id="cf-formato">${Object.entries(FORMATOS).map(([k, [e, n]]) => `<option value="${k}" ${k === c.formato ? "selected" : ""}>${e} ${n}</option>`).join("")}</select></div>
          ${variasContas() && novo ? `<div class="campo"><label class="rotulo" for="cf-conta">Conta</label>
            <select class="select" id="cf-conta">${contas().map((x) => `<option value="${esc(x.id)}" ${x.id === c.conta_id ? "selected" : ""}>@${esc(x.username || "conta")}</option>`).join("")}</select>
            <div class="ajuda">Contas com Produção abrem a ficha completa.</div></div>` : ""}
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
          ${novo ? "<span></span>" : `<button type="button" class="btn btn-perigo btn-fantasma so-edicao" data-f="apagar"><span data-icone="lixo"></span> Excluir</button>`}
          <div class="linha"><button type="button" class="btn" data-f="fechar">${App.leitor ? "Fechar" : "Cancelar"}</button>
            <button type="submit" class="btn btn-primario so-edicao">Salvar</button></div>
        </div>
      </form>`;
    pintarIcones(fundo);
    const f = (s) => $(s, fundo);
    // leitora: só lê (campos travados, sem Salvar nem Excluir)
    if (App.leitor) $$("input, select, textarea", fundo).forEach((x) => { x.disabled = true; });
    const contar = () => { f("#cf-cont").textContent = `${f("#cf-legenda").value.length}/${LEGENDA_MAX}`; };
    contar();
    const fechar = () => { fundo.remove(); document.removeEventListener("keydown", tecla); };
    const tecla = (e) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", tecla);

    fundo.addEventListener("input", (e) => { if (e.target.id === "cf-legenda") contar(); });
    fundo.addEventListener("change", (e) => {
      // escolheu uma conta com Produção: troca para a ficha completa
      if (e.target.id === "cf-conta" && App.remoto && temProducao(e.target.value)) {
        const data = f("#cf-data").value || null;
        fechar();
        abrirConteudo({ conta_id: e.target.value, data });
        return;
      }
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
      if (App.leitor) return;
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
        if (salvo.data && salvo.data.slice(0, 7) !== iso(ref).slice(0, 7) && visao === "mes") ref = deIso(salvo.data);
        carregar();
      } catch (err) {
        console.warn(err);
        btn.disabled = false; btn.textContent = "Salvar";
        aviso("Não foi possível salvar agora.", "erro");
      }
    });
    document.body.appendChild(fundo);
    if (!App.leitor) f("#cf-tema").focus();
  }

  // ---------------- Compromisso / tarefa solta ----------------
  async function abrirTarefa(t) {
    // tarefa de um conteúdo: abre a ficha na aba Produção
    if (t.conteudo_id) {
      let c = itens.find((x) => x.id === t.conteudo_id);
      if (!c) { const { data } = await sb.from("conteudos").select("*").eq("id", t.conteudo_id).maybeSingle(); c = data; }
      if (c) return window.Ficha.abrir(c, () => carregar(true), "producao");
    }
    const novo = !t.id;
    const contasProd = contas().filter((c) => temProducao(c.id));
    const v = { tipo: "compromisso", titulo: "", data: iso(ref), hora: null, status: "a_fazer", notas: "", conta_id: temProducao(contaPadrao()) ? contaPadrao() : contasProd[0]?.id, ...t };
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `
      <form class="cartao modal modal-largo" novalidate>
        <div class="linha-entre" style="margin-bottom:12px"><h3 class="subtitulo">${novo ? "Novo compromisso" : "Compromisso"}</h3>
          <button type="button" class="btn btn-icone btn-fantasma" data-f="fechar" aria-label="Fechar">✕</button></div>
        <div class="campo"><label class="rotulo" for="ct-titulo">O quê</label><input class="input" id="ct-titulo" maxlength="200" value="${esc(v.titulo)}" placeholder="Ex: Reunião de alinhamento"></div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="ct-tipo">Tipo</label><select class="select" id="ct-tipo">${Object.entries(TIPOS_TAREFA).map(([k, n]) => `<option value="${k}" ${k === v.tipo ? "selected" : ""}>${n}</option>`).join("")}</select></div>
          <div class="campo"><label class="rotulo" for="ct-data">Data</label><input class="input" type="date" id="ct-data" value="${esc(v.data || "")}"></div>
          <div class="campo"><label class="rotulo" for="ct-hora">Horário</label><input class="input" type="time" id="ct-hora" value="${esc(hhmm(v.hora))}"></div>
        </div>
        <div class="cal-form-grade">
          ${contasProd.length > 1 ? `<div class="campo"><label class="rotulo" for="ct-conta">Conta</label><select class="select" id="ct-conta">${contasProd.map((c) => `<option value="${esc(c.id)}" ${c.id === v.conta_id ? "selected" : ""}>@${esc(c.username)}</option>`).join("")}</select></div>` : ""}
          <div class="campo"><label class="rotulo" for="ct-status">Status</label><select class="select" id="ct-status">${[["a_fazer", "A fazer"], ["fazendo", "Fazendo"], ["feita", "Feita"]].map(([k, n]) => `<option value="${k}" ${k === v.status ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        </div>
        <div class="campo"><label class="rotulo" for="ct-notas">Notas</label><textarea class="textarea" id="ct-notas" rows="2">${esc(v.notas)}</textarea></div>
        <div class="linha" style="justify-content:space-between;margin-top:6px">
          ${novo ? "<span></span>" : `<button type="button" class="btn btn-perigo btn-fantasma so-edicao" data-f="apagar"><span data-icone="lixo"></span> Excluir</button>`}
          <div class="linha"><button type="button" class="btn" data-f="fechar">${App.leitor ? "Fechar" : "Cancelar"}</button><button type="submit" class="btn btn-primario so-edicao">Salvar</button></div>
        </div>
      </form>`;
    pintarIcones(fundo);
    const f = (s) => $(s, fundo);
    if (App.leitor) $$("input, select, textarea", fundo).forEach((x) => { x.disabled = true; });
    const fechar = () => fundo.remove();
    fundo.addEventListener("click", async (e) => {
      if (e.target === fundo || e.target.closest("[data-f=fechar]")) return fechar();
      if (e.target.closest("[data-f=apagar]") && await confirmar("Excluir compromisso?", "Ele sai do calendário.", "Excluir", true)) {
        const { error } = await sb.from("tarefas").delete().eq("id", v.id);
        if (error) return aviso("Não foi possível excluir agora.", "erro");
        fechar(); carregar(true);
      }
    });
    f("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (App.leitor) return;
      const titulo = f("#ct-titulo").value.trim();
      if (!titulo) { aviso("Escreva o que é.", "atencao"); return; }
      const linha = { titulo, tipo: f("#ct-tipo").value, data: f("#ct-data").value || null, hora: f("#ct-hora").value || null,
        status: f("#ct-status").value, notas: f("#ct-notas").value, conta_id: f("#ct-conta")?.value || v.conta_id };
      const r = novo ? await sb.from("tarefas").insert({ ...linha, responsavel: App.usuario.id }) : await sb.from("tarefas").update(linha).eq("id", v.id);
      if (r.error) { console.warn(r.error); return aviso("Não foi possível salvar agora.", "erro"); }
      aviso("Compromisso salvo.", "ok");
      fechar(); carregar(true);
    });
    document.body.appendChild(fundo);
    f("#ct-titulo").focus();
  }

  // ---------------- Campanha ----------------
  function abrirCampanha(k) {
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `
      <form class="cartao modal modal-largo" novalidate>
        <div class="linha-entre" style="margin-bottom:12px"><h3 class="subtitulo">🎯 ${esc(k.nome)}</h3>
          <button type="button" class="btn btn-icone btn-fantasma" data-f="fechar" aria-label="Fechar">✕</button></div>
        <div class="campo"><label class="rotulo" for="ck-nome">Nome</label><input class="input" id="ck-nome" maxlength="120" value="${esc(k.nome)}"></div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="ck-inicio">Início</label><input class="input" type="date" id="ck-inicio" value="${esc(k.inicio || "")}"></div>
          <div class="campo"><label class="rotulo" for="ck-lancamento">Lançamento</label><input class="input" type="date" id="ck-lancamento" value="${esc(k.lancamento || "")}"></div>
          <div class="campo"><label class="rotulo" for="ck-fim">Fim</label><input class="input" type="date" id="ck-fim" value="${esc(k.fim || "")}"></div>
        </div>
        <div class="campo"><label class="rotulo" for="ck-mensagem">Mensagem principal</label><textarea class="textarea" id="ck-mensagem" rows="2">${esc(k.mensagem)}</textarea></div>
        <div class="campo"><label class="rotulo" for="ck-objetivo">Objetivo</label><textarea class="textarea" id="ck-objetivo" rows="3">${esc(k.objetivo)}</textarea></div>
        <div class="campo"><label class="rotulo" for="ck-notas">Notas e pendências</label><textarea class="textarea" id="ck-notas" rows="4">${esc(k.notas)}</textarea></div>
        <div class="linha" style="justify-content:flex-end;margin-top:6px">
          <button type="button" class="btn" data-f="fechar">${App.leitor ? "Fechar" : "Cancelar"}</button><button type="submit" class="btn btn-primario so-edicao">Salvar</button></div>
      </form>`;
    const f = (s) => $(s, fundo);
    if (App.leitor) $$("input, select, textarea", fundo).forEach((x) => { x.disabled = true; });
    fundo.addEventListener("click", (e) => { if (e.target === fundo || e.target.closest("[data-f=fechar]")) fundo.remove(); });
    f("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (App.leitor) return;
      const nome = f("#ck-nome").value.trim();
      if (!nome) return aviso("Dê um nome à campanha.", "atencao");
      const { error } = await sb.from("campanhas").update({
        nome, inicio: f("#ck-inicio").value || null, lancamento: f("#ck-lancamento").value || null, fim: f("#ck-fim").value || null,
        mensagem: f("#ck-mensagem").value, objetivo: f("#ck-objetivo").value, notas: f("#ck-notas").value,
      }).eq("id", k.id);
      if (error) return aviso("Não foi possível salvar agora.", "erro");
      aviso("Campanha salva.", "ok");
      fundo.remove(); carregar(true);
    });
    document.body.appendChild(fundo);
  }

  // ---------------- Eventos ----------------
  const raiz = $("#cal-corpo");

  raiz.addEventListener("click", (e) => {
    const estudo = e.target.closest("[data-estudo]");
    if (estudo) { const s = estudos.find((x) => x.id === estudo.dataset.estudo); if (s) window.Formacao?.abrirSessao(s, () => carregar(true)); return; }
    const tarefa = e.target.closest("[data-tarefa]");
    if (tarefa) { const t = tarefas.find((x) => x.id === tarefa.dataset.tarefa); if (t) abrirTarefa(t); return; }
    const campanha = e.target.closest("[data-campanha]");
    if (campanha) { const k = campanhas.find((x) => x.id === campanha.dataset.campanha); if (k) abrirCampanha(k); return; }
    const tipoBtn = e.target.closest("[data-cal-tipo]");
    if (tipoBtn) { filtroTipo = tipoBtn.dataset.calTipo; memoria.gravar("cal_tipo", filtroTipo); return render(); }
    const visaoBtn = e.target.closest("[data-cal-visao]");
    if (visaoBtn) { visao = visaoBtn.dataset.calVisao; memoria.gravar("cal_visao", visao); return carregar(); }
    const cartao = e.target.closest(".cal-card");
    if (cartao) { const c = itens.find((x) => x.id === cartao.dataset.id); if (c) abrirConteudo(c); return; }
    const novaTarefa = e.target.closest("[data-nova-tarefa]");
    if (novaTarefa) return abrirTarefa({ data: visao === "dia" ? iso(ref) : null });
    const novo = e.target.closest("[data-novo]");
    if (novo) return abrirConteudo({ data: novo.dataset.novo || null });
    const contaBtn = e.target.closest("[data-cal-conta]");
    if (contaBtn) { filtroConta = contaBtn.dataset.calConta; memoria.gravar("cal_conta", filtroConta); return carregar(); }
    const nav = e.target.closest("[data-cal]");
    if (nav) {
      const a = nav.dataset.cal;
      if (a === "anterior") andar(-1);
      if (a === "proximo") andar(1);
      if (a === "hoje") ref = new Date();
      return carregar();
    }
    // clique no número do dia (mês/semana): abre o dia
    if (e.target.closest(".cal-num") && recursosAvancados()) { ref = deIso(e.target.closest(".cal-dia").dataset.dia); visao = "dia"; memoria.gravar("cal_visao", visao); return carregar(); }
    // clique no espaço vazio de um dia: novo conteúdo naquele dia
    const dia = e.target.closest(".cal-dia");
    if (dia && !App.leitor && !e.target.closest(".cal-card")) abrirConteudo({ data: dia.dataset.dia });
  });

  // Arrastar e soltar: muda a data (ou tira, soltando em "Ideias sem data")
  raiz.addEventListener("dragstart", (e) => {
    const cartao = e.target.closest?.(".cal-card");
    if (!cartao) return;
    const tipo = cartao.dataset.estudo ? "estudo" : cartao.dataset.tarefa ? "tarefa" : cartao.dataset.id ? "conteudo" : null;
    if (!tipo || (App.leitor && tipo !== "estudo")) { e.preventDefault(); return; }
    arrastando = { tipo, id: cartao.dataset.estudo || cartao.dataset.tarefa || cartao.dataset.id };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", arrastando.id);
    cartao.classList.add("arrastando");
  });
  raiz.addEventListener("dragend", () => {
    arrastando = null;
    $$(".arrastando, .soltar-aqui", raiz).forEach((el) => el.classList.remove("arrastando", "soltar-aqui"));
  });
  raiz.addEventListener("dragover", (e) => {
    const alvo = e.target.closest(".cal-dia, .cal-ideias, .cal-agenda-dia");
    if (!alvo || !arrastando) return;
    e.preventDefault();
    $$(".soltar-aqui", raiz).forEach((el) => { if (el !== alvo) el.classList.remove("soltar-aqui"); });
    alvo.classList.add("soltar-aqui");
  });
  raiz.addEventListener("drop", async (e) => {
    const alvo = e.target.closest(".cal-dia, .cal-ideias, .cal-agenda-dia");
    if (!alvo || !arrastando) return;
    e.preventDefault();
    const { tipo, id } = arrastando;
    const novaData = alvo.dataset.dia || null;
    arrastando = null;
    alvo.classList.remove("soltar-aqui");
    const quando = novaData ? deIso(novaData).toLocaleDateString("pt-BR") : "";
    try {
      if (tipo === "estudo") {
        const s = estudos.find((x) => x.id === id);
        if (!s || s.data === novaData) return;
        if (!novaData) return aviso("Sessão de estudo precisa de data.", "atencao");
        s.data = novaData; render();
        await window.Formacao.remarcar(id, novaData);
        aviso(`Sessão remarcada para ${quando}.`, "ok");
      } else if (tipo === "tarefa") {
        const t = tarefas.find((x) => x.id === id);
        if (!t || t.data === novaData) return;
        if (!novaData) return aviso("Tarefa solta no calendário precisa de data.", "atencao");
        t.data = novaData; render();
        const { error } = await sb.from("tarefas").update({ data: novaData }).eq("id", id);
        if (error) throw error;
        aviso(`Tarefa movida para ${quando}.`, "ok");
      } else {
        const c = itens.find((x) => x.id === id);
        if (!c || (c.data || null) === novaData) return;
        c.data = novaData; render();
        await mudarData(c, novaData);
        aviso(novaData ? `Movido para ${quando}. As tarefas dele continuam nas datas delas.` : "Virou ideia sem data.", "ok");
      }
    } catch { aviso("Não foi possível mover agora.", "erro"); }
    carregar(true);
  });

  window.Calendario = { carregar, parar };
})();
