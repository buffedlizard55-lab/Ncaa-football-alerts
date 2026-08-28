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
  // Keep every retained provider target explicitly allowlisted; this must never become an open proxy.
  if (pathname === '/api/espn') {
    let target;
    try {
      const rawTarget = new URL(req.url, 'http://localhost').searchParams.get('url');
      target = new URL(rawTarget || 'invalid:');
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'A valid allowlisted provider URL is required' }));
    }
    const allowedEspnHost = target.hostname === 'site.api.espn.com' || target.hostname === 'site.web.api.espn.com';
    const allowedEspnPath = /^\/apis\/site\/v2\/sports\/football\/college-football\/(?:scoreboard|summary)$/.test(target.pathname);
    const allowedEspn = allowedEspnHost && allowedEspnPath;
    // ESPN Core API plays collection — the verified historical PBP backfill
    // index (numeric event/competition ids only, never list endpoints).
    const allowedEspnCore = target.hostname === 'sports.core.api.espn.com' &&
      /^\/v2\/sports\/football\/leagues\/college-football\/events\/\d+\/competitions\/\d+\/plays$/.test(target.pathname);
    const allowedNcaaGraphql = target.hostname === 'sdataprod.ncaa.com' && target.pathname === '/';
    const allowedNcaaCommunity = target.hostname === 'ncaa-api.henrygd.me' && (
      /^\/scoreboard\/football\/fbs\/\d{4}\/\d{1,3}\/all-conf$/.test(target.pathname) ||
      /^\/game\/\d+(?:\/(?:boxscore|play-by-play|team-stats|scoring-summary))?$/.test(target.pathname)
    );
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
      return res.end(JSON.stringify({ error: 'Only GET requests are allowed' }));
    }
    const safeTarget = !target.username && !target.password && (!target.port || target.port === '443');
    if (target.protocol !== 'https:' || !safeTarget || (!allowedEspn && !allowedEspnCore && !allowedNcaaGraphql && !allowedNcaaCommunity)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Only allowlisted ESPN and NCAA provider URLs are allowed' }));
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
    upstream.on('timeout', () => upstream.destroy(new Error('Provider request timed out')));
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      if (!res.writableEnded) res.end(JSON.stringify({ error: 'Provider relay failed', detail: err.message }));
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
