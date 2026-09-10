# ML3.0-B — Cloud inventory completion and human-session deep audit

## Scope and evidence status

This report completes the analysis that can be proven from the read-only PostgreSQL snapshot already produced outside Codex. It does not start ML3.1, train a model, define a final segment filter, change telemetry/physics/schema/sample rate, or mutate the database.

The original artifacts were copied unchanged into the isolated ML3 worktree and remain Git-ignored:

| Artifact | Status | Canonical SHA-256 |
| --- | --- | --- |
| `artifacts/ml3_dataset_inventory.json` | full cloud snapshot plus local/documented sources | `b76f9c33bfcfd67d3d754831d28ba6540822b78052352f82c2ea6c20addc8adc` |
| `artifacts/ml3_human_session_inventory.json` | directed human-session snapshot | `b482229950b55488e1212f162261feb488b41217bfa7efe620fc479c3b5c8688` |

`CLOUD_POSTGRES=AVAILABLE_FULL` is present in both artifacts. The consolidated artifact was generated before the inventory improvements in this branch. Consequently, this report distinguishes measured facts from fields that require one new read-only run before the final inventory can be frozen.

Baseline preserved:

| Field | Value |
| --- | --- |
| Immutable tag | `ml2.2-accepted` |
| Accepted commit | `a8bb80c7581298eb473eb84089ca9c4835a33763` |
| Inventory branch base | `b64c6b9dc847473a048f661ac4d349ecdccfa0ff` |
| Schema | `2` |
| Accepted game-build strata | `0.2.0-ml2`, `0.3.0-ml2` |
| Physics | `1.5.0-gt3` |
| Track geometry | `1.5.0-centripetal` |
| Feature manifest | `2.1.0` |
| Sampling / simulation | 10 Hz / 60 Hz fixed timestep |
| Accepted fingerprint | `919c932171a41a44d40af1d86df530a8f3db911b030691b68908766712a6c16c` |

## Complete PostgreSQL discovery

The database snapshot contains **10 sessions, 217 batches and 10,147 declared/decoded samples**. All ten sessions use Schema 2, track 21, `PLAYER_ONLY`, physics `1.5.0-gt3`, geometry `1.5.0-centripetal`, feature manifest `2.1.0`, and only `PLAYER` samples.

| Session | Provenance | Status | Build | Batches | DB samples | Laps | Lineage | Quality after this branch |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `014398f2-d1ce-4c40-8bcb-3a65a1008065` | benchmark H infrastructure | `COMPLETED` | `0.2.0-ml2` | 28 | 1,366 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `0d127bd9-1781-4315-8eb0-4eb81731b224` | newly discovered, unknown collection provenance | `COMPLETED` | `0.2.0-ml2` | 21 | 1,022 | 0 | `COMPATIBLE` | `REVIEW` |
| `12e508e5-9688-4414-8e56-42186677bf65` | newly discovered, unknown collection provenance | `ACTIVE` | `0.2.0-ml2` | 16 | 613 | 0 | `COMPATIBLE` | `REVIEW` |
| `1bf9eec6-ac72-4dd5-98da-470e748ec844` | newly discovered, unknown collection provenance | `COMPLETED` | `0.2.0-ml2` | 48 | 2,221 | 1 | `COMPATIBLE` | `REVIEW` |
| `5d639195-4ebe-48ed-ada3-fb80a5ec128d` | token-refresh I infrastructure | `COMPLETED` | `0.2.0-ml2` | 3 | 103 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `6bf94581-f632-4bd4-bbb1-50378db12f3f` | benchmark H infrastructure | `COMPLETED` | `0.2.0-ml2` | 28 | 1,370 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `7ca52a2b-58a0-4bc2-81ec-ad4fc8a36d03` | benchmark H infrastructure | `COMPLETED` | `0.2.0-ml2` | 28 | 1,367 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |
| `a7ccea2d-c83b-4abb-b0db-188d20d4e439` | quick benchmark C validation | `COMPLETED` | `0.2.0-ml2` | 2 | 87 | 0 | `VALIDATION_ONLY` | `NOT_EVALUATED` |
| `ad759118-4386-481f-9d34-f3d496eb1854` | validated human | `COMPLETED` | `0.2.0-ml2` | 41 | 1,940 | 3 | `COMPATIBLE` | `REVIEW` |
| `d2d44255-6487-4210-9daa-2e19f2df5ff3` | lineage-smoke J infrastructure | `COMPLETED` | `0.3.0-ml2` | 2 | 58 | 0 | `INFRASTRUCTURE_ONLY` | `NOT_EVALUATED` |

The three `0d127...`, `12e508...`, and `1bf9...` rows are the new sessions found by integral DB discovery. Version lineage is compatible, but no evidence identifies them as human demonstrations. They must remain `REVIEW`; the earlier artifact's `CANDIDATE` label is superseded by the corrected policy in this branch. The active session `12e508...` cannot be a completed training candidate in any case.

### GZIP, JSON, counts, and batches

