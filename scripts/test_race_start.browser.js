// Execute against a freshly loaded local Vite page with agent-browser eval --stdin.
(async () => {
  const checks = [];
  const assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const { state, backToMenu } = await import('/src/game.js');
  const { raceStart } = await import('/src/raceStart.js');
  const { Car } = await import('/src/car.js');
  const { mlTelemetry } = await import('/src/ml/telemetry/index.js');
  const byId = id => document.getElementById(id);
  const originalFetch = window.fetch;
  window.fetch = (url, opts) => String(url).startsWith('http://localhost:3001/api/')
    ? Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })) : originalFetch(url, opts);
  const originalUpdate = Car.prototype.update;
  let updates = 0;
  Car.prototype.update = function (...args) { updates++; return originalUpdate.apply(this, args); };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const geometry = () => JSON.stringify(state.trackPath);
  const motion = () => JSON.stringify(state.cars.map(car => [car.x, car.y, car.vx, car.vy, car.angle, car.tyreTemp, car.tyreWear, car.gear, car.currentLapTime, car.totalRaceTime]));
  try {
    await window.startGame();
    assert(state.racePhase === 'countdown' && state.cars.length === 20, '19 bots and player enter countdown');
    const initial = motion(), track = geometry(), cars = state.cars;
    state.keys.KeyW = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp' }));
    const observed = new Set([0]); const started = performance.now();
    while (state.racePhase === 'countdown' && performance.now() - started < 12000) {
      assert(motion() === initial, 'Grid stays frozen before lights out');
      observed.add(raceStart.lights);
      if (updates) throw new Error('Physics advanced during red lights');
      await frame();
    }
    // Compress repeated per-frame assertions in the report.
    assert(state.racePhase === 'racing', 'Lights out releases the race');
    assert([...observed].sort().join(',') === '0,1,2,3,4,5', 'All five sequential red stages were displayed');
    assert(raceStart.lights === 0 && document.querySelectorAll('.start-light-pair.lit').length === 0, 'All lights go dark together, without green');
    assert(state.cars.every(car => car.raceStartTime === raceStart.releasedAt && car.lapStartTime === raceStart.releasedAt), 'Every clock has the same lights-out epoch');
    assert(geometry() === track, 'Countdown leaves all track samples unchanged');
    const epoch = raceStart.releasedAt;
    await new Promise(r => setTimeout(r, 600));
    assert(updates > 0 && state.cars[0].getKmh() > 0, 'Player throttle only moves the car after release');
    assert(state.cars.filter(car => car.isBot).some(car => car.getKmh() > 0), 'Bots also move after release');
    assert(state.cars[0].totalRaceTime > 0 && state.cars[0].totalRaceTime < 1, 'Race time excludes the countdown');
    const countBefore = updates;
    await window.startGame();
    assert(state.cars === cars && raceStart.releasedAt === epoch, 'Repeated start while running does not create another race');
    await new Promise(r => setTimeout(r, 400));
    assert(updates - countBefore < 700, 'Only one fixed-step loop updates the grid');
    state.keys.KeyW = false;
    backToMenu(); const stopped = updates;
    await frame(); await frame();
    assert(updates === stopped && state.racePhase === 'idle' && byId('race-start').hidden, 'Returning to menu cancels the frame loop and gantry');
    await window.startGame();
    assert(raceStart.lights === 0 && state.racePhase === 'countdown', 'Restart has a fresh light sequence');
    backToMenu(); await frame();
    assert(!state.isRunning && raceStart.phase === 'idle', 'Cancelling countdown cannot release a stale race');
    assert(!mlTelemetry.enabled, 'No telemetry enabled by the local presentation test');
    return { passed: new Set(checks).size, checks: [...new Set(checks)] };
  } finally {
    state.keys = {};
    backToMenu(); window.fetch = originalFetch; Car.prototype.update = originalUpdate;
  }
})()
