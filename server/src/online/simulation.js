import { state, handleCarCollisions } from '../../../src/game.js';
import { Car } from '../../../src/car.js';
import { generateTrackPath } from '../../../src/track.js';
import { updateAerodynamicWake } from '../../../src/aerodynamics.js';
import { CAR_FIELDS } from '../../../src/online/protocol.js';

// The legacy physics uses a shared state object. Each synchronous room tick installs
// its own context and restores the previous one in finally. Never await in this scope.
export class OnlineSimulation {
  constructor(trackId, laps, weather, players) {
    this.context = { ...state, selectedTrack: trackId, totalLaps: laps, trackCondition: weather,
      gameMode: 'online', racePhase: 'countdown', isPaused: false, keys: {}, cars: [],
      particles: [], skidMarks: [], floatingNotices: [], finishedCarsOrder: [],
      currentLapPath: [], currentRacePath: [], bestLapTime: null, bestRaceTime: null,
      firstFinishedCar: false, onPlayerLapCompleted() {}, startFinishTimer: () => { this.finishAt ||= performance.now() + 45000; } };
    this.withContext(() => {
      generateTrackPath(trackId);
      state.cars = players.map((p, slot) => {
        const car = new Car(p.color, p.name, false, slot, p.auto);
        car.id = p.id; return car;
      });
    });
  }
  withContext(fn) {
    const previous = { ...state };
    Object.assign(state, this.context);
    try { return fn(); }
    finally { Object.assign(this.context, state); Object.assign(state, previous); }
  }
  start(now) {
    this.context.racePhase = 'racing'; this.startedAt = now;
    for (const car of this.context.cars) { car.raceStartTime = now; car.lapStartTime = now; }
  }
  tick(players, now) {
    this.withContext(() => {
      updateAerodynamicWake(state.cars);
      for (const car of state.cars) {
        const player = players.find(p => p.id === car.id);
        // A stale or disconnected driver releases throttle and applies brakes.
        const liveInput = player?.connected && now - player.inputAt < 500;
        const forward = car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
        state.keys = liveInput ? player.keys : forward > .02 ? { KeyS: true } : forward < -.02 ? { KeyW: true } : {};
        if (!liveInput && Math.hypot(car.vx, car.vy) < .025) { car.vx = 0; car.vy = 0; car.aceleracao_atual = 0; }
        if (car.retired) continue;
        if (player?.shift) { if (!car.isAuto) player.shift > 0 ? car.shiftUp() : car.shiftDown(); player.shift = 0; }
        car.update();
      }
      handleCarCollisions();
      const ordered = [...state.cars].sort((a, b) => {
        const af = state.finishedCarsOrder.indexOf(a), bf = state.finishedCarsOrder.indexOf(b);
        if (af >= 0 || bf >= 0) return af < 0 ? 1 : bf < 0 ? -1 : af - bf;
        if (a.retired !== b.retired) return a.retired ? 1 : -1;
        return b.progress - a.progress;
      });
      ordered.forEach((car, i) => car.rank = i + 1);
      state.particles.length = 0; state.skidMarks.length = 0; state.floatingNotices.length = 0;
    });
    return this.context.cars.every(c => c.finished || c.retired) || now >= (this.finishAt || Infinity)
      || now - this.startedAt > 90 * 60 * 1000;
  }
  retire(id) {
    const car = this.context.cars.find(c => c.id === id);
    if (car && !car.finished) { car.retired = true; car.vx = 0; car.vy = 0; car.boostActive = false; }
  }
  snapshot() {
    return this.context.cars.map(car => ({ id: car.id, ...Object.fromEntries(CAR_FIELDS.map(key => [key, car[key]])), retired: Boolean(car.retired) }));
  }
  results() {
    return [...this.context.cars].sort((a, b) => a.rank - b.rank).map(c => ({ id: c.id, name: c.name,
      finished: c.finished, time: c.finished ? c.totalRaceTime : null, rank: c.rank }));
  }
}
