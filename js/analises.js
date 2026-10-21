// =====================================================================
// analises.js: a aba "Análises" do Instagram
// - filtro de período (7, 30, 90 dias) e botão Atualizar
// - números do período (seguidores, novos, alcance, engajamento...)
// - gráficos por dia (alcance e novos seguidores), com hover
// - melhores posts, com ordenação (curtidos, comentados, salvos...)
// - quem mais comenta (só calcula quando você pede)
// Os dados vêm da função ig-insights, que guarda o resultado por 6 horas.
// =====================================================================
(function () {
  const PERIODOS = [7, 30, 90];
  const ORDENS = [
    ["interacoes", "Melhores"], ["curtidas", "Mais curtidos"], ["comentarios", "Mais comentados"],
    ["salvos", "Mais salvos"], ["compartilhamentos", "Mais compartilhados"], ["views", "Mais vistos"],
  ];

  let periodo = memoria.ler("analises_periodo", 30);
  let ordemPosts = "interacoes";
  let dados = null;
  let exemplo = false;
  let pedidoAtual = 0; // só o último pedido desenha a tela (cliques rápidos não se atropelam)

  const n = (v) => Number(v || 0).toLocaleString("pt-BR");
  const compacto = (v) => Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(v || 0));

  const ICON = {
    curtidas: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    comentarios: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>',
    salvos: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    compartilhamentos: '<path d="M22 3 11 14M22 3l-7 18-4-7-7-4z"/>',
    views: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    alcance: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
    atualizar: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  };
  const ic = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

  function haQuanto(iso) {
    if (!iso) return "";
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.floor(min / 60)} h`;
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  const dataPost = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  // ---------------- Dados fictícios (só pra visualizar) ----------------
  function dadosExemplo(p) {
    const dias = [...Array(p)].map((_, i) => new Date(Date.now() - (p - i) * 864e5).toISOString().slice(0, 10));
    const alcance = dias.map((dia, i) => ({ dia, valor: Math.round(2500 + 1500 * Math.sin(i / 3) + (i % 7) * 180) }));
    const novos = dias.slice(-30).map((dia, i) => ({ dia, valor: Math.round(40 + 25 * Math.cos(i / 4) + (i % 5) * 6) }));
    const tipos = ["Reels", "Carrossel", "Foto", "Reels", "Reels", "Carrossel", "Reels", "Foto"];
    const posts = tipos.map((tipo, i) => {
      const c = 300 + ((i * 397) % 1100), co = 20 + ((i * 53) % 140), s = 40 + ((i * 211) % 700), sh = 10 + ((i * 97) % 260);
      return { id: `ex${i}`, tipo, legenda: `Post de exemplo ${i + 1}`, miniatura: null, link: null, data: new Date(Date.now() - (i * 3 + 1) * 864e5).toISOString(),
        curtidas: c, comentarios: co, salvos: s, compartilhamentos: sh, alcance: 4000 + i * 900, views: 6000 + ((i * 1777) % 20000), interacoes: c + co + s + sh };
    });
    return {
      ok: true, conectado: true, periodo: p, atualizado_em: new Date().toISOString(), aproximado: p > 30,
      perfil: { username: "sua_conta", seguidores: 12530, posts: 340 },
      totais: { alcance: alcance.reduce((s, x) => s + x.valor, 0), contas_engajadas: 4541, interacoes: 7002, curtidas: 3184, comentarios: 827,
        compartilhamentos: 666, salvos: 1546, views: 193456, visitas_perfil: 5987, novos_seguidores: novos.reduce((s, x) => s + x.valor, 0) },
      series: { alcance, novos_seguidores: novos },
      posts,
      comentaristas: { posts_analisados: 8, comentarios_analisados: 164, pessoas: 156, atualizado_em: new Date().toISOString(),
        ranking: ["ana.souza", "brunolima", "carla_m", "diego.alves", "elisarocha"].map((username, i) => ({ username, total: 9 - i * 2 })) },
    };
  }

  // ---------------- Carregar ----------------
  async function carregar(opcoes = {}) {
    const alvo = $("#aba-metricas");
    const meu = ++pedidoAtual;
    if (!dados || opcoes.trocouPeriodo) alvo.innerHTML = `<div class="texto-2">Carregando análises...</div>`;
    else marcarCarregando(opcoes.comentarios ? "comentarios" : "tudo");

    let leads = 0, entregas = 0;
    try { const c = await Dados.contagens(); leads = c.leads; } catch { /* zero */ }
    try { entregas = await Dados.entregas24h(); } catch { /* zero */ }

    const resultado = exemplo ? dadosExemplo(periodo) : await Dados.analises(periodo, opcoes);
    if (meu !== pedidoAtual) return; // chegou um pedido mais novo: descarta este
    dados = resultado;

    if (!dados) { renderVazio(leads); return; }
    render(leads, entregas);
  }

  function marcarCarregando(qual) {
    const b = qual === "comentarios" ? $("#an-comentar") : $("#an-atualizar");
    if (b) { b.disabled = true; b.innerHTML = `${ic("atualizar")} ${qual === "comentarios" ? "Lendo comentários..." : "Atualizando..."}`; }
  }

  function renderVazio(leads) {
    const alvo = $("#aba-metricas");
    alvo.innerHTML = `
      <div class="grade-cartoes" style="margin-bottom:16px">
        <div class="cartao"><span class="rotulo">Leads captados</span><div class="numero">${n(leads)}</div></div>
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
  function render(leads, entregas) {
    const d = dados, t = d.totais || {};
    const aprox = d.aproximado ? `<span class="pequeno texto-2" title="Em 90 dias, o Instagram entrega estes números em blocos de 30 dias; a soma conta a mesma pessoa mais de uma vez."> (aprox.)</span>` : "";
    const kpi = (rotulo, valor, extra = "") => `<div class="cartao kpi"><div class="numero">${valor}</div><span class="kpi-rotulo">${rotulo}${extra}</span></div>`;

    $("#aba-metricas").innerHTML = `
      ${exemplo ? `<div class="faixa faixa-info" style="margin-bottom:14px"><span data-icone="info"></span><span>Exemplo com números fictícios, só pra visualizar. <a href="#" data-an="sair-exemplo">Voltar</a></span></div>` : ""}

      <div class="an-topo">
        <div class="chips-periodo" role="group" aria-label="Período">
          ${PERIODOS.map((p) => `<button class="chip-periodo ${p === periodo ? "ativo" : ""}" data-periodo="${p}" aria-pressed="${p === periodo}">${p} dias</button>`).join("")}
        </div>
        <div class="linha">
          <span class="pilula"><span class="ponto-on"></span>@${esc(d.perfil?.username || "")} conectado</span>
          <span class="pilula">${n(entregas)} entrega${entregas === 1 ? "" : "s"} em 24h</span>
          <button class="btn btn-p" id="an-atualizar" data-an="atualizar">${ic("atualizar")} Atualizar</button>
        </div>
      </div>
      <p class="pequeno texto-2" style="margin:-6px 0 14px">Atualizado ${esc(haQuanto(d.atualizado_em))}. Os números ficam guardados por 6 horas; clique em Atualizar pra buscar agora.</p>

      <div class="kpis">
        ${kpi("Seguidores", n(d.perfil?.seguidores))}
        ${kpi(`Novos seg. (${Math.min(periodo, 30)}d)`, `+${n(t.novos_seguidores)}`)}
        ${kpi(`Alcance (${periodo}d)`, n(t.alcance), aprox)}
        ${kpi("Contas engajadas", n(t.contas_engajadas), aprox)}
        ${kpi("Interações", n(t.interacoes))}
        ${kpi("Visualizações", n(t.views))}
        ${kpi("Visitas ao perfil", n(t.visitas_perfil))}
        ${kpi("Leads captados", n(leads))}
      </div>
      <div class="kpis-mini">
        <span>${ic("curtidas")} ${n(t.curtidas)} curtidas</span>
        <span>${ic("comentarios")} ${n(t.comentarios)} comentários</span>
        <span>${ic("compartilhamentos")} ${n(t.compartilhamentos)} compartilhamentos</span>
        <span>${ic("salvos")} ${n(t.salvos)} salvos</span>
      </div>

      <div class="cartao" style="margin-top:16px">
        <span class="rotulo">Alcance por dia <span class="texto-2" style="text-transform:none;letter-spacing:0;font-weight:400">(passe o mouse pra ver os números)</span></span>
        ${graficoBarras(d.series?.alcance || [], "contas alcançadas")}
      </div>
      <div class="cartao" style="margin-top:16px">
        <span class="rotulo">Novos seguidores por dia</span>
        ${graficoBarras(d.series?.novos_seguidores || [], "novos seguidores")}
        ${periodo > 30 ? `<p class="ajuda" style="margin-bottom:0">O Instagram só libera os novos seguidores dos últimos 30 dias.</p>` : ""}
      </div>

      <div class="cartao" style="margin-top:16px">
        <div class="linha-entre" style="flex-wrap:wrap;margin-bottom:12px">
          <h2 class="subtitulo">Melhores posts (${periodo} dias)</h2>
          <div class="chips-periodo" role="group" aria-label="Ordenar posts">
            ${ORDENS.map(([k, r]) => `<button class="chip-periodo ${k === ordemPosts ? "ativo" : ""}" data-ordem-post="${k}" aria-pressed="${k === ordemPosts}">${r}</button>`).join("")}
          </div>
        </div>
        <div id="an-posts"></div>
        <p class="ajuda" style="margin-bottom:0">Só aparecem posts e Reels publicados pela conta. Stories e collabs publicados por outras contas não vêm pela API do Instagram.</p>
      </div>

      <div class="cartao" style="margin-top:16px">
        <div class="linha-entre" style="flex-wrap:wrap;margin-bottom:6px">
          <h2 class="subtitulo">Quem mais comenta <span class="texto-2" style="font-weight:400;font-size:13px">(posts dos últimos ${periodo} dias)</span></h2>
          <button class="btn btn-p" id="an-comentar" data-an="comentarios">${ic("atualizar")} ${d.comentaristas ? "Atualizar ranking" : "Analisar comentários"}</button>
        </div>
        <div id="an-ranking"></div>
      </div>`;
    pintarIcones($("#aba-metricas"));
    renderPosts();
    renderRanking();
  }

  function renderPosts() {
    const posts = [...(dados.posts || [])].sort((a, b) => (b[ordemPosts] || 0) - (a[ordemPosts] || 0)).slice(0, 12);
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
    if (!c) {
      alvo.innerHTML = `<p class="texto-2" style="margin:6px 0 0">Clique em "Analisar comentários" pra descobrir quem mais comenta nos seus posts. Leva alguns segundos e só atualiza quando você clica.</p>`;
      return;
    }
    const max = Math.max(1, ...(c.ranking || []).map((r) => r.total));
    alvo.innerHTML = `
      <p class="pequeno texto-2" style="margin:0 0 12px">Última leitura ${esc(haQuanto(c.atualizado_em))}: ${n(c.posts_analisados)} posts e ${n(c.comentarios_analisados)} comentários de ${n(c.pessoas)} pessoas. As suas respostas e as respostas dentro dos comentários não entram.</p>
      ${(c.ranking || []).length ? `<ol class="ranking">${c.ranking.map((r) => `
        <li>
          <a href="https://instagram.com/${encodeURIComponent(r.username)}" target="_blank" rel="noopener">@${esc(r.username)}</a>
          <span class="barra-rank" aria-hidden="true"><span style="width:${(r.total / max) * 100}%"></span></span>
          <span class="num">${n(r.total)}</span>
        </li>`).join("")}</ol>` : `<p class="texto-2">Nenhum comentário encontrado nesse período.</p>`}`;
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
    const b = e.target.closest("[data-an]");
    if (!b) return;
    e.preventDefault();
    const acao = b.dataset.an;
    if (acao === "exemplo") { exemplo = true; return carregar({ trocouPeriodo: true }); }
    if (acao === "sair-exemplo") { exemplo = false; dados = null; return carregar({ trocouPeriodo: true }); }
    if (acao === "atualizar") return carregar({ atualizar: true });
    if (acao === "comentarios") return carregar({ comentarios: true });
  });

  window.Analises = { carregar: () => carregar({ trocouPeriodo: !dados }) };
})();
