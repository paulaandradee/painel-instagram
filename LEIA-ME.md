# Seu Painel: automação de DM do Instagram

Um painel web com login e um motor de respostas automáticas no direct do Instagram
(estilo ManyChat): alguém comenta uma palavra num post seu, recebe uma DM com botão,
toca no botão, a conversa segue, e o contato fica salvo.

> Este é um template genérico. Nenhum dado real vem preenchido. Tudo que aparece como
> `SEU_VALOR_AQUI`, `SEU_PROJETO` ou parecido é você quem preenche.

---

## O que tem em cada pasta

| Caminho | O que é |
|---|---|
| `index.html`, `css/`, `js/` | O painel (frontend). HTML, CSS e JavaScript puro. |
| `js/config.js` | Onde você cola a URL e a chave anônima do Supabase. |
| `supabase/sql/` | Os scripts do banco, numerados na ordem de rodar. |
| `supabase/functions/` | As funções na nuvem (Edge Functions). |
| `supabase/config.toml` | Diz quais funções são públicas (sem login). |
| `servidor-local.ps1` | Sobe o painel no seu computador (Windows, sem instalar nada). |

---

## Passo 0: testar agora, sem configurar nada

1. Suba o painel no seu computador:
   - **Windows:** clique com o botão direito em `servidor-local.ps1` e escolha
     "Executar com o PowerShell", ou rode no terminal:
     `powershell -ExecutionPolicy Bypass -File servidor-local.ps1 -Porta 5174`
   - **Mac ou Linux (ou Windows com Python):** na pasta do projeto, rode
     `python3 -m http.server 5173`
2. Abra o endereço que aparecer (ex: `http://localhost:5174`).
3. Entre com **qualquer e-mail** e uma **senha de 5 dígitos** (ex: `12345`).

Esse é o **modo de teste local**: funciona só em `localhost`. Dá pra navegar tudo, criar
automações e ver a prévia ao vivo. O que você salvar fica só no seu navegador. Os passos
abaixo colocam o sistema no ar de verdade, com login e dados salvos no banco.

---

## Passo 1: criar o projeto no Supabase e rodar o banco

1. Crie uma conta em supabase.com e um projeto novo.
2. No menu **SQL Editor**, rode os arquivos de `supabase/sql/` **nesta ordem**:
   1. `01_tabelas.sql`: cria as tabelas e a linha inicial do freio.
   2. `02_freio.sql`: cria as funções `take_send_slot` e `record_send_result`.
   3. `03_rls.sql`: liga as regras de acesso.
   4. O `04_agendamento.sql` fica pro Passo 5.

> **Não pule o `02_freio.sql`.** Sem as funções do freio, ele falha fechado: NENHUMA DM
> por comentário sai, tudo vai pra fila e a fila nunca anda. É o erro silencioso mais comum.

## Passo 2: criar o seu usuário (o login de verdade)

No Supabase, vá em **Authentication > Users > Add user** e crie o seu e-mail e senha.
Esse é o login que vale quando o site estiver no ar. Não existe tela de "criar conta" de
propósito: só entra quem você cadastrar aqui.

Dica: em **Authentication > Sign In / Providers**, desligue "Allow new users to sign up"
pra ninguém se cadastrar por fora.

## Passo 3: configurar os segredos das funções

Instale a CLI do Supabase (supabase.com/docs/guides/cli), entre na pasta do projeto e rode:

```bash
supabase login
supabase link --project-ref SEU_PROJETO

supabase secrets set \
  IG_ACCESS_TOKEN=SEU_VALOR_AQUI \
  IG_ACCOUNT_ID=SEU_VALOR_AQUI \
  APP_SECRET=SEU_VALOR_AQUI \
  APP_SECRET_ENFORCE=false \
  VERIFY_TOKEN=SEU_VALOR_AQUI \
  GRAPH_API_VERSION=v21.0 \
  SCHED_SECRET=SEU_VALOR_AQUI \
  TEST_IG_ACCOUNTS=SEU_VALOR_AQUI
```

(Também dá pra preencher pelo painel, em **Edge Functions > Secrets**.)
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já vêm prontos dentro das funções; não precisa
cadastrar. Os valores do Instagram você pega no Passo 6 e volta aqui pra preencher.

## Passo 4: publicar as funções

