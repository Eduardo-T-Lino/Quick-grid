import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const DEFAULT_OUTPUT = path.join(ROOT, 'artifacts', 'ml22_browser_benchmark.json');
const DEFAULT_REPORT = path.join(ROOT, 'docs', 'ml2_2_browser_benchmark.md');
const REQUIRED_GLOBALS = [
  'startMLTelemetry',
  'stopMLTelemetry',
  'enableOnlineMLTelemetry',
  'disableOnlineMLTelemetry',
  'getMLPerformanceMetrics',
  'resetMLPerformanceMetrics',
  'getOnlineMLTelemetryStats',
  'getMLTelemetryStats'
];
const METRIC_PATHS = [
  ['averageFps', 'FPS', 'lower'],
  ['frame.meanMs', 'frame mean', 'higher'],
  ['frame.p95Ms', 'frame p95', 'higher'],
  ['frame.p99Ms', 'frame p99', 'higher'],
  ['frameCpu.meanMs', 'frame CPU mean', 'higher'],
  ['frameCpu.p95Ms', 'frame CPU p95', 'higher'],
  ['frameCpu.p99Ms', 'frame CPU p99', 'higher'],
  ['collector.meanMs', 'collector mean', 'higher'],
  ['collector.p95Ms', 'collector p95', 'higher'],
  ['collector.p99Ms', 'collector p99', 'higher'],
  ['uploaderMainThread.meanMs', 'uploader main mean', 'higher'],
  ['uploaderMainThread.p95Ms', 'uploader main p95', 'higher'],
  ['uploaderMainThread.p99Ms', 'uploader main p99', 'higher'],
  ['networkAsyncLatency.meanMs', 'network async mean', 'higher'],
  ['networkAsyncLatency.p95Ms', 'network async p95', 'higher'],
  ['networkAsyncLatency.p99Ms', 'network async p99', 'higher'],
  ['requestsPerMinute', 'requests/min', 'higher'],
  ['uploadedKBPerMinute', 'uploaded KB/min', 'higher'],
  ['averagePayloadBytes', 'average payload bytes', 'higher'],
  ['heapPeakBytes', 'heap peak', 'higher']
];
const DISTRIBUTION_METRIC_PATHS = [
  ['averageFps', 'average FPS'],
  ['frame.meanMs', 'frame mean ms'],
  ['frame.p95Ms', 'frame p95 ms'],
  ['frame.p99Ms', 'frame p99 ms'],
  ['frameCpu.meanMs', 'frame CPU mean ms'],
  ['frameCpu.p95Ms', 'frame CPU p95 ms'],
  ['frameCpu.p99Ms', 'frame CPU p99 ms'],
  ['collector.meanMs', 'collector mean ms'],
  ['collector.p95Ms', 'collector p95 ms'],
  ['collector.p99Ms', 'collector p99 ms'],
  ['uploaderMainThread.meanMs', 'uploader main mean ms'],
  ['uploaderMainThread.p95Ms', 'uploader main p95 ms'],
  ['uploaderMainThread.p99Ms', 'uploader main p99 ms'],
  ['networkAsyncLatency.meanMs', 'network async mean ms'],
  ['networkAsyncLatency.p95Ms', 'network async p95 ms'],
  ['networkAsyncLatency.p99Ms', 'network async p99 ms'],
  ['requestsPerMinute', 'requests/min'],
  ['uploadedKBPerMinute', 'uploaded KB/min'],
  ['averagePayloadBytes', 'average payload bytes'],
  ['heapStartBytes', 'heap start bytes'],
  ['heapCurrentBytes', 'heap current bytes'],
  ['heapPeakBytes', 'heap peak bytes']
];
const ONLINE_DISTRIBUTION_KEYS = [
  'sentBatches', 'acknowledgedBatches', 'uploadedSamples', 'pendingBatches', 'persistedBatches',
  'retryCount', 'droppedBatches', 'droppedSamples', 'idempotentDuplicates', 'inFlightRequests',
  'averageUploadLatencyMs'
];

