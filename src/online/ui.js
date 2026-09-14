import { OnlineClient } from './client.js';
import { state } from '../game.js';
import { F1_TRACKS } from '../f1Tracks.js';
import { getPilotName } from '../auth.js';
import { validPilot } from './protocol.js';
import { createTrackPreview } from '../paddock.js';

const errors = { ROOM_NOT_FOUND: 'Sala não encontrada.', ROOM_FULL: 'A sala já tem 8 pilotos.',
  RACE_IN_PROGRESS: 'Essa sala já começou. Peça ao anfitrião para criar outra após o torneio.',
  VERSION_MISMATCH: 'Versões diferentes do jogo. Todos precisam atualizar a página.',
  NOT_READY: 'São necessários pelo menos dois pilotos conectados e prontos.', HOST_ONLY: 'Somente o anfitrião pode iniciar.',
  INVALID_SETTINGS: 'Confira voltas (3–80), etapas (2–12), clima e pista.', INVALID_CODE: 'Use o código de seis letras/números da sala.',
  INVALID_REQUEST: 'Confira o nome do piloto e tente novamente.', SERVER_FULL: 'Servidor cheio. Tente novamente mais tarde.',
  SESSION_EXPIRED: 'O tempo para reconectar acabou. Entre em uma nova sala.', DISCONNECTED: 'Não foi possível conectar ao online.',
  NEED_PLAYERS: 'São necessários dois pilotos conectados para a próxima etapa.', LOAD_FAILED: 'Não foi possível preparar a pista.',
  ROOM_EXPIRED: 'A sala expirou por inatividade.' };

