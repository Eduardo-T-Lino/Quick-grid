export const MIN_LAPS = 3;
export const MAX_LAPS = 80;
export function normalizeBots(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(1, Math.min(19, Math.trunc(count))) : 19;
}

export function normalizeLaps(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(MIN_LAPS, Math.min(MAX_LAPS, Math.trunc(number))) : MIN_LAPS;
}

// Keyboard steering builds more deliberately with speed, with full low-speed lock.
// Return-to-centre remains quick enough for corrections and opposite-lock recovery.
export function playerSteering(current, target, speedRatio) {
  const speed = Math.max(0, Math.min(1, speedRatio));
  if (!target) {
    const next = current * 0.88;
    return Math.abs(next) < 0.01 ? 0 : next;
  }
  const lock = 1 - 0.12 * speed;
  return current + (target * lock - current) * (0.085 - 0.025 * speed);
}

// Rebase wall-clock epochs once on resume; elapsed race/lap time never includes a pause.
export function excludePauseTime(state, sequence, collector, elapsed) {
  for (const car of state.cars) {
    if (!car.finished) {
      if (car.raceStartTime > 0) car.raceStartTime += elapsed;
      if (car.lapStartTime > 0) car.lapStartTime += elapsed;
    }
    if (car.brain?.sectorEntryTime > 0) car.brain.sectorEntryTime += elapsed;
  }
  if (Number.isFinite(sequence.nextAt)) sequence.nextAt += elapsed;
  if (sequence.releasedAt !== null) sequence.releasedAt += elapsed;
  if (state.finishDeadline) state.finishDeadline += elapsed;
  if (collector.lastSampleTime > 0) collector.lastSampleTime += elapsed;
  for (const tracker of collector.session?.activeLapTrackers?.values() || []) tracker.startTime += elapsed;
}