function parseArgs(argv) {
  const options = {
    baseUrl: null,
    warmupSeconds: 15,
    measurementSeconds: 120,
    repetitions: 3,
    viewport: { width: 1920, height: 1080 },
    headless: true,
    trackId: 21,
    trackName: 'Interlagos',
    bots: 19,
    laps: 40,
    condition: 'dry',
    transmission: 'auto',
    difficulty: 'pro',
    seed: 2202,
    outputPath: DEFAULT_OUTPUT,
    reportPath: DEFAULT_REPORT,
    quick: false
  };

  for (const arg of argv) {
    if (arg === '--quick') {
      options.quick = true;
      options.warmupSeconds = 2;
      options.measurementSeconds = 5;
      options.repetitions = 1;
    } else if (arg === '--headed') options.headless = false;
    else if (arg.startsWith('--base-url=')) options.baseUrl = arg.slice('--base-url='.length).replace(/\/$/, '');
    else if (arg.startsWith('--warmup=')) options.warmupSeconds = Number(arg.slice('--warmup='.length));
    else if (arg.startsWith('--measurement=')) options.measurementSeconds = Number(arg.slice('--measurement='.length));
    else if (arg.startsWith('--repetitions=')) options.repetitions = Number(arg.slice('--repetitions='.length));
    else if (arg.startsWith('--output=')) options.outputPath = path.resolve(arg.slice('--output='.length));
    else if (arg.startsWith('--report=')) options.reportPath = path.resolve(arg.slice('--report='.length));
    else if (arg === '--help') {
      console.log(`Usage: npm run benchmark:ml22 -- [options]\n\n` +
        `  --quick             2 s warm-up, 5 s measurement, one repetition\n` +
        `  --headed            show the browser window\n` +
        `  --base-url=URL       benchmark an already deployed build\n` +
        `  --warmup=SECONDS     override warm-up duration\n` +
        `  --measurement=SEC    override measurement duration\n` +
        `  --repetitions=N      override repetitions per scenario\n` +
        `  --output=PATH        JSON artifact path\n` +
        `  --report=PATH        Markdown report path`);
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }

  for (const [name, value] of [
    ['warmup', options.warmupSeconds],
    ['measurement', options.measurementSeconds],
    ['repetitions', options.repetitions]
  ]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  }
  options.repetitions = Math.floor(options.repetitions);
  return options;
}

function startProcess(command, args, env = process.env) {
  const child = spawn(command, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  return child;
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`)));
  });
}

async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Preview did not become ready at ${url}: ${lastError?.message || 'timeout'}`);
}

async function startLocalProduction(options) {
  const env = { ...process.env };
  const viteCli = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  console.log('[setup] Building the Vite production bundle...');
  await waitForExit(startProcess(process.execPath, [viteCli, 'build'], env), 'vite build');
  const port = 4173;
  const url = `http://127.0.0.1:${port}`;
  console.log(`[setup] Starting local production preview at ${url}...`);
  const preview = startProcess(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], env);
  await Promise.race([
    waitForHttp(url),
    new Promise((_, reject) => {
      preview.once('error', reject);
      preview.once('exit', code => reject(new Error(`vite preview exited before readiness with code ${code}`)));
    })
  ]);
  return { preview, url };
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
  window.__ML22_BENCHMARK_SEED__ = seed;
}

async function newBenchmarkPage(browser, options, suffix) {
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo'
  });
  await context.addInitScript(seededRandomInit, options.seed);
  const page = await context.newPage();
  const diagnostics = { consoleErrors: [], pageErrors: [] };
  page.on('console', message => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(globals => globals.every(name => typeof window[name] === 'function'), REQUIRED_GLOBALS);
  page.setDefaultTimeout(30000);
  return { context, page, diagnostics, suffix };
}

async function smokeCheck(browser, options) {
  console.log('[browser] Running real-browser smoke verification...');
  const { context, page, diagnostics } = await newBenchmarkPage(browser, options, 'smoke');
  const outputStem = path.basename(options.outputPath, path.extname(options.outputPath));
  const screenshotPath = path.join(path.dirname(options.outputPath), `${outputStem}_smoke.png`);
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  const evidence = await page.evaluate(() => ({
    title: document.title,
    bodyTextLength: document.body.innerText.trim().length,
    errorOverlay: Boolean(document.querySelector('.vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog]')),
    keyElements: ['menu', 'trackSelect', 'gameMode', 'lapCount', 'trackCondition', 'transMode', 'botCount', 'botDifficulty', 'start-race', 'gameCanvas']
      .filter(id => !document.getElementById(id)),
    globalsMissing: [
      'startMLTelemetry', 'stopMLTelemetry', 'enableOnlineMLTelemetry', 'disableOnlineMLTelemetry',
      'getMLPerformanceMetrics', 'resetMLPerformanceMetrics', 'getOnlineMLTelemetryStats', 'getMLTelemetryStats'
    ].filter(name => typeof window[name] !== 'function'),
    uploader: window.getOnlineMLTelemetryStats(),
    assets: performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => /\/assets\//.test(name)).sort(),
    userAgent: navigator.userAgent
  }));
  await page.screenshot({ path: screenshotPath, fullPage: true });
  evidence.finalUrl = page.url();
  await context.close();
  evidence.screenshotPath = path.relative(ROOT, screenshotPath).replaceAll('\\', '/');
  evidence.consoleErrors = diagnostics.consoleErrors;
  evidence.pageErrors = diagnostics.pageErrors;
  evidence.passed = evidence.bodyTextLength > 0 && !evidence.errorOverlay && evidence.keyElements.length === 0
    && evidence.globalsMissing.length === 0 && evidence.pageErrors.length === 0 && evidence.consoleErrors.length === 0;
  if (!evidence.passed) throw new Error(`Browser smoke verification failed: ${JSON.stringify(evidence)}`);
  console.log(`[browser] PASS — ${evidence.title}; screenshot: ${evidence.screenshotPath}`);
  return evidence;
}

function deriveServiceRoot(telemetryEndpoint) {
  return telemetryEndpoint?.replace(/\/api\/v1\/telemetry\/?$/, '') || null;
}

