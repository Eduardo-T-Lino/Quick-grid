# ML3.4 — Deterministic Dataset Splitting

Status: **tooling implementado e validado; materialização real bloqueada porque o artifact canônico ML3.3 não está disponível localmente**. ML3.4 não está completa.

## Contrato de entrada

O splitter aceita exclusivamente o dataset canônico já validado na ML3.3:

- datasetVersion: `ML3.3-1`;
- datasetSha256: `646963ddfb664343e195620ad4fe87e2d810e7d6ee2d8beb179fc581e9a58ab0`;
- sourceEvidenceSha256: `1883f86b98ddf8467d332a43fb587cf88e1432ee0a70231f2addb90758bfccde`;
- lineageStratum: `0.2.0-ml2`;
- rows: 1.190.

Além de conferir esses valores, o splitter recalcula o SHA canônico, valida o estado do artifact (`canonicalDataset: true`, `finalTrainingDataset: false`, `splitApplied: false`, `shuffled: false`), a ordenação, a unicidade de identidades, a provenance e o lineage de cada row. Runtime `0.6.x` não é aceito.

## Grupos temporais reais

O dataset ML3.3 não contém um ID artificial de segmento. Por isso, um grupo é uma sequência máxima de `sampleIndex` consecutivos dentro da mesma combinação real de:

- `provenance.source`;
- `provenance.collectionKind`;
- `provenance.localCollectionSessionId`;
- `identity.sessionId`;
- `identity.sampleSessionId`;
- `identity.lapNumber`.

Uma mudança em qualquer campo, volta ou uma lacuna em `sampleIndex` encerra o grupo. O manifest identifica cada grupo por esse composto mais `startSampleIndex` e `endSampleIndex`; nenhum ID ausente do schema é inferido.

## Alocação determinística

Os grupos permanecem na ordem canônica original. O algoritmo `ORDERED_CONTIGUOUS_GROUP_CUTS` versão `1.0.0` avalia dois cortes entre grupos inteiros e escolhe a partição com menor desvio absoluto total dos targets de rows:

- train: 70%;
- validation: 15%;
- test: 15%.

Empates usam o primeiro corte de train e depois o primeiro corte de validation. Nenhuma row é embaralhada. Com pelo menos três grupos, todos os splits recebem ao menos um grupo.

O manifest contém o SHA do dataset fonte, lineage, algoritmo/versionamento, contagens de rows e grupos, grupos atribuídos com todas as sample identities, checks de leakage, `splitApplied: true`, `finalTrainingDataset: false` e `splitManifestSha256` calculado sobre sua serialização canônica.

## Limite de avaliação

Existe somente uma sessão humana histórica principal. Portanto um fallback por intervalos dentro dessa sessão é marcado como `HISTORICAL_SINGLE_SESSION_PIPELINE_SMOKE`, com `independentSessionGeneralization: false`. Esse split serve para validar o pipeline e smoke tests históricos; ele não constitui avaliação independente de generalização entre sessões.

## Execução

```powershell
npm.cmd run ml3:split -- `
  --dataset artifacts/ml3_canonical_dataset_ad759.json `
  --output artifacts/ml3_dataset_split_ad759.json
```

O caminho de output deve ser diferente do input. O dataset fonte não é modificado. `artifacts/` permanece ignorado e nenhum artifact de split deve ser commitado.

No checkout em que este tooling foi fechado, `artifacts/ml3_canonical_dataset_ad759.json` não estava presente. O processo não sintetizou rows, não inferiu conteúdo a partir dos hashes e não materializou um split: `CANONICAL_DATASET_ARTIFACT_MISSING`.

## Fora de escopo

- normalização, augmentation, balanceamento ou shuffle por row;
- treinamento ou promoção para dataset final de treino;
- alteração de ML3.0–ML3.3, raw data, evidence ou dataset canônico;
- alteração de freeze, schema, features, física ou `acceptedBaseline.js`;
- ML4.
