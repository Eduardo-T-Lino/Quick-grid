import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { ONLINE_VERSION } from '../src/online/protocol.js';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
let passed = 0; const check = (ok, label) => { assert.ok(ok, label); passed++; console.log(`PASS ${label}`); };
const bind = action => page.locator(`#controls-bindings [data-action="${action}"]`);
const close = () => page.getByRole('button', { name: 'Fechar controles', exact: true }).click();
const load = async () => { await page.goto('http://127.0.0.1:5185/'); await page.waitForFunction(() => window.startGame); };
const attachState = () => page.evaluate(async () => {
  const entry = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/game.js');
  const game = await import(entry?.name || '/src/game.js'); window.controlsTestState = game.state; window.controlsTestBack = game.backToMenu;
});
try {
  await load(); await page.click('#controls-open');
  check(await bind('accelerate').textContent() === 'W', 'Settings open with default WASD keys');
  await bind('accelerate').click(); await page.keyboard.press('s');
  check((await page.locator('#controls-message').textContent()).includes('já controla'), 'Duplicate keys are rejected');
  await page.keyboard.press('r'); check((await page.locator('#controls-message').textContent()).includes('reservada'), 'Restart/browser keys are reserved during capture');
  await page.keyboard.press('Escape'); check(await bind('accelerate').textContent() === 'W', 'Escape cancels capture without changing the binding');
  await bind('accelerate').click(); await page.keyboard.press('i'); await close();
  await page.click('#controls-open'); check(await bind('accelerate').textContent() === 'W', 'Closing without saving discards the draft');
  for (const [action, key] of [['accelerate', 'i'], ['boost', 'ShiftLeft'], ['shiftUp', 'u']]) { await bind(action).click(); await page.keyboard.press(key); }
  await page.click('#controls-save');
  check((await page.locator('#controls-message').textContent()).includes('salvos'), 'Explicit save persists the chosen keys');
  await load(); await page.click('#controls-open');
  check(await bind('accelerate').textContent() === 'I' && await bind('boost').textContent() === 'SHIFT E', 'Settings survive a full page reload');
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/controls-settings.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.locator('#controls-dialog').evaluate(d => d.scrollWidth <= d.clientWidth), 'Controls dialog fits narrow screens without horizontal overflow');
  await page.screenshot({ path: 'artifacts/controls-mobile.png' }); await page.setViewportSize({ width: 1280, height: 720 }); await close();
  const separate = await browser.newContext(), other = await separate.newPage(); await other.goto('http://127.0.0.1:5185/'); await other.waitForFunction(() => window.startGame); await other.click('#controls-open');
  check(await other.locator('[data-action="accelerate"]').textContent() === 'W', 'Another browser profile keeps its own controls'); await separate.close(); await page.bringToFront();
  // Only the unrelated legacy training reads are stubbed for offline racing.
  await page.route('http://localhost:3001/api/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await attachState(); await page.evaluate(() => window.startGame({ gameMode: 'timeattack', transMode: 'manual', trackSelect: 21, lapCount: 3, botCount: 0, trackCondition: 'dry' }));
  await page.waitForFunction(() => window.controlsTestState.racePhase === 'racing'); await page.locator('#gameCanvas').focus();
  await page.keyboard.down('w'); check(await page.evaluate(() => !window.controlsTestState.keys.KeyW), 'Old accelerator key no longer drives after remapping'); await page.keyboard.up('w');
  await page.keyboard.down('i'); await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(() => window.controlsTestState.cars[0].boostActive);
  check(await page.locator('#boost-hud [data-control-hint="boost"]').textContent() === 'SHIFT E', 'Remapped keyboard activates boost and its HUD hint matches');
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('i');
  await page.keyboard.press('Escape'); await page.click('#session-controls');
  check(await page.locator('#controls-dialog').evaluate(d => d.open) && await page.evaluate(() => window.controlsTestState.isPaused), 'Controls are reachable from pause without resuming the race');
  await bind('accelerate').click(); await page.keyboard.press('r'); await page.keyboard.press('Escape'); await close();
  check(await page.evaluate(() => window.controlsTestState.isPaused) && await page.locator('#session-confirm').isHidden(), 'Capturing R inside pause never restarts the race');
  await page.click('#session-resume'); check(await page.evaluate(() => !window.controlsTestState.keys.Space && !window.controlsTestState.keys.KeyW), 'Resume clears held throttle and boost');
  await page.evaluate(() => window.controlsTestBack());
  // Real same-origin WebSocket server; protocol guest is only the second participant.
  await page.click('#online-open'); await page.locator('[data-online-select="online-auto"] [data-value="manual"]').click(); await page.click('#online-create');
  await page.locator('#online-room').waitFor({ state: 'visible' });
  await page.evaluate(version => {
    const ws = new WebSocket(`ws://${location.host}/online`); window.controlsTestPeer = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', version, name: 'Controls Guest', auto: true, code: document.getElementById('online-room-code').textContent }));
    ws.onmessage = event => { const m = JSON.parse(event.data); if (m.type === 'welcome') ws.send(JSON.stringify({ type: 'ready', ready: true })); if (m.type === 'room' && m.room.phase === 'loading') ws.send(JSON.stringify({ type: 'loaded', raceId: m.room.raceId })); };
  }, ONLINE_VERSION);
  await page.waitForFunction(() => document.getElementById('online-players').children.length === 2 && document.getElementById('online-players').lastElementChild.textContent.includes('pronto'));
  await page.click('#online-ready'); await page.click('#online-start'); await page.waitForFunction(() => window.controlsTestState.racePhase === 'racing');
  await page.locator('#gameCanvas').focus(); await page.keyboard.down('i'); await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(() => window.controlsTestState.cars[0].getKmh() > 20 && window.controlsTestState.cars[0].boostCharge < 1);
  check(true, 'Custom throttle and boost reach real authoritative online physics'); await page.keyboard.up('i'); await page.keyboard.up('ShiftLeft');
  await page.keyboard.press('u'); await page.waitForFunction(() => window.controlsTestState.cars[0].gear === 2);
  check(true, 'Custom manual gear key is applied by the online server');
  await page.keyboard.press('Escape'); await page.click('#online-controls');
  check(await page.locator('#controls-dialog').evaluate(d => d.open) && await page.evaluate(() => !window.controlsTestState.isPaused), 'Online controls open without pausing the shared race');
  await page.click('#controls-arrows'); check(await bind('accelerate').textContent() === '↑' && await bind('shiftUp').textContent() === 'E', 'Arrow preset assigns independent driving and gear keys');
  await page.click('#controls-reset'); await page.click('#controls-save'); check(await bind('accelerate').textContent() === 'W', 'Restore defaults can be saved');
  await close(); await page.evaluate(() => { window.controlsTestPeer.close(); document.getElementById('online-leave').click(); });
  check(errors.length === 0, `No browser page errors: ${errors.join('; ')}`);
  console.log(`${passed} PASSOU | 0 FALHOU`);
} finally { await browser.close(); }
