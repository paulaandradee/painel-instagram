// =====================================================================
// conversas.js: a aba "Conversas" (caixa de entrada do direct)
// - lista de conversas, a mais recente em cima
// - conversa aberta à direita, com a caixa de texto já preenchida com a
//   SUGESTÃO da IA. Nada sai sozinho: só quando você clica em Enviar.
// - anexos: imagem, vídeo, PDF, áudio (arquivo ou gravado aqui) e o 🧡
// - atualiza em tempo real (Realtime) e, de reserva, confere a cada 10s
// - "Roteiro": o texto de atendimento que a IA segue (tabela abordagem)
// - "Repescar": traz as conversas do Direct sem resposta dos últimos 7 dias
// =====================================================================
(function () {
  const HORA_MS = 3600 * 1000;
  const JANELA_NORMAL_MS = 24 * HORA_MS;     // resposta normal
  const JANELA_HUMANA_MS = 7 * 24 * HORA_MS; // com a etiqueta Human Agent
  const TEXTO_MAX = 1000;
  const VIGIA_MS = 10e3;  // de quanto em quanto tempo confere mensagens e sugestões novas
  const GRAVACAO_MAX_S = 300;

  // O que o Instagram aceita mandar (tipo da API e limite de tamanho)
  const ACEITOS = [
    { teste: /^image\/(png|jpeg|gif)$/, tipo: "image", maxMb: 8 },
    { teste: /^video\/(mp4|quicktime|webm|ogg|x-msvideo)$/, tipo: "video", maxMb: 25 },
    { teste: /^audio\/(aac|mp4|x-m4a|m4a|wav|x-wav|wave)$/, tipo: "audio", maxMb: 25 },
    { teste: /^application\/pdf$/, tipo: "file", maxMb: 25 },
  ];
  const NOME_TIPO = { image: "Imagem", video: "Vídeo", audio: "Áudio", file: "PDF" };

  let conversas = [];
  let atual = null;       // conversa aberta
  let msgs = [];          // mensagens da conversa aberta
  let sugestao = null;    // última sugestão não usada da conversa aberta
  let editado = false;    // você mexeu no texto? então sugestão nova não sobrescreve
  let anexo = null;       // { arquivo, tipo, previa } esperando o Enviar
  let gravacao = null;    // { gravador, partes, inicio, timer, stream }
  let verArquivadas = false;
  let busca = "";
  let canal = null;       // assinatura do Realtime
  let esperaLista = null;
  let relogio = null;     // a vigia: confere novidades e atualiza o aviso da janela
  const pedidas = new Set(); // conversas que já pediram sugestão nesta sessão
  let gerandoPara = null;    // conversa com sugestão sendo gerada agora

  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const nomeDe = (c) => c.nome || (c.username ? `@${c.username}` : "Sem nome");
  const inicial = (c) => (c.nome || c.username || "?").trim().charAt(0).toUpperCase();
  const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const mb = (bytes) => `${(bytes / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  function quandoCurto(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const hoje = new Date();
    if (d.toDateString() === hoje.toDateString()) return hora(iso);
    if (Date.now() - d.getTime() < 7 * 864e5) return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }
  function haQuanto(iso) {
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / HORA_MS);
    if (h < 1) return "agora há pouco";
    if (h < 24) return `há ${h} h`;
    const d = Math.floor(h / 24);
    return d === 1 ? "ontem" : `há ${d} dias`;
  }

  // Quanto tempo passou desde a última mensagem da cliente (ms). Infinity = nunca escreveu.
  const passouDaCliente = (c) => (c?.ultima_do_cliente_em ? Date.now() - new Date(c.ultima_do_cliente_em).getTime() : Infinity);

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

  // Chama uma Edge Function e devolve { ok, ... } ou { ok: false, erro }
  async function invocar(funcao, corpo) {
    try {
      const { data, error } = await sb.functions.invoke(funcao, { body: corpo });
      if (error) {
        let msg = "Não foi possível falar com o servidor agora.";
        try { const r = await error.context?.json?.(); if (r?.erro) msg = r.erro; } catch { /* mantém */ }
        return { ok: false, erro: msg };
      }
      return data;
    } catch { return { ok: false, erro: "Não foi possível falar com o servidor agora." }; }
  }

  // Sobe o arquivo na pasta "midias" da conta e devolve o link público
  async function subirArquivo(arquivo) {
    const ext = (arquivo.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const caminho = `${App.conta.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from("midias").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
    if (error) throw error;
    return sb.storage.from("midias").getPublicUrl(caminho).data.publicUrl;
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
          <div class="cx-filtro-linha">
            <div class="segmentado" role="group" aria-label="Quais conversas">
              <button class="${verArquivadas ? "" : "ativo"}" data-acao="abertas" aria-pressed="${!verArquivadas}">Abertas</button>
              <button class="${verArquivadas ? "ativo" : ""}" data-acao="arquivadas" aria-pressed="${verArquivadas}">Arquivadas</button>
            </div>
            <button class="btn btn-p" data-acao="repescar" title="Trazer as conversas do Direct sem resposta dos últimos 7 dias"><span data-icone="repescar"></span> Repescar</button>
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
    relogio = setInterval(vigiar, VIGIA_MS);
  }

  // Reserva do tempo real: confere sozinho de tempos em tempos. Se o
  // Realtime cair (ou estiver desligado no projeto), a tela segue em dia.
  let ciclos = 0;
  async function vigiar() {
    if (document.hidden) return;
    ciclos++;
    if (ciclos % 6 === 0) renderJanela();
    await carregarLista();
    if (!atual) return;
    const id = atual.id;
    try {
      const [m, s] = await Promise.all([lerMensagens(id), lerSugestao(id)]);
      if (atual?.id !== id) return;
      if (m.length !== msgs.length || m[m.length - 1]?.id !== msgs[msgs.length - 1]?.id) {
        msgs = m;
        renderMensagens();
        renderJanela();
      }
      if (s && s.id !== sugestao?.id) { sugestao = s; preencherSugestao(); }
    } catch { /* tenta de novo no próximo ciclo */ }
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
        conversas.length ? "Nenhuma conversa com essa busca." : verArquivadas ? "Nenhuma conversa arquivada." : "Quando alguém mandar mensagem no direct, a conversa aparece aqui. Para trazer as que já estavam sem resposta, use Repescar."}</div>`;
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
        ${c.status === "arquivada" ? `<button class="btn btn-p btn-fantasma btn-perigo" data-acao="excluir" title="Excluir esta conversa do painel"><span data-icone="lixo"></span> Excluir</button>` : ""}
      </div>
      <div class="cx-msgs" id="cx-msgs"></div>
      <div class="cx-resposta">
        <div id="cx-sug-aviso"></div>
        <div id="cx-anexo"></div>
        <textarea class="textarea" id="cx-texto" maxlength="${TEXTO_MAX}" placeholder="Escreva a resposta..." aria-label="Resposta"></textarea>
        <div class="cx-acoes">
          <div class="cx-ferramentas">
            <button class="btn btn-icone btn-fantasma" data-acao="anexar" title="Anexar imagem, vídeo, áudio ou PDF" aria-label="Anexar arquivo">📎</button>
            <button class="btn btn-icone btn-fantasma" data-acao="gravar" id="cx-gravar" title="Gravar áudio" aria-label="Gravar áudio">🎤</button>
            <button class="btn btn-icone btn-fantasma" data-acao="coracao" title="Enviar 🧡" aria-label="Enviar coração laranja">🧡</button>
            <button class="btn btn-p btn-fantasma" data-acao="nova-sugestao" id="cx-nova-sug" title="Pedir outra sugestão para a IA">✨ Outra sugestão</button>
            <input type="file" id="cx-arquivo" hidden accept="image/png,image/jpeg,image/gif,video/*,audio/*,application/pdf">
          </div>
          <span class="pequeno texto-2" id="cx-contador">0/${TEXTO_MAX}</span>
          <button class="btn btn-primario" id="cx-enviar" data-acao="enviar" title="Enviar (Ctrl+Enter)">Enviar</button>
        </div>
      </div>`;
    pintarIcones(alvo);
    renderMensagens();
    renderAnexo();
    preencherSugestao(true);
    renderJanela();
  }

  // Conteúdo de um balão: texto e/ou mídia
  function conteudoBalao(m) {
    const u = m.midia_url;
    if (m.midia_tipo === "like_heart") return `<span class="cx-coracao" aria-label="Coração">❤️</span>`;
    // Só emoji (ex.: 🧡 sozinho): aparece grande, como no Instagram
    if (!m.midia_tipo && /^(\p{Extended_Pictographic}|️|‍){1,6}$/u.test((m.texto || "").trim())) return `<span class="cx-coracao">${esc(m.texto.trim())}</span>`;
    let midia = "";
    if (u && m.midia_tipo === "image") midia = `<a href="${esc(u)}" target="_blank" rel="noopener"><img class="cx-midia" src="${esc(u)}" alt="Imagem" loading="lazy" data-quebra></a>`;
    else if (u && m.midia_tipo === "video") midia = `<video class="cx-midia" src="${esc(u)}" controls preload="metadata" data-quebra></video>`;
    else if (u && m.midia_tipo === "audio") midia = `<audio class="cx-audio" src="${esc(u)}" controls preload="none" data-quebra></audio>`;
    else if (u && m.midia_tipo === "file") midia = `<a href="${esc(u)}" target="_blank" rel="noopener">📄 Abrir arquivo</a>`;
    // o rótulo "[imagem]" só aparece se não der pra mostrar a mídia
    const soRotulo = /^\[(imagem|vídeo|áudio|arquivo)\]$/.test(m.texto || "");
    const texto = midia && soRotulo ? `<span class="cx-rotulo-midia">${esc(m.texto)}</span>` : esc(m.texto);
    return midia + (texto ? `<div>${texto}</div>` : "");
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
      return `${sep}<div class="cx-balao ${m.autor === "eu" ? "eu" : "cliente"}">${conteudoBalao(m)}<span class="cx-hora">${esc(hora(m.criada_em))}</span></div>`;
    }).join("");
    // Link do Instagram expirado: some a mídia, fica o rótulo
    $$("[data-quebra]", alvo).forEach((el) => el.addEventListener("error", () => {
      const balao = el.closest(".cx-balao");
      (el.closest("a") || el).remove();
      balao?.querySelector(".cx-rotulo-midia")?.classList.add("visivel");
    }, { once: true }));
    alvo.scrollTop = alvo.scrollHeight;
  }

  // Põe a sugestão na caixa. forcar = trocar mesmo se você editou.
  function preencherSugestao(forcar = false) {
    const caixa = $("#cx-texto");
    const aviso = $("#cx-sug-aviso");
    if (!caixa || !aviso) return;
    // Caixa vazia nunca conta como "editada": a sugestão entra
    if (sugestao && (forcar || !editado || !caixa.value.trim())) {
      caixa.value = sugestao.texto_sugerido;
      editado = false;
    }
    if (!sugestao) aviso.innerHTML = gerandoPara && gerandoPara === atual?.id ? `<div class="cx-sug">✨ Gerando sugestão...</div>` : "";
    else if (!editado && caixa.value === sugestao.texto_sugerido) {
      aviso.innerHTML = `<div class="cx-sug">✨ Sugestão da IA. Revise antes de enviar.</div>`;
    } else {
      aviso.innerHTML = `<div class="cx-sug">✨ Há uma sugestão da IA. <button class="link-btn" data-acao="usar-sugestao">Usar a sugestão</button></div>`;
    }
    contar();
  }

  function contar() {
    const caixa = $("#cx-texto");
    if (caixa) $("#cx-contador").textContent = `${caixa.value.length}/${TEXTO_MAX}`;
  }

  function renderJanela() {
    const alvo = $("#cx-janela");
    if (!alvo || !atual) return;
    const passou = passouDaCliente(atual);
    const btn = $("#cx-enviar");
    const bloquear = (sim, motivo = "") => {
      $$("#cx-enviar, [data-acao=coracao], [data-acao=anexar], #cx-gravar").forEach((b) => { b.disabled = sim; });
      if (btn) btn.title = sim ? motivo : "Enviar (Ctrl+Enter)";
    };
    if (passou <= JANELA_NORMAL_MS) {
      const resta = JANELA_NORMAL_MS - passou;
      const h = Math.floor(resta / HORA_MS), min = Math.floor((resta % HORA_MS) / 60e3);
      alvo.innerHTML = `<span class="pilula-status ${resta < 3 * HORA_MS ? "atencao" : ""}" title="Tempo para responder normalmente (regra de 24h do Instagram)"><span class="ponto"></span>Fecha em ${h ? `${h}h ` : ""}${min}min</span>`;
      bloquear(false);
    } else if (passou <= JANELA_HUMANA_MS) {
      const dias = Math.max(1, Math.ceil((JANELA_HUMANA_MS - passou) / (24 * HORA_MS)));
      alvo.innerHTML = `<span class="pilula-status atencao" title="Passou de 24h: a resposta vai com a etiqueta Human Agent (precisa da permissão liberada no Meta)"><span class="ponto"></span>Resposta humana · ${dias} dia${dias === 1 ? "" : "s"}</span>`;
      bloquear(false);
    } else {
      alvo.innerHTML = `<span class="pilula-status erro" title="O Instagram só deixa responder até 7 dias depois da última mensagem da cliente."><span class="ponto"></span>Janela fechada</span>`;
      bloquear(true, "Passaram mais de 7 dias desde a última mensagem da cliente.");
    }
  }

  // ---------------- Anexo ----------------
  function renderAnexo() {
    const alvo = $("#cx-anexo");
    if (!alvo) return;
    if (gravacao) {
      alvo.innerHTML = `<div class="cx-anexo-chip gravando"><span class="cx-rec"></span> Gravando <span id="cx-rec-tempo">0:00</span>
        <button class="btn btn-p" data-acao="parar-gravacao">Parar</button>
        <button class="btn btn-p btn-fantasma" data-acao="cancelar-gravacao">Cancelar</button></div>`;
      return;
    }
    if (!anexo) { alvo.innerHTML = ""; return; }
    const previa = anexo.tipo === "image" ? `<img src="${anexo.previa}" alt="">`
      : anexo.tipo === "audio" ? `<audio src="${anexo.previa}" controls></audio>`
      : anexo.tipo === "video" ? `<span>🎬</span>` : `<span>📄</span>`;
    alvo.innerHTML = `<div class="cx-anexo-chip">${previa}
      <span class="cx-anexo-nome">${esc(NOME_TIPO[anexo.tipo])}: ${esc(anexo.arquivo.name)} · ${esc(mb(anexo.arquivo.size))}</span>
      <button class="btn btn-icone btn-fantasma" data-acao="tirar-anexo" aria-label="Tirar anexo" title="Tirar anexo">✕</button></div>`;
  }

  function escolherArquivo(arquivo) {
    if (!arquivo) return;
    const regra = ACEITOS.find((r) => r.teste.test(arquivo.type));
    if (!regra) return aviso("Esse formato o Instagram não aceita. Use imagem (PNG, JPG, GIF), vídeo (MP4, MOV), áudio (M4A, AAC, WAV) ou PDF.", "atencao");
    if (arquivo.size > regra.maxMb * 1048576) return aviso(`Arquivo grande demais: o limite para ${NOME_TIPO[regra.tipo].toLowerCase()} é ${regra.maxMb} MB.`, "atencao");
    tirarAnexo();
    anexo = { arquivo, tipo: regra.tipo, previa: URL.createObjectURL(arquivo) };
    renderAnexo();
  }

  function tirarAnexo() {
    if (anexo?.previa) URL.revokeObjectURL(anexo.previa);
    anexo = null;
    renderAnexo();
  }

  // ---------------- Gravar áudio ----------------
  // O Instagram não aceita o formato que o navegador grava (webm), então
  // o áudio é convertido para WAV (mono, 22 kHz) antes de anexar.
  async function comecarGravacao() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return aviso("Este navegador não grava áudio. Anexe um arquivo de áudio pelo 📎.", "atencao");
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return aviso("Sem acesso ao microfone. Libere o microfone para este site no navegador.", "atencao"); }
    tirarAnexo();
    const gravador = new MediaRecorder(stream);
    const partes = [];
    gravador.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
    gravacao = { gravador, partes, stream, inicio: Date.now(), cancelada: false };
    gravador.onstop = () => terminarGravacao();
    gravador.start();
    renderAnexo();
    gravacao.timer = setInterval(() => {
      const s = Math.floor((Date.now() - gravacao.inicio) / 1000);
      const el = $("#cx-rec-tempo");
      if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (s >= GRAVACAO_MAX_S) pararGravacao();
    }, 250);
  }

  function pararGravacao(cancelar = false) {
    if (!gravacao) return;
    gravacao.cancelada = cancelar;
    clearInterval(gravacao.timer);
    gravacao.stream.getTracks().forEach((t) => t.stop());
    if (gravacao.gravador.state !== "inactive") gravacao.gravador.stop(); else terminarGravacao();
  }

  async function terminarGravacao() {
    const g = gravacao;
    gravacao = null;
    if (!g || g.cancelada || !g.partes.length) { renderAnexo(); return; }
    $("#cx-anexo").innerHTML = `<div class="cx-anexo-chip">Preparando o áudio...</div>`;
    try {
      const wav = await paraWav(new Blob(g.partes, { type: g.partes[0].type }));
      const arquivo = new File([wav], `audio-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.wav`, { type: "audio/wav" });
      if (arquivo.size > 25 * 1048576) { aviso("O áudio ficou grande demais (mais de 25 MB). Grave um mais curto.", "atencao"); renderAnexo(); return; }
      anexo = { arquivo, tipo: "audio", previa: URL.createObjectURL(arquivo) };
    } catch (e) {
      console.warn(e);
      aviso("Não foi possível preparar o áudio. Tente de novo ou anexe um arquivo.", "erro");
    }
    renderAnexo();
  }

  async function paraWav(blob) {
    const TAXA = 22050;
    const ctx = new AudioContext();
    const original = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close();
    const off = new OfflineAudioContext(1, Math.ceil(original.duration * TAXA), TAXA);
    const fonte = off.createBufferSource();
    fonte.buffer = original;
    fonte.connect(off.destination);
    fonte.start();
    const dados = (await off.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + dados.length * 2);
    const v = new DataView(buf);
    const escrever = (pos, s) => { for (let i = 0; i < s.length; i++) v.setUint8(pos + i, s.charCodeAt(i)); };
    escrever(0, "RIFF"); v.setUint32(4, 36 + dados.length * 2, true); escrever(8, "WAVE");
    escrever(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, TAXA, true); v.setUint32(28, TAXA * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    escrever(36, "data"); v.setUint32(40, dados.length * 2, true);
    for (let i = 0; i < dados.length; i++) {
      const s = Math.max(-1, Math.min(1, dados[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: "audio/wav" });
  }

  // ---------------- Sugestão sob demanda ----------------
  async function pedirSugestao(conversaId, manual = false) {
    if (!manual && pedidas.has(conversaId)) return;
    pedidas.add(conversaId);
    gerandoPara = conversaId;
    if (atual?.id === conversaId && $("#cx-sug-aviso")) $("#cx-sug-aviso").innerHTML = `<div class="cx-sug">✨ Gerando sugestão...</div>`;
    if ($("#cx-nova-sug")) $("#cx-nova-sug").disabled = true;
    const r = await invocar("conversas-acoes", { acao: "sugerir", conversa_id: conversaId });
    if (gerandoPara === conversaId) gerandoPara = null;
    if ($("#cx-nova-sug")) $("#cx-nova-sug").disabled = false;
    if (atual?.id !== conversaId) return;
    if (!r?.ok) {
      preencherSugestao();
      if (manual) aviso(r?.erro || "A IA não conseguiu sugerir agora.", "erro");
      return;
    }
    sugestao = await lerSugestao(conversaId);
    preencherSugestao(manual);
  }

  // Abriu uma conversa sem sugestão, a última mensagem é dela (há mais de 1 min,
  // senão o webhook ainda está gerando) e ainda dá pra responder? Pede uma.
  function talvezPedirSugestao() {
    if (!atual || sugestao || !msgs.length) return;
    const ultima = msgs[msgs.length - 1];
    if (ultima.autor !== "cliente" || passouDaCliente(atual) > JANELA_HUMANA_MS) return;
    if (Date.now() - new Date(ultima.criada_em).getTime() < 60e3) return;
    pedirSugestao(atual.id);
  }

  // ---------------- Ações ----------------
  async function abrir(id) {
    const c = conversas.find((x) => x.id === id);
    if (!c) return;
    const trocou = atual?.id !== id;
    atual = c;
    if (trocou) { msgs = []; sugestao = null; editado = false; tirarAnexo(); if (gravacao) pararGravacao(true); }
    renderLista();
    renderChat();
    try { [msgs, sugestao] = await Promise.all([lerMensagens(id), lerSugestao(id)]); }
    catch { aviso("Não foi possível abrir a conversa agora.", "erro"); }
    if (atual?.id !== id) return; // trocou de conversa enquanto carregava
    renderMensagens();
    preencherSugestao(trocou);
    talvezPedirSugestao();
    if (window.innerWidth > 760) $("#cx-texto")?.focus();
  }

  async function aoEnviar() {
    const caixa = $("#cx-texto");
    const btn = $("#cx-enviar");
    const texto = caixa.value.trim();
    if ((!texto && !anexo) || !atual || btn.disabled) return;
    if (gravacao) return aviso("Pare a gravação antes de enviar.", "atencao");
    btn.disabled = true; btn.textContent = anexo ? "Enviando arquivo..." : "Enviando...";
    const conversaId = atual.id;
    const usouSugestao = sugestao && texto ? sugestao.id : null;
    let midia = null;
    if (anexo) {
      try { midia = { tipo: anexo.tipo, url: await subirArquivo(anexo.arquivo) }; }
      catch (e) {
        console.warn(e);
        btn.textContent = "Enviar"; renderJanela();
        return aviso("Não foi possível subir o arquivo. Rodou o 12_midias_relatorio.sql?", "erro");
      }
    }
    const r = await invocar("enviar-resposta", { conversa_id: conversaId, texto, sugestao_id: usouSugestao, midia });
    btn.textContent = "Enviar";
    if (!r?.ok) {
      renderJanela();
      aviso(r?.erro || "Não foi possível enviar.", "erro");
      if (r?.enviados) { tirarAnexo(); recarregarAberta(conversaId); } // o arquivo saiu, o texto não
      return;
    }
    aviso(r.human_agent ? "Mensagem enviada (resposta humana, depois de 24h)." : "Mensagem enviada.", "ok");
    if (atual?.id === conversaId) {
      caixa.value = "";
      sugestao = null; editado = false;
      tirarAnexo();
      preencherSugestao();
      await recarregarAberta(conversaId);
    }
    carregarLista();
  }

  async function enviarCoracao() {
    if (!atual) return;
    const conversaId = atual.id;
    const r = await invocar("enviar-resposta", { conversa_id: conversaId, coracao: true });
    if (!r?.ok) return aviso(r?.erro || "Não foi possível enviar o coração.", "erro");
    aviso("🧡 enviado.", "ok");
    await recarregarAberta(conversaId);
    carregarLista();
  }

  async function recarregarAberta(conversaId) {
    try { const m = await lerMensagens(conversaId); if (atual?.id === conversaId) { msgs = m; renderMensagens(); renderJanela(); } }
    catch { /* a vigia traz */ }
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

  // Só conversas arquivadas. Some do painel; no Instagram continua.
  async function excluirConversa() {
    if (!atual || atual.status !== "arquivada") return;
    const ok = await confirmar(
      "Excluir esta conversa?",
      `A conversa com ${nomeDe(atual)} e as mensagens dela saem do painel para todo o time. No Instagram ela continua, e o Relatório não muda. Se a pessoa escrever de novo, a conversa volta do zero.`,
      "Excluir", true,
    );
    if (!ok) return;
    const { error, count } = await sb.from("conversas").delete({ count: "exact" }).eq("id", atual.id).eq("status", "arquivada");
    if (error || !count) return aviso(error ? "Não foi possível excluir agora." : "Não foi possível excluir. Rodou o 14_excluir_conversas.sql?", "erro");
    pedidas.delete(atual.id);
    aviso("Conversa excluída.");
    atual = null; msgs = []; sugestao = null;
    renderChat();
    carregarLista();
  }

  // ---------------- Repescagem do Direct ----------------
  function abrirRepescagem() {
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `<div class="cartao modal modal-largo" role="dialog" aria-modal="true" aria-labelledby="rd-titulo">
      <div class="linha-entre" style="margin-bottom:6px">
        <h3 class="subtitulo" id="rd-titulo">🔁 Repescar o Direct</h3>
        <button class="btn btn-icone btn-fantasma" data-rd="fechar" aria-label="Fechar">✕</button>
      </div>
      <p class="pequeno texto-2" style="margin:0 0 14px">Conversas dos últimos 7 dias em que a última mensagem é da cliente (sem resposta). Elas vêm para a aba Conversas com sugestão da IA. Nada é enviado sem você clicar.</p>
      <div id="rd-corpo"><div class="texto-2" style="padding:20px 0">Lendo as conversas do Instagram...</div></div>
    </div>`;
    const fechar = () => { fundo.remove(); document.removeEventListener("keydown", tecla); };
    const tecla = (e) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", tecla);
    fundo.addEventListener("click", (e) => { if (e.target === fundo || e.target.closest("[data-rd=fechar]")) fechar(); });
    document.body.appendChild(fundo);
    previaRepescagem(fundo, fechar);
  }

  async function previaRepescagem(fundo, fechar) {
    const corpo = $("#rd-corpo", fundo);
    const r = await invocar("conversas-acoes", { acao: "repescar", conta_id: App.conta.id, etapa: "previa" });
    if (!r?.ok) {
      corpo.innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>${esc(r?.erro || "Não foi possível ler as conversas agora.")}</span></div>
        <div class="linha" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-rd="fechar">Fechar</button></div>`;
      return;
    }
    const n = r.total;
    corpo.innerHTML = `
      <div class="rp-numero"><div class="numero">${n.toLocaleString("pt-BR")}</div>
        <span class="kpi-rotulo">${n === 1 ? "conversa sem resposta" : "conversas sem resposta"}</span></div>
      <p class="pequeno texto-2" style="margin:8px 0 12px">Lidas ${r.resumo.lidas.toLocaleString("pt-BR")} conversas: ${r.resumo.respondidas.toLocaleString("pt-BR")} já respondidas${r.resumo.antigas ? `, ${r.resumo.antigas} com mais de 7 dias (não dá mais pra responder)` : ""}.</p>
      <div class="faixa faixa-info" style="margin-bottom:12px">${icone("info")}<span>O Instagram não informa se a mensagem foi lida nem em qual pasta ela está (Principal ou Geral). Por isso entram todas as conversas sem resposta. As de 24h a 7 dias só podem ser respondidas com a permissão Human Agent.</span></div>
      ${n ? `<span class="rotulo">Quem vai entrar</span>
        <div class="rp-lista">${r.pessoas.map((p) => `
          <div class="rp-pessoa"><span class="avatar" aria-hidden="true">${esc((p.username || "?").charAt(0).toUpperCase())}</span>
            <div style="min-width:0"><div>${p.username ? `@${esc(p.username)}` : "sem @"}<span class="pequeno texto-2"> · ${esc(haQuanto(p.quando))}</span></div>
              <div class="pequeno texto-2 rp-texto">"${esc(p.texto)}"</div></div></div>`).join("")}
          ${n > r.pessoas.length ? `<p class="pequeno texto-2" style="margin:8px 0 0">e mais ${n - r.pessoas.length}...</p>` : ""}
        </div>` : `<div class="faixa faixa-info">${icone("info")}<span>Nenhuma conversa sem resposta nos últimos 7 dias. 🎉</span></div>`}
      <div class="linha" style="justify-content:flex-end;margin-top:18px">
        <button class="btn" data-rd="fechar">Cancelar</button>
        ${n ? `<button class="btn btn-primario" id="rd-trazer">Trazer ${n.toLocaleString("pt-BR")} ${n === 1 ? "conversa" : "conversas"}</button>` : ""}
      </div>`;
    pintarIcones(corpo);
    const btn = $("#rd-trazer", corpo);
    if (btn) btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Trazendo...";
      const res = await invocar("conversas-acoes", { acao: "repescar", conta_id: App.conta.id, etapa: "trazer" });
      if (!res?.ok) { btn.disabled = false; btn.textContent = "Tentar de novo"; return aviso(res?.erro || "Não foi possível trazer agora.", "erro"); }
      fechar();
      aviso(`${res.trazidas} ${res.trazidas === 1 ? "conversa trazida" : "conversas trazidas"}. Abra cada uma: a sugestão aparece na hora.${res.restantes ? ` Faltaram ${res.restantes}: clique em Repescar de novo.` : ""}`, "ok");
      verArquivadas = false;
      carregar();
    };
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
      .subscribe((status, erro) => {
        if (status !== "SUBSCRIBED") console.warn("[conversas] tempo real:", status, erro ?? "", "(a vigia de 10s cobre)");
      });
  }

  function parar() {
    if (canal) { sb.removeChannel(canal); canal = null; }
    clearInterval(relogio);
    if (gravacao) pararGravacao(true);
  }

  // ---------------- Eventos (uma vez só, por delegação) ----------------
  const raiz = $("#aba-conversas");

  raiz.addEventListener("click", (e) => {
    const item = e.target.closest("[data-conversa]");
    if (item) return abrir(item.dataset.conversa);
    const b = e.target.closest("[data-acao]");
    if (!b || b.disabled) return;
    const acao = b.dataset.acao;
    if (acao === "enviar") return aoEnviar();
    if (acao === "usar-sugestao") return preencherSugestao(true);
    if (acao === "nova-sugestao") return atual && pedirSugestao(atual.id, true);
    if (acao === "anexar") return $("#cx-arquivo").click();
    if (acao === "tirar-anexo") return tirarAnexo();
    if (acao === "gravar") return gravacao ? pararGravacao() : comecarGravacao();
    if (acao === "parar-gravacao") return pararGravacao();
    if (acao === "cancelar-gravacao") return pararGravacao(true);
    if (acao === "coracao") return enviarCoracao();
    if (acao === "voltar") { atual = null; renderChat(); renderLista(); return; }
    if (acao === "arquivar") return mudarStatus("arquivada");
    if (acao === "desarquivar") return mudarStatus("respondida");
    if (acao === "excluir") return excluirConversa();
    if (acao === "roteiro") return abrirRoteiro();
    if (acao === "repescar") return abrirRepescagem();
    if (acao === "abertas" || acao === "arquivadas") {
      verArquivadas = acao === "arquivadas";
      atual = null;
      return carregar();
    }
  });

  raiz.addEventListener("change", (e) => {
    if (e.target.id === "cx-arquivo") { escolherArquivo(e.target.files?.[0]); e.target.value = ""; }
  });

  raiz.addEventListener("input", (e) => {
    if (e.target.id === "cx-busca") { busca = e.target.value; renderLista(); }
    if (e.target.id === "cx-texto") {
      const v = e.target.value;
      editado = v.trim() !== "" && (!sugestao || v !== sugestao.texto_sugerido);
      preencherSugestao();
    }
  });

  raiz.addEventListener("keydown", (e) => {
    if (e.target.id === "cx-texto" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); aoEnviar(); }
  });

  // Colar uma imagem (Ctrl+V) direto na caixa de texto vira anexo
  raiz.addEventListener("paste", (e) => {
    if (e.target.id !== "cx-texto") return;
    const arq = [...(e.clipboardData?.files ?? [])][0];
    if (arq) { e.preventDefault(); escolherArquivo(arq); }
  });

  // Ao trocar de conta, a conversa aberta era da outra
  window.Conversas = { carregar() { if (atual && atual.conta_id !== App.conta?.id) { atual = null; msgs = []; sugestao = null; } return carregar(); }, parar };
})();
