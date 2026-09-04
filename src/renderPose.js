// Presentation-only snapshots. Never write interpolated values back to a Car.
// The simulation keeps its fixed 60 Hz step, inputs, collisions and telemetry.
const TAU = Math.PI * 2;
const TELEPORT_DISTANCE_SQUARED = 16 * 16;

export class RenderPoseBuffer {
  constructor() { this.reset(); }
  reset() { this.snapshots = new WeakMap(); }

  capture(car) {
    let snapshot = this.snapshots.get(car);
    if (!snapshot) {
      snapshot = { previous: {}, pose: {} };
      this.snapshots.set(car, snapshot);
    }
    const previous = snapshot.previous;
    previous.x = car.x; previous.y = car.y; previous.angle = car.angle;
    previous.vx = car.vx; previous.vy = car.vy;
  }

  sample(car, alpha) {
    if (!car) return car;
    const snapshot = this.snapshots.get(car);
    if (!snapshot) return car; // grid/countdown, before the first physics tick
    const { previous, pose } = snapshot;
    const dx = car.x - previous.x, dy = car.y - previous.y;
    // Reset/teleport must snap instead of drawing a sweep across the circuit.
    if (dx * dx + dy * dy > TELEPORT_DISTANCE_SQUARED) return car;
    const t = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    let angleDelta = car.angle - previous.angle;
    if (angleDelta < -Math.PI || angleDelta > Math.PI) {
      angleDelta = ((angleDelta + Math.PI) % TAU + TAU) % TAU - Math.PI;
    }
    pose.x = previous.x + dx * t; pose.y = previous.y + dy * t;
    pose.angle = previous.angle + angleDelta * t;
    pose.vx = previous.vx + (car.vx - previous.vx) * t;
    pose.vy = previous.vy + (car.vy - previous.vy) * t;
    return pose;
  }
}

export const renderPoses = new RenderPoseBuffer();