```bash
supabase functions deploy instagram-webhook --no-verify-jwt
supabase functions deploy ig-scheduler --no-verify-jwt
supabase functions deploy ig-token-refresh --no-verify-jwt
supabase functions deploy ig-insights
supabase functions deploy ig-media
```

- A `instagram-webhook` **precisa ser pública** (`--no-verify-jwt`), senão o Meta não
  consegue chamar. Pelo painel: abra a função e desligue "Verify JWT".
- `ig-scheduler` e `ig-token-refresh` também ficam sem JWT porque quem chama é o pg_cron.
  Elas se protegem com o header `x-sched-key` (o seu `SCHED_SECRET`).
- `ig-insights` e `ig-media` só respondem pra quem está logado no painel.

## Passo 5: agendar os robôs (pg_cron)

1. Abra `supabase/sql/04_agendamento.sql`.
2. Troque `SEU_PROJETO` pelo id do projeto e `SEU_SCHED_SECRET` pela mesma senha do
   segredo `SCHED_SECRET`.
3. Rode no SQL Editor. Ele liga as extensões `pg_cron` e `pg_net` e agenda:
   - `ig-scheduler` a cada 1 minuto (esvazia a fila e manda os passos com atraso);
   - `ig-token-refresh` toda segunda-feira (renova o token).

Pra conferir: `select * from cron.job_run_details order by start_time desc limit 20;`

## Passo 6: o app no Meta for Developers

1. Em developers.facebook.com, crie um app do tipo **Business** e adicione o produto
   **Instagram** (opção "API setup with Instagram login").
2. Conecte a sua conta **profissional** do Instagram (Business ou Creator).
3. Libere as permissões:
   - `instagram_business_basic`
   - `instagram_business_manage_comments` (ler e responder comentários)
   - `instagram_business_manage_messages` (ler e enviar mensagens)
   - `instagram_business_manage_insights` (métricas do painel)
4. Gere o **token** da conta (ele já sai long-lived, ~60 dias) e anote o **id numérico**
   da conta. Esses viram `IG_ACCESS_TOKEN` e `IG_ACCOUNT_ID`.
5. Copie o **segredo do app do Instagram** (na tela de configuração da API do Instagram).
   Ele vira o `APP_SECRET`.
6. No app do Instagram (celular): **Configurações > Privacidade > Mensagens > Ferramentas
   conectadas**, ligue "Permitir acesso às mensagens".

Volte ao Passo 3 e preencha os segredos com esses valores.

## Passo 7: cadastrar o webhook no Meta

Na configuração de webhooks do produto Instagram:

- **URL de callback:** `https://SEU_PROJETO.supabase.co/functions/v1/instagram-webhook`
- **Token de verificação:** o mesmo `VERIFY_TOKEN` que você inventou.
- Clique em verificar. Depois **assine os TRÊS campos**:
  - `comments`
  - `messages`
  - `messaging_postbacks`: **é ele que faz os botões da conversa funcionarem.** Sem ele,
    a primeira DM chega, mas tocar no botão não faz nada.

> Enquanto o app estiver em modo de desenvolvimento, o Meta só manda eventos de contas
> que têm papel no app (administrador, testador). Adicione a sua conta de teste como
> testadora, ou publique o app.

## Passo 8: colocar o painel no ar

1. Abra `js/config.js` e preencha:
   - `SUPABASE_URL`: em **Project Settings > API** (ex: `https://xxxx.supabase.co`)
   - `SUPABASE_ANON_KEY`: a chave **anon / public** da mesma tela.

   Essas duas podem ficar públicas: quem tranca o banco é o RLS.
   **Nunca** coloque a `service_role` no frontend.
2. Suba a pasta pra qualquer host estático. Exemplo com GitHub Pages: crie um repositório,
   envie os arquivos (só a raiz já basta: `index.html`, `css/`, `js/`), e em
   **Settings > Pages** escolha a branch principal.
3. Abra o endereço publicado e entre com o usuário do Passo 2.

## Passo 9: testar com uma SEGUNDA conta

Comentários feitos pela **própria conta** são ignorados de propósito. Use outra conta:

1. Crie uma automação ligada, com uma palavra (ex: `quero`).
2. Com a segunda conta, comente `quero` num post seu.
3. Ela deve receber a DM com o botão, e o comentário deve ganhar a resposta pública.

