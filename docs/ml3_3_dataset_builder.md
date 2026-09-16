# ML3.3 — Canonical Dataset Builder

Status: **COMPLETE — tooling implementado, validado e materialização cloud real concluída**. A fase constrói um artifact canônico a partir das decisões já congeladas na ML3.2. Ela não recalcula acceptance, não treina modelo, não cria splits e não inicia ML3.4.

## Entradas imutáveis

O builder exige simultaneamente:

- inventário ML3.0 com SHA canônico `ade0e99d5162eeea75dfeea9aa70068b64588d025d33d35b5cf7ea335a3ffe68`;
- evidence ML3.2-B com SHA válido e mismatch counts iguais a zero;
- samples raw autoritativos relidos do PostgreSQL em `REPEATABLE READ READ ONLY`.

As máscaras `ACCEPTED` da evidence são a única fonte de inclusão. O builder não importa nem executa os avaliadores de qualidade para decidir novamente quais samples entram. As máscaras `REJECTED` nunca materializam rows.

## Contrato canônico

Cada row contém:

- provenance original da máscara;
- `sessionId`, `sampleSessionId`, `lapNumber` e `sampleIndex`;
- metadata completa do lineage congelado;
- vetor `observation` na ordem de `BASELINE_MANIFEST.featureManifest.observationFeatures`;
- vetor `target` na ordem de `BASELINE_MANIFEST.featureManifest.actionTargets`.

O mapeamento usa o mesmo objeto raw para produzir `State(t) -> Action(t)`, sem deslocamento temporal. `trackState.surface` é convertido no índice ordinal da ordem congelada `TARMAC`, `KERB`, `RUNOFF`, `GRAVEL`; essa codificação preserva as 16 posições do manifest e fica declarada no header do dataset. Nenhuma normalização estatística é aplicada.

Um artifact aceita exatamente um `lineageStratum`. `0.2.0-ml2` e `0.3.0-ml2` usam o manifest histórico, mas produzem datasets e fingerprints separados. Runtime `0.6.x` não pode entrar nesses artifacts históricos.

Duplicatas, identidades incompletas, provenance ambígua, raw sample ausente, evidence adulterada, mismatch com o freeze ou mistura de lineage encerram a construção sem output.

## Execução

```powershell
npm.cmd run ml3:dataset -- `
  --inventory artifacts/ml3_dataset_inventory.json `
  --evidence artifacts/ml3_segment_evidence_ad759.json `
  --output artifacts/ml3_canonical_dataset_ad759.json
```

O output é ordenado por sessão, volta e `sampleIndex`, serializado canonicamente e recebe `datasetSha256`. O `Map samplesBySession` é limpo antes da escrita. O diretório `artifacts/` permanece ignorado e não deve ser commitado.

## Referência `ad759...`

A materialização real foi concluída com os seguintes dados:

- session: `ad759118-4386-481f-9d34-f3d496eb1854`;
- datasetVersion: `ML3.3-1`;
- lineageStratum: `0.2.0-ml2`;
- source: 1.940 samples, com 1.190 aceitos e 750 rejeitados;
- coverage: `61.340206%`;
- intervals: 8 aceitos e 7 rejeitados;
- sourceEvidenceSha256: `1883f86b98ddf8467d332a43fb587cf88e1432ee0a70231f2addb90758bfccde`;
- rows: 1.190;
- datasetSha256: `646963ddfb664343e195620ad4fe87e2d810e7d6ee2d8beb179fc581e9a58ab0`;
- finalTrainingDataset: `false`;
- splitApplied: `false`.

A evidence foi validada pelo builder e as 1.190 masks aceitas produziram exatamente 1.190 rows. O artifact materializado permanece ignorado e não integra o repositório.

O SHA do dataset não é inferido da evidence: ele depende dos vetores extraídos dos raw samples autoritativos. Sem `DATABASE_URL` disponível no processo, a tentativa termina em `CLOUD_FULL_INVENTORY_BLOCKED:DATABASE_URL_MISSING` e não cria artifact.

## Limites

- `canonicalDataset: true`, mas `finalTrainingDataset: false`;
- sem normalização, augmentation, balanceamento, shuffle ou split;
- sem treino;
- sem alteração de raw data, evidence, freeze, schema, features, física ou `acceptedBaseline.js`;
- ML3.4 não iniciada.
