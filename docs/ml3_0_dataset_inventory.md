# ML3.0-B — Inventário cloud final e auditoria profunda da sessão humana

## Escopo e cadeia de evidência

Esta fase inventaria e classifica telemetria; não treina modelo, não cria o dataset final de Behavioral Cloning e não inicia a ML3.1. Nenhuma física, geometria, feature, taxa de amostragem, schema, backend ou linha do banco foi alterada.

O PostgreSQL foi lido externamente em uma transação `REPEATABLE READ READ ONLY`. O snapshot aprimorado foi validado pelo hash canônico e pela presença de todos os campos novos antes de ser reconciliado offline com artifacts ML2.2, documentação, API pública e JSONL local. O processo final não releu nem escreveu no banco.

| Evidência | SHA-256 do arquivo | SHA-256 canônico |
| --- | --- | --- |
| `artifacts/ml3_human_session_inventory.json` | `6c084aa6927b1fc5fa625c7c0712085be0abfead4b8e45436066becffc0e837e` | `1296080684472670c914541498a92b961c052e821668c6234ebb9d0af25f902b` |
| Snapshot cloud aprimorado preservado | `df980c8ec0a4fedda6d82ddd03a6b046ed85b6891167f2f39742fc671b06c2cc` | `68abc45c5d2a6f2d3be9811476d4cbcb67a8bd8b414bc48271e4e7b0cca65645` |
| `artifacts/ml3_dataset_inventory.json` reconciliado | `d4047710679da1154c4bb2a98c1e5c39fcfd620e041fe165fcb7d4870ee3b249` | `ade0e99d5162eeea75dfeea9aa70068b64588d025d33d35b5cf7ea335a3ffe68` |

Os artifacts permanecem ignorados pelo Git. Os hashes canônicos armazenados foram recalculados a partir de `stableSerialize(canonicalInventory)` e conferem byte a byte com os valores acima.

Baseline preservado:

| Campo | Valor |
| --- | --- |
| Tag | `ml2.2-accepted` |
| Commit aceito | `a8bb80c7581298eb473eb84089ca9c4835a33763` |
| Schema | `2` |
| Builds aceitos como estratos separados | `0.2.0-ml2`, `0.3.0-ml2` |
| Physics | `1.5.0-gt3` |
| Track geometry | `1.5.0-centripetal` |
| Feature manifest | `2.1.0` |
| Sampling / simulação | 10 Hz / 60 Hz fixed timestep |
| Fingerprint aceito | `919c932171a41a44d40af1d86df530a8f3db911b030691b68908766712a6c16c` |

## Fontes reconciliadas

| Fonte | Resultado final |
| --- | --- |
| PostgreSQL | `AVAILABLE_FULL`: 10 sessões, 217 batches, 10.147 samples |
| API pública | `AVAILABLE_PARTIAL` por definição do escopo; 10/10 UUIDs retornados, 0 falhas |
| Artifacts ML2.2 | `AVAILABLE`: cinco arquivos, incluindo benchmarks, refresh e lineage smoke |
| Sessões documentadas | `AVAILABLE`: sete UUIDs conhecidos após registrar o quick benchmark C |
| JSONL local | `AVAILABLE`: dois arquivos idênticos, deduplicados por SHA-256 em um payload |
| Outros históricos | `NOT_FOUND_ADDITIONAL` |

O inventário reconciliado contém 18 registros lógicos, 217 batches e 20.892 samples. Destes, 10 sessões/10.147 samples são PostgreSQL; sete registros/8.298 samples são buffers automáticos preservados apenas por artifacts; um registro/2.447 samples é o JSONL local. Nenhuma sessão é contada duas vezes quando existe UUID de servidor ou alias local inequívoco.

## Inventário PostgreSQL autoritativo

Todos os 10 registros DB são Schema 2, track 21, scope `PLAYER_ONLY`, driver type `PLAYER`, physics `1.5.0-gt3`, geometry `1.5.0-centripetal` e features `2.1.0`.

