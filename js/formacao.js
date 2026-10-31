// =====================================================================
// formacao.js: "Minha Formação" (só a administradora vê)
// - início: progresso, próxima sessão, sessões sem registro, práticas
//   pendentes e os 6 módulos
// - módulo: objetivo, entrega, cursos e sessões do mês
// - curso: visão geral, anotações, exercícios, aplicação prática e
//   certificado (salva sozinho enquanto você escreve)
// - sessões: marcar como feita, remarcar (aparecem também no Calendário)
// Os dados ficam só no banco (22_formacao.sql), nada no código.
// Nada é marcado como concluído sozinho: status só muda por você.
// =====================================================================
(function () {
  const STATUS_CURSO = {
    nao_iniciado: "Não iniciado", matriculado: "Matriculado", em_andamento: "Em andamento",
    concluido: "Concluído", certificado_pendente: "Certificado pendente", certificado_recebido: "Certificado recebido",
  };
  const CONCLUIDO = ["concluido", "certificado_pendente", "certificado_recebido"];
  const INICIADO = ["em_andamento", ...CONCLUIDO];
  const STATUS_PRATICA = { pendente: "Pendente", em_andamento: "Em andamento", entregue: "Entregue" };
  const STATUS_SESSAO = { planejada: "Planejada", feita: "Feita", nao_feita: "Não feita" };
  const ANOTACOES = [["resumo", "Resumo"], ["conceitos", "Conceitos"], ["duvidas", "Dúvidas"], ["exemplos", "Exemplos"], ["referencias", "Referências"]];
  const PRATICA = [["aprendizado", "Aprendizado"], ["tarefa", "Tarefa vinculada"], ["experimento", "Experimento"], ["conteudo", "Conteúdo relacionado"], ["resultado", "Resultado"]];
  const ABAS = [["geral", "Visão geral"], ["anotacoes", "Anotações"], ["exercicios", "Exercícios"], ["pratica", "Aplicação prática"], ["certificado", "Certificado"]];
  const SALVA_MS = 800;
  const BUCKET = "formacao";

  let modulos = [], cursos = [], sessoes = [];
  let vista = memoria.ler("formacao_vista", { tipo: "inicio" }); // inicio | modulo (numero) | curso (id)
  let aba = "geral";
  const pendentes = new Map(); // curso.id -> timer do salvar automático

  // ---------------- Datas e contas ----------------
  const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const deIso = (s) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); };
  const dataLonga = (s) => deIso(s).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  const dataCurta = (s) => deIso(s).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
  const hhmm = (t) => String(t || "").slice(0, 5);
  const horasDe = (s) => { const [a, b] = [s.inicio, s.fim].map((t) => { const [h, m] = hhmm(t).split(":").map(Number); return h * 60 + m; }); return Math.max(0, b - a) / 60; };
  const fmtH = (n) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h`;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  const cursoDe = (id) => cursos.find((c) => c.id === id);
  const moduloDe = (id) => modulos.find((m) => m.id === id);
  const cursosDoModulo = (m) => cursos.filter((c) => c.modulo_id === m.id).sort((a, b) => a.numero - b.numero);
  const sessoesDe = (filtro) => sessoes.filter(filtro).sort((a, b) => a.data.localeCompare(b.data) || hhmm(a.inicio).localeCompare(hhmm(b.inicio)));

  function numeros() {
    const feitas = sessoes.filter((s) => s.status === "feita");
    const n = {
      sessoes: sessoes.length, feitas: feitas.length,
      cursos: cursos.length,
      iniciados: cursos.filter((c) => INICIADO.includes(c.status)).length,
      concluidos: cursos.filter((c) => CONCLUIDO.includes(c.status)).length,
      certificados: cursos.filter((c) => c.status === "certificado_recebido").length,
      praticas: cursos.filter((c) => c.pratica_status === "entregue").length,
      horasPlanejadas: sessoes.reduce((t, s) => t + horasDe(s), 0),
      horasEstudadas: feitas.reduce((t, s) => t + horasDe(s), 0),
      horasCertificadas: cursos.filter((c) => c.status === "certificado_recebido").reduce((t, c) => t + Number(c.cert_horas || 0), 0),
      cargaCursos: cursos.reduce((t, c) => t + Number(c.carga_h || 0), 0),
    };
    // média de 4 partes que você confirma: sessões feitas, cursos concluídos, certificados e práticas entregues
    const partes = [n.feitas / (n.sessoes || 1), n.concluidos / (n.cursos || 1), n.certificados / (n.cursos || 1), n.praticas / (n.cursos || 1)];
    n.geral = Math.round((partes.reduce((a, b) => a + b, 0) / partes.length) * 100);
    return n;
  }

  const proxima = () => sessoesDe((s) => s.status === "planejada" && s.data >= hojeIso())[0] ?? null;
  const semRegistro = () => sessoesDe((s) => s.status === "planejada" && s.data < hojeIso());
  function moduloAtual() {
    const p = proxima();
    if (p) return moduloDe(p.modulo_id);
    return [...modulos].sort((a, b) => b.numero - a.numero)[0] ?? null;
  }

  // ---------------- Dados ----------------
  async function ler() {
    const [m, c, s] = await Promise.all([
      sb.from("formacao_modulos").select("*").order("numero"),
      sb.from("formacao_cursos").select("*").order("numero"),
      sb.from("formacao_sessoes").select("*").order("data"),
    ]);
    const erro = m.error || c.error || s.error;
    if (erro) throw erro;
    modulos = m.data ?? []; cursos = c.data ?? []; sessoes = s.data ?? [];
  }

  async function salvarSessao(id, mudancas) {
    const { data, error } = await sb.from("formacao_sessoes").update(mudancas).eq("id", id).select().single();
    if (error) throw error;
    const i = sessoes.findIndex((s) => s.id === id);
    if (i >= 0) sessoes[i] = data;
    return data;
  }

  async function salvarCurso(id, mudancas) {
    const { error } = await sb.from("formacao_cursos").update(mudancas).eq("id", id);
    if (error) throw error;
  }

  // Sessões de estudo de um período (para o Calendário). Vazio para quem não é a dona.
  async function sessoesEntre(de, ate) {
    if (!App.remoto || !App.admin) return [];
    const { data, error } = await sb.from("formacao_sessoes").select("*").gte("data", de).lte("data", ate).order("data");
    if (error) return [];
    return data ?? [];
  }

  // ---------------- Carregar ----------------
  async function carregar() {
    const alvo = $("#form-corpo");
    if (!alvo) return;
    if (!App.remoto) { alvo.innerHTML = `<div class="cartao vazio"><p>A Formação precisa do Supabase conectado.</p></div>`; return; }
    alvo.innerHTML = `<p class="texto-2 pequeno">Carregando...</p>`;
    try { await ler(); }
    catch (e) {
      console.warn(e);
      alvo.innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>Não foi possível ler a Formação. Rodou o 22_formacao.sql?</span></div>`;
      return;
    }
    if (!modulos.length) {
      alvo.innerHTML = `<div class="cartao vazio"><div class="vazio-icone" data-icone="capelo"></div><h2 class="subtitulo">Nenhum módulo cadastrado</h2><p>Os módulos, cursos e sessões são cadastrados direto no banco.</p></div>`;
      pintarIcones(alvo);
      return;
    }
    render();
  }

  function ir(nova) {
    salvarPendentes();
    vista = nova;
    memoria.gravar("formacao_vista", vista);
    if (nova.tipo !== "curso") aba = "geral";
    render();
    window.scrollTo({ top: 0 });
  }

  function render() {
    const alvo = $("#form-corpo");
    if (!alvo) return;
    if (vista.tipo === "curso" && cursoDe(vista.id)) alvo.innerHTML = htmlCurso(cursoDe(vista.id));
    else if (vista.tipo === "modulo" && modulos.some((m) => m.numero === vista.numero)) alvo.innerHTML = htmlModulo(modulos.find((m) => m.numero === vista.numero));
    else { vista = { tipo: "inicio" }; alvo.innerHTML = htmlInicio(); }
    pintarIcones(alvo);
  }

  // ---------------- Pedaços ----------------
  const chipStatus = (c) => `<span class="chip ${c.status === "certificado_recebido" ? "fm-chip-ok" : INICIADO.includes(c.status) ? "chip-destaque" : ""}">${esc(STATUS_CURSO[c.status])}</span>`;
  const barra = (v, rotulo) => `<div class="fm-barra" role="progressbar" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(rotulo)}"><span style="width:${v}%"></span></div>`;

  function linhaSessao(s, comCurso = true) {
    const c = cursoDe(s.curso_id);
    return `<div class="fm-sessao st-${esc(s.status)}">
      <button class="fm-check" data-feita="${esc(s.id)}" aria-pressed="${s.status === "feita"}" title="${s.status === "feita" ? "Feita (clique para desfazer)" : "Marcar como feita"}">${s.status === "feita" ? "✓" : ""}</button>
      <button class="fm-sessao-info" data-sessao="${esc(s.id)}" title="Abrir a sessão (remarcar, anotar)">
        <span class="fm-sessao-data">${esc(dataCurta(s.data))} · ${esc(hhmm(s.inicio))}–${esc(hhmm(s.fim))}${s.flexivel ? ` <span class="chip">flexível</span>` : ""}${s.status === "nao_feita" ? ` <span class="chip">não feita</span>` : ""}</span>
        <span class="fm-sessao-tema">${esc(s.tema)}</span>
        ${comCurso && c ? `<span class="pequeno texto-2">Curso ${String(c.numero).padStart(2, "0")} · ${esc(c.nome)}</span>` : ""}
      </button>
    </div>`;
  }

  function cartaoCurso(c) {
    const ss = sessoes.filter((s) => s.curso_id === c.id);
    const feitas = ss.filter((s) => s.status === "feita").length;
    return `<button class="cartao fm-curso" data-curso="${esc(c.id)}">
      <span class="pequeno texto-2">Curso ${String(c.numero).padStart(2, "0")} · ${esc(c.instituicao)} · ${esc(fmtH(Number(c.carga_h)))}</span>
      <strong>${esc(c.nome)}</strong>
      <span class="chips">${chipStatus(c)}<span class="chip">Prática: ${esc(STATUS_PRATICA[c.pratica_status])}</span>${ss.length ? `<span class="chip">${feitas}/${ss.length} sessões</span>` : ""}</span>
    </button>`;
  }

  // ---------------- Início da Formação ----------------
  function htmlInicio() {
    const n = numeros();
    const p = proxima();
    const atrasadas = semRegistro();
    const atual = moduloAtual();
    const praticas = cursos.filter((c) => c.pratica_status !== "entregue" && (moduloDe(c.modulo_id)?.numero ?? 99) <= (atual?.numero ?? 0));
    const kpi = (num, rotulo, extra = "") => `<div class="cartao kpi"><div class="numero">${num}</div><span class="kpi-rotulo">${rotulo}</span>${extra}</div>`;
    return `
      <div class="kpis">
        ${kpi(`${n.geral}%`, "Progresso geral", barra(n.geral, "Progresso geral"))}
        ${kpi(`${n.feitas}/${n.sessoes}`, "Sessões feitas")}
        ${kpi(`${n.iniciados} · ${n.concluidos}/${n.cursos}`, "Cursos iniciados · concluídos")}
        ${kpi(`${n.certificados}/${n.cursos}`, "Certificados recebidos")}
        ${kpi(`${fmtH(n.horasEstudadas)}`, `Estudadas de ${fmtH(n.horasPlanejadas)} planejadas`)}
      </div>
      <div class="kpis-mini">
        <span>Horas certificadas: <strong>${fmtH(n.horasCertificadas)}</strong> de ${fmtH(n.cargaCursos)} dos cursos</span>
        <span>Atividades práticas entregues: <strong>${n.praticas}/${n.cursos}</strong></span>
        <span>Módulos concluídos: <strong>${modulos.filter((m) => { const cs = cursosDoModulo(m); return cs.length && cs.every((c) => CONCLUIDO.includes(c.status)); }).length}/${modulos.length}</strong></span>
        <span class="texto-3" title="Média de 4 partes que só mudam quando você confirma: sessões feitas, cursos concluídos, certificados recebidos e práticas entregues. Não usa o tempo que passou.">Como o progresso é calculado ⓘ</span>
      </div>

      <div class="fm-duas">
        <div class="cartao fm-bloco">
          <h2 class="titulo-card">📅 Próxima sessão</h2>
          ${p ? `<p class="fm-proxima-data">${esc(dataLonga(p.data))}, ${esc(hhmm(p.inicio))}–${esc(hhmm(p.fim))}</p>
            ${linhaSessao(p)}` : `<p class="texto-2 pequeno">Nenhuma sessão planejada daqui pra frente.</p>`}
          ${atrasadas.length ? `<div class="fm-atrasadas"><p class="pequeno"><strong>${atrasadas.length} ${atrasadas.length === 1 ? "sessão passou" : "sessões passaram"} sem registro.</strong> Marque como feita, não feita ou remarque.</p>
            ${atrasadas.slice(0, 4).map((s) => linhaSessao(s)).join("")}</div>` : ""}
        </div>
        <div class="cartao fm-bloco">
          <h2 class="titulo-card">🛠️ Atividades práticas pendentes</h2>
          ${praticas.length ? praticas.map((c) => `<button class="fm-pratica" data-curso="${esc(c.id)}" data-aba-curso="pratica">
              <strong>${esc(c.nome)}</strong><span class="pequeno texto-2">${esc(c.entrega || c.aplicacao_prevista[0] || "")}</span></button>`).join("")
            : `<p class="texto-2 pequeno">Nenhuma pendente até o módulo atual.</p>`}
        </div>
      </div>

      <h2 class="subtitulo" style="margin:26px 0 12px">Módulos</h2>
      <div class="fm-modulos">
        ${modulos.map((m) => {
          const cs = cursosDoModulo(m);
          const ss = sessoes.filter((s) => s.modulo_id === m.id);
          const v = pct(ss.filter((s) => s.status === "feita").length, ss.length);
          return `<div class="cartao fm-modulo ${atual?.id === m.id ? "atual" : ""}">
            <span class="pequeno texto-2">Módulo ${m.numero} · ${esc(m.mes)}${atual?.id === m.id ? ` · <strong class="fm-atual">atual</strong>` : ""}</span>
            <strong class="fm-modulo-titulo">${esc(m.titulo)}</strong>
            <span class="chips">${cs.map(chipStatus).join("")}</span>
            ${barra(v, `Sessões feitas do módulo ${m.numero}`)}
            <span class="pequeno texto-2">${ss.filter((s) => s.status === "feita").length}/${ss.length} sessões · ${cs.length} ${cs.length === 1 ? "curso" : "cursos"}</span>
            <button class="btn btn-p" data-modulo="${m.numero}">Acessar módulo</button>
          </div>`;
        }).join("")}
      </div>
      <p class="pequeno texto-3" style="margin-top:14px">Cursos independentes do Sebrae, numa trilha montada por você. Não é graduação nem certificação única. Confira disponibilidade, prazo e gratuidade no Sebrae antes de cada inscrição.</p>`;
  }

  // ---------------- Módulo ----------------
  function htmlModulo(m) {
    const cs = cursosDoModulo(m);
    const ss = sessoesDe((s) => s.modulo_id === m.id);
    return `
      <button class="btn btn-fantasma" data-ir="inicio"><span data-icone="voltar"></span> Formação</button>
      <div class="cartao fm-cabeca">
        <span class="pequeno texto-2">Módulo ${m.numero} · ${esc(m.mes)}</span>
        <h2 class="subtitulo">${esc(m.titulo)}</h2>
        <p><strong>Objetivo:</strong> ${esc(m.objetivo)}</p>
        <p><strong>Entrega do mês:</strong> ${esc(m.entrega)}</p>
      </div>
      <h3 class="titulo-card" style="margin:20px 0 10px">Cursos</h3>
      <div class="fm-cursos">${cs.map(cartaoCurso).join("") || `<p class="texto-2 pequeno">Sem cursos neste módulo.</p>`}</div>
      <h3 class="titulo-card" style="margin:20px 0 10px">Sessões de estudo</h3>
      <div class="cartao fm-lista">${ss.map((s, i) => `${i === 0 || ss[i - 1].semana !== s.semana ? `<div class="fm-semana-rotulo">Semana ${s.semana}</div>` : ""}${linhaSessao(s)}`).join("")}</div>`;
  }

  // ---------------- Curso ----------------
  function htmlCurso(c) {
    const m = moduloDe(c.modulo_id);
    const campoTexto = (grupo, chave, rotulo, linhas = 4) => `<div class="campo"><label class="rotulo" for="fc-${grupo}-${chave}">${rotulo}</label>
      <textarea class="textarea" id="fc-${grupo}-${chave}" rows="${linhas}" data-campo="${grupo}.${chave}">${esc(c[grupo]?.[chave] ?? "")}</textarea></div>`;
    let corpo = "";
    if (aba === "geral") {
      const ss = sessoesDe((s) => s.curso_id === c.id);
      corpo = `
        <div class="fm-geral">
          <div class="campo"><label class="rotulo" for="fc-status">Status</label>
            <select class="select" id="fc-status" data-campo="status">${Object.entries(STATUS_CURSO).map(([k, n]) => `<option value="${k}" ${k === c.status ? "selected" : ""}>${n}</option>`).join("")}</select>
            <div class="ajuda">Só muda quando você troca aqui.</div></div>
          <div class="kpis-mini">
            <span>Instituição: <strong>${esc(c.instituicao)}</strong></span>
            <span>Carga anunciada: <strong>${esc(fmtH(Number(c.carga_h)))}</strong></span>
            <span>Valor anunciado: <strong>${esc(c.valor || "-")}</strong></span>
          </div>
          ${c.link ? `<p><a class="btn" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer"><span data-icone="link"></span> Abrir no Sebrae ↗</a></p>` : ""}
          <div class="fm-duas">
            <div><h4 class="rotulo">Competências</h4><ul class="fm-ul">${c.competencias.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
            <div><h4 class="rotulo">Aplicação prática prevista</h4><ul class="fm-ul">${c.aplicacao_prevista.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
              ${c.entrega ? `<p class="pequeno"><strong>Entrega:</strong> ${esc(c.entrega)}</p>` : ""}</div>
          </div>
          <h4 class="rotulo" style="margin-top:14px">Cronograma (${ss.filter((s) => s.status === "feita").length}/${ss.length} feitas)</h4>
          <div class="fm-lista">${ss.map((s) => linhaSessao(s, false)).join("") || `<p class="texto-2 pequeno">Sem sessões ligadas a este curso.</p>`}</div>
        </div>`;
    } else if (aba === "anotacoes") {
      corpo = ANOTACOES.map(([k, n]) => campoTexto("anotacoes", k, n, k === "resumo" ? 8 : 4)).join("");
    } else if (aba === "exercicios") {
      corpo = `
        <div class="campo"><label class="rotulo" for="fc-ex-status">Status dos exercícios</label>
          <select class="select" id="fc-ex-status" data-campo="anotacoes.exercicios_status">${["Não iniciados", "Em andamento", "Concluídos"].map((n) => `<option ${n === (c.anotacoes?.exercicios_status || "Não iniciados") ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="fm-exercicios">${(c.exercicios || []).map((x, i) => `
          <div class="fm-exercicio">
            <label class="cal-etapa"><input type="checkbox" data-ex-feito="${i}" ${x.feito ? "checked" : ""}> <span>${esc(x.texto)}</span></label>
            <textarea class="textarea" rows="2" placeholder="Resposta..." data-ex-resposta="${i}">${esc(x.resposta || "")}</textarea>
            <button class="btn btn-icone btn-fantasma" data-ex-tirar="${i}" aria-label="Tirar exercício" title="Tirar exercício">✕</button>
          </div>`).join("") || `<p class="texto-2 pequeno">Nenhum exercício ainda.</p>`}</div>
        <form class="linha" data-ex-novo style="margin-top:10px"><input class="input" placeholder="Novo exercício" aria-label="Novo exercício" style="flex:1"><button class="btn btn-p">Adicionar</button></form>
        <p class="pequeno texto-2">Arquivos de exercício vão na pasta do Drive, quando o Drive estiver ligado.</p>`;
    } else if (aba === "pratica") {
      corpo = `
        <div class="campo"><label class="rotulo" for="fc-pr-status">Status da aplicação prática</label>
          <select class="select" id="fc-pr-status" data-campo="pratica_status">${Object.entries(STATUS_PRATICA).map(([k, n]) => `<option value="${k}" ${k === c.pratica_status ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        ${c.aplicacao_prevista.length ? `<p class="pequeno texto-2">Previsto: ${esc(c.aplicacao_prevista.join(" · "))}${c.entrega ? `. Entrega: ${esc(c.entrega)}` : ""}</p>` : ""}
        ${PRATICA.map(([k, n]) => campoTexto("pratica", k, n, 3)).join("")}`;
    } else if (aba === "certificado") {
      corpo = `
        <div class="campo"><span class="rotulo">Arquivo do certificado</span>
          ${c.cert_arquivo ? `<div class="linha"><button class="btn" data-cert="ver"><span data-icone="olho"></span> Ver certificado</button>
            <button class="btn btn-fantasma btn-perigo" data-cert="tirar"><span data-icone="lixo"></span> Tirar</button></div>`
            : `<div class="linha"><button class="btn btn-p" data-cert="subir"><span data-icone="mais"></span> Enviar certificado (PDF, PNG ou JPG, até 10 MB)</button></div>`}
          <input type="file" id="fc-cert-arquivo" hidden accept="application/pdf,image/png,image/jpeg">
          <div class="ajuda">Fica guardado em área privada. Só você abre.</div></div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="fc-cert-data">Data de emissão</label><input class="input" type="date" id="fc-cert-data" data-campo="cert_data" value="${esc(c.cert_data || "")}"></div>
          <div class="campo"><label class="rotulo" for="fc-cert-horas">Horas no certificado</label><input class="input" type="number" min="0" step="0.5" id="fc-cert-horas" data-campo="cert_horas" value="${esc(c.cert_horas ?? "")}"></div>
        </div>
        <div class="campo"><label class="rotulo" for="fc-cert-link">Link do Drive (opcional)</label><input class="input" type="url" id="fc-cert-link" data-campo="cert_link" value="${esc(c.cert_link)}" placeholder="https://drive.google.com/..."></div>
        <p class="pequeno texto-2">Status do curso: ${chipStatus(c)}. As horas só contam como certificadas com o status "Certificado recebido".</p>`;
    }
    return `
      <button class="btn btn-fantasma" data-modulo="${m?.numero ?? ""}"><span data-icone="voltar"></span> Módulo ${m?.numero ?? ""}</button>
      <div class="cartao fm-cabeca">
        <span class="pequeno texto-2">Curso ${String(c.numero).padStart(2, "0")} · Módulo ${m?.numero ?? "-"} · ${esc(m?.mes ?? "")}</span>
        <h2 class="subtitulo">${esc(c.nome)}</h2>
        <div class="chips">${chipStatus(c)}<span class="pequeno texto-2" id="fc-salvo" aria-live="polite"></span></div>
      </div>
      <div class="abas fm-abas" role="tablist">${ABAS.map(([k, n]) => `<button class="aba ${k === aba ? "ativa" : ""}" role="tab" aria-selected="${k === aba}" data-aba-curso="${k}">${n}</button>`).join("")}</div>
      <div class="cartao fm-aba" data-curso-id="${esc(c.id)}">${corpo}</div>`;
  }

  // ---------------- Salvar curso (automático) ----------------
  function mudarCampo(c, caminho, valor) {
    const [grupo, chave] = caminho.split(".");
    if (chave) c[grupo] = { ...(c[grupo] || {}), [chave]: valor };
    else c[grupo] = valor;
    return grupo;
  }

  function agendarSalvar(c, grupos) {
    const el = $("#fc-salvo");
    if (el) el.textContent = "Salvando...";
    const antes = pendentes.get(c.id);
    const juntos = new Set([...(antes?.grupos ?? []), ...grupos]);
    clearTimeout(antes?.timer);
    const rodar = async () => {
      pendentes.delete(c.id);
      const mudancas = Object.fromEntries([...juntos].map((g) => [g, c[g] === "" && ["cert_data", "cert_horas"].includes(g) ? null : c[g]]));
      try {
        await salvarCurso(c.id, mudancas);
        const e = $("#fc-salvo"); if (e) e.textContent = "✓ Salvo";
      } catch (err) {
        console.warn(err);
        aviso("Não foi possível salvar agora. Confira a conexão.", "erro");
        const e = $("#fc-salvo"); if (e) e.textContent = "Não salvo";
      }
    };
    pendentes.set(c.id, { timer: setTimeout(rodar, SALVA_MS), grupos: juntos, rodar });
  }

  // Salva já o que estava esperando (trocou de tela, aba escondida, saiu)
  function salvarPendentes() {
    pendentes.forEach((p) => { clearTimeout(p.timer); p.rodar(); });
  }

  // ---------------- Certificado ----------------
  async function subirCertificado(c, arquivo) {
    if (!arquivo) return;
    if (!["application/pdf", "image/png", "image/jpeg"].includes(arquivo.type)) return aviso("Use PDF, PNG ou JPG.", "atencao");
    if (arquivo.size > 10 * 1048576) return aviso("O arquivo passa de 10 MB.", "atencao");
    const ext = arquivo.type === "application/pdf" ? "pdf" : arquivo.type === "image/png" ? "png" : "jpg";
    const caminho = `${App.usuario.id}/curso-${String(c.numero).padStart(2, "0")}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
    if (error) { console.warn(error); return aviso("Não foi possível enviar o certificado.", "erro"); }
    try { await salvarCurso(c.id, { cert_arquivo: caminho }); c.cert_arquivo = caminho; }
    catch { return aviso("O arquivo subiu, mas não ficou ligado ao curso. Tente de novo.", "erro"); }
    aviso("Certificado enviado.", "ok");
    if (c.status !== "certificado_recebido" && await confirmar("Marcar o curso como \"Certificado recebido\"?", "As horas do certificado passam a contar como horas certificadas.", "Marcar")) {
      try { await salvarCurso(c.id, { status: "certificado_recebido" }); c.status = "certificado_recebido"; }
      catch { aviso("Não foi possível mudar o status agora.", "erro"); }
    }
    render();
  }

  async function verCertificado(c) {
    const janela = window.open("", "_blank");
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(c.cert_arquivo, 600);
    if (error || !data?.signedUrl) { janela?.close(); return aviso("Não foi possível abrir o certificado.", "erro"); }
    if (janela) janela.location = data.signedUrl; else location.assign(data.signedUrl);
  }

  async function tirarCertificado(c) {
    if (!(await confirmar("Tirar o certificado?", "O arquivo é apagado. O status do curso não muda.", "Tirar", true))) return;
    await sb.storage.from(BUCKET).remove([c.cert_arquivo]);
    try { await salvarCurso(c.id, { cert_arquivo: null }); c.cert_arquivo = null; aviso("Certificado tirado."); }
    catch { aviso("Não foi possível tirar agora.", "erro"); }
    render();
  }

  // ---------------- Sessão (janela) ----------------
  // aoMudar: chamado depois de salvar (o Calendário usa para se atualizar)
  async function abrirSessao(sessaoOuId, aoMudar) {
    let s = typeof sessaoOuId === "string" ? sessoes.find((x) => x.id === sessaoOuId) : sessaoOuId;
    if (!s) return;
    if (!cursos.length) { try { await ler(); } catch { /* segue sem nome do curso */ } }
    const c = cursoDe(s.curso_id);
    const m = moduloDe(s.modulo_id);
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `
      <form class="cartao modal modal-largo" novalidate aria-labelledby="fs-titulo">
        <div class="linha-entre" style="margin-bottom:6px">
          <h3 class="subtitulo" id="fs-titulo">🎓 Sessão ${s.numero} de 52</h3>
          <button type="button" class="btn btn-icone btn-fantasma" data-f="fechar" aria-label="Fechar">✕</button>
        </div>
        <p class="pequeno texto-2" style="margin:0 0 12px">Semana ${s.semana}${m ? ` · Módulo ${m.numero}: ${esc(m.titulo)}` : ""}${c ? ` · Curso ${String(c.numero).padStart(2, "0")}: ${esc(c.nome)}` : ""}</p>
        <div class="campo"><span class="rotulo">Status</span>
          <div class="segmentado" role="group" aria-label="Status da sessão">${Object.entries(STATUS_SESSAO).map(([k, n]) => `<button type="button" class="${k === s.status ? "ativo" : ""}" data-st="${k}" aria-pressed="${k === s.status}">${n}</button>`).join("")}</div></div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="fs-data">Data</label><input class="input" type="date" id="fs-data" value="${esc(s.data)}" required></div>
          <div class="campo"><label class="rotulo" for="fs-inicio">Início</label><input class="input" type="time" id="fs-inicio" value="${esc(hhmm(s.inicio))}"></div>
          <div class="campo"><label class="rotulo" for="fs-fim">Fim</label><input class="input" type="time" id="fs-fim" value="${esc(hhmm(s.fim))}"></div>
        </div>
        <label class="cal-etapa" style="margin-bottom:12px"><input type="checkbox" id="fs-flex" ${s.flexivel ? "checked" : ""}> Flexível (feriado ou data que pode mudar)</label>
        <div class="campo"><label class="rotulo" for="fs-tema">Tema</label><input class="input" id="fs-tema" maxlength="200" value="${esc(s.tema)}"></div>
        <div class="campo"><label class="rotulo" for="fs-tarefa">Tarefa</label><input class="input" id="fs-tarefa" maxlength="300" value="${esc(s.tarefa)}" placeholder="O que entregar nesta sessão"></div>
        <div class="campo"><label class="rotulo" for="fs-notas">Anotações da sessão</label><textarea class="textarea" id="fs-notas" rows="3">${esc(s.notas)}</textarea></div>
        <div class="linha" style="justify-content:space-between;margin-top:6px">
          ${c ? `<button type="button" class="btn btn-fantasma" data-f="curso">Abrir o curso</button>` : "<span></span>"}
          <div class="linha"><button type="button" class="btn" data-f="fechar">Cancelar</button><button type="submit" class="btn btn-primario">Salvar</button></div>
        </div>
      </form>`;
    let status = s.status;
    const f = (q) => $(q, fundo);
    const fechar = () => { fundo.remove(); document.removeEventListener("keydown", tecla); };
    const tecla = (e) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", tecla);
    fundo.addEventListener("click", (e) => {
      if (e.target === fundo || e.target.closest("[data-f=fechar]")) return fechar();
      const st = e.target.closest("[data-st]");
      if (st) { status = st.dataset.st; $$("[data-st]", fundo).forEach((b) => { b.classList.toggle("ativo", b === st); b.setAttribute("aria-pressed", b === st); }); }
      if (e.target.closest("[data-f=curso]")) { fechar(); aba = "geral"; if (location.hash !== "#formacao") { vista = { tipo: "curso", id: c.id }; memoria.gravar("formacao_vista", vista); location.hash = "#formacao"; } else ir({ tipo: "curso", id: c.id }); }
    });
    f("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = f("#fs-data").value;
      if (!data) { aviso("Escolha a data.", "atencao"); return; }
      if (f("#fs-fim").value <= f("#fs-inicio").value) { aviso("O fim precisa ser depois do início.", "atencao"); return; }
      const btn = $("button[type=submit]", fundo);
      btn.disabled = true; btn.textContent = "Salvando...";
      try {
        s = await salvarSessao(s.id, {
          status, data, inicio: f("#fs-inicio").value, fim: f("#fs-fim").value, flexivel: f("#fs-flex").checked,
          tema: f("#fs-tema").value.trim(), tarefa: f("#fs-tarefa").value.trim(), notas: f("#fs-notas").value,
        });
        aviso("Sessão salva.", "ok");
        fechar();
        if (!$("#secao-formacao").hidden) render();
        aoMudar?.(s);
      } catch (err) {
        console.warn(err);
        btn.disabled = false; btn.textContent = "Salvar";
        aviso("Não foi possível salvar agora.", "erro");
      }
    });
    document.body.appendChild(fundo);
  }

  async function alternarFeita(id) {
    const s = sessoes.find((x) => x.id === id);
    if (!s) return;
    try { await salvarSessao(id, { status: s.status === "feita" ? "planejada" : "feita" }); render(); }
    catch { aviso("Não foi possível marcar agora.", "erro"); }
  }

  // ---------------- Resumo no Início do painel ----------------
  async function resumoInicio(alvo) {
    if (!alvo) return;
    if (!App.remoto || !App.admin) { alvo.hidden = true; return; }
    try { await ler(); } catch { alvo.hidden = true; return; }
    if (!modulos.length) { alvo.hidden = true; return; }
    const n = numeros();
    const p = proxima();
    const atual = moduloAtual();
    const emCurso = cursos.find((c) => c.status === "em_andamento") ?? cursoDe(p?.curso_id);
    const pratica = cursos.find((c) => c.pratica_status !== "entregue" && (moduloDe(c.modulo_id)?.numero ?? 99) <= (atual?.numero ?? 0));
    alvo.hidden = false;
    alvo.innerHTML = `
      <a class="cartao fm-inicio" href="#formacao">
        <div class="linha-entre"><strong>🎓 Minha Formação</strong><span class="pequeno texto-2">${n.geral}% · ${n.feitas}/${n.sessoes} sessões</span></div>
        ${barra(n.geral, "Progresso da formação")}
        <div class="fm-inicio-grade">
          <span><span class="pequeno texto-2">Módulo atual</span><br>${atual ? `${atual.numero}. ${esc(atual.titulo)}` : "-"}</span>
          <span><span class="pequeno texto-2">Curso</span><br>${emCurso ? esc(emCurso.nome) : "-"}</span>
          <span><span class="pequeno texto-2">Próxima aula</span><br>${p ? `${esc(dataCurta(p.data))}, ${esc(hhmm(p.inicio))}` : "-"}</span>
          <span><span class="pequeno texto-2">Prática pendente</span><br>${pratica ? esc(pratica.entrega || pratica.nome) : "Nenhuma"}</span>
        </div>
      </a>`;
  }

  // ---------------- Eventos ----------------
  const raiz = $("#form-corpo");

  raiz.addEventListener("click", (e) => {
    const feita = e.target.closest("[data-feita]");
    if (feita) return alternarFeita(feita.dataset.feita);
    const sessao = e.target.closest("[data-sessao]");
    if (sessao) return abrirSessao(sessao.dataset.sessao);
    const abaCurso = e.target.closest("[data-aba-curso]");
    const curso = e.target.closest("[data-curso]");
    if (curso) { aba = abaCurso?.dataset.abaCurso || "geral"; return ir({ tipo: "curso", id: curso.dataset.curso }); }
    if (abaCurso) { aba = abaCurso.dataset.abaCurso; return render(); }
    const mod = e.target.closest("[data-modulo]");
    if (mod && mod.dataset.modulo) return ir({ tipo: "modulo", numero: Number(mod.dataset.modulo) });
    if (e.target.closest("[data-ir=inicio]")) return ir({ tipo: "inicio" });
    const c = cursoDe(e.target.closest("[data-curso-id]")?.dataset.cursoId);
    if (!c) return;
    const cert = e.target.closest("[data-cert]")?.dataset.cert;
    if (cert === "subir") return $("#fc-cert-arquivo").click();
    if (cert === "ver") return verCertificado(c);
    if (cert === "tirar") return tirarCertificado(c);
    const tirar = e.target.closest("[data-ex-tirar]");
    if (tirar) { c.exercicios = c.exercicios.filter((_, i) => i !== Number(tirar.dataset.exTirar)); agendarSalvar(c, ["exercicios"]); render(); }
  });

  // Campos do curso: salva sozinho
  const aoMudarCampo = (e) => {
    const c = cursoDe(e.target.closest("[data-curso-id]")?.dataset.cursoId);
    if (!c) return;
    if (e.target.dataset.campo) {
      const grupo = mudarCampo(c, e.target.dataset.campo, e.target.value);
      agendarSalvar(c, [grupo]);
      if (e.type === "change" && ["status", "pratica_status"].includes(grupo)) render();
      return;
    }
    const i = e.target.dataset.exFeito ?? e.target.dataset.exResposta;
    if (i !== undefined) {
      c.exercicios = c.exercicios.map((x, j) => (j === Number(i) ? { ...x, ...(e.target.dataset.exFeito !== undefined ? { feito: e.target.checked } : { resposta: e.target.value }) } : x));
      agendarSalvar(c, ["exercicios"]);
    }
  };
  raiz.addEventListener("input", (e) => { if (e.target.matches("textarea, input:not([type=checkbox]):not([type=file])")) aoMudarCampo(e); });
  raiz.addEventListener("change", (e) => {
    if (e.target.id === "fc-cert-arquivo") { const c = cursoDe(e.target.closest("[data-curso-id]")?.dataset.cursoId); subirCertificado(c, e.target.files?.[0]); e.target.value = ""; return; }
    if (e.target.matches("select, input[type=checkbox], input[type=date]")) aoMudarCampo(e);
  });
  raiz.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-ex-novo]");
    if (!form) return;
    e.preventDefault();
    const c = cursoDe(form.closest("[data-curso-id]")?.dataset.cursoId);
    const texto = $("input", form).value.trim();
    if (!c || !texto) return;
    c.exercicios = [...(c.exercicios || []), { texto, feito: false, resposta: "" }];
    agendarSalvar(c, ["exercicios"]);
    render();
    $("[data-ex-novo] input")?.focus();
  });

  document.addEventListener("visibilitychange", () => { if (document.hidden) salvarPendentes(); });
  window.addEventListener("pagehide", salvarPendentes);

  const remarcar = (id, data) => salvarSessao(id, { data });

  window.Formacao = { carregar, parar: salvarPendentes, abrirSessao, remarcar, sessoesEntre, resumoInicio };
})();
