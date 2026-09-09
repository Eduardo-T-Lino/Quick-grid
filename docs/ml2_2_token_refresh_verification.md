# ML2.2-I — Production token refresh recovery proof

Overall result: **PASS**

This proof exercised the real Vercel frontend and Render backend. Playwright changed only the `Authorization` header of exactly one eligible batch request and continued that request to the network. The refresh request, `x-refresh-credential`, request bodies, URLs, methods, and every later authorization header were left untouched.

## Baseline and deployment

- Baseline commit `f0a67e5dd18c1972090316fa2d011603fef749ac` was pushed linearly to `origin/main` before this proof.
- Local and remote `main` were confirmed at `0/0` divergence after the push.
- Frontend final URL: `https://quick-grid-nu.vercel.app/`.
- Production JS asset: `https://quick-grid-nu.vercel.app/assets/index-BdIxIu9p.js`.
- Production CSS asset: `https://quick-grid-nu.vercel.app/assets/index-CfJw5z2Y.css`.
- Browser: Chromium `153.0.8010.12`, headless, 1920×1080, DPR 1.
- Render `/health`: HTTP 200 before the session was created.

The pushed commit changes only benchmark documentation and tooling, so the unchanged production application asset is expected. The application loaded stably and exposed every required telemetry global before the test started.

## Existing architecture confirmation

| requirement | implementation confirmed |
|---|---|
| Batch HTTP 401 starts recovery | `uploadSingleBatch()` delegates failures to `handleHttpError()`; HTTP 401 calls `refreshIngestToken()` and schedules the same in-memory batch for retry. |
| Refresh proof transport | `refreshIngestToken()` sends the stored proof only in `x-refresh-credential`. |
| Refresh endpoint | `POST /api/v1/telemetry/sessions/:id/refresh-token`. |
| Backend credential verification | HMAC-SHA256 signature uses timing-safe comparison; expiration, `purpose=refresh`, and route `sessionId` are checked by `requireRefreshCredential`. |
| Active-session restriction | `telemetryService.refreshToken()` returns 409 unless the database session is `ACTIVE`. |
| New authorization | A valid refresh returns a new `ingestToken` and `expiresAt`; the uploader stores both and persists the session record before returning success. |
| Same-batch retry | The original pending batch remains queued; only `nextRetryAt` changes. Its session, sequence, sample count, and serialized-body hash remained identical in production. |
| Completion recovery | `endSession()` refreshes proactively when `expiresAt` has passed and also refreshes/retries once when `/complete` returns 401. Both branches now have explicit local regression tests. |

No backend architecture, TTL, authentication policy, CORS policy, gameplay code, endpoint, or production secret was changed.

## Controlled production scenario

- Interlagos, dry, one bot plus player, 40 laps, automatic, professional difficulty.
- Deterministic seed 2203 and continuous throttle.
- Consent enabled before the race.
- Injection was armed only after the session was `ACTIVE`, a `serverSessionId` existed, and pending/persisted/in-flight/sent/acknowledged counts were all zero.
- Session: `5d639195-4ebe-48ed-ada3-fb80a5ec128d`.

## Sanitized event timeline

| UTC timestamp | event | evidence |
|---|---|---|
| 2026-09-09T12:36:04.182Z | `SESSION_ACTIVE` | Session ID present; queue clean. |
| 2026-09-09T12:36:07.440Z | `TARGET_BATCH_REQUEST` | Session above, sequence 0, 50 samples. |
| 2026-09-09T12:36:07.440Z | `AUTH_HEADER_INTENTIONALLY_REPLACED` | Only authorization changed to the documented fake value; request continued to the real Render URL. |
| 2026-09-09T12:36:07.731Z | `BACKEND_RESPONSE_401` | HTTP 401 from `https://quick-grid-telemetry-api.onrender.com/api/v1/telemetry/batches`. |
| 2026-09-09T12:36:07.732Z | `REFRESH_REQUEST` | POST for the same session; refresh header forwarded unchanged. |
| 2026-09-09T12:36:07.965Z | `REFRESH_RESPONSE` | HTTP 200; the harness deliberately did not read the response body. |
| 2026-09-09T12:36:08.488Z | `TARGET_BATCH_RETRY` | Same session, sequence 0, 50 samples, identical SHA-256 body hash. |
| 2026-09-09T12:36:08.782Z | `TARGET_BATCH_ACK` | HTTP 200, `PROCESSED`. |
| 2026-09-09T12:36:12.712Z | `SUBSEQUENT_BATCH_ACK` | Sequence 1, 50 samples, HTTP 200, `PROCESSED`. |
| 2026-09-09T12:36:12.745Z | `QUEUE_DRAINED` | Pending, persisted estimate, and in-flight all zero. |
| 2026-09-09T12:36:12.745Z | `SESSION_CONTINUES_ACTIVE` | Same session remained usable after recovery. |
| 2026-09-09T12:36:13.835Z | `SESSION_COMPLETED` | Normal completion after the recovery proof. |

