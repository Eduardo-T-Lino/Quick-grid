# Quick-grid Agent Guide

## Repository map

| Path | Purpose |
|---|---|
| `src/` | Frontend game: physics (`car.js`), AI (`ai.js`), track (`track.js`, `f1Tracks.js`), controls, rendering, UI, multiplayer client (`src/online/`) |
| `src/ml/lineage/` | ML lineage manifests — `baselineManifest.js` (runtime) and `acceptedBaseline.js` (historical freeze) |
| `src/ml/telemetry/` | Telemetry collection, schema, upload pipeline |
| `server/src/` | Express API: auth, routes, DB (pg), WebSocket online server, security middleware |
| `server/data/` | Persistent JSON: `records.json`, `bot_training.json` |
| `scripts/` | Test runners, benchmarks, ML3 inventory (`scripts/ml3/`) |
| `docs/` | Per-feature documentation — see Source of truth below |
| `public/` | Static assets served by Vite |
| `dist/` | Vite production build output — do not edit |

## Source of truth

Consult these documents only when your task touches the relevant area.

| Area | Document |
|---|---|
| ML architecture & telemetry | `docs/ai_architecture.md`, `docs/ml_telemetry.md`, `docs/ml_feature_manifest.md` |
| ML2.2 accepted baseline & lineage | `docs/ml2_2_baseline_freeze.md`, `docs/ml2_2_final_acceptance.md` |
| ML3 dataset inventory | `docs/ml3_0_dataset_inventory.md` |
| ML2.2 deployment | `docs/ml2_2_deployment.md` |
| Multiplayer / online | `docs/online_multiplayer.md` |
| Player accounts / auth | `docs/player_accounts.md` |
| Controls | `docs/custom_controls.md` |
| Physics (RWD, drift, aerodynamics) | `docs/rwd_handling.md`, `docs/drift_boost_coast.md`, `docs/aerodynamic_wake.md` |
| Rendering performance | `docs/rendering_performance.md` |
| Deployment (Render + Vercel) | `render.yaml`, `vercel.json`, `docs/ml2_2_deployment.md` |
| Environment variables | `.env.example` |

## Critical invariants

- **`acceptedBaseline.js` is a historical freeze** (ML2.2-J). Do not edit it to match runtime tuning; changes belong in `baselineManifest.js`.
- **ML3 inventory** (`scripts/ml3/inventoryCore.js`) imports lineage from `acceptedBaseline.js`. Do not switch it to `baselineManifest.js` — mixing lineages produces invalid dataset fingerprints.
- **`SIMULATION_FINGERPRINT_SHA256`** in each manifest must match the stable serialization of its own `BASELINE_MANIFEST`. Changing any constant without updating the SHA breaks `test:ml22:final`.
- Feature and target arrays in both manifests are order-sensitive — reordering invalidates stored telemetry.
- No ML phase advances implicitly; each transition requires an explicit task and a passing gate test.
- `DATABASE_URL` and `INGEST_TOKEN_SECRET` must never appear in source, logs, or commits.
- TLS and auth middleware in `server/src/security/` must not be weakened to work around connection errors.

## Git safety

- Run `git status` and `git diff --stat` before editing any file.
- Never run `reset --hard`, `restore`, `clean -fd`, or `stash drop` without explicit user authorization.
- Do not force-push. Do not move or delete existing tags.
- If unrelated dirty changes exist, work only on files relevant to the task; do not stage or commit them.
- Do not push or create commits unless explicitly requested.

## Security

- Never print, log, or commit `DATABASE_URL`, `INGEST_TOKEN_SECRET`, passwords, tokens, or JWTs.
- Use placeholders (as shown in `.env.example`) in examples and docs.
- Do not expose backend secrets through `VITE_` prefixed variables.
- Do not disable TLS verification to fix connection errors.
- Do not alter auth or security middleware unless authentication is the explicit scope of the task.

## Working method

1. Identify the minimum set of files needed before opening anything.
2. Use `rg` / grep searches before opening large files (`f1Tracks.js` is ~235 KB; `benchmark_ml22_browser.js` is ~44 KB).
3. Do not re-read files already inspected that have not changed.
4. Prefer small, targeted patches; avoid unsolicited refactors.
5. Do not implement features outside the stated task scope.
6. Stop when the task criteria are satisfied.
7. For repo-wide questions use `rg --stats` or `git diff --name-only`; avoid full-repo reads.

## Testing strategy

Run the narrowest test first, widen only if needed. Full regression only when: (a) explicitly requested, (b) change is cross-cutting, (c) before integration/release, or (d) a critical invariant was altered.

| Changed area | First test |
|---|---|
| ML lineage / physics constants | `npm run test:ml22:final` |
| ML telemetry / upload pipeline | `npm run test:ml` |
| ML3 inventory | `npm run test:ml3:inventory` |
| Online / multiplayer | `npm run test:online` |
| Auth / accounts | `npm run test:auth` |
| Controls | `npm run test:controls` |
| Braking boards | `npm run test:boards` |
| Backend API | `npm run test:api` |
| Aerodynamics / wake | `npm run test:wake` |
| Build / frontend integration | `npm run build` |

Full command list is in `package.json` → `scripts`.

## Output discipline

Report only: what changed · files modified · tests run and result · blockers.
Do not repeat the prompt. Do not narrate the investigation. Summarize logs; do not print them in full.

## Tool output economy

Prefer compact output:
- `git diff --stat` / `git diff --name-only` over full diffs when only scope is needed.
- `rg -l` before `rg -n` when just locating files.
- Targeted line ranges over full file reads for large files.

When a test produces a large log: save it to a temp file and show only the summary or failing tail. Never suppress information needed to diagnose a failure.