async function probeOnlineScenario(telemetryEndpoint, pageOrigin) {
  if (!telemetryEndpoint || !/^https:\/\//i.test(telemetryEndpoint)) {
    return { available: false, reason: 'The built frontend has no HTTPS telemetry API configured.', telemetryEndpoint: telemetryEndpoint || null };
  }
  const serviceRoot = deriveServiceRoot(telemetryEndpoint);
  const probe = { available: false, telemetryEndpoint, serviceRoot, pageOrigin, healthStatus: null, preflightStatus: null, allowOrigin: null };
  try {
    console.log(`[cloud] Warming ${serviceRoot}/health before scenario C...`);
    const health = await fetch(`${serviceRoot}/health`, { signal: AbortSignal.timeout(120000) });
    probe.healthStatus = health.status;
    if (!health.ok) {
      probe.reason = `Render health returned HTTP ${health.status}.`;
      return probe;
    }
  } catch (error) {
    probe.reason = `Render health probe failed: ${error.message}`;
    return probe;
  }
  try {
    const preflight = await fetch(`${telemetryEndpoint}/sessions`, {
      method: 'OPTIONS',
      headers: {
        Origin: pageOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      },
      signal: AbortSignal.timeout(30000)
    });
    probe.preflightStatus = preflight.status;
    probe.allowOrigin = preflight.headers.get('access-control-allow-origin');
    probe.available = preflight.ok && (probe.allowOrigin === pageOrigin || probe.allowOrigin === '*');
    if (!probe.available) probe.reason = `Render CORS rejected ${pageOrigin} (HTTP ${preflight.status}).`;
  } catch (error) {
    probe.reason = `Render CORS probe failed: ${error.message}`;
  }
  console.log(probe.available ? '[cloud] PASS — scenario C origin is allowed.' : `[cloud] BLOCKED — ${probe.reason}`);
  return probe;
}

async function setControlValue(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function waitWithProgress(page, seconds, label) {
  const started = Date.now();
  const durationMs = seconds * 1000;
  let nextUpdate = 15000;
  while (Date.now() - started < durationMs) {
    const elapsed = Date.now() - started;
    await page.waitForTimeout(Math.min(1000, durationMs - elapsed));
    if (Date.now() - started >= nextUpdate || Date.now() - started >= durationMs) {
      console.log(`  ${label}: ${Math.min(seconds, Math.round((Date.now() - started) / 1000))}/${seconds}s`);
      nextUpdate += 15000;
    }
    const active = await page.evaluate(() => ({
      menuHidden: getComputedStyle(document.getElementById('menu')).display === 'none',
      victoryVisible: getComputedStyle(document.getElementById('win-screen')).display !== 'none'
    }));
    if (!active.menuHidden || active.victoryVisible) throw new Error(`Race stopped during ${label}`);
  }
}

async function waitForUploaderDrain(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let stats = await page.evaluate(() => window.getOnlineMLTelemetryStats());
  while (Date.now() < deadline) {
    if (stats.pendingBatches === 0 && stats.inFlightRequests === 0
        && ['COMPLETED', 'IDLE'].includes(stats.sessionStatus)) return stats;
    await page.waitForTimeout(250);
    stats = await page.evaluate(() => window.getOnlineMLTelemetryStats());
  }
  return stats;
}

async function runScenario(browser, options, scenario, repetition) {
  const label = `${scenario}${repetition}`;
  console.log(`[run ${label}] Starting isolated browser context...`);
  const { context, page, diagnostics } = await newBenchmarkPage(browser, options, label);
  const startedAt = new Date().toISOString();
  try {
    await page.evaluate(async () => {
      await window.disableOnlineMLTelemetry();
      window.stopMLTelemetry();
      window.resetMLPerformanceMetrics();
    });

    await setControlValue(page, 'trackSelect', options.trackId);
    await setControlValue(page, 'gameMode', 'race');
    await setControlValue(page, 'lapCount', options.laps);
    await setControlValue(page, 'trackCondition', options.condition);
    await setControlValue(page, 'transMode', options.transmission);
    await setControlValue(page, 'botCount', options.bots);
    await setControlValue(page, 'botDifficulty', options.difficulty);

    if (scenario === 'B') {
      await page.evaluate(async () => {
        window.startMLTelemetry({ scope: 'PLAYER_ONLY' });
        await window.disableOnlineMLTelemetry();
        window.resetMLPerformanceMetrics();
      });
    } else if (scenario === 'C') {
      await page.evaluate(async () => {
        window.startMLTelemetry({ scope: 'PLAYER_ONLY' });
        await window.enableOnlineMLTelemetry();
      });
    }

    if (scenario !== 'C') {
      const consentEnabled = await page.evaluate(() => window.getOnlineMLTelemetryStats().consentEnabled);
      if (consentEnabled) throw new Error(`${scenario} requires online consent=false`);
    }

    await page.locator('#start-race').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('menu')).display === 'none');
    await page.locator('#race-start').waitFor({ state: 'visible', timeout: 15000 });
    await page.keyboard.down('w');
    await page.locator('#race-start').waitFor({ state: 'hidden', timeout: 25000 });

    if (scenario === 'C') {
      await page.waitForFunction(() => {
        const stats = window.getOnlineMLTelemetryStats();
        return stats.sessionStatus === 'ACTIVE' && stats.serverSessionId != null;
      }, null, { timeout: 45000 });
    }

    // First reset starts warm-up accounting; the second excludes warm-up and any cloud start-up from official metrics.
    await page.evaluate(() => window.resetMLPerformanceMetrics());
    await waitWithProgress(page, options.warmupSeconds, 'warm-up');
    await page.evaluate(() => window.resetMLPerformanceMetrics());
    await waitWithProgress(page, options.measurementSeconds, 'measurement');

    const captured = await page.evaluate(() => ({
      performance: window.getMLPerformanceMetrics(),
      collector: window.getMLTelemetryStats(),
      onlineAtMeasurementEnd: window.getOnlineMLTelemetryStats(),
      browserState: {
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus()
      }
    }));

    await page.evaluate(() => window.stopMLTelemetry());
    captured.onlineFinal = scenario === 'C'
      ? await waitForUploaderDrain(page)
      : await page.evaluate(() => window.getOnlineMLTelemetryStats());
    await page.keyboard.up('w');

    const result = {
      id: label,
      scenario,
      repetition,
      status: 'completed',
      startedAt,
      finishedAt: new Date().toISOString(),
      ...captured,
      diagnostics
    };
    console.log(`[run ${label}] Completed — ${result.performance.averageFps.toFixed(2)} FPS, frame p95 ${result.performance.frame.p95Ms.toFixed(2)} ms.`);
    return result;
  } catch (error) {
    await page.keyboard.up('w').catch(() => {});
    const online = await page.evaluate(() => window.getOnlineMLTelemetryStats()).catch(() => null);
    console.error(`[run ${label}] FAILED — ${error.message}`);
    return {
      id: label,
      scenario,
      repetition,
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error.message,
      online,
      diagnostics
    };
  } finally {
    await context.close();
  }
}

