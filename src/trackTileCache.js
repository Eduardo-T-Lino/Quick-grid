// Bounded, render-only world tiles. Physics and AI never read this cache.
export const TRACK_TILE_SIZE = 64; // metres, aligned to a fixed world origin
export const TRACK_TILE_SCALE = 10; // px/metre; above the camera's maximum 9.2
export const TRACK_TILE_GUTTER = 2; // overlapping pixels prevent rotated tile seams
export const TRACK_TILE_LIMIT = 64; // ~102 MiB of retained RGBA pixels at most

export class TrackTileCache {
  constructor(createCanvas = () => document.createElement('canvas')) {
    this.createCanvas = createCanvas;
    this.tiles = new Map();
    this.identity = null;
    this.style = null;
    this.builds = 0;
  }

  reset(identity, style) {
    if (this.identity === identity && this.style === style) return;
    for (const tile of this.tiles.values()) tile.canvas.width = tile.canvas.height = 0;
    this.tiles.clear();
    this.identity = identity; this.style = style; this.builds = 0;
  }

  getTile(x, y, paint) {
    const key = `${x},${y}`;
    let tile = this.tiles.get(key);
    if (tile) { this.tiles.delete(key); this.tiles.set(key, tile); return tile; }
    if (this.tiles.size >= TRACK_TILE_LIMIT) {
      // Repaint the least-recently-used offscreen surface. Do not resize or
      // destroy it: that would allocate another ~1.6 MiB texture on every miss.
      // draw() has already protected every currently visible cache hit.
      const oldest = this.tiles.keys().next().value;
      tile = this.tiles.get(oldest);
      this.tiles.delete(oldest);
    } else {
      const canvas = this.createCanvas();
      canvas.width = canvas.height = TRACK_TILE_SIZE * TRACK_TILE_SCALE + TRACK_TILE_GUTTER * 2;
      tile = { canvas, context: canvas.getContext('2d', { alpha: false }), bounds: null };
    }
    const { context } = tile;
    const gutter = TRACK_TILE_GUTTER / TRACK_TILE_SCALE;
    const bounds = { minX: x * TRACK_TILE_SIZE - gutter, minY: y * TRACK_TILE_SIZE - gutter,
      maxX: (x + 1) * TRACK_TILE_SIZE + gutter, maxY: (y + 1) * TRACK_TILE_SIZE + gutter };
    // The painter covers the entire opaque tile. Isolate its state so recycled
    // surfaces start exactly like fresh ones, including transform/alpha/clipping.
    context.save();
    try {
      context.setTransform(TRACK_TILE_SCALE, 0, 0, TRACK_TILE_SCALE,
        -bounds.minX * TRACK_TILE_SCALE, -bounds.minY * TRACK_TILE_SCALE);
      paint(context, bounds);
    } finally {
      context.restore();
    }
    tile.bounds = bounds;
    this.tiles.set(key, tile); this.builds++;
    return tile;
  }

  draw(ctx, bounds, paint) {
    const minX = Math.floor(bounds.minX / TRACK_TILE_SIZE), maxX = Math.floor(bounds.maxX / TRACK_TILE_SIZE);
    const minY = Math.floor(bounds.minY / TRACK_TILE_SIZE), maxY = Math.floor(bounds.maxY / TRACK_TILE_SIZE);
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    // Huge viewports must not churn a too-small tile cache or allocate unbounded RAM.
    // Exact vector drawing remains the fallback, with the same coordinates/materials.
    if (count > TRACK_TILE_LIMIT) { paint(ctx, bounds); return; }
    // Protect all visible hits before filling misses. Otherwise a newly exposed
    // first column could evict the still-visible last column before it is used.
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const key = `${x},${y}`, tile = this.tiles.get(key);
        if (tile) { this.tiles.delete(key); this.tiles.set(key, tile); }
      }
    }
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const tile = this.getTile(x, y, paint);
        ctx.drawImage(tile.canvas, tile.bounds.minX, tile.bounds.minY,
          TRACK_TILE_SIZE + 2 * TRACK_TILE_GUTTER / TRACK_TILE_SCALE,
          TRACK_TILE_SIZE + 2 * TRACK_TILE_GUTTER / TRACK_TILE_SCALE);
      }
    }
    // Prepare one adjacent tile per frame, not a whole ring in one racing frame.
    // No prefetch if the visible set already fills the budget (avoids eviction churn).
    if (count + 2 * (maxX - minX + maxY - minY + 4) > TRACK_TILE_LIMIT) return;
    for (let y = minY - 1; y <= maxY + 1; y++) {
      for (let x = minX - 1; x <= maxX + 1; x++) {
        if ((x < minX || x > maxX || y < minY || y > maxY) && !this.tiles.has(`${x},${y}`)) {
          this.getTile(x, y, paint); return;
        }
      }
    }
  }
}
