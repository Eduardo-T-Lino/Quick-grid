// Small repeating material tiles. Fixed arithmetic noise never consumes gameplay randomness.
const materials = new WeakMap();
export function getTrackMaterials(ctx) {
  if (materials.has(ctx)) return materials.get(ctx);
  function material(base, light, dark, density, scale) {
    const tile = document.createElement('canvas'); tile.width = tile.height = 128;
    const c = tile.getContext('2d'); c.fillStyle = base; c.fillRect(0,0,128,128);
    for (let i = 0; i < density; i++) {
      c.fillStyle = i % 3 === 0 ? light : dark;
      c.fillRect((i * 73 + i * i * 3) % 128, (i * 37 + Math.floor(i / 7) * 13) % 128, i % 4 === 0 ? 2 : 1, 1);
    }
    const pattern = ctx.createPattern(tile, 'repeat');
    pattern.setTransform(new DOMMatrix().scale(scale));
    return pattern;
  }
  const result = {
    grass: material('#20372b', '#314635', '#182e26', 1100, .12),
    asphalt: material('#30343a', '#3c4147', '#272b30', 1800, .06),
    wet: material('#26343e', '#3a4a55', '#202c35', 1300, .06),
    gravel: material('#897d61', '#aa9b78', '#6e654f', 1500, .10)
  };
  materials.set(ctx, result); return result;
}
