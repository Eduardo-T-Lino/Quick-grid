// Two independent browser documents, real WebSocket server, real physics, telemetry OFF.
(async () => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw Error('LOCAL_ONLY');
  const checks = [], assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const wait = async (fn, label, ms = 12000) => { const end = performance.now() + ms;
    while (!fn()) { if (performance.now() > end) throw Error(label + ': ' + document.getElementById('online-status').textContent); await new Promise(r => setTimeout(r, 30)); } };
  const el = id => document.getElementById(id);
  const url = (win, path) => win.performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === path)?.name || path;
  const { state } = await import(url(window, '/src/game.js'));
  const { onlineUploader, mlTelemetry } = await import(url(window, '/src/ml/telemetry/index.js'));
  if (state.isRunning || onlineUploader.consentEnabled || mlTelemetry.enabled) throw Error('Use idle isolated page, telemetry OFF');
  const peer = document.createElement('iframe'); peer.src = location.href;
  peer.style.cssText = 'position:fixed;right:0;bottom:0;width:480px;height:360px;border:0;z-index:1';
  document.body.append(peer);
  let other, peerState;
  try {
    await wait(() => peer.contentDocument?.getElementById('online-open') && peer.contentWindow.startGame, 'peer loaded');
    other = id => peer.contentDocument.getElementById(id);
    // Import in the peer realm to obtain its independent module graph, not the parent's.
    peerState = await peer.contentWindow.eval(`import(${JSON.stringify(url(peer.contentWindow, '/src/game.js'))}).then(m=>m.state)`);
    el('online-open').click(); el('online-name').value = 'Host de Teste';
    el('online-format').value = 'tournament'; el('online-format').dispatchEvent(new Event('change'));
    el('online-rounds').value = '2'; el('online-create').click();
    await wait(() => !el('online-room').hidden, 'host created room');
    const code = el('online-room-code').textContent;
    assert(/^[A-F0-9]{6}$/.test(code), 'Guest host creates a private room through the real UI');
    other('online-open').click(); other('online-name').value = 'Amigo de Teste'; other('online-auto').value = 'manual';
    other('online-code').value = code; other('online-join').click();
    await wait(() => other('online-players').children.length === 2 && el('online-players').children.length === 2, 'both joined');
    assert(other('online-start').disabled && !el('online-start').disabled, 'Only host can start');
    el('online-ready').click(); other('online-ready').click();
    await wait(() => [...el('online-players').children].every(li => li.textContent.includes('pronto')), 'ready');
    el('online-start').click();
    await wait(() => el('online-votes').children.length === 3 && other('online-votes').children.length === 3, 'vote');
    const ids = [...el('online-votes').children].map(n => n.dataset.trackId);
    assert(new Set(ids).size === 3, 'Tournament shows three distinct random tracks');
    assert(ids.join() === [...other('online-votes').children].map(n => n.dataset.trackId).join(), 'Both players see the same ballot');
    el('online-votes').children[1].click(); other('online-votes').children[1].click();
    await wait(() => state.isRunning && peerState.isRunning && state.racePhase === 'countdown', 'synchronized grid');
    assert(state.selectedTrack === Number(ids[1]) && peerState.selectedTrack === Number(ids[1]), 'Winning track loads for both clients');
    assert(state.cars.length === 2 && peerState.cars.length === 2 && state.cars[0].id !== peerState.cars[0].id, 'Each guest controls their own car in the shared grid');
    const start = { x: state.cars[0].x, y: state.cars[0].y };
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    assert(Math.hypot(state.cars[0].x - start.x, state.cars[0].y - start.y) < .01, 'Held throttle cannot move before server lights-out');
    await wait(() => state.racePhase === 'racing' && peerState.racePhase === 'racing', 'lights out');
    // The second document taking focus clears keys in the first, as a real blur should.
    el('online-dialog').close();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    await wait(() => state.cars[0].getKmh() > 30 && state.cars[0].boostCharge < 1, 'real driving');
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    const remote = peerState.cars.find(c => c.id === state.cars[0].id);
    await wait(() => remote.getKmh() > 0 && remote.boostCharge < 1, 'peer state');
    assert(true, 'Actual server physics and boost are replicated to the other player');
    state.cars[0].x = 1e9;
    await wait(() => Math.abs(state.cars[0].x) < 1e6, 'authority');
    assert(true, 'Forged local position is overwritten by server state');
    other('online-dialog').close();
    peer.contentWindow.dispatchEvent(new peer.contentWindow.KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true }));
    await wait(() => peerState.cars[0].gear === 2, 'manual shift');
    assert(!peerState.cars[0].isAuto, 'Per-player manual transmission sends a bounded gear command');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    assert(el('online-dialog').open && !state.isPaused, 'ESC opens online menu without pausing the shared race');
    assert(!onlineUploader.consentEnabled && !mlTelemetry.enabled, 'Online race does not enable or submit ML telemetry');
    el('online-leave').click();
    await wait(() => other('online-players').textContent.includes('Amigo de Teste · você · anfitrião'), 'host migration');
    assert(true, 'Remaining player receives host ownership');
    return { passed: checks.length, checks };
  } finally {
    if (el('online-leave') && !el('online-room').hidden) el('online-leave').click();
    if (other && !other('online-room').hidden) other('online-leave').click();
    peer.remove(); el('online-dialog').close(); state.keys = {};
  }
})()
