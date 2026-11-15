'use strict';

const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { WebSocketServer, WebSocket } = require('ws');
const { GameRoom, STEP } = require('./room.cjs');
const { relayVoice } = require('./voice-relay.cjs');

function createGameServer({ maxRooms = 64 } = {}) {
  const rooms = new Map();
  const links = new Map();
  const server = http.createServer((request, response) => {
    let path;
    try { path = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400).end(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && path === '/health') {
      response.end(JSON.stringify({ ok: true, protocol: 'sharbel-realtime-v1', hz: 60 }));
    } else response.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 24576, perMessageDeflate: false });
  const send = (socket, data) => {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 65536) {
      socket.send(JSON.stringify(data));
    }
  };
  const keyFor = (room, id) => room.code + ':' + id;

  function broadcast(room) {
    for (const member of room.party.members) {
      const socket = links.get(keyFor(room, member.id));
      if (socket) send(socket, { type: 'state', state: room.snapshot(member.id) });
    }
  }

  function endRoom(room) {
    rooms.delete(room.code);
    for (const member of room.party.members) {
      const key = keyFor(room, member.id);
      const socket = links.get(key);
      if (socket) {
        send(socket, { type: 'ended', message: 'انتهت الغرفة' });
        socket.close(1000);
      }
      links.delete(key);
    }
  }

  server.on('upgrade', (request, socket, head) => {
    let path;
    try { path = new URL(request.url, 'http://localhost').pathname; }
    catch { socket.destroy(); return; }
    if (path !== '/ws' || sockets.clients.size >= 256) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client));
  });

  sockets.on('connection', socket => {
    let room = null;
    let playerId = null;
    let count = 0;
    let rateStart = Date.now();
    let alive = true;
    const authTimer = setTimeout(() => socket.close(4000, 'Session required'), 5000);

    function bind(targetRoom, session) {
      room = targetRoom;
      playerId = session.playerId;
      const key = keyFor(room, playerId);
      const old = links.get(key);
      links.set(key, socket);
      if (old && old !== socket) old.close(4001, 'Session resumed elsewhere');
      clearTimeout(authTimer);
      room.member(playerId).seen = Date.now();
      return { ...session, state: room.snapshot(playerId) };
    }

    socket.on('pong', () => {
      alive = true;
      const member = room?.party.members.find(item => item.id === playerId);
      if (member && !room.closed) member.seen = Date.now();
    });
    const pingTimer = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false;
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }, 10000);

    socket.on('message', (bytes, binary) => {
      let message;
      try {
        if (binary) throw Error('رسالة غير صالحة');
        const now = Date.now();
        if (now - rateStart > 1000) { count = 0; rateStart = now; }
        if (++count > 90) { socket.close(4002, 'Rate limit'); return; }
        message = JSON.parse(bytes.toString());
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error('رسالة غير صالحة');
        const requestId = message.requestId;
        if (requestId !== undefined && (typeof requestId !== 'string' || requestId.length > 48)) {
          throw Error('رقم طلب غير صالح');
        }
        let result;
        if (!room) {
          if (message.type === 'create') {
            if (rooms.size >= maxRooms) throw Error('الخادم مزدحم');
            let code;
            do { code = randomBytes(4).toString('hex').toUpperCase(); } while (rooms.has(code));
            const created = new GameRoom(code, message.name, message.level ?? 0);
            const session = created.createSession();
            rooms.set(code, created);
            result = bind(created, session);
          } else if (message.type === 'join' || message.type === 'resume') {
            const existing = rooms.get(message.code);
            if (!existing || existing.closed) throw Error('الغرفة غير موجودة أو انتهت');
            const session = message.type === 'join' ? existing.join(message.name) : {
              code: existing.code, token: message.token, playerId: existing.authenticate(message.token)
            };
            result = bind(existing, session);
          } else throw Error('ادخل غرفة أولاً');
        } else {
          room.member(playerId).seen = now;
          if (message.type === 'input') {
            const accepted = room.submit(playerId, message.round, message.commands);
            if (!accepted) send(socket, { type: 'resync', state: room.snapshot(playerId) });
            return;
          }
          if (message.type === 'ping') {
            send(socket, { type: 'pong', clientTime: message.clientTime, serverTime: now });
            return;
          }
          if (message.type === 'voice') {
            result = relayVoice(room, room.member(playerId), message, now);
          } else if (message.type === 'action') {
            if (!requestId) throw Error('رقم الطلب مطلوب');
            room.action(playerId, message.action, requestId);
            result = room.snapshot(playerId);
          } else if (message.type === 'leave') {
            room.leave(playerId);
            if (room.closed) endRoom(room);
            else broadcast(room);
            socket.close(1000);
            return;
          } else throw Error('طلب غير متاح');
        }
        send(socket, { type: 'reply', requestId, ok: true, result });
        broadcast(room);
      } catch (error) {
        send(socket, { type: 'reply', requestId: message?.requestId, ok: false, error: error.message });
      }
    });

    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(pingTimer);
      if (!room || room.closed) return;
      const key = keyFor(room, playerId);
      if (links.get(key) !== socket) return;
      links.delete(key);
      const member = room.party.members.find(item => item.id === playerId);
      if (!member) return;
      member.seen = Date.now();
      room.neutralize(playerId);
    });
  });

  let previous = performance.now();
  let carry = 0;
  let frames = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    carry += Math.min(2, (now - previous) / 1000);
    previous = now;
    while (carry >= STEP) {
      for (const room of rooms.values()) {
        for (const member of [...room.party.members]) {
          if (!links.has(keyFor(room, member.id)) && Date.now() - member.seen > 30000) room.leave(member.id);
        }
        if (room.closed) { endRoom(room); continue; }
        room.step();
        if (frames % 3 === 0) broadcast(room);
      }
      frames++;
      carry -= STEP;
    }
  }, 8);

  async function stop() {
    clearInterval(timer);
    for (const socket of sockets.clients) socket.terminate();
    await new Promise(resolve => sockets.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  return { server, stop };
}

if (require.main === module) {
  const app = createGameServer();
  app.server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => {
    console.log('sharbel game realtime server listening');
  });
  process.once('SIGTERM', () => app.stop().then(() => process.exit(0)));
  process.once('SIGINT', () => app.stop().then(() => process.exit(0)));
}

module.exports = { createGameServer };
