# ML2.2 — Browser performance benchmark evidence

## LOCAL PRELIMINARY (ML2.2-G)

Overall gate: **BLOCKED**

### Environment

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

### Controlled scenario

Interlagos (track 21), dry, 20 cars (19 existing AI bots + player), professional difficulty, automatic transmission, 40 laps. The game exposes no selectable graphics preset, so every run uses the same production rendering configuration. Each repetition uses a fresh browser context, the same Chromium process/version, seed 2202, viewport, controls, and continuous-throttle driving logic.

The game is allowed to reach lights-out, then warmed for 15s. Performance metrics are reset immediately before the 120s official window. C was not run because its browser/cloud gate was blocked before measurement.

### Individual runs

| run | status | FPS | frame p95 ms | frame CPU p95 ms | collector p95 ms | local samples | console errors |
|---|---|---:|---:|---:|---:|---:|---:|
| A1 | completed | 28.17 | 50.000 | 1.400 | 0.000 | 0 | 3 |
| B1 | completed | 30.75 | 49.900 | 1.000 | 0.000 | 1368 | 3 |
| B2 | completed | 30.81 | 33.400 | 1.000 | 0.000 | 1367 | 3 |
| A2 | completed | 28.93 | 50.000 | 1.100 | 0.000 | 0 | 3 |
| A3 | completed | 28.56 | 50.000 | 1.300 | 0.000 | 0 | 3 |
| B3 | completed | 31.51 | 33.400 | 0.900 | 0.000 | 1368 | 3 |

### Scenario A — telemetry off

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

### Scenario B — local collection on, online upload off

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

### Scenario C — local collection and online upload

| metric | median |
|---|---:|
| unavailable | N/A |

#### C upload delivery

| metric | median/final value |
|---|---|
| status | BLOCKED: Render CORS rejected http://127.0.0.1:4173 (HTTP 403). |

### B vs A

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

### C vs A

| metric | baseline | candidate | absolute delta | overhead |
|---|---:|---:|---:|---:|
| unavailable | N/A | N/A | N/A | N/A |

### C vs B

| metric | baseline | candidate | absolute delta | overhead |
|---|---:|---:|---:|---:|
| unavailable | N/A | N/A | N/A | N/A |

Positive overhead means worse (FPS drop or time/memory increase). A negative value is an improvement.

### Acceptance criteria

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

### Browser/cloud gate

Browser smoke verification: **PASS**. Render health: 200; CORS preflight from http://127.0.0.1:4173: 403; scenario C: **BLOCKED**.

### Limitations

- Scenario C was blocked: Render CORS rejected http://127.0.0.1:4173 (HTTP 403).
- The benchmark ran against a dirty working tree. Unrelated local changes were preserved and are listed in the JSON artifact.
- Each measured run logged three `ERR_CONNECTION_REFUSED` resource errors from the separate legacy gameplay API at `http://localhost:3001`. They occurred while preparing the grid, before warm-up and the official measurement window.
- The existing one-second heap sampler reported a final current heap above its sampled peak in at least one run. Raw API values are retained; treat `heapPeakBytes` as a sampled peak, not an exact maximum.
- Host throughput varied substantially across official campaigns on the same day. The report committed in `4623360` recorded medians A=59.59 FPS and B=59.48 FPS; an intermediate rerun recorded A=58.86 FPS and B=48.81 FPS; this final counterbalanced campaign recorded A=28.56 FPS and B=30.81 FPS. Only the final counterbalanced campaign feeds the tables above. Its B criteria pass, but absolute FPS and cross-campaign stability warrant caution.
- Concurrent UI work continued after the campaign. All six runs used the same static production preview (`index-Busd-JYL.js`), so A/B are internally comparable; the later independent build emitted `index-BxFmjaBk.js`. Rerun the benchmark after the working tree stabilizes before treating these values as current-checkout baselines.
- The legacy harness used one shared screenshot filename. A later production smoke replaced that auxiliary image; the local JSON, individual measurements, medians, report, and bundle fingerprint above remain preserved.
- networkAsyncLatency is reported only as asynchronous network latency and is not used as CPU/frame overhead.
- The player uses deterministic continuous throttle. Existing bots provide race/rendering load; no physics, AI, geometry, schema, or sample-rate behavior is altered.

