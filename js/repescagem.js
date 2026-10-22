// =====================================================================
// repescagem.js: responder comentários dos últimos 7 dias que ficaram
// sem DM. Primeiro mostra a PRÉVIA (quem vai receber e quem ficou de
// fora); só envia depois que você confirma. As DMs saem pela fila com
// freio (o ig-scheduler manda aos poucos).
// =====================================================================
(function () {
  const MOTIVOS = {
    sem_palavra: "não usaram a palavra-chave",
    da_conta: "são respostas da própria conta",
    ja_receberam: "já receberam a DM desta automação",
    recebeu_hoje: "já receberam uma DM nas últimas 24h (regra do 1 por dia)",
    ja_na_fila: "já estão na fila de envio",
    repetidos: "comentaram mais de uma vez (cada pessoa recebe uma só)",
  };

  function haDias(iso) {
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600e3);
    if (h < 1) return "agora há pouco";
    if (h < 24) return `há ${h} h`;
    const d = Math.floor(h / 24);
    return d === 1 ? "ontem" : `há ${d} dias`;
  }

  // Quanto tempo a fila leva (freio: 6 por minuto e 60 por hora)
  function estimativa(n) {
    if (n <= 0) return "";
    if (n <= 60) return `cerca de ${Math.max(1, Math.ceil(n / 6))} min`;
    return `cerca de ${Math.ceil(n / 60)} h`;
  }

  function abrir(auto) {
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `<div class="cartao modal modal-largo" role="dialog" aria-modal="true" aria-labelledby="rp-titulo">
      <div class="linha-entre" style="margin-bottom:6px">
        <h3 class="subtitulo" id="rp-titulo">🔁 Repescagem</h3>
        <button class="btn btn-icone btn-fantasma" data-rp="fechar" aria-label="Fechar">✕</button>
      </div>
      <p class="pequeno texto-2" style="margin:0 0 14px">${esc(auto.nome || "Automação")}: comentários dos últimos 7 dias que ainda não receberam a DM.</p>
      <div id="rp-corpo"><div class="texto-2" style="padding:20px 0">Lendo os comentários dos posts...</div></div>
    </div>`;
    const fechar = () => { fundo.remove(); document.removeEventListener("keydown", esc_); };
    const esc_ = (e) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", esc_);
    fundo.addEventListener("click", (e) => { if (e.target === fundo || e.target.closest("[data-rp=fechar]")) fechar(); });
    document.body.appendChild(fundo);
    carregar(auto, fundo, fechar);
  }

  async function carregar(auto, fundo, fechar) {
    const corpo = $("#rp-corpo", fundo);
    const r = await Dados.repescagem(auto.id, "previa");
    if (!r) {
      corpo.innerHTML = `<div class="faixa faixa-info">${icone("info")}<span>A repescagem lê os comentários direto do Instagram: ela funciona com o painel no ar, conectado ao Supabase e ao Instagram.</span></div>
        <div class="linha" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-rp="fechar">Fechar</button></div>`;
      return;
    }
    if (!r.ok) {
      corpo.innerHTML = `<div class="faixa faixa-erro">${icone("info")}<span>${esc(r.erro || "Não foi possível ler os comentários agora.")}</span></div>
        <div class="linha" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-rp="fechar">Fechar</button></div>`;
      return;
    }

    const n = r.total;
    const fora = Object.entries(r.resumo).filter(([k, v]) => MOTIVOS[k] && v > 0);
    const temRespostaPublica = !!(auto.public_reply || "").trim() || (auto.public_reply_variants || []).some((v) => (v || "").trim());
    const cap = r.capacidade_hoje;

    corpo.innerHTML = `
      <div class="rp-numero"><div class="numero">${n.toLocaleString("pt-BR")}</div>
        <span class="kpi-rotulo">${n === 1 ? "pessoa vai receber a DM" : "pessoas vão receber a DM"}${n ? ` · ${estimativa(n)} pela fila` : ""}</span></div>
      <p class="pequeno texto-2" style="margin:8px 0 12px">Lidos ${r.resumo.comentarios.toLocaleString("pt-BR")} comentários em ${r.resumo.posts} ${r.resumo.posts === 1 ? "post" : "posts"}.</p>

      ${!r.ativa ? `<div class="faixa faixa-atencao" style="margin-bottom:10px">${icone("info")}<span>Esta automação está desligada. A repescagem envia mesmo assim, mas os comentários novos só são respondidos com ela ligada.</span></div>` : ""}
      ${cap != null && n > cap ? `<div class="faixa faixa-atencao" style="margin-bottom:10px">${icone("info")}<span>Hoje o freio ainda deixa sair ${cap} DMs. O resto sai nos próximos dias, os comentários mais antigos primeiro. Quem passar de 7 dias do comentário não recebe mais (limite da Meta).</span></div>` : ""}

      ${fora.length ? `<details class="avancado" style="margin:0 0 10px"><summary>${fora.reduce((s, [, v]) => s + v, 0)} ficaram de fora</summary>
        <ul class="pequeno texto-2" style="margin:8px 0 0;padding-left:18px">${fora.map(([k, v]) => `<li>${v} ${MOTIVOS[k]}</li>`).join("")}</ul></details>` : ""}

      ${n ? `<span class="rotulo" style="margin-top:6px">Quem vai receber</span>
        <div class="rp-lista">${r.pessoas.map((p) => `
          <div class="rp-pessoa"><span class="avatar" aria-hidden="true">${esc((p.username || "?").charAt(0).toUpperCase())}</span>
            <div style="min-width:0"><div><a href="https://instagram.com/${encodeURIComponent(p.username)}" target="_blank" rel="noopener">@${esc(p.username || "sem @")}</a>
              <span class="pequeno texto-2"> · ${esc(haDias(p.quando))}</span></div>
              <div class="pequeno texto-2 rp-texto">"${esc(p.texto)}"</div></div></div>`).join("")}
          ${n > r.pessoas.length ? `<p class="pequeno texto-2" style="margin:8px 0 0">e mais ${n - r.pessoas.length}...</p>` : ""}
        </div>
        <label class="switch" style="margin-top:14px"><input type="checkbox" id="rp-publico" ${temRespostaPublica ? "checked" : "disabled"}><span class="trilho"></span>
          <span class="pequeno">Responder também no comentário${temRespostaPublica ? "" : " (esta automação não tem resposta pública)"}</span></label>`
        : `<div class="faixa faixa-info">${icone("info")}<span>Ninguém para repescar agora. Todo mundo que comentou nos últimos 7 dias já recebeu ou ficou de fora pelos motivos acima.</span></div>`}

      <div class="linha" style="justify-content:flex-end;margin-top:18px">
        <button class="btn" data-rp="fechar">Cancelar</button>
        ${n ? `<button class="btn btn-primario" id="rp-enviar">Enviar para ${n.toLocaleString("pt-BR")} ${n === 1 ? "pessoa" : "pessoas"}</button>` : ""}
      </div>`;
    pintarIcones(corpo);

    const btn = $("#rp-enviar", corpo);
    if (btn) btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Colocando na fila...";
      const publico = $("#rp-publico", corpo)?.checked ?? false;
      const res = await Dados.repescagem(auto.id, "enviar", publico);
      if (res?.ok) {
        fechar();
        aviso(`${res.enfileirados} ${res.enfileirados === 1 ? "pessoa entrou" : "pessoas entraram"} na fila. As DMs saem aos poucos, até 6 por minuto.`, "ok");
      } else {
        btn.disabled = false; btn.textContent = `Enviar para ${n} pessoas`;
        aviso(res?.erro || "Não foi possível colocar na fila agora.", "erro");
      }
    };
  }

  window.Repescagem = { abrir };
})();
