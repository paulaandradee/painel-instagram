// =====================================================================
// drive.js: "Drive e Arquivos" e o envio de arquivos da ficha
// Fala com a função "drive" (o token do Google fica só no servidor).
// - página: conexão, espaço usado, criar pastas que faltam, últimos arquivos
// - Drive.enviar: o arquivo vai direto do navegador para o Google Drive
//   (não passa pelo Supabase), na subpasta certa, com nome de versão
// Só contas com o recurso 'drive'.
// =====================================================================
(function () {
  const SUBPASTAS = ["01 - Briefing e Roteiro", "02 - Gravações", "03 - Edição", "04 - Aprovados", "05 - Publicados"];
  let estado = null; // último status { configurado, conectado, email, espaco, raiz }

  const ligado = (contaId) => !!App.contas.find((c) => c.id === contaId)?.recursos?.includes("drive");
  const algumaConta = () => App.remoto && App.contas.some((c) => c.recursos?.includes("drive"));
  const tamanho = (b) => (b == null ? "" : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB` : b >= 1048576 ? `${(b / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  async function chamar(corpo) {
    try {
      const { data, error } = await sb.functions.invoke("drive", { body: corpo });
      if (error) {
        let r = null;
        try { r = await error.context?.json?.(); } catch { /* sem corpo */ }
        return r ?? { ok: false, erro: "Não foi possível falar com o servidor agora." };
      }
      return data;
    } catch { return { ok: false, erro: "Não foi possível falar com o servidor agora." }; }
  }

  async function status(forcar = false) {
    if (estado && !forcar) return estado;
    estado = await chamar({ acao: "status" });
    return estado;
  }

  // Cria/confere a pasta do conteúdo (e renomeia/move se a data ou o título mudou)
  const pasta = (conteudoId) => chamar({ acao: "pasta", conteudo_id: conteudoId });

  // Depois de salvar/mover um conteúdo: atualiza a pasta sem atrapalhar ninguém
  async function sincronizar(conteudo, criarSeNaoTiver = false) {
    if (!App.remoto || App.leitor || !ligado(conteudo.conta_id)) return;
    if (!conteudo.drive_pasta_url && !criarSeNaoTiver) return;
    const s = await status();
    if (!s?.conectado) return;
    const r = await pasta(conteudo.id);
    if (!r?.ok) console.warn("[drive] pasta:", r?.erro);
  }

  // Envia um arquivo: abre o envio no servidor e manda o arquivo direto ao Google
  async function enviar(conteudoId, subpasta, arquivo, aoProgresso) {
    const ini = await chamar({ acao: "upload_iniciar", conteudo_id: conteudoId, subpasta, nome: arquivo.name, tipo: arquivo.type || "application/octet-stream", tamanho: arquivo.size });
    if (!ini?.ok) throw new Error(ini?.erro || "Não foi possível abrir o envio.");
    const resposta = await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", ini.url);
      x.setRequestHeader("Content-Type", arquivo.type || "application/octet-stream");
      x.upload.onprogress = (e) => { if (e.lengthComputable) aoProgresso?.(e.loaded / e.total); };
      x.onload = () => { try { if (x.status >= 200 && x.status < 300) resolve(JSON.parse(x.responseText)); else reject(new Error(`O Google recusou o arquivo (${x.status}).`)); } catch { reject(new Error("Resposta estranha do Google.")); } };
      x.onerror = () => reject(new Error("A conexão caiu durante o envio. Tente de novo."));
      x.send(arquivo);
    });
    const fim = await chamar({ acao: "upload_concluir", conteudo_id: conteudoId, subpasta, drive_id: resposta.id, nome_original: arquivo.name });
    if (!fim?.ok) throw new Error(fim?.erro || "O arquivo subiu, mas não ficou registrado.");
    return fim.arquivo;
  }

  async function arquivosDe(conteudoId) {
    const { data } = await sb.from("arquivos").select("*").eq("conteudo_id", conteudoId).order("subpasta").order("enviado_em", { ascending: false });
    return data ?? [];
  }

  function copiar(link) {
    navigator.clipboard?.writeText(link).then(() => aviso("Link copiado. Ele abre só para quem tem acesso no Drive.", "ok"), () => aviso("Não deu para copiar. Abra o arquivo e copie pelo Drive.", "atencao"));
  }

  // ---------------- Pedaço da ficha (aba Arquivos) ----------------
  // Devolve o HTML; os botões têm data-drv e são tratados por tratarCliqueFicha
  // permitidas: subpastas em que a pessoa pode enviar (null = todas; expert = 2, editor = 3 e 4)
  function htmlFicha(c, s, arquivos, enviando, permitidas = null) {
    if (!s) return `<p class="pequeno texto-2">Conferindo o Drive...</p>`;
    if (!s.configurado || !s.conectado) {
      return `<div class="faixa faixa-atencao">${icone("info")}<span>O Google Drive ainda não está conectado. ${App.admin ? `Conecte em <a href="#drive">Drive e Arquivos</a>.` : "Peça para a administradora conectar."}</span></div>`;
    }
    const porSub = SUBPASTAS.map((nome, i) => ({ nome, n: i + 1, lista: arquivos.filter((a) => a.subpasta === i + 1) }));
    return `
      <div class="linha" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
        ${c.drive_pasta_url ? `<a class="btn" href="${esc(c.drive_pasta_url)}" target="_blank" rel="noopener noreferrer">📁 Abrir pasta no Drive ↗</a>
          <button type="button" class="btn btn-fantasma" data-drv="copiar" data-link="${esc(c.drive_pasta_url)}"><span data-icone="link"></span> Copiar link</button>`
          : `<button type="button" class="btn btn-p so-edicao" data-drv="criar-pasta">📁 Criar pasta no Drive</button>`}
      </div>
      <div class="drv-envio so-edicao">
        <select class="select" id="drv-sub" aria-label="Subpasta">${SUBPASTAS.map((n, i) => (permitidas && !permitidas.includes(i + 1) ? "" : `<option value="${i + 1}" ${i + 1 === (permitidas?.[0] ?? 2) ? "selected" : ""}>${n}</option>`)).join("")}</select>
        <button type="button" class="btn btn-primario" data-drv="escolher" ${enviando ? "disabled" : ""}><span data-icone="mais"></span> Enviar arquivo</button>
        <input type="file" id="drv-arquivo" multiple hidden>
        <span class="pequeno texto-2">Até 2 GB por arquivo. Nome automático: Video_Bruto_01, Video_Edicao_V01, Video_Final_Aprovado...</span>
      </div>
      <div id="drv-progresso">${enviando ? `<div class="drv-barra"><span style="width:${Math.round(enviando.p * 100)}%"></span></div><p class="pequeno">${esc(enviando.nome)}: ${Math.round(enviando.p * 100)}%</p>` : ""}</div>
      ${porSub.map((g) => `<div class="drv-grupo"><h4 class="rotulo">${esc(g.nome)} <span class="texto-3">(${g.lista.length})</span></h4>
        ${g.lista.length ? g.lista.map((a) => `<div class="drv-arq">
          <span class="drv-nome" title="${esc(a.nome_original)}">${esc(a.nome)}</span>
          <span class="pequeno texto-2">v${a.versao} · ${esc(tamanho(a.tamanho))} · ${esc(new Date(a.enviado_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }))}</span>
          <a class="btn btn-fantasma btn-p" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>
          <button type="button" class="btn btn-fantasma btn-p" data-drv="copiar" data-link="${esc(a.link)}">Copiar link</button>
        </div>`).join("") : `<p class="pequeno texto-3" style="margin:2px 0 8px">Vazia.</p>`}</div>`).join("")}`;
  }

  // ---------------- Página "Drive e Arquivos" ----------------
  async function carregar() {
    const alvo = $("#drive-corpo");
    if (!alvo) return;
    // voltou do Google?
    const volta = (location.hash.split("?")[1] || "");
    if (volta) {
      const r = new URLSearchParams(volta).get("drive");
      history.replaceState(null, "", `${location.pathname}${location.search}#drive`);
      const msg = { conectado: ["Google Drive conectado.", "ok"], cancelado: ["Conexão cancelada no Google.", "atencao"], expirou: ["O pedido expirou. Clique em Conectar de novo.", "atencao"], erro: ["O Google não devolveu a autorização. Tente de novo.", "erro"] }[r];
      if (msg) aviso(...msg);
    }
    alvo.innerHTML = `<p class="texto-2">Conferindo o Drive...</p>`;
    const s = await status(true);
    const contas = App.contas.filter((c) => c.recursos?.includes("drive"));
    if (!s?.configurado) {
      alvo.innerHTML = `<div class="cartao fm-bloco"><h2 class="titulo-card">Falta configurar o Google</h2>
        <p class="texto-2">${esc(s?.erro || "Os secrets GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET ainda não estão no Supabase.")} O passo a passo está no LEIA-ME (seção Google Drive).</p></div>`;
      return;
    }
    if (!s.conectado) {
      alvo.innerHTML = `<div class="cartao vazio"><div class="vazio-icone">📁</div><h2 class="subtitulo">Google Drive não conectado</h2>
        <p>O painel cria as pastas dos conteúdos (CLIENTES SOCIAL MEDIA › conta › ano › mês › conteúdo) e envia os arquivos direto para elas. Ele só enxerga as pastas que ele mesmo criou.</p>
        ${App.admin ? `<button class="btn btn-primario" data-drive="conectar">Conectar Google Drive</button>` : `<p class="pequeno">Peça para a administradora conectar.</p>`}</div>`;
      return;
    }
    const usado = s.espaco?.usado ?? 0, limite = s.espaco?.limite;
    const pct = limite ? Math.round((usado / limite) * 100) : 0;
    const { data: recentes } = await sb.from("arquivos").select("*, conteudos(titulo, tema, numero)").in("conta_id", contas.map((c) => c.id)).order("enviado_em", { ascending: false }).limit(30);
    alvo.innerHTML = `
      <div class="fm-duas" style="margin-top:0">
        <div class="cartao fm-bloco">
          <h2 class="titulo-card">✓ Conectado</h2>
          <p style="margin:6px 0">Conta Google: <strong>${esc(s.email || "-")}</strong></p>
          ${limite ? `<div class="fm-barra ${pct > 85 ? "drv-cheio" : ""}"><span style="width:${pct}%"></span></div>
            <p class="pequeno texto-2">${esc(tamanho(usado))} de ${esc(tamanho(limite))} usados (${pct}%). O espaço é dividido com Gmail e Google Fotos.${pct > 85 ? " <strong>Está quase cheio.</strong>" : ""}</p>` : `<p class="pequeno texto-2">${esc(tamanho(usado))} usados.</p>`}
          <div class="linha" style="flex-wrap:wrap;gap:8px;margin-top:10px">
            ${s.raiz ? `<a class="btn" href="${esc(s.raiz)}" target="_blank" rel="noopener noreferrer">📁 Abrir CLIENTES SOCIAL MEDIA ↗</a>` : ""}
            ${App.admin ? `<button class="btn btn-fantasma btn-perigo" data-drive="desconectar">Desconectar</button>` : ""}
          </div>
        </div>
        <div class="cartao fm-bloco">
          <h2 class="titulo-card">Pastas dos conteúdos</h2>
          <p class="pequeno texto-2">Cada conteúdo novo ganha a pasta sozinho. Mudou a data ou o título? A pasta é renomeada ou movida, sem perder os arquivos.</p>
          ${contas.map((c) => `<button class="btn btn-p so-edicao" data-drive="faltando" data-conta="${esc(c.id)}">Criar as pastas que faltam · @${esc(c.username)}</button>`).join(" ")}
        </div>
      </div>
      <h3 class="titulo-card dsp-sec">Últimos arquivos enviados</h3>
      <div class="cartao">${recentes?.length ? `<div class="tabela-wrap"><table class="planilha"><thead><tr><th>Arquivo</th><th>Conteúdo</th><th>Pasta</th><th>Tamanho</th><th>Quando</th><th></th></tr></thead><tbody>
        ${recentes.map((a) => `<tr><td>${esc(a.nome)}</td><td>${esc(a.conteudos?.titulo || a.conteudos?.tema || "-")}</td><td>${esc(SUBPASTAS[a.subpasta - 1])}</td>
          <td>${esc(tamanho(a.tamanho))}</td><td>${esc(new Date(a.enviado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}</td>
          <td><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="texto-2 pequeno" style="padding:14px">Nenhum arquivo enviado pelo painel ainda. Envie pela aba Arquivos da ficha de um conteúdo.</p>`}</div>`;
  }

  const raiz = $("#drive-corpo");
  raiz?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-drive]");
    if (!b || b.disabled) return;
    const a = b.dataset.drive;
    if (a === "conectar") {
      b.disabled = true;
      const r = await chamar({ acao: "conectar" });
      if (!r?.ok) { b.disabled = false; return aviso(r?.erro || "Não foi possível agora.", "erro"); }
      location.href = r.url;
    }
    if (a === "desconectar") {
      if (!(await confirmar("Desconectar o Google Drive?", "As pastas e arquivos continuam no Drive. O painel só deixa de criar pastas e enviar arquivos até você conectar de novo.", "Desconectar", true))) return;
      const r = await chamar({ acao: "desconectar" });
      if (!r?.ok) return aviso(r?.erro || "Não foi possível agora.", "erro");
      estado = null; aviso("Drive desconectado."); carregar();
    }
    if (a === "faltando") {
      b.disabled = true; b.textContent = "Criando pastas...";
      const r = await chamar({ acao: "pastas_faltando", conta_id: b.dataset.conta });
      b.disabled = false;
      if (!r?.ok) { aviso(r?.erro || "Não foi possível agora.", "erro"); return carregar(); }
      aviso(r.criadas ? `${r.criadas} ${r.criadas === 1 ? "pasta criada" : "pastas criadas"}.` : "Todos os conteúdos já têm pasta.", "ok");
      carregar();
    }
  });

  window.Drive = { ligado, algumaConta, status, pasta, sincronizar, enviar, arquivosDe, copiar, htmlFicha, carregar };
})();
