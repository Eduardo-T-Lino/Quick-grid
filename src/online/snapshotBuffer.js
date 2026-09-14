// Presentation only: authoritative Cars/checkpoints never receive these poses.
// Keep a small time-ordered history instead of restarting a 50ms tween on arrival.
const STEP_MS = 1000 / 60;
const angleBetween = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export class SnapshotBuffer {
  constructor() { this.reset(); }
  reset() {
    this.frames = []; this.poses = new Map(); this.offset = null; this.lastSample = -Infinity;
    this.receivedAt = null; this.maxGapMs = 0; this.extrapolatedFrames = 0; this.sampleCount = 0;
    this.delayMs = 100; this.target = -Infinity;
  }
  push(snapshot, receivedAt) {
    const time = snapshot.serverTime;
    if (!Number.isFinite(time) || (this.frames.length && time <= this.frames.at(-1).time)) return false;
    if (this.receivedAt !== null) this.maxGapMs = Math.max(this.maxGapMs, receivedAt - this.receivedAt);
    this.receivedAt = receivedAt;
    // Minimum observed transit offset rejects late packets as clock corrections.
    this.offset = this.offset === null ? receivedAt - time : Math.min(this.offset, receivedAt - time);
    this.frames.push({ time, phase: snapshot.phase, cars: new Map(snapshot.cars.map(car => [car.id, car])) });
    if (this.frames.length > 32) this.frames.shift();
    return true;
  }
  sample(car, now) {
    if (!this.frames.length) return car;
    if (this.lastSample !== now) {
      this.lastSample = now; this.sampleCount++;
      this.target = Math.max(this.target, now - this.offset - this.delayMs);
      while (this.frames.length > 2 && this.frames[1].time <= this.target) this.frames.shift();
      this.a = this.frames[0]; this.b = this.frames[1] || this.a;
      if (this.target > this.b.time) this.extrapolatedFrames++;
    }
    const a = this.a.cars.get(car.id), b = this.b.cars.get(car.id);
    if (!a || !b) return car;
    let pose = this.poses.get(car.id);
    if (!pose) { pose = {}; this.poses.set(car.id, pose); }
    const dx = b.x - a.x, dy = b.y - a.y;
    // A true reset/teleport must never sweep through the circuit.
    if (dx * dx + dy * dy > 32 * 32) return b;
    const t = Math.max(0, Math.min(1, (this.target - this.a.time) / (this.b.time - this.a.time || 1)));
    pose.x = a.x + dx * t; pose.y = a.y + dy * t;
    pose.angle = a.angle + angleBetween(a.angle, b.angle) * t;
    pose.vx = a.vx + (b.vx - a.vx) * t; pose.vy = a.vy + (b.vy - a.vy) * t;
    // Bridge only brief underruns. Never invent ongoing motion during a disconnect.
    const extra = this.b.phase === 'racing' && !b.finished && !b.retired
      ? Math.max(0, Math.min(80, this.target - this.b.time)) / STEP_MS : 0;
    pose.x += b.vx * extra; pose.y += b.vy * extra;
    pose.angle += (b.yawRate || 0) * extra;
    return pose;
  }
  diagnostics(now) {
    return { bufferedSnapshots: this.frames.length, interpolationMs: this.delayMs,
      snapshotAgeMs: this.receivedAt === null ? null : Math.round(now - this.receivedAt),
      maxSnapshotGapMs: Math.round(this.maxGapMs), extrapolatedFrames: this.extrapolatedFrames, sampledFrames: this.sampleCount };
  }
}
