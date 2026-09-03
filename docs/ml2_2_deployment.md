# ML2.2-C — homologação somente no Free Tier

## Estado verificável

Este guia prepara um deploy manual de homologação: Render Web Service **Free**, Render Postgres **Free** e Vercel **Hobby**, sem contratar planos pagos, trials Pro, complementos ou domínio próprio. Se qualquer tela exigir cartão, cobrança ou upgrade, **pare sem confirmar**. Não é possível garantir que a conta do usuário estará elegível sem acessar o dashboard.

ML2.2 continua PARTIAL/BLOCKED quanto à homologação cloud. Nenhum recurso/deploy foi criado na ML2.2-C. O código está no repositório `Eduardo-T-Lino/Quick-grid`, branch `main`; a baseline anterior é `b956149c3d326556f0b0b96f35473fe385009825`. `docs/ml2_2_b_report.md` é histórico da auditoria anterior, não a configuração Free atual. Resultados locais mais recentes ficam em `artifacts/ml22/regression.json`, ignorado pelo Git. ML3, IA, física e gameplay não foram alterados.

## Arquitetura e comandos

- Frontend Vite: Vercel, `npm run build`, saída `dist`.
- Backend Express: Render Web Service Free; build `npm ci`; startup `npm run migrate && npm run server:start`.
- PostgreSQL: acessível somente pelo backend através de `DATABASE_URL`.
- Migration: o primeiro comando do startup. `&&` só executa `server:start` se `migrate` terminar com código zero. Em falha, o processo termina sem iniciar o servidor. Não há migration em paralelo.
- `server/src/server.js` mantém migration automática **somente fora de production**. No Render, `NODE_ENV=production`: fonte única é o startCommand, sem execução duplicada. Cada cold start/restart passa pelo histórico `schema_migrations`; arquivos já aplicados são ignorados. Advisory lock e transação por migration foram preservados.
- Liveness: `GET /health`. Readiness: `GET /ready`, incluindo `SELECT 1`.
- Rate limiter inicial: `SINGLE_INSTANCE_MEMORY`, uma única instância Free; não habilitar scaling nesta homologação.

### Blueprint anterior vs. atual

| Campo | Baseline | ML2.2-C |
| --- | --- | --- |
| Web Service `plan` | Omitido | `free` explícito |
| PostgreSQL `plan` | Omitido | `free` explícito |
| `preDeployCommand` | `npm run migrate` | Removido |
| `startCommand` | `npm run server:start` | `npm run migrate && npm run server:start` |
| `buildCommand` / health | `npm ci` / `/ready` | Preservados |
| Banco / secret / CORS | `fromDatabase` / `generateValue: true` / `sync: false` | Preservados |