| UUID | Alias local | Status | Build | Batches | Samples | Laps | Lineage | Qualidade |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `014398f2-d1ce-4c40-8bcb-3a65a1008065` | `sess_rh8vsn5k2p_1788951085078` | `COMPLETED` | `0.2.0-ml2` | 28 | 1.366 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `0d127bd9-1781-4315-8eb0-4eb81731b224` | `sess_38l9drgf6o_1788526207621` | `COMPLETED` | `0.2.0-ml2` | 21 | 1.022 | 0 | `COMPATIBLE` | `REVIEW` |
| `12e508e5-9688-4414-8e56-42186677bf65` | `sess_thcbd8qf2o_1788526947714` | `ACTIVE` | `0.2.0-ml2` | 16 | 613 | 0 | `COMPATIBLE` | `REVIEW` |
| `1bf9eec6-ac72-4dd5-98da-470e748ec844` | `sess_as7t67zyd5_1788526372936` | `COMPLETED` | `0.2.0-ml2` | 48 | 2.221 | 1 | `COMPATIBLE` | `REVIEW` |
| `5d639195-4ebe-48ed-ada3-fb80a5ec128d` | `sess_z46xrrkvi6_1788957362484` | `COMPLETED` | `0.2.0-ml2` | 3 | 103 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `6bf94581-f632-4bd4-bbb1-50378db12f3f` | `sess_rh8vsn5k2p_1788951374147` | `COMPLETED` | `0.2.0-ml2` | 28 | 1.370 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `7ca52a2b-58a0-4bc2-81ec-ad4fc8a36d03` | `sess_rh8vsn5k2p_1788951662155` | `COMPLETED` | `0.2.0-ml2` | 28 | 1.367 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `a7ccea2d-c83b-4abb-b0db-188d20d4e439` | `sess_rh8vsn5k2p_1788950653559` | `COMPLETED` | `0.2.0-ml2` | 2 | 87 | 0 | `VALIDATION_ONLY` | `NOT_EVALUATED` |
| `ad759118-4386-481f-9d34-f3d496eb1854` | `sess_ehzykwkmy8_1788522459201` | `COMPLETED` | `0.2.0-ml2` | 41 | 1.940 | 3 | `COMPATIBLE` | `REVIEW` |
| `d2d44255-6487-4210-9daa-2e19f2df5ff3` | `sess_aqkhr5ky9p_1788959572467` | `COMPLETED` | `0.3.0-ml2` | 2 | 58 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |

As três sessões novas são `0d127...`, `12e508...` e `1bf9...`. Sua lineage técnica é compatível, mas a provenance de coleta continua desconhecida; por isso ficam em `REVIEW`, nunca `CANDIDATE`. A sessão `12e508...` também está `ACTIVE`.

### Integridade de payload e contagens

| Métrica DB | Resultado |
| --- | ---: |
| Batches consultados/declarados | 217 / 217 |
| Samples declarados/decodificados | 10.147 / 10.147 |
| GZIP válido/inválido | 217 / 0 |
| JSON válido/inválido | 217 / 0 |
| Arrays válidos/inválidos | 217 / 0 |
| Batch sample-count match/mismatch | 217 / 0 |
| First/last metadata match/mismatch | 217 / 0 |
| Session sample-count mismatches | 0 |
| Session batch-count mismatches | 0 |
| Schema/track/driver mismatches nos samples | 0 / 0 / 0 |
| NaN/Infinity | 0 |

PostgreSQL vence conflitos de metadata. Em particular, `a7c...` fica definitivamente com 87 samples; o valor antigo 86 do resumo de benchmark não reduz o contador autoritativo.

## Estratos, lineage e fingerprint

### PostgreSQL por build

| Build | Sessões | Batches | Samples |
| --- | ---: | ---: | ---: |
| `0.2.0-ml2` | 9 | 215 | 10.089 |
| `0.3.0-ml2` | 1 | 2 | 58 |
| Outros/desconhecidos | 0 | 0 | 0 |

### Inventário reconciliado por classificação

| Dimensão | Classe | Sessões | Samples |
| --- | --- | ---: | ---: |
| Lineage | `COMPATIBLE` | 4 | 5.796 |
| Lineage | `INFRASTRUCTURE_ONLY` | 5 | 4.264 |
| Lineage | `VALIDATION_ONLY` | 1 | 87 |
| Lineage | `REJECT` | 8 | 10.745 |
| Qualidade | `REVIEW` | 4 | 5.796 |
| Qualidade | `NOT_EVALUATED` | 6 | 4.351 |
| Qualidade | `REJECT` | 8 | 10.745 |
| Qualidade | `CANDIDATE` | 0 | 0 |