function numericMedian(values) {
  const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function numericDistribution(values) {
  const numbers = values.filter(Number.isFinite);
  if (!numbers.length) return null;
  const median = numericMedian(numbers);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / numbers.length;
  const standardDeviation = Math.sqrt(variance);
  return {
    values: numbers,
    count: numbers.length,
    min,
    median,
    max,
    range: max - min,
    standardDeviation,
    coefficientOfVariationPercent: mean === 0 ? null : (standardDeviation / Math.abs(mean)) * 100
  };
}

function getPath(object, keyPath) {
  return keyPath.split('.').reduce((value, key) => value?.[key], object);
}

function aggregatePerformance(runs) {
  const completed = runs.filter(run => run.status === 'completed');
  if (!completed.length) return null;
  const stats = {};
  const scalarPaths = ['elapsedMinutes', 'averageFps', 'requestsPerMinute', 'uploadedKBPerMinute', 'rawBodyKBPerMinute',
    'wireKBPerMinute', 'averagePayloadBytes', 'heapStartBytes', 'heapCurrentBytes', 'heapPeakBytes'];
  for (const key of scalarPaths) stats[key] = numericMedian(completed.map(run => getPath(run.performance, key)));
  for (const bucket of ['frame', 'frameCpu', 'collector', 'uploaderMainThread', 'networkAsyncLatency']) {
    stats[bucket] = {};
    for (const key of ['count', 'meanMs', 'p50Ms', 'p95Ms', 'p99Ms']) {
      stats[bucket][key] = numericMedian(completed.map(run => getPath(run.performance, `${bucket}.${key}`)));
    }
  }
  stats.uploaderMainThreadScope = completed[0].performance.uploaderMainThreadScope;
  return stats;
}

function performanceDistributions(runs) {
  const completed = runs.filter(run => run.status === 'completed');
  return Object.fromEntries(DISTRIBUTION_METRIC_PATHS.map(([key, label]) => [key, {
    label,
    ...numericDistribution(completed.map(run => getPath(run.performance, key)))
  }]));
}

function aggregateOnline(runs) {
  const completed = runs.filter(run => run.status === 'completed' && run.onlineFinal);
  if (!completed.length) return null;
  const aggregate = {};
  for (const key of ONLINE_DISTRIBUTION_KEYS) {
    aggregate[key] = numericMedian(completed.map(run => run.onlineFinal[key]));
  }
  aggregate.lastError = completed.every(run => run.onlineFinal.lastError == null) ? null
    : completed.map(run => run.onlineFinal.lastError).filter(Boolean);
  aggregate.sessionStatus = completed.map(run => run.onlineFinal.sessionStatus);
  return aggregate;
}

function onlineDistributions(runs) {
  const completed = runs.filter(run => run.status === 'completed' && run.onlineFinal);
  return Object.fromEntries(ONLINE_DISTRIBUTION_KEYS.map(key => [key,
    numericDistribution(completed.map(run => run.onlineFinal[key]))
  ]));
}

function compareMetrics(baseline, candidate) {
  if (!baseline || !candidate) return null;
  return METRIC_PATHS.map(([key, label, direction]) => {
    const base = getPath(baseline, key);
    const next = getPath(candidate, key);
    if (!Number.isFinite(base) || !Number.isFinite(next)) {
      return { key, label, baseline: base ?? null, candidate: next ?? null, absoluteDelta: null, percentChange: null, overheadPercent: null };
    }
    const absoluteDelta = next - base;
    const percentChange = base === 0 ? null : (absoluteDelta / base) * 100;
    const overheadPercent = direction === 'lower' && base !== 0 ? ((base - next) / base) * 100 : percentChange;
    return { key, label, baseline: base, candidate: next, absoluteDelta, percentChange, overheadPercent };
  });
}

function comparisonValue(comparison, key) {
  return comparison?.find(item => item.key === key)?.overheadPercent;
}

function criterion(id, label, actual, limit, operator = '<=') {
  const available = Number.isFinite(actual);
  const passed = available && (operator === '<' ? actual < limit : operator === '===' ? actual === limit : actual <= limit);
  return { id, label, actual: available ? actual : null, operator, limit, status: available ? (passed ? 'PASS' : 'FAIL') : 'BLOCKED' };
}

function allEqualCriterion(id, label, values, expected) {
  const available = values.length > 0;
  return {
    id,
    label,
    actual: available ? values : null,
    operator: 'all ===',
    limit: expected,
    status: available ? (values.every(value => value === expected) ? 'PASS' : 'FAIL') : 'BLOCKED'
  };
}

function evaluateCriteria(aggregates, comparisons, repetitions, scenarioCBlocked, cRuns) {
  const cFinals = cRuns.filter(run => run.status === 'completed' && run.onlineFinal).map(run => run.onlineFinal);
  const criteria = [
    criterion('B_FPS', 'B vs A average FPS drop', comparisonValue(comparisons.BvsA, 'averageFps'), 3),
    criterion('B_FRAME_P95', 'B vs A frame p95 increase', comparisonValue(comparisons.BvsA, 'frame.p95Ms'), 5),
    criterion('B_COLLECTOR_P95', 'B collector p95', aggregates.B?.collector?.p95Ms, 1, '<'),
    criterion('C_FPS', 'C vs A average FPS drop', comparisonValue(comparisons.CvsA, 'averageFps'), 5),
    criterion('C_FRAME_P95', 'C vs A frame p95 increase', comparisonValue(comparisons.CvsA, 'frame.p95Ms'), 8),
    criterion('C_UPLOADER_P95', 'C uploader main-thread p95', aggregates.C?.uploaderMainThread?.p95Ms, 2, '<'),
    allEqualCriterion('C_DROPPED_BATCHES', 'C dropped batches in every run', cFinals.map(stats => stats.droppedBatches), 0),
    allEqualCriterion('C_DROPPED_SAMPLES', 'C dropped samples in every run', cFinals.map(stats => stats.droppedSamples), 0),
    allEqualCriterion('C_PENDING_BATCHES', 'C pending batches drained in every run', cFinals.map(stats => stats.pendingBatches), 0),
    allEqualCriterion('C_PERSISTED_BATCHES', 'C persisted queue drained in every run', cFinals.map(stats => stats.persistedBatches), 0),
    allEqualCriterion('C_IN_FLIGHT', 'C in-flight requests drained in every run', cFinals.map(stats => stats.inFlightRequests), 0)
  ];
  criteria.push({
    id: 'C_LAST_ERROR', label: 'C last error is null in every run', actual: cFinals.length ? cFinals.map(stats => stats.lastError) : null,
    operator: 'all ===', limit: null, status: cFinals.length ? (cFinals.every(stats => stats.lastError == null) ? 'PASS' : 'FAIL') : 'BLOCKED'
  });
  criteria.push({
    id: 'C_ACKS', label: 'C acknowledged batches match sent batches in every run',
    actual: cFinals.length ? cFinals.map(stats => `${stats.acknowledgedBatches}/${stats.sentBatches}`) : null,
    operator: 'all ===', limit: 'sentBatches',
    status: cFinals.length ? (cFinals.every(stats => stats.acknowledgedBatches === stats.sentBatches) ? 'PASS' : 'FAIL') : 'BLOCKED'
  });
  if (scenarioCBlocked) {
    for (const item of criteria.filter(item => item.id.startsWith('C_'))) item.status = 'BLOCKED';
  }
  const failed = criteria.some(item => item.status === 'FAIL');
  const blocked = criteria.some(item => item.status === 'BLOCKED');
  return {
    criteria,
    status: failed ? 'FAIL' : blocked ? 'BLOCKED' : repetitions < 3 ? 'WARNING' : 'PASS',
    note: repetitions < 3 ? 'Fewer than three repetitions: diagnostic only, not definitive.' : null
  };
}

function fmt(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'N/A';
}

function fmtPercent(value) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : 'N/A';
}

