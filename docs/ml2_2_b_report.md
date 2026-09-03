# ML2.2-B — relatório de verificação

STATUS: **PARTIAL/BLOCKED — NÃO CONCLUÍDA / NÃO HOMOLOGADA**.

Auditoria em 03/09/2026. A última regressão local começou às 16:03:57 UTC (13:03:57 America/Sao_Paulo). Nenhum deploy, recurso cloud, plano pago ou importação para produção foi realizado nesta execução. ML3 não foi iniciada.

## Evidência e limites

Resultado estruturado: `artifacts/ml22/regression.json`. Logs sanitizados: `artifacts/ml22/suite-1.log` até `suite-8.log`.

A pasta não é um repositório Git: `git rev-parse` retornou “not a git repository”. Portanto, não há HEAD/commit/push a declarar. O snapshot de 60 arquivos de fontes, testes e manifests ficou inalterado durante a execução; SHA-256: `fc70804447e7e47f179d5c0bafd10ec05b4d94e44c6dcf99c04abb04cdd8098f`. O hash não inclui docs, assets, build ou dataset.

Não foram encontradas credenciais configuradas de deploy Render/Vercel nem `DATABASE_URL` neste processo. Só a presença/ausência foi consultada; valores secretos não foram exibidos. CLIs de Render, Vercel e PostgreSQL não estavam disponíveis; Docker estava instalado, mas sem daemon acessível. Não foi identificado repositório remoto do Quick-grid para o deploy. URLs de produção NÃO foram inferidas.

Sem PostgreSQL conectado, todas as suítes desta execução usam storage de servidor em memória. Os testes de recuperação recriam objetos em Node e usam fallback de armazenamento em memória: **não são reload real de página nem IndexedDB de browser**. Fixtures geradas não são corrida humana.

## Regressão atual — Gate 1

| Comando | Passou | Falhou | Duração |
| --- | ---: | ---: | ---: |
| `npm run test:ml` | 69 | 0 | 0,666 s |
| `npm run test:api` | 31 | 0 | 0,821 s |
| `node scripts/test_telemetry_uploader.js` | 43 | 0 | 0,684 s |
| `node scripts/test_uploader_integration.js` | 23 | 0 | 1,151 s |
| `node scripts/test_backend_concurrency.js` | 7 | 0 | 0,568 s |
| `npm run test:ml22` | 10 | 0 | 0,906 s |
| `npm run test:ml22:completion` | 36 | 0 | 1,722 s |
| `npm run build` | PASS | — | 0,845 s |

**Total: 219 verificações, 219 aprovadas, 0 falhas; 7,365 s incluindo build.** São verificações/assertions, não 219 cenários E2E. Node v22.14.0. Não há script de lint. Vite v8.2.2: build aprovado, bundle JS 169,00 kB / 54,98 kB gzip.

O runner para na primeira falha e isola testes de credenciais/banco de produção. A primeira tentativa do runner foi impedida pelo sandbox; foi repetida com autorização para subprocessos locais. Uma asserção nova usou incorretamente `.valid` num validador booleano, foi corrigida e a regressão inteira foi repetida depois. Não há falhas remanescentes nas suítes executadas.

Na inspeção de bundle, o runner inicialmente propagava NODE_ENV de teste também ao build. Foi corrigido: suítes usam ambiente de teste; build usa explicitamente produção. A regressão acima foi executada depois dessa correção. Busca no bundle final confirmou ausência de `__ML_TELEMETRY__`, o objeto interno de debug com credenciais.

## Correções realizadas nesta execução

- Corrigido checkout de client PostgreSQL para `Pool.connect()`, mantendo pool reutilizável e TLS com verificação de certificado em produção. Inicialização verifica a conexão antes de escutar. Falha no advisory lock não é mais ignorada. Execução real de PostgreSQL/migrations continua pendente.
- Corrigido preflight CORS para permitir o header de refresh. Produção exige origens HTTPS explícitas. A autorização de complete usa a sessão da rota, impedindo que o body troque a sessão autorizada. Refresh continua exigindo proof separado, válido, não adulterado e da mesma sessão.
- Sanitizados erros de rotas, startup e migrations; removida a exposição do objeto interno com credenciais pela API de debug de produção. Não foram adicionados segredos ao frontend.
- Criação de sessão concorrente é compartilhada; samples e sequências não são resetados durante a resposta pendente. Batches completos/parciais de uma corrida encerrada nesse intervalo são preservados até ACK.
- Persistidos intenção de conclusão e resumos de volta pendentes junto à continuidade da sessão. Complete aguarda batches e laps; renova token quando necessário e pode ser repetido após falha. Temporizadores são canceláveis e testes não ficam pendurados após dispose.
- Opt-out aborta pedidos em curso, cancela retries, descarta respostas tardias e limpa a fila/credenciais locais. A coleta iniciada exclusivamente pelo opt-in é interrompida. Limpar recordes não apaga mais o consentimento.
- Passagem do jogador pela linha gera lap summary anônimo. Encerramento por timeout e retorno ao menu também param a coleta. Contagem de laps é idempotente; insert e incremento usam a mesma transação. Complete não substitui a contagem do banco por estimativa do cliente.
- FPS é calculado pelo intervalo RAF; custo CPU do frame é separado. O microbenchmark Node foi rotulado corretamente e não é prova de performance do navegador. Tráfego wire não é estimado a partir do JSON bruto.

