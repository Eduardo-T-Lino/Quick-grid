export const CONTROLS_STORAGE_KEY = 'quick-grid-controls-v1';
export const CONTROL_ACTIONS = Object.freeze([
  { id: 'accelerate', label: 'Acelerar', key: 'KeyW' },
  { id: 'brake', label: 'Frear / marcha à ré', key: 'KeyS' },
  { id: 'left', label: 'Virar à esquerda', key: 'KeyA' },
  { id: 'right', label: 'Virar à direita', key: 'KeyD' },
  { id: 'boost', label: 'Usar boost', key: 'Space' },
  { id: 'shiftUp', label: 'Subir marcha', key: null },
  { id: 'shiftDown', label: 'Reduzir marcha', key: null }
]);
export const DEFAULT_BINDINGS = Object.freeze({ accelerate: 'KeyW', brake: 'KeyS', left: 'KeyA', right: 'KeyD', boost: 'Space', shiftUp: 'ArrowUp', shiftDown: 'ArrowDown' });
export const ARROW_BINDINGS = Object.freeze({ accelerate: 'ArrowUp', brake: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', boost: 'Space', shiftUp: 'KeyE', shiftDown: 'KeyQ' });
export function allowedKey(code) {
  return typeof code === 'string' && code !== 'KeyR' && (/^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || /^Numpad[0-9]$/.test(code)
    || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'BracketLeft', 'BracketRight', 'Minus', 'Equal', 'Backquote', 'Backslash', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal'].includes(code));
}
export function validateBindings(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && CONTROL_ACTIONS.every(a => Object.hasOwn(value, a.id) && allowedKey(value[a.id]))
    && new Set(CONTROL_ACTIONS.map(a => value[a.id])).size === CONTROL_ACTIONS.length;
}
export function keyLabel(code) {
  const names = { Space: 'ESPAÇO', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'SHIFT E', ShiftRight: 'SHIFT D', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '−', Equal: '=', Backquote: '`', Backslash: '\\', NumpadAdd: 'NUM +', NumpadSubtract: 'NUM −', NumpadMultiply: 'NUM ×', NumpadDivide: 'NUM /', NumpadDecimal: 'NUM .' };
  return names[code] || code?.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'NUM ') || '—';
}
let active = { ...DEFAULT_BINDINGS };
export const getBindings = () => ({ ...active });
export const bindingLabel = action => keyLabel(active[action]);
export function loadBindings(storage) {
  try { const saved = JSON.parse(storage.getItem(CONTROLS_STORAGE_KEY)); active = saved?.version === 1 && validateBindings(saved.bindings) ? Object.fromEntries(CONTROL_ACTIONS.map(a => [a.id, saved.bindings[a.id]])) : { ...DEFAULT_BINDINGS }; }
  catch { active = { ...DEFAULT_BINDINGS }; }
  return getBindings();
}
export function saveBindings(bindings, storage) {
  if (!validateBindings(bindings)) throw Error('INVALID_BINDINGS');
  active = Object.fromEntries(CONTROL_ACTIONS.map(a => [a.id, bindings[a.id]]));
  try { storage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify({ version: 1, bindings: active })); return true; }
  catch { return false; } // Still usable in this tab when storage is unavailable.
}
export function actionForCode(code, bindings = active) {
  const action = CONTROL_ACTIONS.find(a => bindings[a.id] === code)?.id;
  if (action) return action;
  // Preserve the original WASD layout's secondary left/right arrow controls.
  if (code === 'ArrowLeft' && bindings.left === 'KeyA') return 'left';
  if (code === 'ArrowRight' && bindings.right === 'KeyD') return 'right';
  return null;
}

// Translate physical keys to the existing physics/network vocabulary, never vice versa.
export function createKeyboardControls(getState) {
  const held = new Set(); let keyState;
  const clear = () => { const state = getState(); held.clear(); state.keys = {}; keyState = state.keys; if (state.onlineSession) state.onlineSession.queueShift(0); };
  const sync = () => { const state = getState(); if (keyState !== state.keys) { held.clear(); keyState = state.keys; } return state; };
  const apply = state => { for (const a of CONTROL_ACTIONS) if (a.key) state.keys[a.key] = [...held].some(code => actionForCode(code) === a.id); };
  return { clear,
    down(event, blocked = false) {
      const state = sync();
      if (blocked || event.ctrlKey || event.metaKey || event.altKey || ['Escape', 'KeyR'].includes(event.code)) { clear(); return; }
      if (!state.isRunning || state.isPaused) return;
      const action = actionForCode(event.code); if (!action) return;
      event.preventDefault(); if (event.repeat) return;
      held.add(event.code); apply(state);
      const car = state.cars[0];
      if (!car || car.isAuto || car.isBot || car.finished || state.racePhase !== 'racing') return;
      if (action === 'shiftUp' || action === 'shiftDown') {
        const direction = action === 'shiftUp' ? 1 : -1;
        if (state.onlineSession) state.onlineSession.queueShift(direction);
        else {
          car.recordManualGearShiftRequest?.(direction);
          direction > 0 ? car.shiftUp() : car.shiftDown();
        }
      }
    },
    up(event) { const state = sync(); held.delete(event.code); apply(state); }
  };
}
