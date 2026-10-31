// =====================================================================
// desempenho.js: "Desempenho" dentro da aba Relatório do Instagram
// (contas com o recurso 'relatorios'; as outras veem só Atendimentos)
// - relatórios semanais (segunda) e mensais (dia 1º) gerados sozinhos
//   pela função ig-relatorios, com histórico; dá para gerar na hora
// - números da Meta + sugestões da IA (marcadas como sugestão)
// - avisa se a coleta automática falhou ou parou
// - exportar: CSV (Excel) e Imprimir/PDF
// =====================================================================
(function () {
  let modo = memoria.ler("rel_modo", "desempenho"); // desempenho | atendimentos
  let lista = [], atual = null, ultimaColeta = null;
  let escolhido = null; // id do relatório aberto
  let gerando = false;

  const ativo = () => App.remoto && !!App.conta?.recursos?.includes("relatorios");
  const n = (v) => (v == null ? "-" : Number(v).toLocaleString("pt-BR"));
  const dm = (s) => { const [, m, d] = s.split("-"); return `${d}/${m}`; };
  const nomeRel = (r) => r.tipo === "mensal"
    ? `Mensal · ${new Date(`${r.inicio}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`
    : `${r.tipo === "semanal" ? "Semanal" : "Período"} · ${dm(r.inicio)} a ${dm(r.fim)}/${r.fim.slice(0, 4)}`;
  const variacao = (a, b) => {
    if (a == null || b == null || !b) return "";
    const p = Math.round(((a - b) / b) * 100);
    return `<span class="dsp-var ${p >= 0 ? "sobe" : "desce"}" title="Comparado ao período anterior (${n(b)})">${p >= 0 ? "▲" : "▼"} ${Math.abs(p)}%</span>`;
  };

  // Monta a troca Desempenho / Atendimentos. Devolve o container dos
  // Atendimentos, ou null quando Desempenho está aberto.
  function montar(raiz, carregarAtendimentos) {
    // expert com relatórios liberados: só Desempenho (Atendimentos tem dados de seguidores)
    if (papelNa(App.conta?.id)) { raiz.innerHTML = `<div id="rel-modo-corpo"></div>`; carregar($("#rel-modo-corpo", raiz)); return null; }
    raiz.innerHTML = `
      <div class="segmentado rel-modo" role="group" aria-label="Qual relatório">
        <button class="${modo === "desempenho" ? "ativo" : ""}" data-rel-modo="desempenho" aria-pressed="${modo === "desempenho"}">📈 Desempenho</button>
        <button class="${modo === "atendimentos" ? "ativo" : ""}" data-rel-modo="atendimentos" aria-pressed="${modo === "atendimentos"}">💬 Atendimentos</button>
      </div>
      <div id="rel-modo-corpo"></div>`;
    $$("[data-rel-modo]", raiz).forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.relModo === modo) return;
      modo = b.dataset.relModo; memoria.gravar("rel_modo", modo);
      carregarAtendimentos();
    }));
    const corpo = $("#rel-modo-corpo", raiz);
    if (modo === "atendimentos") return corpo;
    carregar(corpo);
    return null;
  }

  // ---------------- Dados ----------------
  async function carregar(alvo) {
    alvo.innerHTML = `<p class="texto-2" style="padding:20px 0">Carregando...</p>`;
    const contaId = App.conta.id;
    const [r, c] = await Promise.all([
      sb.from("relatorios").select("id, tipo, inicio, fim, status, origem, gerado_em").eq("conta_id", contaId).order("inicio", { ascending: false }).order("tipo").limit(200),
      sb.from("coletas").select("*").eq("conta_id", contaId).order("quando", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (r.error) { alvo.innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>Não foi possível ler os relatórios. Rodou o 24_relatorios.sql?</span></div>`; return; }
    lista = r.data ?? []; ultimaColeta = c.data ?? null;
    if (!lista.some((x) => x.id === escolhido)) escolhido = lista[0]?.id ?? null;
    atual = null;
    if (escolhido) {
      const { data } = await sb.from("relatorios").select("*").eq("id", escolhido).maybeSingle();
      atual = data;
    }
    if (App.conta.id !== contaId) return; // trocou de conta enquanto carregava
    render(alvo);
  }

  // ---------------- Desenhar ----------------
  function faixaColeta() {
    if (!ultimaColeta) return `<div class="faixa faixa-atencao">${icone("info")}<span>Ainda não houve coleta automática para esta conta. Ela roda todo dia às 06h15.</span></div>`;
    const horas = (Date.now() - new Date(ultimaColeta.quando).getTime()) / 36e5;
    const quando = new Date(ultimaColeta.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    if (!ultimaColeta.ok) return `<div class="faixa faixa-erro">${icone("info")}<span><strong>A última coleta falhou</strong> (${esc(quando)}): ${esc(ultimaColeta.detalhe || "sem detalhe")}. Os relatórios podem sair incompletos. Se continuar, confira o token da conta.</span></div>`;
    if (horas > 36) return `<div class="faixa faixa-atencao">${icone("info")}<span>A coleta automática não roda desde ${esc(quando)}. Confira o agendamento (ig-relatorios).</span></div>`;
    return `<p class="pequeno texto-2 dsp-coleta">✓ Dados coletados em ${esc(quando)} · coleta automática todo dia às 06h15</p>`;
  }

  function tabelaPosts(posts, titulo) {
    if (!posts.length) return `<p class="texto-2 pequeno">Nenhum post publicado no período.</p>`;
    return `<div class="tabela-wrap"><table class="planilha dsp-tabela" aria-label="${esc(titulo)}">
      <thead><tr><th>Data</th><th>Post</th><th>Origem</th><th>Views</th><th>Alcance</th><th>Salvos</th><th>Compart.</th><th>Coment.</th><th>Tempo médio</th></tr></thead>
      <tbody>${posts.map((p) => `<tr>
        <td>${esc(new Date(p.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }))}</td>
        <td class="dsp-post"><a href="${esc(p.link || "#")}" target="_blank" rel="noopener noreferrer">${esc(p.tipo)}</a> ${esc(p.conteudo?.titulo || p.legenda || "")}</td>
        <td>${p.origem ? esc(window.Ficha?.ORIGENS[p.origem] ?? p.origem) : `<span class="texto-3">-</span>`}</td>
        <td class="num">${n(p.views)}</td><td class="num">${n(p.alcance)}</td><td class="num">${n(p.salvos)}</td>
        <td class="num">${n(p.compartilhamentos)}</td><td class="num">${n(p.comentarios)}</td>
        <td class="num">${p.tempo_medio_s != null ? `${String(p.tempo_medio_s).replace(".", ",")}s` : "-"}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function tabelaGrupos(grupos) {
    if (!grupos?.length) return `<p class="texto-2 pequeno">Sem posts no período.</p>`;
    return `<div class="tabela-wrap"><table class="planilha dsp-tabela"><thead><tr><th></th><th>Posts</th><th>Views (média)</th><th>Alcance (média)</th><th>Salvos (média)</th><th>Compart. (média)</th></tr></thead>
      <tbody>${grupos.map((g) => `<tr><td><strong>${esc(g.nome)}</strong></td><td class="num">${n(g.posts)}</td><td class="num">${n(g.views)}</td><td class="num">${n(g.alcance)}</td><td class="num">${n(g.salvos)}</td><td class="num">${n(g.compartilhamentos)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  const listaIa = (titulo, itens) => (itens?.length ? `<div><h4 class="rotulo">${titulo}</h4><ul class="fm-ul">${itens.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "");

  function htmlRelatorio(r) {
    const d = r.dados || {};
    const t = d.totais || {}, a = d.totais_anterior || {}, s = d.seguidores || {};
    const kpi = (campo, rotulo) => `<div class="cartao kpi"><div class="numero">${n(t[campo])}</div><span class="kpi-rotulo">${rotulo} ${variacao(t[campo], a[campo])}</span></div>`;
    const posts = d.posts || [];
    const melhores = (d.melhores || []).map((id) => posts.find((p) => p.id === id)).filter(Boolean);
    const cresc = s.crescimento_liquido != null
      ? `<strong>${s.crescimento_liquido >= 0 ? "+" : ""}${n(s.crescimento_liquido)}</strong> de crescimento líquido (de ${n(s.inicio)} para ${n(s.fim)})`
      : s.ganhos_no_periodo != null ? `<strong>+${n(s.ganhos_no_periodo)}</strong> novos seguidores (ganhos informados pela Meta, sem descontar quem saiu)` : "sem dados de seguidores";
    const ia = r.analise;
    const gerado = new Date(r.gerado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    return `
      <div class="cartao dsp-cabeca">
        <div class="linha-entre" style="flex-wrap:wrap;gap:8px">
          <div><h2 class="subtitulo" style="margin:0">${esc(nomeRel(r))}</h2>
            <span class="pequeno texto-2">${dm(r.inicio)} a ${dm(r.fim)}/${r.fim.slice(0, 4)} · comparado com ${dm(d.anterior?.inicio || r.inicio)} a ${dm(d.anterior?.fim || r.fim)} · gerado em ${esc(gerado)} (${r.origem === "automatico" ? "automático" : "na hora"})</span></div>
          <span class="chip ${r.status === "ok" ? "fm-chip-ok" : "chip-destaque"}">${r.status === "ok" ? "Completo" : r.status === "parcial" ? "Parcial" : "Com erro"}</span>
        </div>
        ${r.avisos?.length ? `<ul class="dsp-avisos">${r.avisos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      </div>

      <h3 class="titulo-card dsp-sec">Resumo</h3>
      <div class="cartao fm-bloco">
        <p style="margin:0 0 6px">👥 Seguidores no fim: <strong>${n(s.fim)}</strong> · ${cresc}</p>
        ${ia?.resumo ? `<p style="margin:0"><span class="chip">✨ Sugestão da IA</span> ${esc(ia.resumo)}</p>` : ""}
      </div>
      <div class="kpis" style="margin-top:12px">
        ${kpi("visualizacoes", "Visualizações")}${kpi("alcance", "Alcance")}${kpi("interacoes", "Interações")}${kpi("compartilhamentos", "Compartilhamentos")}${kpi("salvos", "Salvamentos")}
      </div>
      <div class="kpis-mini">
        <span>Curtidas: <strong>${n(t.curtidas)}</strong> ${variacao(t.curtidas, a.curtidas)}</span>
        <span>Comentários: <strong>${n(t.comentarios)}</strong> ${variacao(t.comentarios, a.comentarios)}</span>
        <span>Visitas ao perfil: <strong>${n(t.visitas_perfil)}</strong> ${variacao(t.visitas_perfil, a.visitas_perfil)}</span>
        <span>Contas engajadas: <strong>${n(t.contas_engajadas)}</strong> ${variacao(t.contas_engajadas, a.contas_engajadas)}</span>
        <span>Posts no período: <strong>${posts.length}</strong></span>
      </div>

      ${d.alcance_por_dia?.length ? `<div class="cartao fm-bloco" style="margin-top:12px"><h3 class="titulo-card">Alcance por dia</h3>
        ${graficoBarras(d.alcance_por_dia.filter((x) => x.alcance != null).map((x) => ({ dia: x.dia, valor: x.alcance })), "de alcance")}</div>` : ""}

      <h3 class="titulo-card dsp-sec">🏆 Melhores conteúdos</h3>
      <div class="cartao">${tabelaPosts(melhores, "Melhores conteúdos")}</div>

      <div class="fm-duas">
        <div><h3 class="titulo-card dsp-sec">Autoral × remix</h3><div class="cartao">${tabelaGrupos(d.por_origem)}</div>
          <p class="pequeno texto-3">Vem da ficha ligada ao post (aba Métricas da ficha). Post sem ficha = "Não classificado".</p></div>
        <div><h3 class="titulo-card dsp-sec">Por formato</h3><div class="cartao">${tabelaGrupos(d.por_formato)}</div></div>
      </div>

      ${ia ? `<h3 class="titulo-card dsp-sec">✨ Sugestões da IA <span class="pequeno texto-2">(revise: são hipóteses, não conclusões)</span></h3>
        <div class="cartao fm-bloco dsp-ia">${listaIa("Hipóteses", ia.hipoteses)}${listaIa("Recomendações", ia.recomendacoes)}${listaIa("Próximos experimentos", ia.proximos_experimentos)}</div>` : ""}

      <details class="dsp-todos"><summary class="titulo-card">Todos os posts do período (${posts.length})</summary>
        <div class="cartao" style="margin-top:8px">${tabelaPosts(posts, "Todos os posts")}</div></details>

      <p class="pequeno texto-3 dsp-limites">Limitações: ${(d.limitacoes || []).map(esc).join(" ")}</p>`;
  }

  function render(alvo) {
    alvo.innerHTML = `
      ${papelNa(App.conta?.id) ? "" : faixaColeta()}
      <div class="barra-ferramentas dsp-acoes">
        ${lista.length ? `<select class="select" data-dsp="escolher" aria-label="Relatório">${lista.map((r) => `<option value="${esc(r.id)}" ${r.id === escolhido ? "selected" : ""}>${esc(nomeRel(r))}</option>`).join("")}</select>` : ""}
        ${papelNa(App.conta?.id) ? "" : `<button class="btn btn-p so-edicao" data-dsp="semanal" ${gerando ? "disabled" : ""}>Gerar: semana passada</button>
        <button class="btn btn-p so-edicao" data-dsp="mensal" ${gerando ? "disabled" : ""}>Gerar: mês passado</button>`}
        ${atual ? `<button class="btn btn-fantasma" data-dsp="csv"><span data-icone="baixar"></span> CSV</button>
        <button class="btn btn-fantasma" data-dsp="imprimir">Imprimir / PDF</button>` : ""}
      </div>
      ${atual ? htmlRelatorio(atual) : `<div class="cartao vazio"><div class="vazio-icone" data-icone="grafico"></div>
        <h2 class="subtitulo">Nenhum relatório ainda</h2>
        <p>O relatório semanal sai sozinho toda segunda (da semana anterior) e o mensal todo dia 1º (do mês anterior). ${App.leitor ? "" : "Dá para gerar agora pelos botões acima."}</p></div>`}`;
    pintarIcones(alvo);

    $("[data-dsp=escolher]", alvo)?.addEventListener("change", (e) => { escolhido = e.target.value; carregar(alvo); });
    $$("[data-dsp=semanal], [data-dsp=mensal]", alvo).forEach((b) => b.addEventListener("click", () => gerar(alvo, b.dataset.dsp)));
    $("[data-dsp=csv]", alvo)?.addEventListener("click", () => baixarCsv(atual));
    $("[data-dsp=imprimir]", alvo)?.addEventListener("click", () => window.print());
  }

  // ---------------- Ações ----------------
  async function gerar(alvo, tipo) {
    if (gerando || App.leitor) return;
    gerando = true;
    render(alvo);
    aviso("Gerando o relatório: leva até 1 minuto (busca os dados na Meta).");
    let r;
    try {
      const { data, error } = await sb.functions.invoke("ig-relatorios", { body: { acao: "gerar", conta_id: App.conta.id, tipo } });
      r = data;
      if (error) { try { r = await error.context?.json?.(); } catch { /* sem corpo */ } }
    } catch { r = null; }
    gerando = false;
    if (!r?.ok) { aviso(r?.erro || "Não foi possível gerar agora.", "erro"); return render(alvo); }
    escolhido = r.id;
    aviso("Relatório pronto.", "ok");
    carregar(alvo);
  }

  function baixarCsv(r) {
    const d = r.dados || {};
    const cel = (v) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const linhas = [
      [nomeRel(r)], ["Período", r.inicio, r.fim], [],
      ["Indicador", "Período", "Período anterior"],
      ...Object.keys(d.totais || {}).map((k) => [k, d.totais[k], d.totais_anterior?.[k] ?? ""]),
      ["seguidores_fim", d.seguidores?.fim ?? ""], ["crescimento_liquido", d.seguidores?.crescimento_liquido ?? ""], ["novos_seguidores_meta", d.seguidores?.ganhos_no_periodo ?? ""],
      [], ["Data", "Tipo", "Origem", "Título/legenda", "Views", "Alcance", "Curtidas", "Comentários", "Compartilhamentos", "Salvos", "Tempo médio (s)", "Link"],
      ...(d.posts || []).map((p) => [p.data?.slice(0, 10), p.tipo, p.origem ?? "", p.conteudo?.titulo || p.legenda, p.views, p.alcance, p.curtidas, p.comentarios, p.compartilhamentos, p.salvos, p.tempo_medio_s, p.link]),
    ];
    const csv = "﻿" + linhas.map((l) => l.map(cel).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `relatorio-${App.conta.username}-${r.tipo}-${r.inicio}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // imprimir: abre a lista de todos os posts
  window.addEventListener("beforeprint", () => $$(".dsp-todos").forEach((d) => { d.open = true; }));

  window.Desempenho = { ativo, montar };
})();
