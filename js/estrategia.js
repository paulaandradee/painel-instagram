// =====================================================================
// estrategia.js: "Estratégia Editorial" (contas com o recurso 'producao')
// - posicionamento, público e tom de voz
// - perfil do Instagram (bio proposta × aplicada, destaques, fixados)
// - pilares: meta de distribuição × o que está planejado no mês (calendário)
// - autoral × remix: meta × planejado
// - identidade visual DO INSTAGRAM (não muda as cores do painel)
// - diagnóstico inicial (prints) comparado com o relatório da Meta
// - campanhas
// Equipe edita (cada bloco tem "Editar"); a expert só vê; editor não vê.
// =====================================================================
(function () {
  let contaId = null;
  let est = null, campanhas = [], conteudos = [], relOutubro = null;
  let mes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const ORIGENS = { autoral: "Autoral", remix: "Remix", curadoria: "Curadoria", terceiros: "Terceiros", ia: "Com IA" };
  const contasVisiveis = () => App.contas.filter((c) => c.recursos?.includes("producao") && papelNa(c.id) !== "editor");
  const isoMes = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const linhas = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const n = (v) => Number(v || 0).toLocaleString("pt-BR");

  // ---------------- Dados ----------------
  async function ler() {
    const ini = `${isoMes(mes)}-01`;
    const fimD = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const fim = `${isoMes(mes)}-${String(fimD.getDate()).padStart(2, "0")}`;
    const [e, k, c, r] = await Promise.all([
      sb.from("estrategias").select("*").eq("conta_id", contaId).maybeSingle(),
      sb.from("campanhas").select("*").eq("conta_id", contaId).order("inicio"),
      sb.from("conteudos").select("id, titulo, tema, data, pilar, origem, formato, etapa").eq("conta_id", contaId).gte("data", ini).lte("data", fim),
      sb.from("relatorios").select("dados, inicio, fim").eq("conta_id", contaId).eq("tipo", "mensal").eq("inicio", "2026-10-01").maybeSingle(),
    ]);
    if (e.error) throw e.error;
    est = e.data; campanhas = k.data ?? []; conteudos = c.data ?? []; relOutubro = r.data ?? null;
  }

  async function carregar() {
    const alvo = $("#est-corpo");
    if (!alvo) return;
    const contas = contasVisiveis();
    if (!App.remoto || !contas.length) { alvo.innerHTML = `<div class="cartao vazio"><p>Nenhuma conta com Produção para você.</p></div>`; return; }
    if (!contas.some((c) => c.id === contaId)) contaId = (contas.find((c) => c.id === App.conta?.id) ?? contas[0]).id;
    alvo.innerHTML = `<p class="texto-2">Carregando...</p>`;
    try { await ler(); }
    catch (e) { console.warn(e); alvo.innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>Não foi possível ler a estratégia. Rodou o 27_estrategia_lab_portfolio.sql?</span></div>`; return; }
    render();
  }

  // ---------------- Desenhar ----------------
  const pode = () => editaConta(contaId);
  const topoBloco = (titulo, bloco) => `<div class="linha-entre est-topo"><h2 class="titulo-card">${titulo}</h2>${pode() ? `<button class="btn btn-p btn-fantasma" data-est-editar="${bloco}"><span data-icone="lapis"></span> Editar</button>` : ""}</div>`;
  const chips = (l) => (l?.length ? `<div class="chips">${l.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : `<p class="texto-3 pequeno">-</p>`);

  function blocoDistribuicao() {
    const pilares = est.pilares || [];
    const total = conteudos.length;
    const porPilar = (nome) => conteudos.filter((c) => (c.pilar || "").trim().toLowerCase() === nome.trim().toLowerCase()).length;
    const semPilar = conteudos.filter((c) => !pilares.some((p) => p.nome.trim().toLowerCase() === (c.pilar || "").trim().toLowerCase())).length;
    const mo = est.meta_origem || {};
    const contaOrigem = (o) => conteudos.filter((c) => c.origem === o).length;
    const linha = (nome, meta, qtd) => {
      const pct = total ? Math.round((qtd / total) * 100) : 0;
      const dif = meta != null ? pct - meta : null;
      return `<tr><td>${esc(nome)}</td><td class="num">${meta != null ? `${meta}%` : "-"}</td><td class="num">${qtd} (${pct}%)</td>
        <td><div class="est-barra"><span style="width:${pct}%"></span>${meta != null ? `<i style="left:${meta}%" title="Meta ${meta}%"></i>` : ""}</div></td>
        <td class="num ${dif == null ? "" : Math.abs(dif) <= 10 ? "est-ok" : "est-fora"}">${dif == null ? "" : dif === 0 ? "na meta" : `${dif > 0 ? "+" : ""}${dif} p.p.`}</td></tr>`;
    };
    return `
      <div class="linha cal-nav" style="margin-bottom:8px">
        <button class="btn btn-icone btn-fantasma" data-est-mes="-1" aria-label="Mês anterior">‹</button>
        <strong class="cal-titulo">${esc(mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))}</strong>
        <button class="btn btn-icone btn-fantasma" data-est-mes="1" aria-label="Próximo mês">›</button>
        <span class="pequeno texto-2">${total} ${total === 1 ? "conteúdo planejado" : "conteúdos planejados"} no Calendário</span>
      </div>
      <div class="tabela-wrap"><table class="planilha est-tabela"><thead><tr><th>Pilar</th><th>Meta</th><th>Planejado</th><th></th><th>Diferença</th></tr></thead>
        <tbody>${pilares.map((p) => linha(p.nome, Number(p.meta_pct), porPilar(p.nome))).join("")}
        ${semPilar ? linha("Sem pilar / outro", null, semPilar) : ""}</tbody></table></div>
      <h3 class="rotulo" style="margin-top:14px">Autoral × remix ${mo.mes ? `<span class="texto-3">(meta definida para ${esc(mo.mes.split("-").reverse().join("/"))})</span>` : ""}</h3>
      <div class="kpis-mini" style="margin-top:4px">
        <span>Autorais: <strong>${contaOrigem("autoral")}</strong>${mo.autoral != null ? ` de ${mo.autoral} na meta` : ""}</span>
        <span>Remixes: <strong>${contaOrigem("remix")}</strong>${mo.remix != null ? ` de ${mo.remix} na meta` : ""}</span>
        ${["curadoria", "terceiros", "ia"].map((o) => (contaOrigem(o) ? `<span>${ORIGENS[o]}: <strong>${contaOrigem(o)}</strong></span>` : "")).join("")}
        ${conteudos.filter((c) => !c.origem).length ? `<span>Sem origem: <strong>${conteudos.filter((c) => !c.origem).length}</strong></span>` : ""}
      </div>
      <div class="fm-duas" style="margin-top:10px">
        <p class="pequeno"><strong>Função dos remixes:</strong> ${esc(mo.funcao_remix || "-")}</p>
        <p class="pequeno"><strong>Função dos autorais:</strong> ${esc(mo.funcao_autoral || "-")}</p>
      </div>
      ${mo.nota ? `<p class="pequeno texto-3">${esc(mo.nota)}</p>` : ""}`;
  }

  function blocoDiagnostico() {
    const d = est.diagnostico || {};
    const api = relOutubro?.dados;
    const comparar = api ? `
      <div class="est-comparar">
        <h3 class="rotulo">Conferência com a Meta (relatório mensal de outubro, ${esc(relOutubro.inicio.split("-").reverse().join("/"))} a ${esc(relOutubro.fim.split("-").reverse().join("/"))})</h3>
        <div class="tabela-wrap"><table class="planilha est-tabela"><thead><tr><th>Indicador</th><th>Prints</th><th>API da Meta</th><th>Observação</th></tr></thead><tbody>
          <tr><td>Visualizações</td><td class="num">751.515</td><td class="num">${n(api.totais?.visualizacoes)}</td><td class="pequeno">Período pode diferir em 1 dia.</td></tr>
          <tr><td>Contas alcançadas</td><td class="num">542.842</td><td class="num">${n(api.totais?.alcance)}</td><td class="pequeno">A API mede o alcance de forma diferente do app.</td></tr>
          <tr><td>Crescimento de seguidores</td><td class="num">+1.799 (líquido)</td><td class="num">${api.seguidores?.crescimento_liquido != null ? n(api.seguidores.crescimento_liquido) + " (líquido)" : `+${n(api.seguidores?.ganhos_no_periodo)} (ganhos)`}</td><td class="pequeno">A API não informa, para o passado, quem deixou de seguir.</td></tr>
        </tbody></table></div>
      </div>` : `<p class="pequeno texto-3">A conferência com a Meta aparece aqui quando o relatório mensal de outubro for gerado (automático em 01/11).</p>`;
    return `
      <p class="pequeno texto-2" style="margin-top:0">${esc(d.periodo || "")}${d.fonte ? ` · Fonte: ${esc(d.fonte)}` : ""}</p>
      <div class="est-indicadores">${(d.indicadores || []).map((i) => `<div class="cartao kpi"><div class="numero">${esc(i.valor)}</div><span class="kpi-rotulo">${esc(i.nome)}</span></div>`).join("")}</div>
      <div class="fm-duas">
        <div><h3 class="rotulo">Faixas etárias</h3>${(d.faixas || []).map((f) => `<div class="est-faixa"><span>${esc(f.faixa)}</span><div class="est-barra"><span style="width:${Math.min(100, f.pct * 2.5)}%"></span></div><span class="num">${String(f.pct).replace(".", ",")}%</span></div>`).join("")}</div>
        <div><h3 class="rotulo">Conteúdos de destaque</h3><div class="tabela-wrap"><table class="planilha est-tabela"><thead><tr><th>Tema</th><th>Data</th><th>Views</th><th>Seguidores</th></tr></thead><tbody>
          ${(d.destaques || []).map((x) => `<tr><td>${esc(x.tema)}</td><td>${esc(x.data)}</td><td class="num">${esc(x.views)}</td><td class="num">${esc(x.seguidores)}</td></tr>`).join("")}</tbody></table></div></div>
      </div>
      ${d.texto ? `<p style="margin:12px 0 0">${esc(d.texto)}</p>` : ""}
      ${d.hipoteses?.length ? `<h3 class="rotulo" style="margin-top:12px">Hipóteses para investigar <span class="texto-3">(não são conclusões)</span></h3>
        <ul class="fm-ul">${d.hipoteses.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
        ${editaConta(contaId) ? `<a class="pequeno" href="#laboratorio">Testar no Laboratório →</a>` : ""}` : ""}
      ${comparar}`;
  }

  function render() {
    const alvo = $("#est-corpo");
    const contas = contasVisiveis();
    const seletor = contas.length > 1 ? `<div class="segmentado" role="group" aria-label="Conta" style="margin-bottom:14px">${contas.map((c) => `<button class="${c.id === contaId ? "ativo" : ""}" data-est-conta="${esc(c.id)}">@${esc(c.username)}</button>`).join("")}</div>` : "";
    if (!est) {
      alvo.innerHTML = `${seletor}<div class="cartao vazio"><div class="vazio-icone" data-icone="grade"></div><h2 class="subtitulo">Estratégia ainda não escrita</h2>
        ${pode() ? `<button class="btn btn-primario" data-est-criar>Começar a estratégia</button>` : `<p>A equipe ainda não preencheu a estratégia.</p>`}</div>`;
      pintarIcones(alvo);
      return;
    }
    const quem = est.atualizado_em ? new Date(est.atualizado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    alvo.innerHTML = `${seletor}
      ${!pode() ? `<div class="faixa faixa-info">${icone("info")}<span>Você vê a estratégia; quem altera é a social media.</span></div>` : ""}
      <div class="cartao est-bloco est-essencia">
        ${topoBloco("🧭 Posicionamento", "posicionamento")}
        <blockquote class="est-frase">${esc(est.essencia || "Essência ainda não definida")}</blockquote>
        <div class="fm-duas">
          <div><h3 class="rotulo">Propósito</h3><p>${esc(est.proposito || "-")}</p></div>
          <div><h3 class="rotulo">Promessa editorial</h3><p>${esc(est.promessa || "-")}</p></div>
        </div>
        <h3 class="rotulo">Público prioritário</h3><p>${esc(est.publico || "-")}</p>
        <h3 class="rotulo">Tom de voz</h3>${chips(est.tom_voz)}
      </div>

      <div class="cartao est-bloco">
        ${topoBloco("📱 Perfil do Instagram", "perfil")}
        <div class="fm-duas">
          <div>
            <h3 class="rotulo">Nome ${est.bio_status === "aplicada" ? `<span class="chip fm-chip-ok">aplicado</span>` : `<span class="chip">proposta, não confirmado</span>`}</h3>
            <p>${esc(est.nome_perfil || "-")}</p>
            <h3 class="rotulo">Bio</h3><pre class="est-bio">${esc(est.bio || "-")}</pre>
          </div>
          <div>
            <h3 class="rotulo">Destaques propostos</h3>${est.destaques?.length ? `<ol class="fm-ul">${est.destaques.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : "<p>-</p>"}
            <h3 class="rotulo">Fixados propostos</h3>${est.fixados?.length ? `<ol class="fm-ul">${est.fixados.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : "<p>-</p>"}
            ${est.perfil_notas ? `<p class="pequeno texto-3">${esc(est.perfil_notas)}</p>` : ""}
          </div>
        </div>
      </div>

      <div class="cartao est-bloco">
        ${topoBloco("📊 Pilares e distribuição", "pilares")}
        ${blocoDistribuicao()}
      </div>

      <div class="cartao est-bloco">
        ${topoBloco("🎨 Identidade visual do Instagram", "identidade")}
        <p class="pequeno texto-3" style="margin-top:0">Exclusiva do perfil; não muda as cores do painel.</p>
        <div class="est-paleta">${(est.paleta || []).map((p) => `<div class="est-cor"><span style="background:${/^#[0-9a-f]{3,8}$/i.test(p.hex) ? p.hex : "transparent"}"></span><strong>${esc(p.nome)}</strong><code>${esc(p.hex)}</code></div>`).join("")}</div>
        <h3 class="rotulo">Estilo</h3><p>${esc(est.estilo || "-")}</p>
        <h3 class="rotulo">Regras obrigatórias</h3>${est.regras?.length ? `<ul class="fm-ul">${est.regras.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p>-</p>"}
      </div>

      <div class="cartao est-bloco">
        ${topoBloco("🔎 Diagnóstico inicial", "diagnostico")}
        ${blocoDiagnostico()}
      </div>

      <div class="cartao est-bloco">
        <div class="linha-entre est-topo"><h2 class="titulo-card">🎯 Campanhas</h2><a class="pequeno" href="#calendario">Ver no Calendário →</a></div>
        ${campanhas.length ? campanhas.map((k) => `<div class="est-campanha"><strong>${esc(k.nome)}</strong>
          <span class="pequeno texto-2">${k.inicio ? `início ${esc(k.inicio.split("-").reverse().join("/"))}` : ""}${k.lancamento ? ` · lançamento ${esc(k.lancamento.split("-").reverse().join("/"))}` : ""}${k.fim ? ` · fim ${esc(k.fim.split("-").reverse().join("/"))}` : ""}</span>
          ${k.mensagem ? `<p style="margin:4px 0 0">"${esc(k.mensagem)}"</p>` : ""}${k.notas ? `<p class="pequeno texto-2" style="margin:4px 0 0">${esc(k.notas)}</p>` : ""}</div>`).join("") : `<p class="texto-2 pequeno">Nenhuma campanha. Crie pelo Calendário.</p>`}
      </div>
      <p class="pequeno texto-3">Atualizada em ${esc(quem)}.</p>`;
    pintarIcones(alvo);
  }

  // ---------------- Editar (um bloco por vez) ----------------
  const BLOCOS = {
    posicionamento: { titulo: "Posicionamento", campos: [
      ["essencia", "Essência", "area", 2], ["proposito", "Propósito", "area", 3], ["promessa", "Promessa editorial", "area", 3],
      ["publico", "Público prioritário", "area", 3], ["tom_voz", "Tom de voz (um por linha)", "lista", 5]] },
    perfil: { titulo: "Perfil do Instagram", campos: [
      ["nome_perfil", "Nome do perfil", "texto"], ["bio", "Bio", "area", 4], ["bio_status", "Status", "status"],
      ["destaques", "Destaques (um por linha)", "lista", 5], ["fixados", "Fixados (um por linha)", "lista", 3], ["perfil_notas", "Observações", "area", 2]] },
    pilares: { titulo: "Pilares e distribuição", campos: [
      ["pilares", "Pilares: um por linha, no formato  Nome | meta %", "pilares", 5],
      ["meta_autoral", "Meta de autorais no mês", "numero"], ["meta_remix", "Meta de remixes no mês", "numero"], ["meta_mes", "Mês da meta (AAAA-MM)", "texto"],
      ["funcao_remix", "Função dos remixes", "area", 2], ["funcao_autoral", "Função dos autorais", "area", 2], ["nota_origem", "Observação", "area", 2]] },
    identidade: { titulo: "Identidade visual do Instagram", campos: [
      ["paleta", "Paleta: uma cor por linha, no formato  Nome | #HEX", "paleta", 5], ["estilo", "Estilo", "area", 3], ["regras", "Regras obrigatórias (uma por linha)", "lista", 6]] },
    diagnostico: { titulo: "Diagnóstico inicial", campos: [
      ["diag_texto", "Diagnóstico", "area", 4], ["diag_hipoteses", "Hipóteses para investigar (uma por linha)", "lista", 4]] },
  };

  function valorDe(campo) {
    const mo = est.meta_origem || {}, d = est.diagnostico || {};
    switch (campo) {
      case "pilares": return (est.pilares || []).map((p) => `${p.nome} | ${p.meta_pct}`).join("\n");
      case "paleta": return (est.paleta || []).map((p) => `${p.nome} | ${p.hex}`).join("\n");
      case "meta_autoral": return mo.autoral ?? "";
      case "meta_remix": return mo.remix ?? "";
      case "meta_mes": return mo.mes ?? "";
      case "funcao_remix": return mo.funcao_remix ?? "";
      case "funcao_autoral": return mo.funcao_autoral ?? "";
      case "nota_origem": return mo.nota ?? "";
      case "diag_texto": return d.texto ?? "";
      case "diag_hipoteses": return (d.hipoteses || []).join("\n");
      default: return Array.isArray(est[campo]) ? est[campo].join("\n") : (est[campo] ?? "");
    }
  }

  function editar(bloco) {
    const cfg = BLOCOS[bloco];
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `<form class="cartao modal modal-largo" novalidate>
      <div class="linha-entre" style="margin-bottom:12px"><h3 class="subtitulo">${esc(cfg.titulo)}</h3><button type="button" class="btn btn-icone btn-fantasma" data-f="fechar" aria-label="Fechar">✕</button></div>
      ${cfg.campos.map(([k, rot, tipo, l]) => {
        const v = valorDe(k);
        if (tipo === "texto") return `<div class="campo"><label class="rotulo" for="ee-${k}">${rot}</label><input class="input" id="ee-${k}" value="${esc(v)}"></div>`;
        if (tipo === "numero") return `<div class="campo"><label class="rotulo" for="ee-${k}">${rot}</label><input class="input" type="number" min="0" id="ee-${k}" value="${esc(v)}"></div>`;
        if (tipo === "status") return `<div class="campo"><label class="rotulo" for="ee-${k}">${rot}</label><select class="select" id="ee-${k}"><option value="proposta" ${v === "proposta" ? "selected" : ""}>Proposta (ainda não aplicada no Instagram)</option><option value="aplicada" ${v === "aplicada" ? "selected" : ""}>Aplicada no Instagram</option></select></div>`;
        return `<div class="campo"><label class="rotulo" for="ee-${k}">${rot}</label><textarea class="textarea" id="ee-${k}" rows="${l || 3}">${esc(v)}</textarea></div>`;
      }).join("")}
      <div class="linha" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn" data-f="fechar">Cancelar</button><button type="submit" class="btn btn-primario">Salvar</button></div>
    </form>`;
    const f = (s) => $(s, fundo);
    const fechar = () => fundo.remove();
    fundo.addEventListener("click", (e) => { if (e.target === fundo || e.target.closest("[data-f=fechar]")) fechar(); });
    f("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = (k) => f(`#ee-${k}`)?.value ?? "";
      const mud = {};
      for (const [k, , tipo] of cfg.campos) {
        if (tipo === "lista" && !k.startsWith("diag_")) mud[k] = linhas(v(k));
        else if (["texto", "area", "status"].includes(tipo) && !k.startsWith("diag_") && !["funcao_remix", "funcao_autoral", "nota_origem", "meta_mes"].includes(k)) mud[k] = v(k).trim();
      }
      if (bloco === "pilares") {
        const ps = linhas(v("pilares")).map((l) => { const [nome, pct] = l.split("|").map((x) => x.trim()); return { nome, meta_pct: Number(String(pct || "0").replace("%", "")) || 0, descricao: "" }; }).filter((p) => p.nome);
        const soma = ps.reduce((s, p) => s + p.meta_pct, 0);
        if (ps.length && soma !== 100 && !(await confirmar("As metas não somam 100%", `A soma está em ${soma}%. Salvar assim mesmo?`, "Salvar"))) return;
        mud.pilares = ps;
        mud.meta_origem = { ...(est.meta_origem || {}), autoral: v("meta_autoral") === "" ? null : Number(v("meta_autoral")), remix: v("meta_remix") === "" ? null : Number(v("meta_remix")),
          mes: v("meta_mes").trim(), funcao_remix: v("funcao_remix").trim(), funcao_autoral: v("funcao_autoral").trim(), nota: v("nota_origem").trim() };
      }
      if (bloco === "identidade") {
        mud.paleta = linhas(v("paleta")).map((l) => { const [nome, hex] = l.split("|").map((x) => x.trim()); return { nome, hex: hex || "" }; }).filter((p) => p.nome);
      }
      if (bloco === "diagnostico") mud.diagnostico = { ...(est.diagnostico || {}), texto: v("diag_texto").trim(), hipoteses: linhas(v("diag_hipoteses")) };
      mud.atualizado_por = App.usuario.id;
      const { error } = await sb.from("estrategias").update(mud).eq("conta_id", contaId);
      if (error) { console.warn(error); return aviso("Não foi possível salvar agora.", "erro"); }
      aviso("Estratégia salva.", "ok");
      fechar();
      carregar();
    });
    document.body.appendChild(fundo);
  }

  // ---------------- Eventos ----------------
  const raiz = $("#est-corpo");
  raiz?.addEventListener("click", async (e) => {
    const conta = e.target.closest("[data-est-conta]");
    if (conta) { contaId = conta.dataset.estConta; return carregar(); }
    const m = e.target.closest("[data-est-mes]");
    if (m) { mes = new Date(mes.getFullYear(), mes.getMonth() + Number(m.dataset.estMes), 1); return carregar(); }
    const ed = e.target.closest("[data-est-editar]");
    if (ed && pode()) return editar(ed.dataset.estEditar);
    if (e.target.closest("[data-est-criar]") && pode()) {
      const { error } = await sb.from("estrategias").insert({ conta_id: contaId });
      if (error) return aviso("Não foi possível criar agora.", "erro");
      carregar();
    }
  });

  // Pilares da conta (a ficha usa na lista de sugestões)
  async function pilaresDe(conta) {
    const { data } = await sb.from("estrategias").select("pilares").eq("conta_id", conta).maybeSingle();
    return (data?.pilares ?? []).map((p) => p.nome);
  }

  window.Estrategia = { carregar, pilaresDe };
})();
