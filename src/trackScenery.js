import { withinRenderBounds } from './renderGeometry.js';

const scenery = new WeakMap();
// All objects are paint underneath the road, outside its existing barriers.
// Fixed placement keeps scenery stable between tiles and consumes no racing RNG.
export function drawTrackScenery(ctx, points, bounds, width, urban) {
  let cache = scenery.get(points);
  if (!cache || cache.width !== width || cache.urban !== urban) {
    const items = [];
    for (let i = 0; i < points.length; i += 90) {
      const p = points[i], side = i % 180 === 0 ? 1 : -1;
      const stand = i % 360 === 0 && p.curvature < .008;
      const offset = width / 2 + (urban ? 16 : 24);
      items.push({ x: p.x + p.normalX * offset * side, y: p.y + p.normalY * offset * side,
        angle: p.angle, stand, shade: i % 270 === 0 });
    }
    cache = { width, urban, items }; scenery.set(points, cache);
  }
  const padded = { minX: bounds.minX - 18, maxX: bounds.maxX + 18, minY: bounds.minY - 18, maxY: bounds.maxY + 18 };
  for (const item of cache.items) {
    if (!withinRenderBounds(item, padded)) continue;
    ctx.save(); ctx.translate(item.x, item.y); ctx.rotate(item.angle);
    if (item.stand) {
      ctx.fillStyle = '#10192266'; ctx.fillRect(-9, -2, 21, 9);
      ctx.fillStyle = '#505b67'; ctx.fillRect(-10, -4.5, 20, 9);
      ctx.fillStyle = '#202e40'; ctx.fillRect(-9.5, -4, 19, 8);
      for (let row = 0; row < 5; row++) {
        ctx.fillStyle = row % 2 ? '#748faa' : '#965757';
        ctx.fillRect(-9, -3.4 + row * 1.4, 18, .7);
      }
      ctx.fillStyle = '#b0b7b5'; ctx.fillRect(-10.5, -5, 21, 1.2);
      ctx.fillStyle = '#d7d5c6'; ctx.fillRect(-.4, -3.8, .8, 7.6);
    } else if (!urban) {
      ctx.fillStyle = '#0b1b1770'; ctx.beginPath(); ctx.ellipse(1.5, 1.9, 4.8, 3.8, .25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = item.shade ? '#294b37' : '#32573e';
      ctx.beginPath(); ctx.arc(0, 0, 3.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#446747'; ctx.beginPath(); ctx.arc(-.9, -.8, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#527550'; ctx.beginPath(); ctx.arc(-1.2, -1.2, 1.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}