## Variáveis para o deploy — somente nomes

Backend / Render, obrigatórias:

`NODE_ENV`, `DATABASE_URL`, `INGEST_TOKEN_SECRET`, `CORS_ALLOWED_ORIGINS`.

Backend, demais variáveis utilizadas/configuráveis:

`PORT`, `HOST`, `INGEST_TOKEN_TTL_HOURS`, `MAX_BATCH_SAMPLES`, `MAX_BODY_SIZE`, `RATE_LIMIT_MAX_PER_WINDOW`, `SESSION_CREATE_RATE_LIMIT`, `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`.

Frontend / Vercel, públicas:

`VITE_TELEMETRY_API_URL`, `VITE_DEPLOY_ENV`.

Credenciais devem ser configuradas nos provedores/ambiente seguro, nunca coladas no relatório, embutidas em comandos registrados ou expostas em variáveis VITE.

## Relatório final solicitado — 40 itens

| # | Item | Resultado atual |
| --- | --- | --- |
| 1 | Suite/build atualizados | 219/219 e build PASS, na cópia local identificada acima. |
| 2 | Arquitetura de continuidade | Sessão, proof, sequência, batches, laps pendentes e intenção de conclusão persistidos; teste por recriação de objeto Node aprovado. |
| 3 | Refresh security | SessionId sozinho e proof adulterado rejeitados; proof correto aceito. Teste adicional de proof de outra sessão rejeitado. |
| 4 | Pending completion | 3 batches offline mantiveram ACTIVE; após recuperação, 150 samples/3 batches chegaram e a mesma sessão foi completada. HTTP local + storage memória. |
| 5 | Performance instrumentation | RAF/CPU/rede separados; escopo de serialização explicitado; trace completo pendente. |
| 6 | Frontend deploy | BLOQUEADO. Nenhuma URL/output Vercel verificados. |
| 7 | Backend deploy | BLOQUEADO. Nenhuma URL/output Render verificados. |
| 8 | Database | BLOQUEADO. PostgreSQL real não conectado. |
| 9 | Migration | Arquivos/history/locking existentes e correção local; execução real e consulta da history NÃO realizadas. |
| 10 | Health | Teste local HTTP 200 aprovado; health público e latência pública não medidos. |
| 11 | Ready | Local 200 com memória; 503 com erro de storage controlado. PostgreSQL/URL pública não validados. |
| 12 | CORS | Origem permitida/preflight 204 e falsa/403 testados localmente com política de produção. Domínios cloud reais pendentes. |
| 13 | Consent OFF | Zero requests e zero buffer no teste Node. Jogo hospedado por 15 s + contagem SQL: NÃO realizado. |
| 14 | Consent ON | Criação HTTP local funciona. Aceite na aplicação hospedada e ACTIVE em PostgreSQL: NÃO realizados. |
| 15 | ServerSessionId humano mascarado | INDISPONÍVEL. Não há sessão humana nova em produção para identificar. IDs de fixture não substituem isso. |
| 16 | Client samples humanos | NÃO MEDIDO. |
| 17 | Server samples humanos | NÃO MEDIDO. |
| 18 | Batches humanos | NÃO MEDIDO. Não declarar zero como se tivesse consultado produção. |
| 19 | Lap rows humanas | NÃO MEDIDO. Hook e idempotência foram testados somente localmente. |
| 20 | Final status humano | INDISPONÍVEL. COMPLETED foi observado apenas em sessões locais de teste. |
| 21 | IndexedDB pending humano | NÃO MEDIDO em browser; fallback memória chegou a zero no teste. |
| 22 | Reload | PARCIAL. Recriação Node restaura 3 batches e mantém sessão/seq/proof; reload real de página ainda obrigatório. |
| 23 | Token refresh | Aprovado localmente com TTL de 20 ms, espera de 30 ms, 401, refresh autenticado e retry do mesmo sequence. |
| 24 | Lost response | Aprovado localmente: servidor persistiu, transporte perdeu ACK, retry retornou ALREADY_PROCESSED, contadores ficaram 1 batch/50 samples. |
| 25 | Opt-out | Abort e descarte de credenciais tardias comprovados em Node; limpeza/ausência de tráfego no browser hospedado pendentes. |
| 26 | Decompressed batch | Fixture nova: 50/50 samples válidos, bounds/metadata iguais ao armazenado em memória. Batch humano PostgreSQL: NÃO verificado. |
| 27 | Versions | Código/fixtures usam schema 2 e versões atuais; registro humano em PostgreSQL NÃO verificado. |
| 28 | Compression | GZIP e round-trip locais aprovados. Tamanho/taxa de batches humanos novos NÃO medidos. |
| 29 | Storage estimates | PENDENTE de bytes humanos e overhead PostgreSQL reais. Estimativa antiga retirada como evidência. |
| 30 | FPS | NÃO MEDIDO no browser. Unidade sintética confirma RAF 16,67 ms = 60 FPS, independente de CPU 0,15 ms. |
| 31 | Frame p50/p95/p99 | NÃO MEDIDO nos cenários A/B/C reais. |
| 32 | Collector cost | Instrumentação presente; média/p95/p99 reais NÃO medidos. |
| 33 | Uploader main-thread cost | Instrumentação de serialização/bytes presente. Custo completo, incluindo IndexedDB, NÃO homologado. |
| 34 | HTTP latency | Separada da CPU. Média/p95 públicos NÃO medidos. |
| 35 | Heap | Instrumentação start/current/peak amostrado; tendência de leak em corridas sucessivas NÃO medida. |
| 36 | Network/min | Contador bruto de batches presente; tráfego wire e requests globais do browser NÃO medidos. |
| 37 | Test totals | 219 verificações, 219 pass, 0 fail; 7,365 s incluindo build. |
| 38 | Build | PASS. Não equivale a deploy ou homologação de gameplay. |
| 39 | Failures | Zero na última regressão; os impedimentos de ambiente/execução e a asserção corrigida estão registrados acima. |
| 40 | Limitações restantes | Autenticação/destinos/planos cloud, PostgreSQL, corrida humana, reload e performance real, pool/proxy/rate limits/logs cloud e backup/retention. Ver abaixo. |