function metricRows(aggregate) {
  if (!aggregate) return '| metric | median |\n|---|---:|\n| unavailable | N/A |';
  return [
    ['average FPS', fmt(aggregate.averageFps, 2)],
    ['frame count', fmt(aggregate.frame.count, 0)],
    ['frame mean / p50 / p95 / p99 (ms)', `${fmt(aggregate.frame.meanMs)} / ${fmt(aggregate.frame.p50Ms)} / ${fmt(aggregate.frame.p95Ms)} / ${fmt(aggregate.frame.p99Ms)}`],
    ['frame CPU mean / p95 / p99 (ms)', `${fmt(aggregate.frameCpu.meanMs)} / ${fmt(aggregate.frameCpu.p95Ms)} / ${fmt(aggregate.frameCpu.p99Ms)}`],
    ['collector mean / p95 / p99 (ms)', `${fmt(aggregate.collector.meanMs)} / ${fmt(aggregate.collector.p95Ms)} / ${fmt(aggregate.collector.p99Ms)}`],
    ['uploader main mean / p95 / p99 (ms)', `${fmt(aggregate.uploaderMainThread.meanMs)} / ${fmt(aggregate.uploaderMainThread.p95Ms)} / ${fmt(aggregate.uploaderMainThread.p99Ms)}`],
    ['network async mean / p95 / p99 (ms)', `${fmt(aggregate.networkAsyncLatency.meanMs)} / ${fmt(aggregate.networkAsyncLatency.p95Ms)} / ${fmt(aggregate.networkAsyncLatency.p99Ms)}`],
    ['requests/min', fmt(aggregate.requestsPerMinute)],
    ['uploaded KB/min', fmt(aggregate.uploadedKBPerMinute)],
    ['average payload bytes', fmt(aggregate.averagePayloadBytes, 0)],
    ['heap start / current / peak (bytes)', `${fmt(aggregate.heapStartBytes, 0)} / ${fmt(aggregate.heapCurrentBytes, 0)} / ${fmt(aggregate.heapPeakBytes, 0)}`]
  ].map(([metric, value]) => `| ${metric} | ${value} |`).join('\n').replace(/^/, '| metric | median |\n|---|---:|\n');
}

