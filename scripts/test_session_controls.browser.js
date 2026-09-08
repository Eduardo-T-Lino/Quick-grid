// Run in a fresh local preview using agent-browser eval --stdin. API requests are mocked.
(async () => {
  // Use the exact module URL loaded by Vite, including its HMR version if present.
  const moduleUrl = path => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === path)?.name || path;
  const { state, startGame, pauseGame, resumeGame, backToMenu } = await import(moduleUrl('/src/game.js'));
  const { raceStart } = await import(moduleUrl('/src/raceStart.js'));
  const { mlTelemetry, onlineUploader } = await import(moduleUrl('/src/ml/telemetry/index.js'));
  const byId = id => document.getElementById(id);
  const checks = [], assert = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const originalFetch = window.fetch;
  window.fetch = (url, opts) => String(url).startsWith('http://localhost:3001/api/')
    ? Promise.resolve(new Response('{}', { status: 200 })) : originalFetch(url, opts);
  const key = code => { const target = document.activeElement; target.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'KeyR' ? 'r' : code, bubbles: true, cancelable: true })); };
  const motion = () => JSON.stringify(state.cars.map(c => [c.x, c.y, c.angle, c.vx, c.vy, c.gear, c.tyreTemp, c.currentLapTime, c.totalRaceTime]));
  const recordKey = 'cr_f1_t21_l3_best_lap_time', saved = localStorage.getItem(recordKey);
  try {
    assert(!onlineUploader.consentEnabled, 'Verification uses an isolated browser with online telemetry disabled');
    byId('gameMode-trigger').click();
    assert(!byId('gameMode-options').hidden, 'Styled dropdown opens');
    byId('gameMode-option-1').click();
    assert(byId('gameMode').value === 'ghost' && byId('botCount-trigger').disabled, 'Dropdown commits native value and disables ghost opponents');
    byId('gameMode-trigger').click(); byId('gameMode-option-0').click();
    assert(!byId('botCount-trigger').disabled, 'Race mode restores opponent controls');
    for (const [value, expected] of [['1', '3'], ['81', '80'], ['17', '17']]) {
      byId('lapCount').value = value; byId('lapCount').dispatchEvent(new Event('change', { bubbles: true }));
      assert(byId('lapCount').value === expected, `Lap input ${value} resolves to ${expected}`);
    }
    byId('lapCount').focus(); key('KeyR');
    assert(!byId('session-dialog').open, 'R while editing laps does not start a race');
    localStorage.setItem(recordKey, '84.251'); byId('tab-records').click();
    assert(byId('race-panel').hidden && !byId('records-panel').hidden, 'Records is a separate tab');
    assert(byId('records-rows').textContent.includes('01:24.251'), 'Existing local times render without needing a ghost path');
    byId('records-search').value = 'no-match-xyz'; byId('records-search').dispatchEvent(new Event('input'));
    assert(!byId('records-empty').hidden && byId('records-table').hidden, 'Records search has an empty state');
    byId('records-search').value = ''; byId('tab-race').click();
    byId('lapCount').value = '80';
    await startGame(); byId('gameCanvas').focus();
    assert(state.totalLaps === 80 && state.cars.length === 20, 'An 80-lap grid starts with 19 bots');
    const grid = motion(), delay = raceStart.nextAt - performance.now();
    key('Escape'); const pausedNextAt = raceStart.nextAt;
    assert(state.isPaused && byId('session-dialog').open, 'ESC pauses the countdown and opens the menu');
    await wait(350);
    assert(motion() === grid && raceStart.nextAt === pausedNextAt, 'All cars and start lights remain frozen during pause');
    byId('session-resume').click();
    assert(!state.isPaused && Math.abs(raceStart.nextAt - performance.now() - delay) < 100, 'Resume retains remaining start-light delay');
    raceStart.lights = 5; raceStart.nextAt = performance.now() - 1;
    await wait(100); state.keys.KeyW = true; await wait(350);
    assert(state.racePhase === 'racing' && state.cars[0].getKmh() > 0, 'Throttle works after lights out');
    mlTelemetry.start({ scope: 'PLAYER_ONLY' });
    await wait(250);
    assert(mlTelemetry.session.stats.totalSamples > 0, 'Local telemetry is sampling before pause');
    state.startFinishTimer();
    key('Escape'); const frozen = motion(), deadline = state.finishDeadline, raceTime = state.cars[0].totalRaceTime;
    const samples = mlTelemetry.session.stats.totalSamples;
    await wait(1100);
    assert(motion() === frozen && mlTelemetry.session.stats.totalSamples === samples, 'Pause freezes every car, lap clock and telemetry sampling');
    assert(state.timerSeconds === 45, 'Finish timeout does not count paused seconds');
    window.dispatchEvent(new Event('resize'));
    assert(motion() === frozen && state.isPaused, 'Resizing a paused race repaints without advancing simulation');
    const pixel = byId('gameCanvas').getContext('2d').getImageData(100, 100, 1, 1).data;
    assert(pixel[3] === 255, 'Paused resize preserves the rendered track instead of clearing it');
    byId('session-resume').click(); await wait(100);
    assert(state.finishDeadline > deadline + 1000, 'Finish deadline excludes pause duration');
    assert(state.cars[0].totalRaceTime - raceTime < .3, 'Lap and race clocks resume without adding the pause');
    assert(mlTelemetry.session.stats.totalSamples <= samples + 2, 'Telemetry resumes without a catch-up sample burst');
    assert(!state.keys.KeyW, 'Resume clears held pedals');
    key('KeyR');
    assert(state.isPaused && !byId('session-confirm').hidden, 'R opens restart confirmation and pauses the race');
    byId('session-cancel').click();
    assert(!state.isPaused, 'Cancelling R returns to the running race');
    key('Escape'); byId('session-restart').click(); byId('session-cancel').click();
    assert(state.isPaused && !byId('session-resume').hidden, 'Cancelling restart from pause returns to pause');
    byId('session-restart').click();
    const oldCars = state.cars;
    byId('session-confirm').click(); await wait(200);
    assert(state.cars !== oldCars && state.totalLaps === 80 && state.cars.length === 20 && state.racePhase === 'countdown', 'Confirm restart rebuilds the same 80-lap grid with fresh lights');
    assert(state.cars.every(c => c.currentLap === 1 && c.totalRaceTime === 0), 'Restart clears race progress');
    assert(localStorage.getItem(recordKey) === '84.251', 'Restart preserves saved records');
    pauseGame(); pauseGame(); resumeGame(); resumeGame();
    backToMenu(); await wait(50);
    assert(!state.isRunning && !state.isPaused && !byId('session-dialog').open && byId('race-shortcuts').hidden, 'Menu exit clears pause and race-only controls');
    assert(!mlTelemetry.enabled, 'Browser check did not enable online telemetry');
    byId('gameMode').value = 'ghost';
    byId('lapCount').value = '3';
    await startGame();
    raceStart.lights = 5; raceStart.nextAt = performance.now() - 1;
    await wait(60);
    const player = state.cars[0];
    state.bestLapPath = [{ x: player.x, y: player.y, a: player.angle }, { x: player.x + 1, y: player.y, a: player.angle }];
    state.bestRacePath = [...state.bestLapPath];
    pauseGame();
    const ghostLap = state.ghostLapFrameIndex, ghostRace = state.ghostRaceFrameIndex;
    window.dispatchEvent(new Event('resize'));
    assert(state.cars.length === 1 && state.ghostLapFrameIndex === ghostLap && state.ghostRaceFrameIndex === ghostRace, 'Paused ghost mode repaint preserves replay progress');
    resumeGame(); await wait(60);
    assert(state.ghostRaceFrameIndex > ghostRace, 'Ghost replay resumes with the race');
    return { passed: checks.length, checks };
  } finally {
    backToMenu(); window.fetch = originalFetch;
    saved === null ? localStorage.removeItem(recordKey) : localStorage.setItem(recordKey, saved);
    byId('lapCount').value = '3'; byId('lapCount').dispatchEvent(new Event('change', { bubbles: true }));
    byId('gameMode').value = 'race'; byId('gameMode').dispatchEvent(new Event('change', { bubbles: true }));
  }
})()
