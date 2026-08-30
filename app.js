/* ============================================================
 * NCAA Football Scoreboard
 * Data sources: ESPN public JSON API first, with verified NCAA fallbacks.
 * Text only. No videos.
 *
 * Every endpoint/parameter used here was verified against live
 * API responses on 2026-08-27 (see README.md for the evidence).
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NCBS = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
  // ESPN serves the same public JSON contract from this second host. It was
  // independently checked on 2026-08-26 and is used only as a provider-host
  // fallback, never as a made-up endpoint.
  var ESPN_WEB_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports/football/college-football';
  var NCAA_GRAPHQL_BASE = 'https://sdataprod.ncaa.com';
  var NCAA_COMMUNITY_BASE = 'https://ncaa-api.henrygd.me';
  // Browser-safe last-resort transport. The Reader endpoint fetches the same
  // public JSON URL server-side and returns its content as text/JSON. It is a
  // transport fallback only — ESPN/NCAA remain the data providers. This is
  // important in hosted previews where the app's Node relay may be unable to
  // establish outbound TLS and the provider may not expose CORS.
  var JINA_READER_BASE = 'https://r.jina.ai/';

  /* Conference group IDs for the scoreboard `groups=` filter.
   * Verified 2026-08-25 against live responses:
   *   1   = ACC      (Virginia & Wake Forest games returned; conferenceId "1")
   *   4   = Big 12   (TCU games returned; conferenceId "4")
   *   5   = Big Ten  (Ohio State @ Purdue; conferenceId "5")
   *   8   = SEC      (Texas A&M @ Missouri; conferenceId "8")
   *   151 = American (Navy @ Notre Dame returned under groups=151)
   */
  var CONFERENCES = [
    { id: '1',   short: 'ACC',      name: 'Atlantic Coast Conference' },
    { id: '8',   short: 'SEC',      name: 'Southeastern Conference' },
    { id: '5',   short: 'Big Ten',  name: 'Big Ten Conference' },
    { id: '4',   short: 'Big 12',   name: 'Big 12 Conference' },
    { id: '151', short: 'American', name: 'American Athletic Conference' }
  ];

  function scoreboardUrl(dateStr, groupId) {
    var u = API_BASE + '/scoreboard?dates=' + encodeURIComponent(dateStr) + '&limit=300';
    // Keep commas raw for callers that intentionally build a multi-group
    // diagnostic URL. The live loader does NOT use a combined list: ESPN
    // currently returns placeholder `{}` events for comma-separated groups.
    if (groupId) u += '&groups=' + groupId;
    return u;
  }

  // Ranged query for the nearby-games search. The no-group form was
  // independently verified on 2026-08-26 to return complete event objects.
  // Note: ranged responses carry `"calendar": []` — only single-day
  // responses include the season calendar.
  function scoreboardRangeUrl(fromStr, toStr, groupId) {
    var u = API_BASE + '/scoreboard?dates=' + encodeURIComponent(fromStr + '-' + toStr) + '&limit=500';
    if (groupId) u += '&groups=' + groupId;
    return u;
  }

  // The game-detail endpoint uses `event=` (NOT `gameId=` — that returns
  // "invalid URI" / 404, verified 2026-08-25).
  function summaryUrl(gameId) {
    return API_BASE + '/summary?event=' + encodeURIComponent(gameId);
  }

  // ESPN Core API plays collection for an event. A completed game's summary
  // normally carries PBP inside drives[].plays, but ESPN serves that section
  // in at least two shapes (plain array and {"previous": [...]} — see
  // summaryDrivesOf) and omits it entirely for some legacy summaries. The
  // Core API still indexes every play for the same event id in a smaller,
  // paginated payload (verified live 2026-08-28 for event 401769074: 168
  // plays, count/pageCount envelope, items shaped like summary plays).
  var ESPN_CORE_BASE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football';
  function espnCorePlaysUrl(eventId) {
    if (!/^\d+$/.test(String(eventId))) return null;
    return ESPN_CORE_BASE + '/events/' + encodeURIComponent(eventId) + '/competitions/' + encodeURIComponent(eventId) + '/plays?limit=400';
  }

  // Free NCAA.com scoreboard source. Its documented GraphQL scoreboard uses
  // contestDate rather than ESPN's dates parameter. The operation hash and
  // field names below come from the ncaa-api source, not an invented schema.
  var NCAA_SCOREBOARD_HASH = '7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c';
  function ncaaScoreboardUrl(dateStr) {
    var y = Number(String(dateStr).slice(0, 4));
    var month = Number(String(dateStr).slice(4, 6));
    var seasonYear = month < 8 ? y - 1 : y;
    var variables = { sportCode: 'MFB', division: 11, seasonYear: seasonYear, contestDate: dateStr.slice(0, 4) + '-' + dateStr.slice(4, 6) + '-' + dateStr.slice(6, 8) };
    return NCAA_GRAPHQL_BASE + '/?extensions=' + encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: NCAA_SCOREBOARD_HASH } })) + '&variables=' + encodeURIComponent(JSON.stringify(variables));
  }

  // The public NCAA-backed game feed uses the same contest IDs returned by
  // the GraphQL scoreboard. Its detail routes are optional: pre-game contests
  // advertise hasBoxscore/hasPbp/hasTeamStats as false, while completed games
  // expose the corresponding JSON routes.
  function ncaaGameUrl(gameId, route) {
    return NCAA_COMMUNITY_BASE + '/game/' + encodeURIComponent(gameId) + (route ? '/' + route : '');
  }
  function ncaaBoxscoreUrl(gameId) { return ncaaGameUrl(gameId, 'boxscore'); }
  function ncaaPlayByPlayUrl(gameId) { return ncaaGameUrl(gameId, 'play-by-play'); }
  function ncaaTeamStatsUrl(gameId) { return ncaaGameUrl(gameId, 'team-stats'); }

  // Fallback routes for browsers whose network blocks direct cross-origin
  // calls (CORS). The app's same-origin relay is tried before these public
  // proxies. The proxies are deliberately a last resort: they are third-party
  // infrastructure, not the scoreboard's source of truth.
  var CORS_PROXIES = [
    { id: 'allorigins',   build: function (url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); } },
    { id: 'corsproxy.io', build: function (url) { return 'https://corsproxy.io/?url=' + encodeURIComponent(url); } },
    { id: 'codetabs',     build: function (url) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url); } }
  ];

  function proxyUrls(url) {
    return CORS_PROXIES.map(function (p) { return p.build(url); });
  }

  // Backward-compatible single-proxy builder (the historical name used by the
  // test suite; returns the first/primary proxy).
  function proxiedUrl(url) {
    return CORS_PROXIES[0].build(url);
  }

  // Return provider-host alternatives only for the verified ESPN contract.
  // NCAA URLs must not be rewritten to ESPN (or vice versa).
  function providerUrls(url) {
    var out = [url];
    if (typeof url === 'string' && url.indexOf(API_BASE) === 0) {
      out.push(ESPN_WEB_BASE + url.slice(API_BASE.length));
    }
    return out;
  }

  // Prepend the Reader host to a provider URL. Using an http target in the
  // Reader path is intentional: it keeps the provider query string inside the
  // target URL instead of making the target's `&` parameters look like query
  // parameters of r.jina.ai itself. The Reader fetches the target over HTTPS
  // when the target host redirects or requires it.
  function readerUrl(url) {
    var target = String(url || '').replace(/^https:\/\//i, 'http://');
    // Reader caches URL contents. A short bucket keeps a live fallback fresh
    // without creating a unique request on every render or poll.
    target += (target.indexOf('?') >= 0 ? '&' : '?') + '_ncbs=' + Math.floor(Date.now() / 30000);
    return JINA_READER_BASE + target;
  }

  function readerContentToData(content) {
    if (content && typeof content === 'object') return content;
    var text = String(content || '').trim();
    if (!text) throw new Error('Reader returned an empty document');
    var marker = text.indexOf('Markdown Content:');
    if (marker >= 0) text = text.slice(marker + 'Markdown Content:'.length).trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(text); } catch (firstError) {
      // The text-mode Reader response can include a short title/URL prefix.
      // Extract only a complete top-level JSON object/array in that case.
      var firstObject = text.search(/[\[{]/);
      var lastObject = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
      if (firstObject >= 0 && lastObject > firstObject) {
        try { return JSON.parse(text.slice(firstObject, lastObject + 1)); } catch (secondError) {}
      }
      throw new Error('Reader did not return provider JSON');
    }
  }

  // Reader supports both its documented JSON envelope (when Accept is
  // application/json) and the plain text form observed from simple GETs.
  // Normalize both forms before the normal provider payload validation runs.
  function readerPayloadToData(text) {
    var parsed;
    try { parsed = JSON.parse(String(text || '')); } catch (ignore) { parsed = null; }
    if (parsed && parsed.data && typeof parsed.data.content === 'string') {
      return readerContentToData(parsed.data.content);
    }
    if (parsed && typeof parsed.data === 'string') {
      return readerContentToData(parsed.data);
    }
    if (parsed && (parsed.events || parsed.contests || parsed.games || parsed.leagues || parsed.data)) return parsed;
    return readerContentToData(text);
  }

  // GitHub Pages is a static host: it serves these files but never runs
  // server.js, so `/api/espn` is a Pages 404 rather than a relay. Detect the
  // known Pages host and go straight to the browser-safe provider transports.
  // Keep the predicate separate and pure so the deployment assumption is
  // visible in tests and remains safe for a custom Pages domain.
  function isGitHubPagesHost(hostname) {
    return /(^|\.)github\.io$/i.test(String(hostname || '').trim());
  }

  function isStaticDeployment() {
    return typeof location !== 'undefined' && isGitHubPagesHost(location.hostname);
  }

  // Prefer the app's same-origin server relay everywhere it exists. On the
  // GitHub Pages deployment, skip the known-nonexistent relay so every request
  // can use direct ESPN/NCAA CORS or the Reader fallback without a Pages 404.
  function sameOriginProxyUrl(url) {
    if (typeof location === 'undefined' || !location.origin || isStaticDeployment()) return null;
    return '/api/espn?url=' + encodeURIComponent(url);
  }

  // A provider outage must not multiply into dozens of identical relay/direct/
  // proxy attempts for every conference and nearby date. Browser failures are
  // kept short-lived so a transient outage can recover, while a failed
  // transport is skipped for the other requests in the same refresh cycle.
  // Keep this browser-only: the Node test runner intentionally exercises the
  // raw transport order without sharing state between test cases.
  // `force` skips the unavailable-window check for one-off user-initiated
  // requests: the booth's background traffic may mark a transport unavailable,
  // but clicking a day and being blocked for the whole backoff window is the
  // exact failure the scoreboard suffered, so interactive loads still probe the
  // transport (once) before falling through.
  var transportBackoffMs = 15000;
  var transportUnavailableUntil = {};
  function transportCall(key, fn, force) {
    if (typeof window === 'undefined') return fn();
    var now = Date.now();
    if (!force && transportUnavailableUntil[key] && transportUnavailableUntil[key] > now) {
      return Promise.reject(new Error(key + ' temporarily unavailable'));
    }
    return Promise.resolve().then(fn).then(function (value) {
      delete transportUnavailableUntil[key];
      return value;
    }, function (err) {
      transportUnavailableUntil[key] = Date.now() + transportBackoffMs;
      throw err;
    });
  }

  // True when a transport failed with the provider's own rate-limit status
  // (HTTP 429). Retrying the same URL through other transports or third-party
  // proxies only multiplies the throttled request — see the loader's fail-fast.
  function isRateLimitError(err) {
    var msg = String((err && err.message) || err || '');
    return /\bHTTP 429\b/i.test(msg) || /\bstatus( code)?[:= ]?429\b/i.test(msg);
  }

  async function espnFetch(url, timeoutMs, opts) {
    var t = timeoutMs || 12000;
    opts = opts || {};
    var lane = opts.lane == null ? LANE_USER : opts.lane;
    var force = !!opts.force;
    // Every provider transport attempt runs through the priority gate, so the
    // booth's background fan-out can never monopolise the browser connection
    // pool that the scoreboard's own requests need.
    function gateCall(key, fn) {
      return providerGate.run(function () { return transportCall(key, fn, force); }, lane);
    }
    function attempt(u) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, t);
      return fetch(u, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
        .then(async function (res) {
          if (!res.ok) {
            var body = '';
            try { body = await res.text(); } catch (ignore) {}
            var detail = '';
            try {
              var parsed = JSON.parse(body);
              detail = parsed.detail || parsed.error || '';
            } catch (ignore2) {}
            throw new Error('HTTP ' + res.status + (detail ? ': ' + detail : ''));
          }
          return res.json();
        })
        .finally(function () { clearTimeout(timer); });
    }
    function attemptReader(u) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, t);
      return fetch(readerUrl(u), { signal: ctrl.signal, headers: { Accept: 'application/json' } })
        .then(async function (res) {
          if (!res.ok) {
            var body = '';
            try { body = await res.text(); } catch (ignore) {}
            throw new Error('Reader HTTP ' + res.status + (body ? ': ' + body.slice(0, 120) : ''));
          }
          return readerPayloadToData(await res.text());
        })
        .finally(function () { clearTimeout(timer); });
    }

    var lastErr = null;
    var rateLimited = false;
    var candidates = providerUrls(url);
    // The controlled same-origin route and direct provider hosts are tried for
    // every verified provider candidate. Reader is intentionally tried only
    // for the primary URL: it fetches that exact URL server-side, so repeating
    // the same Reader request through ESPN's alternate hostname adds latency
    // without adding an independent data source. If the primary host is down,
    // the alternate direct/relay path still gets its chance before the older
    // proxy chain.
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      var host = new URL(candidate).hostname;
      var relay = sameOriginProxyUrl(candidate);
      if (relay) {
        try {
          return { data: await gateCall('relay:' + host, function () { return attempt(relay); }), viaProxy: true, proxy: 'server', provider: candidate };
        } catch (err) { lastErr = err; rateLimited = rateLimited || isRateLimitError(err); }
      }
      if (!rateLimited) {
        try {
          return { data: await gateCall('direct:' + host, function () { return attempt(candidate); }), viaProxy: false, proxy: null, provider: candidate };
        } catch (err2) { lastErr = err2; rateLimited = rateLimited || isRateLimitError(err2); }
      }
      if (i === 0 && !rateLimited) {
        try {
          return { data: await gateCall('reader:' + host, function () { return attemptReader(candidate); }), viaProxy: true, proxy: 'jina-reader', provider: candidate };
        } catch (err3) { lastErr = err3; rateLimited = rateLimited || isRateLimitError(err3); }
      }
    }

    // Direct/provider calls and the Reader transport failed. Walk the older
    // public CORS proxies as a final fallback. They are not data providers and
    // are intentionally last because their availability is inconsistent — and
    // are skipped entirely while the provider is rate-limiting us, because
    // every retry would replay the same throttled request from a third party.
    if (!rateLimited)
    for (var j = 0; j < CORS_PROXIES.length; j++) {
      try {
        var p = await gateCall('cors:' + CORS_PROXIES[j].id, function () {
          return attempt(CORS_PROXIES[j].build(url));
        });
        return { data: p, viaProxy: true, proxy: CORS_PROXIES[j].id, provider: url };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Provider request failed');
  }

  /* ---------------- Date helpers ---------------- */

  // ESPN's football scoreboard treats `dates=` as an Eastern calendar date.
  // Keeping the selected "today" in that same timezone prevents visitors west
  // or east of the US from accidentally loading yesterday's/tomorrow's slate
  // around midnight.
  function easternDateStr(d) {
    var dt = d || new Date();
    if (isNaN(dt.getTime())) return '';
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(dt);
      var values = {};
      parts.forEach(function (p) { values[p.type] = p.value; });
      return values.year + values.month + values.day;
    } catch (e) {
      // A Date's local calendar is a reasonable last-resort display fallback
      // for older browsers that do not support timeZone formatting.
      var y = dt.getFullYear();
      var m = String(dt.getMonth() + 1).padStart(2, '0');
      var day = String(dt.getDate()).padStart(2, '0');
      return y + m + day;
    }
  }

  // Kept as the public helper name used by the app/tests. Its result is now
  // deliberately Eastern rather than the browser's local calendar date.
  function localDateStr(d) {
    return easternDateStr(d);
  }

  function shiftDate(dateStr, days) {
    var y = +dateStr.slice(0, 4), m = +dateStr.slice(4, 6), d = +dateStr.slice(6, 8);
    var dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10).replace(/-/g, '');
  }

  // Event dates are UTC instants. This returns the Eastern date (YYYYMMDD)
  // on which the game was played — matches how ESPN's `dates=` filter works.
  function etDateFromWallclock(iso) {
    var dt = new Date(iso);
    if (isNaN(dt.getTime())) return null;
    try {
      var s = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(dt);
      return s.replace(/-/g, '');
    } catch (e) {
      return null;
    }
  }

  // "20260829" -> "Sat, Aug 29". Anchored at local noon so the weekday is
  // correct in every timezone.
  function fmtDayLabel(dateStr) {
    if (!/^\d{8}$/.test(String(dateStr))) return String(dateStr || '');
    var dt = new Date(+dateStr.slice(0, 4), +dateStr.slice(4, 6) - 1, +dateStr.slice(6, 8), 12, 0, 0);
    if (isNaN(dt.getTime())) return String(dateStr);
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /* ---------------- Nearby-games helpers (pure) ---------------- */

  // Scoreboard events live at the TOP level of the response —
  // {"leagues":[...],"events":[...]} — verified in every live dump
  // (2026-08-25). They are NOT inside leagues[0].
  var NCAA_CONFERENCE_INFO = {
    acc: { id: '1', short: 'ACC', name: 'Atlantic Coast Conference' },
    sec: { id: '8', short: 'SEC', name: 'Southeastern Conference' },
    'big-ten': { id: '5', short: 'Big Ten', name: 'Big Ten Conference' },
    'big-12': { id: '4', short: 'Big 12', name: 'Big 12 Conference' },
    american: { id: '151', short: 'American', name: 'American Athletic Conference' }
  };

  function ncaaConferenceId(team) {
    if (!team) return null;
    if (team.conferenceId !== undefined && team.conferenceId !== null && team.conferenceId !== '') return String(team.conferenceId);
    var seo = team.conferenceSeo;
    if (!seo && Array.isArray(team.conferences) && team.conferences[0]) seo = team.conferences[0].conferenceSeo;
    var info = seo && NCAA_CONFERENCE_INFO[String(seo).toLowerCase()];
    return info ? info.id : null;
  }

  function ncaaConference(team) {
    if (!team) return null;
    var id = ncaaConferenceId(team);
    var seo = team.conferenceSeo;
    if (!seo && Array.isArray(team.conferences) && team.conferences[0]) seo = team.conferences[0].conferenceSeo;
    var info = seo && NCAA_CONFERENCE_INFO[String(seo).toLowerCase()];
    if (info) return info;
    if (id) {
      return CONFERENCES.find(function (c) { return c.id === id; }) || { id: id, short: id, name: id };
    }
    return null;
  }

  function ncaaTeamName(team) {
    return (team && team.nameShort) || (team && team.names && team.names.short) || (team && team.nameFull) || '?';
  }

  function ncaaTeamAbbreviation(team) {
    return (team && team.name6Char) || (team && team.names && team.names.char6) || ncaaTeamName(team);
  }

  function ncaaState(value) {
    var s = String(value || '').toLowerCase();
    if (s === 'f' || s === 'final' || s === 'post' || s === 'completed') return 'post';
    if (s === 'i' || s === 'in' || s === 'live' || s === 'in_progress' || s === 'in-progress') return 'in';
    return 'pre';
  }

  function ncaaPeriod(value) {
    if (value === undefined || value === null || value === '') return 0;
    var n = Number(value);
    if (!isNaN(n)) return n;
    var m = String(value).match(/(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  function ncaaIsoDate(item) {
    if (item && item.startTimeEpoch !== undefined && item.startTimeEpoch !== null && item.startTimeEpoch !== '') {
      var epoch = Number(item.startTimeEpoch);
      if (isFinite(epoch)) return new Date(epoch * 1000).toISOString();
    }
    var md = item && String(item.startDate || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (md) {
      // This is only a malformed-data fallback; all verified NCAA responses
      // include startTimeEpoch. Treating an absent epoch as UTC is preferable
      // to inventing the visitor's local timezone.
      var clock = String(item.startTime || '00:00').match(/^(\d{1,2}):(\d{2})/);
      var hh = clock ? String(clock[1]).padStart(2, '0') : '00';
      var mm = clock ? clock[2] : '00';
      return md[3] + '-' + md[1] + '-' + md[2] + 'T' + hh + ':' + mm + ':00Z';
    }
    return '';
  }

  function ncaaLinescores(contest, isHome) {
    return (contest && contest.linescores || []).map(function (line) {
      var value = isHome ? line.home : (line.visit !== undefined ? line.visit : line.visitor);
      return { period: ncaaPeriod(line.period), value: value === undefined || value === null ? '0' : value };
    }).filter(function (line) { return line.period > 0; });
  }

  function makeNCAAEvent(contest, oldGame) {
    var c = contest || oldGame || {};
    var away = oldGame ? oldGame.away : null;
    var home = oldGame ? oldGame.home : null;
    if (!oldGame) {
      var teams = Array.isArray(c.teams) ? c.teams : [];
      away = teams.find(function (t) { return t && t.isHome === false; });
      home = teams.find(function (t) { return t && t.isHome === true; });
    }
    if (!away || !home) return null;

    function competitor(team, homeAway) {
      var conf = ncaaConference(team);
      var id = team.teamId || team.id || (team.names && team.names.id) || null;
      var score = team.score;
      if (score === '' || score === undefined || score === null) score = null;
      var rank = Number(team.teamRank || team.gameRank || team.rank);
      if (!rank || rank < 1 || rank > 25) rank = null;
      var record = team.record || '';
      if (record) record = String(record).replace(/^\((.*)\)$/, '$1');
      var records = record ? [{ type: 'total', summary: record }] : [];
      return {
        id: id ? String(id) : null,
        homeAway: homeAway,
        score: score,
        winner: !!team.isWinner || !!team.winner,
        records: records,
        curatedRank: rank ? { current: rank } : null,
        linescores: ncaaLinescores(c, homeAway === 'home'),
        team: {
          id: id ? String(id) : null,
          abbreviation: ncaaTeamAbbreviation(team),
          displayName: ncaaTeamName(team),
          shortDisplayName: ncaaTeamName(team),
          color: team.color || null,
          logo: team.logo || null,
          conferenceId: conf ? conf.id : ncaaConferenceId(team)
        }
      };
    }

    var state = ncaaState(c.gameState || c.status || c.statusCodeDisplay);
    var conferenceIds = [ncaaConferenceId(away), ncaaConferenceId(home)].filter(Boolean);
    var uniqueConferenceIds = conferenceIds.filter(function (id, i, all) { return all.indexOf(id) === i; });
    var group = uniqueConferenceIds.length === 1
      ? CONFERENCES.find(function (conf) { return conf.id === uniqueConferenceIds[0]; }) || null
      : null;
    var location = c.location || {};
    var broadcaster = c.broadcasterName || c.network || '';
    var id = c.contestId || c.gameID || c.id;
    if (id === undefined || id === null || id === '') return null;
    var week = c.week !== undefined && c.week !== null && c.week !== '' ? Number(c.week) : null;
    return {
      id: String(id),
      date: ncaaIsoDate(c),
      name: ncaaTeamName(away) + ' at ' + ncaaTeamName(home),
      week: week && !isNaN(week) ? { number: week } : null,
      source: 'ncaa',
      provider: NCAA_COMMUNITY_BASE,
      competitions: [{
        id: String(id),
        date: ncaaIsoDate(c),
        neutralSite: !!c.neutralSite,
        venue: location.venue ? { fullName: location.venue, address: { city: location.city, state: location.stateUsps } } : {},
        broadcasts: broadcaster ? [{ names: [broadcaster] }] : [],
        groups: group ? { id: group.id, shortName: group.short, name: group.name } : undefined,
        status: {
          type: {
            state: state,
            completed: state === 'post',
            name: c.statusCodeDisplay || '',
            description: c.finalMessage || c.currentPeriod || '',
            shortDetail: c.finalMessage || c.currentPeriod || ''
          },
          period: ncaaPeriod(c.currentPeriod),
          displayClock: c.contestClock || c.clock || '0:00'
        },
        competitors: [competitor(away, 'away'), competitor(home, 'home')]
      }]
    };
  }

  function ncaaEventsOf(data) {
    var contests = data && data.data && data.data.contests;
    if (!Array.isArray(contests) && data && Array.isArray(data.contests)) contests = data.contests;
    if (Array.isArray(contests)) {
      return contests.map(function (c) { return makeNCAAEvent(c, null); }).filter(Boolean);
    }
    var games = data && data.games;
    if (!Array.isArray(games)) return [];
    return games.map(function (entry) {
      var game = entry && entry.game ? entry.game : entry;
      return makeNCAAEvent(game, game);
    }).filter(Boolean);
  }

  function eventsOf(data) {
    if (data && Array.isArray(data.events)) return data.events;
    return ncaaEventsOf(data);
  }

  function scoreboardItemsOf(data) {
    if (data && Array.isArray(data.events)) return data.events;
    if (data && data.data && Array.isArray(data.data.contests)) return data.data.contests;
    if (data && Array.isArray(data.contests)) return data.contests;
    if (data && Array.isArray(data.games)) return data.games.map(function (entry) { return entry && entry.game ? entry.game : entry; });
    return null;
  }

  function scoreboardEventIsUsable(event) {
    if (!event || event.id === undefined || event.id === null || event.id === '') return false;
    var competitors = event.competitions && event.competitions[0] && event.competitions[0].competitors;
    if (!Array.isArray(competitors) || competitors.length < 2) return false;
    return competitors.some(function (c) { return c && c.homeAway === 'away'; }) &&
      competitors.some(function (c) { return c && c.homeAway === 'home'; });
  }

  function validEventsOf(data) {
    return eventsOf(data).filter(scoreboardEventIsUsable);
  }

  function eventIsCompleted(event) {
    var status = event && event.competitions && event.competitions[0] && event.competitions[0].status;
    var type = status && status.type;
    return !!(type && (type.state === 'post' || type.completed));
  }

  function scoreboardPayloadIsUsable(data) {
    var hasErrors = data && (data.error || (Array.isArray(data.errors) ? data.errors.length : data.errors));
    if (hasErrors) return false;
    var items = scoreboardItemsOf(data);
    if (!items) return false;
    return items.length === 0 || validEventsOf(data).length > 0;
  }

  function eventMatchesGroups(event, groupIds) {
    if (!groupIds || !groupIds.length) return true;
    var wanted = groupIds.map(String);
    var ids = [];
    var comp = event && event.competitions && event.competitions[0];
    if (comp && comp.groups && comp.groups.id !== undefined) ids.push(String(comp.groups.id));
    ((comp && comp.competitors) || []).forEach(function (c) {
      if (c && c.team && c.team.conferenceId !== undefined && c.team.conferenceId !== null) ids.push(String(c.team.conferenceId));
      var nc = c && c.team && ncaaConferenceId(c.team);
      if (nc) ids.push(String(nc));
    });
    return ids.some(function (id) { return wanted.indexOf(id) !== -1; });
  }

  function filterEventsForGroups(events, groupIds) {
    return (events || []).filter(function (event) {
      return scoreboardEventIsUsable(event) && eventMatchesGroups(event, groupIds);
    });
  }

  function filterEventsForDate(events, dateStr) {
    return (events || []).filter(function (event) {
      var date = event && event.date ? etDateFromWallclock(event.date) : null;
      return date === dateStr;
    });
  }

  function filterEventsForRange(events, fromStr, toStr) {
    if (!/^\d{8}$/.test(String(fromStr)) || !/^\d{8}$/.test(String(toStr))) return [];
    return (events || []).filter(function (event) {
      var date = event && event.date ? etDateFromWallclock(event.date) : null;
      return date && date >= fromStr && date <= toStr;
    });
  }

  // Group ranged-response events by the Eastern date they were played on —
  // the same convention the API's `dates=` filter uses.
  function groupByDay(events) {
    var m = new Map();
    (events || []).forEach(function (ev) {
      if (!ev || !ev.id || !ev.date) return;
      var d = etDateFromWallclock(ev.date);
      if (!d) return;
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(ev);
    });
    return Array.from(m.keys()).sort().map(function (d) {
      return { date: d, events: m.get(d) };
    });
  }

  // Fallback probe windows derived from a single-day response's league
  // calendar (leagues[0].calendar + calendarStartDate). Used only when the
  // ±14-day probes come back empty (deep offseason):
  //   back — the last 3 weeks of the previous league year (e.g. for the
  //          2026 league year starting 2026-02-01: 2026-01-11..2026-01-31,
  //          which contains the Jan 19 CFP title game — verified).
  //   fwd  — the next season/segment window that starts after the current
  //          date (e.g. Regular Season opening 2026-08-22).
  function calendarProbeWindows(league, dateStr) {
    var out = { fwd: null, back: null };
    if (!league) return out;
    var starts = [];
    if (league.calendarStartDate) {
      var d0 = etDateFromWallclock(league.calendarStartDate);
      if (d0) starts.push(d0);
    }
    var future = [];
    (league.calendar || []).forEach(function (seg) {
      var ds = seg.startDate ? etDateFromWallclock(seg.startDate) : null;
      if (ds) {
        starts.push(ds);
        if (ds > dateStr) future.push(ds);
      }
      (seg.entries || []).forEach(function (e) {
        var de = e.startDate ? etDateFromWallclock(e.startDate) : null;
        if (de && de > dateStr) future.push(de);
      });
    });
    if (starts.length) {
      starts.sort();
      out.back = [shiftDate(starts[0], -21), shiftDate(starts[0], -1)];
    }
    if (future.length) {
      future.sort();
      out.fwd = [future[0], shiftDate(future[0], 13)];
    }

    // Calendar windows can span a season boundary and therefore must be
    // clipped to the requested direction. Without this guard, a January date
    // before the league-year start could use a "back" window from the future
    // (for example, Jan 10 could accidentally select Jan 19 as a prior result).
    var yesterday = shiftDate(dateStr, -1);
    if (out.back) {
      out.back[1] = out.back[1] < yesterday ? out.back[1] : yesterday;
      if (out.back[0] > out.back[1]) out.back = null;
    }
    var tomorrow = shiftDate(dateStr, 1);
    if (out.fwd) {
      out.fwd[0] = out.fwd[0] > tomorrow ? out.fwd[0] : tomorrow;
      if (out.fwd[0] > out.fwd[1]) out.fwd = null;
    }
    return out;
  }

  // If the ESPN day response failed completely, NCAA still supplies exact
  // date-based contests but not ESPN's season calendar. These bounded windows
  // cover the season boundaries where a 14-day nearby probe can miss the last
  // result or the next opener. They are only search hints; every displayed row
  // still comes from an actual NCAA/ESPN response and is filtered by date.
  function fallbackProbeWindows(dateStr) {
    var out = { fwd: null, back: null };
    if (!/^\d{8}$/.test(String(dateStr))) return out;
    var year = Number(String(dateStr).slice(0, 4));
    var month = Number(String(dateStr).slice(4, 6));
    var day = Number(String(dateStr).slice(6, 8));
    var y = String(year);
    if (month === 1 && day <= 10) {
      out.back = [String(year - 1) + '1215', String(year - 1) + '1231'];
      out.fwd = [y + '0111', y + '0131'];
    } else if (month < 8) {
      out.back = [y + '0101', y + '0131'];
      out.fwd = [y + '0822', y + '0908'];
    } else {
      out.back = [y + '0101', y + '0131'];
      var seasonStart = y + '0822';
      if (seasonStart > dateStr) out.fwd = [seasonStart, y + '0908'];
    }
    // Never let a heuristic “back” window cross the selected date or a
    // “forward” window begin before it. The normal ±14-day range is already
    // directional, but these broad season probes must preserve that contract.
    var yesterday = shiftDate(dateStr, -1);
    if (out.back) {
      out.back[1] = out.back[1] < yesterday ? out.back[1] : yesterday;
      if (out.back[0] > out.back[1]) out.back = null;
    }
    var tomorrow = shiftDate(dateStr, 1);
    if (out.fwd) {
      out.fwd[0] = out.fwd[0] > tomorrow ? out.fwd[0] : tomorrow;
      if (out.fwd[0] > out.fwd[1]) out.fwd = null;
    }
    return out;
  }

  /* ---------------- Scoreboard parsing ---------------- */

  function parseCompetitor(c, rank) {
    if (!c) return { id: null, abbreviation: '?', name: 'Unknown', displayName: 'Unknown', logo: null, color: null, rank: null, score: null, linescores: [], records: {}, winner: false, conferenceId: null };
    var t = c.team || {};
    var recs = {};
    (c.records || []).forEach(function (r) { recs[r.type] = r.summary; });
    return {
      id: t.id || c.id || null,
      abbreviation: t.abbreviation || '?',
      name: t.shortDisplayName || t.displayName || t.name || '?',
      displayName: t.displayName || t.name || '?',
      logo: t.logo || null,
      color: t.color || null,
      rank: rank,
      score: (c.score === undefined || c.score === null || c.score === '') ? null : Number(c.score),
      linescores: (c.linescores || []).map(function (l) {
        return { period: l.period, value: (l.displayValue !== undefined ? l.displayValue : l.value) };
      }),
      records: recs,
      winner: !!c.winner,
      conferenceId: t.conferenceId ? String(t.conferenceId) : null
    };
  }

  function parseEvent(ev) {
    var comp = (ev.competitions && ev.competitions[0]) || {};
    var status = comp.status || {};
    var st = status.type || {};
    var competitors = comp.competitors || [];
    var byHA = {};
    competitors.forEach(function (c) { if (c && c.homeAway) byHA[c.homeAway] = c; });
    var away = byHA.away || {};
    var home = byHA.home || {};
    var rankOf = function (c) {
      var r = c && c.curatedRank;
      if (r && r.current !== undefined && Number(r.current) >= 1 && Number(r.current) <= 25) return Number(r.current);
      return null;
    };

    var conferences = [];
    var g = comp.groups;
    if (g && (g.name || g.shortName)) {
      conferences.push({ id: g.id ? String(g.id) : null, short: g.shortName || g.name || '', name: g.name || g.shortName || '' });
    }
    var confIds = {};
    competitors.forEach(function (c) {
      if (c && c.team && c.team.conferenceId) confIds[String(c.team.conferenceId)] = true;
    });

    var leaders = [];
    (comp.leaders || []).forEach(function (L) {
      var l = (L.leaders && L.leaders[0]) || null;
      if (!l || !l.athlete) return;
      leaders.push({
        stat: L.name,
        label: L.displayName || L.name,
        displayValue: l.displayValue || '',
        athlete: l.athlete.displayName || '',
        position: l.athlete.position ? l.athlete.position.abbreviation : '',
        teamId: l.team ? String(l.team.id) : null
      });
    });

    var headlines = (comp.headlines || [])
      .map(function (h) { return { type: h.type || '', text: h.shortLinkText || h.description || '' }; })
      .filter(function (h) { return h.text; });

    var venue = comp.venue || {};
    var addr = venue.address || {};

    return {
      id: String(ev.id),
      date: ev.date || '',
      week: ev.week && ev.week.number !== undefined ? ev.week.number : null,
      name: ev.name || '',
      source: ev.source || 'espn',
      provider: ev.provider || API_BASE,
      neutralSite: !!comp.neutralSite,
      playByPlayAvailable: comp.playByPlayAvailable !== false,
      venueName: venue.fullName || '',
      venueCity: [addr.city, addr.state].filter(Boolean).join(', '),
      attendance: comp.attendance || 0,
      broadcast: (comp.broadcasts && comp.broadcasts.length)
        ? comp.broadcasts.map(function (b) { return (b.names || []).join('+'); }).join(' • ')
        : (comp.broadcast || ''),
      notes: (comp.notes || []).map(function (n) { return n.headline; }).filter(Boolean),
      status: {
        state: st.state || 'pre',           // pre | in | post
        name: st.name || '',
        description: st.description || '',
        shortDetail: st.shortDetail || '',
        completed: !!st.completed,
        period: status.period || 0,
        clock: status.displayClock || '0:00'
      },
      away: parseCompetitor(away, rankOf(away)),
      home: parseCompetitor(home, rankOf(home)),
      leaders: leaders,
      headlines: headlines,
      conferences: conferences,
      conferenceIds: Object.keys(confIds)
    };
  }

  function mergeEvents(lists) {
    var map = new Map();
    lists.forEach(function (list) {
      (list || []).forEach(function (ev) {
        if (!ev || !ev.id) return;
        var e = parseEvent(ev);
        var existing = map.get(e.id);
        if (!existing) {
          map.set(e.id, e);
        } else {
          var allConferences = existing.conferences.concat(e.conferences).filter(function (conf, i, all) {
            return !all.slice(0, i).some(function (prior) { return prior.id === conf.id; });
          });
          var allConferenceIds = existing.conferenceIds.concat(e.conferenceIds).filter(function (id, i, all) {
            return all.indexOf(id) === i;
          });
          e.conferences = allConferences;
          e.conferenceIds = allConferenceIds;
          if (JSON.stringify(e).length > JSON.stringify(existing).length) map.set(e.id, e);
        }
      });
    });
    return Array.from(map.values());
  }

  function groupGames(games) {
    var live = [], pre = [], post = [];
    games.forEach(function (g) {
      if (g.status.state === 'in') live.push(g);
      else if (g.status.state === 'post') post.push(g);
      else pre.push(g);
    });
    var byDate = function (a, b) { return (a.date || '').localeCompare(b.date || ''); };
    live.sort(byDate); pre.sort(byDate); post.sort(byDate);
    return [
      { key: 'live', label: 'Live', games: live },
      { key: 'pre', label: 'Upcoming', games: pre },
      { key: 'post', label: 'Final', games: post }
    ].filter(function (s) { return s.games.length; });
  }

  // On a fresh visit, retain today only when it still has a scheduled or live
  // game. A slate made entirely of completed games should advance to the next
  // game day, just like an empty offseason date.
  function shouldOpenNextGameDay(games) {
    return !(games || []).some(function (g) {
      return g && g.status && g.status.state !== 'post';
    });
  }

  /* ---------------- Summary (game detail) parsing ---------------- */

  function periodLabel(n) {
    if (!n) return '';
    if (n <= 4) return ['1st', '2nd', '3rd', '4th'][n - 1];
    return n === 5 ? 'OT' : 'OT' + (n - 4);
  }

  function normalizePlay(p, driveId) {
    if (!p) return null;
    var type = p.type || {};
    var offId = null, defId = null;
    (p.teamParticipants || []).forEach(function (tp) {
      if (tp.type === 'offense') offId = tp.id;
      else if (tp.type === 'defense') defId = tp.id;
    });
    var text = p.text || '';
    var m = text.match(/^\((\d+:\d{2})\)\s*/);
    var clockFromText = m ? m[1] : null;
    if (m) text = text.slice(m[0].length);
    var end = p.end || {};
    var start = p.start || {};
    var possessionTeamId = (end.team && end.team.id) || (start.team && start.team.id) || offId || null;
    return {
      id: p.id || (p.sequenceNumber ? 'seq-' + p.sequenceNumber : 'x' + Math.random().toString(36).slice(2)),
      seq: Number(p.sequenceNumber) || 0,
      type: type.text || type.abbreviation || 'Play',
      typeAbbr: type.abbreviation || '',
      text: text,
      period: (p.period && p.period.number) || 0,
      clock: (p.clock && p.clock.displayValue) || clockFromText || '',
      awayScore: p.awayScore !== undefined ? p.awayScore : null,
      homeScore: p.homeScore !== undefined ? p.homeScore : null,
      scoringPlay: !!p.scoringPlay,
      isPenalty: !!p.isPenalty,
      isTurnover: !!p.isTurnover,
      priority: !!p.priority,
      yardage: p.statYardage !== undefined ? p.statYardage : 0,
      offTeamId: offId ? String(offId) : null,
      defTeamId: defId ? String(defId) : null,
      possessionTeamId: possessionTeamId ? String(possessionTeamId) : null,
      downDistance: end.downDistanceText || start.downDistanceText || '',
      possession: end.possessionText || start.possessionText || '',
      scoringType: p.scoringType ? (p.scoringType.abbreviation || p.scoringType.name) : null,
      pointAfter: p.pointAfterAttempt ? (p.pointAfterAttempt.text || '') : null,
      driveId: driveId || null,
      time: p.wallclock ? Date.parse(p.wallclock) : 0,
      // Position fields used only by the live booth (flags & reviews). They
      // are read straight from the verified ESPN play objects (start.yardsToEndzone,
      // start.downDistanceText, start.possessionText, penalty.yards, penalty.type.text
      // — all verified present on college-football plays, see README). They are
      // optional: NCAA-fallback plays (parseNCAAPlays) do not carry them, and the
      // booth must never invent a field position.
      start: p.start
        ? {
          yardsToEndzone: p.start.yardsToEndzone !== undefined && p.start.yardsToEndzone !== null ? Number(p.start.yardsToEndzone) : null,
          downDistanceText: p.start.downDistanceText || '',
          possessionText: p.start.possessionText || '',
          yardLine: p.start.yardLine !== undefined && p.start.yardLine !== null ? Number(p.start.yardLine) : null,
          teamId: (p.start.team && p.start.team.id != null) ? String(p.start.team.id) : null
        }
        : null,
      end: p.end
        ? {
          yardsToEndzone: p.end.yardsToEndzone !== undefined && p.end.yardsToEndzone !== null ? Number(p.end.yardsToEndzone) : null,
          downDistanceText: p.end.downDistanceText || '',
          possessionText: p.end.possessionText || '',
          yardLine: p.end.yardLine !== undefined && p.end.yardLine !== null ? Number(p.end.yardLine) : null,
          teamId: (p.end.team && p.end.team.id != null) ? String(p.end.team.id) : null
        }
        : null,
      penalty: p.penalty
        ? {
          yards: p.penalty.yards !== undefined && p.penalty.yards !== null ? Number(p.penalty.yards) : null,
          typeText: (p.penalty.type && p.penalty.type.text) || ''
        }
        : null,
      penaltyText: p.penalty
        ? ((p.penalty.yards != null ? p.penalty.yards + '-yard ' : '') +
           ((p.penalty.type && p.penalty.type.text) || 'Penalty'))
        : '',
      scoreValue: p.scoreValue !== undefined && p.scoreValue !== null ? Number(p.scoreValue) : null
    };
  }

  // ESPN serves the summary "drives" section in at least two live shapes:
  //   summary.drives = [drive, ...]                 — e.g. event 401752763
  //     (Texas A&M at Missouri, 2025-11-08; fixture verified 2026-08-25)
  //   summary.drives = { previous: [drive, ...] }   — e.g. event 401769074
  //     (Oregon at Indiana, CFP semifinal 2026-01-09; verified 2026-08-28)
  // Reading only the array form produced an empty play-by-play tab for
  // completed postseason games even though the provider returned every play.
  // A live game can additionally carry a drives.current drive.
  function summaryDrivesOf(summary) {
    var d = summary && summary.drives;
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.previous)) {
      var drives = d.previous.slice();
      if (d.current && Array.isArray(d.current.plays)) drives.push(d.current);
      return drives;
    }
    return [];
  }

  // PBP strategy: prefer the top-level `plays` array when present, otherwise
  // flatten `drives[].plays` (drives contain every play — verified: kickoffs,
  // timeouts and end-of-quarter markers all appear inside drives).
  function extractPlays(summary) {
    var drivesRaw = summaryDrivesOf(summary);
    var flatRaw = Array.isArray(summary.plays) ? summary.plays : [];
    var plays;
    if (flatRaw.length) {
      plays = flatRaw.map(function (p) { return normalizePlay(p, null); });
    } else {
      plays = [];
      drivesRaw.forEach(function (d) {
        (d.plays || []).forEach(function (p) { plays.push(normalizePlay(p, d.id)); });
      });
    }
    plays = plays.filter(Boolean);
    // The provider occasionally re-issues the same play with a new id under
    // the same sequence number (verified live 2026-08-28: drive 4017690742
    // lists one interception touchdown twice at sequence "2"). Keep the first
    // occurrence of each period+sequence pair so rows never double.
    var seenSeq = {};
    plays = plays.filter(function (p) {
      var key = p.seq ? String(p.period) + ':' + p.seq : null;
      if (!key) return true;
      if (seenSeq[key]) return false;
      seenSeq[key] = true;
      return true;
    });
    plays.sort(function (a, b) {
      return (a.period - b.period) || (a.seq - b.seq) || (a.time - b.time);
    });
    return plays;
  }

  function parseDrives(summary) {
    return summaryDrivesOf(summary).map(function (d) {
      return {
        id: d.id,
        description: d.description || '',
        teamId: d.team ? String(d.team.id) : null,
        teamAbbr: (d.team && d.team.abbreviation) || '',
        teamLogo: (d.team && d.team.logos && d.team.logos[0] && d.team.logos[0].href) || null,
        start: d.start || null,
        end: d.end || null,
        yards: d.yards !== undefined ? d.yards : null,
        timeElapsed: d.timeElapsed ? d.timeElapsed.displayValue : '',
        offensivePlays: d.offensivePlays !== undefined ? d.offensivePlays : null,
        result: d.displayResult || d.result || '',
        resultRaw: d.result || '',
        isScore: !!d.isScore
      };
    });
  }

  function parseSummary(s) {
    var bx = s.boxscore || {};
    var teams = (bx.teams || []).map(function (t) {
      var tm = t.team || {};
      return {
        id: tm.id ? String(tm.id) : null,
        homeAway: t.homeAway,
        abbreviation: tm.abbreviation || '?',
        displayName: tm.displayName || tm.name || '?',
        logo: tm.logo || null,
        color: tm.color || null,
        order: t.displayOrder || 0,
        stats: (t.statistics || []).map(function (st) {
          return { name: st.name, label: st.label || st.name, displayValue: st.displayValue, value: st.value };
        })
      };
    });
    // Canonical away-first ordering (scoreboard convention).
    teams.sort(function (a, b) { return (a.homeAway === 'away' ? 0 : 1) - (b.homeAway === 'away' ? 0 : 1); });

    var players = (bx.players || []).map(function (p) {
      return {
        teamId: p.team ? String(p.team.id) : null,
        categories: (p.statistics || []).map(function (cat) {
          return {
            name: cat.name,
            title: cat.text || cat.name,
            labels: cat.labels || [],
            descriptions: cat.descriptions || [],
            athletes: (cat.athletes || []).map(function (a) {
              var at = a.athlete || {};
              return {
                name: at.displayName || ((at.firstName || '') + ' ' + (at.lastName || '')).trim(),
                jersey: at.jersey || '',
                stats: a.stats || []
              };
            }),
            totals: cat.totals || null
          };
        })
      };
    });
    players.sort(function (a, b) {
      var ia = teams.findIndex(function (t) { return t.id === a.teamId; });
      var ib = teams.findIndex(function (t) { return t.id === b.teamId; });
      return ia - ib;
    });

    return {
      teams: teams,
      players: players,
      drives: parseDrives(s),
      plays: extractPlays(s),
      article: s.article ? { headline: s.article.headline || '', text: s.article.description || '' } : null,
      rawKeys: Object.keys(s || {}).sort(),
      // Scheduled kickoff from summary.header.competitions[0].date. Present on
      // pre-game summaries (verified live 2026-08-25, event 401856766) where
      // there are no drives/plays yet — used for deep-link resolution.
      headerDate: (s.header && s.header.competitions && s.header.competitions[0] && s.header.competitions[0].date) || null,
      clock: null // live scoreboard clock (attached while polling)
    };
  }

  /* ---------------- ESPN Core API plays (historical backfill) ---------------- */

  // Core API play items share the summary play field shape (sequenceNumber,
  // period, clock, teamParticipants, start/end, wallclock — verified verbatim
  // 2026-08-28 for event 401769074), so the existing normalizer applies
  // unchanged. The collection envelope carries count/pageCount for pagination.
  function extractCorePlays(data) {
    var items = data && Array.isArray(data.items) ? data.items : [];
    var plays = items.map(function (p) { return normalizePlay(p, null); }).filter(Boolean);
    plays.sort(function (a, b) {
      return (a.period - b.period) || (a.seq - b.seq) || (a.time - b.time);
    });
    return plays;
  }

  /* ---------------- NCAA detail parsing ---------------- */

  function ncaaContestOf(data) {
    if (data && Array.isArray(data.contests) && data.contests[0]) return data.contests[0];
    if (data && data.data && Array.isArray(data.data.contests) && data.data.contests[0]) return data.data.contests[0];
    return null;
  }

  function ncaaDetailTeam(team, contest) {
    var id = team && (team.teamId || team.id);
    var isHome = !!(team && team.isHome);
    return {
      id: id === undefined || id === null ? null : String(id),
      homeAway: isHome ? 'home' : 'away',
      abbreviation: ncaaTeamAbbreviation(team),
      displayName: ncaaTeamName(team),
      logo: (team && team.logo) || null,
      color: (team && team.color) || null,
      order: isHome ? 2 : 1,
      stats: []
    };
  }

  function parseNCAAOverview(data) {
    var c = ncaaContestOf(data);
    if (!c || !Array.isArray(c.teams)) return null;
    var teams = c.teams.map(function (team) { return ncaaDetailTeam(team, c); });
    teams.sort(function (a, b) { return (a.homeAway === 'away' ? 0 : 1) - (b.homeAway === 'away' ? 0 : 1); });
    // The general NCAA game response carries final/live scores and linescores
    // on the contest, so use the same normalized event model for those fields.
    var event = makeNCAAEvent(c, null);
    if (event) {
      var evTeams = event.competitions[0].competitors;
      teams.forEach(function (team) {
        var source = evTeams.find(function (x) { return x.homeAway === team.homeAway; });
        if (source) {
          team.score = source.score;
          team.linescores = source.linescores;
          team.winner = source.winner;
          team.records = source.records.reduce(function (out, rec) { out[rec.type] = rec.summary; return out; }, {});
          team.rank = source.curatedRank ? source.curatedRank.current : null;
          if (!team.logo && source.team.logo) team.logo = source.team.logo;
          if (!team.color && source.team.color) team.color = source.team.color;
        }
      });
    }
    return {
      teams: teams,
      players: [],
      drives: [],
      plays: [],
      article: null,
      rawKeys: Object.keys(data || {}).sort(),
      headerDate: ncaaIsoDate(c) || null,
      clock: c.clock || c.contestClock || null
    };
  }

  function ncaaLabel(key) {
    var special = {
      firstDowns: 'First Downs',
      thirdDowns: 'Third Downs',
      fourthDowns: 'Fourth Downs',
      teamYards: 'Total Yards',
      teamPlays: 'Total Plays',
      penaltyYards: 'Penalty Yards',
      passingYards: 'Passing Yards',
      rushingYards: 'Rushing Yards',
      defenseInterceptions: 'Interceptions',
      passingInterceptions: 'Interceptions',
      fumblesLost: 'Fumbles Lost'
    };
    if (special[key]) return special[key];
    return String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function ncaaLeafStats(value, out) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    Object.keys(value).forEach(function (key) {
      if (key === '__typename') return;
      var v = value[key];
      if (v === undefined || v === null || v === '') return;
      if (typeof v === 'object' && !Array.isArray(v)) ncaaLeafStats(v, out);
      else if (typeof v !== 'function') out[key] = String(v);
    });
  }

  function ncaaTeamBoxscoreEntries(data) {
    return data && Array.isArray(data.teamBoxscore) ? data.teamBoxscore : [];
  }

  function attachNCAATeamStats(detail, data) {
    ncaaTeamBoxscoreEntries(data).forEach(function (entry) {
      var teamId = entry && entry.teamId !== undefined && entry.teamId !== null ? String(entry.teamId) : null;
      var team = detail.teams.find(function (t) { return t.id === teamId; });
      if (!team || !entry.teamStats) return;
      var flat = {};
      ncaaLeafStats(entry.teamStats, flat);
      team.stats = Object.keys(flat).map(function (name) {
        return { name: name, label: ncaaLabel(name), displayValue: flat[name], value: flat[name] };
      });
    });
  }

  function ncaaPlayerCategoryName(player) {
    if (player.category) return String(player.category).toLowerCase();
    var type = String(player.__typename || '').replace(/^PlayerStatsFootball/, '');
    return (type || 'other').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  function ncaaPlayerStatKeys(player) {
    return Object.keys(player || {}).filter(function (key) {
      return ['__typename', 'firstName', 'lastName', 'number', 'position', 'category'].indexOf(key) === -1 &&
        player[key] !== undefined && player[key] !== null && player[key] !== '' && typeof player[key] !== 'object';
    });
  }

  function attachNCAAPlayers(detail, data) {
    var byTeam = {};
    ncaaTeamBoxscoreEntries(data).forEach(function (entry) {
      var teamId = entry && entry.teamId !== undefined && entry.teamId !== null ? String(entry.teamId) : null;
      if (!teamId || !Array.isArray(entry.playerStats)) return;
      if (!byTeam[teamId]) byTeam[teamId] = {};
      entry.playerStats.forEach(function (player) {
        var category = ncaaPlayerCategoryName(player);
        if (!byTeam[teamId][category]) {
          var labels = ncaaPlayerStatKeys(player).map(ncaaLabel);
          byTeam[teamId][category] = { name: category, title: ncaaLabel(category), labels: labels, descriptions: labels.slice(), athletes: [], totals: null };
        }
        var cat = byTeam[teamId][category];
        var keys = ncaaPlayerStatKeys(player);
        // A category can gain a field in a later row. Keep the table rectangular
        // by extending labels and each existing row with a placeholder.
        keys.forEach(function (key) {
          if (cat.labels.indexOf(ncaaLabel(key)) === -1) {
            cat.labels.push(ncaaLabel(key));
            cat.descriptions.push(ncaaLabel(key));
            cat.athletes.forEach(function (athlete) { athlete.stats.push('--'); });
          }
        });
        var values = cat.labels.map(function (label) {
          var key = keys.find(function (k) { return ncaaLabel(k) === label; });
          var value = key ? player[key] : null;
          return value === undefined || value === null || value === '' ? '--' : String(value);
        });
        cat.athletes.push({
          name: [player.firstName, player.lastName].filter(Boolean).join(' ') || 'Unknown',
          jersey: player.number === undefined || player.number === null ? '' : String(player.number),
          stats: values
        });
      });
    });
    detail.teams.forEach(function (team) {
      var cats = byTeam[team.id] || {};
      var categories = Object.keys(cats).map(function (key) { return cats[key]; });
      if (categories.length) detail.players.push({ teamId: team.id, categories: categories });
    });
  }

  function ncaaPlayType(text) {
    var s = String(text || '');
    if (/touchdown/i.test(s)) return 'Touchdown';
    if (/field goal/i.test(s)) return 'Field Goal';
    if (/extra point|two.point conversion/i.test(s)) return 'Extra Point';
    if (/kickoff/i.test(s)) return 'Kickoff';
    if (/punt/i.test(s)) return /return/i.test(s) ? 'Punt Return' : 'Punt';
    if (/penalty/i.test(s)) return 'Penalty';
    if (/interception/i.test(s)) return 'Interception';
    if (/fumble/i.test(s)) return 'Fumble';
    if (/pass/i.test(s)) return 'Pass';
    if (/rush/i.test(s)) return 'Rush';
    if (/timeout/i.test(s)) return 'Timeout';
    return 'Play';
  }

  function parseNCAAPlays(data) {
    var periods = data && Array.isArray(data.periods) ? data.periods : [];
    var plays = [];
    var previous = { away: null, home: null };
    periods.forEach(function (period) {
      var periodNumber = ncaaPeriod(period.periodNumber || period.period);
      (period.playbyplayStats || []).forEach(function (group) {
        (group.plays || []).forEach(function (raw) {
          var away = raw.visitorScore === undefined || raw.visitorScore === null ? null : Number(raw.visitorScore);
          var home = raw.homeScore === undefined || raw.homeScore === null ? null : Number(raw.homeScore);
          var text = raw.playText || raw.text || '';
          // NCAA rows often repeat the clock inside the text ("(06:35) Shotgun
          // …" — verified in the live 6531853 feed). raw.clock already carries
          // the quarter clock, so drop the duplicated prefix, matching the
          // normalization applied to ESPN rows.
          var clockPrefix = String(text).match(/^\((\d{1,2}:\d{2})\)\s*/);
          var playClock = raw.clock || (clockPrefix ? clockPrefix[1] : '');
          if (clockPrefix) text = text.slice(clockPrefix[0].length);
          var playTeamId = raw.teamId !== undefined && raw.teamId !== null ? raw.teamId : group.teamId;
          var changed = away !== null && home !== null && (away !== previous.away || home !== previous.home);
          // Scoring classification from the verified NCAA row texts. A PAT is
          // rendered as "kick attempt good" (not "extra point"), so it must be
          // checked before field goals — the open-ended "kick.*good" pattern
          // previously mistagged PATs as FGs. "NO GOOD"/missed tries are not
          // scores even though the word "good" appears in the text.
          var touchdown = /touchdown/i.test(text);
          var extraPoint = /extra point|two[- ]point conversion|kick attempt|conversion/i.test(text);
          var fieldGoal = !extraPoint && /field goal/i.test(text) && /good|made|successful/i.test(text) &&
            !/no\s*good|miss|wide|blocked/i.test(text);
          var safety = !touchdown && /safety/i.test(text);
          var scoringPlay = (changed && (touchdown || fieldGoal || safety || /score/i.test(text))) ||
            touchdown || fieldGoal || safety || extraPoint;
          var scoringType = touchdown ? 'TD' : fieldGoal ? 'FG' : safety ? 'SF' : extraPoint ? 'PAT' : null;
          plays.push({
            id: 'ncaa-' + (data.contestId || 'game') + '-' + plays.length,
            seq: plays.length + 1,
            type: ncaaPlayType(text),
            typeAbbr: '',
            text: text,
            period: periodNumber,
            clock: playClock,
            awayScore: away,
            homeScore: home,
            scoringPlay: scoringPlay,
            isPenalty: /penalty/i.test(text),
            isTurnover: /turnover|interception|fumble.*lost/i.test(text),
            priority: scoringPlay,
            yardage: (text.match(/for (\d+) yards/i) || [])[1] ? Number((text.match(/for (\d+) yards/i) || [])[1]) : 0,
            offTeamId: playTeamId === undefined || playTeamId === null ? null : String(playTeamId),
            defTeamId: null,
            possessionTeamId: playTeamId === undefined || playTeamId === null ? null : String(playTeamId),
            downDistance: raw.driveText || '',
            possession: '',
            scoringType: scoringType,
            pointAfter: null,
            driveId: null,
            time: 0,
            // NCAA-fallback play rows carry no field position / penalty objects
            // (only playText, driveText, clock, scores). Leave them null so the
            // booth never guesses a red-zone or penalty detail.
            start: null,
            end: null,
            penalty: null,
            penaltyText: /penalty/i.test(text)
              ? ((text.match(/penalty/i) ? '' : '') + 'Penalty')
              : '',
            scoreValue: null
          });
          if (away !== null) previous.away = away;
          if (home !== null) previous.home = home;
        });
      });
    });
    return plays;
  }

  function parseNCAADetail(gameData, boxscoreData, pbpData, teamStatsData) {
    var detail = parseNCAAOverview(gameData);
    if (!detail) return null;
    attachNCAATeamStats(detail, teamStatsData);
    if (!detail.teams.some(function (team) { return team.stats.length; })) attachNCAATeamStats(detail, boxscoreData);
    attachNCAAPlayers(detail, boxscoreData);
    detail.plays = parseNCAAPlays(pbpData);
    var keys = [];
    [gameData, boxscoreData, pbpData, teamStatsData].forEach(function (payload) {
      Object.keys(payload || {}).forEach(function (key) { if (keys.indexOf(key) === -1) keys.push(key); });
    });
    detail.rawKeys = keys.sort();
    return detail;
  }

  /* ---------------- Historical backfill: cross-provider matchup ----------------
   * ESPN event ids and NCAA contest ids are unrelated namespaces, but a game
   * is uniquely identified by its Eastern date and the two teams. When an ESPN
   * game's own detail cannot be retrieved, the verified NCAA date feed can
   * still provide it (verified 2026-08-28: ESPN event 401769074 ↔ NCAA contest
   * 6531853, Oregon at Indiana, 2026-01-09). Matching is conservative on
   * purpose: it may miss a matchup, but it must never attach the wrong game.
   */
  function normalizeTeamKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function espnSideMatchesNCAATeam(side, team) {
    var espnShort = normalizeTeamKey(side && side.name);
    var espnFull = normalizeTeamKey(side && side.displayName);
    var ncaaShort = normalizeTeamKey(team && (team.nameShort || (team.names && team.names.short)));
    var ncaaFull = normalizeTeamKey(team && (team.nameFull || (team.names && team.names.full)));
    if (!espnShort && !espnFull) return false;
    // ESPN "Oregon" (short) / "Oregon Ducks" (full) vs NCAA nameShort "Oregon".
    if (ncaaShort && ((espnShort && espnShort === ncaaShort) || (espnFull && espnFull.indexOf(ncaaShort) === 0))) return true;
    // NCAA nameFull "Indiana University, Bloomington" vs ESPN "Indiana".
    if (ncaaFull && espnShort && ncaaFull.indexOf(espnShort) === 0) return true;
    return false;
  }

  function ncaaContestsOf(data) {
    if (data && data.data && Array.isArray(data.data.contests)) return data.data.contests;
    if (data && Array.isArray(data.contests)) return data.contests;
    return [];
  }

  // A contest matches only when BOTH the away and the home side match the
  // clicked game. Same-day rematches of one team against different opponents
  // cannot false-positive through this rule.
  function findNCAAContestForGame(contests, game) {
    var list = Array.isArray(contests) ? contests : [];
    if (!game) return null;
    for (var i = 0; i < list.length; i++) {
      var teams = Array.isArray(list[i] && list[i].teams) ? list[i].teams : [];
      var away = null;
      var home = null;
      teams.forEach(function (t) {
        if (t && t.isHome === true) home = t;
        else if (t && t.isHome === false) away = t;
      });
      if (!away || !home) continue;
      if (espnSideMatchesNCAATeam(game.away, away) && espnSideMatchesNCAATeam(game.home, home)) return list[i];
    }
    return null;
  }

  function lastPlayScore(detail) {
    if (!detail || !detail.plays.length) return { away: null, home: null };
    var p = detail.plays[detail.plays.length - 1];
    return { away: p.awayScore, home: p.homeScore };
  }

  // Team stat rows: union of both teams' stat names (label + display values).
  function teamStatRows(awayT, homeT) {
    awayT = awayT || { stats: [] };
    homeT = homeT || { stats: [] };
    var rows = [];
    var seen = {};
    function push(t) {
      t.stats.forEach(function (st) {
        if (seen[st.name]) return;
        seen[st.name] = true;
        var other = (t === awayT ? homeT : awayT);
        var o = (other.stats || []).find(function (x) { return x.name === st.name; });
        rows.push({
          name: st.name,
          label: st.label,
          away: t === awayT ? st.displayValue : (o ? o.displayValue : '—'),
          home: t === homeT ? st.displayValue : (o ? o.displayValue : '—')
        });
      });
    }
    push(awayT);
    push(homeT);
    return rows;
  }

  /* ================================================================
   * LIVE BOOTH — flags & reviews (dark side of the game)
   *
   * A chat-style feed of every flag, coach's challenge, replay review
   * and under-review play from a game (and, at the day level, from every
   * game of the selected day). It tracks the running score before →
   * during → after a score is taken off the board and flags the nullified
   * scoring plays (offensive/defensive/special-teams touchdown, field goal,
   * safety, PAT and 2-pt conversion) plus the red-zone subset of those.
   *
   * Everything here is a pure reshape of the verified ESPN college-football
   * play objects (same text / type.text / isPenalty / penalty / start.* /
   * awayScore-homeScore running score shape the app already normalizes in
   * normalizePlay). Nothing is fetched and nothing is guessed: an unknown
   * field position or an unrisked nullification is never invented.
   *
   * NCAA wording: the college-football feed shares ESPN's play-by-play
   * writer with the NFL, but the referee announcements differ. As of the
   * 2025 season NCAA replay results are announced only as "upheld" or
   * "overturned" (the old "confirmed"/"stands" language was removed — see
   * the NCAA Football Rules Committee 2025 report and the Instant Replay
   * Rule 12 announcements). Accepted fouls wipe a down with "No Play" and
   * NCAA Rule 10 says the "play is nullified". The classifiers here match
   * BOTH the new NCAA language and the older NFL/ESPN wording so old and
   * new games are handled.
   * ================================================================ */

  // Kinds and labels are shared by the day feed, the game Flags & Reviews
  // tab and the Red Zone tab.
  var BOOTH_KINDS = ['penalty', 'challenge', 'replay', 'review'];
  var BOOTH_KIND_LABEL = {
    penalty: 'Flag',
    challenge: 'Challenge',
    replay: 'Replay',
    review: 'Under review'
  };
  var BOOTH_RESULT_LABEL = {
    pending: 'In progress',
    overturned: 'Overturned',
    upheld: 'Upheld',
    confirmed: 'Confirmed',
    stands: 'Stands',
    declined: 'Declined',
    offsetting: 'Offsetting'
  };
  // One shared filter row for the day feed, the game Flags & Reviews tab and
  // the Red Zone tab. "Nullified" selects the events that took a score off
  // the board. The day feed adds a "Red zone" cut on top.
  var BOOTH_FILTERS = [
    ['all', 'All'],
    ['penalty', 'Flags'],
    ['challenge', 'Challenges'],
    ['replay', 'Replay'],
    ['review', 'Under review'],
    ['nullified', 'Nullified']
  ];
  var DAY_BOOTH_FILTERS = BOOTH_FILTERS.concat([['redzone', 'Red zone']]);

  var LIVE_HEADER_URL = 'https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=football&league=college-football';
  var LIVE_SCORES_INTERVAL_MS = 250;   // 0.25s score/status cadence (serial: one header fetch in flight)
  var LIVE_REVIEWS_INTERVAL_MS = 1000; // 1s per-game play-by-play cadence floor
  var SCOREBOARD_INTERVAL_MS = 15000;  // 15s scoreboard poll (live days)
  var SCOREBOARD_IDLE_INTERVAL_MS = 60000; // 60s scoreboard poll once nothing is live
  // Booth load policy (fixes the starvation the day board hit on a full
  // Saturday): every live game used to be force-refreshed — finals included —
  // once per second, 39 multi-hundred-KB summary documents in parallel with
  // the scoreboard's own requests. Now: a pass takes at most
  // BOOTH_PASS_MAX_REFRESH games (BOOTH_SEED_PASS_MAX during the first seed),
  // each game re-fetches at most every max(LIVE_REVIEWS_INTERVAL_MS,
  // liveGames * BOOTH_BUSY_DAY_GAME_MS) so the burst is politely capped when
  // 30+ games are live, and only LIVE games are ever re-polled — a final
  // game refreshes once (on the live -> final transition) and then rests.
  var BOOTH_PASS_MAX_REFRESH = 8;
  var BOOTH_SEED_PASS_MAX = 12;
  var BOOTH_BUSY_DAY_GAME_MS = 400;    // per-live-game spacing on busy days
  // Global cap on provider transport attempts. A browser keeps ~6 open
  // connections per origin (documented Chromium behaviour), and the app
  // relay is same-origin, so the booth is deliberately limited to
  // BOOTH_MAX_ACTIVE < 6 attempts: at least two relay sockets always remain
  // free for a user-initiated scoreboard/game request.
  var PROVIDER_MAX_CONCURRENT = 6;
  var BOOTH_MAX_ACTIVE = 2;
  // Gate lanes: 0 = user-facing (day load, game open), 1 = secondary
  // (nearby discovery, game polls, live header feed), 2 = booth background.
  var LANE_USER = 0, LANE_AUX = 1, LANE_BOOTH = 2;
  var NON_REVIEW_RENDER_INTERVAL_MS = 5000; // 5s render throttle for large non-review tabs
  var BOOTH_SOUND_KEY = 'ncaaBoothSoundEnabled';

  // The score on each play (away/home) as a comparable pair.
  function boothScore(play) {
    return {
      away: (play && play.awayScore != null) ? Number(play.awayScore) : 0,
      home: (play && play.homeScore != null) ? Number(play.homeScore) : 0
    };
  }

  function scorePair(away, home) {
    return String(away != null ? away : 0) + '–' + String(home != null ? home : 0);
  }

  // Pure decision for the lowest-latency "points left the board" trigger: a
  // live game's total on the 250 ms scoreboard-header feed can only go up (a
  // score) — so a DECREASE is the fastest signal that a scoring play was
  // nullified (TD/FG/safety/PAT/2-pt taken off the board). This mirrors what
  // the play-by-play rollback math in boothScoreEffect derives from the running
  // awayScore/homeScore, but it is read straight off the header feed, one tick
  // earlier. `null` means "no information for that side" and never counts as a
  // drop. Returns true only when a side's total went strictly down.
  function boothScoreDropped(prevAway, prevHome, nextAway, nextHome) {
    function dropped(prev, next) {
      return prev != null && next != null && Number(next) < Number(prev);
    }
    return dropped(prevAway, nextAway) || dropped(prevHome, nextHome);
  }

  function boothKindCounts(events) {
    var counts = { all: (events || []).length, flag: 0, penalty: 0, challenge: 0, replay: 0, review: 0, nullified: 0, redzone: 0 };
    (events || []).forEach(function (e) {
      if (!e) return;
      if (e.kind === 'penalty' || e.kind === 'flag') {
        counts.flag += 1;
        counts.penalty += 1;
      } else if (e.kind != null && counts[e.kind] != null) {
        counts[e.kind] += 1;
      }
      if (boothEventNullifies(e)) counts.nullified += 1;
      if (e.redZone) counts.redzone += 1;
    });
    return counts;
  }

  function boothEventShown(e, filter) {
    if (!filter || filter === 'all') return true;
    if (filter === 'nullified') return boothEventNullifies(e);
    if (filter === 'redzone') return !!(e && e.redZone);
    if (filter === 'flag') return !!(e && (e.kind === 'penalty' || e.kind === 'flag'));
    return !!(e && e.kind === filter);
  }

  function boothFiltersHTML(filter, counts, attr, extraClass, filters) {
    return (filters || BOOTH_FILTERS).map(function (pair) {
      var id = pair[0], label = pair[1];
      var n = counts ? counts[id] : null;
      var extra = (id === 'all' || n == null) ? '' : ' · ' + n;
      var active = (filter === id) ? ' active on' : '';
      return '<button type="button" class="chip booth-filter' + (extraClass || '') + active + '" ' + (attr || 'data-booth-filter') + '="' + esc(id) + '">' +
        esc(label) + extra + '</button>';
    }).join('');
  }

  function boothScoreTrailHTML(e, awayAbbr, homeAbbr) {
    if (!e) return '';
    var hasScores = (e.beforeAwayScore != null || e.duringAwayScore != null || e.afterAwayScore != null);
    if (!hasScores) return '';
    var bAway = e.beforeAwayScore != null ? e.beforeAwayScore : (e.duringAwayScore != null ? e.duringAwayScore : 0);
    var bHome = e.beforeHomeScore != null ? e.beforeHomeScore : (e.duringHomeScore != null ? e.duringHomeScore : 0);
    var dAway = e.duringAwayScore != null ? e.duringAwayScore : bAway;
    var dHome = e.duringHomeScore != null ? e.duringHomeScore : bHome;
    var aAway = e.afterAwayScore != null ? e.afterAwayScore : dAway;
    var aHome = e.afterHomeScore != null ? e.afterHomeScore : dHome;

    var before = scorePair(bAway, bHome);
    var during = scorePair(dAway, dHome);
    var after = scorePair(aAway, aHome);
    var isNullified = boothEventNullifies(e);
    var isPending = e.result === 'pending' || (e.kind === 'review' && !e.result);

    var removedAbbr = e.removedTeam === 'away' ? awayAbbr
      : (e.removedTeam === 'home' ? homeAbbr : '');
    var removedBadge = e.removesPoints
      ? '<span class="badge removed">' +
        (removedAbbr ? esc(removedAbbr) + ' ' : '') +
        '−' + esc(e.pointsRemoved) + ' PTS</span>'
      : '';
    var nullifiedBadge = (!e.removesPoints && isNullified)
      ? '<span class="badge removed">NULLIFIED</span>'
      : '';
    var atRiskBadge = (isPending && (boothMentionsScore(e.text) || e.relatedScoringPlay))
      ? '<span class="badge review at-risk">SCORE AT RISK</span>'
      : (isPending ? '<span class="badge review">REVIEW IN PROGRESS</span>' : '');
    var related = isNullified && e.relatedScoringPlay && e.relatedScoringPlay.text
      ? '<span class="booth-note">' + esc(e.relatedScoringPlay.text) + '</span>'
      : '';
    var stateCls = isNullified ? ' removed' : (isPending ? ' at-risk' : '');

    return '<div class="booth-state' + stateCls + '">' +
      '<span class="bsh-label">Score</span> ' +
      '<span class="bsh-before">' + esc(before) + '</span> ' +
      '<span class="bsh-arrow">→</span> ' +
      '<span class="bsh-during' + (e.removesPoints ? ' removed' : (isPending ? ' at-risk' : '')) + '">' + esc(during) + '</span> ' +
      '<span class="bsh-arrow">→</span> ' +
      '<span class="bsh-after' + (e.removesPoints ? ' removed' : '') + '">' + (isPending ? '? (REVIEW)' : esc(after)) + '</span> ' +
      removedBadge +
      nullifiedBadge +
      atRiskBadge +
      '</div>' +
      related;
  }

  function boothHasExplicitScore(play) {
    return !!(play && (play.awayScore != null || play.homeScore != null));
  }

  function boothPlayText(p) { return (p && p.text) || ''; }
  function boothPlayType(p) { return (p && p.type) || ''; }

  // A score word is any touchdown field goal extra point / two-point
  // conversion / safety / PAT. Used to decide whether text is reporting a
  // score coming off the board (never on an ordinary play).
  var SCORE_WORDS = /\btouchdown\b|\bfield goal\b|\bextra point\b|\btwo[- ]point\b|\b2[- ]point\b|\bconversion\b|\bsafety\b|\bPAT\b|\btd\b/i;
  function boothMentionsScore(text) {
    return SCORE_WORDS.test(String(text || ''));
  }

  function boothIsNoGood(text) {
    var t = String(text || '').toLowerCase();
    return /\bno good\b/.test(t) || /\bblocked\b/.test(t) || /\bmissed\b/.test(t) ||
      /\bwide\b/.test(t) || /\bfailed\b/.test(t) || /\bincomplete\b/.test(t);
  }

  // True when a play's own description reports a score being wiped out. This
  // is the official "nullified" wording AND the two other shapes the feed uses:
  //   a) "<score> ... NULLIFIED" (explicit),
  //   b) an accepted foul that wipes the down ("- No Play" / "no play") on a
  //      scoring play,
  //   c) a replay verdict that OVERTURNED / REVERSED a scoring play.
  // NCAA 2025+ announces "upheld"/"overturned"; older games used the same
  // "nullified"/"No Play" wording. "void the score" / "erased" appear in the
  // rulebook and in ESPN write-ups and are matched too, but only when the text
  // names a score. The trigger set is deliberately closed (no "wiped" /
  // "taken off the board", etc.) so a score that is merely described is never
  // mis-flagged as nullified.
  function nullifiedScoreText(text) {
    var t = String(text || '');
    if (!t || !boothMentionsScore(t)) return false;
    if (/\bnullified\b/i.test(t)) return true;                 // explicit wording
    if (/\bno play\b/i.test(t)) return true;                   // accepted foul wipes the down
    if (/\breversed\b/i.test(t) || /\boverturned\b/i.test(t) || /\boverruled\b/i.test(t)) return true; // replay verdict
    if (/\bvoid the score\b/i.test(t) || /\berased\b/i.test(t)) return true;   // rulebook / write-up wording
    return false;
  }

  // A booth event nullifies when points actually left the running score, or
  // when its text reports the nullification above. Both signals are used so
  // the day feed, the Red Zone tab and the alert sound never disagree.
  function boothEventNullifies(event) {
    if (!event) return false;
    if (event.removesPoints) return true;
    if (event.nullified) return true;
    return nullifiedScoreText(event.text);
  }

  // Pure, testable decision for the live alert. `seen` tracks the last
  // announced state for a feed key: absent = never seen, false = seen while
  // NOT nullified, true = already alerted because it is (or became) nullified.
  // A play that first appears as "under review" (not nullified) and is later
  // OVERTURNED is re-announced once — on its final nullified state — so every
  // nullified scoring play fires the alert exactly once. Returns null when the
  // item should stay silent, otherwise { key, nullified } (the state to store).
  function boothAnnounceStep(seen, key, isNullified) {
    if (!key) return null;
    var prior = seen ? seen[key] : null;
    if (prior === true) return null;                    // already alerted for this nullified state
    if (prior === false && !isNullified) return null;   // seen non-nullified, still non-nullified
    var next = !!isNullified;
    if (seen) seen[key] = next;
    return { key: key, nullified: next };
  }

  // Classify the kind of a booth event. Operates on text and type, never on a
  // separate reviews feed (which the college-football summary does not serve).
  function boothClassify(p) {
    if (!p) return '';
    var type = boothPlayType(p).toLowerCase();
    var text = boothPlayText(p);
    if (/\bunder (further )?review\b/i.test(text) || type.indexOf('under review') !== -1) return 'review';
    if (/\bchallenged\b/i.test(text) || /\bchallenge by\b/i.test(text) || type.indexOf('challenge') !== -1) return 'challenge';
    if (/\breplay (official|review)\b/i.test(text) || /\bruling on the field\b/i.test(text) ||
        /\b(was|is) reversed\b/i.test(text) || /\b(was|is) overturned\b/i.test(text) ||
        /\b(was|is) overruled\b/i.test(text) || /\bupheld\b/i.test(text) ||
        type.indexOf('replay') !== -1) return 'replay';
    // A flag can be published two ways: `isPenalty:true` + a `penalty` object on
    // its own row, or (commonly in college football) the phrase "PENALTY <team>
    // <foul> (<player>) <yards> yards from <spot> to <spot>" embedded at the end
    // of the preceding play's text with isPenalty left false (verified in the
    // summary fixture: a kickoff row ends "... End Of Play PENALTY Mizzou Holding
    // (#45 C.Weselman) 7 yards from Mizzou14 to Mizzou07"). So accept an embedded
    // PENALTY marker too — never only the standalone row form.
    if (p.isPenalty || type === 'penalty' || /\bPENALTY on\b/.test(text) || /^\s*PENALTY\b/.test(text) ||
        /\bPENALTY\s+[A-Za-z][A-Za-z &'-]*\s+[A-Z]/.test(text) || /\bPENALTY\b/.test(text)) return 'penalty';
    return '';
  }

  // The verdict word in the text. NCAA 2025+ referee announcements say
  // "upheld" / "overturned"; older games used "confirmed" / "stands".
  function boothResult(text) {
    var t = String(text || '').toLowerCase();
    if (/\bunder (further )?review\b/.test(t)) return 'pending';
    if (/\breversed\b/.test(t) || /\boverturned\b/.test(t) || /\boverruled\b/.test(t)) return 'overturned';
    if (/\bupheld\b/.test(t)) return 'upheld';
    if (/\bconfirmed\b/.test(t)) return 'confirmed';
    if (/\bstands\b/.test(t)) return 'stands';
    if (/\bdeclined\b/.test(t)) return 'declined';
    if (/\boffset/.test(t)) return 'offsetting';
    return '';
  }

  // Red zone: opponent's 20 or inside. Uses the same verified position
  // fields the NFL mapping uses (start.yardsToEndzone is side-independent;
  // start.downDistanceText "Goal"/"goal-to-go" is a fallback; 0 means "not
  // provided", never "at the end zone"). NCAA plays carry these fields
  // (verified on the Core API play-by-play: start.yardsToEndzone,
  // downDistanceText, possessionText). A distance that cannot be established
  // is null — it is never guessed, and the play is not a red-zone play.
  var BOOTH_RED_ZONE_DISTANCE = 20;
  function boothYardsToEndzone(p, teamMap) {
    var s = p && p.start;
    if (!s) return null;
    if (s.yardsToEndzone != null && isFinite(s.yardsToEndzone) && s.yardsToEndzone >= 1) return s.yardsToEndzone;
    if (s.downDistanceText && /\bgoal\b/i.test(s.downDistanceText)) return BOOTH_RED_ZONE_DISTANCE;
    var m = (s.possessionText || '').match(/^\s*([A-Za-z&]{2,4})\s+(\d{1,3})\s*$/);
    if (m) {
      // The possession text names the nearer goal line. The distance to the
      // end zone depends on which way the offense is driving; the offense id
      // (if resolvable) tells us whether the named team is the offense.
      var offenseId = p.possessionTeamId || p.offTeamId || '';
      var offenseAbbr = (teamMap && offenseId && teamMap[offenseId] && teamMap[offenseId].abbr) || '';
      if (offenseAbbr) {
        var n = Number(m[2]);
        return (m[1] === offenseAbbr) ? 100 - n : n;
      }
    }
    return null;
  }
  function boothIsRedZonePlay(p, teamMap) {
    var d = boothYardsToEndzone(p, teamMap);
    return d != null && d <= BOOTH_RED_ZONE_DISTANCE;
  }

  function boothTeamOf(teamMap, id) {
    if (!teamMap || id == null) return { abbr: '', displayName: '', logo: '' };
    var t = teamMap[String(id)];
    if (!t) return { abbr: '', displayName: '', logo: '' };
    return t;
  }

  function boothHeading(kind, p) {
    if (kind === 'review') return 'Play under review';
    if (kind === 'challenge') return 'Coach\u2019s challenge';
    if (kind === 'replay') return 'Replay review';
    var text = (p && p.text) || '';
    if (p && p.penaltyText) return p.penaltyText;
    // Some NCAA/ESPN penalty rows carry only isPenalty + text (no penalty
    // object). Parse "<yards>-yard <Foul>" from the verified wording, in any of
    //   "PENALTY on <Team>-#<number>, <Foul>, <yards> yards"
    //   "PENALTY <Team> <Foul> (<number> <player>) <yards> yards from <spot> to <spot>"
    //   "PENALTY <Team> <Foul> <yards> yards"
    var m = text.match(/\bPENALTY\s+on\s+[^,]+,\s*([^,]+?),\s*(\d+)\s+yards/i);
    if (m) return m[2] + '-yard ' + m[1];
    var m2 = text.match(/\bPENALTY\s+[A-Za-z &'-]+?\s+([A-Za-z &'-]+?)\s+\(?#?\d+[)]?[^,]*?\s+(\d+)\s+yards\s+from/i);
    if (m2) return m2[2] + '-yard ' + m2[1];
    var m3 = text.match(/\bPENALTY\s+[A-Za-z &'-]+?\s+([A-Za-z &'-]+?)\s+(\d+)\s+yards\b/i);
    if (m3) return m3[2] + '-yard ' + m3[1];
    return (p && p.type) || 'Penalty';
  }

  function boothPenaltyText(p) {
    if (!p || !p.penalty) return '';
    return boothHeading('penalty', p);
  }

  // A single booth event from a normalized play (or null when the play is not
  // a flag / challenge / review). Position and score are attached later by
  // boothEventContext once the full play list is known.
  function boothEvent(p) {
    if (!p) return null;
    var kind = boothClassify(p);
    if (!kind) return null;
    return {
      id: p.id,
      seq: p.seq,
      kind: kind,
      type: boothPlayType(p),
      text: boothPlayText(p),
      heading: boothHeading(kind, p),
      result: boothResult(p.text),
      quarter: p.period,
      clock: p.clock,
      downDistance: p.downDistance || '',
      awayScore: p.awayScore != null ? p.awayScore : null,
      homeScore: p.homeScore != null ? p.homeScore : null,
      penaltyText: p.penaltyText || '',
      penaltyYards: (p.penalty && p.penalty.yards != null) ? p.penalty.yards : null,
      penaltyType: (p.penalty && p.penalty.typeText) || '',
      teamId: p.possessionTeamId || p.offTeamId || p.defTeamId || null,
      team: null, // filled by boothEventContext via teamMap
      yardsToEndzone: null, // filled below
      redZone: false,
      nullified: nullifiedScoreText(p.text)
    };
  }

  // A score-rollback can only belong to a booth event that could actually have
  // ruled on it: a scoring/nullification play, a review/challenge/replay, or a
  // penalty immediately after the scoring play. A routine kickoff/punt foul
  // that merely changes possession cannot remove the prior score.
  function boothRollbackEligible(plays, index) {
    var p = plays && plays[index];
    if (!p) return false;
    var text = boothPlayText(p);
    if (p.scoringPlay === true || boothMentionsScore(text)) return true;
    var kind = boothClassify(p);
    if (kind === 'review' || kind === 'challenge' || kind === 'replay') return true;
    if (kind !== 'penalty') return false;
    var type = boothPlayType(p);
    if (/kickoff|kick return|punt|punt return/i.test(type)) return false;
    for (var i = index - 1; i >= 0 && i >= index - 3; i -= 1) {
      var prior = plays[i];
      if (!prior) continue;
      if (/timeout/i.test(boothPlayType(prior))) continue;
      return boothIsScoringPlay(prior);
    }
    return false;
  }

  // True when a play is a scoring play that a booth event could nullify:
  // offensive, defensive (interception/fumble-return) and special-teams
  // (kickoff/punt/return) touchdowns, field goals, safeties and conversions.
  // Uses the feed's `scoringPlay`/`scoringType` flags AND the type/text wording
  // so defensive and special-teams scores are recognised from the same
  // published text — never guessed from a field position. `boothClassify`
  // returns first so a penalty/review row that merely mentions a score in its
  // text is not mistaken for the score itself.
  function boothIsScoringPlay(p) {
    if (!p) return false;
    if (p.scoringPlay === true) return true;
    if (boothClassify(p)) return false;
    var text = boothPlayText(p);
    var type = boothPlayType(p).toLowerCase();
    var scoringType = String(p.scoringType || '').toLowerCase();
    if (scoringType === 'td' || scoringType === 'fg' || scoringType === 'sf' || scoringType === 'pat') return true;
    if (/\btouchdown\b/i.test(text) || /\btouchdown\b/.test(type) || /\btd\b/.test(type) || type === 'touchdown') return true;
    if (/\bfield goal\b/i.test(text) || /\bfield goal\b/.test(type) || /\bfg\b/.test(type)) {
      if (boothIsNoGood(text)) return false;
      if (/\bgood\b/i.test(text)) return true;
      if (/\bfield goal\b/.test(type) || /\bfg\b/.test(type)) return true;
      return false;
    }
    if (/\bsafety\b/i.test(text) || /\bsafety\b/.test(type) || /\bsf\b/.test(type)) return true;
    if (/\bextra point\b/i.test(text) || /\bextra point\b/.test(type) || /PAT/i.test(type)) {
      if (boothIsNoGood(text)) return false;
      if (/\bgood\b/i.test(text)) return true;
      return false;
    }
    if (/(two-point|2-point|two point|2 point)/i.test(text) || /(two-point|2-point|two point|2 point)/i.test(type)) {
      if (boothIsNoGood(text)) return false;
      if (/\bgood\b/i.test(text) || /\bsuccessful\b/i.test(text)) return true;
      return false;
    }
    return false;
  }

  function boothNearestScoringPlay(plays, index, lookback) {
    var span = lookback != null ? lookback : 8;
    var start = Math.max(0, index - span);
    for (var i = index - 1; i >= start; i -= 1) {
      var p = plays[i];
      if (!p) continue;
      if (boothIsScoringPlay(p)) {
        var before = i > 0 ? boothScore(plays[i - 1]) : { away: 0, home: 0 };
        var after = boothScore(p);
        return {
          id: p.id,
          index: i,
          type: boothPlayType(p),
          text: boothPlayText(p),
          points: Math.max(0, after.away - before.away, after.home - before.home),
          team: (after.away - before.away) > 0 ? 'away' : ((after.home - before.home) > 0 ? 'home' : ''),
          score: after
        };
      }
    }
    return null;
  }

  // The heart of the booth: rebuild the score before / during / after an event
  // from the running awayScore-homeScore ESPN publishes on each play, without
  // trusting a transient lower total on an event that cannot rule on a score.
  function boothScoreEffect(plays, index) {
    if (!plays || index == null || index < 0 || index >= plays.length) {
      return { before: { away: 0, home: 0 }, during: { away: 0, home: 0 }, after: { away: 0, home: 0 }, removesPoints: false, pointsRemoved: 0, team: '' };
    }
    var before = index > 0 ? boothScore(plays[index - 1]) : boothScore(plays[index]);
    var eligible = boothRollbackEligible(plays, index);
    var publishedDuring = boothHasExplicitScore(plays[index]) ? boothScore(plays[index]) : before;
    var dropsScore = publishedDuring.away < before.away || publishedDuring.home < before.home;
    var during = (dropsScore && !eligible) ? before : publishedDuring;

    var removedAway = eligible ? Math.max(0, before.away - during.away) : 0;
    var removedHome = eligible ? Math.max(0, before.home - during.home) : 0;
    var after = during;
    var resolved = null;

    // A rollback is often published on the NEXT play (e.g. "Play under
    // review." then the verdict). Scan forward for the first lower running
    // score, but only for an event that could have caused that correction.
    var maxIndex = Math.min(plays.length, index + 5);
    var maxAway = Math.max(before.away, during.away);
    var maxHome = Math.max(before.home, during.home);
    if (eligible) {
      for (var i = index + 1; i < maxIndex; i += 1) {
        var s = boothScore(plays[i]);
        if (boothHasExplicitScore(plays[i]) && (s.away < maxAway || s.home < maxHome)) { resolved = s; break; }
        maxAway = Math.max(maxAway, s.away);
        maxHome = Math.max(maxHome, s.home);
      }
    }
    if (resolved) {
      after = resolved;
      removedAway = Math.max(removedAway, Math.max(0, maxAway - resolved.away));
      removedHome = Math.max(removedHome, Math.max(0, maxHome - resolved.home));
    } else if (!removedAway && !removedHome && index + 1 < plays.length && boothHasExplicitScore(plays[index + 1])) {
      var next = boothScore(plays[index + 1]);
      if (next.away >= during.away && next.home >= during.home) after = next;
    }

    var pointsRemoved = Math.max(removedAway, removedHome);
    return {
      before: before,
      during: during,
      after: after,
      removesPoints: pointsRemoved > 0,
      pointsRemoved: pointsRemoved,
      team: removedAway > 0 ? 'away' : (removedHome > 0 ? 'home' : '')
    };
  }

  // Attach the score trail and the verdict to a raw booth event, given its
  // index inside the full (sorted) play list for the game.
  function boothEventContext(event, plays, index, teamMap) {
    if (!event) return null;
    var effect = boothScoreEffect(plays, index);
    var related = boothNearestScoringPlay(plays, index);
    var t = boothTeamOf(teamMap, event.teamId);
    var withScores = Object.assign({}, event, {
      team: t,
      yardsToEndzone: boothYardsToEndzone(plays[index], teamMap),
      redZone: boothIsRedZonePlay(plays[index], teamMap),
      beforeAwayScore: effect.before.away,
      beforeHomeScore: effect.before.home,
      duringAwayScore: effect.during.away,
      duringHomeScore: effect.during.home,
      afterAwayScore: effect.after.away,
      afterHomeScore: effect.after.home,
      removesPoints: effect.removesPoints,
      pointsRemoved: effect.pointsRemoved,
      removedTeam: effect.team,
      relatedScoringPlay: related
    });
    withScores.nullified = boothEventNullifies(withScores);
    return withScores;
  }

  function boothContextIndex(plays, event) {
    if (!plays || !event) return -1;
    if (event.id != null) {
      for (var i = 0; i < plays.length; i += 1) {
        if (plays[i] && plays[i].id != null && String(plays[i].id) === String(event.id)) return i;
      }
    }
    if (event.seq != null) {
      var candidates = [];
      for (var j = 0; j < plays.length; j += 1) {
        var p = plays[j];
        if (!p || String(p.seq) !== String(event.seq)) continue;
        if (boothClassify(p) === event.kind) candidates.push(j);
      }
      if (candidates.length === 1) return candidates[0];
      for (var k = 0; k < candidates.length; k += 1) {
        if (boothPlayText(plays[candidates[k]]) === event.text) return candidates[k];
      }
    }
    return -1;
  }

  function boothMergeLiveLastPlay(plays, lastPlay) {
    var ctx = (plays || []).slice();
    if (!lastPlay) return ctx;
    var key = lastPlay.id != null ? String(lastPlay.id) : '';
    var at = -1;
    if (key) {
      for (var i = 0; i < ctx.length; i += 1) {
        if (ctx[i] && ctx[i].id != null && String(ctx[i].id) === key) { at = i; break; }
      }
    }
    if (at >= 0) {
      ctx[at] = lastPlay;
    } else {
      var copy = Object.assign({}, lastPlay);
      if (copy.seq == null || copy.seq === '') {
        var maxSeq = 0;
        ctx.forEach(function (p) { if (p && p.seq != null) maxSeq = Math.max(maxSeq, Number(p.seq) || 0); });
        copy.seq = maxSeq + 1;
      }
      ctx.push(copy);
    }
    ctx.sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
    return ctx;
  }

  // Build the booth events for one game from its flattened, sorted play list
  // (state.detail.plays) plus the live last play when present. teamMap maps a
  // team id to { abbr, displayName, logo, color } so messages can show a team.
  function boothEvents(plays, lastPlay, teamMap) {
    var context = boothMergeLiveLastPlay(plays, lastPlay);
    var out = [];
    var seen = {};
    context.forEach(function (p, index) {
      var ev = boothEvent(p);
      if (!ev) return;
      if (ev.id != null) seen[String(ev.id)] = out.length;
      out.push(ev);
    });
    var result = out.map(function (event) {
      var idx = boothContextIndex(context, event);
      return idx < 0 ? event : boothEventContext(event, context, idx, teamMap);
    });
    result.sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
    return result;
  }

  // Merge every game's booth events into one flat, chat-style list. Each input
  // is { id, shortName, awayAbbr, homeAbbr, date, live, events }. Ordering is
  // left to the caller (kickoff order); duplicates (same game + play) are kept
  // once first-occurrence-wins.
  function dayBoothFeed(games) {
    var out = [];
    var seen = {};
    (games || []).forEach(function (g) {
      if (!g) return;
      (g.events || []).forEach(function (e) {
        if (!e) return;
        var key = e.id != null
          ? String(g.id) + ':' + String(e.id)
          : String(g.id) + ':seq:' + (e.seq != null ? e.seq : '') + ':' + e.kind + ':' + (e.text || '');
        if (seen[key]) return;
        seen[key] = true;
        out.push(Object.assign({}, e, {
          key: key,
          gameId: g.id,
          shortName: g.shortName || '',
          awayAbbr: g.awayAbbr || '',
          homeAbbr: g.homeAbbr || '',
          date: g.date || null,
          liveGame: !!g.live
        }));
      });
    });
    return out;
  }

  // Preserve chat discovery order while replacing items whose source play was
  // updated in place (for example "under review" becoming "overturned").
  // Items no longer present in `fresh` stay in history; genuinely new keys are
  // appended.
  function reconcileDayBoothFeed(existing, fresh) {
    var out = (existing || []).slice();
    var positions = {};
    out.forEach(function (item, index) {
      if (item && item.key != null) positions[String(item.key)] = index;
    });
    (fresh || []).forEach(function (item) {
      if (!item) return;
      var key = item.key != null ? String(item.key) : '';
      if (key && Object.prototype.hasOwnProperty.call(positions, key)) {
        out[positions[key]] = item;
        return;
      }
      if (key) positions[key] = out.length;
      out.push(item);
    });
    return out;
  }

  // Latest cached booth event for a scoreboard game (used for the per-row
  // REVIEW badge). eventsByGame maps game id -> seq-sorted booth events.
  // Returns null when the game has no cached events (never invented).
  function lastPlayBooth(g, eventsByGame) {
    if (!g || g.id == null || !eventsByGame) return null;
    var events = eventsByGame[String(g.id)];
    if (!Array.isArray(events) || !events.length) return null;
    return events[events.length - 1] || null;
  }

  // Decide which day games a booth pass should (re)fetch, newest-priority
  // policy expressed as a pure function so it is unit-testable offline:
  //   - only scannable games: 'in'/'post' and not playByPlayAvailable === false
  //   - live games: at most one fetch per game per minIntervalMs (age >= min)
  //   - final games: fetched once; a live->final transition triggers exactly
  //     one refresh (rec.wasLive), then they rest
  //   - seed (forceAll): every scannable game regardless of cache age
  //   - ordering: live first (a hot flag matters now), then oldest refresh,
  //     then id for determinism; capped per pass so a 39-game slate cannot
  //     queue 39 multi-hundred-KB summary fetches in one cycle.
  function boothRefreshPlan(games, lastFetch, nowMs, cfg) {
    cfg = cfg || {};
    var minInterval = cfg.minIntervalMs > 0 ? cfg.minIntervalMs : 0;
    var perPass = cfg.perPass > 0 ? cfg.perPass : Infinity;
    var recs = [];
    (games || []).forEach(function (g) {
      if (!g || g.id == null) return;
      var st = g.status && g.status.state;
      if (st !== 'in' && st !== 'post') return;
      if (g.playByPlayAvailable === false) return;
      var id = String(g.id);
      var rec = (lastFetch || {})[id] || null;
      var live = st === 'in';
      var age = rec ? Math.max(0, (nowMs || 0) - (rec.t || 0)) : Infinity;
      var needed = false;
      if (cfg.forceAll) needed = true;
      else if (!rec) needed = true;
      else if (live) needed = age >= minInterval;
      else needed = !!rec.wasLive;
      if (!needed) return;
      recs.push({ id: id, live: live, age: age });
    });
    recs.sort(function (a, b) {
      if (a.live !== b.live) return a.live ? -1 : 1;
      if (b.age !== a.age) return b.age - a.age;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return recs.slice(0, perPass).map(function (r) { return r.id; });
  }

  // Priority fetch gate shared by every provider transport attempt. The
  // scoreboard's own day loads and the open game's first paint run at lane 0
  // (user-facing), secondary/detail work at lane 1, and the live booth's
  // background polls at lane 2 — capped BELOW the browser's 6-socket pool so
  // a busy booth day can never starve a scoreboard request. Within a lane the
  // queue is FIFO; lanes drain highest-priority-first.
  function createProviderGate(cfg) {
    cfg = cfg || {};
    var max = Math.max(1, cfg.max > 0 ? cfg.max : 6);
    var laneCaps = cfg.laneCaps || {};
    var laneCount = 3;
    var queues = [];
    for (var l = 0; l < laneCount; l++) queues.push([]);
    var active = 0;
    var peak = { active: 0, queued: [0, 0, 0] };
    function laneLimit(p) {
      return laneCaps[p] === undefined ? max : Math.min(max, Math.max(1, laneCaps[p]));
    }
    function runNext() {
      while (active < max) {
        var picked = -1;
        for (var p = 0; p < laneCount; p++) {
          if (queues[p].length && active < laneLimit(p)) { picked = p; break; }
        }
        if (picked < 0) return;
        var job = queues[picked].shift();
        active++;
        if (active > peak.active) peak.active = active;
        (function (job) {
          Promise.resolve().then(job.fn).then(function (value) {
            active--;
            job.res(value);
            runNext();
          }, function (err) {
            active--;
            job.rej(err);
            runNext();
          });
        })(job);
      }
    }
    return {
      run: function (fn, prio) {
        prio = Math.max(0, Math.min(laneCount - 1, prio | 0));
        return new Promise(function (res, rej) {
          queues[prio].push({ fn: fn, res: res, rej: rej });
          if (queues[prio].length > peak.queued[prio]) peak.queued[prio] = queues[prio].length;
          runNext();
        });
      },
      stats: function () {
        return { max: max, active: active, queued: queues.map(function (q) { return q.length; }), peak: peak };
      }
    };
  }
  // One module-wide gate. Node callers (tests) get plain sequential behaviour
  // because their fake fetches resolve immediately; browser callers get the
  // lane caps documented above.
  var providerGate = createProviderGate({ max: PROVIDER_MAX_CONCURRENT, laneCaps: { 2: BOOTH_MAX_ACTIVE } });


  /* ---------------- View helpers ---------------- */

  function statusVM(g) {
    var st = g.status;
    if (st.state === 'in') {
      if (/half/i.test(st.name) || /half/i.test(st.description)) return { kind: 'halftime', label: 'Halftime' };
      return { kind: 'live', label: periodLabel(st.period) + ' ' + st.clock };
    }
    if (st.state === 'post') {
      var n = Math.max(g.away.linescores.length, g.home.linescores.length);
      return { kind: 'final', label: n > 4 ? 'Final/OT' : 'Final' };
    }
    return { kind: 'pre', label: '' };
  }

  function lineColumns(g) {
    var n = Math.max(4, g.away.linescores.length, g.home.linescores.length);
    var cols = [];
    for (var i = 1; i <= n; i++) cols.push(i);
    return cols;
  }

  function fmtKickoff(iso, dateStr) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    // `dateStr` is an ESPN/Eastern date, so compare and format in Eastern
    // time as well. Formatting in the visitor's timezone made a late game
    // appear under a different day from the scoreboard it was returned for.
    var sameDay = easternDateStr(d) === dateStr;
    var opts = { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' };
    if (!sameDay) opts.weekday = 'short';
    return d.toLocaleTimeString('en-US', opts) + ' ET';
  }

  /* ================================================================
   * BROWSER APP (only runs when a DOM is present)
   * ================================================================ */
  if (typeof document === 'undefined') {
    return {
      API_BASE: API_BASE, ESPN_WEB_BASE: ESPN_WEB_BASE, NCAA_GRAPHQL_BASE: NCAA_GRAPHQL_BASE,
      NCAA_COMMUNITY_BASE: NCAA_COMMUNITY_BASE, JINA_READER_BASE: JINA_READER_BASE,
      CONFERENCES: CONFERENCES, CORS_PROXIES: CORS_PROXIES,
      scoreboardUrl: scoreboardUrl, scoreboardRangeUrl: scoreboardRangeUrl,
      ncaaScoreboardUrl: ncaaScoreboardUrl, ncaaGameUrl: ncaaGameUrl,
      ncaaBoxscoreUrl: ncaaBoxscoreUrl, ncaaPlayByPlayUrl: ncaaPlayByPlayUrl, ncaaTeamStatsUrl: ncaaTeamStatsUrl,
      summaryUrl: summaryUrl, proxiedUrl: proxiedUrl, proxyUrls: proxyUrls, providerUrls: providerUrls,
      readerUrl: readerUrl, readerContentToData: readerContentToData, readerPayloadToData: readerPayloadToData,
      isGitHubPagesHost: isGitHubPagesHost, isStaticDeployment: isStaticDeployment,
      espnFetch: espnFetch, easternDateStr: easternDateStr, localDateStr: localDateStr, shiftDate: shiftDate,
      etDateFromWallclock: etDateFromWallclock, fmtDayLabel: fmtDayLabel,
      eventsOf: eventsOf, validEventsOf: validEventsOf, eventIsCompleted: eventIsCompleted,
      scoreboardPayloadIsUsable: scoreboardPayloadIsUsable,
      scoreboardEventIsUsable: scoreboardEventIsUsable, eventMatchesGroups: eventMatchesGroups,
      filterEventsForGroups: filterEventsForGroups, filterEventsForDate: filterEventsForDate, filterEventsForRange: filterEventsForRange,
      groupByDay: groupByDay, calendarProbeWindows: calendarProbeWindows, fallbackProbeWindows: fallbackProbeWindows,
      parseEvent: parseEvent, parseNCAAOverview: parseNCAAOverview, parseNCAADetail: parseNCAADetail,
      parseCompetitor: parseCompetitor, mergeEvents: mergeEvents, groupGames: groupGames,
      shouldOpenNextGameDay: shouldOpenNextGameDay, periodLabel: periodLabel, normalizePlay: normalizePlay, extractPlays: extractPlays,
      parseDrives: parseDrives, parseSummary: parseSummary, lastPlayScore: lastPlayScore,
      teamStatRows: teamStatRows, statusVM: statusVM, lineColumns: lineColumns, fmtKickoff: fmtKickoff, weekForDate: weekForDate,
      ESPN_CORE_BASE: ESPN_CORE_BASE, espnCorePlaysUrl: espnCorePlaysUrl, summaryDrivesOf: summaryDrivesOf,
      extractCorePlays: extractCorePlays, normalizeTeamKey: normalizeTeamKey, espnSideMatchesNCAATeam: espnSideMatchesNCAATeam,
      ncaaContestsOf: ncaaContestsOf, findNCAAContestForGame: findNCAAContestForGame,
      BOOTH_KINDS: BOOTH_KINDS, BOOTH_KIND_LABEL: BOOTH_KIND_LABEL, BOOTH_RESULT_LABEL: BOOTH_RESULT_LABEL,
      BOOTH_FILTERS: BOOTH_FILTERS, DAY_BOOTH_FILTERS: DAY_BOOTH_FILTERS, BOOTH_RED_ZONE_DISTANCE: BOOTH_RED_ZONE_DISTANCE,
      boothClassify: boothClassify, boothResult: boothResult, boothMentionsScore: boothMentionsScore,
      nullifiedScoreText: nullifiedScoreText, boothEventNullifies: boothEventNullifies,
      boothAnnounceStep: boothAnnounceStep,
      boothScoreEffect: boothScoreEffect, boothEventContext: boothEventContext, boothEvent: boothEvent,
      boothEvents: boothEvents, dayBoothFeed: dayBoothFeed, reconcileDayBoothFeed: reconcileDayBoothFeed,
      boothYardsToEndzone: boothYardsToEndzone, boothIsRedZonePlay: boothIsRedZonePlay,
      boothIsScoringPlay: boothIsScoringPlay, boothNearestScoringPlay: boothNearestScoringPlay,
      boothKindCounts: boothKindCounts, boothEventShown: boothEventShown, boothScoreTrailHTML: boothScoreTrailHTML,
      boothScoreDropped: boothScoreDropped,
      lastPlayBooth: lastPlayBooth, boothRefreshPlan: boothRefreshPlan, createProviderGate: createProviderGate,
      isRateLimitError: isRateLimitError,
      scorePair: scorePair, LIVE_HEADER_URL: LIVE_HEADER_URL, LIVE_SCORES_INTERVAL_MS: LIVE_SCORES_INTERVAL_MS,
      LIVE_REVIEWS_INTERVAL_MS: LIVE_REVIEWS_INTERVAL_MS, SCOREBOARD_INTERVAL_MS: SCOREBOARD_INTERVAL_MS,
      SCOREBOARD_IDLE_INTERVAL_MS: SCOREBOARD_IDLE_INTERVAL_MS,
      BOOTH_PASS_MAX_REFRESH: BOOTH_PASS_MAX_REFRESH, BOOTH_SEED_PASS_MAX: BOOTH_SEED_PASS_MAX,
      BOOTH_BUSY_DAY_GAME_MS: BOOTH_BUSY_DAY_GAME_MS, PROVIDER_MAX_CONCURRENT: PROVIDER_MAX_CONCURRENT,
      BOOTH_MAX_ACTIVE: BOOTH_MAX_ACTIVE, LANE_USER: LANE_USER, LANE_AUX: LANE_AUX, LANE_BOOTH: LANE_BOOTH
    };
  }

  /* ---------------- State ---------------- */
  var state = {
    date: localDateStr(),
    loadedDate: null,
    confs: {},
    games: [],
    loading: false,
    error: null,
    lastUpdated: null,
    viaProxy: false,
    proxy: null,        // which CORS proxy is in use, when viaProxy is true
    provider: null,     // concrete provider URL that supplied the current data
    source: null,       // 'espn' or 'ncaa'
    detailSource: null, // game view only: 'espn-core' when PBP was backfilled
    weekLabel: '',
    seasonYear: null,
    league: null,       // leagues[0] of the loaded day (calendar for nearby windows)
    nearby: null,       // { loading, next, prev, error } — empty-day discovery
    nearbyFor: null,    // date the nearby search was run for
    nearbyIndex: {},    // gameId -> parsed event (nearby rows are clickable)
    // Set only for a clean first visit. Once a game day is found, normal date
    // navigation remains entirely under the visitor's control.
    defaultToNextGameDay: !location.hash || location.hash === '#' || location.hash === '#/',
    autoAdvanceToNextGameDay: false,
    view: 'scoreboard',
    gameId: null,
    game: null,          // parsed scoreboard event for the open game
    detail: null,        // parsed summary for the open game
    tab: 'pbp',
    pbpFilter: 'all',
    playerTeam: 0,
    follow: true,
    seenPlayIds: {},
    pollers: [],
    // Live booth (flags & reviews). boothFeed holds the day-wide list; the
    // per-game tabs read boothEventsGame. boothMap is a gameId -> teamMap so a
    // game's red zone resolution can find the team abbreviations.
    booth: {
      filter: 'all',
      paused: false,
      soundOn: true,
      audioContext: null,
      feed: [],              // reconciled day feed (dayBoothFeed shape)
      eventsByGame: {},      // gameId -> booth events for that game
      playsByGame: {},       // gameId -> normalized plays (raw cache, for sub-second live re-merge)
      nullifiedByGame: {},   // gameId -> newest nullified event info ({removesPoints, points})
      teamMaps: {},          // gameId -> { teamId: {abbr, displayName, logo, color} }
      gamesByKey: {},        // gameId -> { id, shortName, awayAbbr, homeAbbr, date, live }
      lastAnnounced: {},     // gameId:eventKey -> announced sound key
      lastFetch: {},         // gameId -> { t, wasLive } — booth refresh policy input
      lastPass: null,        // { mode, at, requested, fetched } of the latest pass
      passInFlight: false,   // one booth pass at a time (never stacked)
      pbpIntervalMs: 1000,   // per-game PBP floor in force this day (adaptive)
      count: 0,              // how many games are included in the day feed
      lastError: null,
      lastLivePlays: {},     // gameId -> live last-play object (for merging)
      lastHeaderScores: {}   // gameId -> {away,home} last header totals (for score-drop fast trigger)
    }
  };
  CONFERENCES.forEach(function (c) { state.confs[c.id] = true; });
  var freshIds = {};

  var main = document.getElementById('main');
  var subbar = document.getElementById('subbar');
  var liveBadge = document.getElementById('liveBadge');
  var liveCountEl = document.getElementById('liveCount');
  var dateInput = document.getElementById('dateInput');
  var dayBoothSection = document.getElementById('day-booth');

  /* ---------------- Tiny DOM helpers ---------------- */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function logoHtml(logo, abbr, cls) {
    var a = (abbr || '?').slice(0, 3).toUpperCase();
    if (logo) {
      return '<span class="' + cls + '" data-abbr="' + esc(a) + '"><img loading="lazy" src="' + esc(logo) + '" alt="' + esc(a) + '" onerror="this.parentNode.textContent=this.parentNode.getAttribute(\'data-abbr\')"></span>';
    }
    return '<span class="' + cls + '">' + esc(a) + '</span>';
  }
  function confTags(g) {
    var names = g.conferences.map(function (c) { return c.short; });
    if (!names.length) return '';
    return names.map(function (n) { return '<span class="gr-conf">' + esc(n) + '</span>'; }).join('');
  }

  /* ---------------- Polling ---------------- */
  function stopPolling() {
    state.pollers.forEach(clearInterval);
    state.pollers = [];
  }

  /* ---------------- Scoreboard view ---------------- */
  function enabledGroupIds() {
    return CONFERENCES.filter(function (c) { return state.confs[c.id]; }).map(function (c) { return c.id; });
  }

  // Fetch one day. The verified no-group ESPN request is the normal path: it
  // is one network operation, returns the complete event objects, and is
  // filtered locally by the enabled conference IDs. Do not use the combined
  // `groups=1,8,5,4,151` form — ESPN has returned placeholder `{}` events for
  // that form. Per-conference requests are a recovery path only.
  async function fetchDay(dateStr, groupIds, opts) {
    opts = opts || {};
    if (!groupIds.length) return { lists: [], unfiltered: false, viaProxy: false, proxy: null, provider: null, source: null, errors: [] };

    var errors = [];
    var lists = [];
    var viaProxy = false;
    var proxy = null;
    var provider = null;

    // NCAA is a date-based fallback, so try it before fanning out to five
    // conference requests. An ESPN empty response is also checked once: this
    // covers a provider that says “no games” while the independently verified
    // NCAA date feed has a real slate. A successful fallback is clean data, not
    // an error banner about the provider that was skipped.
    async function tryNCAA() {
      try {
        var ncaa = await espnFetch(ncaaScoreboardUrl(dateStr), undefined, { lane: LANE_USER, force: !!opts.interactive });
        if (scoreboardPayloadIsUsable(ncaa.data)) return ncaa;
        errors.push('NCAA returned no usable contests');
      } catch (ncaaError) {
        errors.push(String((ncaaError && ncaaError.message) || ncaaError));
      }
      return null;
    }

    try {
      var all = await espnFetch(scoreboardUrl(dateStr), undefined, { lane: LANE_USER, force: !!opts.interactive });
      if (scoreboardPayloadIsUsable(all.data)) {
        // A non-empty ESPN payload is authoritative for the selected date.
        // Only cross-check a genuinely empty slate; this keeps the normal path
        // at one request while preventing a false empty screen on a source
        // disagreement.
        if (validEventsOf(all.data).length) {
          return { lists: [all.data], unfiltered: true, viaProxy: all.viaProxy, proxy: all.proxy, provider: all.provider, source: 'espn', errors: [] };
        }
        var ncaaForEmpty = await tryNCAA();
        if (ncaaForEmpty) {
          // Keep the valid ESPN envelope alongside NCAA. Empty ESPN day
          // responses carry the league calendar used to jump across the
          // offseason (for example, from late August back to the January CFP
          // result); NCAA's exact date response carries the actual contests.
          return { lists: [ncaaForEmpty.data, all.data], unfiltered: false, viaProxy: ncaaForEmpty.viaProxy, proxy: ncaaForEmpty.proxy, provider: ncaaForEmpty.provider, source: 'ncaa', errors: [] };
        }
        // Both sources returned an empty/unavailable fallback. The valid ESPN
        // empty response is still a legitimate no-games result; do not turn a
        // failed optional cross-check into a blocking error.
        return { lists: [all.data], unfiltered: true, viaProxy: all.viaProxy, proxy: all.proxy, provider: all.provider, source: 'espn', errors: [] };
      }
      errors.push('ESPN no-group response contained no usable events');
    } catch (e) {
      errors.push(String((e && e.message) || e));
    }

    // If the complete feed is unavailable or malformed, use the exact NCAA
    // contest-date query before retrying ESPN one conference at a time. This
    // prevents a network outage from multiplying into five identical retries.
    // A usable NON-empty NCAA slate is authoritative and renders directly.
    // A usable-but-EMPTY NCAA response is kept as a safety net only: while the
    // ESPN day feed failed with a transport/rate-limit error (not an empty
    // result), the per-conference recovery still has to run first, otherwise a
    // throttled ESPN day would paint a real game day as empty.
    var ncaaEmptyFallback = null;
    var ncaaFallback = await tryNCAA();
    if (ncaaFallback) {
      if (validEventsOf(ncaaFallback.data).length) {
        return { lists: [ncaaFallback.data], unfiltered: false, viaProxy: ncaaFallback.viaProxy, proxy: ncaaFallback.proxy, provider: ncaaFallback.provider, source: 'ncaa', errors: [] };
      }
      ncaaEmptyFallback = ncaaFallback;
    }

    // If both complete feeds are unavailable, try each conference separately.
    // This avoids losing a usable partial slate and also covers providers that
    // only return conference events for filtered requests.
    var responses = await Promise.all(groupIds.map(function (gid) {
      return espnFetch(scoreboardUrl(dateStr, gid), undefined, { lane: LANE_USER, force: !!opts.interactive }).then(
        function (r) { return { ok: true, r: r, valid: scoreboardPayloadIsUsable(r.data) }; },
        function (err) { return { ok: false, err: String((err && err.message) || err) }; }
      );
    }));
    responses.forEach(function (result) {
      if (!result.ok) {
        errors.push(result.err);
        return;
      }
      if (!result.valid) {
        errors.push('ESPN returned an unusable event payload for one conference');
        return;
      }
      lists.push(result.r.data);
      if (result.r.viaProxy) { viaProxy = true; if (!proxy) proxy = result.r.proxy; }
      if (!provider) provider = result.r.provider;
    });

    if (lists.length) {
      var hasEvents = lists.some(function (data) { return validEventsOf(data).length > 0; });
      return { lists: lists, unfiltered: false, viaProxy: viaProxy, proxy: proxy, provider: provider, source: 'espn', errors: hasEvents ? errors : [] };
    }

    if (ncaaEmptyFallback) {
      // Every ESPN path failed and NCAA genuinely reported no contests. Show
      // the empty date, but keep the transport error visible rather than
      // pretending the providers agree on a scoreless day.
      return {
        lists: [ncaaEmptyFallback.data],
        unfiltered: false,
        viaProxy: ncaaEmptyFallback.viaProxy,
        proxy: ncaaEmptyFallback.proxy,
        provider: ncaaEmptyFallback.provider,
        source: 'ncaa',
        errors: errors
      };
    }
    return { lists: [], unfiltered: false, viaProxy: viaProxy, proxy: proxy, provider: provider, source: null, errors: errors };
  }

  var scoreboardRun = 0;

  function scoreboardLoadIsCurrent(run, requestedDate) {
    return run === scoreboardRun && state.view === 'scoreboard' && state.date === requestedDate;
  }

  async function loadScoreboard(showSpinner) {
    var run = ++scoreboardRun;
    var requestedDate = state.date;
    var wantedGroups = enabledGroupIds();
    var newDate = state.loadedDate !== requestedDate;
    var loadedSuccessfully = false;

    // Never leave a previous date's rows under a newly selected date while its
    // request is in flight. Background refreshes for the same date deliberately
    // retain the last good rows so a transient outage does not blank a live
    // scoreboard.
    if (newDate) {
      state.games = [];
      state.league = null;
      state.weekLabel = '';
      state.seasonYear = null;
      state.lastUpdated = null;
      state.viaProxy = false;
      state.proxy = null;
      state.provider = null;
      state.source = null;
      state.nearby = null;
      state.nearbyFor = null;
      state.nearbyIndex = {};
      // A newly selected date has its own slate; forget the previous day's
      // booth feed so a "no flags yet" state is not left behind. The run
      // token also cancels any in-flight booth pass of the old date.
      boothRun++;
      state.booth.feed = [];
      state.booth.eventsByGame = {};
      state.booth.teamMaps = {};
      state.booth.gamesByKey = {};
      state.booth.lastAnnounced = {};
      state.booth.lastLivePlays = {};
      state.booth.lastHeaderScores = {};
      state.booth.lastFetch = {};
      state.booth.nullifiedByGame = {};
      state.booth.lastPass = null;
      state.booth.count = 0;
    } else if (showSpinner !== false) {
      // An explicit reload of the same date should not display stale adjacent
      // cards while the new nearby search is running.
      state.nearby = null;
      state.nearbyFor = null;
      state.nearbyIndex = {};
    }
    if (showSpinner !== false) {
      state.loading = true;
      state.error = null;
      render();
    }
    try {
      var out = await fetchDay(requestedDate, wantedGroups, { interactive: showSpinner !== false });
      if (!scoreboardLoadIsCurrent(run, requestedDate)) return;

      var events = [];
      state.league = null;
      state.weekLabel = '';
      state.seasonYear = out.source === 'ncaa'
        ? (Number(requestedDate.slice(4, 6)) < 8 ? Number(requestedDate.slice(0, 4)) - 1 : Number(requestedDate.slice(0, 4)))
        : null;
      out.lists.forEach(function (data) {
        // ESPN events are top-level. NCAA fallback contests are normalized by
        // eventsOf; both paths are validated before they reach the parser.
        var rawEvents = validEventsOf(data);
        rawEvents = filterEventsForGroups(rawEvents, wantedGroups);
        // Providers normally honor the single-day query. Keep the UI honest if
        // a fallback response is cached, replayed, or accidentally contains a
        // second date: selected-day rows must belong to the selected Eastern
        // calendar date, not merely to the requested season.
        rawEvents = filterEventsForDate(rawEvents, requestedDate);
        events.push(rawEvents);
        var league = (data && data.leagues && data.leagues[0]) || null;
        if (league && league.season) {
          state.seasonYear = league.season.year;
          state.weekLabel = weekForDate(league.calendar || [], requestedDate);
          state.league = league;
        }
      });

      state.games = mergeEvents(events);
      state.viaProxy = out.viaProxy;
      state.proxy = out.proxy;
      state.provider = out.provider;
      state.source = out.source;
      var uniqueErrors = out.errors.filter(function (message, index, all) { return message && all.indexOf(message) === index; });
      state.error = uniqueErrors.length ? uniqueErrors.join('; ') : null;
      state.lastUpdated = new Date();
      state.loadedDate = requestedDate;
      loadedSuccessfully = true;
    } catch (e) {
      if (!scoreboardLoadIsCurrent(run, requestedDate)) return;
      // `newDate` already cleared old rows. For a same-date background refresh,
      // leave the last verified rows in place and show the transport failure.
      if (newDate) state.loadedDate = requestedDate;
      state.error = 'Could not load the scoreboard: ' + ((e && e.message) || e) +
        (state.viaProxy ? ' (direct and CORS-proxy requests both failed)' : '');
    }
    if (!scoreboardLoadIsCurrent(run, requestedDate)) return;
    state.loading = false;
    // A clean visit is useful even if today contains only final scores: open
    // the next day that has a scheduled game instead. A day with a live or
    // scheduled game is already the correct default and must not jump forward.
    // On any later navigation we preserve the selected day's normal view.
    state.autoAdvanceToNextGameDay = loadedSuccessfully && state.defaultToNextGameDay && shouldOpenNextGameDay(state.games);
    state.defaultToNextGameDay = false;
    if (state.nearbyFor !== requestedDate && wantedGroups.length) {
      // Always look for the surrounding games, not only on empty days. This
      // keeps upcoming and recent results visible below a non-empty slate too.
      // It also means a single-day failure (or a transient one) cannot
      // dead-end the scoreboard into an empty page.
      state.nearbyFor = requestedDate;
      findNearby(); // async; renders itself when done
    }
    render();
    if (state.view === 'scoreboard') {
      startScoreboardPollers();
      // Live booth: seed on a newly selected date, otherwise keep the running
      // plan fresh. Seeding used to force-refresh every game of the day on
      // every background reload; the day plan now paces it.
      buildDayBooth(newDate ? 'seed' : 'poll').then(function () {
        if (state.view === 'scoreboard') { renderDayBooth(); renderDiag(); }
      }).catch(function () { /* keep the last feed */ });
      startDayBoothPolling();
    }
  }

  // Background timers for the scoreboard view. Shared by loadScoreboard and
  // by a route() re-render that comes back to a same-date cached slate (the
  // old code only restarted the booth there and left the day/header tickers
  // dead). stopPolling() owns their teardown via state.pollers.
  function startScoreboardPollers() {
    stopPolling();
    var live = state.games.filter(function (g) { return g.status.state === 'in'; }).length;
    // Score/status come from the serial 250 ms header ticker while any game
    // is live (one small feed for the whole slate, never 39); the full
    // day request only refreshes the linescores/odds underneath it.
    var delay = live > 0 ? SCOREBOARD_INTERVAL_MS : SCOREBOARD_IDLE_INTERVAL_MS;
    state.pollers.push(setInterval(function () {
      if (!document.hidden) loadScoreboard(false);
    }, delay));
    state.pollers.push(setInterval(function () {
      if (document.hidden) return;
      var anyLive = state.games.some(function (g) { return g.status && g.status.state === 'in'; });
      if (anyLive) refreshLiveScores();
    }, LIVE_SCORES_INTERVAL_MS));
  }

  function weekForDate(calendar, dateStr) {
    var dt = new Date(dateStr.slice(0, 4) + '-' + dateStr.slice(4, 6) + '-' + dateStr.slice(6, 8) + 'T12:00:00Z');
    for (var i = 0; i < calendar.length; i++) {
      var seg = calendar[i];
      var entries = seg.entries || [];
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        var s = Date.parse(e.startDate), en = Date.parse(e.endDate);
        if (dt.getTime() >= s && dt.getTime() <= en) {
          return (seg.label === 'Regular Season' ? '' : seg.label + ' — ') + e.label;
        }
      }
    }
    return '';
  }

  /* ---------------- Nearby-games search ----------------
   * For every selected day, look for the next upcoming games and the most
   * recent results so the scoreboard is never a dead end:
   *   1. probe the next/previous 14 days (one ranged request each way —
   *      verified live: dates=FROM-TO returns every event in the span);
   *   2. if a direction is empty (deep offseason), use the season calendar
   *      from the day response to jump straight to the likely window
   *      (see calendarProbeWindows).
   * All probes use the enabled conference set.
   */
  function nearbyDay(day) {
    var games = day.events.map(parseEvent);
    games.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    games.forEach(function (g) { g.dayDate = day.date; });
    return { date: day.date, label: fmtDayLabel(day.date), games: games };
  }

  var nearbyRun = 0; // increments per search; stale runs discard their results

  async function findNearby() {
    var run = ++nearbyRun;
    var probeDate = state.date;
    var groupIds = enabledGroupIds();
    state.nearby = { loading: true, next: null, prev: null, error: null };
    render();

    // Range discovery intentionally starts without `groups=`. That endpoint
    // was independently observed to return complete events, while the
    // comma-separated groups form returns `{}` placeholders. Filter the
    // complete response locally, then use the exact NCAA date query only when
    // the range has no matching day or is unusable.
    async function probeNCAA(from, to, step) {
      var direction = step < 0 ? -1 : 1;
      var cursor = direction < 0 ? to : from;
      var end = direction < 0 ? from : to;
      var anyValid = false;
      var viaProxy = false;
      var proxy = null;
      var provider = null;

      // Nearby cards need only the closest matching day, not every date in the
      // window. Scanning from the near edge and stopping at the first matching
      // NCAA response avoids the old burst of up to 31 simultaneous requests
      // and stays within the public provider's rate limit.
      while ((direction > 0 && cursor <= end) || (direction < 0 && cursor >= end)) {
        try {
          var result = await espnFetch(ncaaScoreboardUrl(cursor), 8000, { lane: LANE_AUX });
          if (scoreboardPayloadIsUsable(result.data)) {
            anyValid = true;
            viaProxy = viaProxy || result.viaProxy;
            if (!proxy) proxy = result.proxy;
            if (!provider) provider = result.provider;
            var events = filterEventsForDate(
              filterEventsForGroups(validEventsOf(result.data), groupIds),
              cursor
            );
            if (direction < 0) events = events.filter(eventIsCompleted);
            if (events.length) {
              return { days: groupByDay(events), failed: false, viaProxy: viaProxy, proxy: proxy, provider: provider, source: 'ncaa' };
            }
          }
        } catch (e) {}
        cursor = shiftDate(cursor, direction);
      }
      return { days: [], failed: !anyValid, viaProxy: viaProxy, proxy: proxy, provider: provider, source: 'ncaa' };
    }

    async function probeDays(from, to, step) {
      var direction = step < 0 ? -1 : 1;
      try {
        var all = await espnFetch(scoreboardRangeUrl(from, to), undefined, { lane: LANE_AUX });
        if (scoreboardPayloadIsUsable(all.data)) {
          var rangeEvents = filterEventsForRange(validEventsOf(all.data), from, to);
          var rangeDays = groupByDay(filterEventsForGroups(rangeEvents, groupIds));
          if (rangeDays.length) {
            return {
              days: rangeDays,
              failed: false,
              viaProxy: all.viaProxy,
              proxy: all.proxy,
              provider: all.provider,
              source: 'espn'
            };
          }
          // A valid empty ESPN range is not a network failure, but confirm it
          // with the date-precise NCAA source so upcoming and prior cards are
          // not lost when the providers disagree about an offseason slate.
          var ncaaEmptyRange = await probeNCAA(from, to, direction);
          if (ncaaEmptyRange.days.length) return ncaaEmptyRange;
          return {
            days: [],
            failed: false,
            viaProxy: all.viaProxy,
            proxy: all.proxy,
            provider: all.provider,
            source: 'espn'
          };
        }
      } catch (e) {}

      var responses = await Promise.all(groupIds.map(function (gid) {
        return espnFetch(scoreboardRangeUrl(from, to, gid), undefined, { lane: LANE_AUX }).then(
          function (r) { return { ok: scoreboardPayloadIsUsable(r.data), r: r }; },
          function () { return { ok: false }; }
        );
      }));
      var events = [];
      var anyValid = false;
      var viaProxy = false;
      var proxy = null;
      var provider = null;
      responses.forEach(function (result) {
        if (!result.ok) return;
        anyValid = true;
        events = events.concat(filterEventsForRange(validEventsOf(result.r.data), from, to));
        if (result.r.viaProxy) { viaProxy = true; if (!proxy) proxy = result.r.proxy; }
        if (!provider) provider = result.r.provider;
      });
      var days = anyValid ? groupByDay(filterEventsForGroups(events, groupIds)) : [];
      if (days.length) {
        return {
          days: days,
          failed: false,
          viaProxy: viaProxy,
          proxy: proxy,
          provider: provider,
          source: 'espn'
        };
      }

      // If ESPN's ranged endpoint and its per-group form are both unavailable
      // (or only returned valid empty payloads), fall back to the official NCAA
      // date query one day at a time. The scan is directional and stops at the
      // closest matching day, so a previous-result card cannot accidentally
      // select the oldest event in the window.
      var ncaaResult = await probeNCAA(from, to, direction);
      if (ncaaResult.days.length || ncaaResult.failed || anyValid) {
        if (!ncaaResult.failed || !anyValid) return ncaaResult;
        return {
          days: [],
          failed: false,
          viaProxy: viaProxy || ncaaResult.viaProxy,
          proxy: proxy || ncaaResult.proxy,
          provider: provider || ncaaResult.provider,
          source: 'espn'
        };
      }
      return ncaaResult;
    }
    function pickFirst(result) {
      if (!result || !result.days.length) return null;
      for (var i = 0; i < result.days.length; i++) {
        var upcoming = result.days[i].events.filter(function (event) { return !eventIsCompleted(event); });
        if (upcoming.length) return { date: result.days[i].date, events: upcoming };
      }
      return null;
    }
    function pickLast(result) {
      if (!result || !result.days.length) return null;
      for (var i = result.days.length - 1; i >= 0; i--) {
        var completed = result.days[i].events.filter(eventIsCompleted);
        if (completed.length) return { date: result.days[i].date, events: completed };
      }
      return null;
    }

    var results = await Promise.all([
      probeDays(shiftDate(probeDate, 1), shiftDate(probeDate, 14), 1),
      probeDays(shiftDate(probeDate, -14), shiftDate(probeDate, -1), -1)
    ]);
    var fwdResult = results[0];
    var backResult = results[1];
    var next = pickFirst(fwdResult);
    var prev = pickLast(backResult);

    if (!next || !prev) {
      var w = state.league ? calendarProbeWindows(state.league, probeDate) : fallbackProbeWindows(probeDate);
      var extra = [];
      if (!next && w.fwd) extra.push(probeDays(w.fwd[0], w.fwd[1], 1).then(pickFirst).then(function (d) { if (d) next = d; }));
      if (!prev && w.back) extra.push(probeDays(w.back[0], w.back[1], -1).then(pickLast).then(function (d) { if (d) prev = d; }));
      if (extra.length) await Promise.all(extra);
    }

    // The user may have navigated away or changed the search while probing —
    // drop stale results.
    if (run !== nearbyRun || state.view !== 'scoreboard' || state.loadedDate !== probeDate) return;

    state.nearby = {
      loading: false,
      next: next ? nearbyDay(next) : null,
      prev: prev ? nearbyDay(prev) : null,
      error: (fwdResult.failed || backResult.failed) ? 'One or more nearby-games searches failed (network).' : null
    };
    state.nearbyIndex = {};
    [state.nearby.next, state.nearby.prev].forEach(function (day) {
      if (day) day.games.forEach(function (ev) { state.nearbyIndex[ev.id] = ev; });
    });

    // Only a clean visit that started on an empty/completed-only slate
    // auto-navigates. A live or scheduled game on the current day stays open.
    if (state.autoAdvanceToNextGameDay) {
      state.autoAdvanceToNextGameDay = false;
      if (state.nearby.next) {
        goScoreboard(state.nearby.next.date);
        return;
      }
    }
    render();
  }

  function renderSubbar() {
    var html = '';
    if (state.seasonYear) {
      html += '<span class="weeklabel">' + esc(state.seasonYear) + (state.weekLabel ? ' • ' + esc(state.weekLabel) : '') + '</span>';
    }
    CONFERENCES.forEach(function (c) {
      html += '<button class="chip' + (state.confs[c.id] ? ' on' : '') + '" data-conf="' + c.id + '">' + esc(c.short) + '</button>';
    });
    if (state.games.length) {
      var sourceLabel = state.source === 'ncaa' ? 'NCAA fallback' : (state.viaProxy ? 'via ' + (state.proxy === 'server' ? 'server relay' : (state.proxy || 'CORS proxy')) : 'ESPN');
      html += '<span class="chip-count">' + state.games.length + ' game' + (state.games.length === 1 ? '' : 's') +
        ' • ' + sourceLabel +
        (state.lastUpdated ? ' • updated ' + state.lastUpdated.toLocaleTimeString() : '') + '</span>';
    }
    subbar.innerHTML = html;
  }

  function gameRowHtml(g, ctxDate) {
    var dayDate = ctxDate || state.date;
    var sv = statusVM(g);
    var stHtml;
    if (sv.kind === 'live') {
      var parts = sv.label.split(' ');
      stHtml = '<span class="dot"></span><span class="st-big">' + esc(parts[0] || 'Live') + '</span> <span class="st-time">' + esc(parts.slice(1).join(' ')) + '</span>';
    } else if (sv.kind === 'halftime') {
      stHtml = '<span class="dot"></span><span class="st-big">Halftime</span>';
    } else if (sv.kind === 'final') {
      stHtml = '<span class="st-big">' + esc(sv.label) + '</span>';
    } else {
      stHtml = '<span class="st-time">' + esc(fmtKickoff(g.date, dayDate)) + '</span>';
    }

    var liveBooth = lastPlayBooth(g, state.booth.eventsByGame);
    var reviewBadge = (liveBooth && liveBooth.kind === 'review') ? '<span class="badge review">REVIEW</span>' : '';
    var nullified = state.booth.nullifiedByGame && state.booth.nullifiedByGame[String(g.id)];
    var nullBadge = nullified ? '<span class="badge removed">' + (nullified.removesPoints ? '−' + nullified.points + ' PTS' : 'NULLIFIED') + '</span>' : '';

    function teamSide(side, cls) {
      var t = g[side];
      var rec = t.records && t.records.total ? t.records.total : '';
      return '<div class="gr-team ' + cls + '">' +
        logoHtml(t.logo, t.abbreviation, 'gr-logo') +
        '<span class="gr-teamtext">' +
          '<span class="gr-line1">' + (t.rank ? '<span class="gr-rank">No. ' + t.rank + '</span>' : '') +
            '<strong>' + esc(t.abbreviation) + '</strong>' + (rec ? '<span class="gr-record">' + esc(rec) + '</span>' : '') + '</span>' +
          '<span class="gr-line2">' + esc(t.displayName) + (g.neutralSite ? ' • neutral site' : '') + '</span>' +
        '</span></div>';
    }

    var live = sv.kind === 'live' || sv.kind === 'halftime';
    var done = sv.kind === 'final';
    var aScore = g.away.score, hScore = g.home.score;
    var showScore = done || live;
    var scoresHtml = showScore
      ? '<span class="' + (done && g.away.winner ? 'winner' : '') + '">' + (aScore === null ? '—' : aScore) + '</span>' +
        '<span class="' + (done && g.home.winner ? 'winner' : '') + '">' + (hScore === null ? '—' : hScore) + '</span>'
      : '<span class="pending">–</span><span class="pending">–</span>';

    var linesHtml = '';
    // Some NCAA scoreboard rows expose a final score but no per-period
    // linescores. Do not render invented zeroes in that case; the final score
    // remains visible and the detail view can provide linescores when available.
    if (showScore && (g.away.linescores.length || g.home.linescores.length)) {
      var cols = lineColumns(g);
      function sideLine(t) {
        return cols.map(function (i) {
          var ls = t.linescores.find(function (x) { return x.period === i; });
          return ls ? esc(String(ls.value)) : '0';
        }).join(' ');
      }
      linesHtml = '<span>A ' + sideLine(g.away) + '</span><span>H ' + sideLine(g.home) + '</span>';
    }

    var meta = [];
    if (reviewBadge || nullBadge) {
      meta.push('<div style="display:flex;gap:4px;flex-wrap:wrap;">' + reviewBadge + nullBadge + '</div>');
    }
    if (g.broadcast) meta.push('<div><span class="gr-tv">' + esc(g.broadcast) + '</span>' + (g.neutralSite ? '<span>neutral</span>' : '') + '</div>');
    if (g.venueName) meta.push('<div>' + esc(g.venueCity ? g.venueName + ', ' + g.venueCity : g.venueName) + '</div>');
    if (g.conferences.length) meta.push('<div>' + confTags(g) + '</div>');
    g.notes.forEach(function (n) { meta.push('<div class="gr-note">' + esc(n) + '</div>'); });
    if (done && g.leaders.length) {
      var leadParts = g.leaders.slice(0, 3).map(function (L) {
        var nm = L.athlete.split(' ').pop();
        return '<b>' + esc(nm) + '</b> ' + esc(L.displayValue);
      });
      meta.push('<div class="gr-leaders">' + leadParts.join(' • ') + '</div>');
    }

    var rowCls = 'game-row state-' + ((sv.kind === 'live' || sv.kind === 'halftime') ? 'live' : sv.kind) + (nullified ? ' has-nullified' : '');

    return '<article class="' + rowCls + '" data-id="' + esc(g.id) + '" role="link" tabindex="0" aria-label="' + esc(g.name) + '">' +
      '<div class="gr-status">' + stHtml + '</div>' +
      teamSide('away', 'away') +
      '<div class="gr-score"><div class="gr-scores">' + scoresHtml + '</div><div class="gr-lines">' + linesHtml + '</div></div>' +
      teamSide('home', 'home') +
      '<div class="gr-meta">' + meta.join('') + '</div>' +
      '</article>';
  }

  function nearbySection(kind, day) {
    var html = '<div class="nb-block">' +
      '<div class="grouplabel nb-label">' +
        '<span>' + (kind === 'next' ? 'Upcoming — ' : 'Recent results — ') + esc(day.label) +
        ' (' + day.games.length + ' game' + (day.games.length === 1 ? '' : 's') + ')</span>' +
        '<button class="chip nb-jump" data-jump="' + esc(day.date) + '">Go to ' + esc(day.label) + ' →</button>' +
      '</div>';
    day.games.forEach(function (g) { html += gameRowHtml(g, day.date); });
    return html + '</div>';
  }

  function nearbyHtml() {
    var nb = state.nearby;
    if (!nb) return '';
    var html = '<div class="nearby">';
    if (nb.loading) {
      html += '<div class="nb-hunting"><span class="spinner inline"></span>Looking for the next games up and the most recent results…</div>';
    }
    if (nb.error) html += '<div class="banner info">' + esc(nb.error) + '</div>';
    if (nb.prev) html += nearbySection('prev', nb.prev);
    if (nb.next) html += nearbySection('next', nb.next);
    if (!nb.loading && !nb.error && !nb.prev && !nb.next) {
      html += '<div class="empty">No games found in the surrounding window — pick a date above.</div>';
    }
    return html + '</div>';
  }

  function renderScoreboard() {
    var html = '';
    if (state.error && !state.games.length) {
      html += '<div class="banner err">' + esc(state.error) + '</div>';
    }
    if (state.error && state.games.length) {
      html += '<div class="banner info">Some conference feeds failed: ' + esc(state.error) + '</div>';
    }
    if (state.loading && !state.games.length) {
      html += '<div class="spinner"></div>';
    } else if (!state.games.length) {
      if (!enabledGroupIds().length) {
        html += '<div class="empty day-empty"><strong>No conferences selected</strong>Turn on at least one conference chip above to see games.</div>';
      } else {
        html += '<div class="empty day-empty"><strong>No games on this date</strong>' +
          'None of the selected conferences play on this day. The closest games on either side are below — click any game to open it.' +
          '</div>';
        html += nearbyHtml();
      }
    } else {
      var sections = groupGames(state.games);
      sections.forEach(function (s, i) {
        html += '<div class="grouplabel' + (i === 0 ? ' first' : '') + '">' + esc(s.label) + ' (' + s.games.length + ')</div>';
        s.games.forEach(function (g) { html += gameRowHtml(g, state.date); });
      });
      // Keep the adjacent upcoming slate and latest completed slate visible
      // even when the selected date itself has games.
      html += nearbyHtml();
    }
    main.innerHTML = html;
  }

  /* ---------------- Game detail view ---------------- */
  function detailFromParsedGame(g) {
    if (!g) return null;
    function team(t, homeAway) {
      return {
        id: t.id,
        homeAway: homeAway,
        abbreviation: t.abbreviation,
        displayName: t.displayName,
        logo: t.logo,
        color: t.color,
        order: homeAway === 'away' ? 1 : 2,
        rank: t.rank,
        score: t.score,
        linescores: t.linescores || [],
        winner: t.winner,
        records: t.records || {},
        stats: []
      };
    }
    return {
      teams: [team(g.away, 'away'), team(g.home, 'home')],
      players: [], drives: [], plays: [], article: null,
      rawKeys: [], headerDate: g.date || null, clock: null
    };
  }

  async function loadNCAAData(gameId, opts) {
    opts = opts || {};
    var overview = await espnFetch(ncaaGameUrl(gameId), 12000, { lane: opts.lane == null ? LANE_AUX : opts.lane, force: !!opts.force });
    var contest = ncaaContestOf(overview.data);
    if (!contest) throw new Error('NCAA game response contained no contest');

    // Avoid the known 502 secondary routes for scheduled games. Completed/live
    // contests advertise which optional routes exist; each is still isolated so
    // one unavailable route cannot erase the overview scoreboard.
    var requests = [];
    if (contest.hasBoxscore) requests.push({ key: 'boxscore', url: ncaaBoxscoreUrl(gameId) });
    if (contest.hasPbp) requests.push({ key: 'pbp', url: ncaaPlayByPlayUrl(gameId) });
    if (contest.hasTeamStats) requests.push({ key: 'teamStats', url: ncaaTeamStatsUrl(gameId) });
    var extras = await Promise.all(requests.map(function (request) {
      return espnFetch(request.url, 12000, { lane: opts.lane == null ? LANE_AUX : opts.lane, force: !!opts.force }).then(function (r) {
        return { key: request.key, result: r };
      }).catch(function () {
        return { key: request.key, result: null };
      });
    }));
    var payloads = { boxscore: null, pbp: null, teamStats: null };
    extras.forEach(function (x) { if (x.result) payloads[x.key] = x.result.data; });
    var detail = parseNCAADetail(overview.data, payloads.boxscore, payloads.pbp, payloads.teamStats);
    if (!detail) throw new Error('NCAA game response could not be parsed');
    return { overview: overview, detail: detail, payloads: payloads };
  }

  // Historical PBP backfill from the verified ESPN Core API plays collection.
  // It needs only the event id, and the plays are paginated in much smaller
  // chunks than the summary document — so this still retrieves old games when
  // a transport that choked on the multi-hundred-KB summary is the only one a
  // browser allows. Pagination follows the envelope's pageCount (bounded).
  async function fetchCorePlays(eventId, opts) {
    opts = opts || {};
    var url = espnCorePlaysUrl(eventId);
    if (!url) return null;
    var rawItems = [];
    var viaProxy = false;
    var proxy = null;
    var provider = null;
    var page = 1;
    var pages = 1;
    while (page <= pages) {
      var r = await espnFetch(url + '&page=' + page, undefined, { lane: opts.lane == null ? LANE_AUX : opts.lane });
      var items = r.data && Array.isArray(r.data.items) ? r.data.items : [];
      if (page === 1 && !items.length) return null;
      rawItems = rawItems.concat(items);
      viaProxy = viaProxy || r.viaProxy;
      if (!proxy) proxy = r.proxy;
      if (!provider) provider = r.provider;
      var pageCount = Number(r.data && r.data.pageCount) || 1;
      pages = Math.min(Math.max(pageCount, 1), 6);
      page += 1;
    }
    var plays = extractCorePlays({ items: rawItems });
    return plays.length ? { plays: plays, viaProxy: viaProxy, proxy: proxy, provider: provider } : null;
  }

  // Cross-provider backfill for a clicked ESPN game whose own detail could
  // not be retrieved: find the same matchup in the verified NCAA date feed
  // (the date comes from the game itself, never guessed) and reuse the full
  // NCAA detail pipeline — overview, play-by-play, boxscore, team stats.
  async function tryNCAABackfill() {
    var g = state.game;
    if (!g || g.source !== 'espn') return null;
    var day = g.date ? etDateFromWallclock(g.date) : null;
    if (!day && /^\d{8}$/.test(state.date)) day = state.date;
    if (!day) return null;
    try {
      var dayResult = await espnFetch(ncaaScoreboardUrl(day), undefined, { lane: LANE_AUX });
      if (!scoreboardPayloadIsUsable(dayResult.data)) return null;
      var contest = findNCAAContestForGame(ncaaContestsOf(dayResult.data), g);
      if (!contest) return null;
      var id = contest.contestId || contest.id;
      if (id === undefined || id === null || id === '') return null;
      return await loadNCAAData(String(id));
    } catch (e) {
      return null;
    }
  }

  var gameRun = 0;

  function gameLoadIsCurrent(run, requestedId) {
    return run === gameRun && state.view === 'game' && state.gameId === requestedId;
  }

  async function loadGame(gameId, fromEvent) {
    var run = ++gameRun;
    var requestedId = String(gameId);
    stopPolling();
    state.view = 'game';
    state.gameId = requestedId;
    state.game = fromEvent || null;
    state.detail = null;
    state.error = null;
    state.lastUpdated = null;
    state.viaProxy = false;
    state.proxy = null;
    state.provider = null;
    state.source = state.game ? state.game.source : null;
    state.detailSource = null;
    state.seenPlayIds = {};
    freshIds = {};
    state.tab = 'pbp';
    state.pbpFilter = 'all';
    state.playerTeam = 0;
    render();
    try {
      if (state.game && state.game.source === 'ncaa') {
        var ncaa = await loadNCAAData(requestedId, { lane: LANE_USER, force: true });
        if (!gameLoadIsCurrent(run, requestedId)) return;
        state.detail = ncaa.detail;
        state.viaProxy = ncaa.overview.viaProxy;
        state.proxy = ncaa.overview.proxy;
        state.provider = ncaa.overview.provider;
        state.source = 'ncaa';
        if (!state.game) {
          var ncaaEvent = eventsOf(ncaa.overview.data)[0];
          if (ncaaEvent) state.game = parseEvent(ncaaEvent);
        }
      } else {
        try {
          var r = await espnFetch(summaryUrl(requestedId), undefined, { lane: LANE_USER, force: true });
          if (!gameLoadIsCurrent(run, requestedId)) return;
          var parsedSummary = parseSummary(r.data);
          if (!parsedSummary.teams.length) throw new Error('ESPN summary contained no teams');
          state.detail = parsedSummary;
          state.viaProxy = r.viaProxy;
          state.proxy = r.proxy;
          state.provider = r.provider;
          state.source = 'espn';
          // Historical backfill: a summary can parse cleanly yet carry no
          // drives/plays (older trimmed summaries). Reuse the verified Core
          // API plays index for the same event id before ever showing an
          // empty play-by-play tab for a game that has one.
          if (!state.detail.plays.length) {
            var core = await fetchCorePlays(requestedId, { lane: LANE_AUX }).catch(function () { return null; });
            if (!gameLoadIsCurrent(run, requestedId)) return;
            if (core) {
              state.detail.plays = core.plays;
              state.detailSource = 'espn-core';
              state.viaProxy = state.viaProxy || core.viaProxy;
              if (!state.proxy) state.proxy = core.proxy;
              if (!state.provider) state.provider = core.provider;
            }
          }
          if (!state.game) {
            await resolveGameEvent(run, requestedId);
            if (!gameLoadIsCurrent(run, requestedId)) return;
          } else {
            syncScoresFromPlays();
          }
        } catch (espnError) {
          // The summary transport itself failed (e.g. the only browser path to
          // the multi-hundred-KB summary document was blocked). Backfill the
          // historical detail from the verified indexes, in order:
          //   1. ESPN Core API plays for the same event id (small payloads);
          //   2. the NCAA contest for the same date and teams (own id space);
          //   3. for bare deep links, the legacy NCAA-contest-id reading.
          var coreBackfill = await fetchCorePlays(requestedId).catch(function () { return null; });
          if (!gameLoadIsCurrent(run, requestedId)) return;
          if (coreBackfill) {
            state.detail = state.game ? detailFromParsedGame(state.game) : {
              teams: [], players: [], drives: [], plays: [], article: null,
              rawKeys: [], headerDate: null, clock: null
            };
            state.detail.plays = coreBackfill.plays;
            state.detailSource = 'espn-core';
            state.source = 'espn';
            state.viaProxy = coreBackfill.viaProxy;
            state.proxy = coreBackfill.proxy;
            state.provider = coreBackfill.provider;
            if (!state.game) {
              // The plays carry wall clocks and a date-precise scoreboard
              // request is far smaller than the summary, so the header can
              // usually still be resolved even when the summary could not.
              await resolveGameEvent(run, requestedId);
              if (!gameLoadIsCurrent(run, requestedId)) return;
            } else {
              syncScoresFromPlays();
            }
          } else {
            var crosswalk = await tryNCAABackfill();
            if (!gameLoadIsCurrent(run, requestedId)) return;
            if (crosswalk) {
              state.detail = crosswalk.detail;
              state.viaProxy = crosswalk.overview.viaProxy;
              state.proxy = crosswalk.overview.proxy;
              state.provider = crosswalk.overview.provider;
              state.source = 'ncaa';
              state.detailSource = 'ncaa-backfill';
              var crosswalkEvent = eventsOf(crosswalk.overview.data)[0];
              if (crosswalkEvent) state.game = parseEvent(crosswalkEvent);
            } else {
              // A deep link contains only an ID, so it may be an NCAA contest ID
              // rather than an ESPN event ID. Try the verified NCAA overview before
              // giving up; rows already carrying an ESPN event never take this path.
              if (fromEvent) throw espnError;
              var ncaaFallback = await loadNCAAData(requestedId);
              if (!gameLoadIsCurrent(run, requestedId)) return;
              state.detail = ncaaFallback.detail;
              var fallbackEvent = eventsOf(ncaaFallback.overview.data)[0];
              state.game = fallbackEvent ? parseEvent(fallbackEvent) : null;
              state.viaProxy = ncaaFallback.overview.viaProxy;
              state.proxy = ncaaFallback.overview.proxy;
              state.provider = ncaaFallback.overview.provider;
              state.source = 'ncaa';
            }
          }
        }
      }
      if (!gameLoadIsCurrent(run, requestedId)) return;
      if (state.detail) state.detail.plays.forEach(function (p) { state.seenPlayIds[p.id] = true; });
      // Cache this game's booth events so the Flags & Reviews / Red Zone tabs
      // render immediately and the day feed can reuse them.
      if (state.detail && state.game) rebuildGameBoothFromDetail();
      state.lastUpdated = new Date();
    } catch (e) {
      if (!gameLoadIsCurrent(run, requestedId)) return;
      // A clicked row is useful even when every detail source is down; render
      // the scoreboard data the visitor already saw instead of a blank page
      // (the NCAA overview previously had this fallback; extend it to ESPN
      // rows now that historical backfills can still narrow the error).
      if (state.game && !state.detail) state.detail = detailFromParsedGame(state.game);
      state.error = 'Could not load game data: ' + ((e && e.message) || e);
    }
    if (!gameLoadIsCurrent(run, requestedId)) return;
    render();
    startGamePolling();
  }

  // Deep-link case: we only have the gameId. Find the scoreboard event so the
  // header has venue, TV, records, rankings, etc.
  async function resolveGameEvent(run, requestedId) {
    try {
      if (!gameLoadIsCurrent(run, requestedId)) return;
      var d = state.detail;
      if (!d) return;
      // Post/live games: use the first play's wall clock. Pre-games have no
      // plays — use the scheduled kickoff from summary.header (verified live:
      // header.competitions[0].date is present on pre-game summaries).
      var iso = null;
      if (d.plays.length && d.plays[0].time) iso = new Date(d.plays[0].time).toISOString();
      else if (d.headerDate) iso = d.headerDate;
      if (!iso) return;
      var et = etDateFromWallclock(iso);
      if (!et) return;
      var r = await espnFetch(scoreboardUrl(et), undefined, { lane: LANE_AUX }); // full day; one-shot
      if (!gameLoadIsCurrent(run, requestedId)) return;
      var league = (r.data && r.data.leagues && r.data.leagues[0]) || {};
      // Events live at the TOP level of the scoreboard payload (verified in
      // every live response: {"leagues":[...],"events":[...]}), not inside
      // leagues[0]. This was previously read from the wrong place, so deep
      // links never resolved the scoreboard event.
      var events = validEventsOf(r.data);
      var ev = events.find(function (e) { return String(e.id) === requestedId; });
      if (ev) {
        state.game = parseEvent(ev);
        if (league.season) state.seasonYear = league.season.year;
        state.weekLabel = weekForDate(league.calendar || [], et);
        state.date = et;
        state.loadedDate = et;
        if (r.viaProxy || state.viaProxy) {
          state.viaProxy = r.viaProxy || state.viaProxy;
          if (r.proxy) state.proxy = r.proxy;
          if (r.provider) state.provider = r.provider;
        }
      }
    } catch (e) {
      // Non-fatal: the header still renders from summary data.
      if (typeof console !== 'undefined') console.warn('resolveGameEvent failed:', (e && e.message) || e);
    }
  }

  function syncScoresFromPlays() {
    if (!state.detail || !state.game) return;
    var s = lastPlayScore(state.detail);
    if (s.away !== null) state.game.away.score = s.away;
    if (s.home !== null) state.game.home.score = s.home;
  }

  function updateGameFromNCAA(data) {
    var event = eventsOf(data)[0];
    if (!event) return false;
    var fresh = parseEvent(event);
    state.game = fresh;
    if (state.detail) {
      state.detail.teams.forEach(function (team) {
        var source = fresh[team.homeAway];
        if (!source) return;
        team.score = source.score;
        team.linescores = source.linescores;
        team.winner = source.winner;
      });
      var comp = event.competitions && event.competitions[0];
      state.detail.clock = comp && comp.status ? comp.status.displayClock : state.detail.clock;
    }
    return true;
  }

  function pollNCAAData() {
    var requestedId = state.gameId;
    var run = gameRun;
    if (!requestedId || state.view !== 'game') return;
    espnFetch(ncaaGameUrl(requestedId), 12000, { lane: LANE_AUX }).then(function (r) {
      if (!gameLoadIsCurrent(run, requestedId)) return;
      var oldState = state.game && state.game.status.state;
      if (!updateGameFromNCAA(r.data)) return;
      state.viaProxy = r.viaProxy || state.viaProxy;
      if (r.proxy) state.proxy = r.proxy;
      state.provider = r.provider || state.provider;
      state.lastUpdated = new Date();
      if (state.game.status.state !== oldState) {
        if (state.game.status.state === 'post') stopPolling();
        else if (state.game.status.state === 'in') {
          stopPolling();
          startGamePolling();
        }
      }
      render();
    }).catch(function () { /* retain the last verified scoreboard state */ });
  }

  function pollGameSummary() {
    var requestedId = state.gameId;
    var run = gameRun;
    if (!requestedId || state.view !== 'game') return;
    if (state.game && state.game.source === 'ncaa') {
      pollNCAAData();
      return;
    }
    espnFetch(summaryUrl(requestedId), undefined, { lane: LANE_AUX }).then(function (r) {
      if (!gameLoadIsCurrent(run, requestedId)) return;
      var prevIds = state.seenPlayIds;
      var hadDetail = !!state.detail;
      state.detail = parseSummary(r.data);
      state.viaProxy = r.viaProxy || state.viaProxy;
      if (r.proxy) state.proxy = r.proxy;
      state.provider = r.provider || state.provider;
      var newPlayIds = [];
      state.detail.plays.forEach(function (p) {
        if (!prevIds[p.id]) {
          state.seenPlayIds[p.id] = true;
          if (state.tab === 'pbp' && state.follow) {
            freshIds[p.id] = true;
            newPlayIds.push(p.id);
          }
        }
      });
      syncScoresFromPlays();
      // Rebuild this game's booth events so a live "under review" → "overturned"
      // transition updates the Flags & Reviews / Red Zone tabs and the day feed.
      if (state.game) rebuildGameBoothFromDetail();
      state.lastUpdated = new Date();
      if (hadDetail && newPlayIds.length && state.tab === 'pbp' && state.follow) {
        requestAnimationFrame(function () {
          var wrap = document.getElementById('pbWrap');
          if (wrap) wrap.scrollTop = 0;
        });
      }
      render();
    }).catch(function () { /* keep trying */ });
  }

  function pollGameStatus() {
    var requestedId = state.gameId;
    var requestedDate = state.date;
    var run = gameRun;
    if (!requestedId || state.view !== 'game' || !state.game) return;
    if (state.game.source === 'ncaa') {
      pollNCAAData();
      return;
    }
    var ids = state.game.conferenceIds.filter(function (id) {
      return CONFERENCES.some(function (c) { return c.id === id; });
    });
    var urls = ids.length
      ? ids.map(function (gid) { return espnFetch(scoreboardUrl(requestedDate, gid), undefined, { lane: LANE_AUX }).then(function (r) { return r.data; }).catch(function () { return null; }); })
      : [espnFetch(scoreboardUrl(requestedDate), undefined, { lane: LANE_AUX }).then(function (r) { return r.data; }).catch(function () { return null; })];
    Promise.all(urls).then(function (datas) {
      if (!gameLoadIsCurrent(run, requestedId)) return;
      var events = [];
      datas.forEach(function (d) {
        if (d) events = events.concat(validEventsOf(d));
      });
      var ev = events.find(function (e) { return String(e.id) === requestedId; });
      if (!ev) return;
      var fresh = parseEvent(ev);
      if (fresh.status.state === 'in') {
        state.game.status = fresh.status;
        state.game.broadcast = fresh.broadcast || state.game.broadcast;
        if (state.detail) state.detail.clock = fresh.status.clock;
        if (state.gamePollMode === 'pre') {
          // Game kicked off while we were watching: switch to fast polling.
          state.gamePollMode = 'in';
          stopPolling();
          startGamePolling();
        }
      } else if (fresh.status.state === 'post') {
        state.game = fresh;
        stopPolling();
        loadScoreboard(false); // refresh the list behind us
      }
      render();
    });
  }

  function startGamePolling() {
    stopPolling();
    if (!state.game || !state.detail) return;
    if (state.game.status.state === 'in') {
      state.gamePollMode = 'in';
      state.pollers.push(setInterval(pollGameSummary, 15000));
      state.pollers.push(setInterval(pollGameStatus, 30000));
    } else if (state.game.status.state === 'pre') {
      state.gamePollMode = 'pre';
      state.pollers.push(setInterval(pollGameStatus, 30000)); // waiting for kickoff
    }
  }

  /* ================================================================
   * LIVE BOOTH — browser wiring
   *
   * The pure booth engine (boothClassify / boothEventNullifies /
   * boothScoreEffect / dayBoothFeed, defined above) reshapes verified ESPN
   * play objects. This section owns the browser half:
   *   - build a teamMap from a game for red-zone resolution,
   *   - fetch each day game's play-by-play (ESPN summary, then the verified
   *     Core API plays index, then the NCAA fallback) once and cache the
   *     booth events per game,
   *   - render the day-wide feed above the scoreboard and the Flags &
   *     Reviews / Red Zone tabs inside a game,
   *   - poll the feed on the live pitches.
   * Polling cadence mirrors the NFL booth: score/status every 250 ms,
   * play-by-play every 1000 ms while a game is live (see /tmp/nfl-refresh.js
   * constants, adapted below). Completed/final days do not need a hot loop.
   * ================================================================ */

  // Polling cadences live with the engine constants above:
  // LIVE_SCORES_INTERVAL_MS (header feed), LIVE_REVIEWS_INTERVAL_MS (per-game
  // PBP floor) and the BOOTH_PASS_*/BOOTH_BUSY_DAY_GAME_MS load policy.

  // Build a teamMap for red-zone resolution from a parsed scoreboard event
  // (g.away/g.home carry id, abbreviation, displayName, color, logo).
  function boothTeamMapFromGame(g) {
    var map = {};
    if (!g) return map;
    [g.away, g.home].forEach(function (side) {
      if (!side || side.id == null) return;
      map[String(side.id)] = {
        id: String(side.id),
        abbr: side.abbreviation || '',
        displayName: side.displayName || side.name || '',
        logo: side.logo || null,
        color: side.color || null
      };
    });
    return map;
  }

  // Build from a parsed detail (detail.teams is [away, home]).
  function boothTeamMapFromDetail(d) {
    var map = {};
    if (!d) return map;
    (d.teams || []).forEach(function (t) {
      if (!t || t.id == null) return;
      map[String(t.id)] = {
        id: String(t.id),
        abbr: t.abbreviation || '',
        displayName: t.displayName || '',
        logo: t.logo || null,
        color: t.color || null
      };
    });
    return map;
  }

  // Fetch the play-by-play for one day game. Prefers the ESPN summary (it
  // carries the full normalized plays incl. start.yardsToEndzone + penalties
  // the booth needs), then the verified Core API plays index, then the NCAA
  // fallback (text/penalty only — no field position). Returns normalized plays.
  async function fetchPlaysForGame(game) {
    if (!game || !game.id) return { plays: [], source: game && game.source ? game.source : 'espn' };
    var id = String(game.id);
    // 1) ESPN summary plays.
    try {
      var r = await espnFetch(summaryUrl(id), 10000, { lane: LANE_BOOTH });
      var d = parseSummary(r.data);
      if (d.plays.length) return { plays: d.plays, detail: d, source: 'espn' };
    } catch (e) { /* try the next source */ }
    // 2) Core API plays (small, paginated; the historical backfill path).
    try {
      var core = await fetchCorePlays(id, { lane: LANE_BOOTH });
      if (core && core.plays.length) return { plays: core.plays, source: 'espn-core' };
    } catch (e) { /* try the NCAA fallback */ }
    // 3) NCAA fallback for NCAA-source games that refuse the ESPN endpoints.
    if (game.source === 'ncaa') {
      try {
        var overview = await espnFetch(ncaaGameUrl(id), 10000, { lane: LANE_BOOTH });
        var contest = ncaaContestOf(overview.data);
        var plays = [];
        if (contest && contest.hasPbp) {
          var pbp = await espnFetch(ncaaPlayByPlayUrl(id), 10000, { lane: LANE_BOOTH });
          plays = parseNCAAPlays(pbp.data);
        }
        if (plays.length) return { plays: plays, source: 'ncaa' };
      } catch (e) { /* nothing more to try */ }
    }
    return { plays: [], source: game.source || 'espn' };
  }

  // Build + cache the booth events for one game. Uses a provided plays list or
  // fetches it. The game's key metadata is stored so the day feed and tabs can
  // label rows without re-fetching.
  function rememberGameBooth(game, plays, teamMapOverride) {
    if (!game) return [];
    var id = String(game.id);
    var tm = teamMapOverride || boothTeamMapFromGame(game);
    // The scoreboard header feed carries each live game's last play (same
    // play shape the summary publishes — see README verification). Merging it
    // here gives the day feed a sub-second view of a fresh "under review"/flag
    // row while the per-game summary refresh runs on its paced schedule.
    var live = state.booth.lastLivePlays && state.booth.lastLivePlays[id];
    var livePlay = live ? normalizePlay(live) : null;
    var events = boothEvents(plays || [], livePlay, tm);
    // Cache the raw (non-merged) plays so the 250 ms header feed can re-merge a
    // fresh live last play without re-fetching the summary (see
    // refreshLiveBoothForGame). The live play is never stored here — merging it
    // again on the next refresh would otherwise accumulate rows.
    state.booth.playsByGame[id] = (plays || []).slice();
    state.booth.teamMaps[id] = tm;
    state.booth.eventsByGame[id] = events;
    state.booth.gamesByKey[id] = {
      id: id,
      shortName: (game.away && game.away.abbreviation) + ' @ ' + (game.home && game.home.abbreviation),
      awayAbbr: game.away ? game.away.abbreviation : '',
      homeAbbr: game.home ? game.home.abbreviation : '',
      date: game.date || null,
      live: !!(game.status && game.status.state === 'in')
    };
    return events;
  }

  // Shared tail of every booth refresh: rebuild a game's events, update the
  // per-row NULLIFIED badge, reconcile the day feed, announce any nullified
  // score (the only thing that ever chimes), and repaint. `game` is the parsed
  // scoreboard event; `plays` is the normalized play list (already including
  // the live last play when this is the fast path). Idempotent: re-running it
  // with the same data does not duplicate feed rows (dayBoothFeed + reconcile)
  // and does not re-alert (boothAnnounceStep dedupes by key).
  function applyBoothGame(game, plays) {
    var id = String(game.id);
    var tm = state.booth.teamMaps[id] || boothTeamMapFromGame(game);
    var events = rememberGameBooth(game, plays, tm);
    var lastNullified = null;
    for (var j = events.length - 1; j >= 0; j -= 1) {
      if (boothEventNullifies(events[j])) { lastNullified = events[j]; break; }
    }
    state.booth.nullifiedByGame[id] = lastNullified ? {
      removesPoints: !!lastNullified.removesPoints,
      points: lastNullified.pointsRemoved || 0
    } : null;
    var gk = state.booth.gamesByKey[id] || {};
    var perGame = [{
      id: id,
      shortName: gk.shortName || '',
      awayAbbr: gk.awayAbbr || '',
      homeAbbr: gk.homeAbbr || '',
      date: gk.date || null,
      live: !!(game.status && game.status.state === 'in'),
      events: events
    }];
    var fresh = dayBoothFeed(perGame);
    state.booth.feed = reconcileDayBoothFeed(state.booth.feed, fresh);
    state.booth.count = Object.keys(state.booth.eventsByGame).reduce(function (n, gid) {
      return n + ((state.booth.eventsByGame[gid] || []).length ? 1 : 0);
    }, 0);
    announceNewBoothEvents(fresh);
    // Refresh both the day feed and the per-row REVIEW / NULLIFIED badges
    // without waiting for a score/status change to repaint the scoreboard.
    renderDayBooth();
    renderScoreboard();
    renderDiag();
  }

  function boothGameFromId(id) {
    var game = null;
    (state.games || []).forEach(function (g) {
      if (g && String(g.id) === String(id)) game = g;
    });
    return game;
  }

  // Sub-second fast path (lowest-latency alert): re-merge the live header's
  // last play for ONE game into its cached booth events, re-announce, and
  // re-render — no per-game summary fetch. The header feed ticks every 250 ms;
  // wiring this here means a "play is under review" / flag / overturned verdict
  // reaches the alert sound and the feed on the header cadence instead of
  // waiting for the paced 1 s per-game PBP pass. It is purely local (no
  // provider request) and respects the paused flag.
  function refreshLiveBoothForGame(id) {
    if (state.view !== 'scoreboard' || state.booth.paused) return;
    var game = boothGameFromId(id);
    if (!game) return;
    applyBoothGame(game, state.booth.playsByGame[id] || []);
  }

  // Score-drop fast path (lowest-latency confirmation): when the header
  // total for a live game goes DOWN (a scoring play was nullified), trigger an
  // immediate per-game play-by-play fetch for that ONE game — bypassing the
  // paced per-game interval — so the authoritative nullifying row (and the
  // before->during->after trail) is in the feed as soon as the provider has it.
  // This closes the latency gap where the header's last-play feed has not yet
  // surfaced the nullifying row even though the total already dropped. It is
  // bounded: nullifications are rare, and the fetch runs through the booth lane
  // cap (BOOTH_MAX_ACTIVE), so it can never starve the scoreboard.
  async function refreshLiveBoothForScoreDrop(id) {
    if (state.view !== 'scoreboard' || state.booth.paused) return;
    var game = boothGameFromId(id);
    if (!game) return;
    try {
      var fetched = await fetchPlaysForGame(game);
      if (state.view !== 'scoreboard') return;
      applyBoothGame(game, fetched.plays);
      state.booth.lastFetch[id] = { t: Date.now(), wasLive: !!(game.status && game.status.state === 'in') };
      state.booth.lastError = null;
    } catch (fetchError) {
      state.booth.lastError = String((fetchError && fetchError.message) || fetchError);
      state.booth.lastFetch[id] = { t: Date.now(), wasLive: !!(game.status && game.status.state === 'in') };
    }
  }

  // Recompute the cached booth for the currently open game (used whenever its
  // play-by-play refreshes live).
  function rebuildGameBoothFromDetail() {
    if (!state.detail || !state.game) return [];
    var tm = boothTeamMapFromDetail(state.detail);
    // Prefer the detail teamMap (has color/logo), fall back to the game.
    if (!Object.keys(tm).length) tm = boothTeamMapFromGame(state.game);
    var plays = state.detail.plays || [];
    return rememberGameBooth(state.game, plays, tm);
  }

  // Build the day-wide feed. mode 'seed' = every scannable game of the day
  // (a newly selected date; still batched), 'poll' = whatever the refresh plan
  // says is due (live games past their per-game interval, live->final
  // transitions, never-cached games). Exactly one pass runs at a time: the old
  // code let a new 1 s tick stack on top of a still-running 39-game pass, which
  // is how the booth starved the scoreboard it sits above.
  var boothRun = 0; // navigation token; incremented to cancel in-flight passes
  async function buildDayBooth(mode) {
    if (state.booth.passInFlight) return state.booth.feed;
    var run = boothRun;
    state.booth.passInFlight = true;
    try {
      var currentGames = state.games || [];
      var byId = {};
      var liveScannable = 0;
      currentGames.forEach(function (g) {
        if (g && g.id != null) byId[String(g.id)] = g;
        if (g && g.status && g.status.state === 'in' && g.playByPlayAvailable !== false) liveScannable += 1;
      });
      if (!state.booth.nullifiedByGame) state.booth.nullifiedByGame = {};
      var perPass = mode === 'seed' ? BOOTH_SEED_PASS_MAX : BOOTH_PASS_MAX_REFRESH;
      var plan;
      if (mode === 'seed') {
        plan = boothRefreshPlan(currentGames, state.booth.lastFetch, Date.now(), {
          forceAll: true, perPass: perPass
        });
      } else {
        var minInterval = Math.max(LIVE_REVIEWS_INTERVAL_MS, liveScannable * BOOTH_BUSY_DAY_GAME_MS);
        state.booth.pbpIntervalMs = minInterval;
        plan = boothRefreshPlan(currentGames, state.booth.lastFetch, Date.now(), {
          minIntervalMs: minInterval, perPass: perPass
        });
      }
      state.booth.lastPass = { mode: mode || 'poll', at: Date.now(), requested: plan.length, fetched: 0 };
      var queue = plan.slice();
      async function worker() {
        while (queue.length) {
          if (run !== boothRun || state.view !== 'scoreboard') return; // stale pass
          var id = queue.shift();
          var game = byId[id];
          if (!game) continue;
          try {
            var fetched = await fetchPlaysForGame(game);
            if (run !== boothRun || state.view !== 'scoreboard') return; // invalidated mid-fetch
            var events = rememberGameBooth(game, fetched.plays);
            var lastNullified = null;
            for (var j = events.length - 1; j >= 0; j -= 1) {
              if (boothEventNullifies(events[j])) {
                lastNullified = events[j];
                break;
              }
            }
            state.booth.nullifiedByGame[id] = lastNullified ? {
              removesPoints: !!lastNullified.removesPoints,
              points: lastNullified.pointsRemoved || 0
            } : null;
            state.booth.lastFetch[id] = { t: Date.now(), wasLive: !!(game.status && game.status.state === 'in') };
            state.booth.lastPass.fetched += 1;
            state.booth.lastError = null;
          } catch (fetchError) {
            state.booth.lastError = String((fetchError && fetchError.message) || fetchError);
            // A failed fetch must not hot-loop: back off that game by one
            // interval so the next pass can retry it without a stampede.
            state.booth.lastFetch[id] = { t: Date.now(), wasLive: !!(game.status && game.status.state === 'in') };
          }
        }
      }
      // A small worker pool keeps per-pass latency bounded; the provider gate
      // caps real transport concurrency across everything (booth lane = 4).
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (run !== boothRun || state.view !== 'scoreboard') return state.booth.feed;
      // Assemble the feed from the cached events.
      var perGame = Object.keys(state.booth.eventsByGame).map(function (gameId) {
        var key = state.booth.gamesByKey[gameId] || {};
        return {
          id: gameId,
          shortName: key.shortName || '',
          awayAbbr: key.awayAbbr || '',
          homeAbbr: key.homeAbbr || '',
          date: key.date || null,
          live: !!key.live,
          events: state.booth.eventsByGame[gameId] || []
        };
      }).filter(function (g) { return g.events.length; });
      var fresh = dayBoothFeed(perGame);
      state.booth.feed = reconcileDayBoothFeed(state.booth.feed, fresh);
      state.booth.count = perGame.length;
      announceNewBoothEvents(fresh);
      return state.booth.feed;
    } finally {
      state.booth.passInFlight = false;
    }
  }

  function dayBoothScannable(g) {
    var st = g && g.status && g.status.state;
    if (st !== 'in' && st !== 'post') return false; // pre-game: no plays yet
    if (g && g.playByPlayAvailable === false) return false;
    return true;
  }

  // Detect newly discovered nullified / red-zone events and play a short
  // chime (when sound is on). boothAnnounceStep makes the decision: a play
  // already announced as nullified stays silent, but a "under review" play that
  // is later OVERTURNED is re-announced once for its final nullified state, so
  // every nullified scoring play alerts the user exactly once. Only nullified
  // scoring plays ever set shouldAlert — routine flags and reviews never chime.
  function boothEventSoundKey(item) {
    if (item && item.key != null) return String(item.key);
    return item ? ((item.gameId || '') + ':' + (item.id || (item.seq || '')) + ':' + (item.kind || '')) : '';
  }

  function unlockBoothAudio() {
    if (state.booth.audioContext || typeof AudioContext === 'undefined') return;
    try {
      state.booth.audioContext = new AudioContext();
      if (state.booth.audioContext.state === 'suspended') state.booth.audioContext.resume();
    } catch (e) {
      state.booth.audioContext = null;
    }
  }

  function playBoothAlert() {
    var ctx = state.booth.audioContext;
    if (!ctx) return;
    try {
      var start = ctx.currentTime;
      var DURATION = 3; // seconds

      // --- Rain bed: brown-ish noise, softened by a low-pass filter ---
      var sampleRate = ctx.sampleRate || 44100;
      var frameCount = Math.floor(sampleRate * DURATION);
      var buffer = ctx.createBuffer(1, frameCount, sampleRate);
      var data = buffer.getChannelData(0);
      var last = 0;
      for (var i = 0; i < frameCount; i += 1) {
        var white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
      var rain = ctx.createBufferSource();
      rain.buffer = buffer;
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1000, start);
      var rainGain = ctx.createGain();
      rainGain.gain.setValueAtTime(0.0001, start);
      rainGain.gain.linearRampToValueAtTime(0.22, start + 0.5); // gentle fade in
      rainGain.gain.setValueAtTime(0.22, start + 2.3);          // hold
      rainGain.gain.linearRampToValueAtTime(0.0001, start + DURATION); // fade out
      rain.connect(filter);
      filter.connect(rainGain);
      rainGain.connect(ctx.destination);
      rain.start(start);
      rain.stop(start + DURATION);

      // --- Water droplets: quiet falling sine "plips" over the rain bed ---
      [
        { at: 0.7, freq: 1200 },
        { at: 1.4, freq: 900 },
        { at: 2.1, freq: 1050 }
      ].forEach(function (drop) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var t = start + drop.at;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(drop.freq, t);
        osc.frequency.linearRampToValueAtTime(drop.freq * 0.55, t + 0.15);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.07, t + 0.02);
        gain.gain.linearRampToValueAtTime(0.0001, t + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    } catch (e) {}
  }

  function loadBoothSoundPref() {
    if (typeof localStorage === 'undefined') return;
    try {
      var stored = localStorage.getItem(BOOTH_SOUND_KEY);
      if (stored === '0') state.booth.soundOn = false;
      else if (stored === '1') state.booth.soundOn = true;
    } catch (e) {}
  }

  function saveBoothSoundPref() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(BOOTH_SOUND_KEY, state.booth.soundOn ? '1' : '0');
    } catch (e) {}
  }

  function toggleBoothSound() {
    state.booth.soundOn = !state.booth.soundOn;
    saveBoothSoundPref();
    renderDayBooth();
    unlockBoothAudio();
    if (state.booth.audioContext && state.booth.audioContext.state === 'suspended') {
      state.booth.audioContext.resume();
    }
    if (state.booth.soundOn) playBoothAlert();
  }

  function announceNewBoothEvents(fresh) {
    var shouldAlert = false;
    (fresh || []).forEach(function (item) {
      if (!item) return;
      var key = boothEventSoundKey(item);
      var step = boothAnnounceStep(state.booth.lastAnnounced, key, boothEventNullifies(item));
      if (!step) return;
      if (step.nullified) shouldAlert = true;
    });
    if (shouldAlert && !state.booth.paused && state.booth.soundOn) {
      playBoothAlert();
    }
  }

  // Filter a booth event list by the active booth filter.
  function boothFilterMatches(filter, e) {
    if (!filter || filter === 'all') return true;
    if (filter === 'nullified') return boothEventNullifies(e);
    if (filter === 'redzone') return !!(e && e.redZone && boothEventNullifies(e));
    return e && e.kind === filter;
  }

  function dayBoothMsgHTML(e, liveNow) {
    var q = periodLabel(e.quarter);
    var when = [q, e.clock].filter(Boolean).join(' · ');
    var kind = BOOTH_KIND_LABEL[e.kind] || e.kind;
    var result = e.result ? (BOOTH_RESULT_LABEL[e.result] || e.result) : '';
    var duringScore = (e.duringAwayScore != null && e.duringHomeScore != null)
      ? scorePair(e.duringAwayScore, e.duringHomeScore)
      : ((e.awayScore != null && e.homeScore != null)
      ? scorePair(e.awayScore, e.homeScore)
      : '');
    var score = duringScore
      ? esc(e.awayAbbr) + ' ' + esc(duringScore) + ' ' + esc(e.homeAbbr)
      : '';
    var logo = e.team && e.team.logo
      ? '<img class="logo" src="' + esc(e.team.logo) + '" alt="">'
      : '';
    var team = e.team && e.team.abbr
      ? '<span class="booth-team">' + esc(e.team.abbr) + '</span>'
      : '';
    var dd = e.downDistance
      ? '<span class="booth-dd">' + esc(e.downDistance) + '</span>'
      : '';
    var liveTag = liveNow ? '<span class="badge live">LIVE</span>' : '';
    var rz = e.redZone ? '<span class="badge rz">RZ</span>' : '';
    var isNullified = boothEventNullifies(e);
    var nullChip = (isNullified && !e.removesPoints)
      ? '<span class="badge removed">NULLIFIED</span>'
      : '';
    var stateHtml = boothScoreTrailHTML(e, e.awayAbbr, e.homeAbbr);
    var aria = esc(e.shortName) + ', ' + esc(kind) + ': ' + esc(e.text) +
      (e.removesPoints ? ', removed ' + esc(e.pointsRemoved) + ' points' : '') +
      (isNullified && !e.removesPoints ? ', score nullified' : '') +
      (e.redZone ? ', in the red zone' : '') +
      '. Open this game.';

    var kindCls = esc(e.kind || 'penalty');
    var removedCls = isNullified ? ' pts-removed' : '';

    return '<button type="button" class="day-msg booth-msg ' + kindCls + removedCls + '" data-id="' + esc(e.gameId) + '" aria-label="' + aria + '">' +
      '<div class="booth-msg-top">' +
      '<span class="day-game">' + esc(e.shortName) + '</span>' +
      liveTag +
      '<span class="badge ' + kindCls + '">' + esc(kind) + '</span>' +
      rz +
      nullChip +
      (result ? '<span class="badge result ' + esc(e.result) + '">' + esc(result) + '</span>' : '') +
      '<span class="booth-when">' + esc(when) + '</span>' +
      (score ? '<span class="booth-score">' + score + '</span>' : '') +
      '</div>' +
      '<div class="booth-msg-head">' +
      logo + team +
      '<span class="booth-heading">' + esc(e.heading) + '</span>' + dd +
      '</div>' +
      '<p class="booth-text">' + esc(e.text) + '</p>' +
      stateHtml +
      '</button>';
  }

  function boothMsgHTML(e, isNew) {
    var q = periodLabel(e.quarter);
    var when = [q, e.clock].filter(Boolean).join(' · ');
    var kind = BOOTH_KIND_LABEL[e.kind] || e.kind;
    var result = e.result ? (BOOTH_RESULT_LABEL[e.result] || e.result) : '';
    var duringScore = (e.duringAwayScore != null && e.duringHomeScore != null)
      ? scorePair(e.duringAwayScore, e.duringHomeScore)
      : ((e.awayScore != null && e.homeScore != null)
      ? scorePair(e.awayScore, e.homeScore)
      : '');
    var score = duringScore ? esc(duringScore) : '';
    var logo = e.team && e.team.logo
      ? '<img class="logo" src="' + esc(e.team.logo) + '" alt="">'
      : '';
    var team = e.team && e.team.abbr
      ? '<span class="booth-team">' + esc(e.team.abbr) + '</span>'
      : '';
    var dd = e.downDistance
      ? '<span class="booth-dd">' + esc(e.downDistance) + '</span>'
      : '';
    var liveTag = e.live ? '<span class="badge live">LIVE</span>' : '';
    var g = state.game;
    var awayAbbr = g && g.away ? g.away.abbreviation : '';
    var homeAbbr = g && g.home ? g.home.abbreviation : '';
    var stateHtml = boothScoreTrailHTML(e, awayAbbr, homeAbbr);
    var rz = e.redZone ? '<span class="badge rz">RZ</span>' : '';
    var isNullified = boothEventNullifies(e);
    var nullChip = (isNullified && !e.removesPoints)
      ? '<span class="badge removed">NULLIFIED</span>'
      : '';
    var kindCls = esc(e.kind || 'penalty');
    var removedCls = isNullified ? ' pts-removed' : '';
    var newCls = isNew ? ' new' : '';

    return '<div class="booth-msg ' + kindCls + removedCls + newCls + '">' +
      '<div class="booth-msg-top">' +
      '<span class="booth-when">' + esc(when) + '</span>' +
      liveTag +
      '<span class="badge ' + kindCls + '">' + esc(kind) + '</span>' +
      rz +
      nullChip +
      (result ? '<span class="badge result ' + esc(e.result) + '">' + esc(result) + '</span>' : '') +
      (score ? '<span class="booth-score">' + score + '</span>' : '') +
      '</div>' +
      '<div class="booth-msg-head">' +
      logo + team +
      '<span class="booth-heading">' + esc(e.heading) + '</span>' + dd +
      '</div>' +
      '<p class="booth-text">' + esc(e.text) + '</p>' +
      stateHtml +
      '</div>';
  }

  function dayBoothHTML() {
    var filter = state.booth.filter || 'all';
    var items = state.booth.feed || [];
    var liveCount = state.games.filter(function (g) { return g.status && g.status.state === 'in'; }).length;
    var counts = boothKindCounts(items);
    var visible = items.filter(function (e) { return boothFilterMatches(filter, e); });
    var filters = boothFiltersHTML(filter, counts, 'data-booth-filter', ' day-filter', DAY_BOOTH_FILTERS);

    var scannable = state.games.filter(dayBoothScannable).length;
    var scanned = Object.keys(state.booth.eventsByGame).length;

    // Cadence copy states what the wiring actually does: the header feed ticks
    // every 0.25 s (serialised, so its real rate is one fetch at a time), and
    // each game's play-by-play re-fetches at max(1 s, liveGames * 0.25 s) —
    // 1 s on a light slate, gently paced on a 30-game Saturday so the
    // scoreboard's own requests never queue behind a 39-summary stampede.
    var liveScannable = state.games.filter(function (g) {
      return g.status && g.status.state === 'in' && g.playByPlayAvailable !== false;
    }).length;
    var pbpSecs = Math.max(LIVE_REVIEWS_INTERVAL_MS, liveScannable * BOOTH_BUSY_DAY_GAME_MS) / 1000;
    var pbpLabel = pbpSecs % 1 ? pbpSecs.toFixed(1).replace(/\.0$/, '') + 's' : pbpSecs + 's';

    var foot = 'Every flag & review from all of today’s games · pulled from ESPN play-by-play · ' +
      'tracks score before → during → after when a nullified score comes off the board · ' +
      'nullified & red zone cover any scoring play (touchdown, field goal, safety, PAT & 2-pt) · score/status 0.25s · play-by-play ' + pbpLabel + '/game' +
      (scannable ? ' · games scanned ' + scanned + ' of ' + scannable : '') +
      (liveCount ? ' · ' + liveCount + ' game' + (liveCount === 1 ? '' : 's') + ' live' : '');

    // Top banner listing the day's nullified scores
    var nullifiedAll = items.filter(boothEventNullifies);
    var topBanner = '';
    if (nullifiedAll.length) {
      var summary = nullifiedAll.slice(0, 3).map(function (e) {
        var pts = e.removesPoints ? ' −' + e.pointsRemoved + 'pts' : '';
        return esc((e.shortName || '') + (pts || ''));
      }).join(', ');
      var more = nullifiedAll.length > 3 ? ' +' + (nullifiedAll.length - 3) + ' more' : '';
      topBanner = '<div class="booth-banner removed-banner day-removed-banner">' +
        '<span class="badge removed">' + nullifiedAll.length + ' NULLIFIED</span>' +
        '<span>Scores taken off the board: ' + summary + more + ' – filter Nullified.</span>' +
        '</div>';
    }

    var body;
    if (!visible.length) {
      body = '<div class="booth-empty">' +
        (scanned < scannable
          ? 'Scanning today’s games for flags and reviews…'
          : (filter === 'redzone' && counts.all
            ? 'No nullified scores in the red zone (the opponent’s 20 or inside) today — no touchdown, field goal, safety, PAT or 2-pt conversion has been wiped out from there.'
            : (filter === 'nullified' && counts.all
              ? 'No nullified scores today — no touchdown, field goal, safety, PAT or 2-pt conversion has been taken off the board.'
              : 'No flags or reviews on this day yet — kickoff hasn’t happened, or the games were clean.'))) +
        '</div>';
    } else {
      body = '<div class="day-feed">' +
        visible.map(function (e) {
          var isLive = state.games.some(function (g) { return String(g.id) === String(e.gameId) && g.status && g.status.state === 'in'; });
          return dayBoothMsgHTML(e, isLive);
        }).join('') +
        '</div>';
    }

    var soundOn = !!state.booth.soundOn;
    var soundTitle = soundOn
      ? 'Alert sound ON - a gentle rain sound plays only when a score is nullified. Click to mute.'
      : 'Alert sound OFF - click to enable and test the rain alert sound.';

    return '<div class="booth">' +
      '<div class="booth-head">' +
      '<div class="booth-head-main">' +
      '<span class="booth-title"><span class="dot"></span> Live booth · flags &amp; reviews · all games</span>' +
      '<div class="booth-sub">' + esc(foot) + '</div>' +
      '</div>' +
      '<button type="button" class="day-sound-btn' + (soundOn ? ' on' : '') + '" title="' + esc(soundTitle) + '">' +
      (soundOn ? '🔔 Sound On' : '🔇 Sound Off') +
      '</button>' +
      '</div>' +
      topBanner +
      '<div class="booth-filters">' + filters + '</div>' +
      body +
      '</div>';
  }

  // Render the day-wide feed that sits above the scoreboard.
  function renderDayBooth() {
    if (!dayBoothSection) return;
    var show = state.view === 'scoreboard' && state.games.length > 0;
    if (!show) { dayBoothSection.classList.add('hidden'); return; }
    dayBoothSection.classList.remove('hidden');

    var feed = dayBoothSection.querySelector('.day-feed');
    var prevScroll = feed ? feed.scrollTop : 0;
    var nearBottom = !feed || (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 56);

    dayBoothSection.innerHTML = dayBoothHTML();

    var feed2 = dayBoothSection.querySelector('.day-feed');
    if (feed2) {
      if (nearBottom) feed2.scrollTop = feed2.scrollHeight;
      else feed2.scrollTop = prevScroll;
    }
  }

  // Game-level Flags & Reviews / Red Zone panel (reads the cached game events).
  // When the visitor is on the Red Zone tab, the red-zone cut is always applied
  // on top of their chip selection; the filter chips then narrow within (e.g.
  // only nullified red-zone plays). This mirrors the NFL booth's red-zone view.
  function boothGameHtml() {
    var id = state.game ? String(state.game.id) : '';
    var allEvents = state.booth.eventsByGame[id] || [];
    var isRedZoneTab = state.tab === 'redzone';
    var events = allEvents.filter(function (e) {
      return !isRedZoneTab || (e.redZone && boothEventNullifies(e));
    });

    var filter = state.booth.filter || 'all';
    var counts = boothKindCounts(events);
    var visible = events.filter(function (e) { return boothFilterMatches(filter, e); });
    var filters = boothFiltersHTML(filter, counts, 'data-booth-filter', '', isRedZoneTab ? DAY_BOOTH_FILTERS : BOOTH_FILTERS);

    var lastPlay = (state.detail && state.detail.plays.length) ? state.detail.plays[state.detail.plays.length - 1] : null;
    var lastText = lastPlay ? (lastPlay.text || '') : '';
    var livePending = !!(state.game && state.game.status && state.game.status.state === 'in' && lastPlay &&
      (boothClassify(lastPlay) === 'review' || boothResult(lastText) === 'pending'));

    var nullifiedEvents = events.filter(boothEventNullifies);
    var nullifiedBanner = (!livePending && nullifiedEvents.length)
      ? '<div class="booth-banner removed-banner">' +
        '<span class="badge removed">' + nullifiedEvents.length + ' NULLIFIED</span>' +
        '<span>Score taken off the board – ' +
        nullifiedEvents.map(function (e) {
          if (!e.removesPoints) return esc(e.heading || 'nullified score');
          var team = e.removedTeam === 'away' ? (state.game && state.game.away ? state.game.away.abbreviation : 'AWAY')
            : (state.game && state.game.home ? state.game.home.abbreviation : 'HOME');
          return esc(team + ' ' + e.pointsRemoved + 'pts');
        }).join(', ') +
        ' – switch to the Nullified filter.</span>' +
        '</div>'
      : '';

    var underReviewBanner = livePending
      ? '<div class="booth-banner">' +
        '<span class="badge review">UNDER REVIEW</span>' +
        '<span>' + esc(lastText) + '</span>' +
        '</div>'
      : '';

    var rzBanner = '';
    if (isRedZoneTab && events.length) {
      var removedPts = events.reduce(function (sum, e) {
        return sum + (e.removesPoints ? Number(e.pointsRemoved) || 0 : 0);
      }, 0);
      rzBanner = '<div class="booth-banner removed-banner">' +
        '<span class="badge removed">' + events.length + ' NULLIFIED IN RZ</span>' +
        '<span>' + events.length + ' red zone scoring play(s) taken off the board' +
        (removedPts ? ' – ' + removedPts + ' pts removed' : '') + '.</span>' +
        '</div>';
    }

    var banner = underReviewBanner + nullifiedBanner + rzBanner;

    var body;
    if (!visible.length) {
      body = '<div class="booth-empty">' +
        (isRedZoneTab
          ? 'No nullified red zone scores yet — no touchdown, field goal, safety, PAT or 2-pt conversion has been wiped out from the opponent’s 20 or inside.'
          : 'No flags, challenges, or replay reviews in the play-by-play yet.') +
        '</div>';
    } else {
      body = '<div class="booth-feed">' +
        visible.map(function (e) { return boothMsgHTML(e, false); }).join('') +
        '</div>';
    }

    return '<div class="booth-panel">' +
      banner +
      '<div class="booth-filters">' + filters + '</div>' +
      body +
      '</div>';
  }

  // Live header score/status extraction
  function liveHeaderEvents(data) {
    var out = [];
    (data && data.sports || []).forEach(function (sport) {
      (sport && sport.leagues || []).forEach(function (league) {
        (league && league.events || []).forEach(function (event) { out.push(event); });
      });
    });
    return out;
  }

  var liveHeaderInFlight = false;
  async function refreshLiveScores() {
    var hasLive = state.games.some(function (g) { return g.status && g.status.state === 'in'; });
    if (!hasLive || liveHeaderInFlight) return;
    liveHeaderInFlight = true;
    try {
      var url = LIVE_HEADER_URL + '&_=' + Date.now();
      var r = await espnFetch(url, 4000, { lane: LANE_AUX });
      var evs = liveHeaderEvents(r.data);
      var byId = {};
      evs.forEach(function (e) { if (e && e.id != null) byId[String(e.id)] = e; });
      var changed = false;
      var liveBoothDirty = {};    // gameId -> true when its live last play changed to a booth event
      var scoreDropDirty = {};    // gameId -> true when the header total dropped (points left the board)
      state.games.forEach(function (g) {
        var source = byId[String(g.id)];
        if (!source) return;
        var gid = String(g.id);
        var comps = source.competitors || [];
        var headerAway = null, headerHome = null;
        comps.forEach(function (c) {
          var side = c.homeAway === 'home' ? g.home : (c.homeAway === 'away' ? g.away : null);
          if (side && c.score != null) {
            if (c.homeAway === 'home') headerHome = Number(c.score);
            else headerAway = Number(c.score);
          }
          if (side && c.score != null && String(side.score) !== String(c.score)) {
            side.score = Number(c.score);
            changed = true;
          }
          if (side && c.winner != null) side.winner = !!c.winner;
        });
        // Header totals can only go up while a game is live (a score). A
        // DECREASE — relative to the last header observation, never a first
        // sample — is the fastest proof that points came off the board. It is
        // used to pull that game's play-by-play forward, not to invent an alert
        // (announceNewBoothEvents still requires the play text/rollback).
        var prevHeader = state.booth.lastHeaderScores[gid];
        if (prevHeader) {
          if (boothScoreDropped(prevHeader.away, prevHeader.home, headerAway, headerHome)) {
            scoreDropDirty[gid] = true;
          }
        }
        if (headerAway != null || headerHome != null) {
          state.booth.lastHeaderScores[gid] = { away: headerAway, home: headerHome };
        }
        if (source.fullStatus && source.fullStatus.type) {
          var nextSt = {
            state: source.fullStatus.type.state || 'pre',
            name: source.fullStatus.type.name || '',
            detail: source.fullStatus.type.detail || '',
            shortDetail: source.fullStatus.type.shortDetail || '',
            description: source.fullStatus.type.description || '',
            completed: !!source.fullStatus.type.completed,
            clock: source.fullStatus.displayClock != null ? source.fullStatus.displayClock : '',
            period: source.fullStatus.period != null ? source.fullStatus.period : null
          };
          if (JSON.stringify(g.status) !== JSON.stringify(nextSt)) {
            g.status = nextSt;
            changed = true;
          }
        }
        if (source.situation) {
          g.situation = source.situation;
          if (source.situation.lastPlay) {
            var lastPlay = source.situation.lastPlay;
            var prev = state.booth.lastLivePlays[gid];
            var prevId = prev && prev.id != null ? String(prev.id) : '';
            var prevText = prev ? (prev.text || '') : '';
            var prevAway = prev && prev.awayScore != null ? prev.awayScore : null;
            var prevHome = prev && prev.homeScore != null ? prev.homeScore : null;
            var newId = lastPlay.id != null ? String(lastPlay.id) : '';
            var newText = lastPlay.text || '';
            var newAway = lastPlay.awayScore != null ? lastPlay.awayScore : null;
            var newHome = lastPlay.homeScore != null ? lastPlay.homeScore : null;
            var playChanged = newId !== prevId || newText !== prevText || newAway !== prevAway || newHome !== prevHome;
            // Always retain the latest live play (a verdict is often published as
            // an in-place edit with the same id/text but a corrected score).
            state.booth.lastLivePlays[gid] = lastPlay;
            // Only re-merge the booth when there is a genuinely new flag /
            // review / challenge / replay / nullified verdict. A routine play
            // must not re-render the feed.
            if (playChanged) {
              var np = normalizePlay(lastPlay);
              if (boothEvent(np)) liveBoothDirty[gid] = true;
            }
          }
        }
      });
      // Lowest-latency path: merge the changed live play into that game's booth
      // events and announce any nullified score before the paced PBP pass runs.
      Object.keys(liveBoothDirty).forEach(refreshLiveBoothForGame);
      // A header score drop means points left the board; pull that game's
      // play-by-play forward for the fastest authoritative confirmation.
      Object.keys(scoreDropDirty).forEach(function (gid) {
        refreshLiveBoothForScoreDrop(gid);
      });
      if (changed) {
        if (state.view === 'scoreboard') renderScoreboard();
        else if (state.view === 'game') render();
      }
    } catch (e) {
    } finally {
      liveHeaderInFlight = false;
    }
  }

  // Drive the day booth polling. Runs on the scoreboard view. The TICK is a
  // constant 1 s; what actually gets re-fetched is decided by boothRefreshPlan
  // (per-game floor, finals rest, per-pass cap), and an empty plan costs
  // nothing. Passes never overlap (passInFlight), and the whole loop pauses
  // for a hidden tab.
  function dayBoothPoll() {
    if (state.view !== 'scoreboard' || !state.games.length) return;
    if (state.booth.paused || state.booth.passInFlight) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    var before = (state.booth.feed || []).length;
    buildDayBooth('poll').then(function () {
      if (state.view !== 'scoreboard') return;
      // Re-render only when the pass changed something (or a live day is on:
      // the "live game" labels ride the same pass).
      var changed = (state.booth.feed || []).length !== before
        || (state.booth.lastPass && state.booth.lastPass.fetched > 0);
      if (changed) {
        renderDayBooth();
        renderDiag();
      }
    }).catch(function () { /* keep the last feed */ });
  }
  var boothPollTimer = null;
  function startDayBoothPolling() {
    if (boothPollTimer) clearInterval(boothPollTimer);
    // Tick = the per-game PBP floor. Cheap when nothing is due; the plan caps
    // each pass, so this can never fan out wider than the pass policy allows.
    boothPollTimer = setInterval(dayBoothPoll, LIVE_REVIEWS_INTERVAL_MS);
  }
  function stopDayBoothPolling() {
    if (boothPollTimer) { clearInterval(boothPollTimer); boothPollTimer = null; }
    boothRun++; // any in-flight pass sees the stale token and stops fetching
  }

  /* ---------------- Game view rendering ---------------- */
  function gameHeaderHtml() {
    var g = state.game;
    var d = state.detail;
    if (!g && !d) return '<div class="spinner"></div>';

    var teams;
    if (d && d.teams.length === 2) teams = d.teams;      // [away, home]
    else if (g) teams = [g.away, g.home];
    else return '';
    var away = teams[0], home = teams[1];

    var score = d ? lastPlayScore(d) : { away: null, home: null };
    // NCAA detail routes can be unavailable even though the general game
    // response has an authoritative final/live score. Do not replace a known
    // scoreboard value with null merely because no play has been returned.
    var aS = score.away !== null && score.away !== undefined ? score.away : (g ? g.away.score : null);
    var hS = score.home !== null && score.home !== undefined ? score.home : (g ? g.home.score : null);
    var st;
    if (g) st = statusVM(g);
    else if (d && d.plays.length) {
      // Deep link, scoreboard event not resolved yet: infer from the last play.
      var lp = d.plays[d.plays.length - 1];
      st = { kind: 'live', label: periodLabel(lp.period) + ' ' + lp.clock, fromPlay: true };
    } else if (d && d.headerDate) {
      // Deep link to a scheduled game (no plays yet): kickoff time vs final
      // inferred from the header date.
      st = Date.parse(d.headerDate) > Date.now()
        ? { kind: 'pre', label: '' }
        : { kind: 'final', label: 'Final' };
    } else st = { kind: 'final', label: 'Final' };
    var live = st.kind === 'live' || st.kind === 'halftime';
    var done = st.kind === 'final';

    var statusLine;
    if (st.kind === 'live') {
      var parts = st.label.split(' ');
      statusLine = '<span class="dot"></span><span>' + esc(parts[0] || 'Live') + '</span> <span class="clock">' + esc(parts.slice(1).join(' ')) + '</span>';
    } else if (st.kind === 'halftime') {
      statusLine = '<span class="dot"></span><span>Halftime</span>';
    } else if (st.kind === 'final') {
      statusLine = '<span>' + esc(st.label) + '</span>';
    } else {
      var kickIso = g ? g.date : (d ? d.headerDate : null);
      statusLine = '<span class="clock">' + esc(kickIso ? fmtKickoff(kickIso, state.date) : '') + '</span>';
    }

    var gh = '<button class="backbtn" id="backBtn">← All scores</button>' +
      '<div class="game-head" style="--ca:' + esc(away.color || '#333') + ';--ch:' + esc(home.color || '#444') + '">';
    function side(t, cls) {
      return '<div class="gh-team ' + cls + '">' + logoHtml(t.logo, t.abbreviation, 'gh-logo') +
        '<span class="gh-teamtext">' +
          (t.rank ? '<span class="gh-rank">No. ' + t.rank + '</span>' : '<span class="gh-rank">&nbsp;</span>') +
          '<span class="gh-abbr">' + esc(t.abbreviation) + '</span>' +
          '<span class="gh-name">' + esc(t.displayName) + '</span>' +
          (t.records && t.records.total ? '<span class="gh-record">' + esc(t.records.total) + '</span>' : '') +
        '</span></div>';
    }
    gh += side(away, 'away');

    var lines = '';
    if (g && (g.away.linescores.length || g.home.linescores.length)) {
      lines = '<div class="gh-lines"><span></span>';
      var cols = lineColumns(g);
      cols.forEach(function (i) { lines += '<span class="hl-h">' + esc(periodLabel(i)) + '</span>'; });
      lines += '<span class="hl-h">T</span>';
      var aTotal = 0, hTotal = 0;
      lines += '<span>A</span>';
      cols.forEach(function (i) {
        var ls = g.away.linescores.find(function (x) { return x.period === i; });
        aTotal += ls ? (Number(ls.value) || 0) : 0;
        lines += '<span>' + (ls ? esc(String(ls.value)) : '0') + '</span>';
      });
      lines += '<span class="hl-h">' + (aS !== null && aS !== undefined ? esc(String(aS)) : aTotal) + '</span></div>';
      lines += '<span>H</span>';
      cols.forEach(function (i) {
        var ls2 = g.home.linescores.find(function (x) { return x.period === i; });
        hTotal += ls2 ? (Number(ls2.value) || 0) : 0;
        lines += '<span>' + (ls2 ? esc(String(ls2.value)) : '0') + '</span>';
      });
      lines += '<span class="hl-h">' + (hS !== null && hS !== undefined ? esc(String(hS)) : hTotal) + '</span></div>';
    } else if (g) {
      // A scoreboard can provide a total without per-period detail. Leave the
      // split empty rather than displaying fabricated zeroes.
      lines = '<div class="gh-lines" aria-label="Per-period scores unavailable"></div>';
    } else {
      // Deep-link detail can render before its scoreboard event is resolved.
      lines = '<div class="gh-lines" aria-label="Per-period scores unavailable"></div>';
    }

    var meta = [];
    if (g) {
      if (g.broadcast) meta.push('<span>' + esc(g.broadcast) + '</span>');
      if (g.venueName) meta.push('<span>' + esc(g.venueName) + (g.venueCity ? ' • ' + esc(g.venueCity) : '') + '</span>');
      if (g.attendance) meta.push('<span>Att. ' + Number(g.attendance).toLocaleString() + '</span>');
      g.conferences.forEach(function (c) { meta.push('<span class="conf">' + esc(c.short) + '</span>'); });
    }

    gh += '<div class="gh-center">' +
      '<div class="gh-scores">' +
        '<span class="' + (done && g && g.away.winner ? 'winner' : '') + '">' + (aS === null ? '–' : aS) + '</span>' +
        '<span class="sep">–</span>' +
        '<span class="' + (done && g && g.home.winner ? 'winner' : '') + '">' + (hS === null ? '–' : hS) + '</span>' +
      '</div>' +
      '<div class="gh-statusline">' + statusLine + '</div>' +
      lines +
      '<div class="gh-meta">' + meta.join('') + '</div>' +
      '</div>';
    gh += side(home, 'home');
    gh += '</div>';

    var recap = '';
    if (d && d.article && d.article.text) {
      recap = '<div class="recap">' +
        (d.article.headline ? '<div class="rc-h">' + esc(d.article.headline) + '</div>' : '') +
        '<div class="rc-t">' + esc(d.article.text) + '</div></div>';
    }
    return gh + recap;
  }

  function trackerHtml() {
    var d = state.detail, g = state.game;
    if (!d || !g || g.status.state !== 'in') return '';
    var drive = d.drives.length ? d.drives[d.drives.length - 1] : null;
    if (!drive) return '';
    var lastP = d.plays.length ? d.plays[d.plays.length - 1] : null;
    var dd = (lastP && lastP.downDistance) ? lastP.downDistance : (drive.start && drive.start.text ? drive.start.text : '');
    var clock = d.clock || (lastP && lastP.clock) || '';
    var team = d.teams.find(function (t) { return t.id === drive.teamId; }) || null;
    var subParts = [drive.description, (drive.start && drive.start.period) ? periodLabel(drive.start.period.number) : null].filter(Boolean);
    return '<div class="tracker">' +
      logoHtml(team ? team.logo : (drive.teamLogo || null), drive.teamAbbr || '?', 'tk-logo') +
      '<div>' + esc((team ? team.displayName : drive.teamAbbr) || '…') +
        '<span class="tk-sub">' + esc(subParts.join(' • ')) + '</span></div>' +
      '<span class="tk-dd">' + esc(dd) + '</span>' +
      '<span class="tk-clock">' + esc(clock) + '</span>' +
      '</div>';
  }

  function pbpHtml() {
    var d = state.detail;
    if (!d) return '<div class="spinner"></div>';
    if (!d.plays.length) return '<div class="empty"><strong>No play-by-play yet</strong>Plays appear here as the game is covered.</div>';

    var id = state.game ? String(state.game.id) : '';
    var gameBoothEvents = state.booth.eventsByGame[id] || [];
    var boothById = {};
    gameBoothEvents.forEach(function (e) {
      if (e && e.id != null) boothById[String(e.id)] = e;
    });

    var nullifiedInGame = gameBoothEvents.filter(boothEventNullifies);
    var topBanner = '';
    if (nullifiedInGame.length) {
      topBanner = '<div class="booth-banner removed-banner" style="margin-bottom: 10px;">' +
        '<span class="badge removed">' + nullifiedInGame.length + ' NULLIFIED</span>' +
        '<span>' + nullifiedInGame.length + ' scoring play(s) taken off the board in this game – see the highlighted rows or the Flags &amp; Reviews Nullified filter.</span>' +
        '</div>';
    }

    function teamAbbr(tid) {
      var t = d.teams.find(function (x) { return x.id === tid; });
      return t ? t.abbreviation : '';
    }
    function filtered(p) {
      if (state.pbpFilter === 'scores') return p.scoringPlay;
      if (state.pbpFilter === 'turnovers') return p.isTurnover;
      return true;
    }

    var tools = '<div class="pbp-tools">' +
      ['all', 'scores', 'turnovers'].map(function (f) {
        return '<button class="chip' + (state.pbpFilter === f ? ' on' : '') + '" data-pbpf="' + f + '">' +
          { all: 'All', scores: 'Scores', turnovers: 'Turnovers' }[f] + '</button>';
      }).join('') +
      '<label class="pbp-follow"><input type="checkbox" id="followChk"' + (state.follow ? ' checked' : '') + '> follow live</label>' +
      '</div>';

    var byPeriod = new Map();
    d.plays.forEach(function (p) {
      if (!filtered(p)) return;
      if (!byPeriod.has(p.period)) byPeriod.set(p.period, []);
      byPeriod.get(p.period).push(p);
    });
    var periods = Array.from(byPeriod.keys()).sort(function (a, b) { return b - a; });

    var list = '<div class="pb-wrap" id="pbWrap">';
    periods.forEach(function (per) {
      list += '<div class="pb-q">' + esc(periodLabel(per)) + (per > 4 ? ' (overtime)' : ' quarter') + '</div>';
      var rows = byPeriod.get(per).slice().reverse();
      rows.forEach(function (p) {
        var bEvent = boothById[String(p.id)];
        var isNullified = boothEventNullifies(bEvent);
        var cls = 'pb-row';
        if (isNullified) cls += ' pts-removed';
        var tags = '';
        if (isNullified) {
          tags = '<span class="pb-tag removed">' + (bEvent && bEvent.removesPoints ? '−' + bEvent.pointsRemoved + ' PTS REMOVED' : 'NULLIFIED') + '</span>';
        } else if (p.scoringPlay) {
          cls += ' score';
          tags = '<span class="pb-tag ' + (String(p.scoringType || '').indexOf('TD') >= 0 ? 'td' : 'fg') + '">' + esc(p.scoringType || 'SCORE') + '</span>';
        } else if (p.isPenalty) {
          cls += ' pen';
          tags = '<span class="pb-tag pen">PEN</span>';
        } else if (p.isTurnover) {
          cls += ' tov';
          tags = '<span class="pb-tag tov">TO</span>';
        } else if (/Kickoff|Timeout|End Period|Punt Return|^Punt/.test(p.type)) cls += ' mute';
        var fresh = freshIds[p.id] ? ' fresh' : '';
        var score = (p.awayScore !== null && p.awayScore !== undefined && p.homeScore !== null && p.homeScore !== undefined)
          ? p.awayScore + '–' + p.homeScore : '';
        var badgeTeam = p.offTeamId || p.defTeamId || p.possessionTeamId || '';
        list += '<div class="' + cls + fresh + '" data-pid="' + esc(p.id) + '">' +
          '<span class="pb-clock">' + esc(p.clock) + '</span>' +
          '<span class="pb-team">' + esc(teamAbbr(badgeTeam)) + '</span>' +
          '<span class="pb-text">' + esc(p.text) + tags + '</span>' +
          '<span class="pb-score">' + esc(score) + '</span>' +
          '</div>';
      });
    });
    list += '</div>';
    return topBanner + tools + list;
  }

  function teamStatsHtml() {
    var d = state.detail;
    if (!d) return '<div class="spinner"></div>';
    var away = d.teams[0], home = d.teams[1];
    if (!away) return '<div class="empty"><strong>Team stats not available yet.</strong></div>';
    var rows = teamStatRows(away, home);
    if (!rows.length) return '<div class="empty"><strong>Team stats not available yet.</strong></div>';
    var html = '<div class="teamstats"><table class="ts-table"><thead><tr>' +
      '<th class="ts-label" style="text-align:left">Statistic</th>' +
      '<th>' + (away.logo ? '<img class="th-logo" src="' + esc(away.logo) + '" alt="">' : '') + esc(away.abbreviation) + '</th>' +
      '<th>' + (home.logo ? '<img class="th-logo" src="' + esc(home.logo) + '" alt="">' : '') + esc(home.abbreviation) + '</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var leadA = false, leadH = false;
      var aN = parseFloat(r.away), hN = parseFloat(r.home);
      if (!isNaN(aN) && !isNaN(hN) && r.away !== '—' && r.home !== '—') {
        if (aN > hN) leadA = true; else if (hN > aN) leadH = true;
      }
      html += '<tr><td class="ts-label">' + esc(r.label) + '</td>' +
        '<td class="' + (leadA ? 'lead' : '') + '">' + esc(r.away) + '</td>' +
        '<td class="' + (leadH ? 'lead' : '') + '">' + esc(r.home) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function playerStatsHtml() {
    var d = state.detail;
    if (!d || !d.players.length) return '<div class="empty"><strong>Player stats not available yet.</strong></div>';
    var ti = Math.min(state.playerTeam, d.teams.length - 1);
    var team = d.teams[ti];
    var toggle = '<div class="teamtoggle">' + d.teams.map(function (t, i) {
      return '<button class="chip' + (i === ti ? ' on' : '') + '" data-pte="' + i + '">' + esc(t.abbreviation) + '</button>';
    }).join('') + '</div>';
    var block = d.players.find(function (p) { return p.teamId === team.id; });
    if (!block || !block.categories.length) return toggle + '<div class="empty"><strong>Player stats not available yet.</strong></div>';
    var html = toggle;
    block.categories.forEach(function (cat) {
      html += '<div class="player-cat"><h3>' + esc(cat.title) + '</h3><table class="pt-table"><thead><tr>' +
        '<th></th>' + cat.labels.map(function (l) {
          var idx = cat.labels.indexOf(l);
          return '<th title="' + esc((cat.descriptions[idx]) || l) + '">' + esc(l) + '</th>';
        }).join('') +
        '</tr></thead><tbody>';
      cat.athletes.forEach(function (a) {
        html += '<tr><td class="pt-name">' + (a.jersey ? '<span class="jersey">#' + esc(a.jersey) + '</span>' : '') + esc(a.name) + '</td>' +
          a.stats.map(function (s) { return '<td>' + esc(s) + '</td>'; }).join('') + '</tr>';
      });
      if (cat.totals) {
        html += '<tr class="totals"><td class="pt-name">Totals</td>' +
          cat.totals.map(function (s) { return '<td>' + esc(s) + '</td>'; }).join('') + '</tr>';
      }
      html += '</tbody></table></div>';
    });
    return html;
  }

  function gameViewHtml() {
    var sourceBadge = state.detailSource === 'espn-core'
      ? '<span class="updated">ESPN Core backfill</span>'
      : (state.source === 'ncaa' ? '<span class="updated">NCAA fallback</span>'
        : (state.viaProxy ? '<span class="updated">via ' + esc(state.proxy === 'server' ? 'server relay' : (state.proxy || 'CORS proxy')) + '</span>' : ''));
    var tabs = '<nav class="tabs">' +
      [['pbp', 'Play-by-Play'], ['booth', 'Flags &amp; Reviews'], ['redzone', 'Red Zone'], ['team', 'Team Stats'], ['player', 'Player Stats']].map(function (t) {
        return '<button class="tab' + (state.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') +
      sourceBadge +
      (state.lastUpdated ? '<span class="updated">updated ' + state.lastUpdated.toLocaleTimeString() + '</span>' : '') +
      '</nav>';
    var panel;
    if (state.tab === 'pbp') panel = trackerHtml() + pbpHtml();
    else if (state.tab === 'booth') panel = boothGameHtml();
    else if (state.tab === 'redzone') panel = boothGameHtml();
    else if (state.tab === 'team') panel = teamStatsHtml();
    else panel = playerStatsHtml();
    var err = state.error && !state.detail ? '<div class="banner err">' + esc(state.error) + '</div>' : '';
    return gameHeaderHtml() + err + tabs + panel;
  }

  /* ---------------- Root render + events ---------------- */
  function render(scrollTop) {
    renderSubbar();
    var live = state.games.filter(function (g) { return g.status.state === 'in'; }).length;
    liveBadge.hidden = live === 0;
    liveCountEl.textContent = String(live);
    // Preserve the PBP scroll position across live re-renders when the
    // user is not following the live feed.
    var oldWrap = document.getElementById('pbWrap');
    var oldPbScroll = oldWrap ? oldWrap.scrollTop : 0;
    if (state.view === 'game') main.innerHTML = gameViewHtml();
    else renderScoreboard();
    freshIds = {}; // consumed by the PBP render above
    if (state.view === 'game') {
      var newWrap = document.getElementById('pbWrap');
      if (newWrap) newWrap.scrollTop = state.follow ? 0 : oldPbScroll;
    }
    renderDayBooth();
    renderDiag();
    var back = document.getElementById('backBtn');
    if (back) back.addEventListener('click', function () { goScoreboard(state.date); });
    var fc = document.getElementById('followChk');
    if (fc) fc.addEventListener('change', function () { state.follow = fc.checked; });
    if (scrollTop) window.scrollTo(0, 0);
  }

  function renderDiag() {
    var wrap = document.getElementById('diagWrap');
    var pre = document.getElementById('diag');
    if (!wrap || !pre) return;
    var info = {
      view: state.view,
      date: state.date,
      conferences: Object.keys(state.confs).filter(function (id) { return state.confs[id]; }),
      games: state.games.length,
      live: state.games.filter(function (g) { return g.status.state === 'in'; }).length,
      staticDeployment: isStaticDeployment(),
      nearby: state.nearby ? {
        loading: state.nearby.loading,
        next: state.nearby.next ? state.nearby.next.date + ' (' + state.nearby.next.games.length + ')' : null,
        prev: state.nearby.prev ? state.nearby.prev.date + ' (' + state.nearby.prev.games.length + ')' : null,
        error: state.nearby.error || null
      } : null,
      lastUpdated: state.lastUpdated ? state.lastUpdated.toLocaleTimeString() : null,
      source: state.source,
      provider: state.provider,
      viaProxy: state.viaProxy,
      proxy: state.proxy,
      error: state.error,
      booth: {
        events: state.booth.feed.length,
        games: state.booth.count,
        filter: state.booth.filter,
        paused: state.booth.paused,
        perGame: Object.keys(state.booth.eventsByGame).length,
        pass: state.booth.lastPass,
        passInFlight: !!state.booth.passInFlight,
        pbpIntervalMs: state.booth.pbpIntervalMs,
        lastError: state.booth.lastError,
        gate: providerGate.stats()
      }
    };
    if (state.detail) {
      info.gameId = state.gameId;
      info.detailSource = state.detailSource || (state.source === 'ncaa' ? 'ncaa' : 'espn-summary');
      info.summaryTopLevelKeys = state.detail.rawKeys;
      info.plays = state.detail.plays.length;
      info.drives = state.detail.drives.length;
      info.boxscoreTeams = state.detail.teams.map(function (t) { return t.abbreviation; });
      info.playerCategories = state.detail.players.map(function (p) {
        return p.teamId + ': ' + p.categories.map(function (c) { return c.name; }).join(', ');
      });
    }
    pre.textContent = JSON.stringify(info, null, 2);
  }

  // Single entry points — only these mutate navigation state.
  // The hashchange listener is what actually loads views, so nothing
  // ever double-loads.
  function goScoreboard(dateStr) {
    stopPolling();
    scoreboardRun++; // invalidate an in-flight load for the prior route
    nearbyRun++;     // invalidate an in-flight adjacent-games search
    gameRun++;       // invalidate an in-flight game/detail request
    state.view = 'scoreboard';
    state.gameId = null;
    state.game = null;
    state.detail = null;
    if (dateStr) state.date = dateStr;
    var nextHash = '/' + state.date;
    var hashChanged = location.hash !== '#' + nextHash;
    location.hash = nextHash;
    if (!hashChanged) route(); // setting the same hash does not fire hashchange
  }

  function goGame(gameId, gameDate) {
    stopPolling();
    stopDayBoothPolling(); // the day booth only runs on the scoreboard view
    scoreboardRun++; // a scoreboard response must not repaint over the game
    state.view = 'game';
    state.gameId = String(gameId);
    if (gameDate) state.date = gameDate;
    var nextHash = '/' + state.date + '/' + gameId;
    var hashChanged = location.hash !== '#' + nextHash;
    location.hash = nextHash;
    if (!hashChanged) route();
  } // route() triggers loadGame with the event from lookupGame()

  // Find a parsed event by id anywhere it is currently held: the loaded day's
  // games, or the nearby (upcoming/recent) discovery rows.
  function lookupGame(id) {
    var g = state.games.find(function (x) { return x.id === id; });
    if (g) return { game: g, date: state.date };
    var n = state.nearbyIndex && state.nearbyIndex[id];
    if (n) return { game: n, date: n.dayDate || state.date };
    return null;
  }

  main.addEventListener('click', function (e) {
    var t = e.target;
    var jump = t.closest ? t.closest('[data-jump]') : null;
    if (jump) {
      goScoreboard(jump.getAttribute('data-jump'));
      return;
    }
    var row = t.closest ? t.closest('.game-row') : null;
    if (row) {
      var found = lookupGame(row.getAttribute('data-id'));
      if (found) goGame(found.game.id, found.date);
      return;
    }
    var tab = t.closest ? t.closest('[data-tab]') : null;
    if (tab) {
      var nextTab = tab.getAttribute('data-tab');
      // Establish a sensible default filter for the booth-related panels only
      // when the visitor actually switches to that tab. The filter chips inside
      // the panel keep their selection on every re-render.
      if (nextTab === 'booth' && state.booth.filter === 'redzone') state.booth.filter = 'all';
      else if (nextTab === 'redzone') state.booth.filter = 'redzone';
      state.tab = nextTab;
      render();
      return;
    }
    var pf = t.closest ? t.closest('[data-pbpf]') : null;
    if (pf) { state.pbpFilter = pf.getAttribute('data-pbpf'); render(); return; }
    var bf = t.closest ? t.closest('[data-booth-filter]') : null;
    if (bf) { state.booth.filter = bf.getAttribute('data-booth-filter'); render(); return; }
    var pte = t.closest ? t.closest('[data-pte]') : null;
    if (pte) { state.playerTeam = Number(pte.getAttribute('data-pte')); render(); return; }
  });
  main.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var row = e.target.closest ? e.target.closest('.game-row') : null;
    if (row) {
      var found = lookupGame(row.getAttribute('data-id'));
      if (found) goGame(found.game.id, found.date);
    }
  });

  subbar.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('[data-conf]') : null;
    if (!chip) return;
    var id = chip.getAttribute('data-conf');
    state.confs[id] = !state.confs[id];
    // Conference changes are navigation changes too. Return to the selected
    // date's scoreboard so a detail request cannot repaint a different view.
    goScoreboard(state.date);
  });

  // Delegated change handler for the booth pause checkbox. It is bound once,
  // not per render, so both the day-booth tools and the game Flags & Reviews /
  // Red Zone tools share a single #boothPause id without a dangling listener.
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.id === 'boothPause') state.booth.paused = !!t.checked;
  });

  if (dayBoothSection) {
    dayBoothSection.addEventListener('click', function (e) {
      var snd = e.target.closest ? e.target.closest('.day-sound-btn') : null;
      if (snd) {
        toggleBoothSound();
        return;
      }
      var flt = e.target.closest ? (e.target.closest('.day-filter') || e.target.closest('[data-booth-filter]')) : null;
      if (flt) {
        var f = flt.getAttribute('data-booth-filter') || flt.getAttribute('data-day-filter');
        if (f) {
          state.booth.filter = f;
          renderDayBooth();
        }
        return;
      }
      var msg = e.target.closest ? e.target.closest('.day-msg') : null;
      if (msg) {
        var gid = msg.getAttribute('data-id');
        if (gid) {
          var found = lookupGame(gid);
          var tab = state.booth.filter === 'redzone' ? 'redzone' : 'booth';
          state.tab = tab;
          goGame(gid, found ? found.date : state.date);
        }
      }
    });
  }

  document.getElementById('prevDay').addEventListener('click', function () { goScoreboard(shiftDate(state.date, -1)); });
  document.getElementById('nextDay').addEventListener('click', function () { goScoreboard(shiftDate(state.date, 1)); });
  document.getElementById('todayBtn').addEventListener('click', function () { goScoreboard(localDateStr()); });
  dateInput.addEventListener('change', function () {
    if (!dateInput.value) return;
    goScoreboard(dateInput.value.replace(/-/g, ''));
  });

  /* ---------------- Hash router ---------------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    var date = parts[0], gid = parts[1];
    if (/^\d{8}$/.test(date)) {
      state.date = date;
      dateInput.value = date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8);
    }
    if (gid && /^\d+$/.test(gid)) {
      state.view = 'game';
      var found = lookupGame(gid);
      loadGame(gid, found ? found.game : null);
    } else {
      state.view = 'scoreboard';
      stopPolling();
      // Reload (don't just re-render) if the day has no games and no
      // nearby-games search has run for it — e.g. coming back from a game
      // that was opened via deep link on another day.
      if (state.loadedDate !== state.date || (!state.games.length && !state.nearby)) {
        loadScoreboard();
      } else {
        render(true);
        if (state.games.length) {
          startScoreboardPollers();
          buildDayBooth('poll').then(function () { if (state.view === 'scoreboard') renderDayBooth(); }).catch(function () {});
          startDayBoothPolling();
        }
      }
    }
  }

  window.addEventListener('hashchange', route);

  (function boot() {
    document.addEventListener('click', unlockBoothAudio);
    document.addEventListener('keydown', unlockBoothAudio);
    loadBoothSoundPref();

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'hidden') {
        if (state.view === 'scoreboard') {
          refreshLiveScores();
          // A due-only pass — returning focus must not re-seed every game of
          // the day on top of the scoreboard reload below.
          buildDayBooth('poll').then(function () { if (state.view === 'scoreboard') renderDayBooth(); }).catch(function () {});
          loadScoreboard(false);
        } else if (state.view === 'game') {
          refreshLiveScores();
          pollGameSummary();
          pollGameStatus();
        }
      }
    });

    dateInput.value = state.date.slice(0, 4) + '-' + state.date.slice(4, 6) + '-' + state.date.slice(6, 8);
    if (!location.hash) location.hash = '/' + state.date; // fires hashchange → route()
    else route();
  })();

  return {
    state: state,
    CONFERENCES: CONFERENCES,
    CORS_PROXIES: CORS_PROXIES,
    API_BASE: API_BASE,
    ESPN_WEB_BASE: ESPN_WEB_BASE,
    NCAA_GRAPHQL_BASE: NCAA_GRAPHQL_BASE,
    NCAA_COMMUNITY_BASE: NCAA_COMMUNITY_BASE,
    JINA_READER_BASE: JINA_READER_BASE,
    scoreboardUrl: scoreboardUrl,
    scoreboardRangeUrl: scoreboardRangeUrl,
    ncaaScoreboardUrl: ncaaScoreboardUrl,
    ncaaGameUrl: ncaaGameUrl,
    ncaaBoxscoreUrl: ncaaBoxscoreUrl,
    ncaaPlayByPlayUrl: ncaaPlayByPlayUrl,
    ncaaTeamStatsUrl: ncaaTeamStatsUrl,
    summaryUrl: summaryUrl,
    proxiedUrl: proxiedUrl,
    proxyUrls: proxyUrls,
    providerUrls: providerUrls,
    readerUrl: readerUrl,
    readerContentToData: readerContentToData,
    readerPayloadToData: readerPayloadToData,
    isGitHubPagesHost: isGitHubPagesHost,
    isStaticDeployment: isStaticDeployment,
    espnFetch: espnFetch,
    easternDateStr: easternDateStr,
    localDateStr: localDateStr,
    shiftDate: shiftDate,
    etDateFromWallclock: etDateFromWallclock,
    fmtDayLabel: fmtDayLabel,
    eventsOf: eventsOf,
    validEventsOf: validEventsOf,
    eventIsCompleted: eventIsCompleted,
    scoreboardPayloadIsUsable: scoreboardPayloadIsUsable,
    scoreboardEventIsUsable: scoreboardEventIsUsable,
    eventMatchesGroups: eventMatchesGroups,
    filterEventsForGroups: filterEventsForGroups,
    filterEventsForDate: filterEventsForDate,
    filterEventsForRange: filterEventsForRange,
    groupByDay: groupByDay,
    calendarProbeWindows: calendarProbeWindows,
    fallbackProbeWindows: fallbackProbeWindows,
    parseEvent: parseEvent,
    parseNCAAOverview: parseNCAAOverview,
    parseNCAADetail: parseNCAADetail,
    parseCompetitor: parseCompetitor,
    mergeEvents: mergeEvents,
    groupGames: groupGames,
    shouldOpenNextGameDay: shouldOpenNextGameDay,
    periodLabel: periodLabel,
    normalizePlay: normalizePlay,
    extractPlays: extractPlays,
    parseDrives: parseDrives,
    parseSummary: parseSummary,
    lastPlayScore: lastPlayScore,
    teamStatRows: teamStatRows,
    statusVM: statusVM,
    lineColumns: lineColumns,
    fmtKickoff: fmtKickoff,
    weekForDate: weekForDate,
    ESPN_CORE_BASE: ESPN_CORE_BASE,
    espnCorePlaysUrl: espnCorePlaysUrl,
    summaryDrivesOf: summaryDrivesOf,
    extractCorePlays: extractCorePlays,
    normalizeTeamKey: normalizeTeamKey,
    espnSideMatchesNCAATeam: espnSideMatchesNCAATeam,
    ncaaContestsOf: ncaaContestsOf,
    findNCAAContestForGame: findNCAAContestForGame,
    BOOTH_KINDS: BOOTH_KINDS,
    BOOTH_KIND_LABEL: BOOTH_KIND_LABEL,
    BOOTH_RESULT_LABEL: BOOTH_RESULT_LABEL,
    BOOTH_FILTERS: BOOTH_FILTERS,
    DAY_BOOTH_FILTERS: DAY_BOOTH_FILTERS,
    BOOTH_RED_ZONE_DISTANCE: BOOTH_RED_ZONE_DISTANCE,
    boothClassify: boothClassify,
    boothResult: boothResult,
    boothMentionsScore: boothMentionsScore,
    nullifiedScoreText: nullifiedScoreText,
    boothEventNullifies: boothEventNullifies,
    boothScoreEffect: boothScoreEffect,
    boothEventContext: boothEventContext,
    boothEvent: boothEvent,
    boothEvents: boothEvents,
    dayBoothFeed: dayBoothFeed,
    reconcileDayBoothFeed: reconcileDayBoothFeed,
    boothYardsToEndzone: boothYardsToEndzone,
    boothIsRedZonePlay: boothIsRedZonePlay,
    boothIsScoringPlay: boothIsScoringPlay,
    boothNearestScoringPlay: boothNearestScoringPlay,
    boothKindCounts: boothKindCounts,
    boothEventShown: boothEventShown,
    boothScoreTrailHTML: boothScoreTrailHTML,
    lastPlayBooth: lastPlayBooth,
    boothRefreshPlan: boothRefreshPlan,
    createProviderGate: createProviderGate,
    isRateLimitError: isRateLimitError,
    providerGate: providerGate,
    scorePair: scorePair,
    LIVE_HEADER_URL: LIVE_HEADER_URL,
    LIVE_SCORES_INTERVAL_MS: LIVE_SCORES_INTERVAL_MS,
    LIVE_REVIEWS_INTERVAL_MS: LIVE_REVIEWS_INTERVAL_MS,
    SCOREBOARD_INTERVAL_MS: SCOREBOARD_INTERVAL_MS,
    SCOREBOARD_IDLE_INTERVAL_MS: SCOREBOARD_IDLE_INTERVAL_MS,
    BOOTH_PASS_MAX_REFRESH: BOOTH_PASS_MAX_REFRESH,
    BOOTH_SEED_PASS_MAX: BOOTH_SEED_PASS_MAX,
    BOOTH_BUSY_DAY_GAME_MS: BOOTH_BUSY_DAY_GAME_MS,
    PROVIDER_MAX_CONCURRENT: PROVIDER_MAX_CONCURRENT,
    BOOTH_MAX_ACTIVE: BOOTH_MAX_ACTIVE
  };
});
