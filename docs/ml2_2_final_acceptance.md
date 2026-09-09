# ML2.2 final acceptance

Estado final: **ML2.2 = ACCEPTED**. Este documento integra o commit final apontado pela tag anotada imutável `ml2.2-accepted`. ML3 não foi iniciado.

| Gate | Estado | Evidência |
|---|---|---|
| ML2.0 backend foundation | PASS | Schema relacional, API, validação, GZIP e idempotência cobertos pelo gate local e pela verificação cloud anterior. |
| ML2.1 online delivery | PASS | Consentimento, fila, ACK, retry e completion cobertos pelas suítes e sessões reais anteriores. |
| ML2.2 hardening | PASS | Offline/reconnect, reload, credenciais escopadas, idempotência e finalização cobertos pelo gate ML2.2. |
| Cloud database verification | PASS | Sessão humana `ad759118-4386-481f-9d34-f3d496eb1854` verificada anteriormente em PostgreSQL/GZIP real. |
| Offline recovery | PASS | Gate local e fluxo de entrega já homologado. |
| Reload recovery | PASS | Persistência IndexedDB e continuidade de sequência já homologadas. |
| Vercel A/B/C benchmark | PASS | `docs/ml2_2_browser_benchmark.md`; três sessões C completas, sem drops/retries/pending. |
| Production token refresh | PASS | `docs/ml2_2_token_refresh_verification.md`; sessão `5d639195-4ebe-48ed-ada3-fb80a5ec128d` completada após 401/refresh/retry real. |
| Version audit | PASS | `docs/ml2_2_baseline_freeze.md`; nove commits posteriores a `b956149` classificados por diff real. |
| Baseline freeze local | PASS | Fonte canônica, matriz de datasets e fingerprint `919c932171a41a44d40af1d86df530a8f3db911b030691b68908766712a6c16c`. |
| Nova lineage em produção | PASS | Vercel `index-BZDUF3vN.js`; Render `/health` 200 em `0.3.0-ml2` e `/ready` 200; sessão `d2d44255-6487-4210-9daa-2e19f2df5ff3` COMPLETED. |
| Commit final e tag | PASS | Este documento integra `chore: freeze ML2.2 training data baseline`; `origin/main` e a tag anotada `ml2.2-accepted` foram verificados após publicação. |

## Gate local final

`npm run test:ml22:final` passou com 344 verificações: 315 regressões e 29 checks de consistência/fingerprint. O build Vite foi executado uma única vez dentro do gate e passou, gerando localmente `index-C7FYrzUS.js`.

## Smoke de produção da nova lineage

- Vercel production: HTTP 200, asset JS novo `index-BZDUF3vN.js` (o anterior era `index-BdIxIu9p.js`).
- Render: `/health` HTTP 200, storage PostgreSQL, versão `0.3.0-ml2`; `/ready` HTTP 200.
- Browser: Chromium 153, fluxo real com consentimento em Interlagos.
- Sessão: `d2d44255-6487-4210-9daa-2e19f2df5ff3`, `COMPLETED`, 2 batches, 58 samples, zero retries, zero drops e filas zeradas.
- API: Schema 2, game `0.3.0-ml2`, geometry `1.5.0-centripetal`, physics `1.5.0-gt3`, features `2.1.0`, 10 Hz e fingerprint `919c932171a41a44d40af1d86df530a8f3db911b030691b68908766712a6c16c`.
- Três `ERR_CONNECTION_REFUSED` do backend auxiliar legado `http://localhost:3001` ocorreram na preparação do grid, exatamente como no benchmark H. São WARNING conhecido, anterior ao freeze, com fallback local; telemetria Vercel → Render permaneceu íntegra.

O artefato sanitizado local está em `artifacts/ml22_lineage_smoke.json` e permanece ignorado pelo Git. O scan do diff final não encontrou URL PostgreSQL, bearer real, ingest token, refresh credential ou segredo configurado.

Aviso operacional não bloqueante: o PostgreSQL Render Free não é armazenamento permanente e não tem a política de backup necessária para um corpus futuro. Isto não invalida as provas de aceitação ML2.2, mas deve ser resolvido antes de depender do ambiente como repositório durável de treino.

Resultado: **ML2.2 = ACCEPTED**. ML3 não foi iniciado.
