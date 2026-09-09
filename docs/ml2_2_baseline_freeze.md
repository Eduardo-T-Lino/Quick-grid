# ML2.2 baseline freeze

Status do documento: baseline de lineage congelado para a aceitação ML2.2. Isto não inicia ML3.

## Baseline auditado

O primeiro e último ponto anterior às mudanças auditadas em que as versões antigas já estavam estabelecidas é `b956149` (`chore: establish Quick-grid ML2.2 deployment baseline`, 2026-09-03). Foram inspecionados os nove commits seguintes até `8603f654c4675dca056851e9251fe390e0b3297c`, incluindo os diffs reais de `car.js`, `game.js`, `track.js`, `ai.js`, `constants.js`, `src/ml/**`, controles, fixed timestep, superfícies e telemetria.

Categorias: A = `VISUAL_ONLY`; B = `PERFORMANCE_ONLY_SEMANTICS_PRESERVED`; C = `GAMEPLAY_NON_ML`; D = `DRIVER_ACTION_SEMANTICS`; E = `PHYSICS_STATE_TRANSITION`; F = `TRACK_GEOMETRY_SEMANTICS`; G = `OBSERVATION_FEATURE_SEMANTICS`; H = `TELEMETRY_SCHEMA_SEMANTICS`.

| Commit / escopo | Classe | Evidência e conclusão de lineage |
|---|---|---|
| `bf6a203`, `9168efa` — Render free tier, startup e conexão PostgreSQL | B, infraestrutura | Somente deploy/pool/startup/testes. Nenhuma mudança A(t), física, geometria, observação ou schema. |
| `8082823` — verificação cloud | B, infraestrutura | Ferramentas read-only e testes de SQL/GZIP; H auditada e preservada. |
| `32a2ba0` — aparência, culling, tile cache e interpolação de render | A, B | `car.js` apenas delega desenho; `track.js` altera `drawTrack`; poses interpoladas não alimentam colisão nem física. |
| `32a2ba0` — largada/countdown | C | Física e coleta passam a iniciar somente no lights-out. Não há amostras no countdown; o loop de corrida continua com o mesmo tick fixo e a mesma transição física. |
| `4623360` — busca de distância | B | Compara distância ao quadrado e aplica uma única raiz no vencedor. Segmento, projeção e distância foram preservados com tolerância de `1e-9`; F permanece inalterada. |
| `4623360` — pausa, retomada, restart e configuração de voltas | C | Congela simulação/coleta e rebasa relógios; não redefine campos de ML nem a transição de um tick ativo. |
| `4623360` — direção humana | D | A política teclado → ação mudou de rampa fixa `0.10` para `0.085` em baixa/`0.060` em alta e lock `1.00` → `0.88`. O valor gravado continua sendo a ação pós-filtro realmente aplicada, em `[-1,1]`. |
| `4623360` — cenário e apresentação de pista | A | Somente pintura/scenery no caminho de render; centerline, sampling, tangentes, curvatura, distância acumulada e projeção não mudaram. |
| `5fe050e`, `f0a67e5` — benchmark A/B/C | B, infraestrutura | Harness e documentação; nenhum módulo de simulação/ML alterado. |
| `fd6f0d8` — configuração visual de corrida | A, C | UI responsiva e seleção; nenhuma alteração física/IA/ML. |
| `8603f65` — refresh token production proof | B, infraestrutura | Harness, documentação e regressões de transporte/autorização. H permanece Schema V2. |

Não houve mudança E, F, G ou H desde o baseline. `src/ai.js`, `src/constants.js` e `src/ml/**` permaneceram sem diff no intervalo auditado até a tarefa J.

## Decisão de versionamento

| Metadata | Antes | Freeze ML2.2-J | Decisão |
|---|---|---|---|
| `SCHEMA_VERSION` | `2` | `2` | Estrutura, causalidade S(t) → A(t) e significado dos campos permanecem compatíveis. |
| `GAME_BUILD_VERSION` | `0.2.0-ml2` | `0.3.0-ml2` | Bump minor: o jogo passou a ter countdown/pausa e uma política humana de direção materialmente diferente; `0.2.0` não podia identificar ambos. |
| `TRACK_GEOMETRY_VERSION` | `1.5.0-centripetal` | `1.5.0-centripetal` | O algoritmo centrípeto, alpha, amostragem, tangentes, curvatura, cumulative distance e projection/progress são os mesmos. |
| `PHYSICS_VERSION` | `1.5.0-gt3` | `1.5.0-gt3` | Para um mesmo `State(t), Action(t)`, a aplicação `steerInput * (0.32 - 0.20 * speedRatio)` e toda a integração seguem iguais. A mudança ocorreu antes de A(t), na política humana do teclado. |
| `FEATURE_MANIFEST_VERSION` | `2.1.0` | `2.1.0` | Inputs, ordem, encoding, unidades e targets não mudaram. `driverAction.steering` ainda é o comando pós-filtro aplicado; mudou sua distribuição humana, não seu significado. |

