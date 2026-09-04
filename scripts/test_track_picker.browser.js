// Run with agent-browser eval --stdin against a fresh local Vite page.
// API fixtures are local to this browser context; no records or telemetry are sent.
(async () => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  const checks = [];
  const byId = id => document.getElementById(id);
  const { state, backToMenu } = await import('/src/game.js');
  const originalFetch = window.fetch;
  window.fetch = (url, options) => String(url).startsWith('http://localhost:3001/api/')
    ? Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    : originalFetch(url, options);
  const settings = ['gameMode', 'lapCount', 'trackCondition', 'transMode', 'botCount', 'botDifficulty'];
  const defaults = settings.map(id => byId(id).value);
  const search = text => { byId('track-search').value = text; byId('track-search').dispatchEvent(new Event('input', { bubbles: true })); };
  const count = () => byId('track-grid').children.length;
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  async function start() {
    byId('start-race').click();
    const deadline = performance.now() + 5000;
    while (!state.isRunning && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert(state.isRunning, 'Start button opens the actual race');
    await settle();
  }
  try {
    backToMenu(); await settle();
    assert(byId('trackSelect').value === '21', 'Default circuit remains Interlagos');
    byId('track-picker-open').click();
    assert(byId('track-dialog').open && count() === 24, 'Catalogue exposes every circuit');
    assert(document.activeElement === byId('track-search'), 'Opening focuses search');
    assert(byId('track-grid').querySelector('[data-track-id="21"]').getAttribute('aria-pressed') === 'true', 'Current circuit is marked');
    search('SAO PAULO');
    assert(count() === 1 && byId('track-grid').firstChild.dataset.trackId === '21', 'Accent-insensitive city search works');
    search('not-a-circuit');
    assert(count() === 0 && !byId('track-empty').hidden, 'Empty search has a recovery action');
    byId('track-search-reset').click();
    assert(count() === 24 && byId('track-empty').hidden, 'Reset restores all circuits');
    document.querySelector('[data-track-filter="featured"]').click();
    assert(count() === 8, 'Featured filter shows eight circuits');
    search('spa');
    assert(count() === 1, 'Search combines with the filter');
    byId('track-grid').firstChild.click(); await settle();
    assert(!byId('track-dialog').open && byId('trackSelect').value === '14', 'Choosing a card commits to the existing selector and closes');
    assert(byId('circuit-name').textContent === 'Spa-Francorchamps' && byId('track-picker-name').textContent === 'Spa-Francorchamps', 'Both circuit previews sync');
    assert(document.activeElement === byId('track-picker-open'), 'Closing restores keyboard focus');
    assert(JSON.stringify(settings.map(id => byId(id).value)) === JSON.stringify(defaults), 'Choosing a track does not change race settings');
    await start();
    assert(state.selectedTrack === 14 && state.selectedTrackData.id === 14, 'Race loads the chosen Spa geometry');
    assert(state.cars.length === 20 && state.cars.filter(car => car.isBot).length === 19, 'All nineteen bots remain active');
    assert(byId('menu').style.display === 'none' && document.activeElement === byId('gameCanvas'), 'Race canvas receives focus');
    backToMenu(); await settle();
    byId('track-picker-open').click();
    search('monaco'); byId('track-grid').firstChild.click(); await settle();
    byId('gameMode').value = 'ghost'; byId('gameMode').dispatchEvent(new Event('change'));
    await start();
    assert(state.gameMode === 'ghost' && state.cars.length === 1 && state.selectedTrack === 8, 'Ghost mode and switching circuits still work');
    backToMenu(); await settle();
    return { passed: checks.length, checks };
  } finally {
    backToMenu();
    window.fetch = originalFetch;
  }
})()
