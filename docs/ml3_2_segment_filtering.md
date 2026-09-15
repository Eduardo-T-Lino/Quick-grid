# ML3.2 — Segment Filtering & Acceptance Masks

Status: **implementada para payloads raw em memória**. Esta fase materializa decisões determinísticas de qualidade, mas não cria dataset final, não realiza split e não inicia ML3.3.

## Contrato

`scripts/ml3/segmentFilter.js` consome diretamente `QUALITY_POLICY` e os cinco avaliadores da ML3.1. Nenhum threshold é recalculado a partir de percentis ou da sessão `ad759...`.

Para cada sample raw, a saída preserva provenance, UUID canônico da sessão, ID da coleta raw, volta e `sampleIndex`, além de:

- máscara `ACCEPTED` ou `REJECTED`;
- razão primária exclusiva para contagens sem double counting;
- todos os reason codes aplicáveis;
- `finalTrainingEligible: false`.

Os intervalos são maximais, contínuos por `sampleIndex` e não cruzam sessão, volta ou lineage. Os estratos 0.2, 0.3 e runtime permanecem separados.

## Regra estrutural de enumeração

A ML3.1 fixa o tamanho em 50 samples, mas não define stride. A ML3.2 enumera todas as janelas contíguas possíveis com passo 1 e calcula a união dos samples cobertos por pelo menos uma janela elegível. O passo 1 é uma regra estrutural de enumeração, não um novo threshold de qualidade. Isso evita escolher arbitrariamente um alinhamento e impede double counting nas métricas finais da máscara.

Uma volta `SEGMENT_ONLY` pode produzir janelas válidas fora das exclusões. Off-track, spin, collision, recovery e gaps usam exclusivamente as janelas temporais da `ML3.1-1`. Collision mantém a decisão de lap da ML3.1 e bloqueia a avaliação de segmentos daquela volta.

`UNFLAGGED` nunca é evidência suficiente: o sample precisa pertencer a uma janela aprovada por `evaluateSegment` e também passar por `evaluateSample`.

## Artifact ML3.0

O artifact canônico aceito tem SHA-256 lógico `ade0e99d5162eeea75dfeea9aa70068b64588d025d33d35b5cf7ea335a3ffe68`. A aplicação valida novamente esse hash e é read-only.

O artifact guarda inventário, agregados e localização de alguns eventos, mas não incorpora os objetos raw por sample. Sem os timestamps, superfícies, flags de recovery e identidades individuais completas, a ML3.2 rejeita conservadoramente os samples declarados com `RAW_SAMPLE_EVIDENCE_MISSING`; ela não fabrica `sampleIndex` nem promove os 1.735 samples apenas diagnosticados como unflagged.

Máscaras e intervalos materiais só são emitidos quando os samples raw são fornecidos separadamente em `samplesBySession`, indexados pelo UUID canônico. Eles nunca são inseridos no artifact, pois isso alteraria o hash do freeze. A ML3.2 reaplica `analyzeSamples` da ML3.0 e exige que contagens, laps, eventos, superfícies, gaps e integridade coincidam com o inventário congelado; divergência produz `RAW_SAMPLE_INVENTORY_MISMATCH` e rejeita a sessão. A ausência do payload é um blocker de aplicação, não uma autorização para reconstruí-lo a partir de estatísticas agregadas.

### Aplicação agregada sem raw

| Escopo | Samples | Accepted | Rejected | Accepted intervals | Rejected intervals | Coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `ad759118-4386-481f-9d34-f3d496eb1854` | 1.940 | 0 | 1.940 | 0 | 0 | 0% |
| Inventário completo | 20.892 | 0 | 20.892 | 0 | 0 | 0% |

Razões primárias no inventário completo, sem double counting:

- `PARENT_LINEAGE_NOT_ELIGIBLE`: 10.745;
- `PARENT_SESSION_NOT_ELIGIBLE`: 8.207;
- `RAW_SAMPLE_EVIDENCE_MISSING`: 1.940.

Os 18 registros produzem blocos de rejeição agregados, não intervalos falsos. Para `ad759...`, a razão é `RAW_SAMPLE_EVIDENCE_MISSING`. O artifact não foi alterado e a saída reproduzível recebeu fingerprint `342c3a9ad92ca37bac08bb89c94b49c2d41cfb03b7fffba308d651f7f3ae804a` no recorte direcionado e `0a643e06282f965517a4de1de9e4ce17a96c7257136d2b4d7591013de394afcf` no inventário integral.

## ML3.2-B — materialização da evidência raw

O modo `ml3:segment:evidence` abre uma única transação PostgreSQL `REPEATABLE READ READ ONLY`, consulta a sessão, seus batches GZIP e suas voltas, e mantém os samples decodificados exclusivamente em um `Map samplesBySession`. O inventário normal não retém esse mapa; ele só é habilitado explicitamente para esta materialização.

```powershell
npm.cmd run ml3:segment:evidence -- `
  --inventory artifacts/ml3_dataset_inventory.json `
  --session ad759118-4386-481f-9d34-f3d496eb1854 `
  --output artifacts/ml3_ad759_segment_evidence.json
```

Antes de gravar qualquer saída, o comando valida:

- UUID e SHA canônico aceito pela ML3.1;
- contagens de sessão, batches, samples e laps contra o freeze;
- versões de schema, build, física, geometria e feature manifest;
- identidade da sessão local presente nos raw samples;
- GZIP, JSON, array, contagem e metadados first/last de todos os batches;
- análise raw contra os sinais congelados da ML3.0.

Qualquer divergência termina com `RAW_EVIDENCE_FREEZE_MISMATCH` ou `RAW_SAMPLE_INVENTORY_MISMATCH` e não cria output. O arquivo derivado contém somente máscaras, reason codes, segmentos, intervalos, métricas, provas de mismatch zero e um SHA-256 reproduzível. Campos raw como `trackState`, `carState`, `driverAction`, `eventState` e `payload_compressed` são recusados antes da serialização. O output em `artifacts/` permanece local e não deve ser commitado.

As métricas reais de `ad759...` só podem substituir o diagnóstico agregado acima após uma execução com `DATABASE_URL` disponível exclusivamente no environment. Ausência de credencial retorna apenas `CLOUD_FULL_INVENTORY_BLOCKED:DATABASE_URL_MISSING`, sem criar artifact e sem inferir samples a partir dos agregados.

## Limites

- nenhum dataset final é exportado;
- nenhum sample é declarado pronto para treino;
- nenhum split train/validation/test é criado;
- física, schema, features, backend, banco e `acceptedBaseline.js` permanecem inalterados;
- ML3.3 não é iniciada.
