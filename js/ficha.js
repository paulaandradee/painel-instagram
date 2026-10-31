// =====================================================================
// ficha.js: a "Ficha de conteúdo" (contas com o recurso 'producao')
// Abas: Visão Geral | Roteiro | Produção | Arquivos | Aprovação |
//       Métricas | Histórico
// - Visão geral, Roteiro, Arquivos e Métricas salvam no botão Salvar
// - tarefas, comentários e aprovação salvam na hora
// - o histórico é escrito pelo banco (23_ficha_conteudo.sql)
// - só visualização: tudo travado, sem botões de alterar
// =====================================================================
(function () {
  const ETAPAS = [
    ["Ideia e planejamento", [["ideia", "Ideia"], ["planejamento", "Planejamento"]]],
    ["Roteiro", [["roteiro_andamento", "Roteiro em andamento"], ["roteiro_pronto", "Roteiro pronto"]]],
    ["Gravação", [["aguardando_gravacao", "Aguardando gravação"], ["gravando", "Gravando"], ["gravado", "Gravado"]]],
    ["Edição", [["aguardando_edicao", "Aguardando edição"], ["em_edicao", "Em edição"], ["editado", "Editado"]]],
    ["Aprovação", [["aguardando_aprovacao", "Aguardando aprovação"], ["ajustes_solicitados", "Ajustes solicitados"], ["aprovado", "Aprovado"]]],
    ["Publicação", [["pronto_agendar", "Pronto para agendar"], ["agendado", "Agendado"], ["publicado", "Publicado"], ["em_analise", "Em análise"], ["finalizado", "Finalizado"]]],
  ];
  const ETAPA = Object.fromEntries(ETAPAS.flatMap(([, l]) => l));
  const FORMATOS = { reels: "🎬 Reels", carrossel: "🖼️ Carrossel", post: "📷 Post", story: "⏱️ Story", live: "🔴 Live", outro: "✨ Outro" };
  const ORIGENS = { autoral: "Autoral", remix: "Remix", curadoria: "Curadoria", terceiros: "Edição de terceiros", ia: "Com apoio de IA" };
  const TIPOS_TAREFA = {
    roteiro: "✍️ Roteiro", arte: "🎨 Arte", gravacao: "🎥 Gravação", edicao: "✂️ Edição", aprovacao: "✅ Aprovação",
    agendamento: "🗓️ Agendamento", analise: "📊 Análise", compromisso: "📌 Compromisso", outro: "• Outro",
  };
  const STATUS_TAREFA = { a_fazer: "A fazer", fazendo: "Fazendo", feita: "Feita" };
  const PILARES = ["Reflexões e identificação", "Estudo bíblico e devocional", "Rotina real e Bible Journal", "Comunidade e relacionamento"];
  const RESPONSAVEIS = [["resp_estrategia", "Estratégia"], ["resp_gravacao", "Gravação"], ["resp_edicao", "Edição"], ["resp_aprovacao", "Aprovação"]];
  const ABAS = [["geral", "Visão Geral"], ["roteiro", "Roteiro"], ["producao", "Produção"], ["arquivos", "Arquivos"], ["aprovacao", "Aprovação"], ["metricas", "Métricas"], ["historico", "Histórico"]];
  const CAMPO_NOME = {
    criado: "Criou o conteúdo", titulo: "Título", tema: "Tema", pilar: "Pilar", objetivo: "Objetivo", formato: "Formato",
    origem: "Origem", campanha_id: "Campanha", data: "Data", hora: "Horário", etapa: "Etapa", resp_estrategia: "Resp. estratégia",
    resp_gravacao: "Resp. gravação", resp_edicao: "Resp. edição", resp_aprovacao: "Resp. aprovação", briefing: "Briefing",
    roteiro: "Roteiro", capa_texto: "Texto da capa", legenda: "Legenda", cta: "CTA", referencias: "Referências",
    drive_pasta_url: "Pasta do Drive", link_publicacao: "Link da publicação", ig_media_id: "Post do Instagram", notas: "Observações",
    "tarefa criada": "Tarefa criada", "tarefa alterada": "Tarefa alterada", "tarefa removida": "Tarefa removida",
  };
  // Campos que o botão Salvar grava (o resto salva na hora)
  const CAMPOS = ["titulo", "pilar", "objetivo", "formato", "origem", "campanha_id", "data", "hora", "etapa",
    "resp_estrategia", "resp_gravacao", "resp_edicao", "resp_aprovacao", "briefing", "roteiro", "capa_texto",
    "legenda", "cta", "referencias", "drive_pasta_url", "link_publicacao", "ig_media_id", "notas"];
  const LEGENDA_MAX = 2200;

  const deIso = (s) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); };
  const isoDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const somar = (s, n) => { const d = deIso(s); d.setDate(d.getDate() + n); return isoDe(d); };
  const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
  const quando = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const opcoes = (mapa, atual, vazio) => (vazio !== undefined ? `<option value="">${vazio}</option>` : "") +
    Object.entries(mapa).map(([k, n]) => `<option value="${esc(k)}" ${k === atual ? "selected" : ""}>${esc(n)}</option>`).join("");

  // Tarefas padrão pelo formato e origem (datas contadas a partir da publicação)
  function tarefasPadrao(c) {
    const lista = [];
    const autoralReel = c.formato === "reels" && c.origem === "autoral";
    if (c.formato === "carrossel" || c.formato === "post") lista.push(["roteiro", "Roteiro e texto dos cards", -5], ["arte", "Arte", -3]);
    else if (autoralReel) lista.push(["roteiro", "Roteiro do Reel", -6], ["gravacao", "Gravação", -4], ["edicao", "Edição", -2], ["arte", "Capa", -2]);
    else if (c.formato === "reels") lista.push(["roteiro", "Texto, gancho e legenda", -3], ["edicao", "Edição", -2]);
    else lista.push(["roteiro", "Roteiro", -3]);
    lista.push(["aprovacao", "Aprovação", -1], ["agendamento", "Agendamento", -1], ["analise", "Análise dos resultados", 7]);
    return lista.map(([tipo, titulo, dias]) => ({ tipo, titulo, data: c.data ? somar(c.data, dias) : null }));
  }

  // ---------------- Abrir ----------------
  // item: conteúdo (do banco) ou { conta_id, data } para um novo. aoMudar: o calendário se atualiza.
  async function abrir(item, aoMudar, abaInicial = "geral") {
    const leitor = App.leitor;
    let c = { titulo: "", tema: "", pilar: "", objetivo: "", formato: "reels", origem: null, campanha_id: null, hora: null,
      etapa: "ideia", briefing: "", roteiro: "", capa_texto: "", legenda: "", cta: "", referencias: "", drive_pasta_url: "",
      link_publicacao: "", ig_media_id: null, notas: "", data: null, ...item };
    let novo = !c.id;
    let aba = abaInicial;
    let membros = [], campanhas = [], tarefas = [], comentarios = [], historico = null;
    let sujo = false;

    try {
      const [m, k] = await Promise.all([
        sb.rpc("membros_da_conta", { p_conta: c.conta_id }),
        sb.from("campanhas").select("id, nome").eq("conta_id", c.conta_id).order("criado_em"),
      ]);
      membros = m.data ?? []; campanhas = k.data ?? [];
    } catch { /* segue sem as listas */ }
    const emailDe = (id) => membros.find((p) => p.user_id === id)?.email ?? (id ? "alguém" : "-");
    const quemCurto = (id) => emailDe(id).split("@")[0];

    async function lerTarefas() {
      if (novo) { tarefas = []; return; }
      const { data } = await sb.from("tarefas").select("*").eq("conteudo_id", c.id).order("data", { ascending: true, nullsFirst: false });
      tarefas = data ?? [];
    }
    async function lerComentarios() {
      if (novo) { comentarios = []; return; }
      const { data } = await sb.from("conteudo_comentarios").select("*").eq("conteudo_id", c.id).order("criado_em");
      comentarios = data ?? [];
    }
    await Promise.all([lerTarefas(), lerComentarios()]);

    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `<form class="cartao modal modal-ficha" novalidate aria-labelledby="fi-titulo"></form>`;
    const form = $("form", fundo);
    const f = (q) => $(q, fundo);
    const val = (id) => { const el = f(`#fi-${id}`); return el ? el.value : undefined; };

    // ---------- pedaços ----------
    const selResp = (campo, rotulo) => `<div class="campo"><label class="rotulo" for="fi-${campo}">${rotulo}</label>
      <select class="select" id="fi-${campo}"><option value="">Ninguém</option>${membros.map((p) => `<option value="${esc(p.user_id)}" ${p.user_id === c[campo] ? "selected" : ""}>${esc(p.email)}</option>`).join("")}</select></div>`;
    const area = (campo, rotulo, linhas, extra = "") => `<div class="campo"><label class="rotulo" for="fi-${campo}">${rotulo}</label>
      <textarea class="textarea" id="fi-${campo}" rows="${linhas}" ${extra}>${esc(c[campo] ?? "")}</textarea></div>`;

    function painelGeral() {
      return `
        <div class="campo"><label class="rotulo" for="fi-titulo-in">Título</label>
          <input class="input" id="fi-titulo-in" maxlength="200" value="${esc(c.titulo || c.tema)}" placeholder="Ex: Por que é tão difícil manter constância com Deus?"></div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="fi-etapa">Etapa</label>
            <select class="select" id="fi-etapa">${ETAPAS.map(([g, l]) => `<optgroup label="${esc(g)}">${l.map(([k, n]) => `<option value="${k}" ${k === c.etapa ? "selected" : ""}>${esc(n)}</option>`).join("")}</optgroup>`).join("")}</select></div>
          <div class="campo"><label class="rotulo" for="fi-data">Data prevista</label><input class="input" type="date" id="fi-data" value="${esc(c.data || "")}"><div class="ajuda">Em branco = ideia sem data.</div></div>
          <div class="campo"><label class="rotulo" for="fi-hora">Horário</label><input class="input" type="time" id="fi-hora" value="${esc(hhmm(c.hora))}"></div>
        </div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="fi-formato">Formato</label><select class="select" id="fi-formato">${opcoes(FORMATOS, c.formato)}</select></div>
          <div class="campo"><label class="rotulo" for="fi-origem">Autoral ou remix</label><select class="select" id="fi-origem">${opcoes(ORIGENS, c.origem, "Não definido")}</select></div>
          <div class="campo"><label class="rotulo" for="fi-campanha_id">Campanha</label>
            <select class="select" id="fi-campanha_id"><option value="">Nenhuma</option>${campanhas.map((k) => `<option value="${esc(k.id)}" ${k.id === c.campanha_id ? "selected" : ""}>${esc(k.nome)}</option>`).join("")}</select></div>
        </div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="fi-pilar">Pilar editorial</label>
            <input class="input" id="fi-pilar" list="fi-pilares" maxlength="80" value="${esc(c.pilar)}"><datalist id="fi-pilares">${PILARES.map((p) => `<option value="${esc(p)}">`).join("")}</datalist></div>
          <div class="campo"><label class="rotulo" for="fi-objetivo">Objetivo</label><input class="input" id="fi-objetivo" maxlength="200" value="${esc(c.objetivo)}"></div>
        </div>
        <span class="rotulo">Responsáveis</span>
        <div class="cal-form-grade">${RESPONSAVEIS.map(([k, n]) => selResp(k, n)).join("")}</div>
        ${area("notas", "Observações", 2)}`;
    }

    function painelRoteiro() {
      return `${area("briefing", "Briefing", 4, `placeholder="Para quem é, a ideia central, o que não pode faltar"`)}
        ${area("roteiro", "Roteiro", 8)}
        ${area("capa_texto", "Texto da capa", 2)}
        <div class="campo"><div class="linha-entre"><label class="rotulo" for="fi-legenda">Legenda</label><span class="contador" id="fi-cont">${(c.legenda || "").length}/${LEGENDA_MAX}</span></div>
          <textarea class="textarea" id="fi-legenda" rows="6" maxlength="${LEGENDA_MAX}">${esc(c.legenda)}</textarea></div>
        ${area("cta", "CTA", 2, `placeholder="Ex: Salve para ler depois"`)}
        ${area("referencias", "Referências", 3, `placeholder="Links, perfis, passagens bíblicas (confira as citações)"`)}`;
    }

    function painelProducao() {
      if (novo) return `<p class="texto-2 pequeno">Salve o conteúdo primeiro. Depois dá para criar as tarefas (roteiro, gravação, edição...).</p>`;
      const linhas = tarefas.map((t) => `
        <div class="fi-tarefa st-${esc(t.status)}" data-tarefa="${esc(t.id)}">
          <select class="select" data-t="tipo" aria-label="Tipo">${opcoes(TIPOS_TAREFA, t.tipo)}</select>
          <input class="input" data-t="titulo" value="${esc(t.titulo)}" aria-label="Descrição" placeholder="Descrição">
          <input class="input" type="date" data-t="data" value="${esc(t.data || "")}" aria-label="Data">
          <input class="input" type="time" data-t="hora" value="${esc(hhmm(t.hora))}" aria-label="Horário">
          <select class="select" data-t="responsavel" aria-label="Responsável"><option value="">Ninguém</option>${membros.map((p) => `<option value="${esc(p.user_id)}" ${p.user_id === t.responsavel ? "selected" : ""}>${esc(p.email.split("@")[0])}</option>`).join("")}</select>
          <select class="select" data-t="status" aria-label="Status">${opcoes(STATUS_TAREFA, t.status)}</select>
          <button type="button" class="btn btn-icone btn-fantasma so-edicao" data-t-tirar aria-label="Tirar tarefa" title="Tirar tarefa">✕</button>
        </div>`).join("");
      return `
        <p class="pequeno texto-2" style="margin-top:0">${tarefas.filter((t) => t.status === "feita").length} de ${tarefas.length} tarefas feitas. Mudanças aqui salvam na hora e aparecem no Calendário.</p>
        <div class="fi-tarefas">${linhas || `<p class="texto-2 pequeno">Nenhuma tarefa ainda.</p>`}</div>
        <div class="linha so-edicao" style="margin-top:10px">
          <button type="button" class="btn btn-p" data-f="tarefa-nova"><span data-icone="mais"></span> Tarefa</button>
          ${tarefas.length ? "" : `<button type="button" class="btn btn-p" data-f="tarefas-padrao">Criar tarefas padrão</button>`}
        </div>`;
    }

    function painelArquivos() {
      const url = c.drive_pasta_url;
      return `
        <div class="faixa faixa-info">${icone("info")}<span>A criação automática de pastas e o envio de arquivos para o Google Drive entram na etapa do Drive. Por enquanto, cole aqui o link da pasta.</span></div>
        <div class="campo" style="margin-top:12px"><label class="rotulo" for="fi-drive_pasta_url">Pasta do Drive</label>
          <div class="linha"><input class="input" type="url" id="fi-drive_pasta_url" value="${esc(url)}" placeholder="https://drive.google.com/drive/folders/..." style="flex:1">
          ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>` : ""}</div></div>`;
    }

    function painelAprovacao() {
      if (novo) return `<p class="texto-2 pequeno">Salve o conteúdo primeiro.</p>`;
      const e = c.etapa;
      const balao = (k) => `<div class="fi-comentario tp-${esc(k.tipo)}">
          <div class="pequeno texto-2">${esc(quemCurto(k.autor))} · ${esc(quando(k.criado_em))}${k.tipo === "ajuste" ? " · <strong>pediu ajustes</strong>" : k.tipo === "aprovacao" ? " · <strong>aprovou</strong>" : ""}</div>
          <div>${esc(k.texto)}</div></div>`;
      return `
        <p>Etapa atual: <strong>${esc(ETAPA[e])}</strong></p>
        <div class="linha so-edicao" style="margin-bottom:12px">
          ${["aguardando_aprovacao", "aprovado", "pronto_agendar", "agendado", "publicado", "em_analise", "finalizado"].includes(e) ? "" : `<button type="button" class="btn btn-p" data-f="pedir-aprovacao">Enviar para aprovação</button>`}
          ${["aguardando_aprovacao", "ajustes_solicitados"].includes(e) ? `<button type="button" class="btn btn-primario" data-f="aprovar">✓ Aprovar</button>` : ""}
          ${e === "aguardando_aprovacao" ? `<button type="button" class="btn" data-f="ajustes">Pedir ajustes</button>` : ""}
        </div>
        <h4 class="rotulo">Comentários internos</h4>
        <div class="fi-comentarios">${comentarios.map(balao).join("") || `<p class="texto-2 pequeno">Nenhum comentário.</p>`}</div>
        <div class="so-edicao" style="margin-top:10px">
          <textarea class="textarea" id="fi-novo-comentario" rows="2" maxlength="4000" placeholder="Escreva um comentário (ou o ajuste pedido)"></textarea>
          <div class="linha" style="justify-content:flex-end;margin-top:6px"><button type="button" class="btn btn-p" data-f="comentar">Comentar</button></div>
        </div>`;
    }

    function painelMetricas() {
      return `
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="fi-link_publicacao">Link da publicação</label><input class="input" type="url" id="fi-link_publicacao" value="${esc(c.link_publicacao)}" placeholder="https://www.instagram.com/p/..."></div>
          <div class="campo"><label class="rotulo" for="fi-ig_media_id">ID do post no Instagram</label><input class="input" id="fi-ig_media_id" value="${esc(c.ig_media_id || "")}" readonly></div>
        </div>
        <div class="linha so-edicao"><button type="button" class="btn btn-p" data-f="escolher-post"><span data-icone="instagram"></span> Escolher o post do Instagram</button>
          ${c.ig_media_id ? `<button type="button" class="btn btn-fantasma" data-f="desligar-post">Desligar o post</button>` : ""}</div>
        <div id="fi-posts"></div>
        <p class="pequeno texto-2">O post é ligado por você, nunca pela data. As métricas do post (visualizações, alcance, salvamentos...) aparecem aqui quando o relatório de métricas estiver ligado.</p>`;
    }

    function painelHistorico() {
      if (novo) return `<p class="texto-2 pequeno">O histórico começa quando o conteúdo é salvo.</p>`;
      if (!historico) return `<p class="texto-2 pequeno">Carregando...</p>`;
      const mostrar = (campo, v) => {
        if (v == null || v === "") return "vazio";
        if (campo === "etapa") return ETAPA[v] ?? v;
        if (campo.startsWith("resp_")) return quemCurto(v);
        if (campo === "campanha_id") return campanhas.find((k) => k.id === v)?.nome ?? "campanha";
        if (campo === "formato") return FORMATOS[v] ?? v;
        if (campo === "origem") return ORIGENS[v] ?? v;
        return v.length > 80 ? `${v.slice(0, 80)}…` : v;
      };
      const lista = historico.filter((h) => h.campo !== "tema"); // tema acompanha o título
      return lista.length ? `<div class="fi-historico">${lista.map((h) => `
        <div class="fi-hist"><span class="pequeno texto-2">${esc(quando(h.quando))} · ${esc(quemCurto(h.quem))}</span>
          <span><strong>${esc(CAMPO_NOME[h.campo] ?? h.campo)}</strong>${h.campo === "criado" || h.campo.startsWith("tarefa") ? `: ${esc(h.depois ?? "")}` : `: ${esc(mostrar(h.campo, h.antes))} → ${esc(mostrar(h.campo, h.depois))}`}</span></div>`).join("")}</div>`
        : `<p class="texto-2 pequeno">Sem alterações ainda.</p>`;
    }

    const PAINEIS = { geral: painelGeral, roteiro: painelRoteiro, producao: painelProducao, arquivos: painelArquivos, aprovacao: painelAprovacao, metricas: painelMetricas, historico: painelHistorico };

    // Guarda o que foi digitado antes de redesenhar uma aba
    function lerFormulario() {
      const v = {
        titulo: val("titulo-in"), pilar: val("pilar"), objetivo: val("objetivo"), formato: val("formato"), origem: val("origem"),
        campanha_id: val("campanha_id"), data: val("data"), hora: val("hora"), etapa: val("etapa"),
        briefing: val("briefing"), roteiro: val("roteiro"), capa_texto: val("capa_texto"), legenda: val("legenda"),
        cta: val("cta"), referencias: val("referencias"), drive_pasta_url: val("drive_pasta_url"),
        link_publicacao: val("link_publicacao"), ig_media_id: val("ig_media_id"), notas: val("notas"),
      };
      RESPONSAVEIS.forEach(([k]) => { v[k] = val(k); });
      Object.entries(v).forEach(([k, x]) => { if (x !== undefined) c[k] = x === "" && ["origem", "campanha_id", "data", "hora", "ig_media_id", ...RESPONSAVEIS.map(([r]) => r)].includes(k) ? null : x; });
    }

    function desenhar() {
      form.innerHTML = `
        <div class="fi-topo">
          <div>
            <span class="pequeno texto-2">${novo ? "Novo conteúdo" : `Conteúdo #${esc(c.numero)}`} · @${esc(App.contas.find((x) => x.id === c.conta_id)?.username || "conta")}</span>
            <h3 class="subtitulo" id="fi-titulo">${esc(c.titulo || c.tema || "Sem título")}</h3>
            <span class="chips"><span class="chip chip-destaque">${esc(ETAPA[c.etapa] ?? c.etapa)}</span>${c.origem ? `<span class="chip">${esc(ORIGENS[c.origem])}</span>` : ""}${leitor ? `<span class="chip">Só visualização</span>` : ""}</span>
          </div>
          <button type="button" class="btn btn-icone btn-fantasma" data-f="fechar" aria-label="Fechar">✕</button>
        </div>
        <div class="abas fi-abas" role="tablist">${ABAS.map(([k, n]) => `<button type="button" class="aba ${k === aba ? "ativa" : ""}" role="tab" aria-selected="${k === aba}" data-fi-aba="${k}">${n}</button>`).join("")}</div>
        <div class="fi-corpo">${PAINEIS[aba]()}</div>
        <div class="fi-rodape">
          ${novo ? "<span></span>" : `<button type="button" class="btn btn-perigo btn-fantasma so-edicao" data-f="apagar"><span data-icone="lixo"></span> Excluir</button>`}
          <div class="linha"><button type="button" class="btn" data-f="fechar">${leitor ? "Fechar" : "Cancelar"}</button>
            <button type="submit" class="btn btn-primario so-edicao">${novo ? "Criar conteúdo" : "Salvar"}</button></div>
        </div>`;
      pintarIcones(form);
      if (leitor) $$("input, select, textarea", form).forEach((x) => { x.disabled = true; });
    }

    // ---------- ações ----------
    const fechar = () => { fundo.remove(); document.removeEventListener("keydown", tecla); };
    const tentarFechar = async () => {
      if (sujo && !leitor && !(await confirmar("Sair sem salvar?", "As mudanças da ficha que não foram salvas se perdem. Tarefas e comentários já estão salvos.", "Sair sem salvar", true))) return;
      fechar();
    };
    const tecla = (e) => { if (e.key === "Escape" && !$(".modal-fundo:last-child .modal:not(.modal-ficha)")) tentarFechar(); };
    document.addEventListener("keydown", tecla);

    async function salvar() {
      lerFormulario();
      if (!c.titulo.trim()) { aviso("Dê um título ao conteúdo.", "atencao"); aba = "geral"; desenhar(); f("#fi-titulo-in")?.focus(); return false; }
      const linha = Object.fromEntries(CAMPOS.map((k) => [k, c[k] ?? null]));
      ["titulo", "pilar", "objetivo", "briefing", "roteiro", "capa_texto", "legenda", "cta", "referencias", "drive_pasta_url", "link_publicacao", "notas"].forEach((k) => { linha[k] = linha[k] ?? ""; });
      linha.titulo = linha.titulo.trim();
      linha.tema = linha.titulo; // o calendário antigo mostra "tema"
      const btn = $("button[type=submit]", form);
      btn.disabled = true; btn.textContent = "Salvando...";
      const r = novo
        ? await sb.from("conteudos").insert({ ...linha, conta_id: c.conta_id }).select().single()
        : await sb.from("conteudos").update(linha).eq("id", c.id).select().single();
      btn.disabled = false; btn.textContent = "Salvar";
      if (r.error) { console.warn(r.error); aviso("Não foi possível salvar agora.", "erro"); return false; }
      const eraNovo = novo;
      c = r.data; novo = false; sujo = false; historico = null;
      aviso(eraNovo ? "Conteúdo criado. Agora dá para criar as tarefas na aba Produção." : "Conteúdo salvo.", "ok");
      aoMudar?.();
      if (eraNovo) aba = "producao";
      desenhar();
      return true;
    }

    async function mudarEtapa(etapa, comentario) {
      lerFormulario();
      const { data, error } = await sb.from("conteudos").update({ etapa }).eq("id", c.id).select().single();
      if (error) return aviso("Não foi possível mudar a etapa agora.", "erro");
      c.etapa = data.etapa; c.status = data.status;
      if (comentario) await sb.from("conteudo_comentarios").insert({ conta_id: c.conta_id, conteudo_id: c.id, ...comentario });
      await lerComentarios();
      historico = null;
      aviso(`Etapa: ${ETAPA[etapa]}.`, "ok");
      aoMudar?.();
      desenhar();
    }

    async function salvarTarefa(id, mudanca) {
      const { error } = await sb.from("tarefas").update(mudanca).eq("id", id);
      if (error) { aviso("Não foi possível salvar a tarefa.", "erro"); return; }
      const t = tarefas.find((x) => x.id === id);
      if (t) Object.assign(t, mudanca);
      historico = null;
      aoMudar?.();
    }

    async function criarTarefas(lista) {
      const linhas = lista.map((t) => ({ conta_id: c.conta_id, conteudo_id: c.id, tipo: t.tipo, titulo: t.titulo, data: t.data, responsavel: App.usuario.id }));
      const { error } = await sb.from("tarefas").insert(linhas);
      if (error) return aviso("Não foi possível criar as tarefas.", "erro");
      await lerTarefas();
      historico = null;
      aoMudar?.();
      lerFormulario(); desenhar();
    }

    async function escolherPost() {
      const alvo = f("#fi-posts");
      alvo.innerHTML = `<p class="pequeno texto-2">Buscando os posts...</p>`;
      let posts = [];
      try {
        const { data } = await sb.functions.invoke("ig-media", { body: { conta_id: c.conta_id } });
        posts = data?.posts ?? [];
      } catch { /* mostra o aviso abaixo */ }
      if (!posts.length) { alvo.innerHTML = `<p class="pequeno texto-2">Não foi possível listar os posts agora.</p>`; return; }
      alvo.innerHTML = `<div class="fi-posts">${posts.map((p) => `<button type="button" class="fi-post" data-post="${esc(p.id)}" data-link="${esc(p.link || "")}" title="${esc(p.legenda)}">
          ${p.miniatura ? `<img src="${esc(p.miniatura)}" alt="" loading="lazy">` : `<span>${icone("imagem")}</span>`}
          <span class="pequeno">${esc(new Date(p.data).toLocaleDateString("pt-BR"))}</span></button>`).join("")}</div>`;
    }

    // ---------- eventos ----------
    fundo.addEventListener("click", async (e) => {
      if (e.target === fundo) return tentarFechar();
      const abaBtn = e.target.closest("[data-fi-aba]");
      if (abaBtn) {
        lerFormulario();
        aba = abaBtn.dataset.fiAba;
        desenhar();
        if (aba === "historico" && !historico && !novo) {
          const { data } = await sb.from("conteudo_historico").select("*").eq("conteudo_id", c.id).order("quando", { ascending: false }).limit(200);
          historico = data ?? [];
          if (aba === "historico") desenhar();
        }
        return;
      }
      const post = e.target.closest("[data-post]");
      if (post) {
        f("#fi-ig_media_id").value = post.dataset.post;
        f("#fi-link_publicacao").value = post.dataset.link;
        f("#fi-posts").innerHTML = `<p class="pequeno">Post escolhido. Clique em Salvar para guardar.</p>`;
        sujo = true;
        return;
      }
      const tirar = e.target.closest("[data-t-tirar]");
      if (tirar && !leitor) {
        const id = tirar.closest("[data-tarefa]").dataset.tarefa;
        const { error } = await sb.from("tarefas").delete().eq("id", id);
        if (error) return aviso("Não foi possível tirar a tarefa.", "erro");
        tarefas = tarefas.filter((t) => t.id !== id); historico = null; aoMudar?.(); lerFormulario(); desenhar();
        return;
      }
      const a = e.target.closest("[data-f]")?.dataset.f;
      if (!a) return;
      if (a === "fechar") return tentarFechar();
      if (leitor) return;
      if (a === "apagar") {
        const ok = await confirmar("Excluir conteúdo?", `"${c.titulo || c.tema}" sai do calendário com as tarefas, comentários e o histórico. Não dá para desfazer.`, "Excluir", true);
        if (!ok) return;
        const { error } = await sb.from("conteudos").delete().eq("id", c.id);
        if (error) return aviso("Não foi possível excluir agora.", "erro");
        aviso("Conteúdo excluído."); fechar(); aoMudar?.();
      }
      if (a === "tarefas-padrao") { lerFormulario(); return criarTarefas(tarefasPadrao(c)); }
      if (a === "tarefa-nova") return criarTarefas([{ tipo: "outro", titulo: "", data: c.data }]);
      if (a === "pedir-aprovacao") return mudarEtapa("aguardando_aprovacao");
      if (a === "aprovar") return mudarEtapa("aprovado", { texto: f("#fi-novo-comentario")?.value.trim() || "Aprovado.", tipo: "aprovacao" });
      if (a === "ajustes") {
        const texto = f("#fi-novo-comentario")?.value.trim();
        if (!texto) { aviso("Escreva no comentário qual ajuste é preciso.", "atencao"); f("#fi-novo-comentario")?.focus(); return; }
        return mudarEtapa("ajustes_solicitados", { texto, tipo: "ajuste" });
      }
      if (a === "comentar") {
        const texto = f("#fi-novo-comentario")?.value.trim();
        if (!texto) return;
        const { error } = await sb.from("conteudo_comentarios").insert({ conta_id: c.conta_id, conteudo_id: c.id, texto });
        if (error) return aviso("Não foi possível comentar agora.", "erro");
        await lerComentarios(); lerFormulario(); desenhar();
      }
      if (a === "escolher-post") return escolherPost();
      if (a === "desligar-post") { f("#fi-ig_media_id").value = ""; f("#fi-link_publicacao").value = ""; sujo = true; aviso("Clique em Salvar para desligar o post."); }
    });

    const esperaTexto = new Map();
    fundo.addEventListener("input", (e) => {
      if (e.target.id === "fi-legenda") f("#fi-cont").textContent = `${e.target.value.length}/${LEGENDA_MAX}`;
      const linha = e.target.closest("[data-tarefa]");
      if (linha && e.target.dataset.t === "titulo") {
        const id = linha.dataset.tarefa;
        clearTimeout(esperaTexto.get(id));
        esperaTexto.set(id, setTimeout(() => salvarTarefa(id, { titulo: e.target.value }), 700));
        return;
      }
      if (e.target.id?.startsWith("fi-") && e.target.id !== "fi-novo-comentario") sujo = true;
    });
    fundo.addEventListener("change", (e) => {
      const linha = e.target.closest("[data-tarefa]");
      if (linha && e.target.dataset.t && e.target.dataset.t !== "titulo") {
        const k = e.target.dataset.t;
        salvarTarefa(linha.dataset.tarefa, { [k]: e.target.value || null });
        if (k === "status") linha.className = `fi-tarefa st-${e.target.value}`;
        return;
      }
      if (e.target.id?.startsWith("fi-")) sujo = true;
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); if (!leitor) salvar(); });

    desenhar();
    document.body.appendChild(fundo);
    if (novo && !leitor) f("#fi-titulo-in")?.focus();
  }

  window.Ficha = { abrir, ETAPA, TIPOS_TAREFA, ORIGENS };
})();
