// =====================================================================
// analises.js: a aba "Análises" do Instagram
// - filtro de período (7, 30, 90 dias, 1 ano) e botão Atualizar
// - 5 números principais + linha de detalhes (curtidas, salvos...)
// - gráficos por dia (alcance e novos seguidores), com hover
// - melhores posts, com ordenação (curtidos, comentados, salvos...)
// - quem mais comenta: dos posts do período ou de todos os posts
// Os dados vêm da função ig-insights, que guarda o resultado por 6 horas.
// =====================================================================
(function () {
  const PERIODOS = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"], [365, "1 ano"]];
  const ORDENS = [
    ["interacoes", "Melhores"], ["curtidas", "Mais curtidos"], ["comentarios", "Mais comentados"],
    ["salvos", "Mais salvos"], ["compartilhamentos", "Mais compartilhados"], ["views", "Mais vistos"],
  ];

  let periodo = memoria.ler("analises_periodo", 30);
  if (!PERIODOS.some(([p]) => p === periodo)) periodo = 30;
  let escopo = memoria.ler("analises_escopo", "periodo"); // ranking: "periodo" ou "todos"
  let ordemPosts = "interacoes";
  let dados = null;
  let exemplo = false;
  let pedidoAtual = 0; // só o último pedido desenha a tela (cliques rápidos não se atropelam)

  const n = (v) => Number(v || 0).toLocaleString("pt-BR");
  const compacto = (v) => Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(v || 0));
  const curto = (p) => (p === 365 ? "1 ano" : `${p}d`);
  const nomePeriodo = (p) => (p === 365 ? "último ano" : `últimos ${p} dias`);

  const ICON = {
    curtidas: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    comentarios: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>',
    salvos: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    compartilhamentos: '<path d="M22 3 11 14M22 3l-7 18-4-7-7-4z"/>',
    views: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    alcance: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
    perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    leads: '<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    atualizar: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  };
  const ic = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

  function haQuanto(iso) {
    if (!iso) return "";
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.floor(min / 60)} h`;
    return `em ${dataHora(iso)}`;
  }
  const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const dataPost = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  // ---------------- Dados fictícios (só pra visualizar) ----------------
  function dadosExemplo(p, esc) {
    const dias = [...Array(p)].map((_, i) => new Date(Date.now() - (p - i) * 864e5).toISOString().slice(0, 10));
    const alcance = dias.map((dia, i) => ({ dia, valor: Math.round(2500 + 1500 * Math.sin(i / 3) + (i % 7) * 180) }));
    const novos = dias.map((dia, i) => ({ dia, valor: Math.round(40 + 25 * Math.cos(i / 4) + (i % 5) * 6) }));
    const tipos = ["Reels", "Carrossel", "Foto", "Reels", "Reels", "Carrossel", "Reels", "Foto", "Reels", "Carrossel"];
    const posts = tipos.map((tipo, i) => {
      const c = 300 + ((i * 397) % 1100), co = 20 + ((i * 53) % 140), s = 40 + ((i * 211) % 700), sh = 10 + ((i * 97) % 260);
      return { id: `ex${i}`, tipo, legenda: `Post de exemplo ${i + 1}`, miniatura: null, link: null, data: new Date(Date.now() - (i * 3 + 1) * 864e5).toISOString(),
        curtidas: c, comentarios: co, salvos: s, compartilhamentos: sh, alcance: 4000 + i * 900, views: 6000 + ((i * 1777) % 20000), interacoes: c + co + s + sh };
    });
    const todos = esc === "todos";
    return {
      ok: true, conectado: true, periodo: p, atualizado_em: new Date().toISOString(), aproximado: false,
      perfil: { username: "sua_conta", seguidores: 12530, posts: 340 },
      totais: { alcance: alcance.reduce((s, x) => s + x.valor, 0), contas_engajadas: 4541, interacoes: 7002, curtidas: 3184, comentarios: 827,
        compartilhamentos: 666, salvos: 1546, views: 193456, visitas_perfil: 5987, novos_seguidores: novos.reduce((s, x) => s + x.valor, 0) },
      series: { alcance, novos_seguidores: novos },
      posts,
      comentaristas: { escopo: esc, posts_analisados: todos ? 138 : 10, comentarios_analisados: todos ? 4252 : 164, pessoas: todos ? 2980 : 156,
        atualizado_em: new Date().toISOString(),
        ranking: ["ana.souza", "brunolima", "carla_m", "diego.alves", "elisarocha", "fabionunes"].map((username, i) => ({ username, total: (todos ? 40 : 9) - i * 2 })),
        recorrentes: ["Eu quero", "Quero 🧡", "Como funciona?", "Tenho interesse", "🔥", "Amei", "(marcou alguém)", "Quanto custa?"]
          .map((texto, i) => ({ texto, total: (todos ? 320 : 48) - i * (todos ? 35 : 5), pessoas: (todos ? 300 : 45) - i * (todos ? 33 : 5) })) },
    };
  }

  // ---------------- Carregar ----------------
  async function carregar(opcoes = {}) {
    const alvo = $("#aba-metricas");
    const meu = ++pedidoAtual;
    if (!dados || opcoes.trocouPeriodo) alvo.innerHTML = `<div class="texto-2">Carregando análises...</div>`;
    else marcarCarregando(opcoes.comentarios ? "comentarios" : opcoes.atualizar ? "tudo" : null);

    let leads = 0;
    try { leads = (await Dados.contagens(App.conta?.id)).leads; } catch { /* zero */ }

    const resultado = exemplo ? dadosExemplo(periodo, escopo) : await Dados.analises(periodo, { ...opcoes, escopo });
    if (meu !== pedidoAtual) return; // chegou um pedido mais novo: descarta este
    dados = resultado;

    if (!dados) { renderVazio(leads); return; }
    render(leads);
  }

  function marcarCarregando(qual) {
    const b = qual === "comentarios" ? $("#an-comentar") : qual === "tudo" ? $("#an-atualizar") : null;
    if (b) { b.disabled = true; b.innerHTML = `${ic("atualizar")} ${qual === "comentarios" ? "Lendo comentários..." : "Atualizando..."}`; }
  }

  function renderVazio(leads) {
    const alvo = $("#aba-metricas");
    alvo.innerHTML = `
      <div class="grade-cartoes" style="margin-bottom:16px">
        <div class="cartao kpi"><div class="numero">${n(leads)}</div><span class="kpi-rotulo">Leads captados</span></div>
      </div>
      <div class="cartao vazio">
        <div class="vazio-icone" data-icone="grafico"></div>
        <h2 class="subtitulo">Conecte seu Instagram pra ver as análises</h2>
        <p>Com o Supabase e a API do Instagram configurados (veja o LEIA-ME), aparecem aqui seguidores, alcance por dia, melhores posts e quem mais comenta.</p>
        <button class="btn btn-p" data-an="exemplo">Ver um exemplo com números fictícios</button>
      </div>`;
    pintarIcones(alvo);
  }

  // ---------------- Desenhar ----------------
  function render(leads) {
    const d = dados, t = d.totais || {};
    const aprox = d.aproximado ? `<span title="O Instagram entregou este número em blocos; a soma pode contar a mesma pessoa mais de uma vez."> (aprox.)</span>` : "";
    const kpi = (valor, rotulo) => `<div class="cartao kpi"><div class="numero">${valor}</div><span class="kpi-rotulo">${rotulo}</span></div>`;
    const mini = (icone, valor, rotulo) => `<span>${ic(icone)} <strong>${n(valor)}</strong> ${rotulo}</span>`;

    $("#aba-metricas").innerHTML = `
      ${exemplo ? `<div class="faixa faixa-info" style="margin-bottom:14px"><span data-icone="info"></span><span>Exemplo com números fictícios, só pra visualizar. <a href="#" data-an="sair-exemplo">Voltar</a></span></div>` : ""}

      <div class="an-topo">
        <div class="chips-periodo" role="group" aria-label="Período">
          ${PERIODOS.map(([p, r]) => `<button class="chip-periodo ${p === periodo ? "ativo" : ""}" data-periodo="${p}" aria-pressed="${p === periodo}">${r}</button>`).join("")}
        </div>
        <div class="linha">
          <span class="pequeno texto-2" title="Os números ficam guardados por 6 horas. Clique em Atualizar pra buscar agora.">Atualizado ${esc(haQuanto(d.atualizado_em))}</span>
          <button class="btn btn-p" id="an-atualizar" data-an="atualizar">${ic("atualizar")} Atualizar</button>
        </div>
      </div>

      <div class="kpis">
        ${kpi(n(d.perfil?.seguidores), "Seguidores")}
        ${kpi(`+${n(t.novos_seguidores)}`, `Novos seg. (${curto(periodo)})`)}
        ${kpi(n(t.alcance), `Alcance (${curto(periodo)})${aprox}`)}
        ${kpi(n(t.contas_engajadas), `Contas engajadas${aprox}`)}
        ${kpi(n(t.interacoes), "Interações")}
      </div>
      <div class="kpis-mini">
        ${mini("views", t.views, "visualizações")}
        ${mini("perfil", t.visitas_perfil, "visitas ao perfil")}
        ${mini("curtidas", t.curtidas, "curtidas")}
        ${mini("comentarios", t.comentarios, "comentários")}
        ${mini("compartilhamentos", t.compartilhamentos, "compartilhamentos")}
        ${mini("salvos", t.salvos, "salvos")}
        ${mini("leads", leads, "leads captados")}
      </div>

      <div class="cartao" style="margin-top:16px">
        <h2 class="titulo-card">📈 Alcance por dia <span class="dica-titulo">(passe o mouse pra ver os números)</span></h2>
        ${graficoBarras(d.series?.alcance || [], "contas alcançadas")}
      </div>
      <div class="cartao" style="margin-top:16px">
        <h2 class="titulo-card">🌱 Novos seguidores por dia</h2>
        ${graficoBarras(d.series?.novos_seguidores || [], "novos seguidores")}
      </div>

      <div class="cartao" style="margin-top:16px">
        <div class="linha-entre" style="flex-wrap:wrap;margin-bottom:12px">
          <h2 class="titulo-card">🔥 Melhores posts <span class="dica-titulo">(${nomePeriodo(periodo)})</span></h2>
          <div class="chips-periodo" role="group" aria-label="Ordenar posts">
            ${ORDENS.map(([k, r]) => `<button class="chip-periodo ${k === ordemPosts ? "ativo" : ""}" data-ordem-post="${k}" aria-pressed="${k === ordemPosts}">${r}</button>`).join("")}
          </div>
        </div>
        <div id="an-posts"></div>
        <p class="ajuda" style="margin-bottom:0">Só aparecem posts e Reels publicados pela conta. Stories e collabs publicados por outras contas não vêm pela API do Instagram.</p>
      </div>

      <div class="cartao" style="margin-top:16px">
        <div class="linha-entre" style="flex-wrap:wrap">
          <h2 class="titulo-card">🏆 Quem mais comenta</h2>
          <div class="linha">
            <div class="segmentado" role="group" aria-label="Quais posts analisar">
              <button class="${escopo === "periodo" ? "ativo" : ""}" data-escopo="periodo" aria-pressed="${escopo === "periodo"}">Posts do período</button>
              <button class="${escopo === "todos" ? "ativo" : ""}" data-escopo="todos" aria-pressed="${escopo === "todos"}">Todos os posts</button>
            </div>
            <button class="btn btn-p" id="an-comentar" data-an="comentarios">${ic("atualizar")} ${d.comentaristas ? "Atualizar ranking" : "Analisar comentários"}</button>
          </div>
        </div>
        <div id="an-ranking"></div>
      </div>

      <div class="cartao" style="margin-top:16px">
        <h2 class="titulo-card">💬 Comentários mais recorrentes <span class="dica-titulo">(os mesmos posts do ranking acima)</span></h2>
        <div id="an-recorrentes"></div>
      </div>`;
    pintarIcones($("#aba-metricas"));
    renderPosts();
    renderRanking();
    renderRecorrentes();
  }

  // Top 10 comentários que se repetem (vem na mesma leitura do ranking)
  function renderRecorrentes() {
    const c = dados.comentaristas;
    const alvo = $("#an-recorrentes");
    if (!c) { alvo.innerHTML = `<div class="info-atualizacao">🕘 Clique em <strong>Analisar comentários</strong> (no quadro acima) pra ver os comentários que mais se repetem.</div>`; return; }
    if (!c.recorrentes) { alvo.innerHTML = `<div class="info-atualizacao">🕘 Clique em <strong>Atualizar ranking</strong> (no quadro acima) pra ver os comentários que mais se repetem.</div>`; return; }
    if (!c.recorrentes.length) { alvo.innerHTML = `<p class="texto-2">Nenhum comentário se repetiu nesses posts.</p>`; return; }
    const max = Math.max(1, ...c.recorrentes.map((r) => r.total));
    alvo.innerHTML = `
      <ol class="ranking ranking-frases">${c.recorrentes.map((r) => `
        <li>
          <span class="frase" title="${esc(r.texto)}">"${esc(r.texto)}"</span>
          <span class="barra-rank" aria-hidden="true"><span style="width:${(r.total / max) * 100}%"></span></span>
          <span class="num" title="${n(r.total)} vezes, de ${n(r.pessoas)} ${r.pessoas === 1 ? "pessoa" : "pessoas"}">${n(r.total)}×</span>
        </li>`).join("")}</ol>
      <p class="ajuda" style="margin-bottom:0">Maiúsculas, acentos, pontuação e emojis no meio do texto não importam ("Eu quero!" e "eu quero 🙏" contam juntos). Passe o mouse no número pra ver de quantas pessoas vieram.</p>`;
  }

  function renderPosts() {
    const posts = [...(dados.posts || [])].sort((a, b) => (b[ordemPosts] || 0) - (a[ordemPosts] || 0)).slice(0, 15);
    const alvo = $("#an-posts");
    if (!posts.length) { alvo.innerHTML = `<p class="texto-2">Nenhum post publicado nesse período.</p>`; return; }
    alvo.innerHTML = `<div class="carrossel-posts">${posts.map((p, i) => {
      const capa = p.miniatura ? `<img src="${esc(p.miniatura)}" alt="${esc(p.legenda || "Post")}" loading="lazy">` : `<div class="capa-vazia">${icone("imagem")}</div>`;
      const abrir = p.link ? `href="${esc(p.link)}" target="_blank" rel="noopener"` : "";
      return `
        <a class="card-post" ${abrir} title="${esc(p.legenda || "")}">
          <div class="capa">${capa}<span class="selo-tipo">${esc(p.tipo)}</span><span class="selo-pos">${i + 1}º</span></div>
          <div class="card-dados">
            <span class="pequeno texto-2">${esc(dataPost(p.data))}</span>
            <div class="stats">
              <span title="Curtidas">${ic("curtidas")} ${compacto(p.curtidas)}</span>
              <span title="Comentários">${ic("comentarios")} ${compacto(p.comentarios)}</span>
              <span title="Salvos">${ic("salvos")} ${compacto(p.salvos)}</span>
              <span title="Compartilhamentos">${ic("compartilhamentos")} ${compacto(p.compartilhamentos)}</span>
              <span title="Visualizações">${ic("views")} ${compacto(p.views)}</span>
              <span title="Alcance">${ic("alcance")} ${compacto(p.alcance)}</span>
            </div>
          </div>
        </a>`;
    }).join("")}</div>`;
  }

  function renderRanking() {
    const c = dados.comentaristas;
    const alvo = $("#an-ranking");
    const qual = escopo === "todos" ? "os seus posts mais recentes (até 150)" : `os posts dos ${nomePeriodo(periodo)}`;
    if (!c) {
      alvo.innerHTML = `<div class="info-atualizacao">🕘 Ainda não analisado. Clique em <strong>Analisar comentários</strong> pra ler ${qual}. Leva alguns segundos e só atualiza quando você clica.</div>`;
      return;
    }
    const max = Math.max(1, ...(c.ranking || []).map((r) => r.total));
    alvo.innerHTML = `
      <div class="info-atualizacao">🕘 <strong>Última atualização: ${esc(dataHora(c.atualizado_em))}</strong> · ${n(c.posts_analisados)} posts e ${n(c.comentarios_analisados)} comentários de ${n(c.pessoas)} pessoas analisados. Só atualiza quando você clica.</div>
      ${(c.ranking || []).length ? `<ol class="ranking">${c.ranking.map((r) => `
        <li>
          <a href="https://instagram.com/${encodeURIComponent(r.username)}" target="_blank" rel="noopener">@${esc(r.username)}</a>
          <span class="barra-rank" aria-hidden="true"><span style="width:${(r.total / max) * 100}%"></span></span>
          <span class="num">${n(r.total)}</span>
        </li>`).join("")}</ol>` : `<p class="texto-2">Nenhum comentário encontrado.</p>`}
      <p class="ajuda" style="margin-bottom:0">As suas respostas e as respostas dentro dos comentários não entram na contagem.</p>`;
  }

  // ---------------- Eventos ----------------
  $("#aba-metricas").addEventListener("click", (e) => {
    const p = e.target.closest("[data-periodo]");
    if (p) {
      periodo = Number(p.dataset.periodo);
      memoria.gravar("analises_periodo", periodo);
      return carregar({ trocouPeriodo: true });
    }
    const o = e.target.closest("[data-ordem-post]");
    if (o) {
      ordemPosts = o.dataset.ordemPost;
      $$("[data-ordem-post]").forEach((b) => { b.classList.toggle("ativo", b === o); b.setAttribute("aria-pressed", b === o); });
      return renderPosts();
    }
    const s = e.target.closest("[data-escopo]");
    if (s) {
      if (s.dataset.escopo === escopo) return;
      escopo = s.dataset.escopo;
      memoria.gravar("analises_escopo", escopo);
      return carregar({}); // busca o ranking guardado desse escopo (rápido)
    }
    const b = e.target.closest("[data-an]");
    if (!b) return;
    e.preventDefault();
    const acao = b.dataset.an;
    if (acao === "exemplo") { exemplo = true; return carregar({ trocouPeriodo: true }); }
    if (acao === "sair-exemplo") { exemplo = false; dados = null; return carregar({ trocouPeriodo: true }); }
    if (acao === "atualizar") return carregar({ atualizar: true });
    if (acao === "comentarios") return carregar({ comentarios: true });
  });

  window.Analises = {
    carregar: () => carregar({ trocouPeriodo: !dados }),
    reset: () => { dados = null; exemplo = false; }, // trocou de conta: esquece o que estava na tela
  };
})();
