# ML runtime dataset generation decision

Status: **architecture decision implemented by the frozen ML3.5 contract; collection not started**.

Implemented phase: **ML3.5 — Runtime Dataset Contract and Durable Registry**. See [ml3_5_runtime_dataset_contract.md](./ml3_5_runtime_dataset_contract.md).

## Context and lineage isolation

The current runtime contract in `src/ml/lineage/baselineManifest.js` is:

- telemetry schema: `2`;
- game build: `0.6.3-ml2`;
- physics: `1.8.3-gt3-drift-coast`;
- track geometry: `1.5.0-centripetal`;
- feature manifest: `2.1.0`;
- simulation fingerprint: `53193ebb1921ecd3f56638054d0acf8fa31d1d7c7647f0e85349a32b96319173`.

The following lineages are separate strata and must never be combined silently:

| Stratum | Role | Allowed use |
| --- | --- | --- |
| `0.2.0-ml2` | archived `ad759...` evidence/dataset | historical audit and pipeline-smoke record only |
| `0.3.0-ml2` | accepted historical freeze | regression/freeze verification only |
| `0.6.3-ml2` plus its full fingerprint | current runtime | source lineage for a new dataset generation |

A new dataset version must contain exactly one fully specified lineage/fingerprint. Compatibility must be an explicit transformation with a new version and manifest, never concatenation across strata.

## Schema decision

Selected **strategy A: define a new telemetry schema and feature contract before the next collection**.

The current physics has boost and drift/coast behavior, while Schema V2 and feature manifest `2.1.0` expose only `steering`, `throttle` and `brake` action targets. They do not encode boost intent/effective activation or the causal boost state (for example charge, active/delay/cooldown and carry/coast state). A full current-runtime driving policy therefore cannot learn or reproduce the new control from the historical target contract without hidden state or label loss.

ML3.5 freezes **Schema V3**, feature/action manifest `3.0.0` and the field-level contract in [ml3_5_runtime_dataset_contract.md](./ml3_5_runtime_dataset_contract.md). The active V2 collector and historical readers are not mutated by this decision.

ML3.5 versions and freezes the new schema/feature manifest before collecting data. The contract:

- represents every controllable action, separating boost request from effective state;
- includes the causal vehicle/control state needed to interpret those actions;
- defines ranges, units, capture timing and validation for each field;
- mints a new simulation fingerprint and dataset generation identifier;
- preserves Schema V2 as an immutable historical reader rather than mutating it in place.

Strategy B, a restricted V2 subset, is permitted only for an explicitly boost-disabled experiment after a versioned proof that all omitted controls and states are causally irrelevant. It is not sufficient by default and must not be used for a full current-runtime policy.

## Durable persistence and dataset registry

No reproducibility-critical dataset may exist only under ignored local `artifacts/`. The next pipeline uses a versioned registry as the source of truth:

```text
dataset-registry/
  registry.json
  <dataset-version>/
    manifest.json
    checksums.sha256
    derived/              # only small, sanitized, reviewable artifacts
```

The registry files and manifests are versioned in Git. Each immutable version manifest records at least the dataset ID/version, complete lineage and fingerprint, schema/feature contract versions, collection scope and consent class, row/session/group counts, source and derived SHA-256 values, byte sizes, creation tooling version, split algorithm/version, storage object identifiers and availability status. A manifest may point to data but never substitute invented metadata for missing data.

Storage policy:

- raw telemetry remains outside Git in access-controlled durable storage;
- large canonical and split datasets live in persistent artifact/object storage, addressed by immutable version and checksum;
- small sanitized derived artifacts may be versioned when repository size and privacy policy permit;
- manifests and hashes are always versioned;
- the database may be an ingestion/source system, but is never the only copy of derived artifacts;
- every promoted dataset has at least one durable data copy plus its independent Git-versioned manifest; recovery is verified from a clean machine before promotion;
- local ignored `artifacts/` is only a cache or staging area and is reconstructible from the registry.

This decision does not select or provision a paid service. A later collection phase may use an approved existing repository release, organization object store or other durable backend, provided access control, retention, immutability and checksum verification satisfy the manifest contract.

## Promotion gates for the new generation

Before any training or split materialization:

1. freeze the new schema, feature/action contract and runtime fingerprint;
2. register the collection plan and immutable dataset version;
3. collect only that lineage and reject mixed-lineage input;
4. validate raw integrity and publish durable source checksums;
5. build and validate the canonical dataset deterministically;
6. upload the immutable large artifact, version its manifest, and prove clean-machine recovery;
7. only then run deterministic group-aware splitting and publish its manifest.

ML3.5 starts no collection, dataset materialization, training or ML4 work. The next recommended phase is **ML3.6 — V3 Telemetry Capture and Collection Readiness**.
