import { CONTROL_ACTIONS, DEFAULT_BINDINGS, ARROW_BINDINGS, getBindings, loadBindings, saveBindings, allowedKey, keyLabel, bindingLabel } from './controlBindings.js';

export function initControlsSettings(clearInput) {
  const el = id => document.getElementById(id), dialog = el('controls-dialog');
  let storage; try { storage = localStorage; } catch { /* Session-only controls. */ }
  loadBindings(storage);
  let draft, capturing = null;
  const message = text => el('controls-message').textContent = text;
  const refreshHints = () => document.querySelectorAll('[data-control-hint]').forEach(node => node.textContent = bindingLabel(node.dataset.controlHint));
  refreshHints();
  function render() {
    el('controls-bindings').replaceChildren(...CONTROL_ACTIONS.map(a => {
      const row = document.createElement('div'); row.className = 'binding-row';
      const label = document.createElement('span'); label.id = `binding-label-${a.id}`; label.textContent = a.label;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = a.id;
      button.setAttribute('aria-label', `${a.label}: ${keyLabel(draft[a.id])}. Alterar tecla`);
      button.textContent = keyLabel(draft[a.id]);
      button.addEventListener('click', () => {
        clearInput(); capturing = a.id;
        for (const other of el('controls-bindings').querySelectorAll('button')) { other.classList.remove('is-listening'); other.textContent = keyLabel(draft[other.dataset.action]); }
        button.classList.add('is-listening'); button.textContent = 'PRESSIONE UMA TECLA';
        el('controls-cancel-key').hidden = false; message(`Nova tecla para ${a.label.toLowerCase()}. ESC cancela a captura.`);
      });
      row.append(label, button); return row;
    }));
    el('controls-cancel-key').hidden = true;
  }
  function cancelCapture() { capturing = null; render(); message('Captura cancelada. Nenhuma tecla foi alterada.'); }
  function open() { clearInput(); draft = getBindings(); capturing = null; render(); message('Clique em uma tecla para alterar. As mudanças só valem depois de salvar.'); if (!dialog.open) dialog.showModal(); }
  for (const id of ['controls-open', 'session-controls', 'online-controls']) el(id).addEventListener('click', open);
  for (const [id, preset] of [['controls-wasd', DEFAULT_BINDINGS], ['controls-arrows', ARROW_BINDINGS], ['controls-reset', DEFAULT_BINDINGS]]) el(id).addEventListener('click', () => { capturing = null; draft = { ...preset }; render(); message('Layout preparado. Salve para aplicar.'); });
  el('controls-cancel-key').addEventListener('click', cancelCapture);
  el('controls-save').addEventListener('click', () => {
    capturing = null; const persisted = saveBindings(draft, storage); clearInput(); refreshHints(); render();
    message(persisted ? 'Controles salvos neste navegador. Valem no offline e no online.' : 'Controles aplicados nesta aba. O navegador não permitiu salvar permanentemente.');
  });
  dialog.addEventListener('close', () => { capturing = null; clearInput(); });
  // Capture before racing/menu shortcuts: assigning a key never drives or restarts.
  window.addEventListener('keydown', event => {
    if (!dialog.open || !capturing) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    if (event.code === 'Escape') { cancelCapture(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || !allowedKey(event.code)) { message('Tecla reservada. Use letras, números, setas, Shift ou Espaço. ESC e R ficam para os menus.'); return; }
    const conflict = CONTROL_ACTIONS.find(a => a.id !== capturing && draft[a.id] === event.code);
    if (conflict) { message(`Essa tecla já controla ${conflict.label.toLowerCase()}. Escolha outra tecla.`); return; }
    const action = capturing; draft[action] = event.code; capturing = null; render();
    el('controls-bindings').querySelector(`[data-action="${action}"]`).focus();
    message('Tecla definida. Salve os controles para aplicar.');
  }, true);
  // Opening nested settings does not pause the other online players.
  window.addEventListener('quick-grid:menu', () => { if (dialog.open) dialog.close(); });
}
