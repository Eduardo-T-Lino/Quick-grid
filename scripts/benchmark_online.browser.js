// Local real-server smoke/load sample: one rendered client + seven protocol guests.
// No cloud, accounts or telemetry. Not an eight-browser/WAN capacity benchmark.
(async () => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw Error('LOCAL_ONLY');
  const url = path => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === path)?.name || path;
  const { state } = await import(url('/src/game.js'));
  const { renderPoses } = await import(url('/src/renderPose.js'));
  const { ONLINE_VERSION } = await import(url('/src/online/protocol.js'));
  const { mlTelemetry, onlineUploader } = await import(url('/src/ml/telemetry/index.js'));
  if (state.isRunning || mlTelemetry.enabled || onlineUploader.consentEnabled) throw Error('Use isolated idle page, telemetry off');
  const el = id => document.getElementById(id), peers = [], frames = [], motion = [], gaps = [];
  const wait = async f => { const end = performance.now() + 15000; while (!f()) { if (performance.now() > end) throw Error('timeout'); await new Promise(r => setTimeout(r, 20)); } };
  let timer, sampling = false, previous, lastArrival;
  const OriginalSocket = window.WebSocket;
  window.WebSocket = class extends OriginalSocket {
    constructor(...args) { super(...args); this.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.type === 'snapshot' && sampling) { const now = performance.now(); if (lastArrival) gaps.push(now - lastArrival); lastArrival = now; } }); }
  };
  try {
    el('online-open').click(); el('online-name').value = 'Frame Test'; el('online-format').value = 'single'; el('online-format').dispatchEvent(new Event('change')); el('online-create').click();
    await wait(() => !el('online-room').hidden);
    for (let i = 0; i < 7; i++) {
      const ws = new OriginalSocket(`ws://${location.host}/online`); peers.push(ws);
      ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'join', version: ONLINE_VERSION, name: `Load Guest ${i}`, auto: true, code: el('online-room-code').textContent })));
      ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.type === 'welcome') ws.send(JSON.stringify({ type: 'ready', ready: true })); if (m.type === 'room' && m.room.phase === 'loading') ws.send(JSON.stringify({ type: 'loaded', raceId: m.room.raceId })); });
    }
    await wait(() => el('online-players').children.length === 8 && [...el('online-players').children].slice(1).every(n => n.textContent.includes('pronto')));
    el('online-ready').click(); await new Promise(r => setTimeout(r, 80)); el('online-start').click();
    await wait(() => state.racePhase === 'racing'); el('online-dialog').close(); el('gameCanvas').focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    let seq = 0; timer = setInterval(() => { for (const ws of peers) if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', seq: ++seq, shift: 0, keys: { KeyW: true, KeyS: false, KeyA: false, KeyD: false, Space: false } })); }, 50);
    sampling = true;
    const end = performance.now() + 10000;
    while (performance.now() < end) {
      const now = await new Promise(requestAnimationFrame), car = state.cars[0];
      const pose = state.onlineSession.samplePose?.(car, now) || renderPoses.sample(car, state.onlineSession.alpha(now));
      if (previous) { const dt = now - previous.now; frames.push(dt); if (Math.hypot(car.vx, car.vy) > .15 && dt > 0) motion.push(Math.hypot(pose.x - previous.x, pose.y - previous.y) / (Math.hypot(car.vx, car.vy) * dt / (1000 / 60))); }
      previous = { now, x: pose.x, y: pose.y };
    }
    const percentile = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];
    return { clients: 8, renderedClients: 1, durationSeconds: 10, frames: frames.length, frameP95Ms: percentile(frames, .95), framesOver50Ms: frames.filter(t => t > 50).length,
      snapshotGapP95Ms: percentile(gaps, .95), motionSamples: motion.length, stalledMotionFrames: motion.filter(r => r < .05).length, motionRatioP05: percentile(motion, .05), motionRatioP95: percentile(motion, .95), diagnostics: state.onlineSession.diagnostics?.() };
  } finally { sampling = false; clearInterval(timer); window.WebSocket = OriginalSocket; state.keys = {}; for (const ws of peers) ws.close(); el('online-leave').click(); el('online-dialog').close(); }
})()
