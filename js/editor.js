// =====================================================================
// editor.js: o editor visual de automação ("o ManyChat")
// - Bloco 1: o gatilho (palavras, posts, resposta no comentário)
// - Bloco 2: a resposta (Mensagem 1, botão, link ou conversa)
// - Construtor da conversa (Mensagem 2 em diante, com botões)
// - Prévia ao vivo no mockup de celular
//
// O que é salvo no banco segue o formato "flow" (seção 7 do LEIA-ME):
// flow.steps[0] é SEMPRE a Mensagem 1.
// =====================================================================
(function () {
  const EMOJIS = ["🫶", "👀", "😍", "🥰", "😂", "😮", "🔥", "✨", "💌", "👉", "🙌", "💕"];
  const LIMITE_TITULO = 20;   // o Instagram corta o nome do botão em 20
  const MAX_BOTOES = 3;       // botões anexados (button template)
  const LIMITE_MSG_BOTAO = 640;

  const pareceUrl = (s) => /^(https?:\/\/|www\.)\S+$/i.test((s || "").trim());
  const urlValida = (s) => /^https?:\/\/\S+\.\S+/i.test((s || "").trim());
  const ajustarUrl = (s) => { const t = (s || "").trim(); return /^www\./i.test(t) ? `https://${t}` : t; };

  let E = null;          // estado do editor
  let foto = "";         // "foto" do que estava salvo (pra saber se mudou)
  let aberto = false;
  let postsCache = null; // posts carregados da conta

  // ---------------- Estado ----------------
  function estadoNovo() {
    return {
      id: null, nome: "", active: true,
      keywords: [], match_any: false, media_ids: [],
      public_reply: "", variantes: [],
      mensagem: "", botaoLigado: true, botaoTexto: "", acao: "link", link: "",
      asset_ids: [],
      passos: [],     // Mensagem 2 em diante
      proxId: 2,      // a Mensagem 1 tem id 1; as outras começam no 2
    };
  }

  // Do banco (flow) pro editor
  function deAutomacao(a) {
    const e = estadoNovo();
    e.id = a.id;
    e.nome = a.nome || "";
    e.active = !!a.active;
    e.keywords = (a.keyword || "").split(",").map((k) => k.trim()).filter(Boolean);
    e.match_any = !!a.match_any;
    e.media_ids = [...(a.media_ids || [])];
    e.public_reply = a.public_reply || "";
    e.variantes = [...(a.public_reply_variants || [])];
    e.asset_ids = [...(a.asset_ids || [])];

    const steps = a.flow?.steps || [];
    const s0 = steps[0];
    if (s0) {
      e.mensagem = s0.message || "";
      const b = (s0.buttons || [])[0];
      if (b) {
        e.botaoLigado = true;
        e.botaoTexto = b.title || "";
        if (b.url != null) { e.acao = "link"; e.link = b.url; } else { e.acao = "conversa"; }
      } else {
        e.botaoLigado = false;
      }
    }
    e.passos = steps.slice(1).map((s) => ({
      id: s.id,
      message: s.message || "",
      buttons: (s.buttons || []).map((b) => ({
        title: b.title || "",
        // o "é link" fica guardado num estado próprio (dest), independente da URL estar vazia
        dest: b.url != null ? "link" : b.next != null ? "passo" : "fim",
        url: b.url || "",
        next: b.next ?? null,
      })),
      collect: s.collect ? { ...s.collect } : null,
      delay: s.delay ? { ...s.delay } : null,
    }));
    e.proxId = Math.max(1, ...steps.map((s) => Number(s.id) || 0)) + 1;
    return e;
  }

  // Do editor pro banco (flow)
  function paraAutomacao() {
    const s0 = { id: 1, message: E.mensagem, buttons: [] };
    if (E.botaoLigado) {
      if (E.acao === "link") s0.buttons.push({ title: E.botaoTexto.trim(), url: ajustarUrl(E.link) });
      else if (E.passos[0]) s0.buttons.push({ title: E.botaoTexto.trim(), next: E.passos[0].id });
    }
    const outros = E.passos.map((p) => {
      const step = {
        id: p.id,
        message: p.message,
        buttons: p.buttons.map((b) => {
          if (b.dest === "link") return { title: b.title.trim(), url: ajustarUrl(b.url) };
          if (b.dest === "passo" && b.next != null) return { title: b.title.trim(), next: b.next };
          return { title: b.title.trim() }; // encerra: não é enviado
        }),
      };
      if (p.collect?.field) step.collect = { field: p.collect.field, ...(p.collect.next != null ? { next: p.collect.next } : {}) };
      if (p.delay?.seconds > 0 && p.delay.next != null) step.delay = { seconds: Number(p.delay.seconds), next: p.delay.next };
      return step;
    });

    const a = {
      nome: E.nome.trim(),
      keyword: E.keywords.join(", "),
      match_any: E.match_any,
      active: E.active,
      media_ids: E.media_ids,
      public_reply: E.public_reply.trim(),
      public_reply_variants: E.variantes.map((v) => v.trim()).filter(Boolean),
      flow: { steps: [s0, ...outros] },
      asset_ids: E.asset_ids,
    };
    if (E.id) a.id = E.id;
    return a;
  }

  const mudou = () => aberto && JSON.stringify(paraAutomacao()) !== foto;
  const nomeMsg = (id) => { const i = E.passos.findIndex((p) => String(p.id) === String(id)); return i >= 0 ? `Mensagem ${i + 2}` : "?"; };

  // ---------------- Abrir / fechar ----------------
  function abrir(automacao) {
    E = automacao ? deAutomacao(automacao) : estadoNovo();
    foto = JSON.stringify(paraAutomacao());
    aberto = true;
    preencherCampos();
    // leitora: abre só pra ver (nada clicável, sem Salvar)
    $(".editor-grade").inert = App.leitor;
    $("#ed-nome").readOnly = App.leitor;
    $("#ed-ativa").disabled = App.leitor;
    $("#ed-erros").hidden = true;
    $("#ed-posts").innerHTML = "";
    $("#editor").hidden = false;
    $(".editor-corpo").scrollTop = 0;
    document.body.style.overflow = "hidden";
    if (!automacao && !App.leitor) setTimeout(() => $("#ed-nome").focus(), 50);
  }

  async function fechar() {
    if (mudou()) {
      const ok = await confirmar("Sair sem salvar?", "Você tem alterações que ainda não foram salvas. Se sair agora, elas se perdem.", "Sair sem salvar", true);
      if (!ok) return false;
    }
    fecharDireto();
    return true;
  }

  function fecharDireto() {
    aberto = false;
    $("#editor").hidden = true;
    document.body.style.overflow = "";
  }

  // ---------------- Preencher campos ----------------
  function preencherCampos() {
    $("#ed-nome").value = E.nome;
    $("#ed-ativa").checked = E.active;
    $("#ed-qualquer").checked = E.match_any;
    $("#ed-resposta").value = E.public_reply;
    $("#ed-mensagem").value = E.mensagem;
    $("#ed-botao-ligado").checked = E.botaoLigado;
    $("#ed-botao-texto").value = E.botaoTexto;
    $("#ed-acao").value = E.acao;
    $("#ed-link").value = E.link;
    renderTags();
    renderVariacoes();
    renderResumoPosts();
    renderArquivos();
    atualizarBotaoMsg1();
    renderVisibilidade();
    renderPassos();
    renderPrevia();
  }

  function renderVisibilidade() {
    $("#ed-botao-area").hidden = !E.botaoLigado;
    $("#ed-link-area").hidden = E.acao !== "link";
    $("#ed-conversa-area").hidden = E.acao !== "conversa";
    $("#ed-tags").classList.toggle("desligado", E.match_any);
    $("#ed-tags-ajuda").textContent = E.match_any
      ? "Qualquer comentário no post dispara (as palavras são ignoradas)."
      : "Ex: quero, link, eu. Maiúsculas e acentos não importam.";
  }

  function atualizarBotaoMsg1() {
    const n = E.botaoTexto.length;
    const c = $("#ed-botao-cont");
    c.textContent = `${n}/${LIMITE_TITULO}`;
    c.classList.toggle("estourou", n > LIMITE_TITULO);
    $("#ed-botao-aviso").hidden = !pareceUrl(E.botaoTexto);
  }

  // ---------------- Tags (palavras que ativam) ----------------
  function renderTags() {
    const box = $("#ed-tags");
    $$(".tag", box).forEach((t) => t.remove());
    const input = $("#ed-tag-input");
    E.keywords.forEach((k, i) => {
      const t = document.createElement("span");
      t.className = "tag";
      t.innerHTML = `${esc(k)}<button type="button" data-i="${i}" aria-label="Remover">×</button>`;
      box.insertBefore(t, input);
    });
  }

  function adicionarTag(texto) {
    texto.split(",").map((t) => t.trim()).filter(Boolean).forEach((t) => {
      if (!E.keywords.some((k) => k.toLowerCase() === t.toLowerCase())) E.keywords.push(t);
    });
    renderTags();
    renderPrevia();
  }

  // ---------------- Variações A/B ----------------
  function renderVariacoes() {
    $("#ed-variacoes").innerHTML = E.variantes.map((v, i) => `
      <div class="variacao">
        <input class="input" data-var="${i}" value="${esc(v)}" placeholder="Variação ${String.fromCharCode(66 + i)}">
        <button class="btn btn-icone btn-fantasma" data-var-rem="${i}" aria-label="Remover variação">${icone("lixo")}</button>
      </div>`).join("");
  }

  // ---------------- Posts ----------------
  function renderResumoPosts() {
    const n = E.media_ids.length;
    $("#ed-posts-resumo").innerHTML = n
      ? `${n} post${n > 1 ? "s" : ""} escolhido${n > 1 ? "s" : ""} · <a href="#" id="ed-limpar-posts">vale pra todos</a>`
      : "Vale pra todos os posts";
  }

  async function carregarPosts() {
    const alvo = $("#ed-posts");
    alvo.innerHTML = `<div class="ajuda">Carregando posts...</div>`;
    if (!postsCache) postsCache = await Dados.posts();
    if (!postsCache) {
      alvo.innerHTML = `<div class="faixa faixa-info" style="margin-top:10px">${icone("info")}<span>Conecte o Instagram pra listar seus posts aqui. Sem escolher nenhum, a automação vale pra todos os posts.</span></div>`;
      return;
    }
    if (!postsCache.length) { alvo.innerHTML = `<div class="ajuda">Nenhum post encontrado na conta.</div>`; return; }
    renderPosts();
  }

  function renderPosts() {
    $("#ed-posts").innerHTML = `<div class="posts">${postsCache.map((p) => `
      <button type="button" class="post ${E.media_ids.includes(p.id) ? "marcado" : ""}" data-post="${esc(p.id)}" title="${esc(p.legenda || "Post")}">
        ${p.miniatura ? `<img src="${esc(p.miniatura)}" alt="" loading="lazy">` : ""}
      </button>`).join("")}</div>`;
  }

  // ---------------- Arquivos ----------------
  async function renderArquivos() {
    const alvo = $("#ed-arquivos");
    let lista = [];
    try { lista = await Dados.arquivos(); } catch { /* vazio */ }
    const itens = lista.length
      ? lista.map((a) => `
        <label class="arquivo-item">
          <input type="checkbox" data-arq="${esc(a.id)}" ${E.asset_ids.includes(a.id) ? "checked" : ""}>
          ${icone(a.tipo === "image" ? "imagem" : "arquivo")}
          <span style="flex:1">${esc(a.nome)}</span><span class="chip">${esc(rotuloTipo(a.tipo))}</span>
        </label>`).join("")
      : `<div class="ajuda" style="margin:0 0 8px">Nenhum arquivo na biblioteca ainda.</div>`;
    alvo.innerHTML = `${itens}
      <details class="avancado">
        <summary>Adicionar arquivo à biblioteca</summary>
        <div class="grade2" style="grid-template-columns:1fr 140px">
          <input class="input" id="arq-nome" placeholder="Nome (ex: Guia em PDF)">
          <select class="select" id="arq-tipo">
            <option value="file">PDF / arquivo</option><option value="image">Foto</option>
            <option value="audio">Áudio</option><option value="video">Vídeo</option>
          </select>
        </div>
        <textarea class="textarea textarea-link" id="arq-url" style="margin-top:8px" placeholder="Link público do arquivo (ex: do Supabase Storage)"></textarea>
        <button type="button" class="btn btn-p" id="arq-add" style="margin-top:8px">Adicionar</button>
      </details>`;
  }
  const rotuloTipo = (t) => ({ image: "Foto", audio: "Áudio", video: "Vídeo", file: "Arquivo" }[t] || t);

  // ---------------- Construtor da conversa ----------------
  function opcoesPassos(atualId, selecionado) {
    const outros = E.passos.filter((p) => String(p.id) !== String(atualId));
    if (!outros.length) return `<option value="">(crie outra mensagem primeiro)</option>`;
    return `<option value="">Escolha a mensagem</option>` + outros.map((p) =>
      `<option value="${esc(p.id)}" ${String(p.id) === String(selecionado) ? "selected" : ""}>${nomeMsg(p.id)}</option>`).join("");
  }

  function renderPassos() {
    const ref = `
      <div class="msg-ref">
        <span class="rotulo" style="margin:0">Mensagem 1 (referência)</span>
        <div class="ref-texto">${esc(E.mensagem) || "<em>Escreva em \"Sua mensagem\" lá em cima.</em>"}</div>
        <div class="pequeno texto-2" style="margin-top:6px">Botão: <strong>${esc(E.botaoTexto) || "(sem nome)"}</strong> → ${E.passos.length ? "Mensagem 2" : "crie a Mensagem 2 abaixo"}</div>
        <div class="ajuda">Edite a Mensagem 1 lá em cima, em "Sua mensagem" e "Texto do botão".</div>
      </div>`;

    const passos = E.passos.map((p, i) => {
      const botoes = p.buttons.map((b, j) => {
        const n = b.title.length;
        let destino = "";
        if (b.dest === "passo") {
          destino = `<select class="select" data-i="${i}" data-j="${j}" data-campo="next">${opcoesPassos(p.id, b.next)}</select>`;
        } else if (b.dest === "link") {
          destino = `<div style="grid-column:1/-1">
              <textarea class="textarea textarea-link" data-i="${i}" data-j="${j}" data-campo="url" placeholder="Cole o link completo: https://...">${esc(b.url)}</textarea>
              <div class="ajuda">A pessoa vê só o nome do botão; o link fica invisível.</div></div>`;
        } else {
          destino = `<div class="dica-fim" style="grid-column:1/-1;margin:0">Fim da conversa: este botão NÃO aparece pra pessoa. A conversa termina nesta mensagem.</div>`;
        }
        return `
          <div class="botao-cfg">
            <div class="linha-entre" style="margin-bottom:6px">
              <span class="pequeno" style="font-weight:600">Botão ${j + 1}</span>
              <button type="button" class="btn btn-p btn-fantasma btn-perigo" data-rem-botao="${i}:${j}">Remover</button>
            </div>
            <div class="grade2">
              <div>
                <input class="input" data-i="${i}" data-j="${j}" data-campo="title" value="${esc(b.title)}" placeholder="Nome do botão">
                <div class="linha-entre"><span class="ajuda" data-aviso-url ${pareceUrl(b.title) && b.dest !== "link" ? "" : "hidden"} style="color:var(--atencao)">Parece um link: escolha "abrir um link".</span>
                <span class="contador ${n > LIMITE_TITULO ? "estourou" : ""}" data-cont style="margin-left:auto">${n}/${LIMITE_TITULO}</span></div>
              </div>
              <select class="select" data-i="${i}" data-j="${j}" data-campo="dest">
                <option value="passo" ${b.dest === "passo" ? "selected" : ""}>Ir pra outra mensagem</option>
                <option value="link" ${b.dest === "link" ? "selected" : ""}>Abrir um link</option>
                <option value="fim" ${b.dest === "fim" ? "selected" : ""}>Encerrar</option>
              </select>
              ${destino}
            </div>
          </div>`;
      }).join("");

      const coleta = p.collect?.field || "";
      const atraso = p.delay || {};
      return `
        <div class="passo">
          <div class="passo-topo">
            <span class="passo-nome">${icone("chat").replace("<svg", '<svg width="16" height="16"')} Mensagem ${i + 2}</span>
            <button type="button" class="btn btn-p btn-fantasma btn-perigo" data-rem-passo="${i}">Remover</button>
          </div>
          <div class="emojis" data-emojis></div>
          <textarea class="textarea" data-i="${i}" data-campo="message" placeholder="O que ela recebe nesta mensagem">${esc(p.message)}</textarea>
          ${botoes}
          ${p.buttons.length ? "" : `<div class="dica-fim">Sem botão, a conversa termina nesta mensagem.</div>`}
          <button type="button" class="btn btn-p" data-add-botao="${i}" style="margin-top:10px" ${p.buttons.length >= MAX_BOTOES ? "disabled" : ""}>
            ${icone("mais")} Adicionar botão ${p.buttons.length >= MAX_BOTOES ? "(máximo 3 por mensagem)" : ""}
          </button>
          <details class="avancado" ${coleta || atraso.seconds ? "open" : ""}>
            <summary>Opções avançadas</summary>
            <div class="grade2">
              <div>
                <span class="rotulo">Pedir um dado depois</span>
                <select class="select" data-i="${i}" data-campo="collect-field">
                  <option value="" ${!coleta ? "selected" : ""}>Não pedir</option>
                  <option value="email" ${coleta === "email" ? "selected" : ""}>E-mail</option>
                  <option value="telefone" ${coleta === "telefone" ? "selected" : ""}>Telefone</option>
                </select>
              </div>
              <div ${coleta ? "" : "hidden"}>
                <span class="rotulo">Depois de receber, mandar</span>
                <select class="select" data-i="${i}" data-campo="collect-next">${opcoesPassos(p.id, p.collect?.next)}</select>
              </div>
              <div>
                <span class="rotulo">Mandar outra sozinha após (segundos)</span>
                <input class="input" type="number" min="0" data-i="${i}" data-campo="delay-seconds" value="${esc(atraso.seconds ?? "")}" placeholder="Ex: 30">
              </div>
              <div ${atraso.seconds ? "" : "hidden"} data-delay-next>
                <span class="rotulo">Qual mensagem</span>
                <select class="select" data-i="${i}" data-campo="delay-next">${opcoesPassos(p.id, atraso.next)}</select>
              </div>
            </div>
            ${coleta ? `<div class="ajuda">A próxima mensagem de texto dela vira o ${coleta === "email" ? "e-mail" : "telefone"} salvo no lead. Se vier estranho, o sistema pede de novo.</div>` : ""}
          </details>
        </div>`;
    }).join("");

    $("#ed-passos").innerHTML = ref + passos;
    pintarEmojis($("#ed-passos"));
  }

  function removerPasso(i) {
    const id = E.passos[i].id;
    E.passos.splice(i, 1);
    // Quem apontava pra mensagem apagada passa a "encerrar"
    E.passos.forEach((p) => {
      p.buttons.forEach((b) => { if (b.dest === "passo" && String(b.next) === String(id)) { b.next = null; } });
      if (p.collect && String(p.collect.next) === String(id)) p.collect.next = null;
      if (p.delay && String(p.delay.next) === String(id)) p.delay.next = null;
    });
  }

  function adicionarPasso() {
    const novo = { id: E.proxId++, message: "", buttons: [], collect: null, delay: null };
    const anterior = E.passos[E.passos.length - 1];
    // Conveniência: se a mensagem anterior não tem botão, liga ela à nova
    if (anterior && !anterior.buttons.length) anterior.buttons.push({ title: "Continuar", dest: "passo", next: novo.id, url: "" });
    E.passos.push(novo);
  }

  // ---------------- Prévia ao vivo ----------------
  function botoesVisiveis(botoes) {
    // Botão sem destino não aparece (igual não é enviado de verdade)
    return botoes.filter((b) => (b.link && b.url) || (!b.link && b.temProximo)).slice(0, MAX_BOTOES);
  }

  function bolha(texto, botoes) {
    const t = texto.trim() ? esc(texto) : `<span style="color:#8E8E8E">...</span>`;
    if (!botoes.length) return `<div class="bolha-grupo"><div class="bolha">${t}</div></div>`;
    return `<div class="bolha-grupo"><div class="bolha com-botoes">${t}</div><div class="bolha-botoes">${
      botoes.map((b) => `<div class="bolha-botao">${b.link ? icone("link") : ""}${esc(b.title.slice(0, LIMITE_TITULO) || "Botão")}</div>`).join("")
    }</div></div>`;
  }

  async function renderPrevia() {
    const chat = $("#previa-chat");
    const palavra = E.match_any ? "um comentário" : `"${E.keywords[0] || "palavra"}"`;
    let h = `<div class="cel-aviso">Ela comentou ${esc(palavra)} no seu post</div>`;

    if (!E.mensagem.trim()) {
      chat.innerHTML = h + `<div class="cel-vazio">Escreva a sua mensagem pra ver como ela chega no direct.</div>`;
      return;
    }

    // Mensagem 1
    const b1 = [];
    if (E.botaoLigado) {
      if (E.acao === "link") b1.push({ title: E.botaoTexto, link: true, url: E.link.trim() });
      else b1.push({ title: E.botaoTexto, temProximo: !!E.passos[0] });
    }
    h += bolha(E.mensagem, botoesVisiveis(b1));

    // Arquivos da Mensagem 1
    if (E.asset_ids.length) {
      let arqs = [];
      try { arqs = await Dados.arquivos(); } catch { /* sem lista */ }
      arqs.filter((a) => E.asset_ids.includes(a.id)).forEach((a) => {
        h += `<div class="cel-arquivo">${icone(a.tipo === "image" ? "imagem" : "arquivo").replace("<svg", '<svg width="16" height="16"')} ${esc(a.nome)}</div>`;
      });
    }

    // Conversa: Mensagem 2 em diante
    if (E.botaoLigado && E.acao === "conversa") {
      E.passos.forEach((p, i) => {
        // O que ela "toca/manda" pra chegar nesta mensagem
        let origem = null;
        if (i === 0) origem = E.botaoTexto;
        else {
          for (const q of E.passos) {
            const b = q.buttons.find((x) => x.dest === "passo" && String(x.next) === String(p.id));
            if (b) { origem = b.title; break; }
          }
        }
        const veioDeDado = E.passos.find((q) => q.collect?.field && String(q.collect.next) === String(p.id));
        const veioDeAtraso = E.passos.find((q) => q.delay?.seconds && String(q.delay.next) === String(p.id));
        if (origem) h += `<div class="bolha-eu">${esc(origem.slice(0, LIMITE_TITULO) || "Botão")}</div>`;
        else if (veioDeDado) h += `<div class="bolha-eu">${veioDeDado.collect.field === "email" ? "nome@exemplo.com" : "(11) 90000-0000"}</div>`;
        else if (veioDeAtraso) h += `<div class="cel-nota">depois de ${esc(veioDeAtraso.delay.seconds)} segundos</div>`;
        else h += `<div class="cel-nota">Nenhum botão leva até a Mensagem ${i + 2}</div>`;

        const bs = p.buttons.map((b) => ({
          title: b.title, link: b.dest === "link", url: b.url.trim(),
          temProximo: b.dest === "passo" && b.next != null && E.passos.some((x) => String(x.id) === String(b.next)),
        }));
        h += bolha(p.message, botoesVisiveis(bs));
        if (p.collect?.field) h += `<div class="cel-nota">esperando ela mandar o ${p.collect.field === "email" ? "e-mail" : "telefone"}</div>`;
      });
    }

    chat.innerHTML = h;
  }

  // ---------------- Emojis ----------------
  function pintarEmojis(raiz = document) {
    $$("[data-emojis]", raiz).forEach((bar) => {
      if (bar.childElementCount) return;
      bar.innerHTML = EMOJIS.map((em) => `<button type="button" data-emoji="${em}" aria-label="Inserir ${em}">${em}</button>`).join("");
    });
  }

  function inserirNoCursor(campo, texto) {
    const ini = campo.selectionStart ?? campo.value.length;
    const fim = campo.selectionEnd ?? campo.value.length;
    campo.value = campo.value.slice(0, ini) + texto + campo.value.slice(fim);
    campo.focus();
    campo.selectionStart = campo.selectionEnd = ini + texto.length;
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // ---------------- Validação ----------------
  function validar() {
    const erros = [];
    if (!E.nome.trim()) erros.push("Dê um nome pra automação (lá no topo).");
    if (!E.match_any && !E.keywords.length) erros.push("Adicione pelo menos uma palavra que ativa, ou ligue \"Qualquer palavra ativa\".");
    if (!E.mensagem.trim()) erros.push("Escreva a \"Sua mensagem\" (a Mensagem 1).");
    if (E.botaoLigado && E.mensagem.length > LIMITE_MSG_BOTAO) erros.push(`A mensagem com botão pode ter no máximo ${LIMITE_MSG_BOTAO} caracteres.`);

    if (E.botaoLigado) {
      if (!E.botaoTexto.trim()) erros.push("Escreva o texto do botão.");
      if (E.botaoTexto.length > LIMITE_TITULO) erros.push(`O texto do botão passou de ${LIMITE_TITULO} caracteres.`);
      if (pareceUrl(E.botaoTexto)) erros.push("O texto do botão parece um link. Coloque o link no campo do link.");
      if (E.acao === "link" && !urlValida(ajustarUrl(E.link))) erros.push("Cole um link completo (começando com https://) no campo do link.");
      if (E.acao === "conversa" && !E.passos.length) erros.push("Na conversa, crie pelo menos a Mensagem 2.");
    }

    if (E.botaoLigado && E.acao === "conversa") {
      E.passos.forEach((p, i) => {
        const nome = `Mensagem ${i + 2}`;
        if (!p.message.trim()) erros.push(`${nome}: escreva o texto.`);
        p.buttons.forEach((b, j) => {
          const qual = `${nome}, botão ${j + 1}`;
          if (b.dest === "fim") return;
          if (!b.title.trim()) erros.push(`${qual}: dê um nome ao botão.`);
          if (b.title.length > LIMITE_TITULO) erros.push(`${qual}: o nome passou de ${LIMITE_TITULO} caracteres.`);
          if (b.dest === "link" && !urlValida(ajustarUrl(b.url))) erros.push(`${qual}: cole um link completo (https://...).`);
          if (b.dest === "passo" && (b.next == null || !E.passos.some((x) => String(x.id) === String(b.next)))) erros.push(`${qual}: escolha pra qual mensagem ele vai.`);
        });
        if (p.collect?.field && p.collect.next != null && !E.passos.some((x) => String(x.id) === String(p.collect.next))) erros.push(`${nome}: escolha a mensagem que vem depois do dado.`);
        if (p.delay?.seconds > 0 && p.delay.next == null) erros.push(`${nome}: escolha qual mensagem sai sozinha depois do tempo.`);
      });
    }
    return erros;
  }

  async function salvar() {
    const erros = validar();
    const box = $("#ed-erros");
    if (erros.length) {
      box.innerHTML = `${icone("info")}<div><strong>Falta pouco pra salvar:</strong><ul>${erros.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`;
      box.hidden = false;
      $(".editor-corpo").scrollTop = 0;
      return;
    }
    box.hidden = true;
    const btn = $("#ed-salvar");
    btn.disabled = true; btn.textContent = "Salvando...";
    try {
      const { automacao, local } = await Dados.salvarAutomacao(paraAutomacao());
      E.id = automacao.id;
      foto = JSON.stringify(paraAutomacao());
      if (local) aviso("Salvo só neste navegador (modo de teste local). Pra salvar de verdade no banco, configure o Supabase seguindo o LEIA-ME.", "atencao");
      else aviso("Automação salva.", "ok");
      fecharDireto();
      carregarAutomacoes();
    } catch (e) {
      console.warn(e);
      aviso("Não foi possível salvar. Confira a conexão com o Supabase.", "erro");
    } finally {
      btn.disabled = false; btn.textContent = "Salvar";
    }
  }

  // ---------------- Eventos (ligados uma vez só) ----------------
  function ligarEventos() {
    pintarEmojis($("#editor"));
    const ed = $("#editor");

    $("#ed-fechar").onclick = fechar;
    $("#ed-salvar").onclick = salvar;
    $("#ed-nome").oninput = (e) => { E.nome = e.target.value; };
    $("#ed-ativa").onchange = (e) => { E.active = e.target.checked; };

    // Gatilho
    $("#ed-qualquer").onchange = (e) => { E.match_any = e.target.checked; renderVisibilidade(); renderPrevia(); };
    const tagInput = $("#ed-tag-input");
    tagInput.onkeydown = (e) => {
      if ((e.key === "Enter" || e.key === ",") && tagInput.value.trim()) { e.preventDefault(); adicionarTag(tagInput.value); tagInput.value = ""; }
      else if (e.key === "Enter") e.preventDefault();
      else if (e.key === "Backspace" && !tagInput.value && E.keywords.length) { E.keywords.pop(); renderTags(); renderPrevia(); }
    };
    tagInput.onblur = () => { if (tagInput.value.trim()) { adicionarTag(tagInput.value); tagInput.value = ""; } };
    $("#ed-tags").onclick = (e) => {
      const b = e.target.closest("button[data-i]");
      if (b) { E.keywords.splice(Number(b.dataset.i), 1); renderTags(); renderPrevia(); return; }
      tagInput.focus();
    };

    $("#ed-carregar-posts").onclick = carregarPosts;
    $("#ed-posts").onclick = (e) => {
      const p = e.target.closest("[data-post]");
      if (!p) return;
      const id = p.dataset.post;
      E.media_ids = E.media_ids.includes(id) ? E.media_ids.filter((x) => x !== id) : [...E.media_ids, id];
      renderPosts(); renderResumoPosts();
    };
    $("#ed-posts-resumo").onclick = (e) => {
      if (e.target.id !== "ed-limpar-posts") return;
      e.preventDefault();
      E.media_ids = [];
      renderResumoPosts();
      if (postsCache) renderPosts();
    };

    $("#ed-resposta").oninput = (e) => { E.public_reply = e.target.value; };
    $("#ed-add-variacao").onclick = () => { E.variantes.push(""); renderVariacoes(); $(`[data-var="${E.variantes.length - 1}"]`).focus(); };
    $("#ed-variacoes").oninput = (e) => { if (e.target.dataset.var != null) E.variantes[Number(e.target.dataset.var)] = e.target.value; };
    $("#ed-variacoes").onclick = (e) => {
      const b = e.target.closest("[data-var-rem]");
      if (b) { E.variantes.splice(Number(b.dataset.varRem), 1); renderVariacoes(); }
    };

    // Resposta (Mensagem 1)
    $("#ed-mensagem").oninput = (e) => { E.mensagem = e.target.value; renderPrevia(); refrescarRef(); };
    $("#ed-botao-ligado").onchange = (e) => { E.botaoLigado = e.target.checked; renderVisibilidade(); renderPrevia(); };
    $("#ed-botao-texto").oninput = (e) => { E.botaoTexto = e.target.value; atualizarBotaoMsg1(); renderPrevia(); refrescarRef(); };
    $("#ed-acao").onchange = (e) => {
      E.acao = e.target.value;
      // Link colado no nome do botão? Move pro campo certo e põe um nome padrão.
      if (E.acao === "link" && pareceUrl(E.botaoTexto)) {
        if (!E.link.trim()) E.link = E.botaoTexto.trim();
        E.botaoTexto = "Acessar";
        $("#ed-botao-texto").value = E.botaoTexto;
        $("#ed-link").value = E.link;
        atualizarBotaoMsg1();
        aviso("Movemos o link pro campo do link e demos o nome \"Acessar\" ao botão.");
      }
      if (E.acao === "conversa" && !E.passos.length) { adicionarPasso(); renderPassos(); }
      renderVisibilidade(); renderPrevia();
    };
    $("#ed-link").oninput = (e) => { E.link = e.target.value; renderPrevia(); };

    // Construtor da conversa (delegação)
    $("#ed-add-passo").onclick = () => { adicionarPasso(); renderPassos(); renderPrevia(); };
    const passos = $("#ed-passos");
    passos.addEventListener("input", (e) => {
      const el = e.target, c = el.dataset.campo;
      if (!c) return;
      const p = E.passos[Number(el.dataset.i)];
      const b = el.dataset.j != null ? p.buttons[Number(el.dataset.j)] : null;
      if (c === "message") p.message = el.value;
      if (c === "url") b.url = el.value;
      if (c === "title") {
        b.title = el.value;
        const box = el.parentElement;
        const cont = $("[data-cont]", box);
        cont.textContent = `${b.title.length}/${LIMITE_TITULO}`;
        cont.classList.toggle("estourou", b.title.length > LIMITE_TITULO);
        $("[data-aviso-url]", box).hidden = !(pareceUrl(b.title) && b.dest !== "link");
      }
      if (c === "delay-seconds") {
        const s = Number(el.value) || 0;
        p.delay = s > 0 ? { seconds: s, next: p.delay?.next ?? null } : null;
        el.closest(".grade2").querySelector("[data-delay-next]").hidden = !s;
      }
      renderPrevia();
    });
    passos.addEventListener("change", (e) => {
      const el = e.target, c = el.dataset.campo;
      if (!c) return;
      const p = E.passos[Number(el.dataset.i)];
      const b = el.dataset.j != null ? p.buttons[Number(el.dataset.j)] : null;
      const valorId = el.value === "" ? null : (isNaN(Number(el.value)) ? el.value : Number(el.value));

      if (c === "dest") {
        b.dest = el.value; // a escolha "é link" fica guardada aqui, mesmo com a URL vazia
        if (b.dest === "link" && pareceUrl(b.title)) {
          // link colado no NOME do botão: move pro campo certo
          if (!b.url.trim()) b.url = b.title.trim();
          b.title = "Acessar";
          aviso("Movemos o link pro campo do link e demos o nome \"Acessar\" ao botão.");
        }
        if (b.dest === "passo" && b.next == null) {
          const outro = E.passos.find((x) => String(x.id) !== String(p.id));
          b.next = outro ? outro.id : null;
        }
      } else if (c === "title") {
        if (b.dest === "link" && pareceUrl(b.title)) {
          if (!b.url.trim()) b.url = b.title.trim();
          b.title = "Acessar";
          aviso("Movemos o link pro campo do link e demos o nome \"Acessar\" ao botão.");
        } else return;
      } else if (c === "next") b.next = valorId;
      else if (c === "collect-field") p.collect = el.value ? { field: el.value, next: p.collect?.next ?? null } : null;
      else if (c === "collect-next") p.collect.next = valorId;
      else if (c === "delay-next") { if (p.delay) p.delay.next = valorId; }
      else return;

      renderPassos(); renderPrevia();
    });
    passos.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add-botao]");
      const remB = e.target.closest("[data-rem-botao]");
      const remP = e.target.closest("[data-rem-passo]");
      if (add) {
        const p = E.passos[Number(add.dataset.addBotao)];
        if (p.buttons.length >= MAX_BOTOES) return;
        const outro = E.passos.find((x) => String(x.id) !== String(p.id));
        p.buttons.push({ title: "", dest: outro ? "passo" : "fim", next: outro ? outro.id : null, url: "" });
      } else if (remB) {
        const [i, j] = remB.dataset.remBotao.split(":").map(Number);
        E.passos[i].buttons.splice(j, 1);
      } else if (remP) {
        removerPasso(Number(remP.dataset.remPasso));
      } else return;
      renderPassos(); renderPrevia();
    });

    // Arquivos
    const arqs = $("#ed-arquivos");
    arqs.addEventListener("change", (e) => {
      const id = e.target.dataset.arq;
      if (!id) return;
      E.asset_ids = e.target.checked ? [...E.asset_ids, id] : E.asset_ids.filter((x) => x !== id);
      renderPrevia();
    });
    arqs.addEventListener("click", async (e) => {
      if (e.target.id !== "arq-add") return;
      const nome = $("#arq-nome").value.trim();
      const tipo = $("#arq-tipo").value;
      const url = ajustarUrl($("#arq-url").value);
      if (!nome || !urlValida(url)) return aviso("Preencha o nome e um link público completo (https://...).", "atencao");
      try {
        const a = await Dados.adicionarArquivo({ nome, tipo, public_url: url });
        E.asset_ids.push(a.id);
        aviso(App.remoto ? "Arquivo adicionado à biblioteca." : "Arquivo adicionado só neste navegador (modo de teste local).");
        renderArquivos(); renderPrevia();
      } catch { aviso("Não foi possível adicionar o arquivo agora.", "erro"); }
    });

    // Emojis: inserem no campo de texto logo abaixo da barrinha
    ed.addEventListener("mousedown", (e) => { if (e.target.closest("[data-emoji]")) e.preventDefault(); });
    ed.addEventListener("click", (e) => {
      const b = e.target.closest("[data-emoji]");
      if (!b) return;
      const campo = b.parentElement.nextElementSibling;
      if (campo?.tagName === "TEXTAREA") inserirNoCursor(campo, b.dataset.emoji);
    });

    // Esc fecha (perguntando se tiver coisa não salva)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && aberto && !$(".modal-fundo")) fechar();
    });
    // Fechar a aba com coisa não salva: o navegador avisa
    window.addEventListener("beforeunload", (e) => { if (mudou()) { e.preventDefault(); e.returnValue = ""; } });
  }

  // Atualiza só a caixinha da Mensagem 1 (referência) sem redesenhar tudo
  function refrescarRef() {
    if (E.acao !== "conversa") return;
    const ref = $(".msg-ref", $("#ed-passos"));
    if (!ref) return;
    $(".ref-texto", ref).innerHTML = esc(E.mensagem) || "<em>Escreva em \"Sua mensagem\" lá em cima.</em>";
    $("strong", ref).textContent = E.botaoTexto || "(sem nome)";
  }

  ligarEventos();
  window.Editor = { abrir, fechar, aberto: () => aberto, limparPosts: () => { postsCache = null; } };
})();
