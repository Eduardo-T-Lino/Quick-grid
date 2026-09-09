import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import {
  SIMULATION_FINGERPRINT_SHA256, TELEMETRY_LINEAGE_VERSIONS
} from '../src/ml/lineage/baselineManifest.js';

const ROOT = process.cwd();
const DEFAULT_FRONTEND = 'https://quick-grid-nu.vercel.app';
const DEFAULT_BACKEND = 'https://quick-grid-telemetry-api.onrender.com';
const PREVIOUS_PRODUCTION_JS_ASSET = 'index-BdIxIu9p.js';
const REQUIRED_GLOBALS = [
  'startMLTelemetry', 'stopMLTelemetry', 'enableOnlineMLTelemetry',
  'disableOnlineMLTelemetry', 'getOnlineMLTelemetryStats'
];

function optionsFrom(argv) {
  const options = {
    frontendUrl: DEFAULT_FRONTEND,
    backendUrl: DEFAULT_BACKEND,
    outputPath: path.join(ROOT, 'artifacts', 'ml22_lineage_smoke.json'),
    headless: true,
    timeoutMs: 90000
  };
  for (const arg of argv) {
    if (arg === '--headed') options.headless = false;
    else if (arg.startsWith('--frontend=')) options.frontendUrl = arg.slice(11).replace(/\/$/, '');
    else if (arg.startsWith('--backend=')) options.backendUrl = arg.slice(10).replace(/\/$/, '');
    else if (arg.startsWith('--output=')) options.outputPath = path.resolve(arg.slice(9));
    else if (arg.startsWith('--timeout=')) options.timeoutMs = Number(arg.slice(10));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.telemetryUrl = `${options.backendUrl}/api/v1/telemetry`;
  return options;
}

function expectedClient() {
  return {
    gameBuildVersion: TELEMETRY_LINEAGE_VERSIONS.GAME_BUILD_VERSION,
    trackGeometryVersion: TELEMETRY_LINEAGE_VERSIONS.TRACK_GEOMETRY_VERSION,
    physicsVersion: TELEMETRY_LINEAGE_VERSIONS.PHYSICS_VERSION,
    featureManifestVersion: TELEMETRY_LINEAGE_VERSIONS.FEATURE_MANIFEST_VERSION
  };
}

function publicStats(stats) {
  return Object.fromEntries([
    'consentEnabled', 'sessionStatus', 'serverSessionId', 'activeBufferSamples',
    'pendingBatches', 'persistedBatches', 'inFlightRequests', 'sentBatches',
    'acknowledgedBatches', 'retryCount', 'droppedBatches', 'droppedSamples',
    'uploadedSamples', 'idempotentDuplicates', 'lastError'
  ].map(key => [key, stats?.[key] ?? null]));
}

async function waitForStats(page, predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let stats;
  while (Date.now() < deadline) {
    stats = await page.evaluate(() => window.getOnlineMLTelemetryStats());
    if (predicate(stats)) return publicStats(stats);
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label}; status=${stats?.sessionStatus || 'unknown'}`);
}

async function setControl(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

function sanitizeFailure(error) {
  return String(error?.message || error?.name || 'unknown failure')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]');
}

async function run() {
  const options = optionsFrom(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  let browser;
  let context;
  let page;
  let sessionId = null;
  let advertised = null;
  let result;
  const consoleErrors = [];

  try {
    const [health, ready] = await Promise.all([
      fetch(`${options.backendUrl}/health`, { signal: AbortSignal.timeout(120000) }),
      fetch(`${options.backendUrl}/ready`, { signal: AbortSignal.timeout(120000) })
    ]);
    if (!health.ok || !ready.ok) throw new Error(`Render preflight failed: health=${health.status}, ready=${ready.status}`);

    browser = await chromium.launch({ headless: options.headless });
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
      locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block'
    });
    page = await context.newPage();
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500));
    });
    page.on('request', request => {
      if (request.method() !== 'POST' || request.url() !== `${options.telemetryUrl}/sessions` || advertised) return;
      try {
        const body = JSON.parse(request.postData() || '{}');
        advertised = {
          schemaVersion: body.schemaVersion,
          sampleRateHz: body.sampleRateHz,
          scope: body.scope,
          client: body.client,
          simulationFingerprintSha256: body.clientInfo?.simulationFingerprintSha256,
          consentVersion: body.consentVersion
        };
      } catch { /* The acceptance checks report a missing advertised payload. */ }
    });

    await page.goto(`${options.frontendUrl}/?ml22-lineage=${Date.now()}`, {
      waitUntil: 'domcontentloaded', timeout: options.timeoutMs
    });
    await page.waitForFunction(globals => globals.every(name => typeof window[name] === 'function'),
      REQUIRED_GLOBALS, { timeout: options.timeoutMs });
    const environment = await page.evaluate(globals => ({
      finalUrl: location.href,
      title: document.title,
      globalsMissing: globals.filter(name => typeof window[name] !== 'function'),
      assets: performance.getEntriesByType('resource').map(entry => entry.name)
        .filter(name => /\/assets\//.test(name)).sort(),
      apiUrl: window.getOnlineMLTelemetryStats().apiUrl,
      userAgent: navigator.userAgent
    }), REQUIRED_GLOBALS);
    if (environment.apiUrl !== options.telemetryUrl) throw new Error('Frontend points to an unexpected telemetry API');

    await page.evaluate(async () => {
      await window.disableOnlineMLTelemetry();
      window.stopMLTelemetry();
      await window.enableOnlineMLTelemetry();
    });
    await setControl(page, 'trackSelect', 21);
    await setControl(page, 'gameMode', 'race');
    await setControl(page, 'lapCount', 40);
    await setControl(page, 'trackCondition', 'dry');
    await setControl(page, 'transMode', 'auto');
    await setControl(page, 'botCount', 1);
    await setControl(page, 'botDifficulty', 'pro');

    await page.locator('#start-race').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('menu')).display === 'none');
    await page.locator('#race-start').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('#race-start').waitFor({ state: 'hidden', timeout: 25000 });
    await page.keyboard.down('w');
    const active = await waitForStats(page, stats => stats.sessionStatus === 'ACTIVE'
      && typeof stats.serverSessionId === 'string', 'ACTIVE production session', options.timeoutMs);
    sessionId = active.serverSessionId;
    const delivered = await waitForStats(page, stats => stats.sessionStatus === 'ACTIVE'
      && stats.acknowledgedBatches >= 1 && stats.uploadedSamples >= 1,
    'at least one acknowledged production batch', options.timeoutMs);

    await page.evaluate(() => window.stopMLTelemetry());
    await page.keyboard.up('w');
    const completed = await waitForStats(page, stats => stats.sessionStatus === 'COMPLETED'
      && stats.pendingBatches === 0 && stats.persistedBatches === 0 && stats.inFlightRequests === 0,
    'COMPLETED production session with drained queues', options.timeoutMs);

    const response = await fetch(`${options.telemetryUrl}/sessions/${sessionId}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Session verification returned HTTP ${response.status}`);
    const body = await response.json();
    const apiSession = {
      sessionId: body.id,
      status: body.status,
      schemaVersion: body.schema_version,
      gameBuildVersion: body.game_build_version,
      trackGeometryVersion: body.track_geometry_version,
      physicsVersion: body.physics_version,
      featureManifestVersion: body.feature_manifest_version,
      sampleRateHz: Number(body.sample_rate_hz),
      receivedSamples: body.received_samples,
      receivedBatches: body.received_batches,
      simulationFingerprintSha256: body.client_info?.simulationFingerprintSha256
    };
    const expected = expectedClient();
    const jsAssets = environment.assets.filter(asset => /\/index-[^/]+\.js(?:\?|$)/.test(asset));
    const checks = {
      health200: health.status === 200,
      ready200: ready.status === 200,
      frontendGlobals: environment.globalsMissing.length === 0,
      newProductionAsset: jsAssets.length === 1 && !jsAssets[0].includes(PREVIOUS_PRODUCTION_JS_ASSET),
      advertisedLineage: advertised?.schemaVersion === TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION
        && advertised?.sampleRateHz === 10 && JSON.stringify(advertised?.client) === JSON.stringify(expected)
        && advertised?.simulationFingerprintSha256 === SIMULATION_FINGERPRINT_SHA256,
      batchDelivered: delivered.acknowledgedBatches >= 1 && delivered.uploadedSamples >= 1,
      noDrops: completed.droppedBatches === 0 && completed.droppedSamples === 0,
      queuesDrained: completed.pendingBatches === 0 && completed.persistedBatches === 0 && completed.inFlightRequests === 0,
      apiCompleted: apiSession.status === 'COMPLETED' && apiSession.receivedBatches >= 1 && apiSession.receivedSamples >= 1,
      apiLineage: apiSession.schemaVersion === TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION
        && apiSession.gameBuildVersion === expected.gameBuildVersion
        && apiSession.trackGeometryVersion === expected.trackGeometryVersion
        && apiSession.physicsVersion === expected.physicsVersion
        && apiSession.featureManifestVersion === expected.featureManifestVersion
        && apiSession.sampleRateHz === 10
        && apiSession.simulationFingerprintSha256 === SIMULATION_FINGERPRINT_SHA256
    };
    result = {
      proof: 'ML2.2-J production lineage smoke',
      status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      environment: {
        frontendUrl: options.frontendUrl, backendUrl: options.backendUrl,
        browser: `Chromium ${browser.version()}`, userAgent: environment.userAgent,
        os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version,
        headless: options.headless, assets: environment.assets,
        healthStatus: health.status, readyStatus: ready.status, consoleErrors
      },
      advertised,
      active,
      delivered,
      completed,
      apiSession,
      checks
    };
  } catch (error) {
    result = {
      proof: 'ML2.2-J production lineage smoke', status: 'FAIL', startedAt,
      finishedAt: new Date().toISOString(), sessionId, failure: sanitizeFailure(error), consoleErrors
    };
  } finally {
    if (page) await page.keyboard.up('w').catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (/"(?:ingestToken|refreshCredential|authorization|databaseUrl)"\s*:/i.test(serialized)
      || /postgres(?:ql)?:\/\//i.test(serialized)) throw new Error('Sanitization guard rejected the artifact');
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, serialized, 'utf8');
  console.log(`ML2.2-J lineage smoke: ${result.status}`);
  if (result.apiSession) console.log(`session=${result.apiSession.sessionId} batches=${result.apiSession.receivedBatches} samples=${result.apiSession.receivedSamples}`);
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}

run().catch(error => {
  console.error(`[fatal] ${sanitizeFailure(error)}`);
  process.exitCode = 1;
});