### Reproduction

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

---

## VERCEL PRODUCTION OFFICIAL (ML2.2-H)

Overall gate: **PASS**

### Official conclusion and machine/browser variation assessment

The official production gate is **PASS**. Using medians, B versus A showed -1.98% observed FPS overhead, 0.00% frame-p95 overhead, and 0.100 ms collector p95. C versus A showed -3.36% observed FPS overhead, 0.00% frame-p95 overhead, and 0.700 ms uploader main-thread p95. Negative FPS overhead here means that the candidate median was numerically higher; it is treated as ordinary run-to-run variation, not as a telemetry-caused performance gain.

A1 (54.67 FPS) was the sole high outlier. A2/A3 were 29.05/29.42 FPS, while B stayed within a 0.52 FPS range and C within 0.34 FPS. The 15-second warm-up, balanced order, reused Chromium process, fresh one-page contexts, visible/focused document state in every run, no configured CPU throttling, and exclusion of Render startup from C rule out the main harness asymmetries requested for investigation. They do not identify the exact OS/browser scheduling cause because no system-wide process trace or Chrome performance trace was recorded. The evidence therefore supports using the robust median and classifying A1 as machine/browser/game-loop variance, without changing gameplay code.

All three C sessions became ACTIVE with a serverSessionId before warm-up and finished COMPLETED after drain. Each delivered 28/28 batches; retries, dropped batches/samples, idempotent duplicates, pending, persisted, in-flight requests, and lastError were all zero/null. Median C network latency was 384.175 ms mean, 407.700 ms p95, and 423.900 ms p99; traffic was 11.995 requests/min, 479.485 KB/min, and 40,929 bytes per payload.

### Environment

| item | value |
|---|---|
| executed at | 2026-09-09T11:08:08.919Z |
| source | deployed build |
| requested URL | https://quick-grid-nu.vercel.app |
| final URL after redirects | https://quick-grid-nu.vercel.app/ |
| browser | Chromium 153.0.8010.12 |
| user agent | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36 |
| OS | win32 10.0.26200 x64 |
| Node | v22.14.0 |
| viewport | 1920×1080, DPR 1 |
| mode | headless |
| warm-up | 15s, excluded from official metrics |
| measurement | 120s per run |
| repetitions | requested 3; completed A=3, B=3, C=3 |
| balanced run order | A1 → B1 → C1 → B2 → C2 → A2 → C3 → A3 → B3 |
| screenshot | artifacts/ml22_browser_benchmark_vercel_smoke.png |
| benchmark bundle assets | https://quick-grid-nu.vercel.app/assets/index-BdIxIu9p.js, https://quick-grid-nu.vercel.app/assets/index-CfJw5z2Y.css |

### Controlled scenario

Interlagos (track 21), dry, 20 cars (19 existing AI bots + player), professional difficulty, automatic transmission, 40 laps. The game exposes no selectable graphics preset, so every run uses the same production rendering configuration. Each repetition uses a fresh browser context, the same Chromium process/version, seed 2202, viewport, controls, and continuous-throttle driving logic.

The game is allowed to reach lights-out, then warmed for 15s. Performance metrics are reset immediately before the 120s official window. For C, Render health and session ACTIVE/serverSessionId are confirmed before warm-up, so cold start is outside the official window.

### Individual runs