O Blueprint não solicita disco persistente, autoscaling, réplicas, alta disponibilidade ou pool gerenciado pago. O pool `pg` da aplicação não é o serviço de pooling pago do provedor. A sintaxe e os campos foram confrontados com a [referência oficial do Blueprint](https://render.com/docs/blueprint-spec); não deixar o dashboard substituir `free` por defaults pagos.

## Variáveis

Render: `NODE_ENV=production`, `DATABASE_URL`, `INGEST_TOKEN_SECRET`, `CORS_ALLOWED_ORIGINS` e `PORT` fornecida pela plataforma. Pool padrão: máximo 10, idle 30 s, conexão 5 s. Body JSON: 256 KB.

Vercel production: apenas `VITE_TELEMETRY_API_URL` e `VITE_DEPLOY_ENV=production`. Preview permanece sem upload online. Nunca criar `VITE_DATABASE_URL` ou expor o segredo de ingestão.

## Ordem de deploy e dependência de CORS

**Não deixar `CORS_ALLOWED_ORIGINS` vazio para depois esperar um backend saudável.** O código de produção rejeita esse caso. Além disso, `sync: false` solicita o valor ao criar o Blueprint, não significa “opcional”. Não usar `*`, domínio inventado ou segredo de exemplo para contornar isso. [Render: variáveis de Blueprint](https://render.com/docs/blueprint-spec#prompting-for-secret-values).

Para um projeto sem nenhuma URL, fazer uma preparação **P** na Vercel com telemetria OFF para obter uma origem real. Depois seguir A–F:

| Etapa | Ação manual |
| --- | --- |
| P | Criar frontend Vercel Hobby com ambas as variáveis VITE de telemetria ausentes; copiar domínio Production real. |
| A | Criar backend + PostgreSQL no Render Free, informando esse domínio real no CORS. |
| B | Copiar URL pública real do serviço Render. |
| C | Configurar as duas variáveis públicas na Vercel, somente em Production, e redeployar frontend. |
| D | Copiar/conferir o domínio Production atribuído pela Vercel, não a URL temporária de Preview. |
| E | Conferir/ajustar `CORS_ALLOWED_ORIGINS` no Render para a origem exata obtida. |
| F | Se mudou CORS, salvar e redeployar backend; repetir health/readiness e CORS. |

Se já existe um frontend com domínio Production real conhecido, pular P. A publicação inicial OFF é necessária apenas para resolver a dependência entre URLs; não cria telemetria nem exige mudança no backend. É possível começar por **New > Blueprint** no Render, mas parar na tela de CORS até terminar P.

## Vercel — preparação P e configuração final C

1. Entrar em [vercel.com](https://vercel.com/) e fazer login com GitHub. Selecionar a conta pessoal/Hobby gratuita, **não Pro nem Pro Trial**. Hobby destina-se a uso pessoal não comercial; confirmar que esta homologação se enquadra. [Plano Hobby](https://vercel.com/docs/plans/hobby).
2. No dashboard, **Add New… > Project**. Em **Import Git Repository**, localizar `Eduardo-T-Lino/Quick-grid` e clicar **Import**. Se não aparecer, autorizar esse repositório na integração GitHub.
3. Project Name: `quick-grid` se disponível; se a conta exigir outro nome, usar o nome escolhido no dashboard e copiar a URL retornada, nunca deduzir o domínio.
4. Framework Preset: **Vite**. Root Directory: raiz do repositório (`./`). Build Command: **`npm run build`**. Output Directory: **`dist`**. Install Command: **`npm ci`**. Não definir `NODE_ENV=test`.
5. Na preparação P, **não cadastrar `VITE_DEPLOY_ENV` nem `VITE_TELEMETRY_API_URL`**. Sem `VITE_DEPLOY_ENV=production`, o guard existente mantém o uploader OFF no domínio hospedado. Não importar `.env.example` em lote. Clicar **Deploy** somente após conferir Hobby/sem cobrança.
6. Depois de **Ready**, copiar a origem HTTPS do domínio listado como **Production**. Em **Project Settings > Git**, confirmar Production Branch **`main`**. Esse domínio real será usado no Render.
7. Depois de obter a URL Render na etapa B, ir a **Project Settings > Environment Variables** e adicionar a tabela abaixo. Selecionar **somente Production**, desmarcando Preview e Development.

| Nome público | Valor na etapa C |
| --- | --- |
| `VITE_TELEMETRY_API_URL` | URL HTTPS exata copiada do Render, sem barra final e sem `/api/v1/telemetry` |
| `VITE_DEPLOY_ENV` | `production` |

8. Em **Deployments**, abrir o menu do último deployment Production de `main`, clicar **Redeploy** e aguardar **Ready**. Variáveis Vite são incorporadas no build; mudar apenas o dashboard não altera o bundle publicado.
9. Preview: manter essas variáveis ausentes (especialmente não definir `VITE_DEPLOY_ENV=production`). Não promover um bundle Preview com configuração diferente como substituto do rebuild Production.

Este fluxo segue a [importação de projetos Vercel](https://vercel.com/docs/getting-started-with-vercel) e o [suporte a Vite](https://vercel.com/docs/frameworks/frontend/vite). Escopos e novas publicações após mudança de configuração estão descritos em [Environment Variables](https://vercel.com/docs/environment-variables). Nenhuma dessas ações foi executada nesta tarefa.

## Render — etapas A/B, E/F

1. Entrar em [render.com](https://render.com/) e fazer login com GitHub, em workspace gratuito. Não adicionar cartão ou aceitar upgrade.
2. No dashboard: **New > Blueprint**.
3. Conectar `Eduardo-T-Lino/Quick-grid` (autorizar esse repositório no GitHub se necessário).
4. Blueprint Name: `quick-grid-ml22-free`. Branch: **`main`**. Blueprint Path: **`render.yaml`**, na raiz.
5. Conferir recursos e campos na tabela abaixo. Os dois planos devem aparecer **Free**, com custo zero. Não criar Blueprint duplicado se recursos com esses nomes já existirem. Um workspace só admite um PostgreSQL Free; se esse limite impedir a criação, parar, sem apagar banco existente nem escolher plano pago.

| Recurso / campo | Valor esperado |
| --- | --- |
| Web Service | `quick-grid-telemetry-api` |
| Runtime / plan | Node / Free |
| Build Command | `npm ci` |
| Start Command | `npm run migrate && npm run server:start` |
| Health Check Path | `/ready` |
| PostgreSQL / plan | `quick-grid-telemetry-db` / Free |
| Database / user | `quick_grid_telemetry` / `quick_grid` |
| `NODE_ENV` | `production`, vindo do Blueprint |
| `DATABASE_URL` | Referência automática ao banco; não colar/publicar credenciais |
| `INGEST_TOKEN_SECRET` | Gerado pelo Render; não substituir por texto do exemplo |
| `CORS_ALLOWED_ORIGINS` | Origem HTTPS Production real copiada da Vercel na preparação P, sem caminho ou barra final |

6. Preencher CORS no campo solicitado. Se ainda não há origem real, **não clicar Deploy Blueprint**: executar P e voltar. Não é necessário revelar o secret gerado nem a connection string.
7. Com os planos Free e o CORS correto, clicar **Deploy Blueprint**. Observar Events/Logs: migration termina primeiro; só então servidor inicia. [Fluxo oficial Blueprint](https://render.com/docs/infrastructure-as-code).
8. Abrir `quick-grid-telemetry-api` e copiar a URL pública exibida pelo Render. Não derivar URL pelo nome do serviço. Usá-la na etapa C da Vercel.
9. Se precisar corrigir CORS depois: serviço **Environment > Edit**, alterar a origem para o domínio real da etapa D e usar **Save, rebuild, and deploy**. Se a tela oferecer apenas salvar, usar depois **Manual Deploy > Deploy latest commit**. Não habilitar wildcard ou domínios Preview. [Render: ambiente](https://render.com/docs/configure-environment-variables), [deploy manual](https://render.com/docs/deploys).
10. Na URL pública copiada, consultar `/health` e `/ready`: esperar HTTP 200; health deve indicar `environment: production` e `storage: postgresql`, ready deve indicar `database: postgresql`. Se migration, CORS ou banco falharem, corrigir a causa; nunca trocar para memória em produção.

## Validação local do startup Free

`npm run test:render-free` audita os campos do Blueprint e executa **o comando exato extraído de `render.yaml`**, com ambiente isolado e sem credenciais reais. Casos: `DATABASE_URL` ausente e conexão PostgreSQL interrompida por endpoint TCP exclusivamente local. Exige saída não zero, execução do migrator e ausência de `server:start`/listener. Não inicia migration e servidor em paralelo.

`npm run test:ml22:gate` repete as sete suítes anteriores, a nova suíte Free e o build Production; para na primeira falha. O teste de contrato não é um parser YAML completo; a auditoria adicional usa YAML e o [JSON Schema oficial do Render](https://render.com/schema/render.yaml.json). A aceitação do dashboard ainda deve ser conferida pelo usuário antes de criar recursos.

Validação de 03/09/2026: **239 testes aprovados, zero falhas e build aprovado** (219 verificações anteriores + 20 do startup Free). YAML lido sem chaves duplicadas e validado contra o schema oficial, com zero erros. Evidências locais, não publicadas: `artifacts/ml22/regression.json` e `artifacts/blueprint-validation/result.json`.

Não há PostgreSQL real configurado neste ambiente. O caminho de falha foi comprovado localmente; sucesso de migrations/transações, startup saudável e locks em PostgreSQL real **continuam pendentes**. Para rodar o comando manual em PowerShell 7 ou shell Linux, usar `npm run migrate && npm run server:start`; no Windows PowerShell 5, usar um terminal PowerShell 7 ou `cmd /d /c "npm run migrate && npm run server:start"`, nunca `;` como substituto de `&&`.

## Lifecycle de sessão e reload

Ao criar a sessão, o servidor emite um ingest token curto e uma refresh credential separada, ambos escopados à sessão e assinados. IndexedDB guarda batches pendentes e a autoridade necessária para a mesma sessão (`serverSessionId`, sequência seguinte, ingest token e refresh credential). No reload, a fila e a autoridade são restauradas antes do worker. O endpoint de refresh rejeita sessionId sozinho e credenciais alteradas.

Ao finalizar, o buffer parcial é selado. Se a fila não drenar no timeout, a sessão fica `FINALIZATION_PENDING` e continua `ACTIVE` no servidor. Após o último ACK, o cliente tenta completar. Uma falha no `complete` preserva a autoridade para nova tentativa.

Retirar consentimento interrompe coleta/upload e apaga fila e credenciais locais pendentes. O jogo permanece utilizável.

## Capacidade inicial

Estimativa baseada em corrida humana nova: PENDENTE. O benchmark antigo usa arquivo local legado e NÃO homologa armazenamento de produção. Esse arquivo não foi importado para produção.

Para a estimativa futura: 10 Hz / 50 amostras = 720 batches/hora. Medir os bytes médios reais do payload GZIP e o espaço total das tabelas/índices. Multiplicar o custo medido por 1, 100, 1.000 e 10.000 horas-jogador. Não atribuir um percentual de overhead como se tivesse sido medido.

## Limites da evidência local ML2.2-B

`npm run test:ml22:gate` executa as suítes em processos isolados com banco em memória, registra contagens/durações e para na primeira falha. O relatório inclui o HEAD anterior ao commit da alteração e um hash das fontes/testes/manifests efetivamente testados. Não substitui testes de transação/migration contra PostgreSQL nem reload de IndexedDB no navegador.

O reload restaura credenciais, sequência, resumos de volta pendentes e intenção de conclusão. A corrida interrompida é drenada/finalizada antes de iniciar outra sessão online. Se a recuperação anterior não terminar, a nova corrida permanece jogável, mas a coleta online dessa corrida fica pausada. Não substituir autoridade antiga por um token de outra sessão.

A criação da sessão é compartilhada entre chamadas concorrentes. Batches coletados durante a criação preservam suas sequências; o encerramento nesse intervalo também espera o ACK. Revogar consentimento cancela temporizadores/requisições e remove dados online pendentes; requisições já processadas no servidor não podem ser desfeitas por abortar o navegador. A remoção física em IndexedDB real ainda precisa ser comprovada.

O resumo de volta usa ID anônimo, tempo em segundos, velocidades nas unidades internas do schema e contagem de amostras com flags de eventos (não número de episódios distintos). `validLap` exige ausência dessas flags. Essa definição ainda precisa ser homologada na volta humana.

FPS agora usa intervalos RAF; CPU do frame e latência HTTP são separados. A métrica `uploaderMainThread` cobre serialização/contagem UTF-8, não todo o trabalho assíncrono de fila/IndexedDB. `wireKBPerMinute` é indisponível até existir trace de rede real. Não usar o microbenchmark Node como medição de FPS ou aprovação de p95 < 1 ms.

## Limites do Free Tier — não é storage permanente

O Blueprint declara Free nos dois recursos; nenhuma contratação foi realizada. O banco é **somente de homologação**, não armazenamento permanente do dataset futuro. Postgres Free tem **1 GB**, **expira após 30 dias** e **não tem backups**. Não depender dele para conservar dataset. Somente sessões novas da geometria homologada; não importar o JSONL legado. [Limites Render Free](https://render.com/docs/free).

Web Free pode dormir após **15 minutos sem tráfego**; a primeira requisição pode sofrer cold start de aproximadamente um minuto. Timeout/erro de rede/5xx durante esse intervalo são recuperáveis pelo pipeline existente (retry, backoff e persistência de batches). Não classificar cold start como corrupção de dados nem ampliar a fila sem limite. A recuperação efetiva depois do sleep ainda deve ser testada no Render; o código do uploader não foi alterado aqui. Há limites de horas, bandwidth e builds; conferir franquias da conta e interromper a homologação se esgotadas, sem upgrade automático. [Render Free](https://render.com/docs/free).

## Retenção e recuperação

- Telemetria RAW: reter enquanto houver finalidade de dataset e consentimento válido.
- Dados inválidos/corrompidos: remover após auditoria.
- Geometria legada incompatível: não usar em dataset futuro.
- Purge automático não está habilitado; definir prazo antes de crescimento público.
- Não há backup/PITR no banco Free. Definir retenção e exportação segura dos dados novos de homologação antes da expiração; essa política não foi implementada automaticamente. Sem cópia externa válida, perda/expiração do banco implica perda de dados.

## Checklist de homologação cloud pendente

1. Seguir a preparação P (se necessária) e criar PostgreSQL/backend Free no Render pelo `render.yaml`, já com origem CORS real; confirmar migration e `/health` + `/ready`.
2. Concluir C–F na Vercel/Render: URL pública do backend, rebuild Production e conferência da origem CORS exata.
3. Consent OFF: confirmar zero sessões. Consent ON: corrida curta de 50 samples e uma volta real.
4. Conferir contadores client/server, laps, status COMPLETED e IndexedDB vazio.
5. Executar offline/reload, TTL curto, resposta perdida e descompressão de um BYTEA real.
6. Medir no navegador por alguns minutos em OFF, local e online usando `getMLPerformanceMetrics()`; resetar entre cenários com `resetMLPerformanceMetrics()`.
7. Registrar URLs, logs, plano/limites, números reais e primeiro registro PostgreSQL. Só então declarar ML2.2 concluída.
