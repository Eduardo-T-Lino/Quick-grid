# Runtime dataset generation `runtime-0.6.3-ml2-schema3-g1`

Status: `CONTRACT_FROZEN_NO_DATA`.

This directory versions only the generation contract, canonical orders and hashes. It contains no telemetry, canonical dataset or split artifact.

## Storage boundary

- Raw telemetry and large derived datasets stay outside Git in access-controlled durable storage.
- `artifacts/` is a local cache only and cannot satisfy a promotion gate.
- A database may be an ingestion source, but cannot be the sole copy of a derived dataset.
- A future promoted artifact must provide a durable provider-agnostic object reference, SHA-256 and byte size.
- Clean-machine recovery and checksum verification are required before promotion.

`checksums.sha256` records the canonical SHA-256 of `manifest.json` with its self-declared `manifestSha256` field omitted. This avoids a self-referential file hash while still detecting semantic manifest mutation.
