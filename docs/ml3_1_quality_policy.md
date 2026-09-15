# ML3.1 — Quality Rules & Segment Acceptance Policy

Status: **INICIADA**. Esta fase define e testa regras determinísticas de qualidade. Ela não treina modelo, não materializa dataset final, não seleciona definitivamente samples e não inicia ML3.2.

## Evidência de entrada e limites

A política `ML3.1-1` está ancorada no inventário canônico ML3.0 de SHA-256 `ade0e99d5162eeea75dfeea9aa70068b64588d025d33d35b5cf7ea335a3ffe68`, reconciliado no commit `677df6fe58e04370cdc2c8990bd084221c5abdc1`.

Evidência relevante do freeze:

- PostgreSQL: 10 sessões, 217 batches e 10.147 samples declarados/decodificados;
- 217/217 GZIPs e JSONs válidos, zero count mismatch e zero NaN/Infinity;
- `ad759118-4386-481f-9d34-f3d496eb1854`: 1.940 samples, 205 event-flagged, quatro adjacentes a gaps e 1.735 unflagged;
- as três voltas humanas possuem flags e são inválidas como volta integral;
- `HUMAN_REFERENCE_0_3`: `INSUFFICIENT`;
- `UNFLAGGED_SAMPLES != FINAL_TRAINING_SAMPLES` permanece uma invariável normativa.

O código da política importa a linhagem histórica de `src/ml/lineage/acceptedBaseline.js`. O manifesto de runtime 0.6.x não redefine retrospectivamente essa referência.

## Vocabulário de decisão

| Decisão | Semântica |
| --- | --- |
| `ELIGIBLE` | O item satisfaz as regras deste nível e pode avançar ao nível seguinte. Não significa inclusão final em treino. |
| `SEGMENT_ONLY` | A volta integral não é elegível, mas regiões localizadas podem ser avaliadas como segmentos após janelas de exclusão. |
| `REVIEW_REQUIRED` | Falta evidência determinística suficiente; não há promoção automática. |
| `INELIGIBLE` | Uma regra determinística foi violada. |
| `NON_TRAINING` | Evidência automática/de infraestrutura pode validar tooling, mas não é demonstração humana. |

Todas as decisões retornam `finalTrainingEligible: false`. A ML3.1 decide somente se uma unidade pode avançar na avaliação de qualidade.

## Cinco níveis independentes

### 1. Lineage eligibility

A linhagem usa exclusivamente os campos gravados na sessão. Data, nome de arquivo ou proximidade com um release não substituem metadata.

| Estrato | Regra |
| --- | --- |
| `0.2.0-ml2` | Schema 2, geometria `1.5.0-centripetal`, física `1.5.0-gt3` e feature manifest `2.1.0`. Fingerprint ausente é tolerado apenas como condição histórica pré-freeze já inventariada; fingerprint presente deve ser o aceito. |
| `0.3.0-ml2` | Mesmos schema/geometria/física/features e fingerprint aceito obrigatório. É um estrato separado de 0.2. |
| runtime `0.6.x` | Fora dos dois estratos históricos; não entra automaticamente na política de treino ML3.1. |

Uma partição só é elegível quando contém exatamente um estrato. Misturar 0.2 com 0.3, ou qualquer um deles com runtime 0.6.x, produz `CROSS_LINEAGE_MIX_PROHIBITED`/`INELIGIBLE`.

### 2. Session eligibility

Somente sessão `HUMAN`, `COMPLETED`, `PLAYER_ONLY`, com driver type exclusivamente `PLAYER`, payload raw disponível, 10 Hz, contagens positivas e auditoria aprimorada completa pode ser `ELIGIBLE`.

São blockers determinísticos:

- provenance desconhecida: `REVIEW_REQUIRED`;
- coleta automática: `NON_TRAINING`;
- sessão ativa/incompleta, escopo ou driver incompatível, payload corrupto ou taxa diferente: `INELIGIBLE`;
- ausência de auditoria estrutural, temporal ou de payload: `REVIEW_REQUIRED`;
- GZIP/JSON/array/count/first-last inválido, batch/sample gap estrutural, duplicata, regressão ou mismatch: `INELIGIBLE`.

