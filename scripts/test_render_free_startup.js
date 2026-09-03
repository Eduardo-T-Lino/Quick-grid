// ML2.2-C: local Blueprint contract and actual npm startup failure propagation.
// No cloud access, real PostgreSQL, provider CLI or deployment is used here.
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

let passed = 0, failed = 0;
function check(condition, message) {
  if (!condition) { failed++; throw new Error(message); }
  passed++; console.log(`PASS: ${message}`);
}

function runStartup(command, databaseUrl) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NODE_ENV: 'production', DATABASE_URL: databaseUrl,
      INGEST_TOKEN_SECRET: randomBytes(32).toString('hex'),
      CORS_ALLOWED_ORIGINS: 'https://localhost', HOST: '127.0.0.1', PORT: '0',
      DB_CONNECTION_TIMEOUT_MS: '500', npm_config_script_shell: '' };
    // Execute the exact Blueprint command using the host shell's && semantics.
    const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
    const child = spawn(executable, args, { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function checkMigrationFailure(result, label) {
  check(result.code !== null && result.code !== 0 && !result.signal, `${label}: command fails without timeout`);
  check(result.stdout.includes('[MIGRATOR]'), `${label}: actual migrator was executed`);
  check(!/>\s*(?:node server\/src\/server\.js|quick-grid@[^\n]* server:start)/.test(result.stdout)
    && !result.stdout.includes('INICIANDO QUICK-GRID')
    && !result.stdout.includes('Servidor de Telemetria rodando'), `${label}: server:start was not executed`);
}

async function main() {
  let refusedDb;
  try {
    const blueprint = fs.readFileSync('render.yaml', 'utf8').replace(/\r\n/g, '\n');
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const serverSource = fs.readFileSync('server/src/server.js', 'utf8');
    const migrationSource = fs.readFileSync('server/src/db/migrator.js', 'utf8');
    // Contract tests are intentionally scoped to this project's simple Blueprint,
    // not a general YAML parser or a substitute for provider-side validation.
    const [service, database] = blueprint.split(/^databases:\s*$/m);
    check(Boolean(database), 'Blueprint contains services and databases');
    check(/^services:\n  - type: web\n    name: quick-grid-telemetry-api\n    runtime: node\n    plan: free$/m.test(service), 'web service explicitly uses free');
    check(/^- name: quick-grid-telemetry-db\n    plan: free\n    databaseName: quick_grid_telemetry\n    user: quick_grid\s*$/.test(database.trimStart()), 'PostgreSQL explicitly uses free with expected identity');
    const plans = [...blueprint.matchAll(/^\s*plan:\s*(\S+)$/gm)];
    check(plans.length === 2 && plans.every(match => match[1] === 'free'), 'exactly two plan fields exist and neither can select a paid plan');
    check(!/^\s*(preDeployCommand|disk|diskSizeGB|scaling|numInstances|readReplicas|highAvailability|previewPlan|previews|connectionPool|ipAllowList|maintenanceMode):/m.test(blueprint), 'no paid pre-deploy, disks, scaling, replicas or other paid-only requirements');
    check(/^    buildCommand: npm ci$/m.test(service) && /^    healthCheckPath: \/ready$/m.test(service), 'build and readiness preserved');
    check(/^      - key: DATABASE_URL\n        fromDatabase:\n          name: quick-grid-telemetry-db\n          property: connectionString$/m.test(service), 'database URL remains a resource reference, not a credential literal');
    check(/^      - key: INGEST_TOKEN_SECRET\n        generateValue: true$/m.test(service), 'ingest secret remains generated');
    check(/^      - key: CORS_ALLOWED_ORIGINS\n        sync: false$/m.test(service), 'CORS remains manually configured with no invented domain');
    const command = service.match(/^    startCommand: (.+)$/m)?.[1];
    check(command === 'npm run migrate && npm run server:start', 'startup is migration success AND THEN server start');
    check(manifest.scripts.migrate === 'node server/src/db/migrator.js'
      && manifest.scripts['server:start'] === 'node server/src/server.js', 'both npm scripts resolve to existing entrypoints');
    check(/if \(!config\.isProduction\) await runMigrations\(\);/.test(serverSource), 'production server does not run migrations a second time');
    check(/schema_migrations/.test(migrationSource) && /pg_advisory_lock/.test(migrationSource)
      && /query\('BEGIN'\)/.test(migrationSource) && /query\('COMMIT'\)/.test(migrationSource)
      && /query\('ROLLBACK'\)/.test(migrationSource) && /process\.exit\(1\)/.test(migrationSource), 'existing migration history, lock, transaction and fatal exit preserved');

    checkMigrationFailure(await runStartup(command, ''), 'missing production DATABASE_URL');

    let connections = 0;
    refusedDb = net.createServer(socket => { connections++; socket.destroy(); });
    await new Promise(resolve => refusedDb.listen(0, '127.0.0.1', resolve));
    const localUrl = new URL('postgresql://127.0.0.1');
    localUrl.port = String(refusedDb.address().port);
    localUrl.username = 'local_test'; localUrl.password = 'test_only'; localUrl.pathname = '/not_a_database';
    const disconnected = await runStartup(command, localUrl.toString());
    checkMigrationFailure(disconnected, 'controlled database connection failure');
    check(connections > 0, 'real pg driver attempted only the local refusing TCP endpoint (not PostgreSQL success)');
  } catch (err) {
    if (!failed) failed++;
    // Do not print subprocess output: environment values must stay private.
    console.error('FAIL:', err.code || err.message);
  } finally {
    if (refusedDb) await new Promise(resolve => refusedDb.close(resolve));
    console.log(`${passed} PASSOU | ${failed} FALHOU`);
    process.exitCode = failed ? 1 : 0;
  }
}

await main();