| run | status | FPS | frame p95 ms | frame CPU p95 ms | collector p95 ms | local samples | console errors |
|---|---|---:|---:|---:|---:|---:|---:|
| A1 | completed | 54.67 | 33.300 | 0.900 | 0.000 | 0 | 3 |
| B1 | completed | 30.11 | 50.000 | 1.500 | 0.100 | 1367 | 3 |
| C1 | completed | 30.17 | 50.000 | 1.400 | 0.100 | 1366 | 3 |
| B2 | completed | 30.01 | 50.000 | 1.400 | 0.100 | 1369 | 3 |
| C2 | completed | 30.41 | 50.000 | 1.400 | 0.100 | 1370 | 3 |
| A2 | completed | 29.05 | 50.000 | 1.500 | 0.000 | 0 | 3 |
| C3 | completed | 30.51 | 50.000 | 1.300 | 0.100 | 1367 | 3 |
| A3 | completed | 29.42 | 50.000 | 1.400 | 0.000 | 0 | 3 |
| B3 | completed | 29.59 | 50.000 | 1.600 | 0.100 | 1370 | 3 |

### Scenario A — telemetry off

| metric | median |
|---|---:|
| average FPS | 29.42 |
| frame count | 3532 |
| frame mean / p50 / p95 / p99 (ms) | 33.988 / 33.300 / 50.000 / 50.100 |
| frame CPU mean / p95 / p99 (ms) | 0.887 / 1.400 / 2.200 |
| collector mean / p95 / p99 (ms) | 0.001 / 0.000 / 0.100 |
| uploader main mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| network async mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| requests/min | 0.000 |
| uploaded KB/min | 0.000 |
| average payload bytes | 0 |
| heap start / current / peak (bytes) | 7176168 / 9070213 / 9506903 |

### Scenario B — local collection on, online upload off

| metric | median |
|---|---:|
| average FPS | 30.01 |
| frame count | 3601 |
| frame mean / p50 / p95 / p99 (ms) | 33.327 / 33.300 / 50.000 / 50.100 |
| frame CPU mean / p95 / p99 (ms) | 0.890 / 1.500 / 2.300 |
| collector mean / p95 / p99 (ms) | 0.006 / 0.100 / 0.100 |
| uploader main mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| network async mean / p95 / p99 (ms) | 0.000 / 0.000 / 0.000 |
| requests/min | 0.000 |
| uploaded KB/min | 0.000 |
| average payload bytes | 0 |
| heap start / current / peak (bytes) | 6537145 / 10105207 / 12889277 |

### Scenario C — local collection and online upload

| metric | median |
|---|---:|
| average FPS | 30.41 |
| frame count | 3650 |
| frame mean / p50 / p95 / p99 (ms) | 32.885 / 33.300 / 50.000 / 50.100 |
| frame CPU mean / p95 / p99 (ms) | 0.885 / 1.400 / 2.100 |
| collector mean / p95 / p99 (ms) | 0.007 / 0.100 / 0.100 |
| uploader main mean / p95 / p99 (ms) | 0.417 / 0.700 / 0.900 |
| network async mean / p95 / p99 (ms) | 384.175 / 407.700 / 423.900 |
| requests/min | 11.995 |
| uploaded KB/min | 479.485 |
| average payload bytes | 40929 |
| heap start / current / peak (bytes) | 8652235 / 7400041 / 14495804 |

### Individual values and simple dispersion

Median is the primary comparison statistic. Range and population standard deviation expose run-to-run spread.