The artifact records raw payload availability for all ten sessions, zero `payloadCorrupt`, and exact equality between decoded and declared counts for every session. Therefore the prior collector successfully gunzipped and JSON-parsed all **217/217 batches**, obtained arrays for all batches, and decoded **10,147/10,147 samples**. There are **0 invalid GZIP**, **0 invalid JSON/array payloads**, **0 per-session declared-vs-decoded mismatches**, **0 session batch-count mismatches**, **0 duplicate samples**, and **0 invalid numeric values** in the cloud snapshot.

One reconciliation defect exists in the old consolidated artifact: `a7c...` has DB declared/decoded count **87**, while the top-level merged row retained **86** from an earlier validation artifact. Thus the old consolidated summary says 10,146 known-build cloud samples and 20,891 overall samples, each one below the authoritative value. `mergeSessions` now makes cloud counts authoritative and links a unique `metadata.sessionId` local identity to its server UUID. The expected corrected DB strata are:

| Build | Sessions | Batches | Authoritative DB samples |
| --- | ---: | ---: | ---: |
| `0.2.0-ml2` | 9 | 215 | 10,089 |
| `0.3.0-ml2` | 1 | 2 | 58 |

The updated collector also persists explicit per-batch GZIP, JSON, array, count and first/last stored-metadata results; sequence min/max/gaps/duplicates; and batch-size distribution. Those new fields are regression-tested, but first/last boundary totals are not present in the supplied artifact and must not be invented.

### Source reconciliation and duplicates

The consolidated snapshot has 18 logical records across cloud, local and documented sources. Seven known server UUIDs were reconciled with documented/public records; six also carry validation-artifact evidence. Four H/quick-H rows preserve their local collector identity. Two identical local JSONL files were deduplicated by SHA-256 into one 2,447-sample raw payload.

The three newly discovered cloud sessions did not preserve a local ID in the old artifact. The improved collector extracts a unique sample-level `metadata.sessionId` and aliases it to the server UUID, preventing a local validation artifact from being counted as a second session. A fresh read-only run is required to prove whether any of those three rows duplicate an existing artifact-only collector.

## Deep audit: `ad759118-4386-481f-9d34-f3d496eb1854`

The human session is `COMPLETED`, Schema 2, track 21, build `0.2.0-ml2`, compatible physics/geometry/features, 41 batches, 1,940 samples and 3 relational laps. It has no numeric, action-range, track-progress, sample-count or batch-count mismatch. It remains `lineageEligibility=COMPATIBLE`, `qualityEligibility=REVIEW`, and `finalTrainingDataset=false`.

### Temporal integrity

| Metric | Result |
| --- | ---: |
| Measured timestamp deltas | 1,939 |
| Delta min / p50 / p95 / p99 | 100 / 100 / 100 / 100 ms |
| Delta mean / max | 160.538405 / 115,300.666667 ms |
| Gaps >150 / >250 / >500 / >1,000 ms | 2 / 2 / 2 / 2 |
| Duplicate samples | 0 |
| Sample-index gaps | 0 |
| Timestamp / sample-index monotonicity violations | 0 / 0 |
| Batch-sequence gaps | 0 |

The two large gaps explain why payload timestamp span is 311.283967 s while nominal sample time is 194 s. Their exact adjacent sample indexes/timestamps are not in the supplied aggregate artifact.

### Action distributions

| Action | Mean | Std | Min | p01 | p05 | p50 | p95 | p99 | Max | Additional diagnostic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Steering | -0.036344 | 0.309514 | -0.9997 | -0.991961 | -0.65788 | 0 | 0.4686 | 0.955767 | 0.9982 | <=-0.95: 2.319588%; >=0.95: 1.082474% |
| Throttle | 0.837629 | 0.368791 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | zero: 16.237113%; >=0.95: 83.762887% |
| Brake | 0.011340 | 0.105885 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | zero: 98.865979%; >0 and >=0.95: 1.134021% |

The updated analyzer additionally emits steering p25/p75, absolute saturation, approximately-zero steering, partial-throttle share, and simultaneous throttle/brake diagnostics. These values require re-analysis of raw samples and are not backfilled from another session.

### State distributions available in the supplied artifact

| Feature | Mean | Std | Min | p01 | p05 | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| speed | 1.114389 | 0.407607 | 0 | 0.010900 | 0.044095 | 1.356550 | 1.385920 | 1.416832 | 1.570000 |
| crossTrackError | 2.801515 | 7.572125 | -16.593 | -12.253660 | -8.128100 | 1.947000 | 19.860100 | 22.145740 | 23.104000 |
| headingError | -0.010671 | 0.244409 | -1.6542 | -0.723870 | -0.414905 | 0.006400 | 0.496500 | 0.546300 | 0.568600 |
| slipAngle | 0.012330 | 0.086568 | -0.4374 | -0.266753 | -0.087620 | 0 | 0.169310 | 0.374391 | 0.449000 |
| yawRate | -0.001626 | 0.012713 | -0.0715 | -0.028900 | -0.024500 | 0 | 0.021500 | 0.030661 | 0.043300 |
| distanceToLeftEdge | 9.198485 | 7.572125 | -11.104 | -10.145740 | -7.860100 | 10.053000 | 20.128100 | 24.253660 | 28.593000 |
| distanceToRightEdge | 14.801515 | 7.572125 | -4.593 | -0.253660 | 3.871900 | 13.947000 | 31.860100 | 34.145740 | 35.104000 |
| currentCurvature | 0.007427 | 0.010695 | 0 | 0 | 0.000020 | 0.003105 | 0.028651 | 0.050403 | 0.099720 |

