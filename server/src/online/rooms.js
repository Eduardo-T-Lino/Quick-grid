import { randomBytes, randomInt } from 'node:crypto';
import { F1_TRACKS } from '../../../src/f1Tracks.js';
import { ONLINE_LIMITS, ONLINE_VERSION, INPUT_KEYS, POINTS, validPilot } from '../../../src/online/protocol.js';
import { OnlineSimulation } from './simulation.js';

const colors = ['#ff414d', '#468fff', '#ffd44b', '#4bdda1', '#c77dff', '#ff9b45', '#6cdeff', '#ff80bf'];
const fail = code => { throw new Error(code); };
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
export class RoomHub {
  constructor({ clock = () => performance.now(), pick = randomInt, Simulation = OnlineSimulation } = {}) {
    this.rooms = new Map(); this.sessions = new Map(); this.clock = clock; this.pick = pick; this.Simulation = Simulation;
  }
  send(player, message) { if (player.connected) player.send(message); }
  broadcast(room, message) { for (const p of room.players) this.send(p, message); }
  publicRoom(room) {
    return { code: room.code, host: room.host, phase: room.phase, settings: room.settings, round: room.round,
      players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, auto: p.auto, ready: p.ready,
        connected: p.connected, points: p.points })), candidates: room.candidates, votes: room.votes,
      remainingMs: Math.max(0, (room.deadline || 0) - this.clock()), trackId: room.trackId,
      results: room.results, complete: room.complete, raceId: room.raceId };
  }
  publish(room) { this.broadcast(room, { type: 'room', room: this.publicRoom(room) }); }
  attach(send, message) {
    if (message.version !== ONLINE_VERSION) fail('VERSION_MISMATCH');
    const now = this.clock();
    if (message.type === 'resume') {
      const player = this.sessions.get(message.token);
      if (!player || player.connected || now - player.disconnectedAt > ONLINE_LIMITS.reconnectMs) fail('SESSION_EXPIRED');
      player.send = send; player.connected = true; player.keys = {}; player.inputAt = now;
      this.welcome(player); this.publish(player.room); return player;
    }
    if (!['create', 'join'].includes(message.type) || !validPilot(message.name) || typeof message.auto !== 'boolean') fail('INVALID_REQUEST');
    let room;
    if (message.type === 'create') {
      if (this.rooms.size >= ONLINE_LIMITS.rooms) fail('SERVER_FULL');
      const s = message.settings;
      if (!s || !integer(s.laps, 3, 80) || !integer(s.rounds, 1, ONLINE_LIMITS.rounds)
        || !['dry', 'wet'].includes(s.weather) || !F1_TRACKS.some(t => t.id === s.trackId)) fail('INVALID_SETTINGS');
      let code;
      do { code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (this.rooms.has(code));
      room = { code, players: [], phase: 'lobby', settings: { laps: s.laps, rounds: s.rounds, weather: s.weather,
        trackId: s.trackId }, round: 0, candidates: [], votes: {}, played: [], results: [], complete: false,
        createdAt: now, touchedAt: now, raceId: 0 };
      this.rooms.set(code, room);
    } else {
      if (typeof message.code !== 'string' || !/^[A-F0-9]{6}$/.test(message.code)) fail('INVALID_CODE');
      room = this.rooms.get(message.code);
      if (!room) fail('ROOM_NOT_FOUND');
      if (room.phase !== 'lobby') fail('RACE_IN_PROGRESS');
      if (room.players.length >= ONLINE_LIMITS.players) fail('ROOM_FULL');
    }
    const player = { id: randomBytes(8).toString('hex'), token: randomBytes(32).toString('hex'), room, send,
      connected: true, name: message.name.trim(), auto: message.auto, ready: false,
      color: colors.find(color => !room.players.some(p => p.color === color)), points: 0, keys: {}, inputAt: now, sequence: -1 };
    room.players.push(player); room.host ||= player.id; room.touchedAt = now; this.sessions.set(player.token, player);
    this.welcome(player); this.publish(room); return player;
  }
  welcome(player) {
    this.send(player, { type: 'welcome', id: player.id, token: player.token, room: this.publicRoom(player.room),
      snapshot: player.room.sim?.snapshot() });
  }
  command(player, m) {
    const room = player.room, now = this.clock(); room.touchedAt = now;
    if (m.type === 'ping') { this.send(player, { type: 'pong', at: m.at }); return; }
    if (m.type === 'input') {
      if (!integer(m.seq, 0, Number.MAX_SAFE_INTEGER) || m.seq <= player.sequence || !m.keys || typeof m.keys !== 'object'
        || INPUT_KEYS.some(key => typeof m.keys[key] !== 'boolean') || ![-1, 0, 1].includes(m.shift)) fail('INVALID_INPUT');
      player.sequence = m.seq; player.keys = Object.fromEntries(INPUT_KEYS.map(key => [key, m.keys[key]]));
      player.shift = m.shift; player.inputAt = now; return;
    }
    if (m.type === 'ready' && room.phase === 'lobby') { player.ready = m.ready === true; this.publish(room); return; }
    if (m.type === 'loaded' && room.phase === 'loading' && m.raceId === room.raceId) { player.loaded = true; return; }
    if (m.type === 'vote' && room.phase === 'voting') {
      if (!room.candidates.includes(m.trackId)) fail('INVALID_VOTE');
      room.votes[player.id] = m.trackId; this.publish(room);
      if (room.players.filter(p => p.connected).every(p => room.votes[p.id])) this.resolveVote(room);
      return;
    }
    if (m.type === 'start') {
      if (room.host !== player.id) fail('HOST_ONLY');
      if (room.phase === 'lobby') {
        if (room.players.filter(p => p.connected).length < 2 || room.players.some(p => !p.ready || !p.connected)) fail('NOT_READY');
      } else if (room.phase !== 'results' || room.complete) fail('INVALID_PHASE');
      if (room.players.filter(p => p.connected).length < 2) fail('NEED_PLAYERS');
      room.round++;
      if (room.settings.rounds > 1) {
        const eligible = F1_TRACKS.map(t => t.id).filter(id => !room.played.includes(id));
        room.candidates = [];
        while (room.candidates.length < 3) room.candidates.push(eligible.splice(this.pick(eligible.length), 1)[0]);
        room.votes = {}; room.phase = 'voting'; room.deadline = now + ONLINE_LIMITS.voteMs; this.publish(room);
      } else this.loadRace(room, room.settings.trackId);
      return;
    }
    fail('INVALID_PHASE');
  }
  resolveVote(room) {
    const counts = room.candidates.map(id => Object.values(room.votes).filter(v => v === id).length);
    const highest = Math.max(...counts), tied = room.candidates.filter((id, i) => counts[i] === highest);
    this.loadRace(room, tied[this.pick(tied.length)]);
  }
  loadRace(room, trackId) {
    room.trackId = trackId; room.played.push(trackId); room.raceId++;
    room.phase = 'loading'; room.deadline = this.clock() + 20000; room.results = [];
    room.sim = new this.Simulation(trackId, room.settings.laps, room.settings.weather, room.players);
    for (const p of room.players) { p.loaded = false; p.keys = {}; p.shift = 0; if (p.expired) room.sim.retire(p.id); }
    this.publish(room);
  }
  disconnect(player) {
    if (!player.connected) return;
    player.connected = false; player.disconnectedAt = this.clock(); player.keys = {}; player.shift = 0;
    if (player.room.host === player.id) player.room.host = player.room.players.find(p => p.connected)?.id || player.id;
    this.publish(player.room);
  }
  leave(player) { this.disconnect(player); player.disconnectedAt = this.clock() - ONLINE_LIMITS.reconnectMs - 1; this.expire(player); }
  expire(player) {
    this.sessions.delete(player.token);
    const room = player.room;
    if (room.phase === 'lobby') room.players = room.players.filter(p => p !== player);
    else room.sim?.retire(player.id);
    player.expired = true;
    if (!room.players.some(p => !p.expired)) this.rooms.delete(room.code);
    else this.publish(room);
  }
  tick() {
    const now = this.clock();
    for (const room of this.rooms.values()) {
      for (const p of room.players) if (!p.connected && !p.expired && now - p.disconnectedAt > ONLINE_LIMITS.reconnectMs) this.expire(p);
      if (room.phase === 'lobby' && now - room.touchedAt > 30 * 60 * 1000) {
        this.broadcast(room, { type: 'error', code: 'ROOM_EXPIRED' });
        for (const p of room.players) this.sessions.delete(p.token);
        this.rooms.delete(room.code); continue;
      }
      if (room.phase === 'voting' && now >= room.deadline) this.resolveVote(room);
      if (room.phase === 'loading' && (now >= room.deadline || room.players.filter(p => p.connected).every(p => p.loaded))) {
        room.phase = 'countdown'; room.deadline = now + 6000; this.publish(room);
      }
      if (room.phase === 'countdown' && now >= room.deadline) {
        room.phase = 'racing'; room.lastTick = now; room.sim.start(now); this.publish(room);
      }
      if (room.phase === 'racing') {
        let steps = 0;
        while (now - room.lastTick >= 1000 / 60 && steps++ < 6) {
          room.lastTick += 1000 / 60;
          if (room.sim.tick(room.players, now)) { this.finish(room); break; }
        }
        if (steps > 6) room.lastTick = now; // Never spiral on an overloaded host.
      }
      if (room.sim && now >= (room.nextSnapshot || 0)) {
        room.nextSnapshot = room.nextSnapshot ? room.nextSnapshot + (Math.floor((now - room.nextSnapshot) / 50) + 1) * 50 : now + 50;
        room.lastSnapshot = now;
        this.broadcast(room, { type: 'snapshot', raceId: room.raceId, phase: room.phase,
          serverTime: room.phase === 'racing' ? room.lastTick : now,
          remainingMs: Math.max(0, (room.deadline || 0) - now), cars: room.sim.snapshot() });
      }
    }
  }
  finish(room) {
    if (room.phase === 'results') return;
    room.results = room.sim.results();
    for (const result of room.results) {
      const player = room.players.find(p => p.id === result.id);
      if (result.finished) player.points += POINTS[result.rank - 1] || 0;
    }
    room.phase = 'results'; room.complete = room.round >= room.settings.rounds; this.publish(room);
  }
}
