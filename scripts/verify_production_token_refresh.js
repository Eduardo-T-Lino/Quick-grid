import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const DEFAULT_FRONTEND = 'https://quick-grid-nu.vercel.app';
const DEFAULT_BACKEND = 'https://quick-grid-telemetry-api.onrender.com';
const INVALID_AUTHORIZATION = 'Bearer ml22-intentional-invalid-ingest-token';
const REQUIRED_GLOBALS = [
  'startMLTelemetry',
  'stopMLTelemetry',
  'enableOnlineMLTelemetry',
  'disableOnlineMLTelemetry',
  'getOnlineMLTelemetryStats'
];

function parseArgs(argv) {
  const options = {
    frontendUrl: DEFAULT_FRONTEND,
    backendUrl: DEFAULT_BACKEND,
    outputPath: path.join(ROOT, 'artifacts', 'ml22_token_refresh_verification.json'),
    headless: true,
    timeoutMs: 90000
  };
  for (const arg of argv) {
    if (arg === '--headed') options.headless = false;
    else if (arg.startsWith('--frontend=')) options.frontendUrl = arg.slice('--frontend='.length).replace(/\/$/, '');
    else if (arg.startsWith('--backend=')) options.backendUrl = arg.slice('--backend='.length).replace(/\/$/, '');
    else if (arg.startsWith('--output=')) options.outputPath = path.resolve(arg.slice('--output='.length));
    else if (arg.startsWith('--timeout=')) options.timeoutMs = Number(arg.slice('--timeout='.length));
    else if (arg === '--help') {
      console.log('Usage: npm run verify:ml22:refresh -- [--headed] [--frontend=URL] [--backend=URL] [--output=PATH]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('timeout must be positive');
  options.telemetryUrl = `${options.backendUrl}/api/v1/telemetry`;
  options.batchUrl = `${options.telemetryUrl}/batches`;
  return options;
}

function seededRandomInit(seed) {
  let state = seed >>> 0;
  Math.random = () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function timestamp() {
  return new Date().toISOString();
}

function bodyHash(body) {
  return createHash('sha256').update(body || '').digest('hex');
}

function batchIdentity(request) {
  if (request.method() !== 'POST') return null;
  let payload;
  try { payload = JSON.parse(request.postData() || ''); } catch { return null; }
  if (typeof payload?.sessionId !== 'string' || !Number.isSafeInteger(payload?.batchSequence)
      || !Array.isArray(payload?.samples)) return null;
  return {
    sessionId: payload.sessionId,
    batchSequence: payload.batchSequence,
    sampleCount: payload.samples.length,
    bodySha256: bodyHash(request.postData())
  };
}

function publicStats(stats) {
  return Object.fromEntries([
    'consentEnabled', 'sessionStatus', 'serverSessionId', 'activeBufferSamples', 'pendingBatches',
    'persistedBatches', 'persistedBatchesIsEstimate', 'inFlightRequests', 'sentBatches',
    'acknowledgedBatches', 'retryCount', 'droppedBatches', 'droppedSamples', 'uploadedSamples',
    'idempotentDuplicates', 'lastError', 'averageUploadLatencyMs'
  ].map(key => [key, stats?.[key] ?? null]));
}

async function waitUntil(page, predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForStats(page, predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let stats = null;
  while (Date.now() < deadline) {
    stats = await page.evaluate(() => window.getOnlineMLTelemetryStats());
    if (predicate(stats)) return stats;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label}; public status=${stats?.sessionStatus || 'unknown'}`);
}

async function setControlValue(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

function sequenceContinuity(acknowledged) {
  const sequences = [...acknowledged.keys()].sort((a, b) => a - b);
  const gaps = sequences.slice(1).flatMap((value, index) => value === sequences[index] + 1
    ? [] : [{ after: sequences[index], before: value }]);
  return {
    sequences,
    gaps,
    duplicates: sequences.length - new Set(sequences).size,
    uniqueBatches: sequences.length,
    samples: [...acknowledged.values()].reduce((sum, item) => sum + item.sampleCount, 0)
  };
}

function acceptanceCheck(id, condition, evidence) {
  return { id, status: condition ? 'PASS' : 'FAIL', evidence };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = timestamp();
  const events = [];
  const observedRequests = [];
  const acknowledged = new Map();
  const observerErrors = [];
  const record = (type, detail = {}) => {
    const event = { order: events.length + 1, timestamp: timestamp(), type, ...detail };
    events.push(event);
    console.log(`[proof] ${type}${detail.batchSequence == null ? '' : ` batch=${detail.batchSequence}`}${detail.httpStatus == null ? '' : ` HTTP=${detail.httpStatus}`}`);
    return event;
  };

  let browser;
  let context;
  let page;
  let targetSessionId = null;
  let targetBatch = null;
  let injectionArmed = false;
  let injectionCount = 0;
  let targetAttempts = 0;
  let refreshRequests = 0;
  let refreshStatus = null;
  let backend401 = false;
  let targetRetry = null;
  let targetAck = null;
  let subsequentAck = null;
  let statsBefore = null;
  let statsAfterRecovery = null;
  let completedStats = null;
  let smoke = null;
  let apiSession = null;
  let result;

  try {
    const health = await fetch(`${options.backendUrl}/health`, { signal: AbortSignal.timeout(120000) });
    if (!health.ok) throw new Error(`Render health returned HTTP ${health.status}`);
    console.log(`[preflight] Render health HTTP ${health.status}`);

    browser = await chromium.launch({ headless: options.headless });
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
      locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await context.addInitScript(seededRandomInit, 2203);

    await context.route('**/api/v1/telemetry/batches', async route => {
      const request = route.request();
      const identity = batchIdentity(request);
      if (!identity || identity.sessionId !== targetSessionId || !injectionArmed) {
        await route.continue();
        return;
      }

      observedRequests.push({ timestamp: timestamp(), ...identity });
      if (injectionCount === 0) {
        injectionCount++;
        targetAttempts++;
        targetBatch = identity;
        record('TARGET_BATCH_REQUEST', identity);
        const originalHeaders = request.headers();
        const preservedHeaderNames = Object.keys(originalHeaders).filter(name => name.toLowerCase() !== 'authorization').sort();
        record('AUTH_HEADER_INTENTIONALLY_REPLACED', {
          replacement: INVALID_AUTHORIZATION,
          requestContinuedToRealNetwork: true,
          url: request.url(),
          method: request.method(),
          bodySha256: identity.bodySha256,
          preservedHeaderNames
        });
        await route.continue({ headers: { ...originalHeaders, authorization: INVALID_AUTHORIZATION } });
        return;
      }

      if (targetBatch && identity.batchSequence === targetBatch.batchSequence) {
        targetAttempts++;
        if (!targetRetry) {
          targetRetry = identity;
          record('TARGET_BATCH_RETRY', identity);
        }
      }
      await route.continue();
    });

    page = await context.newPage();
    page.on('pageerror', error => observerErrors.push(`pageerror:${error.name}`));
    page.on('request', request => {
      if (!targetSessionId || request.method() !== 'POST') return;
      const expectedRefreshUrl = `${options.telemetryUrl}/sessions/${targetSessionId}/refresh-token`;
      if (request.url() === expectedRefreshUrl) {
        refreshRequests++;
        record('REFRESH_REQUEST', { sessionId: targetSessionId, method: 'POST', url: expectedRefreshUrl,
          credentialHeaderForwardedUnmodified: true });
      }
    });
    page.on('response', response => {
      void (async () => {
        const request = response.request();
        const identity = request.url() === options.batchUrl ? batchIdentity(request) : null;
        if (identity && targetBatch && identity.sessionId === targetSessionId) {
          if (identity.batchSequence === targetBatch.batchSequence && response.status() === 401 && !backend401) {
            backend401 = true;
            record('BACKEND_RESPONSE_401', { sessionId: identity.sessionId, batchSequence: identity.batchSequence,
              sampleCount: identity.sampleCount, httpStatus: 401, url: response.url(), origin: new URL(response.url()).origin,
              requestWasContinuedToNetwork: true });
          } else if (identity.batchSequence === targetBatch.batchSequence && response.status() === 200 && !targetAck) {
            let ackStatus = null;
            try {
              const body = await response.json();
              if (['PROCESSED', 'ALREADY_PROCESSED'].includes(body?.status)) ackStatus = body.status;
            } catch { /* Acceptance below rejects a missing sanitized ACK status. */ }
            targetAck = { ...identity, httpStatus: 200, status: ackStatus };
            acknowledged.set(identity.batchSequence, { sampleCount: identity.sampleCount, status: ackStatus });
            record('TARGET_BATCH_ACK', targetAck);
          } else if (identity.batchSequence > targetBatch.batchSequence && response.status() === 200) {
            let ackStatus = null;
            try {
              const body = await response.json();
              if (['PROCESSED', 'ALREADY_PROCESSED'].includes(body?.status)) ackStatus = body.status;
            } catch { /* Retained as null and rejected from continuity below. */ }
            acknowledged.set(identity.batchSequence, { sampleCount: identity.sampleCount, status: ackStatus });
            if (!subsequentAck) {
              subsequentAck = { ...identity, httpStatus: 200, status: ackStatus };
              record('SUBSEQUENT_BATCH_ACK', subsequentAck);
            }
          }
        }

        const expectedRefreshUrl = targetSessionId
          ? `${options.telemetryUrl}/sessions/${targetSessionId}/refresh-token` : null;
        if (expectedRefreshUrl && request.url() === expectedRefreshUrl && request.method() === 'POST') {
          refreshStatus = response.status();
          record('REFRESH_RESPONSE', { sessionId: targetSessionId, httpStatus: refreshStatus, url: response.url(),
            responseBodyNotReadByHarness: true });
        }
      })().catch(error => observerErrors.push(`response-observer:${error.name}`));
    });

    await page.goto(options.frontendUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(globals => globals.every(name => typeof window[name] === 'function'), REQUIRED_GLOBALS);
    smoke = await page.evaluate(globals => ({
      title: document.title,
      finalUrl: location.href,
      globalsMissing: globals.filter(name => typeof window[name] !== 'function'),
      assets: performance.getEntriesByType('resource').map(entry => entry.name)
        .filter(name => /\/assets\//.test(name)).sort(),
      userAgent: navigator.userAgent,
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
      apiUrl: window.getOnlineMLTelemetryStats().apiUrl
    }), REQUIRED_GLOBALS);
    if (smoke.apiUrl !== options.telemetryUrl) throw new Error('Vercel bundle points to an unexpected telemetry API');

    await page.evaluate(async () => {
      await window.disableOnlineMLTelemetry();
      window.stopMLTelemetry();
      await window.enableOnlineMLTelemetry();
    });
    await setControlValue(page, 'trackSelect', 21);
    await setControlValue(page, 'gameMode', 'race');
    await setControlValue(page, 'lapCount', 40);
    await setControlValue(page, 'trackCondition', 'dry');
    await setControlValue(page, 'transMode', 'auto');
    await setControlValue(page, 'botCount', 1);
    await setControlValue(page, 'botDifficulty', 'pro');

    await page.locator('#start-race').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('menu')).display === 'none');
    await page.locator('#race-start').waitFor({ state: 'visible', timeout: 15000 });
    await page.keyboard.down('w');
    await page.locator('#race-start').waitFor({ state: 'hidden', timeout: 25000 });

    statsBefore = publicStats(await waitForStats(page, stats => stats.sessionStatus === 'ACTIVE'
      && typeof stats.serverSessionId === 'string' && stats.pendingBatches === 0
      && stats.persistedBatches === 0 && stats.inFlightRequests === 0
      && stats.sentBatches === 0 && stats.acknowledgedBatches === 0 && stats.uploadedSamples === 0,
    'ACTIVE session with clean queue', options.timeoutMs));
    targetSessionId = statsBefore.serverSessionId;
    record('SESSION_ACTIVE', { sessionId: targetSessionId, queue: {
      pendingBatches: statsBefore.pendingBatches,
      persistedBatches: statsBefore.persistedBatches,
      inFlightRequests: statsBefore.inFlightRequests
    } });
    injectionArmed = true;

    await waitUntil(page, () => backend401, 'real backend 401', options.timeoutMs);
    await waitUntil(page, () => refreshRequests === 1 && refreshStatus === 200,
      'one real refresh request and HTTP 200', options.timeoutMs);
    await waitUntil(page, () => targetRetry && targetAck, 'same-batch retry ACK', options.timeoutMs);
    await waitUntil(page, () => subsequentAck, 'subsequent normal batch ACK', options.timeoutMs);
    statsAfterRecovery = publicStats(await waitForStats(page, stats => stats.sessionStatus === 'ACTIVE'
      && stats.serverSessionId === targetSessionId && stats.pendingBatches === 0
      && stats.persistedBatches === 0 && stats.inFlightRequests === 0,
    'queue drain while session stays ACTIVE', options.timeoutMs));
    record('QUEUE_DRAINED', { sessionId: targetSessionId, pendingBatches: 0, persistedBatches: 0, inFlightRequests: 0 });
    record('SESSION_CONTINUES_ACTIVE', { sessionId: targetSessionId, subsequentBatchSequence: subsequentAck.batchSequence });

    await page.evaluate(() => window.stopMLTelemetry());
    await page.keyboard.up('w');
    completedStats = publicStats(await waitForStats(page, stats => stats.sessionStatus === 'COMPLETED'
      && stats.pendingBatches === 0 && stats.persistedBatches === 0 && stats.inFlightRequests === 0,
    'normal session completion and final drain', options.timeoutMs));
    await page.waitForTimeout(500);
    record('SESSION_COMPLETED', { sessionId: targetSessionId, status: completedStats.sessionStatus,
      pendingBatches: 0, persistedBatches: 0, inFlightRequests: 0 });

    const sessionResponse = await fetch(`${options.telemetryUrl}/sessions/${targetSessionId}`, {
      signal: AbortSignal.timeout(30000)
    });
    if (!sessionResponse.ok) throw new Error(`Session verification returned HTTP ${sessionResponse.status}`);
    const sessionBody = await sessionResponse.json();
    apiSession = {
      sessionId: sessionBody.id,
      status: sessionBody.status,
      schemaVersion: sessionBody.schema_version,
      scope: sessionBody.scope,
      receivedSamples: sessionBody.received_samples,
      receivedBatches: sessionBody.received_batches,
      finishedAt: sessionBody.finished_at
    };

    const continuity = sequenceContinuity(acknowledged);
    const sameBatch = Boolean(targetBatch && targetRetry
      && targetBatch.sessionId === targetRetry.sessionId
      && targetBatch.batchSequence === targetRetry.batchSequence
      && targetBatch.sampleCount === targetRetry.sampleCount
      && targetBatch.bodySha256 === targetRetry.bodySha256);
    const checks = [
      acceptanceCheck('SINGLE_AUTH_REPLACEMENT', injectionCount === 1, { injectionCount }),
      acceptanceCheck('REAL_RENDER_401', backend401, { httpStatus: backend401 ? 401 : null, endpoint: options.batchUrl }),
      acceptanceCheck('SAME_SESSION_REFRESH', refreshRequests === 1, { refreshRequests, sessionId: targetSessionId }),
      acceptanceCheck('REFRESH_HTTP_200', refreshStatus === 200, { httpStatus: refreshStatus }),
      acceptanceCheck('EXACT_SAME_BATCH_RETRIED', sameBatch, {
        batchSequence: targetBatch?.batchSequence ?? null, sampleCount: targetBatch?.sampleCount ?? null,
        bodySha256Matches: targetBatch?.bodySha256 === targetRetry?.bodySha256
      }),
      acceptanceCheck('TARGET_RETRY_ACK', targetAck?.httpStatus === 200
        && ['PROCESSED', 'ALREADY_PROCESSED'].includes(targetAck?.status), targetAck),
      acceptanceCheck('RETRY_COUNT_INCREMENTED', statsAfterRecovery.retryCount >= 1,
        { retryCount: statsAfterRecovery.retryCount }),
      acceptanceCheck('NO_DROPS', completedStats.droppedBatches === 0 && completedStats.droppedSamples === 0,
        { droppedBatches: completedStats.droppedBatches, droppedSamples: completedStats.droppedSamples }),
      acceptanceCheck('QUEUE_DRAINED_ACTIVE', statsAfterRecovery.pendingBatches === 0
        && statsAfterRecovery.persistedBatches === 0 && statsAfterRecovery.inFlightRequests === 0,
      { pendingBatches: statsAfterRecovery.pendingBatches, persistedBatches: statsAfterRecovery.persistedBatches,
        inFlightRequests: statsAfterRecovery.inFlightRequests }),
      acceptanceCheck('SESSION_CONTINUED_ACTIVE', statsAfterRecovery.sessionStatus === 'ACTIVE'
        && statsAfterRecovery.serverSessionId === targetSessionId, { status: statsAfterRecovery.sessionStatus }),
      acceptanceCheck('SUBSEQUENT_BATCH_ACK', subsequentAck?.httpStatus === 200
        && ['PROCESSED', 'ALREADY_PROCESSED'].includes(subsequentAck?.status), subsequentAck),
      acceptanceCheck('NORMAL_COMPLETION', completedStats.sessionStatus === 'COMPLETED',
        { status: completedStats.sessionStatus }),
      acceptanceCheck('OBSERVED_SEQUENCE_CONTINUITY', continuity.gaps.length === 0 && continuity.duplicates === 0,
        continuity),
      acceptanceCheck('API_COUNTER_CONTINUITY', apiSession.status === 'COMPLETED'
        && apiSession.receivedBatches === continuity.uniqueBatches
        && apiSession.receivedSamples === continuity.samples,
      { status: apiSession.status, receivedBatches: apiSession.receivedBatches,
        receivedSamples: apiSession.receivedSamples, observedBatches: continuity.uniqueBatches,
        observedSamples: continuity.samples })
    ];
    const status = checks.every(check => check.status === 'PASS') && observerErrors.length === 0 ? 'PASS' : 'FAIL';
    result = {
      schemaVersion: 1,
      proof: 'ML2.2-I production token refresh recovery',
      status,
      startedAt,
      finishedAt: timestamp(),
      environment: {
        frontendRequestedUrl: options.frontendUrl,
        frontendFinalUrl: smoke.finalUrl,
        backendUrl: options.backendUrl,
        browser: `Chromium ${browser.version()}`,
        userAgent: smoke.userAgent,
        os: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        viewport: '1920x1080 DPR 1',
        headless: options.headless,
        frontendAssets: smoke.assets,
        globalsMissing: smoke.globalsMissing,
        pageVisibility: { visibilityState: smoke.visibilityState, hidden: smoke.hidden, hasFocus: smoke.hasFocus }
      },
      controlledScenario: {
        track: 'Interlagos', trackId: 21, condition: 'dry', bots: 1, laps: 40,
        transmission: 'auto', difficulty: 'pro', seed: 2203, driving: 'continuous KeyW throttle'
      },
      sessionId: targetSessionId,
      targetBatch,
      statsBefore,
      statsAfterRecovery,
      completedStats,
      apiSession,
      observedRequests,
      observedAcknowledgements: [...acknowledged.entries()].map(([batchSequence, ack]) => ({ batchSequence, ...ack })),
      events,
      checks,
      directDatabaseVerification: {
        status: process.env.DATABASE_URL ? 'AVAILABLE_NOT_RUN_BY_BROWSER_HARNESS' : 'NOT_RUN_NO_DATABASE_URL',
        tool: 'scripts/verify_cloud_telemetry.js',
        note: 'The browser proof uses only production HTTP. Direct DB verification is a separate read-only step.'
      },
      observerErrors
    };
  } catch (error) {
    const message = String(error?.message || error?.name || 'unknown failure')
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]');
    result = {
      schemaVersion: 1,
      proof: 'ML2.2-I production token refresh recovery',
      status: 'FAIL',
      startedAt,
      finishedAt: timestamp(),
      failure: message,
      sessionId: targetSessionId,
      targetBatch,
      statsBefore,
      statsAfterRecovery,
      completedStats,
      events,
      observerErrors
    };
  } finally {
    if (page) await page.keyboard.up('w').catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (/"(?:ingestToken|refreshCredential|authorization|databaseUrl)"\s*:/i.test(serialized)
      || /postgres(?:ql)?:\/\//i.test(serialized)) {
    throw new Error('Sanitization guard rejected the artifact');
  }
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, serialized, 'utf8');
  console.log(`[result] ${result.status}`);
  console.log(`[result] ${path.relative(ROOT, options.outputPath)}`);
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}

run().catch(error => {
  console.error(`[fatal] ${error.message}`);
  process.exitCode = 1;
});
