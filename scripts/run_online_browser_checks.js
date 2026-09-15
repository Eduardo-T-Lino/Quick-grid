// Fallback runner when the browser CLI loses its evaluation tab. Localhost only.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { registerBrowserAccount, protocolAccountTicket } from './browser_account_fixture.js';
const target = process.argv[2] || 'http://127.0.0.1:5185/';
if (!['localhost', '127.0.0.1'].includes(new URL(target).hostname)) throw Error('LOCAL_ONLY');
const scenario = spawnSync(process.execPath, ['scripts/test_paddock_browser.js', target], { stdio: 'inherit', timeout: 90000 });
if (scenario.status !== 0) throw Error('Authenticated paddock scenario failed');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1264, height: 625 } });
const page = await context.newPage(), errors = [], reports = {};
page.on('pageerror', error => errors.push(error.message));
await mkdir('artifacts', { recursive: true });
try {
  for (const file of ['benchmark_online.browser.js', 'test_boost.browser.js']) {
    await page.goto(target); await page.waitForFunction(() => Boolean(window.startGame));
    if (file === 'benchmark_online.browser.js') {
      await registerBrowserAccount(page, 'Frame Test');
      const tickets = [];
      for (let i = 0; i < 7; i++) tickets.push(await protocolAccountTicket(browser, target, `Load Driver ${i}`));
      await page.evaluate(values => { window.__benchmarkTickets = values; }, tickets);
    }
    reports[file] = await page.evaluate(await readFile(path.join('scripts', file), 'utf8'));
    console.log(JSON.stringify({ script: file, result: reports[file] }));
  }
  await page.goto(target); await page.getByRole('button', { name: 'JOGAR ONLINE' }).click();
  await page.screenshot({ path: 'artifacts/online-redesign.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/online-redesign-mobile.png' });
  const overflow = await page.locator('#online-dialog').evaluate(el => el.scrollWidth > el.clientWidth);
  if (overflow) throw Error('Online dialog overflows horizontally on mobile');
  if (errors.length) throw Error(`Browser page errors: ${errors.join('; ')}`);
  await writeFile('artifacts/online-browser-checks.json', JSON.stringify({ target, reports, errors, mobileOverflow: overflow }, null, 2));
  console.log('PASS browser flow, offline regression, mobile layout; no page errors');
} finally { await browser.close(); }
