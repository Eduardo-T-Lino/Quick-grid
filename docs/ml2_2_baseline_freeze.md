# ML2.2 baseline freeze

## Revisão boost 350 / HUD / bots / senha mínima

Runtime `0.6.1-ml2`, física `1.8.1-gt3-boost350`, fingerprint `aac9ec64f1694bd66120f1958de9563c79ed2f573eb264bad000c6f863f6d534`. Boost com teto independente de 350 km/h; fora dele, teto de motor de 320 km/h, preservando inércia ao terminar. Sexta marcha em 1.72. Nenhuma reclassificação de dados históricos. UI permite 1–19 bots, HUD mais legível sem alertas de perda de aderência e cadastro com mínimo de 6 caracteres. Demais proteções de autenticação preservadas.

## Revisão 320 km/h, brita e boost

Runtime `0.6.0-ml2`, física `1.8.0-gt3-boost`, fingerprint `68422530c13eebe85e59b38f26b687d28678b7d6e6ceb6ba416f4cad78f230ec`.
Limite positivo do motor ajustado para 320 km/h com sexta marcha alongada; calibração de velocidade e geometria históricas preservadas. Brita usa resistência progressiva e giro cinemático em baixa velocidade. Boost de potência temporária para o jogador, controlado por Espaço, limitado pela aderência traseira e pelo mesmo teto de velocidade. Esta revisão não é automaticamente compatível com os datasets aceitos: boost é um controle adicional não representado nos três alvos legados de ação. Não usar essas sessões para treino sem revisão explícita de features/ações. Snapshot aceito e dados históricos intactos; nenhum deploy ou migração.

## Revisão de velocidade e grid — 10/09/2026

Runtime `0.5.1-ml2`, física `1.7.1-gt3-grid`, fingerprint `014209f8e8e3737ff43e8119aad8e50d358fb68f84c3554986c90ba3c282c00c`.
Potência e relações de marcha anteriores à redução restauradas, com referência de limite de motor de 285 km/h. Tração traseira, pneus e vácuo preservados. Grid intercalado de 20 posições, por distância real ao longo da pista, compartilhado entre pintura e carros; sem alterar os pontos da pista. Snapshot histórico aceito preservado, sem aceitação automática de novos datasets ou deploy.

Status do documento: baseline de lineage congelado para a aceitação ML2.2. Isto não inicia ML3.

## Revisão posterior — tração em curva

O histórico de aceitação abaixo permanece referente ao freeze original. O ajuste solicitado posteriormente aumenta somente o coeficiente de demanda lateral traseira de 0.48 para 0.51 (+6,25%), mantendo o teto de utilização 0.96 e os controles de direção/motor. Em reta a demanda permanece zero; em curva a margem para acelerar é ligeiramente menor. O modelo continua compartilhado por jogador e bots, sem alteração das decisões da IA.

Esta mudança é classe E (transição física), identificada por `GAME_BUILD_VERSION = 0.3.1-ml2`, `PHYSICS_VERSION = 1.5.1-gt3` e fingerprint `a061e1e63b2de5d2ea75209643f7e0f5c762e76775c47735c1e51005cca0c89e`. Schema, features e geometria não mudam. O código do backend compartilha as versões canônicas; não houve deploy nem reescrita de dados históricos. Não misturar automaticamente a nova física com o baseline aceito em análises/datasets. Os testes e evidências de produção anteriores não homologam esta revisão.

## Baseline auditado

Revisão vácuo/contas: runtime `0.5.0-ml2`, física `1.7.0-gt3-wake`, fingerprint `48f91c0a670077148b4995cfd55585bafbce74a1a3c0d8f99c0830764cb2e125`. Aderência básica 0.047, força por marcha parcialmente restaurada e esteira aerodinâmica com redução de arrasto/carga. O snapshot aceito permanece inalterado. Contas não são vinculadas à telemetria.

Revisão RWD posterior: runtime `0.4.0-ml2`, física `1.6.0-gt3-rwd`, fingerprint `93e0cd9aae3035043f7e65a591ed821801d0b6b7c9edf9510b8178a8efa134e6`. Motor com aproximadamente 46–65% menos força por marcha que o baseline original (redução maior nas baixas) e corte em 1.14 m/tick (~241 km/h na escala do HUD), sem mudar a escala/geometria dos circuitos. A derrapagem traseira passa a reduzir sustentação lateral e estabilização de giro, com recuperação gradual. O inventário continua usando o snapshot histórico `acceptedBaseline.js`; esta física nova não passa automaticamente pelo baseline de treino. Sem deploy ou alteração de dados históricos nesta revisão.

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

## Revisão local: boost 400, ré limitada e vácuo progressivo

Build `0.6.2-ml2`, física `1.8.2-gt3-boost400`; fingerprint
`b683fc8c003aa632a280ee14823ba1536b568de59d088696d9c975ff8fefd5e9`.
Máxima normal 320 km/h, boost até 400 km/h, ré até 50 km/h. Vácuo libera
até 30 km/h adicionais, no máximo 2 km/h por segundo de permanência, proporcional à intensidade.
Geometria, versões de schema/features e baseline de aceitação histórico preservados.
Esta revisão não autoriza novos dados para treino: o boost ainda não faz parte dos três targets legados.

## Revisão local: recuperação de drift e embalo pós-boost

Build `0.6.3-ml2`, física `1.8.3-gt3-drift-coast`; fingerprint
`53193ebb1921ecd3f56638054d0acf8fa31d1d7c7647f0e85349a32b96319173`.
Mantém 320 km/h normal, 400 com boost e 50 de ré. Embalo conquistado com boost
perde velocidade mais lentamente no asfalto, com transição perto do limite normal;
frear ou sair do asfalto cancela esse benefício. Contraesterço recupera autoridade
do eixo dianteiro durante uma traseirada, sem alinhar o carro automaticamente.
Geometria, dificuldade de entrada em derrapagem, schema/features e baseline histórico
preservados. Sem módulo online, treino ou ML3 nesta revisão.
