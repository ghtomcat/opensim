/* ═══════════════════════════════════════════════════════════════
   OpenSim — server/hub.js
   Minimal WebSocket hub. Run with: node server/hub.js
   Rooms: PF, PM, INSTRUCTOR share state in a session.
   ═══════════════════════════════════════════════════════════════ */

import { WebSocketServer } from 'ws';
import { createServer }    from 'http';

const PORT = process.env.PORT || 3000;

const server = createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OpenSim hub running');
});

const wss = new WebSocketServer({ server });

/* rooms: Map<roomId, Set<ws>> */
const rooms = new Map();

wss.on('connection', (ws) => {
  let roomId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    /* JOIN — client announces its room */
    if (msg.type === 'JOIN') {
      roomId = msg.room ?? 'default';
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      rooms.get(roomId).add(ws);

      console.log(`[hub] ${msg.role ?? '?'} joined room ${roomId} (${rooms.get(roomId).size} total)`);

      /* Acknowledge */
      ws.send(JSON.stringify({ type: 'JOINED', room: roomId, peers: rooms.get(roomId).size - 1 }));
      return;
    }

    /* STATE_PATCH — broadcast to everyone else in room */
    if (msg.type === 'STATE_PATCH' && roomId) {
      const room = rooms.get(roomId);
      if (!room) return;
      const out = JSON.stringify(msg);
      for (const peer of room) {
        if (peer !== ws && peer.readyState === 1) {
          peer.send(out);
        }
      }
      return;
    }

    /* CREW_EVENT — broadcast crew audio triggers to peers */
    if (msg.type === 'CREW_EVENT' && roomId) {
      const room = rooms.get(roomId);
      if (!room) return;
      const out = JSON.stringify(msg);
      for (const peer of room) {
        if (peer !== ws && peer.readyState === 1) peer.send(out);
      }
    }
  });

  ws.on('close', () => {
    if (roomId && rooms.has(roomId)) {
      rooms.get(roomId).delete(ws);
      if (rooms.get(roomId).size === 0) rooms.delete(roomId);
      console.log(`[hub] client left room ${roomId}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[hub] OpenSim hub listening on ws://localhost:${PORT}`);
});
