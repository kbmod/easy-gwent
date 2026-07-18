import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  redactState,
  type ClientMsg,
  type PlayerId,
  type ProtocolErrorCode,
  type ServerMsg,
} from '@gwent/engine';
import { Rooms } from './rooms.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Client production build, if present (packages/client/dist). */
const STATIC_DIR =
  process.env.STATIC_DIR ??
  path.resolve(__dirname, '../../client/dist');

const rooms = new Rooms();

interface SeatConn {
  ws: WebSocket;
  seat: PlayerId;
  roomId: string;
}

/** roomId → sockets for seat 0 and 1 (null if not connected). */
const roomSeats = new Map<string, [WebSocket | null, WebSocket | null]>();
const connByWs = new Map<WebSocket, SeatConn | { seat: null; roomId: null }>();

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function error(ws: WebSocket, code: ProtocolErrorCode, message: string): void {
  send(ws, { t: 'error', code, message });
}

function broadcastState(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room?.state) return;
  const seats = roomSeats.get(roomId);
  if (!seats) return;
  for (const seat of [0, 1] as const) {
    const ws = seats[seat];
    if (ws && ws.readyState === ws.OPEN) {
      send(ws, { t: 'state', state: redactState(room.state, seat) });
    }
  }
}

function bindSeat(ws: WebSocket, roomId: string, seat: PlayerId): void {
  let seats = roomSeats.get(roomId);
  if (!seats) {
    seats = [null, null];
    roomSeats.set(roomId, seats);
  }
  seats[seat] = ws;
  connByWs.set(ws, { ws, seat, roomId });
}

function clearSeat(ws: WebSocket): void {
  const conn = connByWs.get(ws);
  connByWs.delete(ws);
  if (!conn || conn.seat === null || !conn.roomId) return;

  const seats = roomSeats.get(conn.roomId);
  if (seats && seats[conn.seat] === ws) seats[conn.seat] = null;

  const other = seats?.[1 - conn.seat] ?? null;
  if (other && other.readyState === other.OPEN) {
    send(other, { t: 'opponent_left' });
  }

  // Tear down room when either player leaves (authoritative game ends).
  rooms.remove(conn.roomId);
  roomSeats.delete(conn.roomId);
  if (other && other !== ws) {
    connByWs.set(other, { seat: null, roomId: null });
  }
}

function handleMessage(ws: WebSocket, raw: string): void {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw) as ClientMsg;
  } catch {
    error(ws, 'bad_message', 'Invalid JSON');
    return;
  }
  if (!msg || typeof msg !== 'object' || !('t' in msg)) {
    error(ws, 'bad_message', 'Missing message type');
    return;
  }

  switch (msg.t) {
    case 'create_room': {
      const existing = connByWs.get(ws);
      if (existing && existing.seat !== null) clearSeat(ws);
      const result = rooms.create(msg.deck);
      if (!result.ok) {
        error(ws, result.code, result.message);
        return;
      }
      bindSeat(ws, result.value.id, 0);
      send(ws, { t: 'room_created', roomId: result.value.id });
      return;
    }

    case 'join_room': {
      const result = rooms.join(msg.roomId, msg.deck);
      if (!result.ok) {
        error(ws, result.code, result.message);
        return;
      }
      const room = result.value;
      bindSeat(ws, room.id, 1);

      const seats = roomSeats.get(room.id)!;
      const host = seats[0];
      const deck0 = room.decks[0]!;
      const deck1 = room.decks[1]!;

      if (host && host.readyState === host.OPEN) {
        send(host, {
          t: 'joined',
          roomId: room.id,
          you: 0,
          opponentFaction: deck1.faction,
        });
      }
      send(ws, {
        t: 'joined',
        roomId: room.id,
        you: 1,
        opponentFaction: deck0.faction,
      });
      broadcastState(room.id);
      return;
    }

    case 'action': {
      const conn = connByWs.get(ws);
      if (!conn || conn.seat === null || !conn.roomId) {
        error(ws, 'not_in_room', 'Not in a room');
        return;
      }
      // Force seat — never trust client-supplied player id.
      const action = { ...msg.action, player: conn.seat };
      const result = rooms.act(conn.roomId, conn.seat, action);
      if (!result.ok) {
        error(ws, result.code, result.message);
        return;
      }
      broadcastState(conn.roomId);
      return;
    }

    case 'leave': {
      clearSeat(ws);
      connByWs.set(ws, { seat: null, roomId: null });
      return;
    }

    default:
      error(ws, 'bad_message', `Unknown message type`);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!fs.existsSync(STATIC_DIR)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      `easy-gwent multiplayer server on :${PORT}\n` +
        `WebSocket: ws://<host>:${PORT}\n` +
        `No client build found at ${STATIC_DIR}\n` +
        `Run: npm run build -w @gwent/client\n`,
    );
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  // Prevent path traversal
  const filePath = path.normalize(path.join(STATIC_DIR, rel));
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  const trySend = (p: string): boolean => {
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return false;
    const ext = path.extname(p);
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
    return true;
  };

  if (trySend(filePath)) return;
  // SPA fallback
  if (trySend(path.join(STATIC_DIR, 'index.html'))) return;
  res.writeHead(404).end('Not found');
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405).end('Method not allowed');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  connByWs.set(ws, { seat: null, roomId: null });

  ws.on('message', (data) => {
    handleMessage(ws, typeof data === 'string' ? data : data.toString('utf8'));
  });

  ws.on('close', () => {
    clearSeat(ws);
  });

  ws.on('error', () => {
    clearSeat(ws);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`easy-gwent server listening on http://${HOST}:${PORT}`);
  console.log(`  static: ${fs.existsSync(STATIC_DIR) ? STATIC_DIR : '(none — WS only)'}`);
});
