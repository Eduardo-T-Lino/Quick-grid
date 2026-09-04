// Render-only caches: never modify the track samples used by physics or AI.
const trackPaths = new WeakMap();
const visibleTracks = new WeakMap();
const CHUNK_SEGMENTS = 32;

// Each chunk includes both ends of every segment (including the closing segment).
// Bounding boxes therefore retain lines crossing the viewport even when both ends
// are outside it. These are render indices only, not a simplified physical track.
function getTrackChunks(points) {
  let cached = visibleTracks.get(points);
  if (cached) return cached;
  const chunks = [];
  for (let start = 0; start < points.length; start += CHUNK_SEGMENTS) {
    const end = Math.min(start + CHUNK_SEGMENTS, points.length);
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let i = start; i <= end; i++) {
      const point = points[i % points.length];
      bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y);
    }
    chunks.push({ start, end, ...bounds });
  }
  cached = { chunks, key: null, paths: null };
  visibleTracks.set(points, cached);
  return cached;
}

// bounds must include the maximum paint reach: half road width, barrier offset,
// stroke radius and antialiasing. Cuts then lie outside the actual viewport.
export function getVisibleTrackRenderPaths(points, borderDistance, barrierDistance, bounds) {
  const cache = getTrackChunks(points);
  const visible = cache.chunks.map(c => c.maxX >= bounds.minX && c.minX <= bounds.maxX
    && c.maxY >= bounds.minY && c.minY <= bounds.maxY);
  if (visible.length && visible.every(Boolean)) return getTrackRenderPaths(points, borderDistance, barrierDistance);
  const key = `${borderDistance}/${barrierDistance}/${visible.map(v => v ? '1' : '0').join('')}`;
  if (key === cache.key) return cache.paths;
  const offsets = { center: 0, left: borderDistance, right: -borderDistance,
    barrierLeft: barrierDistance, barrierRight: -barrierDistance };
  const entries = Object.entries(offsets);
  const paths = { borderDistance, barrierDistance };
  for (const name of Object.keys(offsets)) paths[name] = new Path2D();
  // Start at an invisible chunk so a visible run across start/finish stays joined.
  const first = visible.indexOf(false);
  let continuing = false;
  for (let step = 1; step <= visible.length; step++) {
    const index = (first + step) % visible.length;
    if (!visible[index]) { continuing = false; continue; }
    const chunk = cache.chunks[index];
    for (let i = chunk.start + (continuing ? 1 : 0); i <= chunk.end; i++) {
      const p = points[i % points.length];
      for (const [name, offset] of entries) {
        const x = offset === 0 ? p.x : p.x + p.normalX * offset;
        const y = offset === 0 ? p.y : p.y + p.normalY * offset;
        if (!continuing && i === chunk.start) paths[name].moveTo(x, y);
        else paths[name].lineTo(x, y);
      }
    }
    continuing = true;
  }
  cache.key = key; cache.paths = paths;
  return paths;
}

export function getTrackRenderPaths(points, borderDistance, barrierDistance) {
  const cached = trackPaths.get(points);
  if (cached && cached.borderDistance === borderDistance && cached.barrierDistance === barrierDistance) return cached;
  const paths = { borderDistance, barrierDistance };
  for (const [name, offset] of Object.entries({ center: 0, left: borderDistance, right: -borderDistance,
    barrierLeft: barrierDistance, barrierRight: -barrierDistance })) {
    const path = new Path2D();
    points.forEach((point, i) => {
      const x = offset === 0 ? point.x : point.x + point.normalX * offset;
      const y = offset === 0 ? point.y : point.y + point.normalY * offset;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
    paths[name] = path;
  }
  trackPaths.set(points, paths);
  return paths;
}

// Invert all four viewport corners, including the camera's 50px vertical offset.
// A conservative AABB keeps details at rotated screen edges; it only skips invisible paint.
export function getRenderBounds(camera, canvas, padding = 0) {
  const corners = [[0, 0], [canvas.width, 0], [0, canvas.height], [canvas.width, canvas.height]]
    .map(([x, y]) => camera.screenToWorld(x, y, canvas));
  return { minX: Math.min(...corners.map(p => p.x)) - padding, maxX: Math.max(...corners.map(p => p.x)) + padding,
    minY: Math.min(...corners.map(p => p.y)) - padding, maxY: Math.max(...corners.map(p => p.y)) + padding };
}

export function withinRenderBounds(point, bounds) {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}
