// Isolated local preview only. Leaves a paused grid visible for screenshot review.
(async () => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw Error('LOCAL_ONLY');
  const url = path => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === path)?.name || path;
  const { state, pauseGame } = await import(url('/src/game.js'));
  const { updateHUD } = await import(url('/src/ui.js'));
  const { onlineUploader, mlTelemetry } = await import(url('/src/ml/telemetry/index.js'));
  if (state.isRunning || onlineUploader.consentEnabled || mlTelemetry.enabled) throw Error('Use fresh idle page; telemetry OFF');
  const el = id => document.getElementById(id), checks = [];
  const assert = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
  assert(el('transMode').value === 'auto' && state.transmissionMode === 'auto', 'Automatic is the startup default');
  const originalFetch = window.fetch;
  window.fetch = (url, opts) => String(url).startsWith('http://localhost:3001/api/')
    ? Promise.resolve(new Response('{}', { status: 200 })) : originalFetch(url, opts);
  try { await window.startGame(); } finally { window.fetch = originalFetch; }
  pauseGame();
  const car = state.cars[0];
  assert(car.isAuto && state.cars.length === 20, 'Default race uses automatic transmission and 19 opponents');
  const previous = { vx: car.vx, vy: car.vy };
  car.vx = -.05 * Math.cos(car.angle); car.vy = -.05 * Math.sin(car.angle); updateHUD();
  assert(el('gear-val').textContent === 'R', 'HUD identifies reverse');
  Object.assign(car, previous); updateHUD();
  assert(el('gear-val').textContent === '1', 'Forward gear uses a large single numeral');
  const dash = el('hud-bottom-right').getBoundingClientRect();
  assert(dash.left >= 0 && dash.right <= innerWidth && dash.bottom <= innerHeight, 'Dashboard fits the viewport');
  if (innerWidth <= 650) assert(el('restart-race').getBoundingClientRect().bottom < dash.top,
    'Compact dashboard does not cover the restart shortcut');
  for (const id of ['speed-val', 'gear-val', 'boost-hud']) {
    const rect = el(id).getBoundingClientRect();
    assert(rect.left >= dash.left && rect.right <= dash.right && rect.bottom <= dash.bottom, `${id} fits within dashboard`);
  }
  assert(parseFloat(getComputedStyle(el('speed-val')).fontSize) >= 40, 'Speed is readable');
  assert(parseFloat(getComputedStyle(el('speed-val')).fontSize) <= 48, 'Speed is more compact');
  assert(parseFloat(getComputedStyle(el('gear-val')).fontSize) <= 40, 'Gear is more compact');
  const rpm = el('rpm-bar').parentElement.getBoundingClientRect(), boost = el('boost-meter').getBoundingClientRect();
  assert(boost.top >= rpm.bottom && boost.top - rpm.bottom <= 8, 'Boost bar sits directly below RPM');
  assert(Math.abs(boost.left - rpm.left) < 1 && Math.abs(boost.width - rpm.width) < 1, 'RPM and boost bars share the same alignment');
  assert(getComputedStyle(el('physics-alert')).display === 'none', 'Grip warnings remain removed');
  assert(!document.querySelector('vite-error-overlay'), 'No Vite error overlay');
  return { passed: checks.length, checks, viewport: [innerWidth, innerHeight] };
})()