A direção antiga e a nova devem ser estratificadas por `gameBuildVersion` em análises de distribuição. Isto não torna os labels antigos estruturalmente incompatíveis: um valor `driverAction.steering = 0.88` conserva exatamente a mesma unidade e aplicação física nos dois builds.

## Fonte canônica e fingerprint

`src/ml/lineage/baselineManifest.js` é a fonte única para versões usadas pelo frontend, backend e Schema V2. `src/constants.js`, `server/src/config.js` e `telemetrySchema.js` importam essa fonte. O teste final falha se a fonte, o runtime, a documentação ou o hash divergirem.

O manifesto inclui taxas de 10 Hz/60 Hz, constantes GT3 relevantes, perfil de entrada humana, aplicação do esterço normalizado, definição ordenada das features/targets e parâmetros/fingerprint semântico da geometria. A serialização ordena recursivamente chaves de objetos e preserva a ordem dos arrays. Não contém timestamps, paths locais, host, máquina ou segredos.

`simulationFingerprintSha256`:

`919c932171a41a44d40af1d86df530a8f3db911b030691b68908766712a6c16c`

Novas sessões anunciam as versões no registro normal de `telemetry_sessions` e armazenam o fingerprint em `client_info.simulationFingerprintSha256`. A coluna JSONB já existe; nenhuma migração foi criada. Nenhum `UPDATE`, backfill ou reescrita de sessão, batch ou volta histórica faz parte deste freeze.

## Dataset compatibility matrix

| Grupo | Classificação | Pode entrar em BC? | Motivo e tratamento |
|---|---|---:|---|
| Datasets pré-ML1.5 com geometria defeituosa | `REJECT` | Não | Centerline/geometria anterior é incompatível e defeituosa; rejeição obrigatória para Behavioral Cloning. |
| Schema V2 antes da correção geométrica ML1.5 | `REJECT` | Não | Causalidade V2 isoladamente não corrige features geométricas/progress antigas. |
| Sessão humana validada `ad759118-4386-481f-9d34-f3d496eb1854` | `TRAIN_ALLOWED` | Sim | Sessão humana já validada em cloud/SQL/GZIP com Schema V2 e geometria corrigida. Manter seu build original e estratificar a política de direção por build. |
| Benchmark ML2.2-H: `014398f2-d1ce-4c40-8bcb-3a65a1008065` | `INFRASTRUCTURE_ONLY` | Não | Execução automatizada C1 para performance/transporte; não é demonstração humana de qualidade. |
| Benchmark ML2.2-H: `6bf94581-f632-4bd4-bbb1-50378db12f3f` | `INFRASTRUCTURE_ONLY` | Não | Execução automatizada C2 para performance/transporte; não é demonstração humana de qualidade. |
| Benchmark ML2.2-H: `7ca52a2b-58a0-4bc2-81ec-ad4fc8a36d03` | `INFRASTRUCTURE_ONLY` | Não | Execução automatizada C3 para performance/transporte; não é demonstração humana de qualidade. |
| Refresh ML2.2-I: `5d639195-4ebe-48ed-ada3-fb80a5ec128d` | `INFRASTRUCTURE_ONLY` | Não | Pilotagem automatizada e 401 deliberado para provar recovery; não representa qualidade humana. |
| Smoke ML2.2-J: `d2d44255-6487-4210-9daa-2e19f2df5ff3` | `INFRASTRUCTURE_ONLY` | Não | Sessão automatizada curta, COMPLETED com 2 batches/58 samples; confirma metadata/fingerprint e entrega, não qualidade humana. |
| Novos datasets humanos pós-freeze ML2.2-J | `TRAIN_ALLOWED` | Sim, condicional | Exigir versões/fingerprint deste documento, `PLAYER_ONLY`, consentimento, completion, continuidade e quality gate humano. |
| Novos datasets automatizados pós-freeze ML2.2-J | `VALIDATION_ONLY` | Não por padrão | Podem validar pipeline/simulação; só viram demonstração de treino mediante política explícita futura, fora da ML2.2. |

O classificador deve usar a lineage gravada, nunca data aproximada ou reclassificação retroativa. Dados antigos preservam para sempre os metadados com os quais foram capturados.
