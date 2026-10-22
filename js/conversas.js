// =====================================================================
// conversas.js: a aba "Conversas" (caixa de entrada do direct)
// - lista de conversas, a mais recente em cima
// - conversa aberta à direita, com a caixa de texto já preenchida com a
//   SUGESTÃO da IA. Nada sai sozinho: só quando você clica em Enviar.
// - atualiza em tempo real (Realtime nas tabelas mensagens e sugestoes)
// - "Roteiro": o texto de atendimento que a IA segue (tabela abordagem)
// =====================================================================
(function () {
  const JANELA_MS = 24 * 3600 * 1000;
  const TEXTO_MAX = 1000;

  let conversas = [];
  let atual = null;       // conversa aberta
  let msgs = [];          // mensagens da conversa aberta
  let sugestao = null;    // última sugestão não usada da conversa aberta
  let editado = false;    // você mexeu no texto? então sugestão nova não sobrescreve
  let verArquivadas = false;
  let busca = "";
  let canal = null;       // assinatura do Realtime
  let esperaLista = null;
  let relogio = null;     // atualiza o aviso da janela de 24h

  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const nomeDe = (c) => c.nome || (c.username ? `@${c.username}` : "Sem nome");
  const inicial = (c) => (c.nome || c.username || "?").trim().charAt(0).toUpperCase();
  const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  function quandoCurto(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const hoje = new Date();
    if (d.toDateString() === hoje.toDateString()) return hora(iso);
    if (Date.now() - d.getTime() < 7 * 864e5) return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }

  // Quanto falta pra janela de 24h fechar (ms). <= 0 = fechada.
  const restaJanela = (c) => (c?.ultima_do_cliente_em ? new Date(c.ultima_do_cliente_em).getTime() + JANELA_MS - Date.now() : -1);

  // ---------------- Dados ----------------
  async function lerConversas() {
    let q = sb.from("conversas").select("*").eq("conta_id", App.conta.id)
      .order("ultima_mensagem_em", { ascending: false }).limit(200);
    q = verArquivadas ? q.eq("status", "arquivada") : q.neq("status", "arquivada");
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  async function lerMensagens(conversaId) {
    const { data, error } = await sb.from("mensagens").select("*").eq("conversa_id", conversaId)
      .order("criada_em", { ascending: false }).limit(100);
    if (error) throw error;
    return (data ?? []).reverse();
  }

  async function lerSugestao(conversaId) {
    const { data } = await sb.from("sugestoes").select("*").eq("conversa_id", conversaId).eq("usada", false)
      .order("criada_em", { ascending: false }).limit(1).maybeSingle();
    return data ?? null;
  }

  async function enviar(conversaId, texto, sugestaoId) {
    try {
      const { data, error } = await sb.functions.invoke("enviar-resposta", { body: { conversa_id: conversaId, texto, sugestao_id: sugestaoId } });
      if (error) {
        let msg = "Não foi possível falar com o servidor agora.";
        try { const corpo = await error.context?.json?.(); if (corpo?.erro) msg = corpo.erro; } catch { /* mantém */ }
        return { ok: false, erro: msg };
      }
      return data;
    } catch { return { ok: false, erro: "Não foi possível falar com o servidor agora." }; }
  }

  // ---------------- Carregar ----------------
  async function carregar() {
    const alvo = $("#aba-conversas");
    if (!App.remoto) {
      alvo.innerHTML = `
        <div class="cartao vazio">
          <div class="vazio-icone" data-icone="chat"></div>
          <h2 class="subtitulo">Caixa de entrada</h2>
          <p>As conversas do direct aparecem aqui com uma sugestão de resposta. Precisa do Supabase conectado (veja o LEIA-ME).</p>
        </div>`;
      pintarIcones(alvo);
      return;
    }
    alvo.innerHTML = `
      <div class="cx" id="cx">
        <div class="cartao cx-lista">
          <div class="cx-lista-topo">
            <input class="input" id="cx-busca" type="search" placeholder="Buscar conversa..." aria-label="Buscar conversa" value="${esc(busca)}">
            <button class="btn btn-p" data-acao="roteiro" title="O roteiro de atendimento que a IA segue"><span data-icone="arquivo"></span> Roteiro</button>
          </div>
          <div class="segmentado cx-filtro" role="group" aria-label="Quais conversas">
            <button class="${verArquivadas ? "" : "ativo"}" data-acao="abertas" aria-pressed="${!verArquivadas}">Abertas</button>
            <button class="${verArquivadas ? "ativo" : ""}" data-acao="arquivadas" aria-pressed="${verArquivadas}">Arquivadas</button>
          </div>
          <div class="cx-itens" id="cx-itens"><div class="texto-2 pequeno" style="padding:14px">Carregando...</div></div>
        </div>
        <div class="cartao cx-chat" id="cx-chat"></div>
      </div>`;
    pintarIcones(alvo);
    renderChat();
    assinar();
    await carregarLista();
    // Reabre a conversa que estava aberta (ex: voltou de outra aba)
    if (atual) { const c = conversas.find((x) => x.id === atual.id); if (c) abrir(c.id); else { atual = null; renderChat(); } }
    clearInterval(relogio);
    relogio = setInterval(renderJanela, 60e3);
  }

  async function carregarLista() {
    try { conversas = await lerConversas(); }
    catch (e) { console.warn(e); $("#cx-itens").innerHTML = `<div class="texto-2 pequeno" style="padding:14px">Não foi possível ler as conversas. Rodou o 11_conversas.sql?</div>`; return; }
    if (atual) atual = conversas.find((c) => c.id === atual.id) ?? atual;
    renderLista();
  }

  // ---------------- Desenhar: lista ----------------
  function renderLista() {
    const alvo = $("#cx-itens");
    if (!alvo) return;
    const t = norm(busca);
    const lista = t ? conversas.filter((c) => norm(`${c.nome} ${c.username}`).includes(t)) : conversas;
    if (!lista.length) {
      alvo.innerHTML = `<div class="texto-2 pequeno" style="padding:18px; text-align:center">${
        conversas.length ? "Nenhuma conversa com essa busca." : verArquivadas ? "Nenhuma conversa arquivada." : "Quando alguém mandar mensagem no direct, a conversa aparece aqui."}</div>`;
      return;
    }
    alvo.innerHTML = lista.map((c) => `
      <button class="cx-item ${c.id === atual?.id ? "ativo" : ""}" data-conversa="${esc(c.id)}">
        <span class="avatar" aria-hidden="true">${esc(inicial(c))}</span>
        <span class="cx-item-info">
          <span class="cx-item-nome">${esc(nomeDe(c))}</span>
          <span class="cx-item-sub">${c.status === "aguardando" ? "Aguardando resposta" : c.status === "respondida" ? "Respondida" : "Arquivada"}</span>
        </span>
        <span class="cx-item-lado">
          <span class="cx-item-hora">${esc(quandoCurto(c.ultima_mensagem_em))}</span>
          ${c.status === "aguardando" ? `<span class="cx-ponto" title="Aguardando resposta"></span>` : ""}
        </span>
      </button>`).join("");
  }

  // ---------------- Desenhar: conversa aberta ----------------
  function renderChat() {
    const alvo = $("#cx-chat");
    if (!alvo) return;
    $("#cx")?.classList.toggle("aberta", !!atual);
    if (!atual) {
      alvo.innerHTML = `
        <div class="vazio cx-vazio">
          <div class="vazio-icone" data-icone="chat"></div>
          <h2 class="subtitulo">Escolha uma conversa</h2>
          <p>A IA deixa uma sugestão de resposta pronta. Você revisa, ajusta se quiser e clica em Enviar.</p>
        </div>`;
      pintarIcones(alvo);
      return;
    }
    const c = atual;
    alvo.innerHTML = `
      <div class="cx-chat-topo">
        <button class="btn btn-icone btn-fantasma cx-voltar" data-acao="voltar" aria-label="Voltar para a lista"><span data-icone="voltar"></span></button>
        <span class="avatar" aria-hidden="true">${esc(inicial(c))}</span>
        <div class="cx-chat-quem">
          <div class="nome-l">${esc(nomeDe(c))}</div>
          ${c.username ? `<a class="pequeno" href="https://instagram.com/${encodeURIComponent(c.username)}" target="_blank" rel="noopener">@${esc(c.username)}</a>` : ""}
        </div>
        <span id="cx-janela"></span>
        <button class="btn btn-p" data-acao="${c.status === "arquivada" ? "desarquivar" : "arquivar"}">${c.status === "arquivada" ? "Desarquivar" : "Arquivar"}</button>
      </div>
      <div class="cx-msgs" id="cx-msgs"></div>
      <div class="cx-resposta">
        <div id="cx-sug-aviso"></div>
        <textarea class="textarea" id="cx-texto" maxlength="${TEXTO_MAX}" placeholder="Escreva a resposta..." aria-label="Resposta"></textarea>
        <div class="linha-entre">
          <span class="pequeno texto-2" id="cx-contador">0/${TEXTO_MAX} · Ctrl+Enter envia</span>
          <button class="btn btn-primario" id="cx-enviar" data-acao="enviar">Enviar</button>
        </div>
      </div>`;
    pintarIcones(alvo);
    renderMensagens();
    preencherSugestao(true);
    renderJanela();
  }

  function renderMensagens() {
    const alvo = $("#cx-msgs");
    if (!alvo) return;
    if (!msgs.length) { alvo.innerHTML = `<div class="texto-2 pequeno" style="margin:auto">Sem mensagens ainda.</div>`; return; }
    let dia = "";
    alvo.innerHTML = msgs.map((m) => {
      const d = new Date(m.criada_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
      const sep = d !== dia ? `<div class="cx-dia">${esc(d)}</div>` : "";
      dia = d;
      return `${sep}<div class="cx-balao ${m.autor === "eu" ? "eu" : "cliente"}">${esc(m.texto)}<span class="cx-hora">${esc(hora(m.criada_em))}</span></div>`;
    }).join("");
    alvo.scrollTop = alvo.scrollHeight;
  }

  // Põe a sugestão na caixa. forcar = trocar mesmo se você editou.
  function preencherSugestao(forcar = false) {
    const caixa = $("#cx-texto");
    const aviso = $("#cx-sug-aviso");
    if (!caixa || !aviso) return;
    if (sugestao && (forcar || !editado)) {
      caixa.value = sugestao.texto_sugerido;
      editado = false;
    }
    if (!sugestao) aviso.innerHTML = "";
    else if (!editado && caixa.value === sugestao.texto_sugerido) {
      aviso.innerHTML = `<div class="cx-sug">✨ Sugestão da IA. Revise antes de enviar.</div>`;
    } else {
      aviso.innerHTML = `<div class="cx-sug">✨ Há uma sugestão da IA. <button class="link-btn" data-acao="usar-sugestao">Usar a sugestão</button></div>`;
    }
    contar();
  }

  function contar() {
    const caixa = $("#cx-texto");
    if (caixa) $("#cx-contador").textContent = `${caixa.value.length}/${TEXTO_MAX} · Ctrl+Enter envia`;
  }

  function renderJanela() {
    const alvo = $("#cx-janela");
    if (!alvo || !atual) return;
    const resta = restaJanela(atual);
    const btn = $("#cx-enviar");
    if (resta <= 0) {
      alvo.innerHTML = `<span class="pilula-status erro" title="O Instagram só deixa responder até 24h depois da última mensagem da cliente."><span class="ponto"></span>Janela de 24h fechada</span>`;
      if (btn) { btn.disabled = true; btn.title = "Passaram mais de 24h desde a última mensagem da cliente."; }
    } else {
      const h = Math.floor(resta / 3600e3), min = Math.floor((resta % 3600e3) / 60e3);
      alvo.innerHTML = `<span class="pilula-status ${resta < 3 * 3600e3 ? "atencao" : ""}" title="Tempo para responder (regra de 24h do Instagram)"><span class="ponto"></span>Fecha em ${h ? `${h}h ` : ""}${min}min</span>`;
      if (btn) { btn.disabled = false; btn.title = ""; }
    }
  }

  // ---------------- Ações ----------------
  async function abrir(id) {
    const c = conversas.find((x) => x.id === id);
    if (!c) return;
    const trocou = atual?.id !== id;
    atual = c;
    if (trocou) { msgs = []; sugestao = null; editado = false; }
    renderLista();
    renderChat();
    try { [msgs, sugestao] = await Promise.all([lerMensagens(id), lerSugestao(id)]); }
    catch { aviso("Não foi possível abrir a conversa agora.", "erro"); }
    if (atual?.id !== id) return; // trocou de conversa enquanto carregava
    renderMensagens();
    preencherSugestao(trocou);
    if (window.innerWidth > 760) $("#cx-texto")?.focus();
  }

  async function aoEnviar() {
    const caixa = $("#cx-texto");
    const btn = $("#cx-enviar");
    const texto = caixa.value.trim();
    if (!texto || !atual || btn.disabled) return;
    btn.disabled = true; btn.textContent = "Enviando...";
    const conversaId = atual.id;
    const usouSugestao = sugestao ? sugestao.id : null;
    const r = await enviar(conversaId, texto, usouSugestao);
    btn.textContent = "Enviar";
    if (!r?.ok) {
      renderJanela();
      if (!btn.title) btn.disabled = false;
      aviso(r?.erro || "Não foi possível enviar.", "erro");
      return;
    }
    aviso("Mensagem enviada.", "ok");
    if (atual?.id === conversaId) {
      caixa.value = "";
      sugestao = null; editado = false;
      preencherSugestao();
      try { msgs = await lerMensagens(conversaId); renderMensagens(); } catch { /* o Realtime traz */ }
      renderJanela();
    }
    carregarLista();
  }

  async function mudarStatus(status) {
    if (!atual) return;
    const { error } = await sb.from("conversas").update({ status }).eq("id", atual.id);
    if (error) return aviso("Não foi possível alterar agora.", "erro");
    aviso(status === "arquivada" ? "Conversa arquivada." : "Conversa de volta nas abertas.");
    atual = null;
    renderChat();
    carregarLista();
  }

  // ---------------- Roteiro (tabela abordagem) ----------------
  async function abrirRoteiro() {
    const { data } = await sb.from("abordagem").select("texto").eq("conta_id", App.conta.id).maybeSingle();
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `
      <form class="cartao modal cx-roteiro">
        <h3 class="subtitulo">Roteiro de atendimento</h3>
        <p class="texto-2 pequeno" style="margin:4px 0 12px">Cole aqui como o time atende: tom de voz, o que oferecer, preços, links, o que nunca dizer. A IA segue este texto em todas as sugestões de @${esc(App.conta.username || "conta")}.</p>
        <textarea class="textarea" rows="14" placeholder="Ex: Somos acolhedoras e diretas. Sempre perguntamos o nome do projeto antes de passar valores..."></textarea>
        <div class="linha" style="justify-content:flex-end; margin-top:14px">
          <button type="button" class="btn" data-r="0">Cancelar</button>
          <button type="submit" class="btn btn-primario">Salvar roteiro</button>
        </div>
      </form>`;
    const caixa = $("textarea", fundo);
    caixa.value = data?.texto ?? "";
    const fechar = () => fundo.remove();
    fundo.addEventListener("click", (e) => { if (e.target === fundo || e.target.dataset.r === "0") fechar(); });
    $("form", fundo).addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.from("abordagem").upsert(
        { conta_id: App.conta.id, texto: caixa.value.trim(), atualizada_em: new Date().toISOString() },
        { onConflict: "conta_id" },
      );
      if (error) return aviso("Não foi possível salvar o roteiro.", "erro");
      aviso("Roteiro salvo. Vale para as próximas sugestões.", "ok");
      fechar();
    });
    document.body.appendChild(fundo);
    caixa.focus();
  }

  // ---------------- Tempo real ----------------
  function assinar() {
    parar();
    const contaId = App.conta.id;
    canal = sb.channel(`caixa-${contaId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens", filter: `conta_id=eq.${contaId}` }, (p) => {
        const m = p.new;
        // lista: reordena (agrupa várias mensagens seguidas numa leitura só)
        clearTimeout(esperaLista);
        esperaLista = setTimeout(carregarLista, 300);
        if (m.conversa_id !== atual?.id || msgs.some((x) => x.id === m.id)) return;
        msgs.push(m);
        msgs.sort((a, b) => a.criada_em.localeCompare(b.criada_em));
        if (m.autor === "cliente") atual.ultima_do_cliente_em = m.criada_em;
        renderMensagens();
        renderJanela();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sugestoes", filter: `conta_id=eq.${contaId}` }, (p) => {
        const s = p.new;
        if (s.conversa_id !== atual?.id || s.usada) return;
        sugestao = s;
        preencherSugestao();
      })
      .subscribe();
  }

  function parar() {
    if (canal) { sb.removeChannel(canal); canal = null; }
    clearInterval(relogio);
  }

  // ---------------- Eventos (uma vez só, por delegação) ----------------
  const raiz = $("#aba-conversas");

  raiz.addEventListener("click", (e) => {
    const item = e.target.closest("[data-conversa]");
    if (item) return abrir(item.dataset.conversa);
    const b = e.target.closest("[data-acao]");
    if (!b) return;
    const acao = b.dataset.acao;
    if (acao === "enviar") return aoEnviar();
    if (acao === "usar-sugestao") return preencherSugestao(true);
    if (acao === "voltar") { atual = null; renderChat(); renderLista(); return; }
    if (acao === "arquivar") return mudarStatus("arquivada");
    if (acao === "desarquivar") return mudarStatus("respondida");
    if (acao === "roteiro") return abrirRoteiro();
    if (acao === "abertas" || acao === "arquivadas") {
      verArquivadas = acao === "arquivadas";
      atual = null;
      return carregar();
    }
  });

  raiz.addEventListener("input", (e) => {
    if (e.target.id === "cx-busca") { busca = e.target.value; renderLista(); }
    if (e.target.id === "cx-texto") {
      editado = !sugestao || e.target.value !== sugestao.texto_sugerido;
      preencherSugestao();
    }
  });

  raiz.addEventListener("keydown", (e) => {
    if (e.target.id === "cx-texto" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); aoEnviar(); }
  });

  // Ao trocar de conta, a conversa aberta era da outra
  window.Conversas = { carregar() { if (atual && atual.conta_id !== App.conta?.id) { atual = null; msgs = []; sugestao = null; } return carregar(); }, parar };
})();
