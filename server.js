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

// Relay micro-cache policy (see the /api/espn handler). Only successful (200)
// provider bodies are cached; non-GET, rejected, or failing requests always
// reach the provider. A live day legitimately re-reads the same URLs (header
// feed, paced booth passes, adjacent-day probes) within a second — this caps
// the relay's own upstream fan-out at one provider request per URL per TTL.
const RELAY_CACHE_TTL_MS = Math.max(0, Number(process.env.RELAY_CACHE_TTL_MS ?? 1000));
const RELAY_CACHE_MAX_ENTRIES = 64;
const RELAY_CACHE_MAX_BYTES = 8 * 1024 * 1024;
// Test-only: delays starting the upstream request so offline tests can observe
// the single-flight join path without racing a sub-millisecond network failure.
const RELAY_TEST_LATENCY_MS = Math.max(0, Number(process.env.RELAY_TEST_LATENCY_MS || 0));
const relayCache = new Map();   // target URL -> { t, status, type, body }
const relayPending = new Map(); // target URL -> Promise<entry> (single-flight)

function relayCachePut(key, entry) {
  if (RELAY_CACHE_TTL_MS <= 0 || entry.status !== 200 || entry.body.length > RELAY_CACHE_MAX_BYTES) return;
  // Opportunistic pruning: drop expired entries, then the oldest ones.
  for (const [k, v] of relayCache) {
    if (Date.now() - v.t >= RELAY_CACHE_TTL_MS) relayCache.delete(k);
  }
  while (relayCache.size >= RELAY_CACHE_MAX_ENTRIES) {
    const oldest = relayCache.keys().next();
    if (oldest.done) break;
    relayCache.delete(oldest.value);
  }
  relayCache.set(key, entry);
}

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
  //
  // Micro-cache + single-flight (RELAY_CACHE_TTL_MS, default 1 s): a live day
  // makes many clients of the same URLs (the header feed, the paced booth
  // passes, adjacent-day probes). Collapsing identical upstream targets that
  // arrive within one TTL window to a single provider request protects the
  // public API from the relay's own fan-out and answers repeats from memory —
  // the scoreboard's day request never waits behind 39 booth fetches at the
  // provider. Cache is per-process, keyed by the exact allowlisted URL, only
  // for successful GETs, and entries are older than the TTL on use.
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
    const allowedEspnPath = /^\/apis\/site\/v2\/sports\/football\/college-football\/(?:scoreboard|summary)$/.test(target.pathname) ||
      /^\/apis\/v2\/scoreboard\/header$/.test(target.pathname);
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
    const cacheKey = target.href;
    const fresh = relayCache.get(cacheKey);
    const writeEntry = (entry, source) => {
      if (res.writableEnded) return;
      res.writeHead(entry.status, {
        'Content-Type': entry.type,
        'Cache-Control': 'no-store',
        'X-Relay-Cache': source,
      });
      res.end(entry.body);
    };
    if (fresh && Date.now() - fresh.t < RELAY_CACHE_TTL_MS) {
      return writeEntry(fresh, 'hit');
    }
    const joinPending = relayPending.get(cacheKey);
    if (joinPending) {
      // Waiters share this exact upstream attempt — one provider call per URL
      // per TTL window, however many booth + scoreboard requests asked for it.
      joinPending.then(
        (entry) => writeEntry(entry, 'shared'),
        () => {
          if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
          if (!res.writableEnded) res.end(JSON.stringify({ error: 'Provider relay failed', detail: 'shared request failed' }));
        }
      );
      return;
    }
    const pending = new Promise((resolve, reject) => {
      if (RELAY_TEST_LATENCY_MS > 0) setTimeout(startUpstream, RELAY_TEST_LATENCY_MS);
      else startUpstream();
      function startUpstream() {
      const upstream = https.get(target, {
        headers: { Accept: 'application/json', 'User-Agent': 'ncaa-football-scoreboard' },
        timeout: 15000,
      }, (up) => {
        const chunks = [];
        let size = 0;
        up.on('data', (c) => { chunks.push(c); size += c.length; });
        up.on('end', () => {
          const entry = {
            t: Date.now(),
            status: up.statusCode || 502,
            type: up.headers['content-type'] || 'application/json',
            body: Buffer.concat(chunks),
          };
          if (entry.status === 200) relayCachePut(cacheKey, entry);
          resolve(entry);
        });
        up.on('error', reject);
        up.on('aborted', () => reject(new Error('Provider response aborted')));
      });
      upstream.on('timeout', () => upstream.destroy(new Error('Provider request timed out')));
      upstream.on('error', reject);
      }
    });
    relayPending.set(cacheKey, pending);
    pending.then(
      (entry) => {
        relayPending.delete(cacheKey);
        writeEntry(entry, 'miss');
      },
      (err) => {
        relayPending.delete(cacheKey);
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
        if (!res.writableEnded) res.end(JSON.stringify({ error: 'Provider relay failed', detail: err.message }));
      }
    );
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
