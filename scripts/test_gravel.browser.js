// Real generated Interlagos geometry + real projection/Car.update, no lap persistence.
(async () => {
  const url = path => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === path)?.name || path;
  const { state } = await import(url('/src/game.js'));
  const { Car } = await import(url('/src/car.js'));
  const { generateTrackPath } = await import(url('/src/track.js'));
  const { onlineUploader, mlTelemetry } = await import(url('/src/ml/telemetry/index.js'));
  if (state.isRunning || onlineUploader.consentEnabled || mlTelemetry.enabled) throw Error('Use idle isolated page, telemetry OFF');
  const saved = { ...state }, results = [];
  try {
    for (const condition of ['dry', 'wet']) {
      generateTrackPath(21);
      Object.assign(state, { trackCondition: condition, racePhase: 'racing', isPaused: false,
        keys: {}, cars: [], particles: [], skidMarks: [], floatingNotices: [], gameMode: 'race' });
      const point = state.trackPath[0];
      const car = new Car('#ff3333', 'Gravel fixture', false, 0, true);
      Object.assign(car, { x: point.x + point.normalX * 20, y: point.y + point.normalY * 20,
        angle: point.angle, pathIndex: 0, tyreTemp: condition === 'wet' ? 62 : 92 });
      car.updateCheckpoints = () => {};
      state.cars = [car];
      let gravelSeen = false, ticks = 0;
      for (; ticks < 900; ticks++) {
        const turn = Math.atan2(Math.sin(car.angle - point.angle), Math.cos(car.angle - point.angle));
        state.keys = { KeyW: true, KeyA: turn > -1.1 };
        car.update();
        gravelSeen ||= car.currentSurface === 'GRAVEL';
        if (gravelSeen && car.currentSurface === 'TARMAC') break;
        if (ticks % 60 === 0) { state.particles.length = 0; state.skidMarks.length = 0; }
      }
      if (!gravelSeen || car.currentSurface !== 'TARMAC') throw Error(`Cannot escape real ${condition} gravel: ${car.currentSurface}`);
      results.push({ condition, secondsToAsphalt: (ticks + 1) / 60, finalSurface: car.currentSurface });
    }
    return { passed: results.length, results };
  } finally { Object.assign(state, saved); }
})()
