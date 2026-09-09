# ML3.0 — Dataset inventory & curation foundation

## Escopo e resultado

Este documento registra a fundação de inventário da ML3.0. Nenhum modelo foi treinado, nenhum dataset final de Behavioral Cloning foi criado e nenhuma regra definitiva de aceitação de segmentos da ML3.1 foi antecipada.

O inventário canônico versão 1 foi produzido por `scripts/ml3_inventory.js`. O snapshot local ignorado pelo Git fica em `artifacts/ml3_dataset_inventory.json`; seu `canonicalSha256` é `caa6458704ec331b4186da9666cecf83408089e0eb760d071dcf12d9a2a866ac`. Duas execuções consecutivas com as mesmas fontes produziram o mesmo hash canônico e o mesmo SHA-256 do arquivo.

Baseline preservado:

| Campo | Valor |
| --- | --- |
| Tag imutável | `ml2.2-accepted` |
| Commit aceito | `a8bb80c7581298eb473eb84089ca9c4835a33763` |
| Schema | `2` |
| Game build congelado | `0.3.0-ml2` |
| Physics | `1.5.0-gt3` |
| Track geometry | `1.5.0-centripetal` |
| Feature manifest | `2.1.0` |
| Sampling / simulação | 10 Hz / 60 Hz fixed timestep |
| Fingerprint | `919c932171a41a44d40af1d86df530a8f3db911b030691b68908766712a6c16c` |

## Fontes encontradas e indisponíveis

| Fonte | Estado | Evidência e limite |
| --- | --- | --- |
| JSONL local | `AVAILABLE` | Dois arquivos com o mesmo nome e SHA-256; deduplicados como um único payload bruto de 2.447 samples. |
| Artefatos de validação | `AVAILABLE` | Cinco JSONs ML2.2 lidos; contêm resumos de coletores/sessões, não os payloads brutos. |
| Sessões conhecidas documentadas | `AVAILABLE` | Os seis UUIDs exigidos são reconhecidos explicitamente. |
| API pública de sessão | `AVAILABLE_PARTIAL` | GET somente-leitura retornou metadados dos sete UUIDs descobertos. Não lista todo o banco nem expõe batches, laps ou GZIP. |
| PostgreSQL cloud integral | `BLOCKED` | `DATABASE_URL` não existe neste ambiente. `CLOUD_FULL_INVENTORY_BLOCKED`; nenhuma credencial foi solicitada ou registrada. |
| Outros históricos de telemetria | `NOT_FOUND` | A descoberta escopada não encontrou outro payload de telemetria bruto distinto. `server/data/bot_training.json` e records não são capturas Schema V2 e não foram tratados como datasets. |

Reprodução posterior, numa sessão que já tenha `DATABASE_URL` read-only no ambiente:

```powershell
npm run ml3:inventory -- --source cloud --output artifacts/ml3_dataset_inventory.json
```