The updated analyzer now also measures `forwardVelocity`, `lateralVelocity`, `steeringAngle`, `futureCurvature5m`, `futureCurvature10m`, `futureCurvature20m`, `trackProgress`, and surface counts (`TARMAC`, `KERB`, `RUNOFF`, `GRAVEL`, other). Their production values are absent from the supplied aggregate artifact.

### Laps and events

| Lap | Samples | Lap time (s) | Valid | Off-track | Spin | Collision | Avg speed | Max speed |
| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 623 | 62.205 | no | 43 | 4 | 0 | 1.1575 | 1.5700 |
| 2 | 736 | 190.917 | no | 148 | 5 | 0 | 0.9880 | 1.4285 |
| 3 | 581 | 58.133 | no | 1 | 6 | 0 | 1.2282 | 1.4274 |

Across the session: off-track affects 192 samples in 8 episodes (longest 135 samples); spin affects 15 samples in 7 episodes (longest 3); collisions are 0 samples/episodes. The relational lap counts localize all 192 off-track and all 15 spin samples by lap as shown above. Exact interval boundaries (`start/end sampleIndex`, timestamps and duration) are not stored in the supplied artifact; the updated analyzer emits them on the next raw run.

The old artifact reports 1,735 samples without an off-track/spin/collision flag or numeric invalidity. This is a **preliminary diagnostic**, not a train set. The corrected `UNFLAGGED_SAMPLES` also excludes both samples adjacent to each >150 ms gap and reports overlapping categories separately: raw, event-flagged, structurally invalid, gap-adjacent, and unflagged. Its exact production value requires the fresh raw run.

## Lineage, fingerprints, and human-reference sufficiency

Database lineage strata:

- five known infrastructure sessions: `INFRASTRUCTURE_ONLY`;
- one known quick benchmark: `VALIDATION_ONLY`;
- `ad759...`: technically compatible human data, but `REVIEW` because all three laps contain quality events;
- three newly discovered technically compatible sessions: `REVIEW` because provenance is unknown (and one is still active);
- no cloud payload is a final training dataset.

Fingerprint strata are **1 `MATCH`, 9 `MISSING`, 0 `MISMATCH`**. Only the `0.3.0-ml2` J smoke session has the accepted fingerprint recorded. Missing fingerprints are preserved as missing/pre-freeze evidence; they are not converted into mismatches.

`HUMAN_REFERENCE_0_3` is **INSUFFICIENT (NO)**. The database has one 58-sample `0.3.0-ml2` infrastructure smoke and no proven human `0.3.0-ml2` session. The single proven human reference is `0.2.0-ml2` and remains under review. Build strata must not be silently mixed.

## Inventory-tool corrections in this branch

The ML3 inventory now:

1. makes PostgreSQL authoritative for session counters and raw quality when a record is also present in local/artifact sources;
2. reconciles a unique sample-level local session ID with the server UUID;
3. prevents unknown, automatic, or incomplete collections from becoming quality `CANDIDATE`;
4. emits explicit GZIP/JSON/array/count/first-last boundary results and batch-sequence diagnostics;
5. validates per-sample schema, track ID and driver type against the session row;
6. expands action, state, surface, event-location and conservative unflagged diagnostics;
7. emits schema/physics/geometry/features/fingerprint/scope/driver/build strata and explicit human-reference sufficiency.

These changes are read-only and deterministic. Cloud SQL remains `SELECT`-only inside `REPEATABLE READ READ ONLY`, followed by `ROLLBACK`.

## Completion boundary

The supplied artifacts prove integral DB discovery and the core human audit, but they predate the enhanced fields. ML3.0-B can only be frozen after one new run from this branch in an environment that already has the read-only connection variable:

```powershell
npm.cmd run ml3:inventory -- --source all --output artifacts/ml3_dataset_inventory.json
```

The final run must confirm these exact missing outputs:

- per-batch GZIP/JSON/array/count and first/last boundary counters;
- sample schema/track/driver mismatch counters;
- unique local IDs for the three newly discovered sessions and resulting deduplication;
- human action p25/p75, partial-throttle, near-zero steering and simultaneous-pedal metrics;
- human forward/lateral velocity, steering angle, future-curvature, progress and surface distributions;
- exact gap-adjacent count, event intervals and corrected `UNFLAGGED_SAMPLES` for `ad759...`;
- authoritative merged count 87 for `a7c...`, corrected overall totals, corrected lineage/quality summary, and a new canonical SHA-256.

Until that rerun is supplied, the honest acceptance state is **ML3.0 COMPLETE: NO**. **ML3.1 was not started.**

## Verification commands

```powershell
npm.cmd run test:ml3:inventory
npm.cmd run test:ml22:final
npm.cmd run build
git diff --check
```
