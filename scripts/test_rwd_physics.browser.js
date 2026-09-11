// Local isolated browser only. Executes the actual Car.update on a flat fixture;
// no API, recorded lap, online telemetry or changes to production track geometry.
(async () => {
  const url = path => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === path)?.name || path;
  const { state } = await import(url('/src/game.js'));
  const { Car } = await import(url('/src/car.js'));
  const { onlineUploader, mlTelemetry } = await import(url('/src/ml/telemetry/index.js'));
  if (state.isRunning || onlineUploader.consentEnabled || mlTelemetry.enabled) throw Error('Use idle isolated page with telemetry OFF');
  const saved = { ...state };
  const checks = [];
  const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const path = Array.from({ length: 100 }, (_, i) => ({ x: i * 10, y: 0, z: 0,
    normalX: 0, normalY: 1, angle: 0, slope: 0, curvature: 0,
    cumulativeDistance: i * 10, segmentLength: 10, targetSpeed: 1.35 }));
  function run({ wet = false, initialSpeed = 0, steer = 0, throttle = true, ticks = 600, recoverAt = Infinity, side = 1, bot = false, initialYaw = 0, initialSlip = 0, wake = 0, initialSteer = 0, boost = false } = {}) {
    Object.assign(state, { trackPath: path, totalTrackLength: 1000,
      selectedTrackData: { trackWidth: 1000000, escapeType: 'gravel_asphalt' },
      trackCondition: wet ? 'wet' : 'dry', keys: {}, cars: [], particles: [], skidMarks: [], floatingNotices: [], gameMode: 'race', racePhase: 'racing', isPaused: false });
    const car = new Car('#ff3333', 'RWD fixture', bot, 0, true);
    Object.assign(car, { x: 0, y: 0, angle: 0, vx: initialSpeed, vy: 0,
      tyreTemp: wet ? 62 : 92, yawRate: initialYaw, rearSlip: initialSlip, wakeIntensity: wake, steerAmount: initialSteer,
      gear: initialSpeed > 0.96 ? 6 : initialSpeed > 0.76 ? 5 : initialSpeed > 0.57 ? 4 : 3 });
    if (bot) car.brain.computeInputs = () => ({ throttleInput: throttle ? 1 : 0, brakeInput: 0, steerInput: 0 });
    if (!initialSpeed) car.gear = 1;
    car.getTrackDistanceAndSegment = () => ({ lateralDist: 0, closestIdx: 0, segmentIdx: 0, segmentT: 0 });
    car.updateCheckpoints = () => {}; // Avoid lap persistence on the synthetic track.
    state.cars = [car];
    let maxSlip = 0, maxAngle = 0, maxKmh = 0, t100 = null;
    for (let tick = 0; tick < ticks; tick++) {
      const recovering = tick >= recoverAt;
      state.keys = { KeyW: throttle && !recovering, Space: boost,
        KeyD: steer !== 0 && !recovering && side > 0, KeyA: steer !== 0 && !recovering && side < 0 };
      if (recovering) {
        // Countersteer opposite the rear slide, then centre as it subsides.
        const slip = Math.atan2(-car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle),
          car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle));
        state.keys.KeyD = slip > 0.025; state.keys.KeyA = slip < -0.025;
      }
      car.update();
      const fwd = car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
      const lat = -car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle);
      maxSlip = Math.max(maxSlip, car.rearSlip);
      maxAngle = Math.max(maxAngle, Math.abs(Math.atan2(lat, fwd)));
      maxKmh = Math.max(maxKmh, car.getKmh());
      if (t100 === null && car.getKmh() >= 100) t100 = (tick + 1) / 60;
      if (![car.vx, car.vy, car.yawRate, car.angle, car.rearSlip].every(Number.isFinite)) throw Error('Non-finite physics');
      if (Math.abs(car.yawRate) > 0.100000001 || car.rearSlip > 1.500000001) throw Error('Unbounded spin');
      if (tick % 60 === 0) { state.particles.length = 0; state.skidMarks.length = 0; }
    }
    return { maxSlip, maxAngle, maxKmh, t100, finalSlip: car.rearSlip, finalKmh: car.getKmh(), finalSpeed: Math.hypot(car.vx, car.vy), finalYaw: car.yawRate, finalAngle: car.angle };
  }
  try {
    const straight = run({ ticks: 3600 });
    const boosted = run({ initialSpeed: 1.5, ticks: 180, boost: true });
    assert(boosted.maxKmh > 390 && boosted.maxKmh <= 400, 'Boost exceeds the normal limit and respects its own 400 km/h ceiling');
    const right = run({ initialSpeed: 1.1, steer: 1, wet: true, ticks: 180 });
    const left = run({ initialSpeed: 1.1, steer: 1, wet: true, ticks: 180, side: -1 });
    const dry = run({ initialSpeed: 1.1, steer: 1, ticks: 180 });
    const recovery = run({ initialSpeed: 1.1, steer: 1, wet: true, ticks: 600, recoverAt: 35 });
    const stopped = run({ initialYaw: 0.1, initialSlip: 1.5, throttle: false });
    const botStraight = run({ bot: true, ticks: 3600 });
    const cleanAcceleration = run({ initialSpeed: 0.7, ticks: 30 });
    const wakeAcceleration = run({ initialSpeed: 0.7, ticks: 30, wake: 1 });
    const cleanCorner = run({ initialSpeed: 1.05, steer: 1, initialSteer: 0.85, ticks: 1 });
    const wakeCorner = run({ initialSpeed: 1.05, steer: 1, initialSteer: 0.85, ticks: 1, wake: 1 });
    assert(straight.maxKmh <= 320 && straight.maxKmh >= 315, 'Actual car reaches the new 320 km/h speed range');
    assert(straight.maxAngle === 0 && straight.maxSlip === 0, 'Straight-line throttle does not create an arbitrary spin');
    assert(right.maxSlip > 0.1 && right.maxAngle > Math.PI / 2, 'Overloaded rear axle can spin beyond 90 degrees of sideslip');
    assert(Math.abs(right.finalAngle + left.finalAngle) < 1e-9, 'Left/right response remains symmetric');
    assert(recovery.finalSlip < 0.01 && Math.abs(recovery.finalYaw) < 0.01, 'Lift and countersteer allow grip and yaw recovery');
    assert(stopped.finalYaw === 0 && stopped.finalKmh === 0, 'A stopped car cannot sustain a self-powered spin');
    assert(botStraight.maxKmh === straight.maxKmh && botStraight.t100 === straight.t100, 'Bots and player share restored engine performance');
    assert(straight.t100 < 1.65, 'Part of the acceleration removed in the prior revision is restored');
    assert(wakeAcceleration.finalSpeed > cleanAcceleration.finalSpeed, 'Reduced wake drag increases actual straight-line acceleration');
    assert(wakeCorner.finalSlip > cleanCorner.finalSlip, 'Lost aerodynamic load increases actual rear slip in the same corner');
    return { passed: checks.length, checks, straight, boosted, dry, right, recovery, cleanCorner, wakeCorner };
  } finally { Object.assign(state, saved); }
})()