Os oito `REJECT` são os sete buffers automáticos sem lineage completa e o JSONL local sem versões/fingerprint verificáveis. A rejeição não reescreve nem declara corrupção do payload; apenas impede uso em BC sem provenance compatível.

Fingerprint PostgreSQL: 1 `MATCH`, 9 `MISSING`, 0 `MISMATCH`. Apenas o smoke J `0.3.0-ml2` registra explicitamente o fingerprint aceito. `MISSING` pré-freeze não é corrupção.

`HUMAN_REFERENCE_0_3` é **INSUFFICIENT**: há somente o smoke automático de 58 samples no build 0.3, sem demonstração humana. O único humano comprovado é `ad759...`, build 0.2, e permanece em revisão.

## Auditoria profunda final — `ad759118-4386-481f-9d34-f3d496eb1854`

### Integridade estrutural e temporal

| Campo | Resultado |
| --- | --- |
| Status | `COMPLETED` |
| Batches / samples / laps | 41 / 1.940 / 3 |
| Sequências de batch | min 0, max 40, 0 gaps, 0 duplicatas |
| Batch size | min 6, média 47,317073, p50/p95/p99/max 50/50/50/50 |
| Sample-index gaps / duplicates | 0 / 0 |
| Regressões timestamp / sampleIndex | 0 / 0 |
| NaN/Infinity | 0 |
| Track progress / action ranges inválidos | 0 / 0 |
| Schema / track / driver divergentes | 0 / 0 / 0 |
| Deltas de timestamp | 1.939 |
| Delta min / mediana / p95 / p99 | 100 / 100 / 100 / 100 ms |
| Delta média / std / máximo | 160,538405 / 2.615,940164 / 115.300,666667 ms |
| Gaps >150 / >250 / >500 / >1.000 ms | 2 / 2 / 2 / 2 |

O span real de timestamps é 311,283967 s. Os dois gaps têm quatro samples adjacentes no total.

### Ações

| Ação | Min | Max | Mean | Std | p01 | p05 | p25 | p50 | p75 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Steering | -0,9997 | 0,9982 | -0,036344 | 0,309514 | -0,991961 | -0,657880 | -0,079225 | 0 | 0 | 0,468600 | 0,955767 |
| Throttle | 0 | 1 | 0,837629 | 0,368791 | 0 | 0 | — | 1 | — | 1 | 1 |
| Brake | 0 | 1 | 0,011340 | 0,105885 | 0 | 0 | — | 0 | — | 0 | 1 |

Diagnósticos:

- steering <=-0,95: 2,319588%; steering >=0,95: 1,082474%; `abs(steering)>=0,95`: 3,402062%; aproximadamente zero (`epsilon=1e-6`): 40,360825%;
- throttle zero: 16,237113%; intermediário `(0, 0,95)`: 0%; >=0,95: 83,762887%;
- brake zero: 98,865979%; >0: 1,134021%; >=0,95: 1,134021%;
- throttle e brake simultaneamente >0,1: 0 samples, 0%.

### Estados

Cada distribuição abaixo contém 1.940 valores.

