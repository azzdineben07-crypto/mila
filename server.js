'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();
const ROOM_TTL = 24 * 60 * 60 * 1000;
const clients = new Set();

function frame(opcode, payload = Buffer.alloc(0)) {
  payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (payload.length < 126) { header = Buffer.from([0x80 | opcode, payload.length]); }
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  return Buffer.concat([header, payload]);
}
function send(client, payload) {
  if (!client || client.socket.destroyed) return;
  const data = Buffer.from(JSON.stringify(payload));
  if (data.length > 65536) return;
  client.socket.write(frame(1, data));
}
function roomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 7; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}
function publicPeer(client) { return { peer: client.peer, kind: 'viewer', presence: client.presence || {} }; }
function broadcast(room, payload, except) { for (const client of room.clients.values()) if (client !== except) send(client, payload); }
function finite(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(-10000, Math.min(10000, n)) : 0; }
function leave(client) {
  if (!client.room || !client.peer) return;
  const room = client.room;
  room.clients.delete(client.peer);
  broadcast(room, { type: 'peer_leave', peer: client.peer });
  room.updatedAt = Date.now();
  client.room = null;
}
function processMessage(client, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString('utf8')); } catch { return send(client, { type: 'error', message: 'Message invalide.' }); }
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'create' || msg.type === 'join') {
    if (client.room) return send(client, { type: 'error', message: 'Cette connexion a déjà rejoint une partie.' });
    let id = msg.type === 'create' ? roomId() : String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (msg.type === 'create') while (rooms.has(id)) id = roomId();
    let room = rooms.get(id);
    if (!room && msg.type === 'join') return send(client, { type: 'error', message: 'Cette partie n’existe plus. Demande un nouveau lien à l’hôte.' });
    if (!room) { room = { id, clients: new Map(), gameStates: {}, createdAt: Date.now(), updatedAt: Date.now() }; rooms.set(id, room); }
    if (room.clients.size >= 2) return send(client, { type: 'error', message: 'Cette partie est déjà complète (2 joueurs maximum).' });
    const peer = String(msg.peer || '').slice(0, 40) || `${Date.now()}-${Math.random()}`;
    if (room.clients.has(peer)) return send(client, { type: 'error', message: 'Identifiant joueur déjà utilisé. Recharge la page.' });
    client.peer = peer; client.room = room;
    client.presence = { nm: String(msg.name || 'Invité').slice(0, 12) };
    room.clients.set(peer, client); room.updatedAt = Date.now();
    send(client, { type: 'joined', room: id, gameStates: room.gameStates, peers: [...room.clients.values()].map(publicPeer).map(p => ({ ...p, isMe: p.peer === peer, sameTab: p.peer === peer })) });
    broadcast(room, { type: 'peer_join', peer: publicPeer(client) }, client);
    return;
  }
  if (!client.room || !client.peer) return send(client, { type: 'error', message: 'Rejoins une partie avant de jouer.' });
  const room = client.room; room.updatedAt = Date.now();
  if (msg.type === 'presence') {
    if (!msg.data || typeof msg.data !== 'object') return;
    const d = msg.data;
    client.presence = { pid: d.pid === 1 ? 1 : 0, nm: String(d.nm || client.presence.nm || 'Invité').slice(0, 12), x: finite(d.x), y: finite(d.y), z: finite(d.z), r: finite(d.r), s: !!d.s, w: Number(d.w) || 0, a: Number(d.a) || 0 };
    broadcast(room, { type: 'presence', peer: client.peer, data: client.presence }, client);
  } else if (msg.type === 'event') {
    if (!['g', 'inv', 'hit'].includes(msg.name)) return;
    let data;
    try { data = JSON.parse(JSON.stringify(msg.data ?? null)); } catch { return; }
    if (Buffer.byteLength(JSON.stringify(data)) > 48 * 1024) return;
    if (msg.name === 'g' && data && data.t === 's' && Number.isInteger(data.g) && data.g >= 0 && data.g <= 7) room.gameStates[data.g] = data.s;
    broadcast(room, { type: 'event', name: msg.name, peer: client.peer, data }, client);
  }
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const requested = pathname === '/' ? '/notre-musee-mila-autonome.html' : pathname;
  const file = path.resolve(ROOT, '.' + requested);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
});
server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const client = { socket, buffer: Buffer.alloc(0), room: null, peer: null, presence: {} };
  clients.add(client);
  socket.on('data', chunk => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const b0 = client.buffer[0], b1 = client.buffer[1], opcode = b0 & 0x0f, masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, offset = 2;
      if (len === 126) { if (client.buffer.length < 4) return; len = client.buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (client.buffer.length < 10) return; const big = client.buffer.readBigUInt64BE(2); if (big > 65536n) { socket.destroy(); return; } len = Number(big); offset = 10; }
      const maskBytes = masked ? 4 : 0;
      if (client.buffer.length < offset + maskBytes + len) return;
      let payload = client.buffer.subarray(offset + maskBytes, offset + maskBytes + len);
      if (masked) { payload = Buffer.from(payload); const mask = client.buffer.subarray(offset, offset + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; }
      client.buffer = client.buffer.subarray(offset + maskBytes + len);
      if (opcode === 8) { socket.end(frame(8)); return; }
      if (opcode === 9) { socket.write(frame(10, payload)); continue; }
      if (opcode === 1) processMessage(client, payload);
    }
  });
  socket.on('close', () => { clients.delete(client); leave(client); });
  socket.on('end', () => { clients.delete(client); leave(client); });
  socket.on('error', () => { clients.delete(client); leave(client); });
});
setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL;
  for (const [id, room] of rooms) if (!room.clients.size && room.updatedAt < cutoff) rooms.delete(id);
}, 60 * 60 * 1000).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`Notre musée disponible sur le port ${PORT}`));
