# ML2.2-G — Browser performance benchmark A/B/C

Overall gate: **BLOCKED**

## Environment

| item | value |
|---|---|
| executed at | 2026-09-08T11:39:24.844Z |
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

## Controlled scenario

Interlagos (track 21), dry, 20 cars (19 existing AI bots + player), professional difficulty, automatic transmission, 40 laps. Each repetition uses a fresh browser context, the same Chromium process/version, seed 2202, viewport, controls, and continuous-throttle driving logic.

The game is allowed to reach lights-out, then warmed for 15s. Performance metrics are reset immediately before the 120s official window. C was not run because its browser/cloud gate was blocked before measurement.

## Scenario A — telemetry off

| metric | median |
|---|---:|
| average FPS | 59.59 |
| frame count | 7150 |
| frame mean / p50 / p95 / p99 (ms) | 16.783 / 16.700 / 16.800 / 16.800 |
| frame CPU mean / p95 / p99 (ms) | 0.439 / 0.700 / 1.300 |
| collector mean / p95 / p99 (ms) | 0.001 / 0.000 / 0.000 |
| uploader main mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| network async mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| requests/min | 0.000 |
| uploaded KB/min | 0.000 |
| average payload bytes | 0 |
| heap start / current / peak (bytes) | 7289810 / 7807659 / 8895592 |

## Scenario B — local collection on, online upload off

| metric | median |
|---|---:|
| average FPS | 59.48 |
| frame count | 7137 |
| frame mean / p50 / p95 / p99 (ms) | 16.813 / 16.700 / 16.800 / 16.800 |
| frame CPU mean / p95 / p99 (ms) | 0.374 / 0.500 / 0.800 |
| collector mean / p95 / p99 (ms) | 0.003 / 0.000 / 0.100 |
| uploader main mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| network async mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| requests/min | 0.000 |
| uploaded KB/min | 0.000 |
| average payload bytes | 0 |
| heap start / current / peak (bytes) | 8183315 / 13065370 / 12715859 |

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
| FPS | 59.586 | 59.477 | -0.108 | +0.18% |
| frame mean | 16.783 | 16.813 | 0.031 | +0.18% |
| frame p95 | 16.800 | 16.800 | 0.000 | +0.00% |
| frame p99 | 16.800 | 16.800 | 0.000 | +0.00% |
| frame CPU mean | 0.439 | 0.374 | -0.065 | -14.84% |
| frame CPU p95 | 0.700 | 0.500 | -0.200 | -28.57% |
| frame CPU p99 | 1.300 | 0.800 | -0.500 | -38.46% |
| collector mean | 0.001 | 0.003 | 0.002 | +237.33% |
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
| heap peak | 8895592.000 | 12715859.000 | 3820267.000 | +42.95% |

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
| PASS | B vs A average FPS drop | 0.18173499660329195 | <= 3 |
| PASS | B vs A frame p95 increase | 0 | <= 5 |
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
- networkAsyncLatency is reported only as asynchronous network latency and is not used as CPU/frame overhead.
- The player uses deterministic continuous throttle. Existing bots provide race/rendering load; no physics, AI, geometry, schema, or sample-rate behavior is altered.

## Reproduction

Install once:

```powershell
npm install
npx playwright install chromium
```

Official local production benchmark:

```powershell
$env:VITE_TELEMETRY_API_URL='https://quick-grid-telemetry-api.onrender.com'
npm run benchmark:ml22
```

Quick diagnostic only:

```powershell
$env:VITE_TELEMETRY_API_URL='https://quick-grid-telemetry-api.onrender.com'
npm run benchmark:ml22 -- --quick
```