| scenario | metric | individual values | min | median | max | range | std dev |
|---|---|---|---:|---:|---:|---:|---:|
| A | average FPS | 54.670, 29.047, 29.422 | 29.047 | 29.422 | 54.670 | 25.623 | 11.991 |
| A | frame mean ms | 18.291, 34.427, 33.988 | 18.291 | 33.988 | 34.427 | 16.135 | 7.505 |
| A | frame p95 ms | 33.300, 50.000, 50.000 | 33.300 | 50.000 | 50.000 | 16.700 | 7.872 |
| A | frame p99 ms | 49.900, 50.100, 50.100 | 49.900 | 50.100 | 50.100 | 0.200 | 0.094 |
| A | frame CPU mean ms | 0.427, 0.905, 0.887 | 0.427 | 0.887 | 0.905 | 0.478 | 0.221 |
| A | frame CPU p95 ms | 0.900, 1.500, 1.400 | 0.900 | 1.400 | 1.500 | 0.600 | 0.262 |
| A | frame CPU p99 ms | 1.300, 2.300, 2.200 | 1.300 | 2.200 | 2.300 | 1.000 | 0.450 |
| A | collector mean ms | 0.001, 0.001, 0.001 | 0.001 | 0.001 | 0.001 | 0.000 | 0.000 |
| A | collector p95 ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| A | collector p99 ms | 0.100, 0.100, 0.100 | 0.100 | 0.100 | 0.100 | 0.000 | 0.000 |
| A | uploader main mean ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| A | uploader main p95 ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| A | uploader main p99 ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| A | network async mean ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| A | network async p95 ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| A | network async p99 ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| A | requests/min | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| A | uploaded KB/min | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| A | average payload bytes | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| A | heap start bytes | 7091133.000, 7176168.000, 7551142.000 | 7091133.000 | 7176168.000 | 7551142.000 | 460009.000 | 199845.699 |
| A | heap current bytes | 9804967.000, 6731343.000, 9070213.000 | 6731343.000 | 9070213.000 | 9804967.000 | 3073624.000 | 1310527.494 |
| A | heap peak bytes | 9080803.000, 9655003.000, 9506903.000 | 9080803.000 | 9506903.000 | 9655003.000 | 574200.000 | 243401.922 |
| B | average FPS | 30.114, 30.005, 29.593 | 29.593 | 30.005 | 30.114 | 0.521 | 0.224 |
| B | frame mean ms | 33.208, 33.327, 33.792 | 33.208 | 33.327 | 33.792 | 0.584 | 0.252 |
| B | frame p95 ms | 50.000, 50.000, 50.000 | 50.000 | 50.000 | 50.000 | 0.000 | 0.000 |
| B | frame p99 ms | 50.100, 50.100, 50.100 | 50.100 | 50.100 | 50.100 | 0.000 | 0.000 |
| B | frame CPU mean ms | 0.890, 0.870, 0.902 | 0.870 | 0.890 | 0.902 | 0.032 | 0.013 |
| B | frame CPU p95 ms | 1.500, 1.400, 1.600 | 1.400 | 1.500 | 1.600 | 0.200 | 0.082 |
| B | frame CPU p99 ms | 2.300, 2.200, 2.400 | 2.200 | 2.300 | 2.400 | 0.200 | 0.082 |
| B | collector mean ms | 0.006, 0.006, 0.006 | 0.006 | 0.006 | 0.006 | 0.000 | 0.000 |
| B | collector p95 ms | 0.100, 0.100, 0.100 | 0.100 | 0.100 | 0.100 | 0.000 | 0.000 |
| B | collector p99 ms | 0.100, 0.100, 0.100 | 0.100 | 0.100 | 0.100 | 0.000 | 0.000 |
| B | uploader main mean ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| B | uploader main p95 ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| B | uploader main p99 ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| B | network async mean ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| B | network async p95 ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| B | network async p99 ms | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| B | requests/min | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| B | uploaded KB/min | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| B | average payload bytes | 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| B | heap start bytes | 6537145.000, 5940006.000, 7722398.000 | 5940006.000 | 6537145.000 | 7722398.000 | 1782392.000 | 740744.438 |
| B | heap current bytes | 13216484.000, 8587483.000, 10105207.000 | 8587483.000 | 10105207.000 | 13216484.000 | 4629001.000 | 1926746.854 |
| B | heap peak bytes | 12794614.000, 12889277.000, 14047188.000 | 12794614.000 | 12889277.000 | 14047188.000 | 1252574.000 | 569469.597 |
| C | average FPS | 30.172, 30.409, 30.514 | 30.172 | 30.409 | 30.514 | 0.342 | 0.143 |
| C | frame mean ms | 33.143, 32.885, 32.772 | 32.772 | 32.885 | 33.143 | 0.371 | 0.155 |
| C | frame p95 ms | 50.000, 50.000, 50.000 | 50.000 | 50.000 | 50.000 | 0.000 | 0.000 |
| C | frame p99 ms | 50.100, 50.100, 50.100 | 50.100 | 50.100 | 50.100 | 0.000 | 0.000 |
| C | frame CPU mean ms | 0.895, 0.885, 0.829 | 0.829 | 0.885 | 0.895 | 0.066 | 0.029 |
| C | frame CPU p95 ms | 1.400, 1.400, 1.300 | 1.300 | 1.400 | 1.400 | 0.100 | 0.047 |
| C | frame CPU p99 ms | 2.300, 2.100, 2.000 | 2.000 | 2.100 | 2.300 | 0.300 | 0.125 |
| C | collector mean ms | 0.007, 0.007, 0.007 | 0.007 | 0.007 | 0.007 | 0.000 | 0.000 |
| C | collector p95 ms | 0.100, 0.100, 0.100 | 0.100 | 0.100 | 0.100 | 0.000 | 0.000 |
| C | collector p99 ms | 0.100, 0.100, 0.100 | 0.100 | 0.100 | 0.100 | 0.000 | 0.000 |
| C | uploader main mean ms | 0.508, 0.417, 0.367 | 0.367 | 0.417 | 0.508 | 0.142 | 0.059 |
| C | uploader main p95 ms | 0.700, 0.700, 0.600 | 0.600 | 0.700 | 0.700 | 0.100 | 0.047 |
| C | uploader main p99 ms | 0.900, 0.900, 0.600 | 0.600 | 0.900 | 0.900 | 0.300 | 0.141 |
| C | network async mean ms | 367.454, 384.704, 384.175 | 367.454 | 384.175 | 384.704 | 17.250 | 8.010 |
| C | network async p95 ms | 393.000, 407.700, 460.500 | 393.000 | 407.700 | 460.500 | 67.500 | 28.983 |
| C | network async p99 ms | 404.700, 423.900, 485.100 | 404.700 | 423.900 | 485.100 | 80.400 | 34.284 |
| C | requests/min | 11.996, 11.994, 11.995 | 11.994 | 11.995 | 11.996 | 0.002 | 0.001 |
| C | uploaded KB/min | 479.485, 479.399, 479.590 | 479.399 | 479.485 | 479.590 | 0.191 | 0.078 |
| C | average payload bytes | 40929.375, 40929.333, 40942.125 | 40929.333 | 40929.375 | 40942.125 | 12.792 | 6.020 |
| C | heap start bytes | 8652235.000, 9321793.000, 6580140.000 | 6580140.000 | 8652235.000 | 9321793.000 | 2741653.000 | 1167073.585 |
| C | heap current bytes | 7542977.000, 6812289.000, 7400041.000 | 6812289.000 | 7400041.000 | 7542977.000 | 730688.000 | 316190.531 |
| C | heap peak bytes | 14495804.000, 14489442.000, 14600061.000 | 14489442.000 | 14495804.000 | 14600061.000 | 110619.000 | 50713.312 |

