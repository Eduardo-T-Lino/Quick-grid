# ML2.2-G — Browser performance benchmark A/B/C

Overall gate: **BLOCKED**

## Environment

| item | value |
|---|---|
| executed at | 2026-09-08T17:07:05.618Z |
| source | local Vite production build + preview |
| URL | http://127.0.0.1:4173 |
| browser | Chromium 153.0.8010.12 |
| user agent | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36 |
| OS | win32 10.0.26200 x64 |
| Node | v22.14.0 |
| viewport | 1920×1080, DPR 1 |
| mode | headless |
| warm-up | 15s, excluded from official metrics |
| measurement | 120s per run |
| repetitions | requested 3; completed A=3, B=3, C=0 |
| screenshot | artifacts/ml22_browser_smoke.png |
| benchmark bundle assets | `index-Busd-JYL.js`, `index-CfJw5z2Y.css` |

## Controlled scenario

Interlagos (track 21), dry, 20 cars (19 existing AI bots + player), professional difficulty, automatic transmission, 40 laps. The game exposes no selectable graphics preset, so every run uses the same production rendering configuration. Each repetition uses a fresh browser context, the same Chromium process/version, seed 2202, viewport, controls, and continuous-throttle driving logic.

The game is allowed to reach lights-out, then warmed for 15s. Performance metrics are reset immediately before the 120s official window. C was not run because its browser/cloud gate was blocked before measurement.

## Individual runs

| run | status | FPS | frame p95 ms | frame CPU p95 ms | collector p95 ms | local samples | console errors |
|---|---|---:|---:|---:|---:|---:|---:|
| A1 | completed | 28.17 | 50.000 | 1.400 | 0.000 | 0 | 3 |
| B1 | completed | 30.75 | 49.900 | 1.000 | 0.000 | 1368 | 3 |
| B2 | completed | 30.81 | 33.400 | 1.000 | 0.000 | 1367 | 3 |
| A2 | completed | 28.93 | 50.000 | 1.100 | 0.000 | 0 | 3 |
| A3 | completed | 28.56 | 50.000 | 1.300 | 0.000 | 0 | 3 |
| B3 | completed | 31.51 | 33.400 | 0.900 | 0.000 | 1368 | 3 |

## Scenario A — telemetry off

| metric | median |
|---|---:|
| average FPS | 28.56 |
| frame count | 3428 |
| frame mean / p50 / p95 / p99 (ms) | 35.009 / 33.300 / 50.000 / 50.100 |
| frame CPU mean / p95 / p99 (ms) | 0.797 / 1.300 / 2.200 |
| collector mean / p95 / p99 (ms) | 0.001 / 0.000 / 0.000 |
| uploader main mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| network async mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| requests/min | 0.000 |
| uploaded KB/min | 0.000 |
| average payload bytes | 0 |
| heap start / current / peak (bytes) | 6798789 / 9671341 / 9592195 |

## Scenario B — local collection on, online upload off

| metric | median |
|---|---:|
| average FPS | 30.81 |
| frame count | 3699 |
| frame mean / p50 / p95 / p99 (ms) | 32.458 / 33.300 / 33.400 / 50.000 |
| frame CPU mean / p95 / p99 (ms) | 0.716 / 1.000 / 2.000 |
| collector mean / p95 / p99 (ms) | 0.005 / 0.000 / 0.100 |
| uploader main mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| network async mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| requests/min | 0.000 |
| uploaded KB/min | 0.000 |
| average payload bytes | 0 |
| heap start / current / peak (bytes) | 5767829 / 10998986 / 12475567 |

## Scenario C — local collection and online upload

| metric | median |
|---|---:|
| unavailable | N/A |

### C upload delivery

| metric | median/final value |
|---|---|
| status | BLOCKED: Render CORS rejected http://127.0.0.1:4173 (HTTP 403). |

## B vs A

| metric | baseline | candidate | absolute delta | overhead |
|---|---:|---:|---:|---:|
| FPS | 28.564 | 30.809 | 2.245 | -7.86% |
| frame mean | 35.009 | 32.458 | -2.551 | -7.29% |
| frame p95 | 50.000 | 33.400 | -16.600 | -33.20% |
| frame p99 | 50.100 | 50.000 | -0.100 | -0.20% |
| frame CPU mean | 0.797 | 0.716 | -0.081 | -10.21% |
| frame CPU p95 | 1.300 | 1.000 | -0.300 | -23.08% |
| frame CPU p99 | 2.200 | 2.000 | -0.200 | -9.09% |
| collector mean | 0.001 | 0.005 | 0.004 | +511.90% |
| collector p95 | 0.000 | 0.000 | 0.000 | N/A |
| collector p99 | 0.000 | 0.100 | 0.100 | N/A |
| uploader main mean | 0.000 | 0.000 | 0.000 | N/A |
| uploader main p95 | 0.000 | 0.000 | 0.000 | N/A |
| uploader main p99 | 0.000 | 0.000 | 0.000 | N/A |
| network async mean | 0.000 | 0.000 | 0.000 | N/A |
| network async p95 | 0.000 | 0.000 | 0.000 | N/A |
| network async p99 | 0.000 | 0.000 | 0.000 | N/A |
| requests/min | 0.000 | 0.000 | 0.000 | N/A |
| uploaded KB/min | 0.000 | 0.000 | 0.000 | N/A |
| average payload bytes | 0.000 | 0.000 | 0.000 | N/A |
| heap peak | 9592195.000 | 12475567.000 | 2883372.000 | +30.06% |