## Gates ainda abertos

| Gate(s) | Situação |
| --- | --- |
| 1 | PASS LOCAL, regressão repetida após a última alteração de fonte/teste. |
| 2 | Respeitado: nenhuma automação visual Windows/OCR usada como prova. |
| 3 | Nomes das variáveis documentados, sem segredos. |
| 4–14 | BLOQUEADOS no ambiente real por ausência de deploys/banco e sessão humana. Códigos/testes locais não fecham esses gates. |
| 15 | Fluxo controlado local de três batches indisponíveis e recuperação aprovado. |
| 16 | PARCIAL: fallback Node não satisfaz reload real. |
| 17–18 | Fluxos controlados HTTP locais aprovados; repetir no ambiente de homologação cloud. |
| 19–23 | BLOQUEADOS: batch humano/SQL, storage e medições A/B/C de 2–5 minutos ausentes. |
| 24 | Distinção CPU vs latência aplicada; não há resultado browser a aprovar. |
| 25–27 | ABERTOS: p95 < 1 ms total, impacto FPS, tráfego e heap sem prova. |
| 28–30 | PARCIAIS: pool/limites/logs preparados, sem validação real atrás do Render. |
| 31–32 | PARCIAIS: guards e opt-out testados em Node, não nos deploys production/preview. |
| 33 | Respeitado: nenhum dataset legado enviado a produção. O benchmark preexistente apenas lê o arquivo local. |
| 34 | BLOQUEADO: plano efetivo e política de retenção/backup não escolhidos. |
| 35 | BLOQUEADO: corrida humana completa em produção não executada. |
| 36 | ABERTO: existe suíte local final, mas a suíte posterior ao E2E ainda depende do Gate 35. |

## Pendências técnicas antes de homologar

