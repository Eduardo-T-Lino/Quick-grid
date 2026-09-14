(async () => {
  const url = path => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === path)?.name || path;
  const { state, backToMenu } = await import(url('/src/game.js'));
  const { updateHUD } = await import(url('/src/ui.js'));
  const { onlineUploader, mlTelemetry } = await import(url('/src/ml/telemetry/index.js'));
  if (state.isRunning || onlineUploader.consentEnabled || mlTelemetry.enabled) throw Error('Use idle isolated page with telemetry OFF');
  const el = id => document.getElementById(id), checks = [];
  const assert = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
  const change = (id, value, type = 'change') => { el(id).value = value; el(id).dispatchEvent(new Event(type, { bubbles: true })); };
  const originalFetch = window.fetch;
  window.fetch = (url, opts) => String(url).startsWith('http://localhost:3001/api/')
    ? Promise.resolve(new Response('{}', { status: 200 })) : originalFetch(url, opts);
  try {
    el('auth-dialog').close();
    for (let n = 1; n <= 19; n++) {
      change('botRange', n, 'input');
      assert(Number(el('botCount').value) === n && el('session-brief').textContent.includes(`${n + 1} carros`), 'All 1–19 bot counts synchronize with the session');
    }
    el('bots-less').click(); assert(el('botCount').value === '18', 'Minus button adjusts bots');
    el('bots-more').click(); assert(el('botCount').value === '19' && el('bots-more').disabled, 'Plus button respects maximum');
    change('botCount', 0); assert(el('botCount').value === '1' && el('bots-less').disabled, 'Numeric entry clamps minimum');
    change('botCount', 99); assert(el('botCount').value === '19', 'Numeric entry clamps maximum');
    change('botCount', 7.9); assert(el('botCount').value === '7', 'Numeric entry keeps whole bot counts');
    document.querySelector('[data-bots="12"]').click();
    assert(el('botRange').value === '12' && document.querySelector('[data-bots="12"]').getAttribute('aria-pressed') === 'true', 'Presets show selected state');
    change('gameMode', 'ghost');
    assert(el('botCount').disabled && el('botRange').disabled && el('bots-less').disabled && [...document.querySelectorAll('[data-bots]')].every(b => b.disabled), 'Ghost disables every bot control');
    await window.startGame(); assert(state.cars.length === 1, 'Ghost still creates only the player'); backToMenu();
    change('gameMode', 'race');
    assert(el('botCount').value === '12' && !el('botRange').disabled, 'Race restores saved grid size');
    for (const bots of [1, 7, 19]) {
      change('botCount', bots); await window.startGame();
      assert(state.cars.length === bots + 1 && state.cars[0].rank === bots + 1, 'Actual grid uses chosen bot count');
      const car = state.cars[0];
      for (const [surface, physics] of [['GRAVEL', 'OVERSTEER'], ['TARMAC', 'UNDERSTEER'], ['TARMAC', 'OVERSTEER']]) {
        car.currentSurface = surface; car.physicsState = physics; updateHUD();
        assert(getComputedStyle(el('physics-alert')).display === 'none' && el('physics-alert').textContent === '', 'Grip warnings remain absent for gravel and slides');
      }
      assert(parseFloat(getComputedStyle(el('speed-val')).fontSize) >= 40, 'Speed remains large and readable');
      assert(el('boost-meter').getAttribute('aria-valuenow') === '100', 'New race displays full boost');
      backToMenu();
    }
    assert(!document.querySelector('vite-error-overlay'), 'No Vite error overlay');
    return { passed: new Set(checks).size, checks: [...new Set(checks)] };
  } finally { backToMenu(); window.fetch = originalFetch; change('botCount', 19); }
})()
