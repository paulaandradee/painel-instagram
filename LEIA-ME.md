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

### Anexos e relatório

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

## Acesso só de visualização

Rode `supabase/sql/18_somente_leitura.sql`. Em **Contas e acessos > Acessos** (ou ao adicionar
uma pessoa), marque **Só visualização**: a pessoa vê tudo das contas liberadas pra ela
(automações, leads, conversas, roteiro, relatório, análises, calendário e os atalhos do menu),
mas não cria, edita, envia, arquiva nem apaga nada. Quem barra de verdade é o banco: as regras
de gravar usam `contas_que_edito()`, que deixa de fora quem está em `painel_leitores`; as
funções `enviar-resposta`, `conversas-acoes` e `ig-repescagem` também recusam. Administradora
nunca fica só na visualização.

## Ritmo seguro (aviso de "suspeita de automação", 22/10)

Rode `supabase/sql/19_ritmo_seguro.sql`. O freio passou para **2 DMs por minuto, 20 por hora e
100 por dia** por conta; o que passar disso espera na fila e sai aos poucos, com 8 a 25 segundos
sorteados entre um envio e outro. Erro claro do Instagram é tentado no máximo 2 vezes; erro
ambíguo nunca é repetido. A resposta pública sorteia entre a original e 6 variações. A
repescagem (comentários e Direct) fica desligada no servidor; só volta com o segredo
`REPESCAGEM=ligada` no Supabase.

## Caixas da aba Conversas

Rode `supabase/sql/20_caixas_conversas.sql`. A aba tem três caixas, com a quantidade em cada:
**Aguardando**, **Respondidas** e **Arquivadas**. Respondeu (pelo painel, celular ou robô): vai
para Respondidas. Arquivou: vai para Arquivadas e fica lá mesmo se sair resposta. Só volta para
Aguardando quando a cliente manda mensagem nova. Desarquivar leva para Aguardando se a última
mensagem é da cliente; senão, para Respondidas.

**Família e "✓ Respondida"** (rode `supabase/sql/21_caixa_familia.sql`): há uma quarta caixa,
**Família**, para família, amigos e contatos pessoais. Conversa marcada como Família fica lá
mesmo quando a pessoa escreve de novo, e a IA não gera sugestão automática para ela. "Tirar de
Família" devolve a conversa para a caixa normal. Em Aguardando, o botão **✓ Respondida** marca
a conversa como respondida sem enviar nada (por exemplo, quando a automação já respondeu). Ela
volta para Aguardando só se a pessoa escrever de novo. No computador, o painel já abre a
próxima conversa da lista.

## Minha Formação (só a administradora)

Rode `supabase/sql/22_formacao.sql`. Ele cria as tabelas `formacao_modulos`, `formacao_cursos`
e `formacao_sessoes` e o armazenamento privado `formacao`, onde ficam os certificados. Cada
linha tem dona e só ela vê; quem não é administradora não vê nada, nem no Calendário. Os
cursos, links e o cronograma **não ficam no repositório**: são cadastrados direto no banco.

- **Menu "Formação Sebrae"**: progresso, próxima sessão, sessões que passaram sem registro,
  práticas pendentes e os 6 módulos. Cada curso tem Visão geral, Anotações, Exercícios,
  Aplicação prática e Certificado, e salva sozinho enquanto você escreve.
- **Progresso**: média de 4 partes que só mudam quando você confirma: sessões feitas, cursos
  concluídos, certificados recebidos e práticas entregues. O tempo que passou não conta.
- **Calendário**: as sessões aparecem em lilás, com o filtro Tudo / Conteúdos / Estudos.
  Clique para abrir; arraste para outro dia para remarcar (o curso continua ligado).
- **Início**: cartão com módulo atual, curso, próxima aula e prática pendente.

Também cria `ig_contas.recursos` (vazio). Os próximos recursos (Produção, Drive...) serão
ligados só nas contas que tiverem o nome deles nessa lista.

## Ficha de conteúdo, tarefas e campanhas (contas com Produção)

Rode `supabase/sql/23_ficha_conteudo.sql`. Só as contas com `producao` em `ig_contas.recursos`
usam isso (hoje, só @tudoserestaura). As outras seguem com o formulário simples, sem mudança.

- **Ficha** (clique num conteúdo): Visão Geral, Roteiro, Produção (tarefas), Arquivos (link da
  pasta do Drive), Aprovação (enviar, aprovar, pedir ajustes e comentários), Métricas (o post
  do Instagram é escolhido por você, nunca pela data) e Histórico. O histórico é escrito pelo
  banco: quem mudou o quê e quando.