Pra testar várias vezes seguidas sem esperar 24h, coloque o id numérico da conta de teste
em `TEST_IG_ACCOUNTS` (vários ids separados por vírgula).

Se algo não chegar, olhe nesta ordem:
- **Edge Functions > instagram-webhook > Logs** (o evento chegou?);
- a tabela `ig_deliveries` (o motivo de cada envio ou erro);
- a tabela `ig_send_queue` (ficou "pendente"? então confira o freio e o pg_cron).

## Passo 10: ligar a trava da assinatura

Com tudo funcionando, troque o segredo `APP_SECRET_ENFORCE` para `true`. A partir daí, o
webhook recusa qualquer requisição que não venha assinada pelo Meta. (Com `false`, uma
assinatura inválida só gera um aviso no log, pra facilitar os primeiros testes.)

---

## Regras e limites (pra não tomar bloqueio)

- **Opt-in sempre:** o sistema só responde quem comentou ou falou com você. Nada de
  disparo em massa, nada de spam, nada de lista comprada.
- **1 DM por pessoa a cada 24h** em gatilho de comentário (contas em `TEST_IG_ACCOUNTS`
  ignoram essa regra).
- **Freio de envio:** no máximo 6 por minuto, 60 por hora e 180 por dia, bem abaixo do
  teto do Instagram (~200 a 300 respostas privadas por dia). O que passar disso espera na
  fila e sai sozinho. Se der 3 bloqueios seguidos, o disjuntor pausa os envios por 3 horas.
  Pra mudar os tetos, edite a linha `private_reply` da tabela `ig_send_budget`.
- **Janela de 24h da Meta:** só dá pra mandar DM pra quem interagiu recentemente. O
  comentário e o toque no botão abrem a janela.
- **Resposta a comentário:** só dá pra mandar UMA mensagem antes da pessoa responder, e só
  por cerca de 7 dias depois do comentário. Por isso: arquivo anexado na Mensagem 1 só
  chega se a pessoa já conversou com você. Pra garantir, mande o arquivo na Mensagem 2.
- **Token:** vale cerca de 60 dias; a renovação semanal cuida disso. Confira a validade na
  tabela `ig_token_status`.
- **Botões:** nome com no máximo 20 caracteres; no máximo 3 botões por mensagem no formato
  anexado. Se o Instagram recusar o formato anexado, o sistema tenta como pílulas (quick
  reply) e, por último, como texto com o link escrito, pra mensagem nunca deixar de chegar.
- **Banco:** cada consulta devolve no máximo 1000 linhas. Se for listar tabelas que crescem
  (leads, envios), pagine.

---

## Como a conversa é guardada (o campo `flow`)

Toda automação guarda a conversa inteira no campo `flow` da tabela `ig_automations`:

```json
{
  "steps": [
    { "id": 1, "message": "Oi! Toca no botão", "buttons": [{ "title": "Quero!", "next": 2 }] },
    { "id": 2, "message": "PDF ou vídeo?", "buttons": [
        { "title": "PDF", "next": 3 },
        { "title": "Vídeo", "url": "https://exemplo.com" }
    ] },
    { "id": 3, "message": "Me passa seu e-mail?", "collect": { "field": "email" } }
  ]
}
```

- A **Mensagem 1 é sempre o primeiro item** de `steps` (o número do `id` não importa).
- Um botão tem `next` (vai pra outra mensagem) **ou** `url` (abre link). Sem nenhum dos
  dois, ele "encerra" e não é enviado.
- "Um link" no editor vira um primeiro passo com um botão `url`. "Continua a conversa" vira
  um botão `next` apontando pra Mensagem 2.
- O botão que avança é enviado com o payload `STEP:idDaAutomacao:proximoPasso`. Como o id
  da automação vai junto, duas automações com o mesmo texto de botão não se misturam.
- Opcionais por passo: `collect` (pede e-mail ou telefone, com validação) e `delay`
  (manda outra mensagem sozinha depois de X segundos).

---

## Checklist: o que você precisa preencher

