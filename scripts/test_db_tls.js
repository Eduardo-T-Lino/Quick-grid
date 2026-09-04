// ML2.2-D: exercise actual pg Pool/Client configuration without opening sockets.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { config, validateProductionConfig } from '../server/src/config.js';

let passed = 0, failed = 0;
function check(condition, label) {
  if (!condition) { failed++; throw new Error(label); }
  passed++; console.log(`PASS: ${label}`);
}
function rejectsDatabase(fn) {
  try { fn(); return false; }
  catch (err) { return err.message.includes('DATABASE_URL'); }
}

const originalConfig = { ...config };
const originalSslMode = process.env.PGSSLMODE;
const originalCors = process.env.CORS_ALLOWED_ORIGINS;
try {
  // Ignore inherited production credentials and TLS environment overrides.
  delete process.env.PGSSLMODE;
  process.env.CORS_ALLOWED_ORIGINS = 'https://localhost';
  Object.assign(config, { NODE_ENV: 'production', isProduction: true, isTest: false,
    INGEST_TOKEN_SECRET: randomBytes(32).toString('hex'),
    CORS_ALLOWED_ORIGINS: ['https://localhost'],
    DB_POOL_MAX: 3, DB_IDLE_TIMEOUT_MS: 1700, DB_CONNECTION_TIMEOUT_MS: 800 });

  for (const [label, suffix, tls] of [
    ['internal-style URL', '', false],
    ['external-style URL', '?sslmode=require', true]
  ]) {
    // Reserved .invalid hostname; neither Pool nor Client is connected.
    config.DATABASE_URL = `postgres://local_test@db.invalid/test_only${suffix}`;
    validateProductionConfig();
    const { getPool } = await import(`../server/src/db/pool.js?tls-case=${label}`);
    const pool = getPool();
    try {
      check(pool instanceof pg.Pool && !pool.isMemory, `${label}: production uses PostgreSQL, never memory`);
      check(pool.options.connectionString === config.DATABASE_URL, `${label}: connection string preserved exactly`);
      check(!Object.hasOwn(pool.options, 'ssl'), `${label}: no manual SSL option passed to Pool`);
      check(pool.options.max === 3 && pool.options.idleTimeoutMillis === 1700
        && pool.options.connectionTimeoutMillis === 800, `${label}: pool limits preserved`);
      const client = new pg.Client(pool.options);
      check(tls ? Boolean(client.connectionParameters.ssl) : client.connectionParameters.ssl === false,
        `${label}: actual pg parser selects expected TLS mode`);
      check(client.connectionParameters.ssl?.rejectUnauthorized !== false,
        `${label}: certificate validation not disabled`);
      check(pool.totalCount === 0, `${label}: test opened no database connection`);
    } finally { await pool.end(); }
  }

  for (const [label, url] of [['missing', ''], ['invalid protocol', 'https://db.invalid/test_only']]) {
    config.DATABASE_URL = url;
    check(rejectsDatabase(validateProductionConfig), `${label}: production config rejects DATABASE_URL`);
    const { getPool } = await import(`../server/src/db/pool.js?tls-case=${label}`);
    check(rejectsDatabase(getPool), `${label}: Pool fails instead of falling back to memory`);
  }

  function backendFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
      const filename = path.join(directory, item.name);
      return item.isDirectory() ? backendFiles(filename) : filename.endsWith('.js') ? [filename] : [];
    });
  }
  const backend = backendFiles('server/src').map(file => fs.readFileSync(file, 'utf8')).join('\n');
  check(!/rejectUnauthorized\s*[:=]\s*false/.test(backend), 'backend has no certificate-verification bypass');
  const startup = fs.readFileSync('server/src/server.js', 'utf8');
  check(startup.indexOf("await db.query('SELECT 1;')") >= 0
    && startup.indexOf("await db.query('SELECT 1;')") < startup.indexOf('app.listen('),
    'database readiness still precedes listener');
} catch (err) {
  if (!failed) failed++;
  // Never print database configuration, subprocess output or credential values.
  console.error('FAIL:', err.code || 'DB_TLS_TEST_FAILED');
} finally {
  Object.assign(config, originalConfig);
  if (originalSslMode === undefined) delete process.env.PGSSLMODE;
  else process.env.PGSSLMODE = originalSslMode;
  if (originalCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
  else process.env.CORS_ALLOWED_ORIGINS = originalCors;
  console.log(`${passed} PASSOU | ${failed} FALHOU`);
  process.exitCode = failed ? 1 : 0;
}