- **Calendário**: visões Mês, Semana, Dia e Lista; filtros Tudo, Conteúdos, Estudos, Gravações,
  Edições, Aprovações, Campanhas e Compromissos. Arrastar muda a data do conteúdo ou da tarefa
  (as tarefas do conteúdo não mudam juntas). Clicar no número do dia abre o dia.
- **Compromissos**: botão "Compromisso" cria uma tarefa fora de um conteúdo.
- Mudar uma data no painel nunca mexe em nada já agendado na Meta.

## Produção de Conteúdo (Kanban)

Menu "Produção", só para quem tem acesso a uma conta com o recurso `producao`. Seis colunas
agrupam as 18 etapas: Ideia e planejamento, Roteiro, Gravação, Edição, Aprovação e
Publicação. Arrastar para outra coluna põe o conteúdo na primeira etapa dela; a etapa exata
se escolhe no próprio cartão. É o mesmo registro da ficha e do Calendário, e o histórico anota
quem mudou. O cartão mostra tarefas feitas, atrasadas (borda vermelha), campanha e
responsáveis. Filtros: busca, conta, campanha e "Em andamento" / "Com finalizados".

## Relatórios de desempenho (contas com o recurso `relatorios`)

Rode `supabase/sql/24_relatorios.sql` e publique a função `ig-relatorios` com `--no-verify-jwt`
(ela confere a chave do robô ou o login). O agendamento `ig-relatorios` (todo dia 09:15 UTC =
06h15 de Brasília) foi criado copiando o comando do `ig-scheduler`, com a mesma `x-sched-key`.

- **Todo dia**: guarda os seguidores do dia (a Meta não dá o número do passado), o alcance e
  os novos seguidores por dia e as métricas dos posts dos últimos 45 dias. Cada coleta fica
  em `coletas`; se falhar, a aba avisa.
- **Segunda**: relatório semanal da semana anterior (segunda a domingo). **Dia 1º**: mensal do
  mês anterior. Ficam salvos, com histórico, e não precisam do painel aberto.
- **Painel**: Instagram › Relatório › Desempenho. Totais com comparação ao período anterior,
  seguidores, alcance por dia, melhores conteúdos, autoral × remix (pela ficha ligada ao post),
  por formato, sugestões da IA (marcadas) e limitações. Exporta CSV e imprime/salva PDF.
  "Gerar: semana passada / mês passado" refaz na hora.
- **Limitações da Meta**: para Reels a API não dá seguidores por post nem visitas ao perfil;
  retenção detalhada não é liberada; crescimento líquido só existe a partir da primeira coleta
  (antes disso, só os novos seguidores, sem descontar quem saiu).
- Refazer um período pela chave do robô: corpo `{"gerar":{"tipo":"mensal","inicio":"2026-10-01","fim":"2026-10-31"}}`.

## Google Drive (contas com o recurso `drive`)

Rode `supabase/sql/25_drive.sql` e publique a função `drive` com `--no-verify-jwt` (a volta do
Google não tem login do painel; as outras ações conferem o login).

**Configurar o Google (uma vez):**
1. Em https://console.cloud.google.com, entre com a conta Google que vai guardar os arquivos e
   crie um projeto (ex.: "Seu Painel").
2. APIs e serviços › Biblioteca › **Google Drive API** › Ativar.
3. Google Auth Platform (Tela de consentimento OAuth): nome do app, e-mail de suporte,
   público **Externo**. Em Acesso a dados, adicione o escopo `.../auth/drive.file`.
   Em Público-alvo, clique em **Publicar app** (fica "Em produção"). Em "Teste" o Google
   corta a conexão a cada 7 dias.
4. Clientes › Criar cliente › **Aplicativo da Web**. Em "URIs de redirecionamento
   autorizados" coloque exatamente:
   `https://lllcdkwkvqbszdawzhua.supabase.co/functions/v1/drive/callback`
