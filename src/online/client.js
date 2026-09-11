import { ONLINE_VERSION, INPUT_KEYS, CAR_FIELDS } from './protocol.js';
import { state, startGame, backToMenu } from '../game.js';
import { SnapshotBuffer } from './snapshotBuffer.js';
import { raceStart } from '../raceStart.js';
import { mlTelemetry } from '../ml/telemetry/index.js';

// Server-authoritative client: no positions, times, points or lap counts are sent.
export class OnlineClient extends EventTarget {
  constructor() { super(); this.id = null; this.room = null; this.token = null; this.sequence = 0; this.raceId = null; this.snapshots = new SnapshotBuffer(); }
  event(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  connect(request) {
    this.stopped = false; this.request = request; this.retryStarted = null;
    this.open();
  }
  open() {
    const configured = import.meta.env?.VITE_ONLINE_URL;
    const url = configured || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/online`;
    this.event('status', 'Conectando…');
    try { this.socket = new WebSocket(url); }
    catch { this.event('error', 'DISCONNECTED'); this.leave(); return; }
    const socket = this.socket;
    const connectTimeout = setTimeout(() => { if (socket.readyState === WebSocket.CONNECTING) socket.close(); }, 8000);
    socket.addEventListener('open', () => {
      clearTimeout(connectTimeout);
      this.send({ ...(this.token ? { type: 'resume', token: this.token } : this.request), version: ONLINE_VERSION });
    });
    socket.addEventListener('message', event => {
      if (socket !== this.socket) return;
      const message = JSON.parse(event.data);
      if (message.type === 'welcome') {
        this.id = message.id; this.token = message.token; this.retryStarted = null; this.snapshots.reset();
        this.event('status', 'Conectado'); this.applyRoom(message.room);
        if (message.snapshot) this.pendingSnapshot = { cars: message.snapshot, raceId: message.room.raceId,
          phase: message.room.phase, remainingMs: message.room.remainingMs };
      } else if (message.type === 'room') this.applyRoom(message.room);
      else if (message.type === 'snapshot' && message.raceId === this.raceId) {
        this.pendingSnapshot = message;
        this.snapshots.push(message, performance.now());
      }
      else if (message.type === 'error') {
        this.event('error', message.code);
        if (['VERSION_MISMATCH', 'SESSION_EXPIRED', 'ROOM_EXPIRED'].includes(message.code) || !this.token) this.leave();
      } else if (message.type === 'pong') this.event('ping', Math.max(0, Math.round(performance.now() - message.at)));
    });
    socket.addEventListener('close', () => {
      clearTimeout(connectTimeout);
      if (this.stopped || socket !== this.socket) return;
      state.keys = {}; this.event('status', 'Conexão perdida. Reconectando…');
      this.retryStarted ||= performance.now();
      if (!this.token || performance.now() - this.retryStarted > 18000) {
        this.event('error', 'DISCONNECTED'); this.leave(); return;
      }
      this.retry = setTimeout(() => this.open(), 1000);
    });
    socket.addEventListener('error', () => {});
    clearInterval(this.pump);
    this.pump = setInterval(() => {
      if (!this.token) return;
      const now = performance.now(), blocked = document.hidden || Boolean(document.querySelector('dialog[open]'));
      const keys = Object.fromEntries(INPUT_KEYS.map(k => [k, !blocked && Boolean(state.keys[k])]));
      const signature = INPUT_KEYS.map(k => Number(keys[k])).join(''), shift = blocked ? 0 : (this.shift || 0);
      // Poll at frame cadence, transmit changed commands at <=30Hz and keepalive at 10Hz.
      if (now - (this.lastInputAt || 0) >= 34 && (signature !== this.lastInput || shift || now - this.lastInputAt >= 100)) {
        this.send({ type: 'input', seq: ++this.sequence, keys, shift });
        this.lastInput = signature; this.lastInputAt = now; this.shift = 0;
      }
      if (performance.now() - (this.lastPing || 0) > 1000) {
        this.lastPing = performance.now(); this.send({ type: 'ping', at: this.lastPing });
      }
    }, 16);
  }
  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 8192) this.socket.send(JSON.stringify(message));
  }
  applyRoom(room) {
    this.room = room;
    if (['loading', 'countdown', 'racing'].includes(room.phase) && this.raceId !== room.raceId) this.prepareRace(room);
    if (room.phase === 'results' && state.onlineSession) {
      this.transitioning = true; backToMenu(); this.transitioning = false;
    }
    this.event('room', room);
  }
  async prepareRace(room) {
    this.raceId = room.raceId; this.pendingSnapshot = null; this.snapshots.reset();
    if (state.isRunning) { this.transitioning = true; backToMenu(); this.transitioning = false; }
    mlTelemetry.stop();
    const session = { id: this.id, players: room.players, menu: () => this.event('menu'),
      frame: now => this.frame(now), samplePose: (car, now) => this.snapshots.sample(car, now),
      diagnostics: () => this.snapshots.diagnostics(performance.now()) };
    try {
      await startGame({ onlineSession: session, gameMode: 'online', transMode: 'auto', trackCondition: room.settings.weather,
        trackSelect: room.trackId, lapCount: room.settings.laps, botDifficulty: 'pro', botCount: 0 });
      this.send({ type: 'loaded', raceId: room.raceId }); this.event('racing');
    } catch { this.event('error', 'LOAD_FAILED'); this.leave(); }
  }
  frame(now) {
    const snapshot = this.pendingSnapshot;
    if (!snapshot || snapshot.raceId !== this.raceId) return;
    this.pendingSnapshot = null;
    state.racePhase = snapshot.phase;
    if (snapshot.phase === 'countdown') {
      raceStart.phase = 'countdown'; raceStart.lights = Math.min(5, Math.max(0, Math.floor((6000 - snapshot.remainingMs) / 1000)));
    } else if (snapshot.phase === 'racing') {
      if (raceStart.phase !== 'racing') raceStart.releasedAt = now;
      raceStart.phase = 'racing'; raceStart.lights = 0;
    } else raceStart.reset();
    for (const value of snapshot.cars) {
      const car = state.cars.find(c => c.id === value.id); if (!car) continue;
      for (const key of CAR_FIELDS) if (Object.hasOwn(value, key)) car[key] = value[key];
    }
  }
  leave() {
    this.stopped = true; clearTimeout(this.retry); clearInterval(this.pump);
    this.send({ type: 'leave' }); this.socket?.close(); this.token = null; this.room = null; this.raceId = null;
    this.pendingSnapshot = null; this.sequence = 0; this.lastInputAt = 0; this.lastInput = null; this.shift = 0; this.snapshots.reset();
    if (state.onlineSession) { this.transitioning = true; backToMenu(); this.transitioning = false; }
    this.event('left');
  }
}
