const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Notre musée.html"));
});

const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, except) {
  for (const client of room.clients) {
    if (client !== except) send(client, data);
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "create" || msg.type === "join") {
      let roomId = msg.room;

      if (msg.type === "create") {
        roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
        rooms.set(roomId, { clients: new Set(), gameStates: {} });
      }

      const room = rooms.get(roomId);

      if (!room) {
        send(ws, { type: "error", message: "Salle introuvable." });
        return;
      }

      ws.roomId = roomId;
      ws.peerId = String(msg.peer || Math.random());
      ws.peerName = String(msg.name || "Invité");

      const peers = [...room.clients].map((client) => ({
        peer: client.peerId,
        name: client.peerName
      }));

      room.clients.add(ws);

      send(ws, {
        type: "joined",
        room: roomId,
        peers,
        gameStates: room.gameStates
      });

      broadcast(room, {
        type: "peer_join",
        peer: { peer: ws.peerId, name: ws.peerName }
      }, ws);

      return;
    }

    const room = rooms.get(ws.roomId);
    if (!room) return;

    if (msg.type === "presence") {
      broadcast(room, {
        type: "presence",
        peer: ws.peerId,
        data: msg.data
      }, ws);
    }

    if (msg.type === "event") {
      if (msg.name === "g" && msg.data?.t === "s") {
        room.gameStates[msg.data.g] = msg.data.s;
      }

      broadcast(room, {
        type: "event",
        name: msg.name,
        data: msg.data,
        peer: ws.peerId
      }, ws);
    }
  });

  ws.on("close", () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;

    room.clients.delete(ws);

    broadcast(room, {
      type: "peer_leave",
      peer: ws.peerId
    });

    if (room.clients.size === 0) {
      rooms.delete(ws.roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});