5. Copie o ID do cliente e a chave secreta para os secrets do Supabase (Edge Functions ›
   Secrets): `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. Não cole em lugar nenhum além disso.
6. No painel: Drive e Arquivos › **Conectar Google Drive**. Depois, "Criar as pastas que faltam".

**Como funciona:** permissão `drive.file`: o painel só enxerga o que ele mesmo criou. Pastas:
CLIENTES SOCIAL MEDIA › conta › ano › mês › "DD-MM - Título" › 01 Briefing e Roteiro, 02
Gravações, 03 Edição, 04 Aprovados, 05 Publicados (ideias sem data em "Ideias sem data").
Cada pasta fica guardada pelo ID (`drive_pastas`): não duplica, e mudar a data ou o título
renomeia ou move a pasta. O arquivo vai direto do navegador para o Google (até 2 GB), com
nome de versão (Video_Bruto_01, Video_Edicao_V01, Video_Final_Aprovado...) e fica em
`arquivos`. Nada fica público. O espaço é o do Google Drive da conta (15 GB grátis, dividido
com Gmail e Fotos).

## Papéis na Produção: expert e editor(a)

Rode `supabase/sql/26_colaboradores.sql` e publique `painel-admin` e `drive`. Em Contas e
acessos, cada pessoa pode ter, em cada conta com Produção, o papel **Expert / cliente** ou
**Editor(a) de vídeo**. Esses papéis ficam na tabela `colaboradores`, **não** em `ig_membros`:
quem colabora nunca vê DMs, leads, conversas, automações, Drive geral nem a Formação.

- **Expert**: vê calendário, conteúdos, roteiros, tarefas e campanha da conta dela; marca
  "gravando"/"gravado", aprova ou pede ajustes, muda o status das tarefas DELA, comenta e envia
  arquivos em 02 - Gravações. Relatórios de desempenho só se marcar "vê os relatórios".
- **Editor(a)**: vê só os conteúdos em que é responsável pela edição ou tem tarefa; marca "em
  edição"/"editado", envia para aprovação, muda o status das tarefas dele(a), comenta e envia em
  03 - Edição e 04 - Aprovados.
- Ninguém dos dois cria ou apaga conteúdo, muda data, roteiro, responsáveis ou estratégia. Quem
  barra é o banco: políticas e os gatilhos `conteudos_limite_colaborador` e
  `tarefas_limite_colaborador` (só a etapa do papel e o status/notas da tarefa).
- No Início, todo mundo com Produção vê **Minhas tarefas** (atrasadas e próximos 14 dias), com
  "✓ Feita" (pensado para o celular).
- O acesso "Só visualização" (painel_leitores) continua igual.

## Estratégia Editorial, Laboratório e Portfólio

Rode `supabase/sql/27_estrategia_lab_portfolio.sql`. Os dados do Tudo se Restaura (estratégia,
experimentos A a D e o estudo de caso) foram cadastrados direto no banco, fora do repositório.

- **Estratégia Editorial** (contas com Produção; a expert só lê, o editor não vê):
  posicionamento, público, tom de voz, perfil (bio proposta × aplicada, destaques, fixados),
  pilares com meta de distribuição comparada ao que está planejado no Calendário no mês,
  meta autoral × remix, identidade visual DO INSTAGRAM (não muda o painel), diagnóstico
  inicial dos prints comparado com o relatório mensal da Meta, e campanhas. Cada bloco tem
  "Editar". Os pilares cadastrados aqui viram as sugestões do campo Pilar da ficha.
- **Laboratório** (só a equipe): experimentos com objetivo, hipótese, período, métrica e forma
  de comparar (autoral × remix, formato, campanha × demais, grupos A/B). Os números vêm das
  métricas dos posts ligados às fichas; sem post ligado, sem número. Resultado, interpretação e
  conclusão são escritos por você ("Copiar para o resultado" só cola os números).
- **Portfólio** (só a administradora): estudo de caso em 15 seções. Cada uma tem o seu texto
  (salva sozinho) e, quando existe, um quadro "Do painel" com dados reais: diagnóstico,
  autoria dos conteúdos (produção própria, remix, curadoria, terceiros, IA), campanhas,
  automações, relatórios mensais, experimentos e a Formação aplicada (cursos e competências).
  Imprimir / PDF gera a versão limpa.

## Automação por resposta ao story (contas com o recurso `stories`)
Rode o `28_automacao_stories.sql`. No editor da automação aparece "Quando a pessoa: Comenta no post / Responde ao story".
- **Responde ao story**: a pessoa responde um story com a palavra (ou qualquer coisa, se "Qualquer palavra ativa") e recebe a Mensagem 1 no direct. Os botões, a conversa e os arquivos funcionam como sempre.
- A resposta ao story chega como mensagem do direct, então a automação responde por DM normal (pelo id da pessoa). Não há resposta pública, porque story não tem comentário.
- "Em quais stories": sem escolher nada, vale para todos os stories, inclusive os próximos. O Instagram só lista os stories no ar (últimas 24h), e um story escolhido vale só para ele.
- Mesmas proteções do comentário: **1 DM de automação por pessoa a cada 24h** (comentário e story contam juntos) e o **mesmo freio da conta** (os tetos não mudaram). Na fila, o envio de story expira em 24h.
- Quando a automação responde, a IA não gera sugestão para aquela mensagem. A conversa continua na caixa de entrada.
- Liga em outra conta: `update ig_contas set recursos = array_append(recursos, 'stories') where username = '...';`
- Deploy: `instagram-webhook` e `ig-scheduler` (`--no-verify-jwt`), `ig-media`, `ig-repescagem`.