#### C upload delivery

| metric | median/final value |
|---|---|
| sentBatches | 28 |
| acknowledgedBatches | 28 |
| uploadedSamples | 1367 |
| pendingBatches | 0 |
| persistedBatches | 0 |
| retryCount | 0 |
| droppedBatches | 0 |
| droppedSamples | 0 |
| idempotentDuplicates | 0 |
| inFlightRequests | 0 |
| averageUploadLatencyMs | 396 |
| lastError | null |
| sessionStatus | COMPLETED, COMPLETED, COMPLETED |

#### C upload delivery by run

| run | status | server session | sent | ack | retries | dropped batches | dropped samples | pending | persisted | in flight | final status / error |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| C1 | completed | 014398f2-d1ce-4c40-8bcb-3a65a1008065 | 28 | 28 | 0 | 0 | 0 | 0 | 0 | 0 | COMPLETED / null |
| C2 | completed | 6bf94581-f632-4bd4-bbb1-50378db12f3f | 28 | 28 | 0 | 0 | 0 | 0 | 0 | 0 | COMPLETED / null |
| C3 | completed | 7ca52a2b-58a0-4bc2-81ec-ad4fc8a36d03 | 28 | 28 | 0 | 0 | 0 | 0 | 0 | 0 | COMPLETED / null |

