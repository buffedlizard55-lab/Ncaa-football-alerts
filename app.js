/* ============================================================
 * NCAA Football Scoreboard
 * Data source: ESPN public JSON API (site.api.espn.com) — the same
 * API that powers espn.com. Text only. No videos.
 *
 * Every endpoint/parameter used here was verified against live
 * API responses on 2026-08-25 (see README.md for the evidence).
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NCBS = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';

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
    // Group ids are plain digits from CONFERENCES, joined with raw commas —
    // the exact combined form verified live on 2026-08-25 (groups=8,5 on
    // 2025-11-08 returned the union: 11 events vs 7 SEC-only / 5 B1G-only).
    // Do not encodeURIComponent this — that would produce %2C (unverified).
    if (groupId) u += '&groups=' + groupId;
    return u;
  }

  // Ranged query for the nearby-games search. Verified live 2026-08-25:
  // dates=20260825-20260831&groups=... returned that week's events.
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

  // Fallback route for browsers whose network blocks direct cross-origin
  // calls (CORS). Only used when the direct fetch fails.
  function proxiedUrl(url) {
    return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
  }

  async function espnFetch(url, timeoutMs) {
    var t = timeoutMs || 20000;
    function attempt(u) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, t);
      return fetch(u, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .finally(function () { clearTimeout(timer); });
    }
    try {
      var data = await attempt(url);
      return { data: data, viaProxy: false };
    } catch (err) {
      var p = await attempt(proxiedUrl(url));
      return { data: p, viaProxy: true };
    }
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
  function eventsOf(data) {
    return (data && data.events) || [];
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
      id: ev.id,
      date: ev.date || '',
      week: ev.week && ev.week.number !== undefined ? ev.week.number : null,
      name: ev.name || '',
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
          e.conferences.forEach(function (c) {
            if (!existing.conferences.some(function (x) { return x.id === c.id; })) existing.conferences.push(c);
          });
          e.conferenceIds.forEach(function (id) {
            if (existing.conferenceIds.indexOf(id) === -1) existing.conferenceIds.push(id);
          });
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

  // PBP strategy: prefer the top-level `plays` array when present, otherwise
  // flatten `drives[].plays` (drives contain every play — verified: kickoffs,
  // timeouts and end-of-quarter markers all appear inside drives).
  function extractPlays(summary) {
    var drivesRaw = Array.isArray(summary.drives) ? summary.drives : [];
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
    plays.sort(function (a, b) {
      return (a.period - b.period) || (a.seq - b.seq) || (a.time - b.time);
    });
    return plays;
  }

  function parseDrives(summary) {
    if (!Array.isArray(summary.drives)) return [];
    return summary.drives.map(function (d) {
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
      API_BASE: API_BASE, CONFERENCES: CONFERENCES,
      scoreboardUrl: scoreboardUrl, scoreboardRangeUrl: scoreboardRangeUrl,
      summaryUrl: summaryUrl, proxiedUrl: proxiedUrl,
      espnFetch: espnFetch, easternDateStr: easternDateStr, localDateStr: localDateStr, shiftDate: shiftDate,
      etDateFromWallclock: etDateFromWallclock, fmtDayLabel: fmtDayLabel,
      eventsOf: eventsOf, groupByDay: groupByDay, calendarProbeWindows: calendarProbeWindows,
      parseEvent: parseEvent,
      parseCompetitor: parseCompetitor, mergeEvents: mergeEvents, groupGames: groupGames,
      shouldOpenNextGameDay: shouldOpenNextGameDay, periodLabel: periodLabel, normalizePlay: normalizePlay, extractPlays: extractPlays,
      parseDrives: parseDrives, parseSummary: parseSummary, lastPlayScore: lastPlayScore,
      teamStatRows: teamStatRows, statusVM: statusVM, lineColumns: lineColumns, fmtKickoff: fmtKickoff
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
    weekLabel: '',
    seasonYear: null,
    league: null,       // leagues[0] of the loaded day (calendar for nearby windows)
    nearby: null,       // { loading, next, prev, error } — empty-day discovery
    nearbyFor: null,    // date the nearby search was run for
    nearbyIndex: {},    // gameId -> parsed event (nearby rows are clickable)
    // Set only for a clean first visit. Once a game day is found, normal date
    // navigation remains entirely under the visitor's control.
    defaultToNextGameDay: !location.hash,
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

  // Fetch one day. Prefers a single combined request (groups=1,8,5,4,151 —
  // union verified live 2026-08-25) and falls back to the old per-conference
  // parallel requests if the combined call fails for any reason.
  async function fetchDay(dateStr, groupIds) {
    function unwrap(r) { return { lists: [r.data], viaProxy: r.viaProxy, errors: [] }; }
    if (groupIds.length) {
      try {
        return unwrap(await espnFetch(scoreboardUrl(dateStr, groupIds.join(','))));
      } catch (e) {
        var errors = [String((e && e.message) || e)];
        var lists = [];
        var viaProxy = false;
        var rs = await Promise.all(groupIds.map(function (gid) {
          return espnFetch(scoreboardUrl(dateStr, gid)).then(
            function (r) { return { ok: true, r: r }; },
            function (err) { return { ok: false, err: String((err && err.message) || err) }; }
          );
        }));
        rs.forEach(function (x) {
          if (x.ok) { lists.push(x.r.data); if (x.r.viaProxy) viaProxy = true; }
          else errors.push(x.err);
        });
        return { lists: lists, viaProxy: viaProxy, errors: errors };
      }
    }
    // No conference selected: no request (matches the previous behavior).
    return { lists: [], viaProxy: false, errors: [] };
  }

  async function loadScoreboard(showSpinner) {
    if (showSpinner !== false) {
      state.loading = true;
      state.error = null;
      render();
    }
    try {
      var out = await fetchDay(state.date, enabledGroupIds());

      var events = [];
      out.lists.forEach(function (data) {
        // Events are top-level on the scoreboard payload (verified live);
        // leagues[0] is used only for season/week/calendar info.
        events.push(eventsOf(data));
        var league = (data && data.leagues && data.leagues[0]) || null;
        if (league && league.calendar && league.calendar.length && league.season) {
          state.seasonYear = league.season.year;
          state.weekLabel = weekForDate(league.calendar, state.date);
          state.league = league;
        }
      });

      state.games = mergeEvents(events);
      state.viaProxy = out.viaProxy;
      state.error = out.errors.length ? out.errors.join('; ') : null;
      state.lastUpdated = new Date();
      state.loadedDate = state.date;
    } catch (e) {
      state.error = 'Could not load the scoreboard: ' + ((e && e.message) || e) +
        (state.viaProxy ? ' (direct and proxy requests both failed)' : '');
    }
    state.loading = false;
    // A clean visit is useful even if today contains only final scores: open
    // the next day that has a scheduled game instead. On any later navigation
    // we preserve the selected day's normal scoreboard/nearby-results view.
    var discoverNext = state.defaultToNextGameDay && shouldOpenNextGameDay(state.games);
    if (state.games.length && !discoverNext) {
      state.nearby = null;
      state.nearbyIndex = {};
      state.nearbyFor = null;
    } else if (!state.error && state.nearbyFor !== state.date && enabledGroupIds().length) {
      state.nearbyFor = state.date;
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

  /* ---------------- Nearby-games search (empty days) ----------------
   * When the selected day has no games, look for the next upcoming games
   * and the most recent results so the scoreboard is never a dead end:
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
    var g = enabledGroupIds().join(',');
    state.nearby = { loading: true, next: null, prev: null, error: null };
    render();

    function probeDays(from, to) {
      return espnFetch(scoreboardRangeUrl(from, to, g))
        .then(function (r) { return groupByDay(eventsOf(r.data)); })
        .catch(function () { return null; }); // null = request failed, [] = no games
    }
    function pickFirst(days) { return (days && days.length) ? days[0] : null; }
    function pickLast(days) { return (days && days.length) ? days[days.length - 1] : null; }

    var fwd = await probeDays(shiftDate(probeDate, 1), shiftDate(probeDate, 14));
    var back = await probeDays(shiftDate(probeDate, -14), shiftDate(probeDate, -1));
    var next = pickFirst(fwd);
    var prev = pickLast(back);

    if ((!next || !prev) && state.league) {
      var w = calendarProbeWindows(state.league, probeDate);
      var extra = [];
      if (!next && w.fwd) extra.push(probeDays(w.fwd[0], w.fwd[1]).then(pickFirst).then(function (d) { if (d) next = d; }));
      if (!prev && w.back) extra.push(probeDays(w.back[0], w.back[1]).then(pickLast).then(function (d) { if (d) prev = d; }));
      if (extra.length) await Promise.all(extra);
    }

    // The user may have navigated away or changed the search while probing —
    // drop stale results.
    if (run !== nearbyRun || state.view !== 'scoreboard' || state.loadedDate !== probeDate || state.games.length) return;

    state.nearby = {
      loading: false,
      next: next ? nearbyDay(next) : null,
      prev: prev ? nearbyDay(prev) : null,
      error: (fwd === null || back === null) ? 'One or more nearby-games searches failed (network).' : null
    };
    state.nearbyIndex = {};
    [state.nearby.next, state.nearby.prev].forEach(function (day) {
      if (day) day.games.forEach(function (ev) { state.nearbyIndex[ev.id] = ev; });
    });

    // Only the initial, hash-free visit auto-navigates. If discovery fails or
    // ESPN has no forward event in the probed/calendar window, keep the date
    // the visitor opened and show the normal nearby-results state instead.
    if (state.defaultToNextGameDay) {
      state.defaultToNextGameDay = false;
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
      html += '<span class="chip-count">' + state.games.length + ' game' + (state.games.length === 1 ? '' : 's') +
        (state.viaProxy ? ' • via CORS proxy' : '') +
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
      ? '<span class="' + (done && g.away.winner ? 'winner' : '') + '">' + (aScore === null ? '0' : aScore) + '</span>' +
        '<span class="' + (done && g.home.winner ? 'winner' : '') + '">' + (hScore === null ? '0' : hScore) + '</span>'
      : '<span class="pending">–</span><span class="pending">–</span>';

    var linesHtml = '';
    if (showScore) {
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
    }
    main.innerHTML = html;
  }

  /* ---------------- Game detail view ---------------- */
  async function loadGame(gameId, fromEvent) {
    stopPolling();
    state.view = 'game';
    state.gameId = String(gameId);
    state.game = fromEvent || null;
    state.detail = null;
    state.seenPlayIds = {};
    freshIds = {};
    state.tab = 'pbp';
    state.pbpFilter = 'all';
    state.playerTeam = 0;
    render();
    try {
      var r = await espnFetch(summaryUrl(state.gameId));
      state.detail = parseSummary(r.data);
      state.viaProxy = r.viaProxy;
      state.detail.plays.forEach(function (p) { state.seenPlayIds[p.id] = true; });
      if (!state.game) {
        await resolveGameEvent();
      } else {
        syncScoresFromPlays();
      }
    } catch (e) {
      state.error = 'Could not load game data: ' + ((e && e.message) || e);
    }
    render();
    startGamePolling();
  }

  // Deep-link case: we only have the gameId. Find the scoreboard event so the
  // header has venue, TV, records, rankings, etc.
  async function resolveGameEvent() {
    try {
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
      var league = (r.data && r.data.leagues && r.data.leagues[0]) || {};
      // Events live at the TOP level of the scoreboard payload (verified in
      // every live response: {"leagues":[...],"events":[...]}), not inside
      // leagues[0]. This was previously read from the wrong place, so deep
      // links never resolved the scoreboard event.
      var events = (r.data && r.data.events) || [];
      var ev = events.find(function (e) { return String(e.id) === state.gameId; });
      if (ev) {
        state.game = parseEvent(ev);
        if (league.season) state.seasonYear = league.season.year;
        state.weekLabel = weekForDate(league.calendar || [], et);
        state.date = et;
        state.loadedDate = et;
        state.viaProxy = r.viaProxy || state.viaProxy;
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

  function pollGameSummary() {
    espnFetch(summaryUrl(state.gameId)).then(function (r) {
      var prevIds = state.seenPlayIds;
      var prevCount = Object.keys(prevIds).length;
      var hadDetail = !!state.detail;
      state.detail = parseSummary(r.data);
      state.viaProxy = r.viaProxy || state.viaProxy;
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
    if (!state.game) return;
    var ids = state.game.conferenceIds.filter(function (id) {
      return CONFERENCES.some(function (c) { return c.id === id; });
    });
    var urls = ids.length
      ? ids.map(function (gid) { return espnFetch(scoreboardUrl(state.date, gid)).then(function (r) { return r.data; }).catch(function () { return null; }); })
      : [espnFetch(scoreboardUrl(state.date)).then(function (r) { return r.data; }).catch(function () { return null; })];
    Promise.all(urls).then(function (datas) {
      var events = [];
      datas.forEach(function (d) {
        if (d) events = events.concat(eventsOf(d)); // top-level events (verified)
      });
      var ev = events.find(function (e) { return String(e.id) === state.gameId; });
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

    var score = d ? lastPlayScore(d) : { away: g.away.score, home: g.home.score };
    var aS = score.away, hS = score.home;
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

    var lines = '<div class="gh-lines"><span></span>';
    if (g) {
      var cols = lineColumns(g);
      cols.forEach(function (i) { lines += '<span class="hl-h">' + esc(periodLabel(i)) + '</span>'; });
      lines += '<span class="hl-h">T</span></div>';
      var aTotal = 0, hTotal = 0;
      lines += '<span>A</span>';
      cols.forEach(function (i) {
        var ls = g.away.linescores.find(function (x) { return x.period === i; });
        aTotal += ls ? (Number(ls.value) || 0) : 0;
        lines += '<span>' + (ls ? esc(String(ls.value)) : '0') + '</span>';
      });
      lines += '<span class="hl-h">' + (aS !== null ? aS : aTotal) + '</span></div>';
      lines += '<span>H</span>';
      cols.forEach(function (i) {
        var ls2 = g.home.linescores.find(function (x) { return x.period === i; });
        hTotal += ls2 ? (Number(ls2.value) || 0) : 0;
        lines += '<span>' + (ls2 ? esc(String(ls2.value)) : '0') + '</span>';
      });
      lines += '<span class="hl-h">' + (hS !== null ? hS : hTotal) + '</span></div>';
    } else {
      lines += '<span></span><span></span><span></span><span></span><span></span></div>';
      lines += '<span>A</span><span></span><span></span><span></span><span></span><span></span></div>';
      lines += '<span>H</span><span></span><span></span><span></span><span></span><span></span></div>';
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
    var tabs = '<nav class="tabs">' +
      [['pbp', 'Play-by-Play'], ['team', 'Team Stats'], ['player', 'Player Stats']].map(function (t) {
        return '<button class="tab' + (state.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') +
      (state.viaProxy ? '<span class="updated">via CORS proxy</span>' : '') +
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
      nearby: state.nearby ? {
        loading: state.nearby.loading,
        next: state.nearby.next ? state.nearby.next.date + ' (' + state.nearby.next.games.length + ')' : null,
        prev: state.nearby.prev ? state.nearby.prev.date + ' (' + state.nearby.prev.games.length + ')' : null,
        error: state.nearby.error || null
      } : null,
      lastUpdated: state.lastUpdated ? state.lastUpdated.toLocaleTimeString() : null,
      viaProxy: state.viaProxy,
      error: state.error
    };
    if (state.detail) {
      info.gameId = state.gameId;
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
    state.view = 'scoreboard';
    state.gameId = null;
    state.detail = null;
    if (dateStr) state.date = dateStr;
    location.hash = '/' + state.date;
    if (state.loadedDate === state.date && state.games.length) {
      render(true);
    } // else route() (hashchange) triggers the load
  }

  function goGame(gameId, gameDate) {
    stopPolling();
    state.view = 'game';
    state.gameId = String(gameId);
    if (gameDate) state.date = gameDate;
    location.hash = '/' + state.date + '/' + gameId;
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
    state.nearbyFor = null; // conference set changed — re-run the nearby search
    loadScoreboard();
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
    API_BASE: API_BASE,
    scoreboardUrl: scoreboardUrl,
    scoreboardRangeUrl: scoreboardRangeUrl,
    summaryUrl: summaryUrl,
    proxiedUrl: proxiedUrl,
    espnFetch: espnFetch,
    easternDateStr: easternDateStr,
    localDateStr: localDateStr,
    shiftDate: shiftDate,
    etDateFromWallclock: etDateFromWallclock,
    fmtDayLabel: fmtDayLabel,
    eventsOf: eventsOf,
    groupByDay: groupByDay,
    calendarProbeWindows: calendarProbeWindows,
    parseEvent: parseEvent,
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
    weekForDate: weekForDate
  };
});
