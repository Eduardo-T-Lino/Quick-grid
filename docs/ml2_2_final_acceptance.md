# ML2.2 final acceptance

Estado durante o primeiro push da tarefa J: **aguardando smoke da nova lineage em produção**. A palavra `ACCEPTED` só será registrada depois que esse gate, o push final e a tag imutável passarem.

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
| Nova lineage em produção | PENDING | Exige Vercel/Render saudáveis, novo asset e uma sessão curta COMPLETED anunciando o freeze J. |
| Commit final e tag | PENDING | Só após o smoke: commit `chore: freeze ML2.2 training data baseline` e tag anotada `ml2.2-accepted`. |

Aviso operacional não bloqueante: o PostgreSQL Render Free não é armazenamento permanente e não tem a política de backup necessária para um corpus futuro. Isto não invalida as provas de aceitação ML2.2, mas deve ser resolvido antes de depender do ambiente como repositório durável de treino.

Resultado atual: **ML2.2 AINDA NÃO ACEITA**, aguardando os gates explicitamente marcados `PENDING`. ML3 não foi iniciado.