| Feature | Min | Max | Mean | Std | p01 | p05 | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| speed | 0 | 1,570000 | 1,114389 | 0,407607 | 0,010900 | 0,044095 | 1,356550 | 1,385920 | 1,416832 |
| forwardVelocity | 0 | 1,564100 | 1,111079 | 0,408882 | 0,010900 | 0,044095 | 1,355300 | 1,385705 | 1,416771 |
| lateralVelocity | -0,286700 | 0,513200 | 0,014567 | 0,078171 | -0,169725 | -0,093830 | 0 | 0,157400 | 0,340198 |
| yawRate | -0,071500 | 0,043300 | -0,001626 | 0,012713 | -0,028900 | -0,024500 | 0 | 0,021500 | 0,030661 |
| slipAngle | -0,437400 | 0,449000 | 0,012330 | 0,086568 | -0,266753 | -0,087620 | 0 | 0,169310 | 0,374391 |
| steeringAngle | -0,999600 | 0,998000 | -0,036441 | 0,309652 | -0,991283 | -0,663180 | 0 | 0,466795 | 0,952900 |
| crossTrackError | -16,593000 | 23,104000 | 2,801515 | 7,572125 | -12,253660 | -8,128100 | 1,947000 | 19,860100 | 22,145740 |
| headingError | -1,654200 | 0,568600 | -0,010671 | 0,244409 | -0,723870 | -0,414905 | 0,006400 | 0,496500 | 0,546300 |
| distanceToLeftEdge | -11,104000 | 28,593000 | 9,198485 | 7,572125 | -10,145740 | -7,860100 | 10,053000 | 20,128100 | 24,253660 |
| distanceToRightEdge | -4,593000 | 35,104000 | 14,801515 | 7,572125 | -0,253660 | 3,871900 | 13,947000 | 31,860100 | 34,145740 |
| currentCurvature | 0 | 0,099720 | 0,007427 | 0,010695 | 0 | 0,000020 | 0,003105 | 0,028651 | 0,050403 |
| futureCurvature5m | 0 | 0,156350 | 0,007717 | 0,012477 | 0 | 0,000020 | 0,003160 | 0,028634 | 0,058572 |
| futureCurvature10m | 0 | 0,117170 | 0,007179 | 0,010996 | 0 | 0,000020 | 0,002950 | 0,029101 | 0,054000 |
| futureCurvature20m | 0 | 0,156350 | 0,006873 | 0,011484 | 0,000004 | 0,000020 | 0,002905 | 0,028127 | 0,056175 |
| trackProgress | 0,000280 | 0,999640 | 0,478860 | 0,295023 | 0,012519 | 0,057265 | 0,493555 | 0,949007 | 0,989088 |

### Superfícies

| Surface | Samples | Percentual |
| --- | ---: | ---: |
| `TARMAC` | 1.700 | 87,628866% |
| `KERB` | 48 | 2,474227% |
| `RUNOFF` | 34 | 1,752577% |
| `GRAVEL` | 158 | 8,144330% |
| Unknown/other | 0 | 0% |

### Episódios de evento

Uma sequência contínua de flags forma um único episódio. Timestamps estão em milissegundos no relógio da sessão.

| Evento | Lap | SampleIndex início-fim | Timestamp início-fim | Samples | Duração (s) |
| --- | ---: | --- | --- | ---: | ---: |
| OFF_TRACK | 1 | 0–0 | 58681,266667–58681,266667 | 1 | 0,1 |
| OFF_TRACK | 1 | 121–125 | 70781,266667–71181,266667 | 5 | 0,5 |
| OFF_TRACK | 1 | 459–473 | 104581,266667–105981,266667 | 15 | 1,5 |
| OFF_TRACK | 1 | 527–548 | 111381,266667–113481,266667 | 22 | 2,2 |
| OFF_TRACK | 2 | 708–842 | 129481,266667–260265,233333 | 135 | 130,883967 |
| OFF_TRACK | 2 | 857–866 | 261765,233333–262665,233333 | 10 | 1,0 |
| OFF_TRACK | 2 | 1107–1109 | 286765,233333–286965,233333 | 3 | 0,3 |
| OFF_TRACK | 3 | 1671–1671 | 343165,233333–343165,233333 | 1 | 0,1 |
| SPIN | 1 | 26–27 | 61281,266667–61381,266667 | 2 | 0,2 |
| SPIN | 1 | 461–461 | 104781,266667–104781,266667 | 1 | 0,1 |
| SPIN | 1 | 530–530 | 111681,266667–111681,266667 | 1 | 0,1 |
| SPIN | 2 | 669–671 | 125581,266667–125781,266667 | 3 | 0,3 |
| SPIN | 2 | 1230–1231 | 299065,233333–299165,233333 | 2 | 0,2 |
| SPIN | 3 | 1737–1739 | 349765,233333–349965,233333 | 3 | 0,3 |
| SPIN | 3 | 1808–1810 | 356865,233333–357065,233333 | 3 | 0,3 |