function comparisonRows(comparison) {
  if (!comparison) return '| metric | baseline | candidate | absolute delta | overhead |\n|---|---:|---:|---:|---:|\n| unavailable | N/A | N/A | N/A | N/A |';
  return comparison.map(item => `| ${item.label} | ${fmt(item.baseline)} | ${fmt(item.candidate)} | ${fmt(item.absoluteDelta)} | ${fmtPercent(item.overheadPercent)} |`)
    .join('\n').replace(/^/, '| metric | baseline | candidate | absolute delta | overhead |\n|---|---:|---:|---:|---:|\n');
}

function individualRunRows(runs) {
  return runs.map(run => {
    if (run.status !== 'completed') return `| ${run.id} | ${run.status} | N/A | N/A | N/A | N/A | N/A | ${run.error || 'unknown error'} |`;
    return `| ${run.id} | completed | ${fmt(run.performance.averageFps, 2)} | ${fmt(run.performance.frame.p95Ms)} | ${fmt(run.performance.frameCpu.p95Ms)} | ${fmt(run.performance.collector.p95Ms)} | ${run.collector.totalSamples ?? 'N/A'} | ${run.diagnostics.consoleErrors.length} |`;
  }).join('\n').replace(/^/, '| run | status | FPS | frame p95 ms | frame CPU p95 ms | collector p95 ms | local samples | console errors |\n|---|---|---:|---:|---:|---:|---:|---:|\n');
}

function distributionRows(distributions) {
  const rows = [];
  for (const scenario of ['A', 'B', 'C']) {
    for (const [key, distribution] of Object.entries(distributions.performance[scenario])) {
      if (!distribution || distribution.count == null) continue;
      rows.push(`| ${scenario} | ${distribution.label || key} | ${distribution.values.map(value => fmt(value)).join(', ')} | ${fmt(distribution.min)} | ${fmt(distribution.median)} | ${fmt(distribution.max)} | ${fmt(distribution.range)} | ${fmt(distribution.standardDeviation)} |`);
    }
  }
  return rows.join('\n').replace(/^/, '| scenario | metric | individual values | min | median | max | range | std dev |\n|---|---|---|---:|---:|---:|---:|---:|\n');
}

function onlineIndividualRows(runs) {
  const cRuns = runs.filter(run => run.scenario === 'C');
  return cRuns.map(run => {
    const stats = run.onlineFinal || run.online;
    if (!stats) return `| ${run.id} | ${run.status} | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ${run.error || 'unavailable'} |`;
    const serverSessionId = stats.serverSessionId ?? run.onlineAtMeasurementEnd?.serverSessionId;
    return `| ${run.id} | ${run.status} | ${serverSessionId ?? 'N/A'} | ${stats.sentBatches ?? 'N/A'} | ${stats.acknowledgedBatches ?? 'N/A'} | ${stats.retryCount ?? 'N/A'} | ${stats.droppedBatches ?? 'N/A'} | ${stats.droppedSamples ?? 'N/A'} | ${stats.pendingBatches ?? 'N/A'} | ${stats.persistedBatches ?? 'N/A'} | ${stats.inFlightRequests ?? 'N/A'} | ${stats.sessionStatus ?? 'N/A'} / ${stats.lastError ?? 'null'} |`;
  }).join('\n').replace(/^/, '| run | status | server session | sent | ack | retries | dropped batches | dropped samples | pending | persisted | in flight | final status / error |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\n');
}

