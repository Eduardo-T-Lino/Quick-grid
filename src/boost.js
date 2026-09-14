// Fixed-step, rechargeable player power assist. Never bypasses tyres or speed cap.
export const BOOST_TUNING = Object.freeze({ duration: 3, recharge: 12, delay: 2, minCharge: 0.2, power: 2.1, maxSpeedKmh: 400,
  coastAeroFactor: 0.15, coastRollingDrag: 0.9997, coastBlendKmh: 20 });

export function updateBoost(car, requested, eligible, enabled, dt = 1 / 60) {
  if (!enabled) { car.boostActive = false; return; }
  const wasActive = car.boostActive;
  car.boostActive = Boolean(requested && eligible && !car.boostNeedsRelease
    && car.boostCharge > 1e-9 && (wasActive || car.boostCharge >= BOOST_TUNING.minCharge));
  if (car.boostActive) {
    car.boostCharge = Math.max(0, car.boostCharge - dt / BOOST_TUNING.duration);
    car.boostCooldown = BOOST_TUNING.delay;
    if (car.boostCharge <= 1e-9) { car.boostCharge = 0; car.boostNeedsRelease = true; }
  } else if (!requested) {
    car.boostNeedsRelease = false;
    const rechargeTime = Math.max(0, dt - car.boostCooldown);
    car.boostCooldown = Math.max(0, car.boostCooldown - dt);
    car.boostCharge = Math.min(1, car.boostCharge + rechargeTime / BOOST_TUNING.recharge);
  }
}