A ferramenta abre `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, consulta apenas `telemetry_sessions`, `telemetry_batches` e `telemetry_laps`, descompacta GZIP localmente e encerra com `ROLLBACK`. Não há SQL de mutação, migrations ou escrita no banco.

## Totais do snapshot acessível

Os totais abaixo combinam sessões públicas, coletores preservados apenas como resumo em artifacts e um payload JSONL bruto, deduplicando IDs de servidor presentes em mais de uma fonte. Duração é tempo nominal de samples (`samples / sampleRateHz`) quando só existem contadores; no JSONL bruto usa o intervalo real entre timestamps. Portanto não é soma de wall-clock nem prova de payload cloud integral.

| Métrica | Total |
| --- | ---: |
| Sessões/coletores únicos | 15 |
| Batches persistidos conhecidos | 132 |
| Samples conhecidos | 17.035 |
| Duração ativa estimada/medida | 1.714,333567 s |
| Horas | 0,476204 h |
| Tracks | `21` (14 sessões); valor histórico não numérico `"track"` (1 JSONL) |
| Humana | 1 sessão; 41 batches; 1.940 samples |
| Automáticas | 13 sessões; 91 batches conhecidos; 12.648 samples |
| Natureza não determinável | 1 sessão JSONL; 2.447 samples |

## Inventário por sessão

| Sessão / coleção | Fonte resumida | Build | Samples | Batches | Laps | Lineage | Qualidade |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `ad759118-4386-481f-9d34-f3d496eb1854` | docs + API pública | `0.2.0-ml2` | 1.940 | 41 | 3 | `COMPATIBLE` | `REVIEW` |
| `014398f2-d1ce-4c40-8bcb-3a65a1008065` | H C1 + API | `0.2.0-ml2` | 1.366 | 28 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `6bf94581-f632-4bd4-bbb1-50378db12f3f` | H C2 + API | `0.2.0-ml2` | 1.370 | 28 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `7ca52a2b-58a0-4bc2-81ec-ad4fc8a36d03` | H C3 + API | `0.2.0-ml2` | 1.367 | 28 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `5d639195-4ebe-48ed-ada3-fb80a5ec128d` | I + API | `0.2.0-ml2` | 103 | 3 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `d2d44255-6487-4210-9daa-2e19f2df5ff3` | J + API | `0.3.0-ml2` | 58 | 2 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `a7ccea2d-c83b-4abb-b0db-188d20d4e439` | H quick C1 + API | `0.2.0-ml2` | 86 | 2 | 0 | `VALIDATION_ONLY` | `NOT_EVALUATED` |
| `sess_8mss4x72ut_1788196843382` | JSONL bruto local | desconhecido | 2.447 | — | 5 observadas | `REJECT` | `REJECT` |
| `sess_j1z9krmta0_1788886504353` | artifact B1 | desconhecido | 1.368 | — | 0 | `REJECT` | `REJECT` |
| `sess_j1z9krmta0_1788886648899` | artifact B2 | desconhecido | 1.367 | — | 0 | `REJECT` | `REJECT` |
| `sess_j1z9krmta0_1788887081638` | artifact B3 | desconhecido | 1.368 | — | 0 | `REJECT` | `REJECT` |
| `sess_j1z9krmta0_1788950629494` | artifact quick B1 | desconhecido | 89 | — | 0 | `REJECT` | `REJECT` |
| `sess_j1z9krmta0_1788950934729` | artifact H B1 | desconhecido | 1.367 | — | 0 | `REJECT` | `REJECT` |
| `sess_j1z9krmta0_1788951223647` | artifact H B2 | desconhecido | 1.369 | — | 0 | `REJECT` | `REJECT` |
| `sess_j1z9krmta0_1788951944235` | artifact H B3 | desconhecido | 1.370 | — | 0 | `REJECT` | `REJECT` |

Os sete coletores B/local-buffer acima não carregam lineage suficiente no artifact. A rejeição não declara que seus samples são corrompidos; aplica a regra obrigatória de não usar em BC quando a lineage é impossível de determinar. Os artefatos originais não são reescritos e nenhuma feature histórica é recalculada.

## Classificação de lineage e qualidade

| Classificação | Sessões | Samples | Interpretação ML3.0 |
| --- | ---: | ---: | --- |
| `COMPATIBLE` | 1 | 1.940 | Compatibilidade estrutural; ainda depende da dimensão de qualidade. |
| `INFRASTRUCTURE_ONLY` | 5 | 4.264 | Provas H/I/J; nunca demonstrações humanas de treino. |
| `VALIDATION_ONLY` | 1 | 86 | Execução automática útil apenas para validação. |
| `REJECT` | 8 | 10.745 | Lineage ausente/indeterminável; proibido para BC sem reclassificação inventada. |
| `qualityEligibility=REVIEW` | 1 | 1.940 | Único candidato humano, requer análise do payload e regras futuras. |
| `qualityEligibility=NOT_EVALUATED` | 6 | 4.350 | Automáticos de infraestrutura/validação. |
| `qualityEligibility=REJECT` | 8 | 10.745 | A dimensão de lineage já impede uso. |

Rejeições estruturais codificadas na ferramenta: pré-ML1.5, geometria incompatível mesmo com Schema V2, schema/causalidade incompatível, payload corrompido, numeric inválido, physics/features/build desconhecidos e lineage indeterminável. A ML3.0 mede gaps e eventos, mas não cria thresholds finais nem rejeita automaticamente apenas por um gap.

## Estratificação por game build e fingerprint

| Build | Sessões | Samples | Observação |
| --- | ---: | ---: | --- |
| `0.2.0-ml2` | 6 | 6.232 | Mantido separado porque a política de direção humana difere do build 0.3. |
| `0.3.0-ml2` | 1 | 58 | Smoke J pós-freeze com fingerprint explícito. |
| Desconhecido | 8 | 10.745 | Não misturado silenciosamente com builds conhecidos; rejeitado por lineage. |

O fingerprint aceito foi observado explicitamente em uma sessão, `d2d44255-6487-4210-9daa-2e19f2df5ff3`, e resultou em `MATCH`. Nas outras 14 não estava disponível na fonte acessível. A ferramenta preserva mismatch como `MISMATCH_BASELINE_DIFFERENT` e `VALIDATION_ONLY`, exigindo análise explícita; mismatch não é rotulado automaticamente como corrupção.

## Sinais de qualidade medidos no JSONL bruto

O JSONL local é a única fonte cujo payload completo pôde ser medido neste ambiente. Ele contém Schema V2 e 2.447 objetos JSON válidos, mas versões de sessão/fingerprint ausentes e `trackId="track"`; por isso é `REJECT` por lineage, independentemente de seus sinais diagnósticos.

Integridade:

| Sinal | Resultado |
| --- | ---: |
| Linhas corrompidas / NaN/Infinity | 0 / 0 |
| Duplicates | 0 |
| Violações timestamp / sampleIndex | 0 / 0 |
| Sample-index gaps | 0 |
| Timestamp gaps >150 / >250 / >500 / >1000 ms | 1 / 1 / 1 / 1 |
| Delta timestamp p50 / p95 / p99 / max | 100 / 100 / 100 / 11.033,566667 ms |
| Track progress / actions fora da faixa | 0 / 0 |
| Off-track / spin / collision | 124 / 4 / 0 samples |
| Samples sem off-track, spin, collision ou numeric inválido | 2.319 (diagnóstico, não seleção final) |

Distribuição de ações:

| Ação | Mean | Std | p01 | p05 | p50 | p95 | p99 | Diagnóstico adicional |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Steering | -0,023580 | 0,291237 | -0,868096 | -0,496970 | 0 | 0,521700 | 0,979178 | <=-0,95: 0,326931%; >=0,95: 1,389456% |
| Throttle | 0,841847 | 0,364884 | 0 | 0 | 1 | 1 | 1 | zero: 15,815284%; >=0,95: 84,184716% |
| Brake | 0,011443 | 0,106356 | 0 | 0 | 0 | 0 | 1 | zero: 98,855742%; >0 e >=0,95: 1,144258% |

Distribuição de estado:

| Feature | Mean | Std | p01 | p05 | p50 | p95 | p99 | Min / max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| speed | 1,176754 | 0,341643 | 0,001200 | 0,414930 | 1,366500 | 1,388440 | 1,421570 | 0 / 1,465100 |
| crossTrackError | -0,764583 | 6,232603 | -19,898140 | -14,075300 | -0,080000 | 7,692000 | 10,258260 | -20,926 / 11,924 |
| headingError | 0,006397 | 0,269368 | -0,467462 | -0,272940 | 0,000300 | 0,328950 | 0,789720 | -3,1411 / 3,1401 |
| slipAngle | 0,003986 | 0,078091 | -0,313920 | -0,122310 | 0,002900 | 0,132330 | 0,221780 | -0,4 / 0,469 |
| yawRate | -0,001725 | 0,012405 | -0,027708 | -0,021870 | -0,001200 | 0,023600 | 0,029962 | -0,0415 / 0,0467 |
| distanceToLeftEdge | 12,764583 | 6,232603 | 1,741740 | 4,308000 | 12,080000 | 26,075300 | 31,898140 | 0,076 / 32,926 |
| distanceToRightEdge | 11,235417 | 6,232603 | -7,898140 | -2,075300 | 11,920000 | 19,692000 | 22,258260 | -8,926 / 23,924 |
| currentCurvature | 0,010721 | 0,061038 | 0 | 0 | 0,001740 | 0,033568 | 0,090100 | 0 / 1,59735 |

Voltas observadas no JSONL:

| Lap | Samples | Tempo (s) | Válida diagnóstica | Off-track | Collision | Spin | Avg speed | Max speed |
| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 674 | 67,3 | não | 79 | 0 | 3 | 1,067254 | 1,4345 |
| 2 | 575 | 57,4 | sim | 0 | 0 | 0 | 1,244434 | 1,4324 |
| 3 | 559 | 55,8 | sim | 0 | 0 | 0 | 1,263242 | 1,4651 |
| 4 | 579 | 57,8 | não | 0 | 0 | 1 | 1,232104 | 1,4337 |
| 5 | 60 | 16,833567 | não/parcial | 45 | 0 | 0 | 0,418305 | 1,4182 |

Regiões candidatas problemáticas: `OFF_TRACK=124`, `SPIN=4`, `COLLISION=0`, `TEMPORAL_GAP=1`, `INVALID_NUMERIC=0`, `ACTION_SATURATION=2128`. São contagens diagnósticas; não constituem o segment-filter da ML3.1.

## Diagnóstico especial da sessão humana ad759118...

O GET público confirmou `COMPLETED`, Schema 2, track 21, build `0.2.0-ml2`, geometry/physics/features compatíveis, 41 batches, 1.940 samples e 3 laps. A duração nominal de samples é 194 s. A sessão é `lineageEligibility=COMPATIBLE` e `qualityEligibility=REVIEW`, com `finalTrainingDataset=false`.

O contexto aceito informa que as três voltas registraram eventos de qualidade. Neste ambiente, entretanto, a API pública não expõe os rows de `telemetry_laps` nem os payloads GZIP. Portanto lap boundaries, off-track/spin por volta, distribuições de ação/estado e quantidade potencialmente limpa de `ad759118...` permanecem **não mensuradas neste snapshot**. Não foram substituídas por fixture, inferidas do outro JSONL ou inventadas. O inventário PostgreSQL read-only acima é o blocker concreto para completar esse diagnóstico. A conclusão correta da ML3.0 é `REVIEW`/`TRAIN_CANDIDATE`, nunca “final training dataset”.

## Candidatos e fronteira da ML3.1

O único candidato humano conhecido é `ad759118...`, ainda em `REVIEW`. As cinco sessões H/I/J são somente infraestrutura; `a7c...` é validação; os oito itens sem lineage completa são rejeitados para BC. Nenhum item foi incluído automaticamente em treino.

Antes da ML3.1 será necessário:

1. executar o inventário integral com `DATABASE_URL` read-only para descobrir sessões não listadas e medir GZIP/laps;
2. obter o diagnóstico bruto completo de `ad759118...`;
3. revisar separadamente distribuições dos builds `0.2.0-ml2` e `0.3.0-ml2`;
4. só então definir thresholds e política de aceitação/rejeição de segmentos.

## Uso e testes

```powershell
npm run ml3:inventory
npm run ml3:inventory -- --source local
npm run ml3:inventory -- --source cloud --session ad759118-4386-481f-9d34-f3d496eb1854
npm run test:ml3:inventory
```

Os testes cobrem baseline, os quatro estados de lineage, sessão humana não promovida automaticamente, rejeições pré-ML1.5/geometria, fingerprint match/mismatch, numeric inválido, gaps de timestamp/index/batch, duplicates, distribuições, laps/regiões, estratificação por build, serialização determinística, ausência de `generatedAt` e bloqueio de qualquer campo de credencial.