### B vs A

| metric | baseline | candidate | absolute delta | overhead |
|---|---:|---:|---:|---:|
| FPS | 29.422 | 30.005 | 0.583 | -1.98% |
| frame mean | 33.988 | 33.327 | -0.661 | -1.94% |
| frame p95 | 50.000 | 50.000 | 0.000 | +0.00% |
| frame p99 | 50.100 | 50.100 | 0.000 | +0.00% |
| frame CPU mean | 0.887 | 0.890 | 0.003 | +0.29% |
| frame CPU p95 | 1.400 | 1.500 | 0.100 | +7.14% |
| frame CPU p99 | 2.200 | 2.300 | 0.100 | +4.55% |
| collector mean | 0.001 | 0.006 | 0.005 | +387.36% |
| collector p95 | 0.000 | 0.100 | 0.100 | N/A |
| collector p99 | 0.100 | 0.100 | 0.000 | +0.00% |
| uploader main mean | 0.000 | 0.000 | 0.000 | N/A |
| uploader main p95 | 0.000 | 0.000 | 0.000 | N/A |
| uploader main p99 | 0.000 | 0.000 | 0.000 | N/A |
| network async mean | 0.000 | 0.000 | 0.000 | N/A |
| network async p95 | 0.000 | 0.000 | 0.000 | N/A |
| network async p99 | 0.000 | 0.000 | 0.000 | N/A |
| requests/min | 0.000 | 0.000 | 0.000 | N/A |
| uploaded KB/min | 0.000 | 0.000 | 0.000 | N/A |
| average payload bytes | 0.000 | 0.000 | 0.000 | N/A |
| heap peak | 9506903.000 | 12889277.000 | 3382374.000 | +35.58% |

### C vs A

| metric | baseline | candidate | absolute delta | overhead |
|---|---:|---:|---:|---:|
| FPS | 29.422 | 30.409 | 0.987 | -3.36% |
| frame mean | 33.988 | 32.885 | -1.103 | -3.25% |
| frame p95 | 50.000 | 50.000 | 0.000 | +0.00% |
| frame p99 | 50.100 | 50.100 | 0.000 | +0.00% |
| frame CPU mean | 0.887 | 0.885 | -0.002 | -0.23% |
| frame CPU p95 | 1.400 | 1.400 | 0.000 | +0.00% |
| frame CPU p99 | 2.200 | 2.100 | -0.100 | -4.55% |
| collector mean | 0.001 | 0.007 | 0.006 | +467.66% |
| collector p95 | 0.000 | 0.100 | 0.100 | N/A |
| collector p99 | 0.100 | 0.100 | 0.000 | +0.00% |
| uploader main mean | 0.000 | 0.417 | 0.417 | N/A |
| uploader main p95 | 0.000 | 0.700 | 0.700 | N/A |
| uploader main p99 | 0.000 | 0.900 | 0.900 | N/A |
| network async mean | 0.000 | 384.175 | 384.175 | N/A |
| network async p95 | 0.000 | 407.700 | 407.700 | N/A |
| network async p99 | 0.000 | 423.900 | 423.900 | N/A |
| requests/min | 0.000 | 11.995 | 11.995 | N/A |
| uploaded KB/min | 0.000 | 479.485 | 479.485 | N/A |
| average payload bytes | 0.000 | 40929.375 | 40929.375 | N/A |
| heap peak | 9506903.000 | 14495804.000 | 4988901.000 | +52.48% |

### C vs B