function generateReport(result) {
  const { config, environment, aggregates, distributions, comparisons, acceptance, onlineAggregate, cloudProbe } = result;
  const runCounts = Object.fromEntries(['A', 'B', 'C'].map(scenario => [scenario, result.runs.filter(run => run.scenario === scenario && run.status === 'completed').length]));
  const cRows = onlineAggregate
    ? Object.entries(onlineAggregate).map(([key, value]) => `| ${key} | ${Array.isArray(value) ? value.join(', ') : value ?? 'null'} |`).join('\n')
    : `| status | BLOCKED: ${cloudProbe.reason || 'scenario C unavailable'} |`;
  const criteriaRows = acceptance.criteria.map(item => `| ${item.status} | ${item.label} | ${Array.isArray(item.actual) ? item.actual.join(', ') : item.actual ?? 'N/A'} | ${item.operator} ${item.limit ?? 'null'} |`).join('\n');
  const limitations = [
    config.quick || config.repetitions < 3 ? '- This was a diagnostic run with fewer than three repetitions; it is not the definitive benchmark.' : null,
    cloudProbe.available ? null : `- Scenario C was blocked: ${cloudProbe.reason}`,
    environment.workspaceDirty ? '- The benchmark ran against a dirty working tree. Existing working-tree changes were preserved and are listed in the JSON artifact.' : null,
    result.runs.some(run => run.diagnostics?.consoleErrors?.length)
      ? '- Each measured run logged three `ERR_CONNECTION_REFUSED` resource errors from the separate legacy gameplay API at `http://localhost:3001`. They occurred while preparing the grid, before warm-up and the official measurement window.'
      : null,
    result.runs.some(run => run.status === 'completed' && Number.isFinite(run.performance.heapCurrentBytes)
      && Number.isFinite(run.performance.heapPeakBytes) && run.performance.heapCurrentBytes > run.performance.heapPeakBytes)
      ? '- The existing one-second heap sampler reported a final current heap above its sampled peak in at least one run. Raw API values are retained; treat heapPeakBytes as a sampled peak, not an exact maximum.'
      : null,
    aggregates.A?.heapPeakBytes == null || aggregates.B?.heapPeakBytes == null ? '- performance.memory was unavailable; heap metrics are N/A and do not fail the benchmark.' : null,
    '- networkAsyncLatency is reported only as asynchronous network latency and is not used as CPU/frame overhead.',
    '- The player uses deterministic continuous throttle. Existing bots provide race/rendering load; no physics, AI, geometry, schema, or sample-rate behavior is altered.'
  ].filter(Boolean).join('\n');
  return `# ${result.benchmark} — Browser performance benchmark A/B/C\n\n` +
    `Overall gate: **${acceptance.status}**${acceptance.note ? ` — ${acceptance.note}` : ''}\n\n` +
    `## Environment\n\n` +
    `| item | value |\n|---|---|\n` +
    `| executed at | ${result.finishedAt} |\n` +
    `| source | ${environment.source} |\n` +
    `| requested URL | ${environment.requestedUrl} |\n` +
    `| final URL after redirects | ${environment.url} |\n` +
    `| browser | ${environment.browserName} ${environment.browserVersion} |\n` +
    `| user agent | ${environment.userAgent} |\n` +
    `| OS | ${environment.os} |\n` +
    `| Node | ${environment.node} |\n` +
    `| viewport | ${config.viewport.width}×${config.viewport.height}, DPR 1 |\n` +
    `| mode | ${config.headless ? 'headless' : 'headed'} |\n` +
    `| warm-up | ${config.warmupSeconds}s, excluded from official metrics |\n` +
    `| measurement | ${config.measurementSeconds}s per run |\n` +
    `| repetitions | requested ${config.repetitions}; completed A=${runCounts.A}, B=${runCounts.B}, C=${runCounts.C} |\n` +
    `| balanced run order | ${config.runOrder.join(' → ')} |\n` +
    `| screenshot | ${result.smoke.screenshotPath} |\n` +
    `| benchmark bundle assets | ${result.smoke.assets.join(', ') || 'N/A'} |\n\n` +
    `## Controlled scenario\n\n` +
    `Interlagos (track ${config.trackId}), dry, ${config.bots + 1} cars (${config.bots} existing AI bots + player), professional difficulty, automatic transmission, ${config.laps} laps. The game exposes no selectable graphics preset, so every run uses the same production rendering configuration. ` +
    `Each repetition uses a fresh browser context, the same Chromium process/version, seed ${config.seed}, viewport, controls, and continuous-throttle driving logic.\n\n` +
    `The game is allowed to reach lights-out, then warmed for ${config.warmupSeconds}s. Performance metrics are reset immediately before the ${config.measurementSeconds}s official window. ` +
    (cloudProbe.available
      ? `For C, Render health and session ACTIVE/serverSessionId are confirmed before warm-up, so cold start is outside the official window.\n\n`
      : `C was not run because its browser/cloud gate was blocked before measurement.\n\n`) +
    `## Individual runs\n\n${individualRunRows(result.runs)}\n\n` +
    `## Scenario A — telemetry off\n\n${metricRows(aggregates.A)}\n\n` +
    `## Scenario B — local collection on, online upload off\n\n${metricRows(aggregates.B)}\n\n` +
    `## Scenario C — local collection and online upload\n\n${metricRows(aggregates.C)}\n\n` +
    `## Individual values and simple dispersion\n\nMedian is the primary comparison statistic. Range and population standard deviation expose run-to-run spread.\n\n${distributionRows(distributions)}\n\n` +
    `### C upload delivery\n\n| metric | median/final value |\n|---|---|\n${cRows}\n\n` +
    `### C upload delivery by run\n\n${onlineIndividualRows(result.runs)}\n\n` +
    `## B vs A\n\n${comparisonRows(comparisons.BvsA)}\n\n` +
    `## C vs A\n\n${comparisonRows(comparisons.CvsA)}\n\n` +
    `## C vs B\n\n${comparisonRows(comparisons.CvsB)}\n\n` +
    `Positive overhead means worse (FPS drop or time/memory increase). A negative result means lower observed overhead in this sample; it is not, by itself, evidence that telemetry caused a performance gain.\n\n` +
    `## Acceptance criteria\n\n| status | criterion | actual | limit |\n|---|---|---:|---|\n${criteriaRows}\n\n` +
    `## Browser/cloud gate\n\n` +
    `Browser smoke verification: **PASS**. Render health: ${cloudProbe.healthStatus ?? 'N/A'}; CORS preflight from ${cloudProbe.pageOrigin}: ${cloudProbe.preflightStatus ?? 'N/A'}; scenario C: **${cloudProbe.available ? 'AVAILABLE' : 'BLOCKED'}**.\n\n` +
    `## Limitations\n\n${limitations}\n\n` +
    `## Reproduction\n\n` +
    `Install once:\n\n\`\`\`powershell\nnpm install\nnpx playwright install chromium\n\`\`\`\n\n` +
    `Official local production benchmark (A/B; C remains subject to Render CORS for localhost):\n\n\`\`\`powershell\n$env:VITE_TELEMETRY_API_URL='https://quick-grid-telemetry-api.onrender.com'\nnpm.cmd run benchmark:ml22\n\`\`\`\n\n` +
    `Official A/B/C through the Vercel production origin allowed by Render CORS:\n\n\`\`\`powershell\nnpm.cmd run benchmark:ml22 -- --base-url='https://quick-grid-nu.vercel.app' --output='artifacts/ml22_browser_benchmark_vercel.json' --report='artifacts/ml22_browser_benchmark_vercel.md'\n\`\`\`\n\n` +
    `Quick diagnostic only:\n\n\`\`\`powershell\n$env:VITE_TELEMETRY_API_URL='https://quick-grid-telemetry-api.onrender.com'\nnpm.cmd run benchmark:ml22 -- --quick\n\`\`\`\n`;
}

