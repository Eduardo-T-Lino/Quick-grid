# ML2.2 — production hardening e deployment

## Estado verificável

ML2.2 = PARTIAL/BLOCKED. Há implementação e regressão locais, mas não há homologação de PostgreSQL, deploys nem E2E humano. Ver `docs/ml2_2_b_report.md` e `artifacts/ml22/regression.json` para a auditoria atual. Não considerar este documento prova de produção.

## Arquitetura e comandos

- Frontend Vite: Vercel, `npm run build`, saída `dist`.
- Backend Express: Render Web Service, `npm run server:start`.
- PostgreSQL: acessível somente pelo backend através de `DATABASE_URL`.
- Migration: `npm run migrate` como pre-deploy command. `schema_migrations` registra cada arquivo; advisory lock evita execução concorrente.
- Liveness: `GET /health`. Readiness: `GET /ready`, incluindo `SELECT 1`.
- Rate limiter inicial: `SINGLE_INSTANCE_MEMORY`. Antes de scale-out, substituir por armazenamento compartilhado.

## Variáveis

Render: `NODE_ENV=production`, `DATABASE_URL`, `INGEST_TOKEN_SECRET`, `CORS_ALLOWED_ORIGINS` e `PORT` fornecida pela plataforma. Pool padrão: máximo 10, idle 30 s, conexão 5 s. Body JSON: 256 KB.

Vercel production: apenas `VITE_TELEMETRY_API_URL` e `VITE_DEPLOY_ENV=production`. Preview permanece sem upload online. Nunca criar `VITE_DATABASE_URL` ou expor o segredo de ingestão.

## Lifecycle de sessão e reload

Ao criar a sessão, o servidor emite um ingest token curto e uma refresh credential separada, ambos escopados à sessão e assinados. IndexedDB guarda batches pendentes e a autoridade necessária para a mesma sessão (`serverSessionId`, sequência seguinte, ingest token e refresh credential). No reload, a fila e a autoridade são restauradas antes do worker. O endpoint de refresh rejeita sessionId sozinho e credenciais alteradas.

Ao finalizar, o buffer parcial é selado. Se a fila não drenar no timeout, a sessão fica `FINALIZATION_PENDING` e continua `ACTIVE` no servidor. Após o último ACK, o cliente tenta completar. Uma falha no `complete` preserva a autoridade para nova tentativa.

Retirar consentimento interrompe coleta/upload e apaga fila e credenciais locais pendentes. O jogo permanece utilizável.

## Capacidade inicial

Estimativa baseada em corrida humana nova: PENDENTE. O benchmark antigo usa arquivo local legado e NÃO homologa armazenamento de produção. Esse arquivo não foi importado para produção.

Para a estimativa futura: 10 Hz / 50 amostras = 720 batches/hora. Medir os bytes médios reais do payload GZIP e o espaço total das tabelas/índices. Multiplicar o custo medido por 1, 100, 1.000 e 10.000 horas-jogador. Não atribuir um percentual de overhead como se tivesse sido medido.

## Limites da evidência local ML2.2-B

`npm run test:ml22:gate` executa as suítes em processos isolados com banco em memória, registra contagens/durações e para na primeira falha. O relatório inclui um hash de fontes/testes/manifests; nesta pasta não existe HEAD Git. Não substitui testes de transação/migration contra PostgreSQL nem reload de IndexedDB no navegador.

O reload restaura credenciais, sequência, resumos de volta pendentes e intenção de conclusão. A corrida interrompida é drenada/finalizada antes de iniciar outra sessão online. Se a recuperação anterior não terminar, a nova corrida permanece jogável, mas a coleta online dessa corrida fica pausada. Não substituir autoridade antiga por um token de outra sessão.

A criação da sessão é compartilhada entre chamadas concorrentes. Batches coletados durante a criação preservam suas sequências; o encerramento nesse intervalo também espera o ACK. Revogar consentimento cancela temporizadores/requisições e remove dados online pendentes; requisições já processadas no servidor não podem ser desfeitas por abortar o navegador. A remoção física em IndexedDB real ainda precisa ser comprovada.

O resumo de volta usa ID anônimo, tempo em segundos, velocidades nas unidades internas do schema e contagem de amostras com flags de eventos (não número de episódios distintos). `validLap` exige ausência dessas flags. Essa definição ainda precisa ser homologada na volta humana.

FPS agora usa intervalos RAF; CPU do frame e latência HTTP são separados. A métrica `uploaderMainThread` cobre serialização/contagem UTF-8, não todo o trabalho assíncrono de fila/IndexedDB. `wireKBPerMinute` é indisponível até existir trace de rede real. Não usar o microbenchmark Node como medição de FPS ou aprovação de p95 < 1 ms.

## Escolha do plano ainda necessária

Nenhum plano foi contratado/selecionado nesta execução. O `preDeployCommand` existente exige serviço pago no Render; não escolher custo automaticamente. [Documentação de deploy](https://render.com/docs/deploys).

Como referência, não como plano contratado: o PostgreSQL Free oferece 1 GB, expira em 30 dias e não oferece backups. Web Free suspende após 15 minutos sem tráfego e pode levar aproximadamente um minuto para acordar. Limites efetivos de bandwidth/pipeline dependem do workspace. [Limitações Free](https://render.com/docs/free). Para plano pago, registrar retenção e recuperação efetivamente disponíveis antes do go-live. [Backups PostgreSQL](https://render.com/docs/postgresql-backups).

## Retenção e recuperação

- Telemetria RAW: reter enquanto houver finalidade de dataset e consentimento válido.
- Dados inválidos/corrompidos: remover após auditoria.
- Geometria legada incompatível: não usar em dataset futuro.
- Purge automático não está habilitado; definir prazo antes de crescimento público.
- A proteção contra perda depende dos backups/PITR contratados para o PostgreSQL. Verificar e registrar a política efetiva do plano escolhido antes do go-live; sem backup externo, perda do banco implica perda definitiva da telemetria.

## Checklist de homologação cloud pendente

1. Criar PostgreSQL e backend no Render pelo `render.yaml`; confirmar migration e `/health` + `/ready`.
2. Criar frontend no Vercel; configurar URL pública do backend e origem CORS exata.
3. Consent OFF: confirmar zero sessões. Consent ON: corrida curta de 50 samples e uma volta real.
4. Conferir contadores client/server, laps, status COMPLETED e IndexedDB vazio.
5. Executar offline/reload, TTL curto, resposta perdida e descompressão de um BYTEA real.
6. Medir no navegador por alguns minutos em OFF, local e online usando `getMLPerformanceMetrics()`; resetar entre cenários com `resetMLPerformanceMetrics()`.
7. Registrar URLs, logs, plano/limites, números reais e primeiro registro PostgreSQL. Só então declarar ML2.2 concluída.
