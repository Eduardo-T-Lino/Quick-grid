import { WebSocketServer, WebSocket } from 'ws';
import { RoomHub } from './rooms.js';

export function attachOnline(server, { production = false, allowedOrigins = [], hub = new RoomHub() } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const counts = new Map();
  const onUpgrade = (req, socket, head) => {
    if (req.url !== '/online') { if (server.listenerCount('upgrade') === 1) socket.destroy(); return; }
    let allowed = allowedOrigins.includes(req.headers.origin);
    if (!production) {
      try {
        const origin = new URL(req.headers.origin);
        allowed = ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host;
      } catch { allowed = false; }
    }
    const ip = req.socket.remoteAddress || 'unknown';
    if (!allowed || wss.clients.size >= 128 || (counts.get(ip) || 0) >= 16) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      counts.set(ip, (counts.get(ip) || 0) + 1);
      let player, messages = 0, actions = 0, windowStart = performance.now();
      const send = data => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 256 * 1024) { ws.terminate(); return; }
        if (data.type === 'snapshot' && ws.bufferedAmount > 64 * 1024) return;
        ws.send(JSON.stringify(data));
      };
      const handshake = setTimeout(() => { if (!player) ws.close(1008, 'Handshake timeout'); }, 5000);
      ws.alive = true;
      ws.on('pong', () => { ws.alive = true; });
      ws.on('message', (bytes, binary) => {
        const now = performance.now();
        if (now - windowStart >= 1000) { messages = 0; actions = 0; windowStart = now; }
        if (binary || ++messages > 60) { ws.close(1008, 'Rate limit'); return; }
        try {
          const data = JSON.parse(bytes.toString());
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('INVALID_REQUEST');
          if (!['input', 'ping'].includes(data.type) && ++actions > 10) { ws.close(1008, 'Rate limit'); return; }
          if (!player) { player = hub.attach(send, data); clearTimeout(handshake); }
          else if (data.type === 'leave') { hub.leave(player); ws.close(1000, 'Left room'); }
          else hub.command(player, data);
        } catch (error) {
          const codes = ['VERSION_MISMATCH', 'SESSION_EXPIRED', 'INVALID_REQUEST', 'SERVER_FULL', 'INVALID_SETTINGS',
            'INVALID_CODE', 'ROOM_NOT_FOUND', 'RACE_IN_PROGRESS', 'ROOM_FULL', 'INVALID_INPUT', 'INVALID_VOTE',
            'HOST_ONLY', 'NOT_READY', 'NEED_PLAYERS', 'INVALID_PHASE'];
          send({ type: 'error', code: codes.includes(error.message) ? error.message : 'INVALID_REQUEST' });
        }
      });
      ws.on('error', () => {});
      ws.on('close', () => {
        clearTimeout(handshake);
        const count = (counts.get(ip) || 1) - 1; count ? counts.set(ip, count) : counts.delete(ip);
        if (player && !player.expired) hub.disconnect(player);
      });
    });
  };
  server.on('upgrade', onUpgrade);
  const tick = setInterval(() => {
    try { hub.tick(); }
    catch {
      // Fail closed without leaking room data or repeatedly retrying corrupted state.
      console.error('[ONLINE] Simulation stopped after internal error');
      hub.rooms.clear(); hub.sessions.clear(); for (const ws of wss.clients) ws.close(1011, 'Simulation unavailable');
    }
  }, 1000 / 60);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  }, 10000);
  tick.unref(); heartbeat.unref();
  const close = () => {
    clearInterval(tick); clearInterval(heartbeat); server.off('upgrade', onUpgrade);
    for (const ws of wss.clients) ws.terminate(); wss.close();
    hub.rooms.clear(); hub.sessions.clear();
  };
  server.once('close', close);
  return { hub, close };
}