Não há episódio de `COLLISION`. O episódio OFF_TRACK 708–842 cruza o maior gap temporal; sua duração de 130,883967 s é o span dos timestamps, enquanto os 135 samples observados equivalem nominalmente a 13,5 s a 10 Hz. Não se inventa o estado durante o intervalo sem samples.

Totais: OFF_TRACK 192 samples em 8 episódios; SPIN 15 em 7; COLLISION 0. Dois samples têm flags OFF_TRACK e SPIN simultâneas, portanto a união event-flagged é 205, não 207.

### Voltas

| Lap | Lap time (s) | Samples | Off-track | Collision | Spin | Avg speed | Max speed | Valid |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 62,205 | 623 | 43 | 0 | 4 | 1,1575 | 1,5700 | não |
| 2 | 190,917 | 736 | 148 | 0 | 5 | 0,9880 | 1,4285 | não |
| 3 | 58,133 | 581 | 1 | 0 | 6 | 1,2282 | 1,4274 | não |

As contagens relacionais são coerentes com os samples: 623+736+581=1.940; off-track 43+148+1=192; spin 4+5+6=15; collision=0. As três voltas são inválidas no diagnóstico.

### Clean-candidate diagnostic

| Categoria | Samples |
| --- | ---: |
| `RAW_SAMPLES` | 1.940 |
| `EVENT_FLAGGED_SAMPLES` | 205 |
| `STRUCTURALLY_INVALID_SAMPLES` | 0 |
| `TEMPORAL_GAP_ADJACENT_SAMPLES` | 4 |
| `UNFLAGGED_SAMPLES` | 1.735 |

As categorias são calculadas por união de índices para evitar double counting. Os quatro samples adjacentes aos gaps já estão entre os 205 event-flagged e, por isso, não reduzem novamente o total. Explicitamente: **`UNFLAGGED_SAMPLES != FINAL_TRAINING_SAMPLES`**. Nenhum sample é aceito definitivamente para treino nesta fase.

## Correção de tooling da finalização

O CLI agora aceita `--cloud-artifact` somente após validar:

- igualdade do SHA-256 canônico armazenado e recalculado;
- `CLOUD_POSTGRES=AVAILABLE_FULL`;
- contagem coerente de sessões cloud;
- contadores aprimorados de GZIP/JSON/array/count/first-last;
- todas as distribuições, superfícies, episódios, integridade de batch e clean estimate da sessão humana.

O quick benchmark `a7c...` foi registrado como automático conhecido. A API pública passa a ser reconciliada após a descoberta cloud, cobrindo todos os UUIDs disponíveis. O modo de artifact não acessa PostgreSQL e rejeita snapshots antigos ou adulterados.

## Verificação e segurança

- `npm.cmd run test:ml3:inventory`: 36/36 checks passaram;
- `npm.cmd run test:ml22:final`: 344 checks passaram, incluindo o build do gate;
- `npm.cmd run build`: Vite 8.2.2, 45 módulos transformados, sucesso;
- `git diff --check`: sucesso;
- nenhum arquivo versionado contém a URL PostgreSQL real, password real, bearer real, `ingestToken` real ou `refreshCredential` real.

Identificadores como `DATABASE_URL`, `ingestToken` e `refreshCredential` continuam legitimamente presentes em configuração, código e testes. Os únicos textos que têm formato de URI/JWT/password são placeholders de `.env.example`, fixtures negativas, credenciais locais fictícias, um bearer propositalmente inválido e verificações de prefixo. Nenhum deles é a credencial usada para produzir os artifacts.

## ML3.0 Completion Decision

**ML3.0 COMPLETE: YES.**

Critérios atendidos:

- inventário PostgreSQL integral `AVAILABLE_FULL`;
- 217/217 GZIPs, JSONs, arrays, counts e first/last metadata verificados;
- 10.147 samples declarados e decodificados sem divergência;
- deep audit completo de `ad759...`, incluindo estados, superfícies, eventos, laps e clean estimate;
- reconciliação PostgreSQL/artifacts/documentação/API/JSONL concluída sem double counting;
- provenance desconhecida não promovida;
- hashes canônicos reproduzidos;
- testes, gate ML2.2, build, security scan e `git diff --check` exigidos antes do commit final.

**ML3.1 iniciado: NO.** A seleção/segmentação de dados e qualquer treino permanecem fora desta fase.
