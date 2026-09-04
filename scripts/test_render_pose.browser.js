// Run via agent-browser eval --stdin on a fresh local Vite page.
// Local legacy API fixtures only: no uploads, cloud requests or saved bot training.
(async () => {
  const { state, backToMenu } = await import('/src/game.js');
  const { Car } = await import('/src/car.js');
  const { mainCamera } = await import('/src/camera.js');
  const { mlTelemetry } = await import('/src/ml/telemetry/index.js');
  const originalFetch = window.fetch, originalUpdate = Car.prototype.update, originalDraw = Car.prototype.draw;
  const originalRAF = window.requestAnimationFrame;
  // Deterministically exercise the measured 0/2-tick boundary. A perfectly
  // phased 60 Hz run may never naturally hit it. This changes test timestamps
  // by +/- 0.5 ms only; it does not add callbacks or change production code.
  let lastTimestamp, jitter = -.5;
  window.requestAnimationFrame = callback => originalRAF.call(window, timestamp => {
    if (timestamp !== lastTimestamp) { lastTimestamp = timestamp; jitter = -jitter; }
    callback(timestamp + jitter);
  });
  window.fetch = (url, opts) => String(url).startsWith('http://localhost:3001/api/')
    ? Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })) : originalFetch(url, opts);
  const checks = [], assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const fields = c => JSON.stringify([c.x, c.y, c.vx, c.vy, c.angle, c.yawRate, c.gear, c.rpm, c.tyreTemp, c.tyreWear, c.currentLapTime, c.totalRaceTime]);
  let ticks = 0, playerPose, preserved = true, cameraAligned = true;
  const drawnBots = new Set(), updatedBots = new Set();
  Car.prototype.update = function (...args) {
    if (!this.isBot) ticks++; else updatedBots.add(this);
    return originalUpdate.apply(this, args);
  };
  Car.prototype.draw = function (pose) {
    const before = fields(this);
    originalDraw.call(this, pose);
    preserved &&= fields(this) === before;
    if (this.isBot) drawnBots.add(this);
    else {
      playerPose = { x: pose.x, y: pose.y };
      const ahead = Math.min(1, Math.hypot(pose.vx, pose.vy) / 1.65) * mainCamera.lookaheadDist * .45;
      cameraAligned &&= Math.abs(mainCamera.targetX - (pose.x + Math.cos(pose.angle) * ahead)) < 1e-9;
      cameraAligned &&= Math.abs(mainCamera.targetY - (pose.y + Math.sin(pose.angle) * ahead)) < 1e-9;
    }
  };
  const next = () => new Promise(requestAnimationFrame);
  try {
    document.getElementById('gameMode').value = 'race';
    document.getElementById('botCount').value = '19';
    document.getElementById('transMode').value = 'manual';
    await window.startGame(); state.keys.KeyW = true;
    while (state.racePhase === 'countdown') await next();
    const track = JSON.stringify(state.trackPath), start = performance.now();
    let previous = await next(), previousTicks = ticks, previousPose = playerPose;
    let zeroTickMovingFrames = 0, visuallyRepeatedFrames = 0, checkedFrames = 0;
    while (performance.now() - start < 4000) {
      const now = await next();
      if (now - previous < 25 && ticks === previousTicks && state.cars[0].getKmh() > 50) {
        zeroTickMovingFrames++;
        if (Math.hypot(playerPose.x - previousPose.x, playerPose.y - previousPose.y) < 1e-7) visuallyRepeatedFrames++;
      }
      previous = now; previousTicks = ticks; previousPose = playerPose; checkedFrames++;
    }
    assert(checkedFrames > 100, 'Actual racing frames were observed, not just countdown');
    assert(zeroTickMovingFrames > 0, 'RAF jitter test exercised high-speed frames without a new physics tick');
    assert(visuallyRepeatedFrames === 0, 'Car artwork advances on every observed zero-tick high-speed frame');
    assert(preserved, 'All drawing calls preserve authoritative vehicle fields');
    assert(cameraAligned, 'Camera follows the same interpolated pose as the player artwork');
    assert(updatedBots.size === 19 && drawnBots.size > 0, 'All nineteen bots keep simulating and visible bots keep drawing');
    assert(JSON.stringify(state.trackPath) === track, 'Rendering does not change track samples');
    assert(!mlTelemetry.enabled, 'The local visual test enables no telemetry');
    return { passed: checks.length, simulatedTimestampJitterMs: .5, checkedFrames, zeroTickMovingFrames, visuallyRepeatedFrames,
      simulatedBots: updatedBots.size, drawnBots: drawnBots.size, checks };
  } finally {
    state.keys.KeyW = false; backToMenu(); window.fetch = originalFetch;
    Car.prototype.update = originalUpdate; Car.prototype.draw = originalDraw;
    window.requestAnimationFrame = originalRAF;
  }
})()
