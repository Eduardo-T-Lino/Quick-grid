// Isolated local browser, telemetry OFF. Only legacy training API reads are stubbed.
(async () => {
  const url = path => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === path)?.name || path;
  const { state, backToMenu, restartGame } = await import(url('/src/game.js'));
  const { onlineUploader, mlTelemetry } = await import(url('/src/ml/telemetry/index.js'));
  if (state.isRunning || onlineUploader.consentEnabled || mlTelemetry.enabled) throw Error('Use idle isolated page, telemetry OFF');
  const checks = [];
  const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const key = (type, code) => {
    const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
    window.dispatchEvent(event); return event;
  };
  const originalFetch = window.fetch;
  window.fetch = (url, opts) => String(url).startsWith('http://localhost:3001/api/')
    ? Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })) : originalFetch(url, opts);
  try {
    assert(document.getElementById('controls-dialog').textContent.includes('ESPAÇO'), 'Guide documents boost control');
    await window.startGame();
    const car = state.cars[0];
    document.getElementById('gameCanvas').focus();
    key('keydown', 'KeyW');
    assert(key('keydown', 'Space').defaultPrevented, 'Space controls boost without scrolling the page');
    await frame(); await frame();
    assert(car.boostCharge === 1 && !car.boostActive, 'Holding boost in countdown cannot spend charge');
    const deadline = performance.now() + 12000;
    while (state.racePhase === 'countdown' && performance.now() < deadline) await frame();
    assert(state.racePhase === 'racing', 'Boost waits for the real lights-out sequence');
    const activeDeadline = performance.now() + 1000;
    while (!car.boostActive && performance.now() < activeDeadline) await frame();
    assert(car.boostActive && car.boostCharge < 1, 'Real keyboard input activates boost and spends charge');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert(document.getElementById('boost-status').textContent.includes('ATIVO'), 'HUD shows active boost');
    assert(Number(document.getElementById('boost-meter').getAttribute('aria-valuenow')) < 100, 'Accessible meter follows the charge');
    key('keydown', 'Escape');
    const pausedCharge = car.boostCharge, pausedCooldown = car.boostCooldown;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert(state.isPaused && car.boostCharge === pausedCharge && car.boostCooldown === pausedCooldown, 'ESC freezes boost consumption and cooldown');
    document.getElementById('session-resume').click();
    await frame(); await frame();
    assert(!state.keys.Space && !car.boostActive, 'Resume does not leave boost stuck down');
    key('keydown', 'KeyW'); key('keydown', 'Space'); await frame(); await frame();
    key('keyup', 'Space'); await frame(); await frame();
    assert(!car.boostActive && car.boostCooldown > 0, 'Releasing Space ends power assist and starts cooldown');
    key('keydown', 'Space'); window.dispatchEvent(new Event('blur'));
    assert(state.isPaused && !state.keys.Space, 'Losing focus pauses and clears boost input');
    await restartGame();
    assert(state.cars[0] !== car && state.cars[0].boostCharge === 1 && !state.cars[0].boostActive, 'Restart gives a fresh full boost charge');
    assert(!onlineUploader.consentEnabled && !mlTelemetry.enabled, 'No telemetry sent by the test');
    return { passed: checks.length, checks };
  } finally { backToMenu(); window.fetch = originalFetch; state.keys = {}; }
})()