## C vs A

| metric | baseline | candidate | absolute delta | overhead |
|---|---:|---:|---:|---:|
| unavailable | N/A | N/A | N/A | N/A |

## C vs B

| metric | baseline | candidate | absolute delta | overhead |
|---|---:|---:|---:|---:|
| unavailable | N/A | N/A | N/A | N/A |

Positive overhead means worse (FPS drop or time/memory increase). A negative value is an improvement.

## Acceptance criteria

| status | criterion | actual | limit |
|---|---|---:|---|
| PASS | B vs A average FPS drop | -7.8605468091666815 | <= 3 |
| PASS | B vs A frame p95 increase | -33.199999999953434 | <= 5 |
| PASS | B collector p95 | 0 | < 1 |
| BLOCKED | C vs A average FPS drop | N/A | <= 5 |
| BLOCKED | C vs A frame p95 increase | N/A | <= 8 |
| BLOCKED | C uploader main-thread p95 | N/A | < 2 |
| BLOCKED | C dropped batches | N/A | === 0 |
| BLOCKED | C dropped samples | N/A | === 0 |
| BLOCKED | C pending batches drained | N/A | === 0 |
| BLOCKED | C in-flight requests drained | N/A | === 0 |
| BLOCKED | C last error is null | N/A | === null |
| BLOCKED | C acknowledged batches match sent batches | N/A | === sentBatches |

## Browser/cloud gate

Browser smoke verification: **PASS**. Render health: 200; CORS preflight from http://127.0.0.1:4173: 403; scenario C: **BLOCKED**.

## Limitations

- Scenario C was blocked: Render CORS rejected http://127.0.0.1:4173 (HTTP 403).
- The benchmark ran against a dirty working tree. Unrelated local changes were preserved and are listed in the JSON artifact.
- Each measured run logged three `ERR_CONNECTION_REFUSED` resource errors from the separate legacy gameplay API at `http://localhost:3001`. They occurred while preparing the grid, before warm-up and the official measurement window.
- The existing one-second heap sampler reported a final current heap above its sampled peak in at least one run. Raw API values are retained; treat `heapPeakBytes` as a sampled peak, not an exact maximum.
- Host throughput varied substantially across official campaigns on the same day. The report committed in `4623360` recorded medians A=59.59 FPS and B=59.48 FPS; an intermediate rerun recorded A=58.86 FPS and B=48.81 FPS; this final counterbalanced campaign recorded A=28.56 FPS and B=30.81 FPS. Only the final counterbalanced campaign feeds the tables above. Its B criteria pass, but absolute FPS and cross-campaign stability warrant caution.
- Concurrent UI work continued after the campaign. All six runs used the same static production preview (`index-Busd-JYL.js`), so A/B are internally comparable; the later independent build emitted `index-BxFmjaBk.js`. Rerun the benchmark after the working tree stabilizes before treating these values as current-checkout baselines.
- networkAsyncLatency is reported only as asynchronous network latency and is not used as CPU/frame overhead.
- The player uses deterministic continuous throttle. Existing bots provide race/rendering load; no physics, AI, geometry, schema, or sample-rate behavior is altered.

## Reproduction

Install once:

```powershell
npm install
npx playwright install chromium
```

Official local production benchmark (A/B; C remains subject to Render CORS for localhost):

```powershell
$env:VITE_TELEMETRY_API_URL='https://quick-grid-telemetry-api.onrender.com'
npm.cmd run benchmark:ml22
```

Official A/B/C through the Vercel production origin allowed by Render CORS:

```powershell
npm.cmd run benchmark:ml22 -- --base-url='https://<seu-dominio-production-da-vercel>'
```

Quick diagnostic only:

```powershell
$env:VITE_TELEMETRY_API_URL='https://quick-grid-telemetry-api.onrender.com'
npm.cmd run benchmark:ml22 -- --quick
```