**No frontend (`js/config.js`, pode ser público):**
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_ANON_KEY`

**Nos segredos das Edge Functions (nunca no frontend):**
- [ ] `IG_ACCESS_TOKEN`: token long-lived do Instagram
- [ ] `IG_ACCOUNT_ID`: id numérico da conta
- [ ] `APP_SECRET`: segredo do app (assinatura do webhook)
- [ ] `APP_SECRET_ENFORCE`: `false` no começo, `true` depois de testar
- [ ] `VERIFY_TOKEN`: uma senha que você inventa (aperto de mão do webhook)
- [ ] `GRAPH_API_VERSION`: ex `v21.0`
- [ ] `SCHED_SECRET`: uma senha que você inventa (protege os robôs)
- [ ] `TEST_IG_ACCOUNTS`: ids das contas de teste, separados por vírgula
- [ ] `SUPABASE_SERVICE_ROLE_KEY`: já vem automático nas funções

**No `04_agendamento.sql`:**
- [ ] `SEU_PROJETO` e `SEU_SCHED_SECRET`

**No `supabase/config.toml`:**
- [ ] `project_id` (ou só rode `supabase link`)

---

## Caixa de entrada com sugestão de resposta (IA)

A aba **💬 Conversas** mostra o direct de cada conta. Quando a cliente escreve, a IA
(Gemini Flash) deixa **uma sugestão** de resposta pronta na caixa de texto. **Nada sai
sozinho:** a mensagem só é enviada quando alguém clica em **Enviar**.

Como funciona:
- O mesmo `instagram-webhook` grava cada mensagem na tabela `mensagens` (cria a conversa
  se não existir) e, uns 4 segundos depois, pede a sugestão. Se ela mandar várias
  mensagens seguidas, sai uma sugestão só, pra última.
- A IA recebe as últimas 20 mensagens + o **roteiro** da conta (tabela `abordagem`).
  Antes de enviar, nome e @ da cliente viram "Cliente", e e-mails e telefones viram
  `[e-mail]` / `[telefone]`.
- Tocar em botão de automação não gera sugestão (a automação já responde).
- O que você responde pelo celular também entra no histórico (eco do Instagram).
- `enviar-resposta` recusa o envio se passou de 24h da última mensagem da cliente.

### Pra ligar

1. **Banco:** rode `supabase/sql/11_conversas.sql` no SQL Editor (cria as tabelas, as
   regras de acesso e liga o Realtime em `mensagens` e `sugestoes`).
2. **Chave do Gemini:** em aistudio.google.com, **Get API key > Create API key**.
3. **Segredos:**
   ```bash
   supabase secrets set GEMINI_API_KEY=SEU_VALOR_AQUI
   # opcional: força um modelo na frente. Sem isso, a fila é montada sozinha:
   # Flash > Flash-Lite > Gemma (o plano gratuito do Flash dá poucas dezenas por dia;
   # quando um modelo estoura a cota, a sugestão sai pelo próximo)
   supabase secrets set GEMINI_MODEL=gemini-flash-latest
   ```
4. **Funções:**
   ```bash
   supabase functions deploy instagram-webhook --no-verify-jwt
   supabase functions deploy enviar-resposta
   ```
5. **Roteiro:** no painel, aba Conversas, botão **Roteiro**: cole o texto de atendimento
   do time (um por conta).
6. **Meta:** nada novo se o webhook já assina `messages`. Confira no Passo 7 e, no app do
   Instagram, se "Permitir acesso às mensagens" está ligado (Passo 6, item 6).

> **Privacidade:** no plano gratuito da API do Gemini, o Google pode usar o conteúdo
> enviado pra melhorar os produtos dele. Por isso os dados pessoais são trocados antes de
> sair. Mesmo assim, não cole dados sensíveis no roteiro. Se precisar de garantia de que
> nada é usado, ative o faturamento no projeto do Google (plano pago).

### Anexos, relatório e repescagem do Direct

Rode `supabase/sql/12_midias_relatorio.sql` no SQL Editor **antes** de publicar as funções
(ele cria as colunas de mídia, a pasta `midias` no Storage e a contagem de atendimentos).
Depois publique:

```bash
supabase functions deploy instagram-webhook --no-verify-jwt
supabase functions deploy enviar-resposta
supabase functions deploy conversas-acoes
```

**Anexos (aba Conversas):** 📎 imagem (PNG, JPG, GIF, até 8 MB), vídeo, áudio (M4A, AAC,
WAV) ou PDF (até 25 MB); 🎤 grava áudio no navegador (vira WAV, até 5 min); 🧡 manda o
coração laranja da marca, sozinho (aparece grande no Direct). Figurinhas não vão pela API:
a única que existe é o coração vermelho do Instagram. Também dá para colar uma
imagem com Ctrl+V na caixa de texto. O arquivo fica na pasta pública `midias` do Storage
(o Instagram precisa de um link público para entregar), com nome aleatório.

**Relatório (aba Relatório):** atendimentos por dia, semana (domingo a sábado), mês e ano.
Cada pessoa conta 1 vez por dia em cada canal; respondida no comentário e no Direct no
mesmo dia conta 2. Entram as automações, o painel, as respostas pelo celular e as respostas
escritas à mão nos comentários. O dia é o de Brasília. O histórico das automações (tabela
`ig_deliveries`) já entra na conta.

**Repescar (aba Conversas):** traz as conversas do Direct dos últimos 7 dias em que a última
mensagem é da cliente. A API não informa se a mensagem foi lida nem a pasta (Principal ou
Geral), então entram todas as sem resposta. Cada uma ganha sugestão ao ser aberta.

**Responder depois de 24h (até 7 dias):** o envio usa a etiqueta `HUMAN_AGENT`, que exige a
permissão **Human Agent** no app. No Meta for Developers: **App Review > Permissions and
Features**, procure **Human Agent**, clique em **Request** e descreva o uso (uma pessoa do time
responde manualmente pelo painel, cada mensagem revisada antes de sair). Enquanto não for
aprovada, o painel avisa ao tentar responder conversas com mais de 24h.

### Calendário de conteúdo

Rode `supabase/sql/13_calendario.sql` no SQL Editor. O menu **Calendário** passa a mostrar o
mês (domingo a sábado) com os conteúdos planejados de cada conta: data (opcional, sem data =
ideia guardada), formato, tema, legenda (até 2.200 caracteres), observações, status (a fazer,
pronto, publicado) e as etapas gravar, editar, legenda e publicado.

- As etapas puxam o status: gravar + editar + legenda = **Pronto**; publicado = **Publicado**.
  Dá para trocar o status na mão (ex.: carrossel sem gravação).
- Arraste um conteúdo para outro dia para mudar a data, ou para "Ideias sem data" para tirar a data.
- Quem tem acesso à conta vê e edita; a tela se atualiza sozinha a cada 30 segundos.

### Excluir conversas

Rode `supabase/sql/14_excluir_conversas.sql` e `16_excluir_tira_do_relatorio.sql`. Conversas **arquivadas** ganham o botão **Excluir**: a conversa, as mensagens e as sugestões saem do painel, e os atendimentos de **Direct** da pessoa saem do Relatório (excluir = conversa pessoal, não de trabalho). Os de comentário ficam. No Instagram ela continua; se a pessoa escrever de novo e for respondida, volta a contar.

### Respostas manuais no Relatório

`supabase/sql/15_atendimento_dm_manual.sql`: toda resposta enviada pela conta no Direct
(painel, celular ou computador) conta como atendimento, inclusive em conversas antigas.
Não contam aqui as mensagens dos robôs (já contam pelos envios das automações) nem a DM de
resposta a comentário (conta como comentário). O histórico importado pela repescagem não
entra no Relatório.

### Comentários mais recorrentes (Análises)

No quadro **Quem mais comenta**, o mesmo botão (**Analisar comentários** / **Atualizar
ranking**) também monta o **Top 10 dos comentários que mais se repetem**, nos mesmos posts.
Maiúsculas, acentos, pontuação e emojis no meio do texto não importam; marcações de amigos
aparecem como "@…" (e só marcação vira "(marcou alguém)").

### Análise das conversas do dia (Relatório)

Rode `supabase/sql/17_analise_conversas.sql`. No **Relatório > Dia**, o botão **Gerar análise**
pede à IA um resumo do dia, as principais **dúvidas**, **objeções** e o **perfil/realidade dos
leads**, a partir das conversas do Direct daquele dia (sem nomes nem dados pessoais). A análise
fica guardada; só o botão gera outra (cada uma gasta 1 pedido da cota gratuita da IA).
