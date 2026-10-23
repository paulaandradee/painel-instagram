// =====================================================================
// acessos.js: a tela "Contas e acessos" (só administradoras)
// - contas de Instagram conectadas (e conectar uma nova pelo token)
// - pessoas com acesso ao painel e quais contas cada uma vê
// Quem barra de verdade é o banco (RLS) e a função painel-admin;
// esta tela só organiza.
// =====================================================================
(function () {
  let estado = null; // { contas, pessoas }

  const PAINEL_URL = "https://paulaandradee.github.io/painel-instagram/";

  function senhaAleatoria() {
    const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const a = new Uint32Array(12);
    crypto.getRandomValues(a);
    return [...a].map((n) => c[n % c.length]).join("");
  }

  function validade(c) {
    if (c.token_ok === false) return `<span class="pilula-status erro"><span class="ponto"></span>Token com erro</span>`;
    if (!c.token_expira_em) return `<span class="pilula-status"><span class="ponto"></span>Token ativo</span>`;
    const dias = Math.ceil((new Date(c.token_expira_em).getTime() - Date.now()) / 864e5);
    const nivel = dias <= 3 ? "erro" : dias <= 14 ? "atencao" : "";
    return `<span class="pilula-status ${nivel}"><span class="ponto"></span>${dias > 0 ? `Token ${dias} dias` : "Token vencido"}</span>`;
  }

  const nomeConta = (id) => { const c = estado.contas.find((x) => x.id === id); return c ? `@${c.username}` : "conta removida"; };

  // ---------------- Carregar e desenhar ----------------
  async function carregar() {
    const alvo = $("#acessos-corpo");
    if (!App.remoto) {
      alvo.innerHTML = `<div class="faixa faixa-info">${icone("info")}<span>Contas e acessos funcionam com o painel no ar, conectado ao Supabase.</span></div>`;
      return;
    }
    alvo.innerHTML = `<div class="texto-2">Carregando...</div>`;
    const r = await Dados.admin("estado");
    if (!r?.ok) { alvo.innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>${esc(r?.erro || "Não foi possível carregar.")}</span></div>`; return; }
    estado = r;
    render();
  }

  function render() {
    const alvo = $("#acessos-corpo");
    const membrosDe = (contaId) => estado.pessoas.filter((p) => p.contas.includes(contaId)).length;

    alvo.innerHTML = `
      <div class="cartao" style="margin-bottom:16px">
        <div class="linha-entre" style="margin-bottom:12px">
          <h2 class="titulo-card">📸 Contas de Instagram</h2>
          <button class="btn btn-primario btn-p" data-ac="conectar"><span data-icone="mais"></span> Conectar conta</button>
        </div>
        ${estado.contas.map((c) => `
          <div class="ac-linha">
            <span class="avatar" aria-hidden="true">${esc((c.username || "?").charAt(0).toUpperCase())}</span>
            <div class="ac-info"><div class="nome-l">@${esc(c.username)}</div><div class="pequeno texto-2">${esc(c.nome || "")}</div></div>
            ${validade(c)}
            <span class="pequeno texto-2">${membrosDe(c.id)} ${membrosDe(c.id) === 1 ? "pessoa" : "pessoas"} com acesso</span>
          </div>`).join("") || `<p class="texto-2">Nenhuma conta conectada.</p>`}
      </div>

      <div class="cartao">
        <div class="linha-entre" style="margin-bottom:12px">
          <h2 class="titulo-card">👥 Pessoas com acesso</h2>
          <button class="btn btn-primario btn-p" data-ac="nova-pessoa"><span data-icone="mais"></span> Adicionar pessoa</button>
        </div>
        ${estado.pessoas.map((p) => `
          <div class="ac-linha" data-pessoa="${esc(p.id)}">
            <span class="avatar" aria-hidden="true">${esc((p.email || "?").charAt(0).toUpperCase())}</span>
            <div class="ac-info">
              <div class="nome-l">${esc(p.email)} ${p.admin ? `<span class="chip chip-destaque">Administradora</span>` : p.leitor ? `<span class="chip">Só visualização</span>` : ""}${p.id === App.usuario.id ? ` <span class="chip">você</span>` : ""}</div>
              <div class="chips">${p.contas.length ? p.contas.map((id) => `<span class="chip">${esc(nomeConta(id))}</span>`).join("") : `<span class="pequeno texto-2">sem nenhuma conta liberada</span>`}</div>
            </div>
            <span class="pequeno texto-2">${p.ultimo_acesso ? "último acesso " + new Date(p.ultimo_acesso).toLocaleDateString("pt-BR") : "ainda não entrou"}</span>
            <button class="btn btn-p" data-ac="acessos">Acessos</button>
            ${!p.admin && p.id !== App.usuario.id ? `<button class="btn btn-icone btn-fantasma btn-perigo" data-ac="remover" aria-label="Remover ${esc(p.email)}">${icone("lixo")}</button>` : `<span style="width:32px"></span>`}
          </div>`).join("")}
        <p class="ajuda" style="margin-bottom:0">Cada pessoa só vê, no Instagram do painel, as contas marcadas pra ela. Os atalhos do menu (Jardim, CRM, Notion) aparecem pra todas. Quem está em <b>Só visualização</b> vê tudo, mas não altera nada.</p>
      </div>`;
    pintarIcones(alvo);
  }

  // ---------------- Janelas ----------------
  function janela(titulo, html, aoAbrir) {
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `<div class="cartao modal modal-largo" role="dialog" aria-modal="true">
      <div class="linha-entre" style="margin-bottom:12px"><h3 class="subtitulo">${titulo}</h3>
      <button class="btn btn-icone btn-fantasma" data-fechar aria-label="Fechar">✕</button></div>${html}</div>`;
    const fechar = () => { fundo.remove(); document.removeEventListener("keydown", tecla); };
    const tecla = (e) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", tecla);
    fundo.addEventListener("click", (e) => { if (e.target === fundo || e.target.closest("[data-fechar]")) fechar(); });
    document.body.appendChild(fundo);
    pintarIcones(fundo);
    aoAbrir(fundo, fechar);
  }

  const caixasContas = (marcadas = []) => estado.contas.map((c) => `
    <label class="ac-check"><input type="checkbox" value="${esc(c.id)}" ${marcadas.includes(c.id) ? "checked" : ""}> @${esc(c.username)} <span class="pequeno texto-2">${esc(c.nome || "")}</span></label>`).join("");
  const marcadasEm = (el) => [...el.querySelectorAll(".ac-checks .ac-check input:checked")].map((i) => i.value);

  // Só visualização: vê tudo das contas marcadas, mas não altera nada
  const caixaLeitor = (marcada = false) => `
    <label class="ac-check" style="margin-top:12px"><input type="checkbox" id="ac-leitor" ${marcada ? "checked" : ""}>
      <span><b>Só visualização</b><br><span class="pequeno texto-2">Vê automações, leads, conversas, relatório e calendário, mas não cria, edita, envia nem apaga nada.</span></span></label>`;

  function conectar() {
    janela("Conectar conta de Instagram", `
      <ol class="pequeno ac-passos">
        <li>No <b>Meta for Developers</b>, abra o seu app e vá em <b>Instagram &gt; API setup with Instagram login</b>.</li>
        <li>Em <b>Generate access tokens</b>, clique em <b>Add account</b> e entre com a conta nova (ela precisa ser <b>comercial ou de criador</b>).</li>
        <li>Se o app ainda estiver em modo de desenvolvimento, adicione essa conta como <b>testadora</b> em App roles.</li>
        <li>Clique em <b>Generate token</b> ao lado da conta, copie o token inteiro e cole abaixo.</li>
      </ol>
      <label class="rotulo" for="ac-token">Token da conta</label>
      <textarea class="textarea textarea-link" id="ac-token" placeholder="IGAA..."></textarea>
      <p class="ajuda">O token fica guardado trancado no banco: nem o painel consegue ler depois. A conta passa a receber as automações na hora.</p>
      <div class="linha" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="ac-ok">Conectar</button></div>`,
    (el, fechar) => {
      $("#ac-ok", el).onclick = async (e) => {
        const btn = e.currentTarget, token = $("#ac-token", el).value.trim();
        if (!token) return aviso("Cole o token da conta.", "atencao");
        btn.disabled = true; btn.textContent = "Conectando...";
        const r = await Dados.admin("conectar_conta", { token });
        if (!r?.ok) { btn.disabled = false; btn.textContent = "Conectar"; return aviso(r?.erro || "Não foi possível conectar.", "erro"); }
        fechar();
        aviso(`@${r.conta.username} conectada.${r.aviso ? " " + r.aviso : ""}`, r.aviso ? "atencao" : "ok");
        await prepararContas();
        carregar();
      };
    });
  }

  function novaPessoa() {
    if (!estado.contas.length) return aviso("Conecte uma conta de Instagram primeiro.", "atencao");
    const senha = senhaAleatoria();
    janela("Adicionar pessoa", `
      <div class="campo"><label class="rotulo" for="ac-email">E-mail</label><input class="input" id="ac-email" type="email" placeholder="nome@exemplo.com"></div>
      <div class="campo"><label class="rotulo" for="ac-senha">Senha provisória</label>
        <div class="linha"><input class="input" id="ac-senha" value="${senha}" style="flex:1;font-family:ui-monospace,Consolas,monospace"><button class="btn btn-p" id="ac-gerar">Gerar outra</button></div>
        <div class="ajuda">Pelo menos 8 caracteres. Você vai poder copiar e enviar pra ela no final.</div></div>
      <span class="rotulo">Contas que ela vê</span>
      <div class="ac-checks">${caixasContas()}</div>
      ${caixaLeitor()}
      <div class="linha" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="ac-ok">Criar acesso</button></div>`,
    (el, fechar) => {
      $("#ac-gerar", el).onclick = () => { $("#ac-senha", el).value = senhaAleatoria(); };
      $("#ac-ok", el).onclick = async (e) => {
        const btn = e.currentTarget;
        const email = $("#ac-email", el).value.trim(), senha = $("#ac-senha", el).value, contas = marcadasEm(el);
        if (!contas.length) return aviso("Marque pelo menos uma conta.", "atencao");
        btn.disabled = true; btn.textContent = "Criando...";
        const r = await Dados.admin("criar_pessoa", { email, senha, contas, leitor: $("#ac-leitor", el).checked });
        if (!r?.ok) { btn.disabled = false; btn.textContent = "Criar acesso"; return aviso(r?.erro || "Não foi possível criar.", "erro"); }
        // mostra os dados pra enviar
        const texto = `Seu acesso ao painel:\n${PAINEL_URL}\nE-mail: ${email}\nSenha: ${senha}`;
        el.querySelector(".modal").innerHTML = `
          <h3 class="subtitulo" style="margin-bottom:10px">✅ Acesso criado</h3>
          <p class="pequeno texto-2" style="margin:0 0 10px">Envie estes dados pra ela. A senha não aparece de novo depois que você fechar.</p>
          <pre class="ac-credenciais">${esc(texto)}</pre>
          <div class="linha" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="ac-copiar">Copiar</button><button class="btn btn-primario" data-fechar>Pronto</button></div>`;
        $("#ac-copiar", el).onclick = async () => {
          try { await navigator.clipboard.writeText(texto); aviso("Copiado.", "ok"); } catch { aviso("Selecione o texto e copie.", "atencao"); }
        };
        carregar();
      };
    });
  }

  function editarAcessos(pessoa) {
    janela(`Acessos de ${esc(pessoa.email)}`, `
      <p class="pequeno texto-2" style="margin:0 0 10px">Marque as contas de Instagram que ${pessoa.id === App.usuario.id ? "você vê" : "ela vê"} no painel.</p>
      <div class="ac-checks">${caixasContas(pessoa.contas)}</div>
      ${pessoa.admin ? "" : caixaLeitor(pessoa.leitor)}
      <div class="linha" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="ac-ok">Salvar</button></div>`,
    (el, fechar) => {
      $("#ac-ok", el).onclick = async (e) => {
        const btn = e.currentTarget, contas = marcadasEm(el);
        btn.disabled = true;
        const r = await Dados.admin("definir_acessos", { user_id: pessoa.id, contas, leitor: $("#ac-leitor", el)?.checked === true });
        if (!r?.ok) { btn.disabled = false; return aviso(r?.erro || "Não foi possível salvar.", "erro"); }
        fechar();
        aviso("Acessos salvos.", "ok");
        if (pessoa.id === App.usuario.id) await prepararContas();
        carregar();
      };
    });
  }

  // ---------------- Eventos ----------------
  $("#acessos-corpo").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ac]");
    if (!b || !estado) return;
    const pessoa = estado.pessoas.find((p) => p.id === b.closest("[data-pessoa]")?.dataset.pessoa);
    if (b.dataset.ac === "conectar") return conectar();
    if (b.dataset.ac === "nova-pessoa") return novaPessoa();
    if (b.dataset.ac === "acessos" && pessoa) return editarAcessos(pessoa);
    if (b.dataset.ac === "remover" && pessoa) {
      const ok = await confirmar("Remover acesso?", `${pessoa.email} não vai mais conseguir entrar no painel.`, "Remover", true);
      if (!ok) return;
      const r = await Dados.admin("remover_pessoa", { user_id: pessoa.id });
      if (!r?.ok) return aviso(r?.erro || "Não foi possível remover.", "erro");
      aviso("Acesso removido.", "ok");
      carregar();
    }
  });

  window.Acessos = { carregar };
})();
