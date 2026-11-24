// SECOND SELF multiplayer server.
// One Node process serves the built game (dist/) over HTTP and runs the
// co-op lobbies over a WebSocket at /ws. Works on Render (uses $PORT).
//
//   npm run build && npm start      then open http://localhost:8080

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { LobbyManager } from './lobby.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

const manager = new LobbyManager();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, ...manager.stats() }));
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(DIST, '.' + rel);
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(DIST, 'index.html');
    fs.readFile(target, (err2, buf) => {
      if (err2) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('SECOND SELF multiplayer server is running. Build the game (npm run build) to serve it from here too.');
        return;
      }
      const ext = path.extname(target).toLowerCase();
      const headers = { 'content-type': TYPES[ext] || 'application/octet-stream' };
      headers['cache-control'] = target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, headers);
      res.end(buf);
    });
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => manager.connect(ws, req));

// Detect dead connections (closed laptops, headsets taken off).
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* closed */ }
  }
}, 10000);

server.listen(PORT, () => console.log(`SECOND SELF server on port ${PORT} (WebSocket at /ws)`));

export { server, manager };
