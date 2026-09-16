# ML3.4 — Deterministic Dataset Splitting

`ML3.4_HISTORICAL = ARCHIVED_UNMATERIALIZED`

The deterministic split tooling is implemented and covered by local tests. The historical `ad759...` materialization was never completed and must not be represented as an existing split.

## Archived historical record

The single-session pipeline is retained as `ARCHIVED_HISTORICAL_PIPELINE_SMOKE`, not as a dataset available for current training:

- session: `ad759118-4386-481f-9d34-f3d496eb1854`;
- lineage: `0.2.0-ml2`;
- ML3.2: 1,940 total, 1,190 accepted and 750 rejected;
- ML3.2 evidence SHA-256: `1883f86b98ddf8467d332a43fb587cf88e1432ee0a70231f2addb90758bfccde`;
- ML3.3: 1,190 rows, `finalTrainingDataset: false`, `splitApplied: false`;
- ML3.3 dataset SHA-256: `646963ddfb664343e195620ad4fe87e2d810e7d6ee2d8beb179fc581e9a58ab0`.

These values are immutable historical audit records. The original ML3.3 artifact was lost after a computer change, a complete local search returned `ARTIFACT_RECOVERY_NOT_FOUND`, and the legacy PostgreSQL source later returned `DATABASE_READ_BLOCKED:CLOUD_QUERY_FAILED`. No artifact was fabricated, no historical hash was changed, and no old evidence or dataset was promoted for training.

The historical pipeline remains auditable through the versioned documentation, code, tests and hashes above. Its evaluation limitation remains explicit: `independentSessionGeneralization: false`.

## Tooling contract

The generic splitter still validates a supplied ML3.3 canonical dataset before use. For the archived input, its immutable contract is:

- dataset version `ML3.3-1`;
- dataset SHA-256 `646963ddfb664343e195620ad4fe87e2d810e7d6ee2d8beb179fc581e9a58ab0`;
- source evidence SHA-256 `1883f86b98ddf8467d332a43fb587cf88e1432ee0a70231f2addb90758bfccde`;
- lineage `0.2.0-ml2`;
- 1,190 rows.

It recalculates the canonical SHA, checks provenance and identities, and rejects incompatible runtime lineage. It never queries PostgreSQL, uses a hidden `DATABASE_URL`, or falls back to session `ad759...`; input and output paths must be explicit.

Temporal groups are maximal consecutive `sampleIndex` sequences with the same real provenance, session and lap identity. `ORDERED_CONTIGUOUS_GROUP_CUTS` version `1.0.0` assigns complete ordered groups toward 70/15/15 targets without row shuffle. The tests verify preservation of the exact row union plus sample, group and temporal-boundary disjointness.

Because the canonical historical artifact is unavailable, there are no real train/validation/test counts and no split-manifest SHA to report. The old single-session fallback would only have been `HISTORICAL_SINGLE_SESSION_PIPELINE_SMOKE`, never independent generalization evidence.

## Operational boundary

Normal future ML work must not depend on the historical `DATABASE_URL`, session `ad759...`, or the lost ignored ML3.2/ML3.3 artifacts. `ml3:recover:historical` remains only as `LEGACY_OPTIONAL_RECOVERY` for audit or best-effort recovery and is not a phase gate.

The next data generation is defined separately in [ml_runtime_dataset_generation_decision.md](./ml_runtime_dataset_generation_decision.md). This archive does not start data collection, training or ML4.
