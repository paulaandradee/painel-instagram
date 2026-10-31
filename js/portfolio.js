// =====================================================================
// portfolio.js: "Portfólio" (só a administradora; estudos de caso)
// Estrutura de 15 seções. Em cada uma: o seu texto (salva sozinho) e,
// quando existe, um quadro "Do painel" com dados reais da conta
// (estratégia, conteúdos por autoria, campanhas, automações, relatórios,
// experimentos) e a Formação aplicada (cursos e competências).
// A autoria é sempre separada: produção própria, remix, curadoria,
// edição de terceiros e apoio de IA (vem da ficha de cada conteúdo).
// Exporta por Imprimir / PDF.
// =====================================================================
(function () {
  const SECOES = [
    ["contexto", "1. Contexto"], ["diagnostico", "2. Diagnóstico inicial"], ["objetivos", "3. Objetivos"], ["publico", "4. Público"],
    ["posicionamento", "5. Posicionamento"], ["estrategia", "6. Estratégia"], ["planejamento", "7. Planejamento"], ["producao", "8. Produção"],
    ["campanhas", "9. Campanhas"], ["automacoes", "10. Automações"], ["metricas", "11. Métricas"], ["experimentos", "12. Experimentos"],
    ["resultados", "13. Resultados"], ["aprendizados", "14. Aprendizados"], ["proximas", "15. Próximas ações"],
  ];
  const AUTORIA = { autoral: "Produção própria", remix: "Remix", curadoria: "Curadoria", terceiros: "Edição de terceiros", ia: "Com apoio de IA" };
  const SALVA_MS = 900;

  let casos = [], caso = null, dados = null;
  let espera = null;

  const n = (v) => (v == null ? "-" : Number(v).toLocaleString("pt-BR"));
  const mesBr = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  async function carregar() {
    const alvo = $("#port-corpo");
    if (!alvo) return;
    if (!App.remoto || !App.admin) { alvo.innerHTML = `<div class="cartao vazio"><p>O Portfólio é só da administradora.</p></div>`; return; }
    const { data, error } = await sb.from("portfolio_casos").select("*").order("criado_em");
    if (error) { alvo.innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>Não foi possível ler o Portfólio. Rodou o 27_estrategia_lab_portfolio.sql?</span></div>`; return; }
    casos = data ?? [];
    if (!caso || !casos.some((c) => c.id === caso.id)) caso = casos[0] ?? null;
    else caso = casos.find((c) => c.id === caso.id);
    if (!caso) {
      alvo.innerHTML = `<div class="cartao vazio"><h2 class="subtitulo">Nenhum estudo de caso</h2><button class="btn btn-primario" data-port-novo>Novo estudo de caso</button></div>`;
      return;
    }
    alvo.innerHTML = `<p class="texto-2">Juntando os dados do painel...</p>`;
    dados = await juntarDados(caso.conta_id);
    render();
  }

  // ---------------- Dados reais da conta ----------------
  async function juntarDados(contaId) {
    if (!contaId) return {};
    const [est, cts, camps, autos, envios, rels, exps, cursos] = await Promise.all([
      sb.from("estrategias").select("*").eq("conta_id", contaId).maybeSingle(),
      sb.from("conteudos").select("id, data, origem, etapa, formato, ig_media_id").eq("conta_id", contaId),
      sb.from("campanhas").select("*").eq("conta_id", contaId).order("inicio"),
      sb.from("ig_automations").select("id, active").eq("conta_id", contaId),
      sb.from("ig_deliveries").select("id", { count: "exact", head: true }).eq("conta_id", contaId).eq("status", "ok"),
      sb.from("relatorios").select("inicio, fim, dados").eq("conta_id", contaId).eq("tipo", "mensal").order("inicio"),
      sb.from("experimentos").select("letra, nome, status, hipotese, conclusao").eq("conta_id", contaId).order("letra"),
      sb.from("formacao_cursos").select("numero, nome, status, competencias, pratica, pratica_status, cert_arquivo, cert_horas").order("numero"),
    ]);
    return {
      est: est.data, conteudos: cts.data ?? [], campanhas: camps.data ?? [], automacoes: autos.data ?? [], envios: envios.count ?? null,
      relatorios: rels.data ?? [], experimentos: exps.data ?? [], cursos: cursos.data ?? [],
    };
  }

  // Quadro "Do painel" de cada seção (só o que existe de verdade)
  function doPainel(secao) {
    const d = dados || {};
    const e = d.est;
    const quadro = (html) => (html ? `<div class="port-painel"><span class="port-painel-rotulo">Do painel</span>${html}</div>` : "");
    switch (secao) {
      case "diagnostico": {
        const g = e?.diagnostico;
        if (!g?.indicadores?.length) return "";
        return quadro(`<p class="pequeno texto-2">${esc(g.periodo || "")} · ${esc(g.fonte || "")}</p>
          <div class="port-grade">${g.indicadores.map((i) => `<div><strong>${esc(i.valor)}</strong><span>${esc(i.nome)}</span></div>`).join("")}</div>`);
      }
      case "publico": return e?.publico ? quadro(`<p>${esc(e.publico)}</p>`) : "";
      case "posicionamento": return e ? quadro(`<p><strong>Essência:</strong> ${esc(e.essencia)}</p><p><strong>Propósito:</strong> ${esc(e.proposito)}</p><p><strong>Promessa:</strong> ${esc(e.promessa)}</p>${e.tom_voz?.length ? `<p><strong>Tom de voz:</strong> ${esc(e.tom_voz.join(", "))}</p>` : ""}`) : "";
      case "estrategia": return e?.pilares?.length ? quadro(`<p><strong>Pilares:</strong> ${e.pilares.map((p) => `${esc(p.nome)} (${p.meta_pct}%)`).join(" · ")}</p>${e.meta_origem?.autoral != null ? `<p><strong>Meta de origem${e.meta_origem.mes ? ` (${esc(e.meta_origem.mes)})` : ""}:</strong> ${e.meta_origem.autoral} autorais e ${e.meta_origem.remix} remixes</p>` : ""}`) : "";
      case "planejamento": {
        const porMes = {};
        d.conteudos.filter((c) => c.data).forEach((c) => { const m = c.data.slice(0, 7); porMes[m] = (porMes[m] || 0) + 1; });
        const meses = Object.keys(porMes).sort();
        return meses.length ? quadro(`<p>${meses.map((m) => `${esc(mesBr(`${m}-01`))}: <strong>${porMes[m]}</strong>`).join(" · ")} conteúdos planejados no Calendário.</p>`) : "";
      }
      case "producao": {
        if (!d.conteudos.length) return "";
        const por = {};
        d.conteudos.forEach((c) => { const k = c.origem || "sem"; por[k] = (por[k] || 0) + 1; });
        const publicados = d.conteudos.filter((c) => ["publicado", "em_analise", "finalizado"].includes(c.etapa)).length;
        return quadro(`<p><strong>Autoria</strong> (pela ficha de cada conteúdo):</p>
          <div class="port-grade">${Object.entries(AUTORIA).map(([k, v]) => `<div><strong>${por[k] || 0}</strong><span>${v}</span></div>`).join("")}${por.sem ? `<div><strong>${por.sem}</strong><span>Sem classificação</span></div>` : ""}</div>
          <p class="pequeno">${publicados} publicados · ${d.conteudos.filter((c) => c.ig_media_id).length} ligados a um post do Instagram.</p>
          <p class="pequeno texto-3">Conteúdo de terceiros (remix, curadoria) não é apresentado como criação própria.</p>`);
      }
      case "campanhas": return d.campanhas.length ? quadro(d.campanhas.map((k) => `<p><strong>${esc(k.nome)}</strong>${k.lancamento ? ` · lançamento ${esc(k.lancamento.split("-").reverse().join("/"))}` : ""}${k.mensagem ? `<br><span class="pequeno">"${esc(k.mensagem)}"</span>` : ""}</p>`).join("")) : "";
      case "automacoes": return d.automacoes.length ? quadro(`<p><strong>${d.automacoes.filter((a) => a.active).length}</strong> automações ativas de ${d.automacoes.length} · <strong>${n(d.envios)}</strong> mensagens entregues pelas automações.</p>`) : "";
      case "metricas": {
        if (!d.relatorios.length) return quadro(`<p class="pequeno texto-2">Os relatórios mensais aparecem aqui conforme forem gerados (Instagram › Relatório › Desempenho).</p>`);
        const lin = (r) => `<tr><td>${esc(mesBr(r.inicio))}</td><td class="num">${n(r.dados?.totais?.visualizacoes)}</td><td class="num">${n(r.dados?.totais?.alcance)}</td><td class="num">${n(r.dados?.totais?.salvos)}</td><td class="num">${n(r.dados?.seguidores?.fim)}</td></tr>`;
        return quadro(`<div class="tabela-wrap"><table class="planilha est-tabela"><thead><tr><th>Mês</th><th>Visualizações</th><th>Alcance</th><th>Salvos</th><th>Seguidores</th></tr></thead><tbody>${d.relatorios.map(lin).join("")}</tbody></table></div>`);
      }
      case "experimentos": return d.experimentos.length ? quadro(d.experimentos.map((x) => `<p><strong>${esc(x.letra)} · ${esc(x.nome)}</strong> <span class="chip">${esc({ planejado: "planejado", em_andamento: "em andamento", concluido: "concluído", cancelado: "cancelado" }[x.status])}</span><br><span class="pequeno">${x.conclusao ? `Conclusão: ${esc(x.conclusao)}` : `Hipótese: ${esc(x.hipotese)}`}</span></p>`).join("")) : "";
      case "aprendizados": {
        const feitos = d.cursos.filter((c) => ["concluido", "certificado_pendente", "certificado_recebido"].includes(c.status) || c.pratica?.aprendizado);
        return quadro(`<p><strong>Formação aplicada</strong> (Sebrae)</p>${feitos.length ? feitos.map((c) => `<p><strong>${esc(c.nome)}</strong> ${c.status === "certificado_recebido" ? `<span class="chip fm-chip-ok">certificado${c.cert_horas ? ` · ${c.cert_horas}h` : ""}</span>` : ""}<br>
          <span class="pequeno">Competências: ${esc((c.competencias || []).join(", "))}</span>${c.pratica?.aprendizado ? `<br><span class="pequeno">Aplicação: ${esc(c.pratica.aprendizado)}</span>` : ""}</p>`).join("")
          : `<p class="pequeno texto-2">Os cursos aparecem aqui quando forem concluídos ou tiverem aprendizado anotado na aplicação prática.</p>`}`);
      }
      default: return "";
    }
  }

  function render() {
    const alvo = $("#port-corpo");
    const s = caso.secoes || {};
    const preenchidas = SECOES.filter(([k]) => (s[k] || "").trim()).length;
    alvo.innerHTML = `
      <div class="barra-ferramentas port-acoes">
        ${casos.length > 1 ? `<select class="select" data-port="escolher">${casos.map((c) => `<option value="${esc(c.id)}" ${c.id === caso.id ? "selected" : ""}>${esc(c.titulo)}</option>`).join("")}</select>` : ""}
        <button class="btn btn-p" data-port-novo><span data-icone="mais"></span> Novo estudo de caso</button>
        <button class="btn btn-fantasma" data-port="imprimir">Imprimir / PDF</button>
        <span class="pequeno texto-2" id="port-salvo">${preenchidas} de ${SECOES.length} seções escritas</span>
      </div>
      <article class="cartao port-caso">
        <input class="port-titulo" data-port-campo="titulo" value="${esc(caso.titulo)}" aria-label="Título">
        <input class="port-subtitulo" data-port-campo="subtitulo" value="${esc(caso.subtitulo)}" placeholder="Subtítulo" aria-label="Subtítulo">
        ${SECOES.map(([k, nome]) => `<section class="port-secao">
          <h2 class="titulo-card">${esc(nome)}</h2>
          <textarea class="textarea port-texto" data-port-secao="${k}" rows="3" placeholder="Escreva aqui...">${esc(s[k] || "")}</textarea>
          <div class="port-impresso">${esc(s[k] || "")}</div>
          ${doPainel(k)}
        </section>`).join("")}
      </article>`;
    pintarIcones(alvo);
    $$(".port-texto", alvo).forEach((t) => { t.style.height = "auto"; t.style.height = `${Math.max(80, t.scrollHeight + 4)}px`; });
  }

  function agendar() {
    const el = $("#port-salvo");
    if (el) el.textContent = "Salvando...";
    clearTimeout(espera);
    espera = setTimeout(salvarAgora, SALVA_MS);
  }
  async function salvarAgora() {
    clearTimeout(espera); espera = null;
    if (!caso) return;
    const { error } = await sb.from("portfolio_casos").update({ titulo: caso.titulo, subtitulo: caso.subtitulo, secoes: caso.secoes }).eq("id", caso.id);
    const el = $("#port-salvo");
    if (el) el.textContent = error ? "Não salvo" : "✓ Salvo";
    if (error) aviso("Não foi possível salvar agora.", "erro");
  }

  // ---------------- Eventos ----------------
  const raiz = $("#port-corpo");
  raiz?.addEventListener("input", (e) => {
    if (!caso) return;
    const sec = e.target.dataset.portSecao, campo = e.target.dataset.portCampo;
    if (sec) {
      caso.secoes = { ...(caso.secoes || {}), [sec]: e.target.value };
      e.target.style.height = "auto"; e.target.style.height = `${Math.max(80, e.target.scrollHeight + 4)}px`;
      const imp = e.target.nextElementSibling; if (imp) imp.textContent = e.target.value;
    }
    if (campo) caso[campo] = e.target.value;
    if (sec || campo) agendar();
  });
  raiz?.addEventListener("change", (e) => {
    if (e.target.dataset.port === "escolher") { if (espera) salvarAgora(); caso = casos.find((c) => c.id === e.target.value); carregar(); }
  });
  raiz?.addEventListener("click", async (e) => {
    if (e.target.closest("[data-port=imprimir]")) { if (espera) await salvarAgora(); return window.print(); }
    if (e.target.closest("[data-port-novo]")) {
      const contas = App.contas.filter((c) => !papelNa(c.id));
      const { data, error } = await sb.from("portfolio_casos").insert({ titulo: "Novo estudo de caso", conta_id: contas[0]?.id ?? null, secoes: {} }).select().single();
      if (error) return aviso("Não foi possível criar agora.", "erro");
      caso = data; carregar();
    }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && espera) salvarAgora(); });

  window.Portfolio = { carregar, parar: () => { if (espera) salvarAgora(); } };
})();
