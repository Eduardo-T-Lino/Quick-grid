# ML2.2-E — verificação de dados reais do PostgreSQL

## Estado e escopo

Ferramenta: `scripts/verify_cloud_telemetry.js`. A execução automatizada usa somente fixtures/mocks locais, nunca o banco cloud. Na preparação desta fase, `DATABASE_URL` não estava disponível: **nenhuma consulta real foi executada**. Os números 41 batches e 1940 samples são expectativas fornecidas pelo cliente, não resultados já medidos no PostgreSQL.

Nenhuma alteração de API, pool da aplicação, schema, migrations, ML, IA, física, gameplay, Render ou Vercel é necessária. O script não importa o pool da aplicação e não executa migrations. Usa `pg` já instalado, uma conexão e a connection string intacta, sem `ssl` manual. Os parâmetros TLS da URL são interpretados pelo próprio [node-postgres](https://node-postgres.com/features/ssl).

## Executar no Windows sem gravar credenciais

Na raiz do Quick-grid, em PowerShell, use o prompt oculto abaixo. Cole nele a **External Database URL** do banco existente no Render, incluindo seus parâmetros TLS. Não cole a URL diretamente em um comando: isso pode persistir no histórico do PowerShell.

```powershell
$verificationUrl = Read-Host 'Cole a External Database URL do Render (entrada oculta)' -AsSecureString
try {
    $env:DATABASE_URL = [System.Net.NetworkCredential]::new('', $verificationUrl).Password
    node scripts/verify_cloud_telemetry.js ad759118-4386-481f-9d34-f3d496eb1854
} finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    $verificationUrl.Dispose()
    Remove-Variable verificationUrl -ErrorAction SilentlyContinue
}
```

A variável existe apenas nesse processo PowerShell e seus filhos; não é persistida no sistema. A senha ainda precisa existir temporariamente em memória para o cliente PostgreSQL. Não usar `.env`, `setx`, arquivo, argumento CLI, Git, chat, logs ou screenshots para guardar/divulgar a URL. Não executar sob transcrição/captura de tela. Não alterar o banco ou liberar acesso público indiscriminadamente para contornar falhas de conexão.

Se a variável já estiver disponível na sessão, os comandos exatos são:

```powershell
try {
    node scripts/verify_cloud_telemetry.js ad759118-4386-481f-9d34-f3d496eb1854
} finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
```

Sem argumento, `node scripts/verify_cloud_telemetry.js` consulta a sessão **COMPLETED mais recente**. O relatório identifica esse modo de seleção; não afirma que ela é a sessão humana citada. Com argumento, consulta exclusivamente aquele UUID: se não existir, retorna `SESSION_NOT_FOUND`, sem procurar outra sessão. Para confirmar a sessão informada, prefira o comando com UUID acima. O relatório mascara o UUID e substitui participantes por aliases locais como `participant-1`.

Exit codes: `0 = PASS`, `2 = WARNING`, `1 = FAIL/consulta incompleta`. WARNING não é homologação completa. Erros mostram apenas códigos permitidos; nunca mensagem/stack do driver, URL, host, senha, tokens ou credenciais de refresh. Se não houver variável, retorna `DATABASE_URL_MISSING` antes de instanciar o pool.

## Queries utilizadas

As consultas completas estão exportadas em `QUERIES`, no script, para inspeção e testes. Todos os filtros usam `$1::uuid`, nunca interpolação de entrada. As três tabelas são lidas no mesmo snapshot:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
-- SELECTs abaixo, sempre parametrizados quando há sessionId
ROLLBACK;
```

1. `telemetry_sessions`: seleciona explicitamente id, status, schema/track/sample rate/scope, contadores, cinco versões e datas. Por UUID: `WHERE id = $1::uuid`. Sem UUID: `WHERE status = 'COMPLETED' ORDER BY finished_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1`. Não seleciona `client_info`.
2. `telemetry_batches`: `COUNT(*)`, `SUM(sample_count)`, `MIN/MAX(batch_sequence)`, `COUNT(DISTINCT batch_sequence)` e `SUM(octet_length(payload_compressed))`, filtrando a sessão.
3. `telemetry_batches`: seleciona todos os batches dessa sessão, ordenados por sequência, incluindo contagens, índices, timestamps, bytes declarados e BYTEA. Mede cada GZIP e prioriza um batch de 50 samples no resumo.
4. `telemetry_laps`: seleciona todas as voltas da sessão, com participante, número, tempo, samples, eventos, velocidades e validade. Saída usa aliases, nunca o participante original.
5. Nas seleções, `pg_column_size` mede uma aproximação do tamanho dos registros de metadata, separada do payload; veja limitações abaixo.

Não há `INSERT`, `UPDATE`, `DELETE`, DDL, migrations, `FOR UPDATE` nem commit. A transação [READ ONLY / REPEATABLE READ](https://www.postgresql.org/docs/current/sql-set-transaction.html) impede mutações comuns e mantém um snapshot consistente. O cliente sempre é liberado e o pool fechado. Timeout de conexão: 10 s; SQL: 15 s; cliente: 20 s. Limite de diagnóstico: 1000 batches, 1000 laps e 32 MiB de payload comprimido por sessão; se excedido, retorna FAIL, sem apresentar consulta truncada como completa. Cada GZIP tem limite de 1 MiB comprimido/descompactado, usando [maxOutputLength](https://nodejs.org/api/zlib.html).

## Validações e interpretação

| Seção | Critério |
| --- | --- |
| SESSION | UUID solicitado (ou seleção latest explicitada), COMPLETED, schema 2, PLAYER_ONLY, datas válidas |
| BATCH COUNTS | 41 na sessão, no agregado SQL e na lista de rows |
| SAMPLE COUNTS | 1940 na sessão, no agregado e soma dos rows; tamanho de cada payload igual ao sample_count |
| SEQUENCES | Min/max medidos, sem duplicatas/gaps, agregados coerentes; início diferente de zero gera WARNING |
| LAPS | Contagem igual a completed_laps; números, tempos, eventos e pares participante/volta válidos; saída lista todas as voltas |
| GZIP | Descompactação e JSON válidos para todos os batches, não apenas o escolhido |
| SCHEMA | Todos os samples schema 2, PLAYER, track correto, principais features presentes/finitas; NaN/Infinity e null no lugar de número rejeitados |
| VERSION LINEAGE | Sessão: schema 2, geometry 1.5.0-centripetal, physics 1.5.0-gt3, features 2.1.0 |
| BATCH METADATA | Primeiro/último sampleIndex e timestamp contra row; NUMERIC(16,3) permite arredondamento de até 0,0005 na unidade do timestamp, mais tolerância de ponto flutuante |
| COMPRESSION | raw/compressed bytes medidos vs. campos SQL; médias dos batches e razões de compressão |

`LAP_SUMMARY_MISSING` gera WARNING quando não há rows; as outras verificações continuam. Se completed_laps declara voltas inexistentes, a inconsistência também gera FAIL. Sem gaps e com início zero, os 41 batches terão sequências 0–40, mas isso é medido, não assumido.

### Limitação real do formato armazenado: identidade do payload

`TelemetryService.ingestBatch()` comprime `JSON.stringify(samples)`, **não** o envelope HTTP `{sessionId, batchSequence, samples}`. Portanto o GZIP atual não contém `payload.sessionId` nem `payload.batchSequence`. A ferramenta reconhece o array real e emite `PAYLOAD_ENVELOPE_NOT_STORED` como WARNING. A relação SQL `row.session_id` é verificada separadamente; não é apresentada como prova de um campo inexistente no JSON.

O coletor gera `metadata.sessionId` local, enquanto a API gera o UUID de sessão do servidor. Se forem diferentes, o relatório emite `SAMPLE_SESSION_ID_DIFFERS_DB_SESSION`; também exige consistência de um único ID local entre os samples. Não imprime esse ID nem o reescreve. Não há como provar pelo envelope descartado a associação dos IDs: a conclusão global fica WARNING, mesmo que todas as contagens e GZIP estejam corretos. Se encontrar um envelope, valida seus IDs/sequência estritamente; divergência é FAIL.

As versões geometry/physics/features ficam em `telemetry_sessions`, não em cada sample. O relatório declara essa fonte. Não cria metadata ausente nem afirma que uma versão de sessão comprova campos que não foram armazenados nos samples.

## Compressão e storage

Valores calculados exclusivamente de BYTEA real lido e de `gunzipSync`: `rawBytes`, `compressedBytes`, `compressionRatio = rawBytes / compressedBytes`. Uma razão maior indica maior compressão. As médias são aritméticas entre os batches; também há razão agregada `SUM(raw) / SUM(compressed)`, que não é a mesma métrica.

A base da projeção é `samples / sample_rate_hz`, tempo nominal de coleta ativa de um jogador. `finished_at - created_at` é exibido separadamente, pois pode incluir pausas, upload e espera. Projeção para 1, 100, 1000 e 10000 jogadores durante uma hora:

`bytes comprimidos / samples × sample_rate_hz × 3600 × jogadores`.

O overhead aproximado usa a soma dos tamanhos de registros de metadata observados por [`pg_column_size`](https://www.postgresql.org/docs/current/functions-admin.html), escalada pela mesma proporção. É um **proxy parcial**, não o tamanho físico total: exclui índices, overhead TOAST, espaço livre/alinhamento de páginas, WAL, backups e client_info. Inclui o mix observado de sessões/voltas/batches; não garante a mesma taxa para uma corrida contínua de uma hora. Não usa percentual inventado nem apresenta isso como billing ou capacidade garantida do plano. Havendo falha de integridade, a projeção fica indisponível; métricas parciais identificam quantos batches foram medidos.

## Testar sem PostgreSQL

```powershell
npm run test:cloud-verification
npm run test:ml22:gate
npm run build
```

Os testes geram samples fictícios, compactam com zlib e injetam um mock de `pg`. Cobrem sucesso, contagens divergentes, gaps/duplicatas, GZIP inválido/limitado, envelope ausente/incorreto, null/NaN/Infinity, versões, metadata, laps ausentes, mascaramento, queries parametrizadas, rollback, liberação do pool e ausência de credenciais. Nenhuma query cloud é executada pela regressão.
