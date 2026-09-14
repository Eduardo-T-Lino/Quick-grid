import { initTrackPicker, trackDisplayName } from './trackPicker.js';
import { normalizeLaps, normalizeBots } from './raceSettings.js';

// Presentation-only controller. Existing select IDs/values remain the game's source of truth.
export function createTrackPreview(track) {
  const points = (track?.waypoints || []).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length < 2) return { path: '', start: { x: 160, y: 100 } };
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  const scale = Math.min(270 / Math.max(width, 1), 150 / Math.max(height, 1));
  const projected = points.map(point => ({
    x: (point.x - minX) * scale + (320 - width * scale) / 2,
    y: (point.y - minY) * scale + (200 - height * scale) / 2
  }));
  return { path: projected.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ') + ' Z',
    start: projected[0] };
}

export function sessionBrief({ mode, bots, laps, transmission }) {
  const format = transmission === 'auto' ? 'Automática' : 'Manual';
  const lapText = `${laps} ${Number(laps) === 1 ? 'volta' : 'voltas'}`;
  return `${mode === 'ghost' ? 'Você contra o relógio' : `${Number(bots) + 1} carros no grid`} · ${lapText} · ${format}`;
}

export function initPaddock({ tracks, startGame, clearRecords, toggleModeUI }) {
  const byId = id => document.getElementById(id);
  const menu = byId('menu');
  const selected = id => byId(id).value;
  function updateTrack() {
    const track = tracks.find(item => item.id === Number(selected('trackSelect')));
    if (!track) return;
    const preview = createTrackPreview(track);
    byId('circuit-name').textContent = trackDisplayName(track);
    byId('circuit-location').textContent = track.location.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').trim();
    byId('circuit-length').textContent = (track.lengthMeters / 1000).toFixed(3).replace('.', ',');
    byId('circuit-elevation').textContent = track.elevationDiff.replace(/\s*m$/, '');
    byId('circuit-number').textContent = `${String(track.id).padStart(2, '0')} / ${tracks.length}`;
    for (const id of ['circuit-path', 'circuit-shadow', 'circuit-runner']) byId(id).setAttribute('d', preview.path);
    byId('circuit-start').setAttribute('cx', preview.start.x);
    byId('circuit-start').setAttribute('cy', preview.start.y);
    byId('circuit-svg').setAttribute('aria-label', `Traçado de ${track.name}`);
    updateDistance();
  }
  function updateDistance() {
    const track = tracks.find(item => item.id === Number(selected('trackSelect')));
    const distance = (track?.lengthMeters || 0) * normalizeLaps(selected('lapCount')) / 1000;
    byId('lap-distance').textContent = `${distance.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km de corrida`;
  }
  function updateSession() {
    toggleModeUI();
    const ghost = selected('gameMode') === 'ghost';
    byId('session-brief').textContent = sessionBrief({ mode: selected('gameMode'), bots: selected('botCount'),
      laps: selected('lapCount'), transmission: selected('transMode') });
    byId('start-label').textContent = ghost ? 'INICIAR CONTRARRELÓGIO' : 'ENTRAR NO GRID';
    byId('circuit-weather').textContent = selected('trackCondition') === 'wet' ? 'CHUVA' : 'SECA';
    byId('circuit-weather').style.color = selected('trackCondition') === 'wet' ? '#8fb5ff' : '';
    byId('botCount').disabled = ghost;
    const bots = normalizeBots(selected('botCount'));
    byId('bot-summary').textContent = ghost ? 'Você contra o relógio' : `${bots + 1} carros no grid`;
    byId('botRange').value = bots;
    byId('botRange').disabled = ghost;
    byId('botRange').style.setProperty('--lap-fill', `${(bots - 1) / 18 * 100}%`);
    byId('botRange').setAttribute('aria-valuetext', `${bots} bots`);
    byId('bots-less').disabled = ghost || bots <= 1;
    byId('bots-more').disabled = ghost || bots >= 19;
    document.querySelectorAll('[data-bots]').forEach(button => {
      button.disabled = ghost;
      button.setAttribute('aria-pressed', String(Number(button.dataset.bots) === bots));
    });
    byId('botDifficulty').disabled = ghost;
    updateDistance();
  }
  byId('trackSelect').addEventListener('change', updateTrack);
  for (const id of ['gameMode', 'botCount', 'lapCount', 'transMode', 'trackCondition', 'botDifficulty'])
    byId(id).addEventListener('change', updateSession);
  const laps = byId('lapCount');
  function setLaps(value) {
    laps.value = normalizeLaps(value);
    byId('laps-less').disabled = Number(laps.value) <= 3;
    byId('laps-more').disabled = Number(laps.value) >= 80;
    byId('lapRange').value = laps.value;
    byId('lapRange').style.setProperty('--lap-fill', `${(Number(laps.value) - 3) / 77 * 100}%`);
    byId('lapRange').setAttribute('aria-valuetext', `${laps.value} voltas`);
    document.querySelectorAll('[data-laps]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.laps === laps.value)));
    updateSession();
  }
  laps.addEventListener('change', () => setLaps(laps.value));
  byId('laps-less').addEventListener('click', () => setLaps(Number(laps.value) - 1));
  byId('laps-more').addEventListener('click', () => setLaps(Number(laps.value) + 1));
  byId('lapRange').addEventListener('input', event => setLaps(event.target.value));
  document.querySelectorAll('[data-laps]').forEach(button => button.addEventListener('click', () => setLaps(button.dataset.laps)));
  setLaps(laps.value);

  function setBots(value) { byId('botCount').value = normalizeBots(value); updateSession(); }
  byId('botCount').addEventListener('change', () => setBots(selected('botCount')));
  byId('bots-less').addEventListener('click', () => setBots(Number(selected('botCount')) - 1));
  byId('bots-more').addEventListener('click', () => setBots(Number(selected('botCount')) + 1));
  byId('botRange').addEventListener('input', event => setBots(event.target.value));
  document.querySelectorAll('[data-bots]').forEach(button => button.addEventListener('click', () => setBots(button.dataset.bots)));

  const dialog = byId('controls-dialog');
  byId('controls-open').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  byId('motion-toggle').addEventListener('click', () => {
    const paused = menu.classList.toggle('motion-paused');
    byId('motion-toggle').setAttribute('aria-pressed', String(paused));
    byId('motion-toggle').setAttribute('aria-label', paused ? 'Retomar animações do menu' : 'Pausar animações do menu');
  });
  byId('clear-records').addEventListener('click', () => {
    if (window.confirm('Apagar seus recordes locais de corrida? Essa ação não pode ser desfeita.')) clearRecords();
  });
  byId('start-race').addEventListener('click', async () => {
    const button = byId('start-race');
    if (button.disabled) return;
    setLaps(laps.value);
    setBots(selected('botCount'));
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    byId('start-label').textContent = 'PREPARANDO O GRID';
    byId('start-status').textContent = 'Preparando circuito e pilotos…';
    try {
      await startGame();
      byId('start-status').textContent = '';
      byId('gameCanvas').focus({ preventScroll: true });
    } catch {
      byId('start-status').textContent = 'Não foi possível preparar a corrida. Tente novamente.';
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      updateSession();
    }
  });
  updateTrack();
  updateSession();
  initTrackPicker(tracks, createTrackPreview);
}
