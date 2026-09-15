// Presentation only: analyze the existing metric centerline, never its speed profile.
const cache = new WeakMap();
const wrap = (d, length) => ((d % length) + length) % length;
const delta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const BOARD_DISTANCES = Object.freeze([300, 250, 200, 150, 100, 50]);

export function sampleTrackDistance(path, distance) {
  const last = path.at(-1), length = last.cumulativeDistance + last.segmentLength;
  const d = wrap(distance, length);
  let lo = 0, hi = path.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (path[mid].cumulativeDistance <= d) lo = mid; else hi = mid - 1; }
  const a = path[lo], b = path[(lo + 1) % path.length], t = (d - a.cumulativeDistance) / a.segmentLength;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle, distance: d };
}

export function getBrakingBoards(path, width = 24) {
  if (!path?.length) return [];
  if (cache.get(path)?.width === width) return cache.get(path).boards;
  const last = path.at(-1), length = last.cumulativeDistance + last.segmentLength;
  if (!Number.isFinite(length) || length < 400) return [];
  const count = Math.ceil(length / 5), step = length / count;
  // Thirty-metre heading window rejects small spline wiggles and finds bend entries.
  const turns = Array.from({ length: count }, (_, i) => delta(sampleTrackDistance(path, i * step + 15).angle, sampleTrackDistance(path, i * step - 15).angle) / 30);
  const active = turns.map(turn => Math.abs(turn) > .003);
  const start = active.findIndex(value => !value), curves = [];
  if (start < 0) { cache.set(path, { width, boards: [] }); return []; }
  let run = null;
  for (let offset = 1; offset <= count; offset++) {
    const i = (start + offset) % count;
    if (active[i]) {
      run ||= { entry: wrap(i * step - 15, length), signed: 0, total: 0 };
      run.signed += turns[i] * step; run.total += Math.abs(turns[i]) * step;
    } else if (run) {
      if (run.total >= .3) curves.push({ entry: run.entry, direction: Math.sign(run.signed) || 1 });
      run = null;
    }
  }
  // Start after the largest approach gap, including curves straddling the finish line.
  curves.sort((a, b) => a.entry - b.entry);
  let first = 0, largest = -1;
  for (let i = 0; i < curves.length; i++) {
    const gap = wrap(curves[i].entry - curves[(i - 1 + curves.length) % curves.length].entry, length);
    if (gap > largest) { largest = gap; first = i; }
  }
  const groups = [];
  for (let i = 0; i < curves.length; i++) {
    const curve = curves[(first + i) % curves.length];
    // A close sequence of bends shares the warning for its first corner.
    if (!groups.length || wrap(curve.entry - groups.at(-1).entry, length) >= 350) groups.push(curve);
  }
  if (groups.length > 1 && wrap(groups[0].entry - groups.at(-1).entry, length) < 350) groups.pop();
  const boards = groups.flatMap((curve, group) => BOARD_DISTANCES.map(metres => {
    const pose = sampleTrackDistance(path, curve.entry - metres), offset = -(width / 2 + 5) * curve.direction;
    return Object.freeze({ ...pose, x: pose.x - Math.sin(pose.angle) * offset, y: pose.y + Math.cos(pose.angle) * offset,
      metres, entry: curve.entry, direction: curve.direction, group });
  }));
  Object.freeze(boards); cache.set(path, { width, boards }); return boards;
}

export function drawBrakingBoard(ctx, board) {
  ctx.save(); ctx.translate(board.x, board.y); ctx.rotate(board.angle + Math.PI / 2);
  ctx.fillStyle = '#080d16'; ctx.fillRect(-2.6, -2.4, 5.2, 4.8);
  ctx.fillStyle = '#f7f6eb'; ctx.fillRect(-2.4, -2.2, 4.8, 4.4);
  ctx.fillStyle = '#172135'; ctx.font = '900 2px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(String(board.metres), 0, -.15);
  ctx.fillStyle = '#c82c2b'; ctx.font = 'bold 1.6px sans-serif';
  ctx.fillText(board.direction > 0 ? '→' : '←', 0, 1.55);
  ctx.restore();
}
