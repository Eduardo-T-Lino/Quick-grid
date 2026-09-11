// Gameplay wake: drag/downforce loss plus a bounded, gradually unlocked speed allowance.
export const WAKE_TUNING = Object.freeze({ range: 70, nearFade: 3, minGap: 3,
  halfWidth: 2.8, spread: 0.025, minSpeed: 0.25, fullSpeed: 0.9,
  headingAlignment: 0.8, maxHeightGap: 3, dragLoss: 0.55, downforceLoss: 0.40, response: 0.12,
  accelerationGain: 0.18, extraSpeedKmh: 30, unlockKmhPerSecond: 2 });
const clamp = value => Math.max(0, Math.min(1, value));

export function wakeInfluence(follower, leader) {
  if (follower === leader || follower.finished || leader.finished) return 0;
  const t = WAKE_TUNING;
  if (Math.abs((follower.z || 0) - (leader.z || 0)) > t.maxHeightGap) return 0;
  const fx = Math.cos(follower.angle), fy = Math.sin(follower.angle);
  const lx = Math.cos(leader.angle), ly = Math.sin(leader.angle);
  if (fx * lx + fy * ly < t.headingAlignment) return 0;
  const speed = Math.min(follower.vx * fx + follower.vy * fy, leader.vx * lx + leader.vy * ly);
  if (speed <= t.minSpeed) return 0;
  const dx = leader.x - follower.x, dy = leader.y - follower.y;
  const gap = dx * lx + dy * ly;
  if (gap <= t.minGap || gap >= t.range) return 0;
  const lateral = Math.abs(dx * -ly + dy * lx);
  const width = t.halfWidth + gap * t.spread;
  if (lateral >= width) return 0;
  return clamp((1 - gap / t.range) * (1 - (lateral / width) ** 2)
    * clamp((gap - t.minGap) / t.nearFade) * clamp((speed - t.minSpeed) / (t.fullSpeed - t.minSpeed)));
}

// Run once before integrating any car, so array order does not alter the wake.
export function updateAerodynamicWake(cars) {
  for (const car of cars) {
    let target = 0;
    for (const leader of cars) target = Math.max(target, wakeInfluence(car, leader));
    car.wakeIntensity = car.finished ? 0 : clamp((car.wakeIntensity || 0) + (target - (car.wakeIntensity || 0)) * WAKE_TUNING.response);
  }
}

export function aerodynamicFactors(intensity = 0) {
  const wake = clamp(Number.isFinite(intensity) ? intensity : 0);
  return { drag: 1 - wake * WAKE_TUNING.dragLoss, downforce: 1 - wake * WAKE_TUNING.downforceLoss };
}
