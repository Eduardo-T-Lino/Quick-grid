// Run with agent-browser eval --stdin. Offscreen graphics only; no race/API calls.
(async () => {
  const { TrackTileCache, TRACK_TILE_LIMIT } = await import('/src/trackTileCache.js');
  const checks = [], assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  let allocations = 0;
  const cache = new TrackTileCache(() => { allocations++; return document.createElement('canvas'); });
  const paint = (ctx, bounds) => {
    // Cover every pixel, like the ground painter, then deliberately leave
    // paint state changed to test that reuse restores the fresh-context state.
    const hue = Math.abs(Math.round(bounds.minX + .2)) % 360;
    ctx.fillStyle = `hsl(${hue} 40% 25%)`;
    ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    ctx.translate(bounds.minX + 12, bounds.minY + 15);
    ctx.rotate(.3); ctx.globalAlpha = .4;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 18, 8);
    ctx.strokeStyle = '#f43542'; ctx.lineWidth = .4;
    ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(60, 40); ctx.stroke();
  };
  cache.reset({}, 'dry');
  const originals = [];
  for (let i = 0; i < TRACK_TILE_LIMIT; i++) originals.push(cache.getTile(i, 0, paint).canvas);
  let comparisons = 0;
  try {
    for (const x of [100, -10, 130, -100, 260, 512, -500, 1000]) {
      const reused = cache.getTile(x, 1, paint), reference = new TrackTileCache();
      const fresh = reference.getTile(x, 1, paint);
      const a = reused.context.getImageData(0, 0, 644, 644).data;
      const b = fresh.context.getImageData(0, 0, 644, 644).data;
      let mismatches = 0, maxDifference = 0, totalDifference = 0;
      const examples = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
        mismatches++; const delta = Math.abs(a[i] - b[i]);
        maxDifference = Math.max(maxDifference, delta); totalDifference += delta;
        if (examples.length < 4) examples.push({ pixel: Math.floor(i / 4), channel: i % 4, reused: a[i], fresh: b[i] });
      }
      // GPU edge antialiasing differed by 1/255 in five channels (~1.66M total)
      // on the baseline machine. Permit only that rounding, never stale paint.
      assert(maxDifference <= 1 && totalDifference / a.length < .001,
        `Recycled tile ${x} matches fresh paint within edge rounding: ${JSON.stringify({ mismatches, maxDifference, meanDifference: totalDifference / a.length, examples })}`);
      assert(originals.includes(reused.canvas), `Tile ${x} reuses an original surface`);
      comparisons++;
      reference.reset(null, null);
    }
    assert(allocations === TRACK_TILE_LIMIT, 'No surface allocated after reaching the cache limit');
    assert(originals.every(c => c.width === 644 && c.height === 644), 'Recycling does not resize surfaces');
    cache.reset({}, 'wet');
    assert(originals.every(c => c.width === 0 && c.height === 0), 'Track/style reset still releases old surfaces');
    return { passed: checks.length, pixelComparisons: comparisons, allocations, checks };
  } finally { cache.reset(null, null); }
})()