| metric | baseline | candidate | absolute delta | overhead |
|---|---:|---:|---:|---:|
| FPS | 30.005 | 30.409 | 0.404 | -1.35% |
| frame mean | 33.327 | 32.885 | -0.443 | -1.33% |
| frame p95 | 50.000 | 50.000 | 0.000 | +0.00% |
| frame p99 | 50.100 | 50.100 | -0.000 | -0.00% |
| frame CPU mean | 0.890 | 0.885 | -0.005 | -0.51% |
| frame CPU p95 | 1.500 | 1.400 | -0.100 | -6.67% |
| frame CPU p99 | 2.300 | 2.100 | -0.200 | -8.70% |
| collector mean | 0.006 | 0.007 | 0.001 | +16.48% |
| collector p95 | 0.100 | 0.100 | 0.000 | +0.00% |
| collector p99 | 0.100 | 0.100 | 0.000 | +0.00% |
| uploader main mean | 0.000 | 0.417 | 0.417 | N/A |
| uploader main p95 | 0.000 | 0.700 | 0.700 | N/A |
| uploader main p99 | 0.000 | 0.900 | 0.900 | N/A |
| network async mean | 0.000 | 384.175 | 384.175 | N/A |
| network async p95 | 0.000 | 407.700 | 407.700 | N/A |
| network async p99 | 0.000 | 423.900 | 423.900 | N/A |
| requests/min | 0.000 | 11.995 | 11.995 | N/A |
| uploaded KB/min | 0.000 | 479.485 | 479.485 | N/A |
| average payload bytes | 0.000 | 40929.375 | 40929.375 | N/A |
| heap peak | 12889277.000 | 14495804.000 | 1606527.000 | +12.46% |

Positive overhead means worse (FPS drop or time/memory increase). A negative result means lower observed overhead in this sample; it is not, by itself, evidence that telemetry caused a performance gain.

### Acceptance criteria

| status | criterion | actual | limit |
|---|---|---:|---|
| PASS | B vs A average FPS drop | -1.9819416700354908 | <= 3 |
| PASS | B vs A frame p95 increase | 0 | <= 5 |
| PASS | B collector p95 | 0.09999996423721313 | < 1 |
| PASS | C vs A average FPS drop | -3.355261543654437 | <= 5 |
| PASS | C vs A frame p95 increase | 0 | <= 8 |
| PASS | C uploader main-thread p95 | 0.699999988079071 | < 2 |
| PASS | C dropped batches in every run | 0, 0, 0 | all === 0 |
| PASS | C dropped samples in every run | 0, 0, 0 | all === 0 |
| PASS | C pending batches drained in every run | 0, 0, 0 | all === 0 |
| PASS | C persisted queue drained in every run | 0, 0, 0 | all === 0 |
| PASS | C in-flight requests drained in every run | 0, 0, 0 | all === 0 |
| PASS | C last error is null in every run | , ,  | all === null |
| PASS | C acknowledged batches match sent batches in every run | 28/28, 28/28, 28/28 | all === sentBatches |

### Browser/cloud gate

Browser smoke verification: **PASS**. Render health: 200; CORS preflight from https://quick-grid-nu.vercel.app: 204; scenario C: **AVAILABLE**.

### Limitations

- The benchmark ran against a dirty working tree. Existing working-tree changes were preserved and are listed in the JSON artifact.
- Each measured run logged three `ERR_CONNECTION_REFUSED` resource errors from the separate legacy gameplay API at `http://localhost:3001`. They occurred while preparing the grid, before warm-up and the official measurement window.
- The existing one-second heap sampler reported a final current heap above its sampled peak in at least one run. Raw API values are retained; treat heapPeakBytes as a sampled peak, not an exact maximum.
- networkAsyncLatency is reported only as asynchronous network latency and is not used as CPU/frame overhead.
- The player uses deterministic continuous throttle. Existing bots provide race/rendering load; no physics, AI, geometry, schema, or sample-rate behavior is altered.

### Reproduction

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
npm.cmd run benchmark:ml22 -- --base-url='https://quick-grid-nu.vercel.app' --output='artifacts/ml22_browser_benchmark_vercel.json' --report='artifacts/ml22_browser_benchmark_vercel.md'
```

Quick diagnostic only:

```powershell
$env:VITE_TELEMETRY_API_URL='https://quick-grid-telemetry-api.onrender.com'
npm.cmd run benchmark:ml22 -- --quick
```
