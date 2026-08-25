// server.js
// Tiny static file server (no dependencies). It serves the client app and
// exposes an optional same-origin ESPN proxy at /api/espn?url=... so the app
// also works when the *server* has internet. In the preview sandbox the server
// has no outbound internet, so the browser falls back to direct/proxy sources.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { URL, URLSearchParams } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const ALLOWED_HOSTS = new Set(['site.api.espn.com', 'site.web.api.espn.com', 'cdn.espn.com']);

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let target = pathname === '/' ? '/index.html' : pathname;
  target = target.replace(/\/+/g, '/').replace(/^\/+/, '');
  const file = path.resolve(root, target);
  if (!file.startsWith(root + path.sep) && file !== root) {
    return send(res, 403, 'Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=0'
    });
    res.end(data);
  });
}

function fetchUpstream(url, onData, onError) {
  const req = https.get(url, { headers: { 'User-Agent': 'ncaa-football-scoreboard/1.0' } }, (upstream) => {
    if (upstream.statusCode !== 200) {
      upstream.resume();
      onError(new Error(`Upstream HTTP ${upstream.statusCode}`));
      return;
    }
    onData(upstream);
  });
  req.setTimeout(9000, () => {
    req.destroy(new Error('Upstream timeout'));
  });
  req.on('error', onError);
}

function proxyEspn(req, res, url) {
  const parsed = new URL(url);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return send(res, 403, JSON.stringify({ error: 'Host not allowed' }), 'application/json');
  }
  fetchUpstream(
    parsed.toString(),
    (upstream) => {
      let chunks = '';
      upstream.setEncoding('utf8');
      upstream.on('data', (c) => {
        chunks += c;
        if (chunks.length > 25 * 1024 * 1024) {
          upstream.destroy();
          send(res, 504, JSON.stringify({ error: 'Response too large' }), 'application/json');
        }
      });
      upstream.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=15',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(chunks);
      });
    },
    (err) => send(res, 502, JSON.stringify({ error: err.message }), 'application/json')
  );
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/espn') {
    const target = url.searchParams.get('url');
    if (!target) return send(res, 400, JSON.stringify({ error: 'Missing url' }), 'application/json');
    return proxyEspn(req, res, target);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed');
  }
  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NCAA Football Scoreboard serving on http://0.0.0.0:${PORT}`);
});
