// Shared by vehicle placement and painted grid boxes. Track geometry is read-only.
export const GRID_LAYOUT = Object.freeze({ slots: 20, firstGap: 6, slotGap: 8, laneOffset: 4.5 });
const grids = new WeakMap();

export function getStartingGrid(trackPath, trackWidth = 24) {
  const cached = grids.get(trackPath);
  if (cached?.width === trackWidth) return cached.slots;
  const lane = Math.min(GRID_LAYOUT.laneOffset, Math.max(0, trackWidth / 2 - 2.5));
  const slots = Array.from({ length: GRID_LAYOUT.slots }, (_, index) => {
    let remaining = GRID_LAYOUT.firstGap + index * GRID_LAYOUT.slotGap;
    const distanceBehindStart = remaining;
    let sample = trackPath[0] || { x: 300, y: 300, z: 0 };
    let angle = sample.angle || 0;
    let pathIndex = 0;
    let x = sample.x - Math.cos(angle) * remaining;
    let y = sample.y - Math.sin(angle) * remaining;
    let z = sample.z || 0;
    // Walk actual segment lengths backwards from the finish line, not point counts.
    for (let i = trackPath.length - 1; i >= 0; i--) {
      const a = trackPath[i], b = trackPath[(i + 1) % trackPath.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-8) continue;
      if (remaining <= length) {
        const t = 1 - remaining / length;
        x = a.x + (b.x - a.x) * t;
        y = a.y + (b.y - a.y) * t;
        z = (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t;
        angle = Math.atan2(b.y - a.y, b.x - a.x);
        pathIndex = i;
        break;
      }
      remaining -= length;
    }
    const lateral = (index % 2 === 0 ? -1 : 1) * lane;
    return Object.freeze({ number: index + 1, x: x - Math.sin(angle) * lateral,
      y: y + Math.cos(angle) * lateral, z, angle, pathIndex, distanceBehindStart });
  });
  Object.freeze(slots);
  grids.set(trackPath, { width: trackWidth, slots });
  return slots;
}

export function drawGridSlot(ctx, slot) {
  ctx.save();
  ctx.translate(slot.x, slot.y);
  ctx.rotate(slot.angle);
  ctx.strokeStyle = 'rgba(255,255,255,0.90)';
  ctx.lineWidth = 0.22;
  // Open-backed box, with the front line ahead of the enlarged bodywork.
  ctx.beginPath();
  ctx.moveTo(-3.2, -1.65); ctx.lineTo(3.2, -1.65);
  ctx.lineTo(3.2, 1.65); ctx.lineTo(-3.2, 1.65);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 1.5px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(slot.number).padStart(2, '0'), 4.5, 0);
  ctx.restore();
}