The target request and retry both had body SHA-256 `dfb81bfc8bba03c3b3efae4775c3cbbb0fa47f3a068636e1df9d2591ac36670b`. This hash proves byte-for-byte body identity without storing the telemetry payload.

## Uploader state

| metric | before injection | after recovery while ACTIVE | after normal completion |
|---|---:|---:|---:|
| sent batches/attempts | 0 | 3 | 4 |
| acknowledged batches | 0 | 2 | 3 |
| uploaded samples | 0 | 100 | 103 |
| retry count | 0 | 1 | 1 |
| dropped batches | 0 | 0 | 0 |
| dropped samples | 0 | 0 | 0 |
| pending batches | 0 | 0 | 0 |
| persisted batches (public estimate) | 0 | 0 | 0 |
| in-flight requests | 0 | 0 | 0 |
| idempotent duplicates | 0 | 0 | 0 |
| session status | ACTIVE | ACTIVE | COMPLETED |

`sentBatches` counts HTTP attempts, while `acknowledgedBatches` counts accepted batches. The final expected difference of one is the deliberately induced 401. `lastError` retains the sanitized expected 401 message (`Formato de token inválido`) even after successful recovery; it is historical state, not an active failure.

## Continuity and persistence evidence

- Observed ACK sequences: 0, 1, 2.
- Observed sample counts: 50, 50, 3; total 103.
- Gaps: none.
- Duplicate ACK sequences: none.
- ACK status for all three: `PROCESSED`.
- Production session API after completion: status `COMPLETED`, schema version 2, `PLAYER_ONLY`, 3 received batches, 103 received samples.
- API counters exactly matched the browser-observed unique sequences and sample total.

Direct PostgreSQL inspection with `scripts/verify_cloud_telemetry.js` was not run because this host has no `DATABASE_URL`; only `.env.example` contains the key placeholder. Therefore compressed-row GZIP inspection cannot be claimed. The production HTTP/API proof does establish continuous sequences, no double count, matching batch/sample counters, completed status, and schema version 2 without writing directly to the database.

## Acceptance criteria

| criterion | result |
|---|---|
| Exactly one authorization replacement | PASS |
| Real Render HTTP 401 | PASS |
| Refresh requested for the same session | PASS |
| Refresh HTTP 200 | PASS |
| Same session/sequence/sample count/body retried | PASS |
| Retry received HTTP 200 `PROCESSED` | PASS |
| `retryCount` increased | PASS — final value 1 |
| No dropped batches or samples | PASS |
| Pending/persisted/in-flight returned to zero | PASS |
| Session remained ACTIVE after recovery | PASS |
| A later batch was processed normally | PASS |
| Session completed normally | PASS |
| Observed sequence/API counter continuity | PASS |

## Security and sanitization

- The artifact contains zero signed-credential patterns, zero database URLs, and zero sensitive keys named `ingestToken`, `refreshCredential`, `authorization`, or `databaseUrl`.
- The original authorization value was never logged or stored.
- The refresh request body and response body were not read by the harness.
- Header values other than the documented fake authorization were not recorded.
- The intentional fake token is present only to make the controlled fault auditable.

## Local regression coverage

The local suites now explicitly cover:

- expired ingest token → 401;
- invalid signature → 401;
- ingest token scoped to another session → 401;
- ingest token used as a refresh proof → 401;
- refresh proof scoped to another session → 401;
- refresh for a `COMPLETED` session → 409;
- valid refresh for an `ACTIVE` session → a different, valid ingest token;
- proactive refresh before completion when `expiresAt` has passed;
- refresh and one retry when `/complete` returns 401.

Focused results before the full gate: `test:ml22` 17/17 and `test:ml22:completion` 38/38. The complete `npm run test:ml22:gate` then passed 312/312 with its internal build PASS. A separate `npm run build` also passed and emitted `index-BxFmjaBk.js` locally; this local asset is not presented as the Vercel production fingerprint.

## Reproduction

```powershell
npm.cmd run verify:ml22:refresh
```

The command writes the sanitized machine-readable evidence to `artifacts/ml22_token_refresh_verification.json`. It must be run only against the authorized production endpoints shown above.
