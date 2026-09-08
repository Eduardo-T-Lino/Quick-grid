import { state, pauseGame, resumeGame, restartGame, backToMenu } from './game.js';

export function initSessionControls() {
  const byId = id => document.getElementById(id);
  const dialog = byId('session-dialog');
  let mode = 'pause', returnToPause = false, busy = false;
  function render() {
    const restart = mode === 'restart';
    byId('session-dialog-title').textContent = restart ? 'DE VOLTA AO GRID?' : 'RESPIRA. A PISTA ESPERA.';
    byId('session-dialog-label').textContent = restart ? 'RACE CONTROL / REINICIAR' : 'RACE CONTROL / PAUSA';
    byId('session-dialog-description').textContent = restart
      ? 'A corrida atual será encerrada. Você volta à largada com o mesmo circuito, pilotos e número de voltas. Seus recordes ficam salvos.'
      : 'Carros e cronômetros estão pausados. Retome quando estiver pronto.';
    byId('session-track').textContent = `${state.selectedTrackData.name} · ${state.totalLaps} voltas`;
    byId('session-progress').textContent = `VOLTA ${Math.min(state.cars[0]?.currentLap || 1, state.totalLaps)} / ${state.totalLaps}`;
    byId('session-resume').hidden = restart;
    byId('session-restart').hidden = restart;
    byId('session-exit').hidden = restart;
    byId('session-confirm').hidden = !restart;
    byId('session-cancel').hidden = !restart;
    byId('session-message').textContent = '';
    if (!dialog.open) dialog.showModal();
    (restart ? byId('session-cancel') : byId('session-resume')).focus();
  }
  function resume() {
    dialog.close(); resumeGame(); byId('gameCanvas').focus({ preventScroll: true });
  }
  function showPause() {
    if (busy || state.raceFinished || !state.isRunning) return;
    pauseGame(); mode = 'pause'; render();
  }
  function showRestart() {
    if (busy || !state.isRunning || mode === 'restart' && dialog.open) return;
    returnToPause = state.isPaused;
    pauseGame(); mode = 'restart'; render();
  }
  function cancel() {
    if (busy) return;
    if (mode === 'restart' && returnToPause) { mode = 'pause'; render(); }
    else resume();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
  byId('session-close').addEventListener('click', cancel);
  byId('session-resume').addEventListener('click', resume);
  byId('session-cancel').addEventListener('click', cancel);
  byId('session-restart').addEventListener('click', showRestart);
  byId('session-exit').addEventListener('click', backToMenu);
  byId('pause-race').addEventListener('click', showPause);
  byId('restart-race').addEventListener('click', showRestart);
  byId('session-confirm').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    dialog.querySelectorAll('button').forEach(button => button.disabled = true);
    byId('session-message').textContent = 'Preparando a nova largada…';
    try {
      await restartGame(); dialog.close(); byId('gameCanvas').focus({ preventScroll: true });
    } catch {
      dialog.close(); byId('start-status').textContent = 'Não foi possível reiniciar. Tente entrar no grid novamente.';
    } finally { busy = false; dialog.querySelectorAll('button').forEach(button => button.disabled = false); }
  });
  window.addEventListener('quick-grid:menu', () => { if (!busy) dialog.close(); });
  window.addEventListener('keydown', event => {
    if (!state.isRunning || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    if (event.code === 'KeyR') { event.preventDefault(); showRestart(); }
    else if (event.code === 'Escape' && !dialog.open) { event.preventDefault(); showPause(); }
  });
  window.addEventListener('blur', () => { state.keys = {}; if (!dialog.open) showPause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !dialog.open) showPause(); });
}