Gaps de timestamp com índices contínuos não invalidam sozinhos a sessão: tornam-se fronteiras obrigatórias de segmento. Isso preserva partes potencialmente úteis sem inventar estados no intervalo ausente.

### 3. Lap eligibility

Uma volta depende de sessão elegível e precisa ter número, tempo, quantidade de samples, validade e contadores de eventos comprovados.

- `validLap=true` e zero off-track/collision/spin: `ELIGIBLE`;
- off-track ou spin localizado, sem collision: `SEGMENT_ONLY`;
- collision: `INELIGIBLE`, com exclusão do restante da volta;
- inconsistência entre `validLap` e contadores: `INELIGIBLE` ou `REVIEW_REQUIRED`, conforme a evidência disponível.

`SEGMENT_ONLY` não aceita a volta nem seus samples. Apenas autoriza a etapa seguinte a testar janelas limpas.

### 4. Segment eligibility

Esta fase define o contrato de avaliação, mas não varre o payload para construir os segmentos finais.

| Regra | Valor ML3.1-1 |
| --- | --- |
| Janela | 50 samples, nominalmente 5 s a 10 Hz |
| Delta adjacente aceito | 50 a 150 ms, estritamente crescente |
| Fronteiras | Não cruzar sessão, volta, gap, estrato de lineage ou descontinuidade de sampleIndex |
| Superfícies | Apenas `TARMAC` e `KERB` |
| Integridade | Zero número inválido, action fora de range ou sample estruturalmente inválido |
| Contexto | Evidência pré/pós completa para aplicar todas as janelas de exclusão |

Janelas temporais de exclusão:

| Evento | Antes | Depois |
| --- | ---: | ---: |
| Off-track | 1 s | 2 s |
| Spin | 2 s | 3 s |
| Collision | 2 s | restante da volta |
| `isRecovering` | 0 s | 2 s |
| Gap >150 ms | 1 s | 1 s |

Qualquer sobreposição com essas janelas torna o segmento `INELIGIBLE`. A geração dos candidatos e a contagem de quantos passam ficam fora desta entrega e não podem ser inferidas a partir de `UNFLAGGED_SAMPLES`.

### 5. Sample eligibility

Um sample só pode ser `ELIGIBLE` dentro de segmento já elegível e com todas as evidências explícitas:

- campos causais V2 presentes e números finitos;
- actions nos ranges do schema;
- superfície `TARMAC` ou `KERB`;
- flags de evento limpas;
- fora das janelas de evento e gap;
- mesma sessão, volta e estrato do segmento.

Um objeto que informe apenas `unflagged=true` resulta em `REVIEW_REQUIRED`. Mesmo um sample `ELIGIBLE` mantém `finalTrainingEligible=false`.

## Aplicação ao inventário atual

### Sessão humana `ad759...`

- lineage 0.2 histórica: `ELIGIBLE` no próprio estrato;
- sessão completa e payload íntegro: `ELIGIBLE` para avaliação de laps/segmentos;
- dois gaps >150 ms: fronteiras obrigatórias, nunca interpoladas;
- laps 1, 2 e 3: `SEGMENT_ONLY` por off-track/spin, sem collision;
- 1.735 unflagged: diagnóstico de inventário, não contagem aceita;
- segmentos elegíveis: **não calculados nesta fase**;
- samples finais de treino: **não calculados nem aprovados**.

### Referência humana 0.3

O único registro 0.3 do inventário é automático e permanece `NON_TRAINING`. Portanto `HUMAN_REFERENCE_0_3` continua **INSUFFICIENT**.

## Implementação e verificação

- `scripts/ml3/qualityPolicy.js`: constantes imutáveis e avaliadores puros dos cinco níveis;
- `scripts/test_ml3_quality_policy.js`: regressão determinística, incluindo isolamento de lineage, hierarquia, gaps, eventos, superfícies e a não promoção de unflagged;
- `npm.cmd run test:ml3:quality`: gate dedicado da ML3.1.

Física, IA, schema, sample rate, backend, banco, dados raw e `acceptedBaseline.js` não são modificados por esta fase.

## Estado de fases

- **ML3.0 COMPLETE: YES**.
- **ML3.1 iniciado: YES** — política determinística implementada localmente para revisão.
- **ML3.2 iniciado: NO**.
