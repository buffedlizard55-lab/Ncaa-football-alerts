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
  var transportBackoffMs = 15000;
  var transportUnavailableUntil = {};
  function transportCall(key, fn) {
    if (typeof window === 'undefined') return fn();
    var now = Date.now();
    if (transportUnavailableUntil[key] && transportUnavailableUntil[key] > now) {
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

  async function espnFetch(url, timeoutMs) {
    var t = timeoutMs || 12000;
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
          return { data: await transportCall('relay:' + host, function () { return attempt(relay); }), viaProxy: true, proxy: 'server', provider: candidate };
        } catch (err) { lastErr = err; }
      }
      try {
        return { data: await transportCall('direct:' + host, function () { return attempt(candidate); }), viaProxy: false, proxy: null, provider: candidate };
      } catch (err2) { lastErr = err2; }
      if (i === 0) {
        try {
          return { data: await transportCall('reader:' + host, function () { return attemptReader(candidate); }), viaProxy: true, proxy: 'jina-reader', provider: candidate };
        } catch (err3) { lastErr = err3; }
      }
    }

    // Direct/provider calls and the Reader transport failed. Walk the older
    // public CORS proxies as a final fallback. They are not data providers and
    // are intentionally last because their availability is inconsistent.
    for (var j = 0; j < CORS_PROXIES.length; j++) {
      try {
        var p = await transportCall('cors:' + CORS_PROXIES[j].id, function () {
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
      time: p.wallclock ? Date.parse(p.wallclock) : 0
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
            time: 0
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
      ncaaContestsOf: ncaaContestsOf, findNCAAContestForGame: findNCAAContestForGame
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
    pollers: []
  };
  CONFERENCES.forEach(function (c) { state.confs[c.id] = true; });
  var freshIds = {};

  var main = document.getElementById('main');
  var subbar = document.getElementById('subbar');
  var liveBadge = document.getElementById('liveBadge');
  var liveCountEl = document.getElementById('liveCount');
  var dateInput = document.getElementById('dateInput');

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
  async function fetchDay(dateStr, groupIds) {
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
        var ncaa = await espnFetch(ncaaScoreboardUrl(dateStr));
        if (scoreboardPayloadIsUsable(ncaa.data)) return ncaa;
        errors.push('NCAA returned no usable contests');
      } catch (ncaaError) {
        errors.push(String((ncaaError && ncaaError.message) || ncaaError));
      }
      return null;
    }

    try {
      var all = await espnFetch(scoreboardUrl(dateStr));
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
    var ncaaFallback = await tryNCAA();
    if (ncaaFallback) {
      return { lists: [ncaaFallback.data], unfiltered: false, viaProxy: ncaaFallback.viaProxy, proxy: ncaaFallback.proxy, provider: ncaaFallback.provider, source: 'ncaa', errors: [] };
    }

    // If both complete feeds are unavailable, try each conference separately.
    // This avoids losing a usable partial slate and also covers providers that
    // only return conference events for filtered requests.
    var responses = await Promise.all(groupIds.map(function (gid) {
      return espnFetch(scoreboardUrl(dateStr, gid)).then(
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
      var out = await fetchDay(requestedDate, wantedGroups);
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
      stopPolling();
      var live = state.games.filter(function (g) { return g.status.state === 'in'; }).length;
      var delay = live > 0 ? 20000 : 60000;
      state.pollers.push(setInterval(function () {
        if (!document.hidden) loadScoreboard(false);
      }, delay));
    }
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
          var result = await espnFetch(ncaaScoreboardUrl(cursor), 8000);
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
        var all = await espnFetch(scoreboardRangeUrl(from, to));
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
        return espnFetch(scoreboardRangeUrl(from, to, gid)).then(
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

    return '<article class="game-row state-' + ((sv.kind === 'live' || sv.kind === 'halftime') ? 'live' : sv.kind) + '" data-id="' + esc(g.id) + '" role="link" tabindex="0" aria-label="' + esc(g.name) + '">' +
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

  async function loadNCAAData(gameId) {
    var overview = await espnFetch(ncaaGameUrl(gameId), 12000);
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
      return espnFetch(request.url, 12000).then(function (r) {
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
  async function fetchCorePlays(eventId) {
    var url = espnCorePlaysUrl(eventId);
    if (!url) return null;
    var rawItems = [];
    var viaProxy = false;
    var proxy = null;
    var provider = null;
    var page = 1;
    var pages = 1;
    while (page <= pages) {
      var r = await espnFetch(url + '&page=' + page);
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
      var dayResult = await espnFetch(ncaaScoreboardUrl(day));
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
        var ncaa = await loadNCAAData(requestedId);
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
          var r = await espnFetch(summaryUrl(requestedId));
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
            var core = await fetchCorePlays(requestedId).catch(function () { return null; });
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
      var r = await espnFetch(scoreboardUrl(et)); // full day; one-shot
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
    espnFetch(ncaaGameUrl(requestedId), 12000).then(function (r) {
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
    espnFetch(summaryUrl(requestedId)).then(function (r) {
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
      ? ids.map(function (gid) { return espnFetch(scoreboardUrl(requestedDate, gid)).then(function (r) { return r.data; }).catch(function () { return null; }); })
      : [espnFetch(scoreboardUrl(requestedDate)).then(function (r) { return r.data; }).catch(function () { return null; })];
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

    function teamAbbr(id) {
      var t = d.teams.find(function (x) { return x.id === id; });
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
        var cls = 'pb-row';
        var tags = '';
        if (p.scoringPlay) {
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
    return tools + list;
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
      [['pbp', 'Play-by-Play'], ['team', 'Team Stats'], ['player', 'Player Stats']].map(function (t) {
        return '<button class="tab' + (state.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') +
      sourceBadge +
      (state.lastUpdated ? '<span class="updated">updated ' + state.lastUpdated.toLocaleTimeString() + '</span>' : '') +
      '</nav>';
    var panel;
    if (state.tab === 'pbp') panel = trackerHtml() + pbpHtml();
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
      error: state.error
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
    if (tab) { state.tab = tab.getAttribute('data-tab'); render(); return; }
    var pf = t.closest ? t.closest('[data-pbpf]') : null;
    if (pf) { state.pbpFilter = pf.getAttribute('data-pbpf'); render(); return; }
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
      if (state.loadedDate !== state.date || (!state.games.length && !state.nearby)) loadScoreboard();
      else render(true);
    }
  }

  window.addEventListener('hashchange', route);

  (function boot() {
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
    findNCAAContestForGame: findNCAAContestForGame
  };
});
