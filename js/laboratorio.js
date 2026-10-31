// =====================================================================
// laboratorio.js: "Laboratório de Experimentos" (contas com 'producao')
// - cada experimento: objetivo, hipótese, período, métrica prioritária e
//   como comparar (autoral × remix, formato, campanha × resto ou grupos
//   A/B escolhidos à mão)
// - os NÚMEROS vêm das métricas coletadas dos posts ligados às fichas
//   (aba Métricas da ficha); resultado, interpretação e conclusão são
//   escritos por você. Nada é inventado: sem post ligado, sem número.
// Só a equipe da conta (colaboradoras não veem).
// =====================================================================
(function () {
  const METRICAS = { views: "Visualizações", alcance: "Alcance", salvos: "Salvamentos", compartilhamentos: "Compartilhamentos", curtidas: "Curtidas", comentarios: "Comentários", seguidores: "Seguidores pelo post" };
  const COMPARAR = { origem: "Autoral × remix", formato: "Por formato", campanha: "Campanha × demais", manual: "Grupos A/B escolhidos" };
  const STATUS = { planejado: "Planejado", em_andamento: "Em andamento", concluido: "Concluído", cancelado: "Cancelado" };
  const ORIGENS = { autoral: "Autoral", remix: "Remix", curadoria: "Curadoria", terceiros: "Terceiros", ia: "Com IA" };
  const FORMATOS = { reels: "Reels", carrossel: "Carrossel", post: "Post", story: "Story", live: "Live", outro: "Outro" };

  let contaId = null;
  let lista = [], campanhas = [];
  let aberto = null; // id do experimento aberto (null = lista)

  const contasVisiveis = () => App.contas.filter((c) => c.recursos?.includes("producao") && !papelNa(c.id));
  const pode = () => editaConta(contaId);
  const n = (v) => (v == null ? "-" : Math.round(v).toLocaleString("pt-BR"));
  const dataBr = (s) => (s ? s.split("-").reverse().join("/") : "");

  async function carregar() {
    const alvo = $("#lab-corpo");
    if (!alvo) return;
    const contas = contasVisiveis();
    if (!App.remoto || !contas.length) { alvo.innerHTML = `<div class="cartao vazio"><p>Nenhuma conta com Produção para você.</p></div>`; return; }
    if (!contas.some((c) => c.id === contaId)) contaId = (contas.find((c) => c.id === App.conta?.id) ?? contas[0]).id;
    const [e, k] = await Promise.all([
      sb.from("experimentos").select("*").eq("conta_id", contaId).order("letra").order("criado_em"),
      sb.from("campanhas").select("id, nome").eq("conta_id", contaId),
    ]);
    if (e.error) { alvo.innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>Não foi possível ler o Laboratório. Rodou o 27_estrategia_lab_portfolio.sql?</span></div>`; return; }
    lista = e.data ?? []; campanhas = k.data ?? [];
    if (aberto && lista.some((x) => x.id === aberto)) return abrir(aberto);
    aberto = null;
    renderLista();
  }

  // ---------------- Lista ----------------
  function renderLista() {
    const alvo = $("#lab-corpo");
    const contas = contasVisiveis();
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        ${contas.length > 1 ? `<div class="segmentado">${contas.map((c) => `<button class="${c.id === contaId ? "ativo" : ""}" data-lab-conta="${esc(c.id)}">@${esc(c.username)}</button>`).join("")}</div>` : ""}
        ${pode() ? `<button class="btn btn-primario" data-lab-novo><span data-icone="mais"></span> Novo experimento</button>` : ""}
      </div>
      <p class="pequeno texto-2" style="margin-top:0">Os números vêm dos posts ligados às fichas (aba Métricas). Resultado e conclusão são escritos por você.</p>
      <div class="lab-lista">${lista.map((x) => `
        <button class="cartao lab-card" data-lab-abrir="${esc(x.id)}">
          <span class="lab-letra">${esc(x.letra || "•")}</span>
          <span class="lab-info"><strong>${esc(x.nome)}</strong>
            <span class="pequeno texto-2">${esc(COMPARAR[x.comparar])} · ${esc(METRICAS[x.metrica])}${x.inicio ? ` · ${dataBr(x.inicio)} a ${dataBr(x.fim) || "?"}` : " · período a definir"}</span>
            <span class="pequeno">${esc(x.hipotese)}</span></span>
          <span class="chip ${x.status === "concluido" ? "fm-chip-ok" : x.status === "em_andamento" ? "chip-destaque" : ""}">${esc(STATUS[x.status])}</span>
        </button>`).join("") || `<div class="cartao vazio"><p>Nenhum experimento ainda.</p></div>`}</div>`;
    pintarIcones(alvo);
  }

  // ---------------- Evidências (números das métricas) ----------------
  async function evidencias(x) {
    if (!x.inicio || !x.fim) return { grupos: [], semPost: 0, conteudos: [], ligados: [] };
    const { data: cs } = await sb.from("conteudos").select("id, numero, titulo, tema, data, origem, formato, campanha_id, ig_media_id")
      .eq("conta_id", contaId).gte("data", x.inicio).lte("data", x.fim).order("data");
    const conteudos = cs ?? [];
    const { data: lig } = await sb.from("experimento_conteudos").select("conteudo_id, grupo").eq("experimento_id", x.id);
    const ligados = lig ?? [];
    const ids = conteudos.map((c) => c.ig_media_id).filter(Boolean);
    const { data: ms } = ids.length ? await sb.from("metricas_posts").select("*").eq("conta_id", contaId).in("media_id", ids) : { data: [] };
    const metrica = (c) => (ms ?? []).find((m) => m.media_id === c.ig_media_id);
    const grupoDe = (c) => {
      if (x.comparar === "origem") return c.origem ? ORIGENS[c.origem] : null;
      if (x.comparar === "formato") return FORMATOS[c.formato] || c.formato;
      if (x.comparar === "campanha") return c.campanha_id && c.campanha_id === x.campanha_id ? "Da campanha" : "Demais";
      const l = ligados.find((g) => g.conteudo_id === c.id);
      return l ? `Grupo ${l.grupo}` : null;
    };
    const mapa = new Map();
    let semPost = 0;
    for (const c of conteudos) {
      const g = grupoDe(c);
      if (!g) continue;
      const m = metrica(c);
      if (!m) { semPost++; continue; }
      if (!mapa.has(g)) mapa.set(g, []);
      mapa.get(g).push({ c, m });
    }
    const media = (l, k) => { const v = l.map((i) => i.m[k]).filter((y) => typeof y === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const grupos = [...mapa].map(([nome, l]) => ({
      nome, posts: l.length, principal: media(l, x.metrica), views: media(l, "views"), alcance: media(l, "alcance"),
      salvos: media(l, "salvos"), compartilhamentos: media(l, "compartilhamentos"),
      salvos_por_mil: (() => { const a = media(l, "alcance"), s = media(l, "salvos"); return a && s != null ? (s / a) * 1000 : null; })(),
      itens: l,
    })).sort((a, b) => (b.principal ?? 0) - (a.principal ?? 0));
    return { grupos, semPost, conteudos, ligados };
  }

  function resumoTexto(x, ev) {
    if (!ev.grupos.length) return "";
    return `Números (média por post, ${METRICAS[x.metrica].toLowerCase()}), ${dataBr(x.inicio)} a ${dataBr(x.fim)}:\n` +
      ev.grupos.map((g) => `- ${g.nome}: ${n(g.principal)} (${g.posts} ${g.posts === 1 ? "post" : "posts"})`).join("\n") +
      (ev.semPost ? `\n${ev.semPost} conteúdo(s) do período sem post ligado ficaram de fora.` : "");
  }

  // ---------------- Experimento aberto ----------------
  async function abrir(id) {
    aberto = id;
    const x = lista.find((e) => e.id === id);
    const alvo = $("#lab-corpo");
    alvo.innerHTML = `<p class="texto-2">Calculando...</p>`;
    const ev = await evidencias(x);
    const p = pode();
    const dis = p ? "" : "disabled";
    const tabela = ev.grupos.length ? `<div class="tabela-wrap"><table class="planilha est-tabela"><thead><tr><th>Grupo</th><th>Posts</th><th>${esc(METRICAS[x.metrica])} (média)</th><th>Views</th><th>Alcance</th><th>Salvos</th><th>Compart.</th><th>Salvos / mil alcançadas</th></tr></thead>
      <tbody>${ev.grupos.map((g) => `<tr><td><strong>${esc(g.nome)}</strong></td><td class="num">${g.posts}</td><td class="num"><strong>${n(g.principal)}</strong></td><td class="num">${n(g.views)}</td><td class="num">${n(g.alcance)}</td><td class="num">${n(g.salvos)}</td><td class="num">${n(g.compartilhamentos)}</td><td class="num">${g.salvos_por_mil == null ? "-" : g.salvos_por_mil.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td></tr>`).join("")}</tbody></table></div>
      ${ev.grupos.some((g) => g.posts < 3) ? `<p class="pequeno texto-3">Atenção: grupos com menos de 3 posts dão uma comparação fraca.</p>` : ""}`
      : `<p class="texto-2 pequeno">${x.inicio && x.fim ? "Ainda sem números: nenhum conteúdo do período tem o post ligado na ficha (aba Métricas)." : "Defina o período para o Laboratório buscar os conteúdos."}</p>`;
    const manual = x.comparar === "manual" && ev.conteudos.length ? `
      <h3 class="rotulo" style="margin-top:14px">Conteúdos do período e grupo</h3>
      ${ev.conteudos.map((c) => { const g = ev.ligados.find((l) => l.conteudo_id === c.id)?.grupo ?? ""; return `<div class="lab-ct">
        <span class="pequeno texto-2">${dataBr(c.data)}</span><span>${esc(c.titulo || c.tema)}${c.ig_media_id ? "" : ` <span class="chip">sem post ligado</span>`}</span>
        <select class="select" data-lab-grupo="${esc(c.id)}" ${dis} aria-label="Grupo"><option value="">Fora</option><option ${g === "A" ? "selected" : ""}>A</option><option ${g === "B" ? "selected" : ""}>B</option></select></div>`; }).join("")}` : "";
    alvo.innerHTML = `
      <button class="btn btn-fantasma" data-lab-voltar><span data-icone="voltar"></span> Experimentos</button>
      <form class="cartao lab-form" novalidate>
        <div class="linha-entre"><h2 class="subtitulo" style="margin:0">${esc(x.letra ? `Experimento ${x.letra}` : "Experimento")}</h2>
          ${p ? `<button type="button" class="btn btn-fantasma btn-perigo btn-p" data-lab-apagar><span data-icone="lixo"></span> Excluir</button>` : ""}</div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="lx-letra">Letra</label><input class="input" id="lx-letra" maxlength="3" value="${esc(x.letra)}" ${dis}></div>
          <div class="campo" style="grid-column: span 2"><label class="rotulo" for="lx-nome">Nome</label><input class="input" id="lx-nome" maxlength="120" value="${esc(x.nome)}" ${dis}></div>
          <div class="campo"><label class="rotulo" for="lx-status">Status</label><select class="select" id="lx-status" ${dis}>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === x.status ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        </div>
        <div class="campo"><label class="rotulo" for="lx-objetivo">Objetivo</label><textarea class="textarea" id="lx-objetivo" rows="2" ${dis}>${esc(x.objetivo)}</textarea></div>
        <div class="campo"><label class="rotulo" for="lx-hipotese">Hipótese</label><textarea class="textarea" id="lx-hipotese" rows="2" ${dis}>${esc(x.hipotese)}</textarea></div>
        <div class="cal-form-grade">
          <div class="campo"><label class="rotulo" for="lx-inicio">Início</label><input class="input" type="date" id="lx-inicio" value="${esc(x.inicio || "")}" ${dis}></div>
          <div class="campo"><label class="rotulo" for="lx-fim">Fim</label><input class="input" type="date" id="lx-fim" value="${esc(x.fim || "")}" ${dis}></div>
          <div class="campo"><label class="rotulo" for="lx-metrica">Métrica prioritária</label><select class="select" id="lx-metrica" ${dis}>${Object.entries(METRICAS).map(([k, v]) => `<option value="${k}" ${k === x.metrica ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="campo"><label class="rotulo" for="lx-comparar">Comparar</label><select class="select" id="lx-comparar" ${dis}>${Object.entries(COMPARAR).map(([k, v]) => `<option value="${k}" ${k === x.comparar ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          ${x.comparar === "campanha" ? `<div class="campo"><label class="rotulo" for="lx-campanha">Campanha</label><select class="select" id="lx-campanha" ${dis}><option value="">-</option>${campanhas.map((k) => `<option value="${esc(k.id)}" ${k.id === x.campanha_id ? "selected" : ""}>${esc(k.nome)}</option>`).join("")}</select></div>` : ""}
        </div>

        <div class="lab-evidencias">
          <div class="linha-entre"><h3 class="titulo-card">📏 Números do período</h3>
            ${p && ev.grupos.length ? `<button type="button" class="btn btn-p btn-fantasma" data-lab-copiar>Copiar para o resultado</button>` : ""}</div>
          ${tabela}
          ${ev.semPost ? `<p class="pequeno texto-2">${ev.semPost} conteúdo(s) do período ainda sem post ligado (ficam de fora).</p>` : ""}
          ${manual}
        </div>

        <div class="campo"><label class="rotulo" for="lx-resultado">Resultado</label><textarea class="textarea" id="lx-resultado" rows="3" placeholder="O que os números mostraram" ${dis}>${esc(x.resultado)}</textarea></div>
        <div class="campo"><label class="rotulo" for="lx-interpretacao">Interpretação</label><textarea class="textarea" id="lx-interpretacao" rows="3" ${dis}>${esc(x.interpretacao)}</textarea></div>
        <div class="campo"><label class="rotulo" for="lx-conclusao">Conclusão</label><textarea class="textarea" id="lx-conclusao" rows="2" ${dis}>${esc(x.conclusao)}</textarea></div>
        <div class="campo"><label class="rotulo" for="lx-proximo">Próximo teste</label><textarea class="textarea" id="lx-proximo" rows="2" ${dis}>${esc(x.proximo_teste)}</textarea></div>
        ${p ? `<div class="linha" style="justify-content:flex-end"><button type="submit" class="btn btn-primario">Salvar</button></div>` : ""}
      </form>`;
    pintarIcones(alvo);
    const f = (s) => $(s, alvo);
    f("[data-lab-copiar]")?.addEventListener("click", () => {
      const t = resumoTexto(x, ev);
      const el = f("#lx-resultado");
      el.value = el.value.trim() ? `${el.value.trim()}\n\n${t}` : t;
    });
    // trocou o jeito de comparar: salva tudo (o que já foi escrito não se perde) e recalcula
    f("#lx-comparar")?.addEventListener("change", () => f("form").requestSubmit());
    $$("[data-lab-grupo]", alvo).forEach((s) => s.addEventListener("change", async () => {
      const cid = s.dataset.labGrupo;
      const r = s.value
        ? await sb.from("experimento_conteudos").upsert({ experimento_id: x.id, conteudo_id: cid, conta_id: contaId, grupo: s.value })
        : await sb.from("experimento_conteudos").delete().eq("experimento_id", x.id).eq("conteudo_id", cid);
      if (r.error) return aviso("Não foi possível salvar o grupo.", "erro");
      abrir(x.id);
    }));
    f("form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!p) return;
      salvar(x, {
        letra: f("#lx-letra").value.trim(), nome: f("#lx-nome").value.trim() || x.nome, status: f("#lx-status").value,
        objetivo: f("#lx-objetivo").value.trim(), hipotese: f("#lx-hipotese").value.trim(),
        inicio: f("#lx-inicio").value || null, fim: f("#lx-fim").value || null, metrica: f("#lx-metrica").value,
        comparar: f("#lx-comparar").value, campanha_id: f("#lx-campanha") ? f("#lx-campanha").value || null : x.campanha_id,
        resultado: f("#lx-resultado").value.trim(), interpretacao: f("#lx-interpretacao").value.trim(),
        conclusao: f("#lx-conclusao").value.trim(), proximo_teste: f("#lx-proximo").value.trim(),
      }, true);
    });
  }

  async function salvar(x, mud, avisar = false) {
    if (mud.inicio && mud.fim && mud.inicio > mud.fim) return aviso("O fim precisa ser depois do início.", "atencao");
    const { data, error } = await sb.from("experimentos").update(mud).eq("id", x.id).select().single();
    if (error) { console.warn(error); return aviso("Não foi possível salvar agora.", "erro"); }
    lista = lista.map((e) => (e.id === x.id ? data : e));
    if (avisar) aviso("Experimento salvo.", "ok");
    abrir(x.id);
  }

  // ---------------- Eventos ----------------
  const raiz = $("#lab-corpo");
  raiz?.addEventListener("click", async (e) => {
    const conta = e.target.closest("[data-lab-conta]");
    if (conta) { contaId = conta.dataset.labConta; aberto = null; return carregar(); }
    const ab = e.target.closest("[data-lab-abrir]");
    if (ab) return abrir(ab.dataset.labAbrir);
    if (e.target.closest("[data-lab-voltar]")) { aberto = null; return renderLista(); }
    if (e.target.closest("[data-lab-novo]") && pode()) {
      const prox = String.fromCharCode(65 + lista.filter((x) => /^[A-Z]$/.test(x.letra)).length);
      const { data, error } = await sb.from("experimentos").insert({ conta_id: contaId, letra: prox, nome: "Novo experimento" }).select().single();
      if (error) return aviso("Não foi possível criar agora.", "erro");
      lista.push(data);
      return abrir(data.id);
    }
    if (e.target.closest("[data-lab-apagar]") && pode()) {
      const x = lista.find((y) => y.id === aberto);
      if (!(await confirmar("Excluir experimento?", `"${x.nome}" e as anotações dele saem do Laboratório.`, "Excluir", true))) return;
      const { error } = await sb.from("experimentos").delete().eq("id", x.id);
      if (error) return aviso("Não foi possível excluir agora.", "erro");
      aberto = null; carregar();
    }
  });

  window.Laboratorio = { carregar };
})();
