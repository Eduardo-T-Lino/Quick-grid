// Five red pairs, one second apart; lights OUT release the grid (never green).
// The variable final hold is a game presentation choice, not a new driving rule.
export class RaceStartSequence {
  constructor() { this.reset(); }
  reset() { this.phase = 'idle'; this.lights = 0; this.nextAt = Infinity; this.releasedAt = null; }
  begin(now, holdMs = chooseStartHold()) {
    this.phase = 'countdown'; this.lights = 0;
    this.holdMs = Math.max(200, Math.min(3000, holdMs));
    this.nextAt = now + 1000; this.releasedAt = null;
  }
  update(now) {
    if (this.phase !== 'countdown' || now < this.nextAt) return false;
    // One transition per presented frame: a stalled/hidden tab cannot skip the five lights.
    if (this.lights < 5) {
      this.lights++;
      this.nextAt = now + (this.lights === 5 ? this.holdMs : 1000);
      return false;
    }
    this.lights = 0; this.phase = 'racing'; this.releasedAt = now;
    return true;
  }
}

function chooseStartHold() {
  // Separate from Math.random: the presentation must not consume the bots' random stream.
  const value = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(value);
  else value[0] = Math.floor(performance.now() * 1000);
  return 200 + (value[0] % 2801);
}

export const raceStart = new RaceStartSequence();
let lastDisplay = '';
export function renderStartLights(sequence = raceStart, now = performance.now()) {
  const element = document.getElementById('race-start');
  if (!element) return;
  const visible = sequence.phase === 'countdown' || (sequence.phase === 'racing' && now - sequence.releasedAt < 1200);
  const key = `${visible}/${sequence.phase}/${sequence.lights}`;
  if (key === lastDisplay) return;
  lastDisplay = key;
  element.hidden = !visible;
  element.dataset.phase = sequence.phase;
  element.querySelectorAll('.start-light-pair').forEach((pair, index) => pair.classList.toggle('lit', index < sequence.lights));
  document.getElementById('race-start-status').textContent = sequence.phase === 'racing'
    ? 'LUZES APAGADAS. VAMOS CORRER.' : sequence.lights === 0 ? 'GRID FORMADO. AGUARDE AS LUZES.' : 'LARGUE QUANDO AS LUZES APAGAREM.';
}
