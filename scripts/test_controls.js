import assert from 'node:assert/strict';
import { CONTROL_ACTIONS, CONTROLS_STORAGE_KEY, DEFAULT_BINDINGS, ARROW_BINDINGS, allowedKey, validateBindings, loadBindings, saveBindings, getBindings, actionForCode, keyLabel, createKeyboardControls } from '../src/controlBindings.js';
let passed = 0;
const test = (label, fn) => { fn(); passed++; console.log(`PASS ${label}`); };
const entries = new Map(), storage = { getItem: k => entries.get(k) || null, setItem: (k, v) => entries.set(k, v) };
const event = (code, extra = {}) => ({ code, preventDefault() { this.prevented = true; }, ...extra });
const fixture = () => {
  saveBindings(DEFAULT_BINDINGS, storage);
  const shifts = [], state = { isRunning: true, isPaused: false, racePhase: 'racing', keys: {}, cars: [{ shiftUp: () => shifts.push(1), shiftDown: () => shifts.push(-1) }] };
  return { state, shifts, input: createKeyboardControls(() => state) };
};
test('default and arrow presets are complete, unique and preserve legacy WASD arrow steering', () => {
  assert.ok(validateBindings(DEFAULT_BINDINGS)); assert.ok(validateBindings(ARROW_BINDINGS));
  assert.equal(CONTROL_ACTIONS.length, 7); saveBindings(DEFAULT_BINDINGS, storage);
  assert.equal(actionForCode('ArrowLeft'), 'left'); assert.equal(actionForCode('ArrowRight'), 'right');
});
test('menu/browser shortcuts and duplicate or missing assignments are rejected', () => {
  for (const code of ['Escape', 'KeyR', 'ControlLeft', 'AltLeft', 'MetaLeft', 'Tab', 'Enter', 'F5', 'F11', 'Delete', 'garbage']) assert.equal(allowedKey(code), false);
  assert.equal(validateBindings({ ...DEFAULT_BINDINGS, boost: 'KeyW' }), false);
  assert.equal(validateBindings({ accelerate: 'KeyW' }), false);
  assert.throws(() => saveBindings({ ...DEFAULT_BINDINGS, boost: 'F5' }, storage), /INVALID_BINDINGS/);
});
test('preferences round-trip safely; invalid/old/corrupt stored data falls back to defaults', () => {
  saveBindings(ARROW_BINDINGS, storage); assert.deepEqual(loadBindings(storage), ARROW_BINDINGS);
  for (const value of ['{', 'null', JSON.stringify({ version: 2, bindings: ARROW_BINDINGS }), JSON.stringify({ version: 1, bindings: { ...ARROW_BINDINGS, left: 'KeyR' } })]) {
    entries.set(CONTROLS_STORAGE_KEY, value); assert.deepEqual(loadBindings(storage), DEFAULT_BINDINGS);
  }
});
test('blocked storage permits session-only settings and cannot mutate returned preferences', () => {
  assert.equal(saveBindings(ARROW_BINDINGS, { setItem() { throw Error('blocked'); } }), false);
  const copy = getBindings(); copy.accelerate = 'KeyJ'; assert.equal(getBindings().accelerate, 'ArrowUp');
  assert.deepEqual(loadBindings(undefined), DEFAULT_BINDINGS);
});
test('custom keys map to canonical controls and old primary keys stop driving', () => {
  const { state, input } = fixture(); saveBindings({ ...DEFAULT_BINDINGS, accelerate: 'KeyI', brake: 'KeyK', left: 'KeyJ', right: 'KeyL', boost: 'ShiftLeft' }, storage);
  input.down(event('KeyW')); assert.ok(!state.keys.KeyW);
  input.down(event('KeyI')); input.down(event('ShiftLeft')); assert.equal(state.keys.KeyW, true); assert.equal(state.keys.Space, true); assert.ok(!state.keys.KeyI);
  input.up(event('KeyI')); assert.equal(state.keys.KeyW, false); assert.equal(state.keys.Space, true);
});
test('two physical aliases do not release each other and resets do not revive held inputs', () => {
  const { state, input } = fixture(); input.down(event('KeyA')); input.down(event('ArrowLeft')); input.up(event('KeyA')); assert.equal(state.keys.KeyA, true);
  state.keys = {}; input.down(event('KeyW')); assert.equal(state.keys.KeyA, false); assert.equal(state.keys.KeyW, true);
  input.clear(); input.down(event('KeyW', { repeat: true })); assert.ok(!state.keys.KeyW);
});
test('menus, text fields and modifier shortcuts cannot drive; focus loss releases boost', () => {
  const { state, input } = fixture(); input.down(event('Space')); assert.equal(state.keys.Space, true);
  input.down(event('KeyW'), true); assert.ok(!state.keys.Space && !state.keys.KeyW);
  input.down(event('KeyW', { ctrlKey: true })); assert.ok(!state.keys.KeyW);
  input.down(event('KeyW')); input.clear(); assert.ok(!state.keys.KeyW);
});
test('manual shifts are single-edge commands, not repeats or automatic/countdown shifts', () => {
  const { state, input, shifts } = fixture(); input.down(event('ArrowUp')); input.down(event('ArrowUp', { repeat: true })); input.up(event('ArrowUp')); input.down(event('ArrowDown'));
  assert.deepEqual(shifts, [1, -1]); state.cars[0].isAuto = true; input.down(event('ArrowUp')); assert.equal(shifts.length, 2);
  state.cars[0].isAuto = false; state.racePhase = 'countdown'; input.down(event('ArrowUp')); assert.equal(shifts.length, 2);
});
test('online controls use canonical input and the same remapped single-edge shift command', () => {
  const { state, input, shifts } = fixture(), remote = []; state.onlineSession = { queueShift: n => remote.push(n) }; saveBindings(ARROW_BINDINGS, storage);
  input.down(event('ArrowUp')); assert.equal(state.keys.KeyW, true); assert.deepEqual(remote, []);
  input.down(event('KeyE')); assert.deepEqual(remote, [1]); assert.deepEqual(shifts, []); input.clear(); assert.equal(remote.at(-1), 0);
});
test('display labels describe saved keys and do not expose raw browser codes', () => {
  assert.equal(keyLabel('KeyJ'), 'J'); assert.equal(keyLabel('Space'), 'ESPAÇO'); assert.equal(keyLabel('ArrowUp'), '↑'); assert.equal(keyLabel('Numpad2'), 'NUM 2');
});
console.log(`${passed} PASSOU | 0 FALHOU`);
