// =====================================================================
// relatorio.js: a aba "Relatório" (atendimentos por dia, semana, mês, ano)
// Atendimento = pessoa respondida, 1 por dia em cada canal:
// - a mesma pessoa no mesmo dia conta 1 vez; no dia seguinte conta de novo
// - respondida no comentário E no Direct = 2 (1 em cada canal)
// Quem conta é o banco (tabela atendimentos, 12_midias_relatorio.sql).
// Semana = domingo a sábado. Dias no horário de Brasília.
// =====================================================================
(function () {
  const PERIODOS = [["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"], ["ano", "Ano"]];
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  let periodo = memoria.ler("relatorio_periodo", "semana");
  let ref = new Date(); // uma data dentro do período mostrado

  // ---------------- Datas ----------------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const deIso = (s) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); };
  const somarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const dm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

  function intervalo() {
    const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    if (periodo === "dia") return { de: d, ate: d };
    if (periodo === "semana") { const de = somarDias(d, -d.getDay()); return { de, ate: somarDias(de, 6) }; }
    if (periodo === "mes") return { de: new Date(d.getFullYear(), d.getMonth(), 1), ate: new Date(d.getFullYear(), d.getMonth() + 1, 0) };
    return { de: new Date(d.getFullYear(), 0, 1), ate: new Date(d.getFullYear(), 11, 31) };
  }

  function titulo({ de, ate }) {
    if (periodo === "dia") return de.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    if (periodo === "semana") return `${dm(de)} a ${dm(ate)}/${ate.getFullYear()}`;
    if (periodo === "mes") return de.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return String(de.getFullYear());
  }

  function mover(passo) {
    const d = ref;
    if (periodo === "dia") ref = somarDias(d, passo);
    else if (periodo === "semana") ref = somarDias(d, 7 * passo);
    else if (periodo === "mes") ref = new Date(d.getFullYear(), d.getMonth() + passo, 1);
    else ref = new Date(d.getFullYear() + passo, 0, 1);
    carregar();
  }

  // ---------------- Dados ----------------
  async function ler({ de, ate }) {
    const { data, error } = await sb.rpc("relatorio_atendimentos", { p_conta: App.conta.id, p_de: iso(de), p_ate: iso(ate) });
    if (error) throw error;
    return data ?? [];
  }

  // Linhas da tabela/gráfico: por dia (semana, mês) ou por mês (ano)
  function agrupar(linhas, { de, ate }) {
    const porDia = new Map(linhas.map((l) => [l.dia, l]));
    if (periodo === "ano") {
      return MESES.map((nome, i) => {
        const doMes = linhas.filter((l) => deIso(l.dia).getMonth() === i);
        const comentarios = doMes.reduce((s, l) => s + Number(l.comentarios), 0);
        const dms = doMes.reduce((s, l) => s + Number(l.dms), 0);
        return { rotulo: nome, longo: `${nome}/${de.getFullYear()}`, comentarios, dms };
      });
    }
    const out = [];
    for (let d = de; d <= ate; d = somarDias(d, 1)) {
      const l = porDia.get(iso(d));
      out.push({
        rotulo: dm(d),
        longo: d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", ""),
        comentarios: Number(l?.comentarios ?? 0), dms: Number(l?.dms ?? 0),
      });
    }
    return out;
  }

  // ---------------- Desenhar ----------------
  const n = (v) => Number(v || 0).toLocaleString("pt-BR");

  // Barras do total por dia/mês (mesmo visual dos gráficos das Análises)
  function grafico(linhas) {
    const max = Math.max(1, ...linhas.map((l) => l.comentarios + l.dms));
    const barras = linhas.map((l) => {
      const total = l.comentarios + l.dms;
      const dica = `${l.longo}: ${n(total)} atendimento${total === 1 ? "" : "s"} (${n(l.comentarios)} comentário${l.comentarios === 1 ? "" : "s"}, ${n(l.dms)} Direct)`;
      return `<div class="barra-alvo" data-dica="${esc(dica)}"><div class="barra" style="height:${total ? Math.max(1.5, (total / max) * 100) : 0}%"></div></div>`;
    }).join("");
    const espaco = linhas.length > 45 ? 1 : 3;
    return `<div class="grafico" style="gap:${espaco}px" role="img" aria-label="Atendimentos por ${periodo === "ano" ? "mês" : "dia"}. Os números estão na tabela abaixo.">${barras}</div>
      <div class="grafico-eixo"><span>${esc(linhas[0].rotulo)}</span><span>${esc(linhas[linhas.length - 1].rotulo)}</span></div>`;
  }

  function tabela(linhas) {
    const tot = linhas.reduce((t, l) => ({ c: t.c + l.comentarios, d: t.d + l.dms }), { c: 0, d: 0 });
    return `<div class="tabela-wrap"><table class="planilha rel-tabela">
      <thead><tr><th>${periodo === "ano" ? "Mês" : "Dia"}</th><th class="num">Comentários</th><th class="num">Direct</th><th class="num">Total</th></tr></thead>
      <tbody>${linhas.map((l) => `<tr${l.comentarios + l.dms ? "" : ` class="rel-zero"`}><td>${esc(l.longo)}</td><td class="num">${n(l.comentarios)}</td><td class="num">${n(l.dms)}</td><td class="num"><strong>${n(l.comentarios + l.dms)}</strong></td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${n(tot.c)}</td><td class="num">${n(tot.d)}</td><td class="num">${n(tot.c + tot.d)}</td></tr></tfoot>
    </table></div>`;
  }

  async function carregar() {
    const alvo = $("#aba-relatorio");
    if (!App.remoto) {
      alvo.innerHTML = `<div class="cartao vazio"><div class="vazio-icone" data-icone="grafico"></div>
        <h2 class="subtitulo">Relatório de atendimentos</h2><p>Precisa do Supabase conectado (veja o LEIA-ME).</p></div>`;
      pintarIcones(alvo);
      return;
    }
    const faixa = intervalo();
    const hoje = iso(new Date());
    const ehAtual = iso(faixa.de) <= hoje && hoje <= iso(faixa.ate);
    alvo.innerHTML = `
      <div class="an-topo">
        <div class="chips-periodo" role="group" aria-label="Período">
          ${PERIODOS.map(([p, r]) => `<button class="chip-periodo ${p === periodo ? "ativo" : ""}" data-rel-periodo="${p}" aria-pressed="${p === periodo}">${r}</button>`).join("")}
        </div>
        <div class="linha rel-nav">
          <button class="btn btn-icone btn-fantasma" data-rel="anterior" aria-label="Período anterior">‹</button>
          <strong class="rel-titulo">${esc(titulo(faixa))}</strong>
          <button class="btn btn-icone btn-fantasma" data-rel="proximo" aria-label="Próximo período" ${ehAtual ? "disabled" : ""}>›</button>
          ${ehAtual ? "" : `<button class="btn btn-p" data-rel="hoje">Hoje</button>`}
        </div>
      </div>
      <div id="rel-corpo"><div class="texto-2" style="padding:20px 0">Carregando...</div></div>`;

    let linhas;
    try { linhas = await ler(faixa); }
    catch (e) {
      console.warn(e);
      $("#rel-corpo").innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>Não foi possível ler o relatório. Rodou o 12_midias_relatorio.sql no Supabase?</span></div>`;
      return;
    }
    const grupos = agrupar(linhas, faixa);
    const c = grupos.reduce((s, l) => s + l.comentarios, 0);
    const d = grupos.reduce((s, l) => s + l.dms, 0);
    const kpi = (valor, rotulo) => `<div class="cartao kpi"><div class="numero">${n(valor)}</div><span class="kpi-rotulo">${rotulo}</span></div>`;

    $("#rel-corpo").innerHTML = `
      <div class="rel-kpis">
        ${kpi(c + d, "Atendimentos")}
        ${kpi(c, "💬 Comentários respondidos")}
        ${kpi(d, "✉️ Direct respondido")}
      </div>
      ${periodo !== "dia" ? `<div class="cartao" style="margin-top:16px">
        <h2 class="titulo-card">Atendimentos por ${periodo === "ano" ? "mês" : "dia"} <span class="dica-titulo">(passe o mouse pra ver os números)</span></h2>
        ${grafico(grupos)}
      </div>` : ""}
      ${periodo !== "dia" ? `<div style="margin-top:16px">${tabela(grupos)}</div>` : ""}
      <p class="ajuda">Cada pessoa conta 1 vez por dia em cada canal: respondida no comentário e no Direct no mesmo dia conta 2. No dia seguinte, conta de novo. Entram as respostas das automações, as do painel e as feitas pelo celular.</p>
      ${periodo === "dia" ? `<div class="cartao rel-analise" id="rel-analise"></div>` : ""}`;
    if (periodo === "dia") carregarAnalise(iso(faixa.de));
  }

  // ---------------- Análise das conversas do dia (IA) ----------------
  // A análise fica guardada: abrir não gasta a cota da IA, só o botão.
  async function carregarAnalise(dia) {
    const alvo = $("#rel-analise");
    if (!alvo) return;
    const { data, error } = await sb.from("analises_conversas").select("*").eq("conta_id", App.conta.id).eq("dia", dia).maybeSingle();
    if ($("#rel-analise") !== alvo) return; // trocou de dia enquanto carregava
    if (error) { alvo.innerHTML = `<p class="texto-2">Não foi possível ler a análise. Rodou o 17_analise_conversas.sql?</p>`; return; }
    renderAnalise(alvo, dia, data);
  }

  function renderAnalise(alvo, dia, salvo, vazio = false) {
    const ehHoje = dia === iso(new Date());
    const topo = (rotulo) => `<div class="linha-entre" style="flex-wrap:wrap;gap:8px">
        <h2 class="titulo-card">🧠 Análise das conversas do dia</h2>
        <button class="btn btn-p" data-rel="analisar" data-dia="${dia}">✨ ${rotulo}</button></div>`;
    if (vazio) { alvo.innerHTML = `${topo("Gerar análise")}<p class="texto-2">Nenhuma conversa no Direct neste dia.</p>`; return; }
    if (!salvo) {
      alvo.innerHTML = `${topo("Gerar análise")}
        <p class="texto-2" style="margin:6px 0 0">A IA lê as conversas do Direct deste dia (sem nomes nem dados pessoais) e resume as principais dúvidas, objeções e o perfil dos leads.${ehHoje ? " Como o dia ainda não acabou, vale gerar de novo mais tarde." : ""}</p>`;
      return;
    }
    const a = salvo.dados || {};
    const coluna = (titulo, itens, vazioTxt) => `<div class="rel-analise-col"><h3>${titulo}</h3>${
      itens?.length ? `<ol>${itens.map((x) => `<li><strong>${esc(x.tema)}</strong> <span class="rel-vezes">em ${n(x.vezes)} conversa${x.vezes === 1 ? "" : "s"}</span>${
        x.exemplo ? `<div class="rel-exemplo">"${esc(x.exemplo)}"</div>` : ""}</li>`).join("")}</ol>` : `<p class="texto-2 pequeno">${vazioTxt}</p>`}</div>`;
    const hora = new Date(salvo.criada_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    alvo.innerHTML = `${topo("Atualizar análise")}
      ${a.resumo ? `<p class="rel-resumo">${esc(a.resumo)}</p>` : ""}
      <div class="rel-analise-grade">
        ${coluna("❓ Principais dúvidas", a.duvidas, "Nenhuma dúvida apareceu.")}
        ${coluna("🚧 Objeções", a.objecoes, "Nenhuma objeção apareceu.")}
        ${coluna("👩 Perfil e realidade dos leads", a.perfil, "Sem informação suficiente.")}
      </div>
      <p class="ajuda" style="margin-bottom:0">Feita pela IA em ${esc(hora)}, a partir de ${n(salvo.conversas)} conversa${salvo.conversas === 1 ? "" : "s"} (${n(salvo.mensagens)} mensagens), sem nomes nem dados pessoais. Os números são estimativas: use como termômetro.${ehHoje ? " O dia ainda não acabou: atualize mais tarde para incluir as próximas conversas." : ""}</p>`;
  }

  async function gerarAnalise(botao) {
    const dia = botao.dataset.dia;
    const alvo = $("#rel-analise");
    botao.disabled = true; botao.textContent = "Analisando as conversas...";
    let r;
    try {
      const { data, error } = await sb.functions.invoke("conversas-acoes", { body: { acao: "analisar_dia", conta_id: App.conta.id, dia } });
      if (error) {
        let msg = "Não foi possível analisar agora.";
        try { const c = await error.context?.json?.(); if (c?.erro) msg = c.erro; } catch { /* mantém */ }
        r = { ok: false, erro: msg };
      } else r = data;
    } catch { r = { ok: false, erro: "Não foi possível falar com o servidor agora." }; }
    if ($("#rel-analise") !== alvo) return;
    if (!r?.ok) { botao.disabled = false; botao.textContent = "✨ Tentar de novo"; return aviso(r?.erro || "Não foi possível analisar agora.", "erro"); }
    if (r.vazio) return renderAnalise(alvo, dia, null, true);
    renderAnalise(alvo, dia, { dados: r.analise, conversas: r.conversas, mensagens: r.mensagens, criada_em: new Date().toISOString() });
    aviso("Análise pronta.", "ok");
  }

  // ---------------- Eventos ----------------
  const raiz = $("#aba-relatorio");
  raiz.addEventListener("click", (e) => {
    const p = e.target.closest("[data-rel-periodo]");
    if (p) { periodo = p.dataset.relPeriodo; memoria.gravar("relatorio_periodo", periodo); return carregar(); }
    const b = e.target.closest("[data-rel]");
    if (!b || b.disabled) return;
    if (b.dataset.rel === "anterior") mover(-1);
    if (b.dataset.rel === "proximo") mover(1);
    if (b.dataset.rel === "hoje") { ref = new Date(); carregar(); }
    if (b.dataset.rel === "analisar") gerarAnalise(b);
  });

  window.Relatorio = { carregar };
})();