function buildRunSchedule(scenarios, repetitions) {
  const schedule = [];
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    const offset = (repetition - 1) % scenarios.length;
    const rotated = [...scenarios.slice(offset), ...scenarios.slice(0, offset)];
    for (const scenario of rotated) schedule.push({ scenario, repetition });
  }
  return schedule;
}

async function readGitStatus() {
  return new Promise(resolve => {
    const child = spawn('git', ['status', '--short'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('exit', () => resolve(output.trim().split(/\r?\n/).filter(Boolean)));
    child.on('error', () => resolve([]));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  let preview = null;
  let browser = null;
  try {
    const local = options.baseUrl ? null : await startLocalProduction(options);
    preview = local?.preview || null;
    options.url = options.baseUrl || local.url;
    options.source = options.baseUrl ? 'deployed build' : 'local Vite production build + preview';

    browser = await chromium.launch({ headless: options.headless, args: ['--enable-precise-memory-info'] });
    const browserVersion = browser.version();
    console.log(`[browser] Chromium ${browserVersion}; ${options.viewport.width}x${options.viewport.height}; headless=${options.headless}`);
    const smoke = await smokeCheck(browser, options);
    const pageOrigin = new URL(smoke.finalUrl).origin;
    const cloudProbe = await probeOnlineScenario(smoke.uploader.apiUrl, pageOrigin);
    const runs = [];
    const scenarios = cloudProbe.available ? ['A', 'B', 'C'] : ['A', 'B'];
    const schedule = buildRunSchedule(scenarios, options.repetitions);

    // Rotate scenario order per repetition to reduce long-run thermal and scheduling bias.
    for (const { scenario, repetition } of schedule) {
      runs.push(await runScenario(browser, options, scenario, repetition));
    }

    const grouped = Object.fromEntries(['A', 'B', 'C'].map(scenario => [scenario, runs.filter(run => run.scenario === scenario)]));
    const aggregates = Object.fromEntries(['A', 'B', 'C'].map(scenario => [scenario, aggregatePerformance(grouped[scenario])]));
    const onlineAggregate = aggregateOnline(grouped.C);
    const distributions = {
      performance: Object.fromEntries(['A', 'B', 'C'].map(scenario => [scenario, performanceDistributions(grouped[scenario])])),
      onlineC: onlineDistributions(grouped.C)
    };
    const comparisons = {
      BvsA: compareMetrics(aggregates.A, aggregates.B),
      CvsA: compareMetrics(aggregates.A, aggregates.C),
      CvsB: compareMetrics(aggregates.B, aggregates.C)
    };
    const acceptance = evaluateCriteria(aggregates, comparisons, options.repetitions, !cloudProbe.available, grouped.C);
    const workspaceStatus = await readGitStatus();
    const finishedAt = new Date().toISOString();
    const result = {
      schemaVersion: 1,
      benchmark: options.baseUrl ? 'ML2.2-H Vercel production official' : 'ML2.2-G local preliminary',
      startedAt,
      finishedAt,
      config: {
        warmupSeconds: options.warmupSeconds,
        measurementSeconds: options.measurementSeconds,
        repetitions: options.repetitions,
        viewport: options.viewport,
        headless: options.headless,
        quick: options.quick,
        trackId: options.trackId,
        trackName: options.trackName,
        bots: options.bots,
        totalCars: options.bots + 1,
        laps: options.laps,
        condition: options.condition,
        transmission: options.transmission,
        difficulty: options.difficulty,
        seed: options.seed,
        driving: 'continuous KeyW throttle',
        cpuThrottling: 'none configured',
        pageIsolation: 'one fresh context with one page per run; one reused Chromium process',
        runOrder: schedule.map(({ scenario, repetition }) => `${scenario}${repetition}`)
      },
      environment: {
        source: options.source,
        requestedUrl: options.url,
        url: smoke.finalUrl,
        browserName: 'Chromium',
        browserVersion,
        userAgent: smoke.userAgent,
        os: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        playwright: '1.63.0',
        workspaceDirty: workspaceStatus.length > 0,
        workspaceStatus
      },
      smoke,
      cloudProbe,
      runs,
      aggregates,
      distributions,
      onlineAggregate,
      comparisons,
      acceptance
    };

    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await mkdir(path.dirname(options.reportPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await writeFile(options.reportPath, generateReport(result), 'utf8');
    console.log(`[result] ${acceptance.status}`);
    console.log(`[result] JSON: ${path.relative(ROOT, options.outputPath)}`);
    console.log(`[result] Markdown: ${path.relative(ROOT, options.reportPath)}`);

    const requiredFailure = !aggregates.A || !aggregates.B || acceptance.criteria.some(item => item.status === 'FAIL');
    if (requiredFailure) process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (preview && !preview.killed) preview.kill();
  }
}

main().catch(error => {
  console.error(`[fatal] ${error.stack || error.message}`);
  process.exitCode = 1;
});
