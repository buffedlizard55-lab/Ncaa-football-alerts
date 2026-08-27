'use strict';
/*
 * Zero-dependency static file server for the NCAA Football Scoreboard.
 * Binds to 0.0.0.0 so it works inside the preview proxy.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Bad request');
  }

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'ncaa-football-scoreboard' }));
  }

  // Same-origin data relay. The browser calls this route instead of making a
  // cross-origin request, so provider CORS policy cannot blank the scoreboard.
  // Keep both provider targets allowlisted; this must never become an open proxy.
  if (pathname === '/api/espn') {
    let target;
    try {
      const rawTarget = new URL(req.url, 'http://localhost').searchParams.get('url');
      target = new URL(rawTarget || 'invalid:');
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'A valid ESPN API URL is required' }));
    }
    const allowedEspn = target.hostname === 'site.api.espn.com' && target.pathname.startsWith('/apis/site/v2/');
    // NCAA's public scoreboard GraphQL endpoint is a useful independent
    // fallback when ESPN is unavailable. Keep it allowlisted just like ESPN;
    // this route must never become an open proxy.
    const allowedNcaa = target.hostname === 'sdataprod.ncaa.com' && target.pathname === '/';
    const allowedNcaaApi = target.hostname === 'ncaa-api.henrygd.me' && target.pathname.startsWith('/scoreboard/football/fbs/');
    if (target.protocol !== 'https:' || (!allowedEspn && !allowedNcaa && !allowedNcaaApi)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Only allowlisted ESPN or NCAA scoreboard URLs are allowed' }));
    }
    const upstream = https.get(target, {
      headers: { Accept: 'application/json', 'User-Agent': 'ncaa-football-scoreboard' },
      timeout: 15000,
    }, (up) => {
      res.writeHead(up.statusCode || 502, {
        'Content-Type': up.headers['content-type'] || 'application/json',
        'Cache-Control': 'no-store',
      });
      up.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('ESPN request timed out')));
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      if (!res.writableEnded) res.end(JSON.stringify({ error: 'ESPN relay failed', detail: err.message }));
    });
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  // Resolve and confine to the app root (no traversal).
  const file = path.normalize(path.join(ROOT, pathname));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`NCAA Football Scoreboard listening on http://${HOST}:${PORT}`);
});
