import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const target = process.argv[2] || 'http://127.0.0.1:5187/';
if (!['localhost', '127.0.0.1'].includes(new URL(target).hostname)) throw new Error('LOCAL_ONLY');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1264, height: 625 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(target);
  await page.waitForFunction(() => Boolean(window.startGame));
  const hasContent = await page.evaluate(() => document.body.innerText.trim().length > 0);
  const overlay = await page.locator('.vite-error-overlay, #webpack-dev-server-client-overlay').count();
  if (!hasContent || overlay) throw new Error(hasContent ? 'VITE_ERROR_OVERLAY' : 'BLANK_PAGE');
  const source = await readFile(new URL('./test_rwd_physics.browser.js', import.meta.url), 'utf8');
  const result = await page.evaluate(source);
  if (errors.length) throw new Error(`BROWSER_PAGE_ERRORS:${errors.join(';')}`);
  console.log(JSON.stringify({ pageLoaded: true, errorOverlay: false, pageErrors: 0, ...result }));
} finally {
  await browser.close();
}