- Pool configurado no código: max 10, idle 30 s, conexão 5 s. É preciso provar reutilização, TLS, transações/locks e migrations no PostgreSQL real. O adaptador memória não emula rollback/locking de PostgreSQL.
- Limites locais configurados: criação 20/min por IP e middleware de ingestão 120/min por sessão/IP. Rate limiter é por processo, não distribuído. `trust proxy = 1` ainda precisa ser validado na topologia real do Render; não assumir que cabeçalhos/proxy estão corretos.
- A continuidade de uma sessão foi testada. Múltiplas sessões antigas coexistindo, múltiplas abas, quota/erro de IndexedDB e crash durante uma escrita exigem testes adicionais. A fila mantém batches de outra sessão em espera, sem enviá-los com autoridade incorreta; não declarar recuperação geral homologada.
- Estatísticas ACK do cliente não recompõem todo o histórico já enviado antes do reload. Para comparação acumulada após reload, definir baseline/reconciliação com servidor; não comparar contador recém-inicializado com acumulado SQL sem essa distinção.
- `persistedBatches` no stats é estimativa da fila e é marcado como tal; Gate 27 exige consultar o object store de verdade. Exposição global de stats não expõe tokens, mas os controles DEV não são prova de consentimento no deploy.
- `uploaderMainThread` mede serialização e contagem de bytes, não custo completo da fila/IndexedDB. Contador de rede atual refere-se aos batches; instrumentação/trace do navegador deve incluir sessões, laps, refresh, retries e headers. Nenhuma meta de performance foi declarada atingida.
- O mecanismo de armazenamento mantém fallback de memória quando IndexedDB falha; nessa situação não há garantia de durabilidade entre reloads. Opt-out não apaga requests que já foram aceitos pelo backend. Retenção/exclusão server-side precisa de política definida.
- Resumos usam velocidades internas do schema, tempo em segundos e contagem de amostras com flags, não episódios. Validar esses significados e as versões na corrida real.

## PostgreSQL — consultas preparadas, NÃO executadas em produção

Após conexão segura e migration autorizada, coletar evidências sem imprimir connection string, payload ou credenciais:

```sql
-- A implementação usa filename, não uma coluna chamada version.
SELECT filename AS version, applied_at FROM schema_migrations ORDER BY filename;
SELECT to_regclass('public.telemetry_sessions'),
       to_regclass('public.telemetry_batches'),
       to_regclass('public.telemetry_laps');
SELECT COUNT(*) FROM telemetry_sessions;
-- Usar $1 parametrizado com o ID da NOVA sessão humana.
SELECT status, received_samples, received_batches, completed_laps,
       schema_version, game_build_version, track_geometry_version,
       physics_version, feature_manifest_version, consent_version
FROM telemetry_sessions WHERE id = $1;
SELECT batch_sequence, sample_count, first_sample_index, last_sample_index,
       first_timestamp, last_timestamp, raw_bytes_size, compressed_bytes_size
FROM telemetry_batches WHERE session_id = $1 ORDER BY batch_sequence;
SELECT participant_id, lap_number, lap_time, sample_count, off_track_count,
       collision_count, spin_count, average_speed, max_speed, valid_lap
FROM telemetry_laps WHERE session_id = $1 ORDER BY lap_number;
```

Para storage, usar bytes GZIP médios humanos × 720 batches/h e acrescentar overhead medido das tabelas, TOAST, índices, sessões e laps. Escalar por 1/100/1.000/10.000 jogadores. Não há valores humanos suficientes para preencher essa projeção agora.

## Plano, retenção e dependências externas

Nenhum plano utilizado pode ser informado porque não houve criação/seleção. O Render oferece `preDeployCommand` para serviços pagos; a configuração existente depende desse recurso. Não selecionei plano pago nem alterei a estratégia de migration silenciosamente. [Render: deploy commands](https://render.com/docs/deploys).

Limitações de referência consultadas em 03/09/2026, NÃO plano contratado: PostgreSQL Free tem 1 GB, expira em 30 dias e não dispõe de backups. Web Free pode dormir após 15 minutos sem tráfego e levar aproximadamente um minuto para despertar. Bandwidth/pipeline seguem franquias do workspace; quota real precisa ser consultada na conta. [Render: Free](https://render.com/docs/free). Retenção/PITR de plano pago deve ser conferida no recurso escolhido. [Render: backups PostgreSQL](https://render.com/docs/postgresql-backups).

Para continuar, o usuário precisa indicar o repositório/projeto Quick-grid correto, disponibilizar autenticação segura aos destinos Vercel e Render e decidir o plano/limite de custo do serviço e PostgreSQL. Não colar segredos na conversa. Depois do deploy verificável, será necessária pilotagem humana para os gates de volta/corrida; automação de bot não os substitui.