export function initOnline() {
  const el = id => document.getElementById(id), dialog = el('online-dialog'), client = new OnlineClient();
  let busy = false, roomReceivedAt = 0, lastPhase = null, ballotKey = '', previewId = null;
  const previewPaths = new Map();
  const message = text => { el('online-status').textContent = text; };
  const open = () => { state.keys = {}; if (!dialog.open) dialog.showModal(); };
  const textNode = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  function trackSVG(track) {
    if (!previewPaths.has(track.id)) previewPaths.set(track.id, createTrackPreview(track).path);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 320 200'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', previewPaths.get(track.id)); svg.append(path); return svg;
  }
  // Native values remain the source of truth, with keyboard-accessible radio controls.
  document.querySelectorAll('[data-online-select]').forEach(group => {
    const select = el(group.dataset.onlineSelect), buttons = [...group.querySelectorAll('button')];
    const refresh = () => buttons.forEach(button => { const selected = select.value === button.dataset.value; button.setAttribute('aria-checked', String(selected)); button.tabIndex = selected ? 0 : -1; });
    buttons.forEach((button, i) => {
      button.addEventListener('click', () => { select.value = button.dataset.value; select.dispatchEvent(new Event('change')); });
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (i + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].click(); buttons[next].focus();
      });
    });
    select.addEventListener('change', refresh); refresh();
  });
  function refreshStages() {
    const count = Number(el('online-rounds').value);
    el('online-rounds-minus').disabled = count <= 2; el('online-rounds-plus').disabled = count >= 12;
  }
  for (const [id, delta] of [['online-rounds-minus', -1], ['online-rounds-plus', 1]]) el(id).addEventListener('click', () => {
    el('online-rounds').value = Math.max(2, Math.min(12, (Number(el('online-rounds').value) || 2) + delta)); refreshStages();
  });
  el('online-rounds').addEventListener('input', refreshStages); refreshStages();
  const running = room => ['loading', 'countdown', 'racing'].includes(room?.phase);
  function setBusy(value) {
    busy = value; el('online-create').disabled = value; el('online-join').disabled = value;
  }
  function render(room) {
    const enteringRace = running(room) && !['loading', 'countdown', 'racing'].includes(lastPhase);
    lastPhase = room.phase;
    roomReceivedAt = performance.now(); setBusy(false);
    el('online-entry').hidden = true; el('online-room').hidden = false;
    el('online-room-code').textContent = room.code;
    el('online-phase').textContent = room.complete ? 'TORNEIO ENCERRADO' : room.phase === 'voting' ? 'ESCOLHAM A PRÓXIMA PISTA'
      : room.phase === 'results' ? 'RESULTADO DA ETAPA' : running(room) ? 'CORRIDA EM ANDAMENTO' : 'ESPERANDO O GRID';
    const track = F1_TRACKS.find(t => t.id === (room.trackId || room.settings.trackId));
    el('online-detail').textContent = `${room.settings.rounds > 1 ? `Torneio · etapa ${room.round || 1}/${room.settings.rounds}` : 'Corrida única'} · ${room.settings.laps} voltas · ${room.settings.weather === 'wet' ? 'molhada' : 'seca'}${room.phase === 'voting' ? '' : ` · ${track?.name || ''}`}`;
    const me = room.players.find(p => p.id === client.id);
    el('online-player-count').textContent = `${room.players.filter(p => p.connected).length} / 8`;
    el('online-players').replaceChildren(...[...room.players].sort((a, b) => b.points - a.points).map((p, i) => {
      const row = document.createElement('li'); row.style.borderLeftColor = p.color;
      row.classList.toggle('is-me', p.id === client.id);
      const place = textNode('span', String(i + 1).padStart(2, '0')); place.className = 'online-driver-place';
      const copy = document.createElement('div'); copy.className = 'online-driver-copy';
      copy.append(textNode('strong', `${p.name}${p.id === client.id ? ' · você' : ''}`), textNode('small', `${p.id === room.host ? 'anfitrião · ' : ''}${!p.connected ? 'desconectado' : room.phase === 'lobby' ? p.ready ? 'pronto' : 'aguardando' : 'conectado'}`));
      const points = textNode('span', `${p.points} pts`); points.className = 'online-driver-points'; row.append(place, copy, points);
      return row;
    }));
    const voting = room.phase === 'voting', key = voting ? `${room.round}/${room.candidates.join(',')}` : '';
    el('online-vote-clock').hidden = !voting; el('online-vote-progress').hidden = !voting;
    // Do not destroy keyboard focus or rebuild SVG paths when another player votes.
    if (key !== ballotKey) { el('online-votes').replaceChildren(); ballotKey = key;
    if (voting) for (const [i, id] of room.candidates.entries()) {
      const track = F1_TRACKS.find(t => t.id === id), button = document.createElement('button'); button.type = 'button';
      button.dataset.trackId = id;
      const number = textNode('span', `CIRCUITO / 0${i + 1}`); number.className = 'online-vote-number';
      const count = document.createElement('span'); count.className = 'online-vote-count'; count.append(textNode('span', ''), textNode('b', 'VOTAR →'));
      button.append(number, trackSVG(track), textNode('strong', track.name), textNode('small', track.lengthKm), count);
      button.addEventListener('click', () => client.send({ type: 'vote', trackId: id })); el('online-votes').append(button);
    } }
    if (voting) for (const button of el('online-votes').children) {
      const id = Number(button.dataset.trackId), selected = room.votes[client.id] === id;
      button.setAttribute('aria-pressed', String(selected));
      button.querySelector('.online-vote-count span').textContent = `${Object.values(room.votes).filter(v => v === id).length} voto(s)`;
      button.querySelector('.online-vote-count b').textContent = selected ? 'SEU VOTO ✓' : 'VOTAR →';
    }
    el('online-track-preview').hidden = voting || room.phase === 'results';
    if (track && track.id !== previewId) { previewId = track.id; el('online-track-preview').replaceChildren(trackSVG(track), textNode('strong', track.name), textNode('small', `${track.location} · ${track.lengthKm}`)); }
    el('online-results').replaceChildren(...(room.phase === 'results' ? room.results.map(r => {
      const row = document.createElement('div'); row.className = 'online-result-row'; row.append(textNode('span', `${r.rank}º`), textNode('strong', r.name), textNode('span', r.finished ? `${r.time.toFixed(2)} s` : 'DNF')); return row;
    }) : []));
    el('online-ready').hidden = room.phase !== 'lobby'; el('online-ready').setAttribute('aria-pressed', String(Boolean(me?.ready)));
    el('online-ready').textContent = me?.ready ? 'PRONTO ✓' : 'ESTOU PRONTO';
    el('online-start').hidden = !['lobby', 'results'].includes(room.phase) || room.complete;
    el('online-start').disabled = room.host !== client.id;
    el('online-start').textContent = room.phase === 'results' ? 'PRÓXIMA ETAPA → VOTAÇÃO' : room.settings.rounds > 1 ? 'INICIAR TORNEIO → VOTAÇÃO' : 'INICIAR CORRIDA';
    el('online-return').hidden = !running(room);
    el('online-race-note').hidden = !running(room);
    if (running(room)) { if (state.onlineSession && enteringRace) dialog.close(); }
    else open();
    message(room.phase === 'voting' ? 'Votação aberta. Um voto por piloto; você pode mudar sua escolha.' : running(room)
      ? 'A corrida online não pausa. ESC/R abre este menu; sair abandona sua participação.' : 'Compartilhe o código. O anfitrião inicia quando todos estiverem prontos.');
  }
  el('online-open').addEventListener('click', () => {
    if (!client.room) { const name = getPilotName(); el('online-name').value = validPilot(name) ? name : 'Piloto'; }
    const track = F1_TRACKS.find(t => t.id === Number(el('trackSelect').value));
    el('online-config-summary').textContent = `${track?.name || ''} · ${el('lapCount').value} voltas · ${el('trackCondition').value === 'wet' ? 'Molhada' : 'Seca'} — configuração do menu`;
    open();
  });
  el('online-close').addEventListener('click', () => { dialog.close(); document.getElementById('gameCanvas').focus(); });
  dialog.addEventListener('cancel', () => { state.keys = {}; });
  el('online-format').addEventListener('change', () => { el('online-rounds-label').hidden = el('online-format').value !== 'tournament'; });
  function connect(type) {
    if (busy) return;
    const name = el('online-name').value.trim(); if (!validPilot(name)) { message('Nome de piloto: 2–24 letras/números, espaços, ponto, hífen ou _.'); return; }
    const rounds = el('online-format').value === 'tournament' ? Number(el('online-rounds').value) : 1;
    if (type === 'create' && el('online-format').value === 'tournament' && (!Number.isInteger(rounds) || rounds < 2 || rounds > 12)) { message(errors.INVALID_SETTINGS); return; }
    setBusy(true);
    client.connect({ type, name, auto: el('online-auto').value === 'auto', code: el('online-code').value.trim().toUpperCase(),
      settings: { rounds, laps: Number(el('lapCount').value), trackId: Number(el('trackSelect').value), weather: el('trackCondition').value } });
  }
  el('online-create').addEventListener('click', () => connect('create'));
  el('online-join').addEventListener('click', () => connect('join'));
  el('online-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(client.room.code); message('Código copiado. Envie aos seus amigos.'); }
    catch { message(`Copie o código: ${client.room.code}`); }
  });
  el('online-ready').addEventListener('click', () => client.send({ type: 'ready', ready: !client.room.players.find(p => p.id === client.id)?.ready }));
  el('online-start').addEventListener('click', () => client.send({ type: 'start' }));
  el('online-return').addEventListener('click', () => { dialog.close(); el('gameCanvas').focus(); });
  el('online-leave').addEventListener('click', () => { client.leave(); message('Você saiu da sala.'); });
  client.addEventListener('room', event => { render(event.detail); el('start-race').disabled = true; });
  client.addEventListener('status', event => message(event.detail));
  client.addEventListener('error', event => { setBusy(false); message(errors[event.detail] || 'Não foi possível concluir a ação.'); open(); });
  client.addEventListener('menu', open);
  client.addEventListener('racing', () => { dialog.close(); el('gameCanvas').focus(); });
  client.addEventListener('ping', event => { el('online-ping').textContent = `${event.detail} ms`; });
  client.addEventListener('left', () => { setBusy(false); lastPhase = null; ballotKey = ''; el('online-votes').replaceChildren(); el('online-entry').hidden = false; el('online-room').hidden = true;
    el('online-race-note').hidden = true; el('start-race').disabled = false; });
  window.addEventListener('quick-grid:menu', () => { if (running(client.room) && !client.transitioning) client.leave(); });
  window.addEventListener('keydown', event => {
    if (!state.onlineSession || document.querySelector('dialog[open]') || event.repeat) return;
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') client.shift = event.code === 'ArrowUp' ? 1 : -1;
  });
  setInterval(() => {
    const room = client.room;
    if (room?.phase === 'voting') {
      const remaining = Math.max(0, room.remainingMs - performance.now() + roomReceivedAt);
      const text = `${Math.ceil(remaining / 1000)}s`; if (el('online-vote-clock').textContent !== text) el('online-vote-clock').textContent = text;
      el('online-vote-progress').firstElementChild.style.transform = `scaleX(${Math.min(1, remaining / 20000)})`;
    }
    if (state.onlineSession) {
      const age = state.onlineSession.diagnostics().snapshotAgeMs;
      const text = age > 300 ? 'ONLINE · conexão instável — aguardando servidor' : 'ONLINE · ESC abre o menu sem pausar a corrida';
      if (el('online-race-note').textContent !== text) el('online-race-note').textContent = text;
    }
  }, 250);
}
