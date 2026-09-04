// Fail-fast reproducible local gate. Never inherit production DB or credentials into tests.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outputDirectory = path.join(root, 'artifacts', 'ml22');
fs.mkdirSync(outputDirectory, { recursive: true });
function sourceSnapshot() {
  const files = [];
  const walk = relative => {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, item.name);
      if (item.isDirectory()) walk(name);
      else if (item.isFile()) files.push(name);
    }
  };
  for (const directory of ['src', 'server', 'scripts']) walk(directory);
  for (const file of ['package.json', 'package-lock.json', 'index.html', 'render.yaml', 'vercel.json']) {
    if (fs.existsSync(path.join(root, file))) files.push(file);
  }
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  return { sha256: hash.digest('hex'), files: files.length, scope: 'src, server, scripts and listed build/deploy manifests; not docs/assets/dataset' };
}
function redact(output) {
  return output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_SIGNED_CREDENTIAL]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[MASKED_SESSION_ID]');
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const commands = [
  'npm run test:ml', 'npm run test:api', 'node scripts/test_telemetry_uploader.js',
  'node scripts/test_uploader_integration.js', 'node scripts/test_backend_concurrency.js',
  'npm run test:ml22', 'npm run test:ml22:completion', 'npm run test:render-free',
  'npm run test:db-tls', 'npm run build'
];
if (manifest.scripts.lint) commands.push('npm run lint');
const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root });
const report = {
  startedAt: new Date().toISOString(), node: process.version, gitHead: git.status === 0 ? git.stdout.trim() : null,
  snapshot: sourceSnapshot(), scope: 'LOCAL ONLY; HTTP with memory DB, Node storage fallback. No cloud/human/browser E2E.',
  lint: manifest.scripts.lint ? 'CONFIGURED' : 'NOT_CONFIGURED', suites: []
};
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', INGEST_TOKEN_SECRET: randomBytes(32).toString('hex') };
const started = performance.now();
for (const [index, command] of commands.entries()) {
  const begin = performance.now();
  const commandEnv = command === 'npm run build' ? { ...env, NODE_ENV: 'production' } : env;
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { cwd: root, env: commandEnv, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
    : spawnSync('/bin/sh', ['-c', command], { cwd: root, env: commandEnv, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const output = redact(`${result.stdout || ''}\n${result.stderr || ''}`);
  const counts = [...output.matchAll(/(\d+)\s+PASSOU\s*\|\s*(\d+)\s+FALHOU/gi)].at(-1);
  const isTest = command !== 'npm run build' && command !== 'npm run lint';
  const passed = counts ? Number(counts[1]) : null;
  const failed = counts ? Number(counts[2]) : null;
  const ok = result.status === 0 && (!isTest || (counts && failed === 0));
  const logFile = `suite-${index + 1}.log`;
  fs.writeFileSync(path.join(outputDirectory, logFile), output);
  const suite = { command, passed, failed, durationSeconds: Number(((performance.now() - begin) / 1000).toFixed(3)),
    exitCode: result.status, errorCode: result.error?.code || null, ok: Boolean(ok), logFile };
  report.suites.push(suite);
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${command} | ${passed ?? '-'} passed, ${failed ?? '-'} failed | ${suite.durationSeconds}s`);
  if (!ok) { console.error(output.slice(-4000)); break; }
}
report.durationSeconds = Number(((performance.now() - started) / 1000).toFixed(3));
report.sourceUnchanged = sourceSnapshot().sha256 === report.snapshot.sha256;
report.passed = report.suites.reduce((sum, item) => sum + (item.passed || 0), 0);
report.failed = report.suites.reduce((sum, item) => sum + (item.failed || 0), 0);
report.total = report.passed + report.failed;
report.build = report.suites.find(item => item.command === 'npm run build')?.ok ? 'PASS' : 'NOT_PASSED';
report.result = report.suites.length === commands.length && report.suites.every(item => item.ok) && report.sourceUnchanged ? 'PASS_LOCAL_GATE' : 'FAIL_STOP';
fs.writeFileSync(path.join(outputDirectory, 'regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.result}: ${report.total} total, ${report.passed} passed, ${report.failed} failed; build ${report.build}; ${report.durationSeconds}s`);
process.exitCode = report.result === 'PASS_LOCAL_GATE' ? 0 : 1;
