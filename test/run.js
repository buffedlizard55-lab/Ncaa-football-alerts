'use strict';
/*
 * Test runner — zero dependencies, runs fully offline.
 *
 *  - syntax-checks every JS file
 *  - exercises the parser/view-model code against REAL API response
 *    fixtures (see test/fixtures/*.json headers for provenance)
 *  - boots the actual server on a port and checks its routes
 *
 * Live provider contracts were independently probed on 2026-08-27; this
 * offline runner does not pretend to prove a remote browser's network/CORS
 * environment. Reader fallback parsing is covered with representative
 * response envelopes.
 */
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const NCAA_SAMPLE_EPOCH = 1788019200; // observed from NCAA response for 2026-08-29
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ok   ' + name);
    passed++;
  } catch (e) {
    console.error('  FAIL ' + name);
    console.error('       ' + ((e && e.message) || e));
    failed++;
  }
}

async function atest(name, fn) {
  try {
    await fn();
    console.log('  ok   ' + name);
    passed++;
  } catch (e) {
    console.error('  FAIL ' + name);
    console.error('       ' + ((e && e.message) || e));
    failed++;
  }
}

function waitForPort(url, ms) {
  const started = Date.now();
  return fetch(url, { signal: AbortSignal.timeout(1500) })
    .then(() => url)
    .catch(() => {
      if (Date.now() - started > ms) throw new Error('server did not start: ' + url);
      return new Promise((resolve) => setTimeout(resolve, 150)).then(() => waitForPort(url, ms));
    });
}

(async function main() {
  console.log('NCAA Football Scoreboard — tests');
  console.log('--- syntax ---');
  for (const f of ['server.js', 'app.js']) {
    test('node --check ' + f, () => {
      execFileSync('node', ['--check', path.join(ROOT, f)], { stdio: 'pipe' });
    });
  }

  const NB = require(path.join(ROOT, 'app.js'));
  const sb = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scoreboard-event.json'), 'utf8'));
  const sum = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'summary.json'), 'utf8'));
  const ncaaScoreboard = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ncaa-scoreboard.json'), 'utf8'));
  const ncaaGame = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ncaa-game.json'), 'utf8'));
  const ncaaScoreboard20260109 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ncaa-scoreboard-20260109.json'), 'utf8'));
  const espnCorePlays = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'espn-core-plays.json'), 'utf8'));
  const summary401769074 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'summary-401769074.json'), 'utf8'));

  console.log('--- URL builders ---');
  test('scoreboardUrl single date', () => {
    assert.strictEqual(NB.scoreboardUrl('20260829'), 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260829&limit=300');
  });
  test('scoreboardUrl with groups filter', () => {
    assert.strictEqual(NB.scoreboardUrl('20260829', '8'), 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260829&limit=300&groups=8');
  });
  test('scoreboardUrl combined groups keep raw commas (verified form)', () => {
    // The builder remains available for diagnostics, but the live loader
    // deliberately never sends this combined form because current responses
    // contain placeholder events for comma-separated groups.
    const u = NB.scoreboardUrl('20251108', '1,8,5,4,151');
    assert.ok(u.endsWith('&groups=1,8,5,4,151'));
    assert.ok(u.indexOf('%2C') === -1);
  });
  test('scoreboardRangeUrl builds a ranged query', () => {
    assert.strictEqual(
      NB.scoreboardRangeUrl('20260826', '20260908', '1,8'),
      'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260826-20260908&limit=500&groups=1,8'
    );
  });
  test('free NCAA scoreboard URL uses documented contestDate variables', () => {
    const u = NB.ncaaScoreboardUrl('20260829');
    assert.ok(u.startsWith('https://sdataprod.ncaa.com/?extensions='));
    assert.ok(decodeURIComponent(u).includes('"sportCode":"MFB"'));
    assert.ok(decodeURIComponent(u).includes('"division":11'));
    assert.ok(decodeURIComponent(u).includes('"contestDate":"2026-08-29"'));
  });
  test('scoreboardRangeUrl without groups', () => {
    const u = NB.scoreboardRangeUrl('20260110', '20260131');
    assert.ok(u.endsWith('dates=20260110-20260131&limit=500'));
    assert.ok(u.indexOf('groups') === -1);
  });
  test('summaryUrl uses event= (not gameId=)', () => {
    assert.strictEqual(NB.summaryUrl('401752763'), 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401752763');
  });
  test('provider fallback uses the independently verified ESPN web host', () => {
    assert.deepStrictEqual(NB.providerUrls(NB.scoreboardUrl('20260829')), [
      'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260829&limit=300',
      'https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260829&limit=300'
    ]);
    assert.deepStrictEqual(NB.providerUrls(NB.ncaaScoreboardUrl('20260829')), [NB.ncaaScoreboardUrl('20260829')]);
  });
  test('Reader transport URL keeps the provider target and adds a short cache bucket', () => {
    const reader = NB.readerUrl('https://site.api.espn.com/apis/x?a=1&b=2');
    assert.ok(reader.startsWith('https://r.jina.ai/http://site.api.espn.com/apis/x?'));
    assert.ok(reader.indexOf('a=1&b=2') !== -1);
    assert.ok(/&_ncbs=\d+$/.test(reader));
  });
  test('Reader text and JSON-envelope responses normalize to provider data', () => {
    assert.deepStrictEqual(NB.readerPayloadToData('Title: ESPN\n\nMarkdown Content:\n{"events":[]}'), { events: [] });
    assert.deepStrictEqual(NB.readerPayloadToData(JSON.stringify({ code: 200, data: { content: '{"data":{"contests":[]}}' } })), { data: { contests: [] } });
    assert.deepStrictEqual(NB.readerPayloadToData(JSON.stringify({ code: 200, data: '{"events":[]}' })), { events: [] });
  });
  test('GitHub Pages is recognized as static and skips the server-only relay', () => {
    assert.strictEqual(NB.isGitHubPagesHost('buffedlizard55-lab.github.io'), true);
    assert.strictEqual(NB.isGitHubPagesHost('github.io'), true);
    assert.strictEqual(NB.isGitHubPagesHost('www.github.com'), false);
    assert.strictEqual(NB.isGitHubPagesHost('example.github.io.evil.test'), false);
    // Node has no browser location, so the runtime detector must not claim that
    // the offline test process is a static deployment.
    assert.strictEqual(NB.isStaticDeployment(), false);
  });
  test('NCAA game detail URL builders stay on the retained public host', () => {
    assert.strictEqual(NB.ncaaGameUrl('6458979'), 'https://ncaa-api.henrygd.me/game/6458979');
    assert.strictEqual(NB.ncaaBoxscoreUrl('6458979'), 'https://ncaa-api.henrygd.me/game/6458979/boxscore');
    assert.strictEqual(NB.ncaaPlayByPlayUrl('6458979'), 'https://ncaa-api.henrygd.me/game/6458979/play-by-play');
    assert.strictEqual(NB.ncaaTeamStatsUrl('6458979'), 'https://ncaa-api.henrygd.me/game/6458979/team-stats');
  });
  test('proxiedUrl wraps and encodes', () => {
    const p = NB.proxiedUrl('https://site.api.espn.com/x?a=1&b=2');
    assert.ok(p.startsWith('https://api.allorigins.win/raw?url='));
    assert.ok(p.indexOf('&b=2') === -1); // & must be encoded
    assert.ok(p.indexOf('a%3D1%26b%3D2') !== -1);
  });
  test('CORS proxy chain is ordered, allorigins first, and proxyUrls lists all', () => {
    // allorigins.win stayed first (it is the documented fallback), then two
    // independent public proxies so one outage doesn't kill the scoreboard.
    assert.deepStrictEqual(NB.CORS_PROXIES.map((p) => p.id), ['allorigins', 'corsproxy.io', 'codetabs']);
    const urls = NB.proxyUrls('https://site.api.espn.com/x?a=1&b=2');
    assert.strictEqual(urls.length, 3);
    assert.ok(urls[0].startsWith('https://api.allorigins.win/raw?url='));
    assert.ok(urls[1].startsWith('https://corsproxy.io/?url='));
    assert.ok(urls[2].startsWith('https://api.codetabs.com/v1/proxy?quest='));
    // Every proxy URL must encode the raw & of the target (never send %2C).
    urls.forEach((u) => { assert.ok(u.indexOf('&b=2') === -1); });
  });
  await atest('espnFetch uses the Reader transport when provider/CORS requests fail', async () => {
    const origFetch = global.fetch;
    try {
      const calls = [];
      global.fetch = (u) => {
        calls.push(String(u));
        if (String(u).startsWith('https://r.jina.ai/')) {
          return Promise.resolve({
            ok: true,
            text: async () => 'Title: ESPN\n\nMarkdown Content:\n{"events":[]}'
          });
        }
        return Promise.reject(new Error('network unavailable'));
      };
      const r = await NB.espnFetch('https://site.api.espn.com/apis/x', 400);
      assert.strictEqual(r.viaProxy, true);
      assert.strictEqual(r.proxy, 'jina-reader');
      assert.deepStrictEqual(r.data, { events: [] });
      assert.ok(calls.some((u) => u.startsWith('https://r.jina.ai/http://site.api.espn.com/')));
    } finally {
      global.fetch = origFetch;
    }
  });
  await atest('espnFetch walks the proxy chain to the first working proxy', async () => {
    const origFetch = global.fetch;
    try {
      let calls = [];
      global.fetch = (u) => {
        calls.push(u);
        if (/api\.allorigins\.win/.test(u)) return Promise.reject(new Error('allorigins down'));
        if (/corsproxy\.io/.test(u)) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
        if (/api\.codetabs\.com/.test(u)) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
        return Promise.reject(new Error('direct down')); // the direct ESPN URL fails
      };
      const r = await NB.espnFetch('https://site.api.espn.com/apis/x', 400);
      assert.strictEqual(r.viaProxy, true);
      assert.strictEqual(r.proxy, 'corsproxy.io'); // allorigins failed -> next proxy used
      assert.ok(calls.some((c) => /api\.allorigins\.win/.test(c))); // allorigins was attempted
      assert.ok(calls.some((c) => /corsproxy\.io/.test(c))); // and then corsproxy.io
      assert.strictEqual(calls[0], 'https://site.api.espn.com/apis/x'); // direct first
    } finally {
      global.fetch = origFetch;
    }
  });
  test('conference table has the 5 required conferences', () => {
    const ids = NB.CONFERENCES.map((c) => c.id).sort();
    assert.deepStrictEqual(ids, ['1', '151', '4', '5', '8']);
  });

  console.log('--- date helpers ---');
  test('shiftDate across month/year boundary', () => {
    assert.strictEqual(NB.shiftDate('20260801', -1), '20260731');
    assert.strictEqual(NB.shiftDate('20260101', -1), '20251231');
    assert.strictEqual(NB.shiftDate('20260101', 1), '20260102');
  });
  test('today and kickoff labels use ESPN Eastern calendar dates', () => {
    // 00:30 UTC on Aug 26 is still Aug 25 in New York. The selected date and
    // kickoff label must agree with ESPN's dates= filter at this boundary.
    const lateUtc = new Date('2026-08-26T00:30:00Z');
    assert.strictEqual(NB.easternDateStr(lateUtc), '20260825');
    assert.strictEqual(NB.localDateStr(lateUtc), '20260825');
    assert.strictEqual(NB.fmtKickoff('2026-08-26T00:30:00Z', '20260825'), '8:30 PM ET');
    assert.strictEqual(NB.fmtKickoff('2026-08-26T00:30:00Z', '20260826'), 'Tue 8:30 PM ET');
  });
  test('etDateFromWallclock EST (winter)', () => {
    // 2025-11-08T22:59Z is 17:59 EST — same Eastern date
    assert.strictEqual(NB.etDateFromWallclock('2025-11-08T22:59:27Z'), '20251108');
  });
  test('etDateFromWallclock EDT (summer) rolls date back', () => {
    // 2025-07-05T02:30Z is 22:30 EDT July 4
    assert.strictEqual(NB.etDateFromWallclock('2025-07-05T02:30:00Z'), '20250704');
  });
  test('periodLabel', () => {
    assert.strictEqual(NB.periodLabel(1), '1st');
    assert.strictEqual(NB.periodLabel(4), '4th');
    assert.strictEqual(NB.periodLabel(5), 'OT');
    assert.strictEqual(NB.periodLabel(6), 'OT2');
  });
  test('fmtDayLabel renders weekday + date', () => {
    // 2026-08-29 is the Saturday of Week 1 (UNC @ TCU in Dublin, verified).
    assert.strictEqual(NB.fmtDayLabel('20260829'), 'Sat, Aug 29');
    // 2026-01-19 is the Monday CFP title game date (verified).
    assert.strictEqual(NB.fmtDayLabel('20260119'), 'Mon, Jan 19');
    assert.strictEqual(NB.fmtDayLabel('nonsense'), 'nonsense');
  });

  console.log('--- nearby-games helpers ---');
  test('eventsOf pulls top-level events (verified response shape)', () => {
    // Live scoreboard responses are {"leagues":[...],"events":[...]} — the
    // events array is NOT inside leagues[0] (verified in every live dump).
    assert.deepStrictEqual(NB.eventsOf({ leagues: [{ id: '23' }], events: [{ id: '1' }] }), [{ id: '1' }]);
    assert.deepStrictEqual(NB.eventsOf({ leagues: [{ id: '23', events: [{ id: 'wrong' }] }], events: [{ id: 'right' }] }), [{ id: 'right' }]);
    assert.deepStrictEqual(NB.eventsOf({}), []);
    assert.deepStrictEqual(NB.eventsOf(null), []);
  });
  test('eventsOf converts documented NCAA contests to scoreboard events', () => {
    const data = { data: { contests: [{ contestId: 'n1', startDate: '08/29/2026', startTime: '12:00', startTimeEpoch: NCAA_SAMPLE_EPOCH, gameState: 'P', teams: [
      { isHome: false, isWinner: false, nameShort: 'UNC', score: 0 },
      { isHome: true, isWinner: false, nameShort: 'TCU', score: 0 }
    ] }] } };
    const ev = NB.eventsOf(data);
    assert.strictEqual(ev.length, 1);
    assert.strictEqual(ev[0].id, 'n1');
    assert.strictEqual(ev[0].date, '2026-08-29T16:00:00.000Z');
    assert.strictEqual(ev[0].competitions[0].competitors[0].team.displayName, 'UNC');
    assert.strictEqual(ev[0].competitions[0].status.type.state, 'pre');
  });
  test('NCAA community scoreboard games[] shape is also normalized', () => {
    const data = { games: [{ game: {
      gameID: 'g1', startDate: '12/13/2025', startTimeEpoch: 1765656000, gameState: 'final', finalMessage: 'FINAL',
      away: { score: '16', winner: false, names: { char6: 'ARMY', short: 'Army West Point' }, conferences: [{ conferenceSeo: 'american' }] },
      home: { score: '17', winner: true, names: { char6: 'NAVY', short: 'Navy' }, conferences: [{ conferenceSeo: 'american' }] }
    } }] };
    const event = NB.eventsOf(data)[0];
    assert.strictEqual(event.id, 'g1');
    assert.strictEqual(NB.parseEvent(event).status.state, 'post');
    assert.strictEqual(NB.parseEvent(event).away.abbreviation, 'ARMY');
    assert.strictEqual(NB.parseEvent(event).home.score, 17);
    assert.strictEqual(NB.scoreboardPayloadIsUsable(data), true);
    assert.strictEqual(NB.eventsOf(ncaaGame).length, 1); // game/{id} uses root contests[]
  });
  test('NCAA fallback validates contests, preserves isHome, status, scores, and conference IDs', () => {
    const events = NB.eventsOf(ncaaScoreboard);
    assert.strictEqual(events.length, 2);
    const upcoming = events.find((e) => e.id === '6604316');
    const final = events.find((e) => e.id === '6531855');
    assert.ok(upcoming && final);
    assert.strictEqual(upcoming.source, 'ncaa');
    assert.strictEqual(upcoming.competitions[0].status.type.state, 'pre');
    assert.strictEqual(upcoming.competitions[0].competitors.find((c) => c.homeAway === 'home').team.abbreviation, 'UNC');
    assert.deepStrictEqual(NB.parseEvent(upcoming).conferenceIds.sort(), ['1', '4']);
    assert.strictEqual(NB.parseEvent(final).away.score, 21);
    assert.strictEqual(NB.parseEvent(final).home.score, 27);
    assert.strictEqual(NB.parseEvent(final).status.state, 'post');
    assert.strictEqual(NB.eventMatchesGroups(upcoming, ['4']), true);
    assert.strictEqual(NB.eventMatchesGroups(upcoming, ['8']), false);
  });
  test('single-day filtering keeps only the requested Eastern date', () => {
    const events = NB.eventsOf(ncaaScoreboard);
    assert.deepStrictEqual(NB.filterEventsForDate(events, '20260829').map((e) => e.id), ['6604316']);
    assert.deepStrictEqual(NB.filterEventsForDate(events, '20260119').map((e) => e.id), ['6531855']);
    assert.deepStrictEqual(NB.filterEventsForDate(events, '20260830'), []);
  });
  test('completed-event helper distinguishes final results from scheduled games', () => {
    const events = NB.eventsOf(ncaaScoreboard);
    assert.strictEqual(NB.eventIsCompleted(events.find((e) => e.id === '6531855')), true);
    assert.strictEqual(NB.eventIsCompleted(events.find((e) => e.id === '6604316')), false);
  });
  test('placeholder ESPN responses are rejected, while a real empty slate is valid', () => {
    assert.strictEqual(NB.scoreboardPayloadIsUsable({ events: [{}] }), false);
    assert.strictEqual(NB.scoreboardPayloadIsUsable({ events: [] }), true);
    assert.strictEqual(NB.scoreboardPayloadIsUsable({ events: [], error: 'upstream failed' }), false);
    assert.strictEqual(NB.scoreboardPayloadIsUsable({ error: 'upstream failed' }), false);
    assert.strictEqual(NB.validEventsOf({ events: [{}] }).length, 0);
  });
  test('NCAA game overview/detail parsing keeps fallback scores and optional stats/PBP', () => {
    const boxscore = { teamBoxscore: [
      { teamId: 1356, teamStats: { firstDowns: '17' }, playerStats: [
        { firstName: 'Blake', lastName: 'Horvath', number: 11, category: 'rushing', rushingAttempts: '34', rushingYards: '107' }
      ] },
      { teamId: 2352, teamStats: { firstDowns: '11' }, playerStats: [] }
    ] };
    const pbp = { contestId: 6458979, periods: [{ periodNumber: 1, playbyplayStats: [
      { teamId: 1356, plays: [{ playText: 'Horvath rush for 5 yards.', driveText: '1 and 10 at 25', clock: '07:00', homeScore: 7, visitorScore: 0 }] }
    ] }] };
    const detail = NB.parseNCAADetail(ncaaGame, boxscore, pbp, boxscore);
    assert.strictEqual(detail.teams[0].abbreviation, 'ARMY');
    assert.strictEqual(detail.teams[1].abbreviation, 'NAVY');
    assert.strictEqual(detail.teams[0].score, 16);
    assert.strictEqual(detail.teams[1].score, 17);
    assert.strictEqual(detail.teams[1].stats.find((s) => s.name === 'firstDowns').displayValue, '17');
    assert.strictEqual(detail.players[0].teamId, '1356');
    assert.strictEqual(detail.players[0].categories[0].athletes[0].name, 'Blake Horvath');
    assert.strictEqual(detail.plays[0].offTeamId, '1356');
    assert.strictEqual(detail.plays[0].type, 'Rush');
  });
  test('groupByDay groups by Eastern date, sorted', () => {
    const evs = [
      { id: 'a', date: '2026-08-29T16:00Z' },  // Sat Aug 29, 12:00 ET
      { id: 'b', date: '2026-09-06T00:15Z' },  // Sat Sep 5, 20:15 ET (UTC Sunday -> ET Saturday)
      { id: 'c', date: '2026-08-29T23:00Z' }   // Sat Aug 29, 19:00 ET
    ];
    const days = NB.groupByDay(evs);
    assert.deepStrictEqual(days.map((d) => d.date), ['20260829', '20260905']);
    assert.strictEqual(days[0].events.length, 2);
    assert.deepStrictEqual(days[0].events.map((e) => e.id), ['a', 'c']);
  });
  test('groupByDay skips malformed events', () => {
    const days = NB.groupByDay([{ id: 'x' }, null, { id: 'y', date: 'not-a-date' }, { date: '2026-08-29T16:00Z' }]);
    assert.strictEqual(days.length, 0);
  });
  test('range filtering excludes provider events outside the requested window', () => {
    const events = [
      { id: 'before', date: '2026-08-26T23:00Z' },
      { id: 'inside', date: '2026-08-29T16:00Z' },
      { id: 'after', date: '2026-09-09T05:00Z' }
    ];
    assert.deepStrictEqual(NB.filterEventsForRange(events, '20260827', '20260908').map((e) => e.id), ['inside']);
  });
  test('calendarProbeWindows: back window spans the previous league-year end', () => {
    // Real 2026-season calendar values (verbatim from the live API,
    // 2026-08-25). League year starts 2026-02-01, so the last games of the
    // previous season live in the 3 weeks before it — Jan 11..31, 2026,
    // which contains the Jan 19 CFP title game (verified).
    const league = {
      calendarStartDate: '2026-02-01T08:00Z',
      calendar: [
        { label: 'Regular Season', value: '2', startDate: '2026-08-22T07:00Z', endDate: '2026-12-13T07:59Z', entries: [
          { label: 'Week 1', value: '1', startDate: '2026-08-22T07:00Z', endDate: '2026-09-08T06:59Z' }
        ] },
        { label: 'Postseason', value: '3', startDate: '2026-12-13T08:00Z', endDate: '2027-01-28T07:59Z', entries: [] },
        { label: 'Off Season', value: '4', startDate: '2027-01-28T08:00Z', endDate: '2027-02-01T07:59Z', entries: [] }
      ]
    };
    const w = NB.calendarProbeWindows(league, '20260715'); // deep offseason date
    assert.deepStrictEqual(w.back, ['20260111', '20260131']);
    assert.deepStrictEqual(w.fwd, ['20260822', '20260904']); // season opener window
  });
  test('calendarProbeWindows: no future season -> fwd null', () => {
    const league = {
      calendarStartDate: '2025-02-01T08:00Z',
      calendar: [
        { label: 'Regular Season', value: '2', startDate: '2025-08-23T07:00Z', endDate: '2025-12-13T07:59Z', entries: [] },
        { label: 'Postseason', value: '3', startDate: '2025-12-13T08:00Z', endDate: '2026-01-21T07:59Z', entries: [] }
      ]
    };
    const w = NB.calendarProbeWindows(league, '20260110');
    assert.strictEqual(w.fwd, null);
    assert.deepStrictEqual(w.back, ['20250111', '20250131']);
    assert.strictEqual(NB.calendarProbeWindows(null, '20260825').fwd, null);
  });
  test('calendarProbeWindows clips a future back window to the selected date', () => {
    const league = { calendarStartDate: '2025-02-01T08:00Z', calendar: [] };
    assert.deepStrictEqual(NB.calendarProbeWindows(league, '20250115').back, ['20250111', '20250114']);
  });
  test('fallbackProbeWindows covers season boundaries without inventing games', () => {
    assert.deepStrictEqual(NB.fallbackProbeWindows('20260826'), { fwd: null, back: ['20260101', '20260131'] });
    assert.deepStrictEqual(NB.fallbackProbeWindows('20260715'), { fwd: ['20260822', '20260908'], back: ['20260101', '20260131'] });
    assert.deepStrictEqual(NB.fallbackProbeWindows('20260110'), { fwd: ['20260111', '20260131'], back: ['20251215', '20251231'] });
    assert.deepStrictEqual(NB.fallbackProbeWindows('20260120'), { fwd: ['20260822', '20260908'], back: ['20260101', '20260119'] });
  });

  console.log('--- scoreboard parsing (real fixture) ---');
  const game = NB.parseEvent(sb);
  test('parses ids, names, date', () => {
    assert.strictEqual(game.id, '401752763');
    assert.strictEqual(game.name, 'Texas A&M Aggies at Missouri Tigers');
    assert.strictEqual(game.date, '2025-11-08T20:30Z');
  });
  test('away/home orientation + scores', () => {
    assert.strictEqual(game.away.abbreviation, 'TA&M');
    assert.strictEqual(game.home.abbreviation, 'MIZ');
    assert.strictEqual(game.away.score, 38);
    assert.strictEqual(game.home.score, 17);
    assert.strictEqual(game.away.winner, true);
  });
  test('status final', () => {
    assert.strictEqual(game.status.state, 'post');
    assert.strictEqual(game.status.completed, true);
    assert.strictEqual(NB.statusVM(game).kind, 'final');
  });
  test('per-period linescores', () => {
    assert.deepStrictEqual(game.away.linescores.map((l) => Number(l.value)), [7, 7, 10, 14]);
    assert.deepStrictEqual(game.home.linescores.map((l) => Number(l.value)), [0, 0, 7, 10]);
  });
  test('records, ranks, venue, broadcast, attendance', () => {
    assert.strictEqual(game.away.records.total, '9-0');
    assert.strictEqual(game.home.records.total, '6-3');
    assert.strictEqual(game.away.rank, 3);
    assert.strictEqual(game.home.rank, 22);
    assert.strictEqual(game.venueName, 'Memorial Stadium');
    assert.strictEqual(game.venueCity, 'Columbia, MO');
    assert.strictEqual(game.broadcast, 'ABC');
    assert.strictEqual(game.attendance, 57321);
  });
  test('conference name comes from the response (groups)', () => {
    assert.strictEqual(game.conferences.length, 1);
    assert.strictEqual(game.conferences[0].short, 'SEC');
    assert.strictEqual(game.conferences[0].name, 'Southeastern Conference');
    assert.deepStrictEqual(game.conferenceIds, ['8']);
  });
  test('game leaders', () => {
    assert.strictEqual(game.leaders.length, 3);
    assert.strictEqual(game.leaders[0].athlete, 'Marcel Reed');
    assert.strictEqual(game.leaders[0].displayValue, '20/29, 221 YDS, 2 TD');
    assert.strictEqual(game.leaders[1].athlete, 'Jamal Roberts');
  });
  test('recap headline kept, nothing video-related surfaced', () => {
    assert.ok(game.headlines[0].text.indexOf('38-17 victory') !== -1);
  });
  test('mergeEvents dedupes the same game from two conference feeds', () => {
    const merged = NB.mergeEvents([[sb], [sb]]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].id, '401752763');
  });
  test('mergeEvents unions conference labels from different feeds', () => {
    const other = JSON.parse(JSON.stringify(sb));
    other.competitions[0].groups = { id: '5', name: 'Big Ten Conference', shortName: 'Big Ten', isConference: true };
    const merged = NB.mergeEvents([[sb], [other]]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].conferences.length, 2);
  });
  test('groupGames buckets live/pre/post', () => {
    const live = JSON.parse(JSON.stringify(sb));
    live.competitions[0].status = { clock: 0.0, displayClock: '7:42', period: 2, type: { id: '2', name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, description: '2nd & 7, MIZ 33', detail: '2nd & 7, MIZ 33', shortDetail: '2nd & 7' } };
    live.competitions[0].competitors.forEach((c) => delete c.winner);
    const pre = JSON.parse(JSON.stringify(sb));
    pre.competitions[0].status = { clock: 0.0, displayClock: '0:00', period: 0, type: { id: '1', name: 'STATUS_SCHEDULED', state: 'pre', completed: false, description: 'Scheduled', detail: 'Sat, August 29th at 12:00 PM EDT', shortDetail: '8/29 - 12:00 PM EDT' } };
    const buckets = NB.groupGames([NB.parseEvent(live), NB.parseEvent(sb), NB.parseEvent(pre)]);
    assert.strictEqual(buckets.length, 3);
    assert.strictEqual(buckets[0].key, 'live');
    assert.strictEqual(buckets[0].games[0].id, live.id);
    assert.strictEqual(buckets[1].key, 'pre');
    assert.strictEqual(buckets[2].key, 'post');
  });
  test('statusVM live label', () => {
    const live = JSON.parse(JSON.stringify(sb));
    live.competitions[0].status = { clock: 0.0, displayClock: '7:42', period: 2, type: { id: '2', name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, description: '2nd & 7', shortDetail: '2nd & 7' } };
    const g = NB.parseEvent(live);
    assert.strictEqual(NB.statusVM(g).label, '2nd 7:42');
  });
  test('fresh visit advances past an empty or completed-only slate', () => {
    const finalOnly = [NB.parseEvent(sb)];
    assert.strictEqual(NB.shouldOpenNextGameDay([]), true);
    assert.strictEqual(NB.shouldOpenNextGameDay(finalOnly), true);

    const scheduled = JSON.parse(JSON.stringify(sb));
    scheduled.competitions[0].status.type.state = 'pre';
    assert.strictEqual(NB.shouldOpenNextGameDay([NB.parseEvent(scheduled)]), false);

    const live = JSON.parse(JSON.stringify(sb));
    live.competitions[0].status.type.state = 'in';
    assert.strictEqual(NB.shouldOpenNextGameDay([NB.parseEvent(live)]), false);
  });

  console.log('--- summary parsing (real fixture) ---');
  const detail = NB.parseSummary(sum);
  test('boxscore teams, away-first', () => {
    assert.strictEqual(detail.teams.length, 2);
    assert.strictEqual(detail.teams[0].abbreviation, 'TA&M');
    assert.strictEqual(detail.teams[1].abbreviation, 'MIZ');
  });
  test('team stats carry label + displayValue', () => {
    const a = detail.teams[0].stats.find((s) => s.name === 'firstDowns');
    const h = detail.teams[1].stats.find((s) => s.name === 'firstDowns');
    assert.strictEqual(a.displayValue, '21');
    assert.strictEqual(h.displayValue, '17');
    const poss = detail.teams[0].stats.find((s) => s.name === 'possessionTime');
    assert.strictEqual(poss.displayValue, '35:46');
  });
  test('teamStatRows builds the union table', () => {
    const rows = NB.teamStatRows(detail.teams[0], detail.teams[1]);
    const fd = rows.find((r) => r.name === 'firstDowns');
    assert.strictEqual(fd.away, '21');
    assert.strictEqual(fd.home, '17');
    assert.strictEqual(rows.length, 15); // all 15 stat names appear once
  });
  test('player categories (passing) parse athletes + labels', () => {
    const block = detail.players.find((p) => p.teamId === '245');
    assert.ok(block, 'TA&M player block present');
    const passing = block.categories.find((c) => c.name === 'passing');
    assert.deepStrictEqual(passing.labels, ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'QBR']);
    assert.strictEqual(passing.athletes[0].name, 'Marcel Reed');
    assert.deepStrictEqual(passing.athletes[0].stats, ['20/29', '221', '7.6', '2', '0', '90.4']);
    assert.deepStrictEqual(passing.totals, ['20/29', '221', '7.6', '2', '0', '--']);
  });
  test('player categories (rushing) parse multiple athletes', () => {
    const block = detail.players.find((p) => p.teamId === '245');
    const rushing = block.categories.find((c) => c.name === 'rushing');
    assert.strictEqual(rushing.athletes.length, 4);
    assert.strictEqual(rushing.athletes[0].name, 'Rueben Owens II');
    assert.strictEqual(rushing.totals, null);
  });
  test('drives parse (result, description, positions)', () => {
    assert.strictEqual(detail.drives.length, 2);
    const td = detail.drives[0];
    assert.strictEqual(td.result, 'Touchdown');
    assert.strictEqual(td.resultRaw, 'TD');
    assert.strictEqual(td.isScore, true);
    assert.strictEqual(td.description, '2 plays, 2 yards, 0:37');
    assert.strictEqual(td.teamId, '245');
    assert.strictEqual(td.start.text, 'MIZ 2');
    const punt = detail.drives[1];
    assert.strictEqual(punt.resultRaw, 'PUNT');
    assert.strictEqual(punt.teamId, '142');
  });
  test('plays flatten from drives, chronological', () => {
    assert.strictEqual(detail.plays.length, 4);
    const order = detail.plays.map((p) => p.seq);
    assert.deepStrictEqual(order, [77, 78, 84, 85]);
  });
  test('play normalization: clock prefix stripped, badges set', () => {
    const tdPlay = detail.plays.find((p) => p.seq === 78);
    assert.ok(tdPlay.text.indexOf('TOUCHDOWN') !== -1);
    assert.strictEqual(tdPlay.text.indexOf('(00:20)'), -1); // prefix removed
    assert.strictEqual(tdPlay.clock, '0:20');
    assert.strictEqual(tdPlay.scoringPlay, true);
    assert.strictEqual(tdPlay.scoringType, 'TD');
    assert.strictEqual(tdPlay.pointAfter, 'Extra Point Good');
    assert.strictEqual(tdPlay.offTeamId, '245');
    assert.strictEqual(tdPlay.downDistance, '2nd & Goal at MIZ 1');
    const ko = detail.plays.find((p) => p.seq === 84);
    assert.strictEqual(ko.type, 'Kickoff');
    assert.strictEqual(ko.yardage, 14);
  });
  test('lastPlayScore from final play', () => {
    const s = NB.lastPlayScore(detail);
    assert.strictEqual(s.away, 14);
    assert.strictEqual(s.home, 0);
  });
  test('top-level plays array takes priority when present', () => {
    const p77 = sum.drives[0].plays[0];
    const p78 = sum.drives[0].plays[1];
    const withFlat = Object.assign({}, sum, { plays: [p77, p78] });
    const d2 = NB.parseSummary(withFlat);
    assert.strictEqual(d2.plays.length, 2);
    assert.deepStrictEqual(d2.plays.map((p) => p.seq), [77, 78]);
  });
  test('article (recap) parses; no video fields consumed', () => {
    assert.ok(detail.article.headline.indexOf('38-17 victory') !== -1);
    assert.ok(detail.article.text.indexOf('Marcel Reed') !== -1);
  });
  test('rawKeys recorded for diagnostics', () => {
    assert.ok(Array.isArray(detail.rawKeys));
    assert.ok(detail.rawKeys.indexOf('boxscore') !== -1);
    assert.ok(detail.rawKeys.indexOf('drives') !== -1);
  });
  test('parseSummary: pre-game summary (no plays) keeps header kickoff date', () => {
    // Shaped verbatim from the live pre-game summary for event 401856766
    // (UNC @ TCU, 2026-08-29, Aviva Stadium) fetched 2026-08-25: teams with
    // empty statistics, no drives/plays/article, and header.competitions[0].date.
    const pre = {
      boxscore: {
        teams: [
          { team: { id: '153', abbreviation: 'UNC', displayName: 'North Carolina Tar Heels', color: '7bafd4', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/153.png' }, statistics: [], displayOrder: 1, homeAway: 'away' },
          { team: { id: '2628', abbreviation: 'TCU', displayName: 'TCU Horned Frogs', color: '4d1979', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2628.png' }, statistics: [], displayOrder: 2, homeAway: 'home' }
        ]
      },
      format: { regulation: { periods: 4, displayName: 'Quarter', slug: 'quarter', clock: 900.0 } },
      gameInfo: { venue: { id: '3504', fullName: 'Aviva Stadium', address: { city: 'Dublin', country: 'Ireland' }, grass: true } },
      header: {
        id: '401856766',
        competitions: [{
          id: '401856766', date: '2026-08-29T16:00Z', dateValid: true, neutralSite: true,
          conferenceCompetition: false, boxscoreAvailable: false, playByPlaySource: 'none'
        }]
      }
    };
    const d = NB.parseSummary(pre);
    assert.strictEqual(d.headerDate, '2026-08-29T16:00Z');
    assert.strictEqual(d.teams.length, 2);
    assert.strictEqual(d.teams[0].abbreviation, 'UNC');   // away-first ordering holds
    assert.strictEqual(d.teams[1].abbreviation, 'TCU');
    assert.strictEqual(d.teams[0].stats.length, 0);
    assert.strictEqual(d.plays.length, 0);
    assert.strictEqual(d.drives.length, 0);
    assert.strictEqual(d.article, null);
    assert.strictEqual(d.players.length, 0);
    // The fixture (post-game) has no trimmed header -> headerDate null, not a crash.
    assert.ok(detail.headerDate === null || typeof detail.headerDate === 'string');
  });

  console.log('--- historical PBP backfill (verified live 2026-08-28) ---');
  test('summaryDrivesOf accepts the verified {previous: [...]} postseason envelope', () => {
    // Event 401769074 (Oregon @ Indiana, CFP semifinal 2026-01-09) returns
    // drives wrapped in {"previous": [...]}, unlike the fixture's plain array.
    // Reading only the array form hid every play of that game (the original
    // "no pbp data" report).
    const wrapped = JSON.parse(JSON.stringify(sum));
    wrapped.drives = { previous: wrapped.drives };
    assert.strictEqual(NB.summaryDrivesOf(wrapped).length, 2);
    const d2 = NB.parseSummary(wrapped);
    assert.strictEqual(d2.drives.length, 2);
    assert.deepStrictEqual(d2.plays.map((p) => p.seq), [77, 78, 84, 85]);
  });
  test('summaryDrivesOf appends drives.current for the live-game envelope form', () => {
    const live = JSON.parse(JSON.stringify(sum));
    live.drives = { previous: [live.drives[0]], current: live.drives[1] };
    const d2 = NB.parseSummary(live);
    assert.strictEqual(d2.drives.length, 2);
    assert.strictEqual(d2.drives[1].id, sum.drives[1].id);
    assert.strictEqual(d2.plays.length, 4);
  });
  test('provider-re-issued plays (same period+sequence, new id) render once', () => {
    // Verified live in event 401769074: one interception touchdown appears
    // twice in the same drive at sequence "2" with two different play ids.
    const dup = JSON.parse(JSON.stringify(sum));
    const reissued = JSON.parse(JSON.stringify(dup.drives[0].plays[1]));
    reissued.id = String(dup.drives[0].plays[1].id) + '-reissue';
    dup.drives[0].plays.push(reissued);
    const d2 = NB.parseSummary(dup);
    assert.strictEqual(d2.plays.filter((p) => p.seq === 78).length, 1);
    assert.deepStrictEqual(d2.plays.map((p) => p.seq), [77, 78, 84, 85]);
  });
  test('espnCorePlaysUrl builds the verified Core API collection URL and pins numeric ids', () => {
    assert.strictEqual(
      NB.espnCorePlaysUrl('401769074'),
      'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/401769074/competitions/401769074/plays?limit=400'
    );
    assert.strictEqual(NB.espnCorePlaysUrl('401769074;drop'), null);
    assert.strictEqual(NB.espnCorePlaysUrl(''), null);
  });
  test('extractCorePlays normalizes verified Core API items through the summary play pipeline', () => {
    const plays = NB.extractCorePlays(espnCorePlays);
    assert.strictEqual(plays.length, 2);
    assert.strictEqual(plays[0].type, 'Coin Toss');
    assert.strictEqual(plays[0].seq, 0);
    assert.strictEqual(plays[1].type, 'Kickoff');
    assert.strictEqual(plays[1].clock, '14:57');            // displayValue wins over the text prefix
    assert.ok(plays[1].text.indexOf('(15:00)') === -1);     // duplicated clock prefix stripped
    assert.ok(plays[1].text.indexOf('kickoff 60 yards') !== -1);
    assert.strictEqual(plays[1].offTeamId, '2483');         // teamParticipants offense id
    assert.strictEqual(plays[1].defTeamId, '84');
    assert.strictEqual(plays[1].possessionTeamId, '2483');  // falls back to the offense id ($ref-only start/end teams)
    assert.strictEqual(plays[1].downDistance, '1st & 10 at ORE 20');
    assert.strictEqual(plays[1].yardage, 15);
    assert.strictEqual(plays[1].awayScore, 0);
    assert.strictEqual(plays[1].time > 0, true);            // wallclock parsed
    assert.deepStrictEqual(NB.extractCorePlays({}), []);
  });
  test('cross-provider matchup resolves ESPN Oregon @ Indiana to NCAA contest 6531853 (verified feed)', () => {
    const contests = NB.ncaaContestsOf(ncaaScoreboard20260109);
    assert.strictEqual(contests.length, 1);
    // Shape of the parsed ESPN row for the same game (away/home names as
    // produced by parseCompetitor from the verified 20260109 scoreboard).
    const espnGame = {
      away: { name: 'Oregon', displayName: 'Oregon Ducks' },
      home: { name: 'Indiana', displayName: 'Indiana Hoosiers' }
    };
    const contest = NB.findNCAAContestForGame(contests, espnGame);
    assert.ok(contest);
    assert.strictEqual(String(contest.contestId), '6531853');
    // The NCAA contest then feeds the normal NCAA detail loaders:
    const event = NB.eventsOf(ncaaScoreboard20260109)[0];
    assert.strictEqual(NB.parseEvent(event).home.score, 56);
    assert.strictEqual(NB.parseEvent(event).status.state, 'post');
    assert.strictEqual(NB.parseEvent(event).source, 'ncaa');
  });
  test('cross-provider matchup never attaches a different game', () => {
    const contests = NB.ncaaContestsOf(ncaaScoreboard20260109);
    const noGame = NB.findNCAAContestForGame(contests, {
      away: { name: 'Georgia Tech', displayName: 'Georgia Tech Yellow Jackets' },
      home: { name: 'Georgia', displayName: 'Georgia Bulldogs' }
    });
    assert.strictEqual(noGame, null);
    // One team alone must not match: both sides are required.
    const half = NB.findNCAAContestForGame(contests, {
      away: { name: 'Oregon', displayName: 'Oregon Ducks' },
      home: { name: 'Oregon State', displayName: 'Oregon State Beavers' }
    });
    assert.strictEqual(half, null);
    // "Oregon State" must not collapse into "Oregon" through normalization.
    assert.strictEqual(NB.findNCAAContestForGame(contests, {
      away: { name: 'Indiana', displayName: 'Indiana Hoosiers' },
      home: { name: 'Oregon', displayName: 'Oregon Ducks' }
    }), null); // swapped home/away is not the same matchup orientation
  });
  test('regression: the reported game 401769074 yields its PBP from the verified {previous} response', () => {
    const d = NB.parseSummary(summary401769074);
    assert.strictEqual(d.teams.length, 2);
    assert.strictEqual(d.teams[0].abbreviation, 'ORE');   // away-first
    assert.strictEqual(d.teams[1].abbreviation, 'IU');
    assert.strictEqual(d.drives.length, 2);
    assert.strictEqual(d.drives[0].resultRaw, 'INT TD');
    // The provider's re-issued interception touchdown (same period+sequence,
    // two ids) collapses to one row:
    assert.deepStrictEqual(d.plays.map((p) => p.seq), [1, 2, 4, 6]);
    const td = d.plays.find((p) => p.seq === 2);
    assert.strictEqual(td.scoringPlay, true);
    assert.strictEqual(td.scoringType, 'TD');
    assert.strictEqual(td.pointAfter, 'Extra Point Good');
    assert.strictEqual(td.isTurnover, true);
    assert.strictEqual(td.homeScore, 7);
    assert.strictEqual(td.defTeamId, '84');
    const rush = d.plays.find((p) => p.seq === 6);
    assert.strictEqual(rush.clock, '14:06');              // displayValue wins over the "(14:13)" prefix
    assert.ok(rush.text.indexOf('(14:13)') === -1);
    assert.ok(rush.text.indexOf('Shotgun #22 J.Harris') === 0);
    assert.strictEqual(rush.downDistance, '1st & 10 at ORE 36');
    assert.strictEqual(rush.offTeamId, '2483');
    assert.strictEqual(rush.yardage, 7);
    // Last play score keeps the header score honest for this deep-linked game.
    const s = NB.lastPlayScore(d);
    assert.strictEqual(s.away, 0);
    assert.strictEqual(s.home, 6);
  });
  test('NCAA PBP backfill strips duplicated clock prefixes and tags PAT/FG correctly', () => {
    // Play texts copied verbatim from the live /game/6531853/play-by-play feed
    // (2026-08-28); the FG rows mirror the observed NCAA wording.
    const pbp = { contestId: 6531853, periods: [{ periodNumber: 1, playbyplayStats: [
      { teamId: 759, plays: [{ playText: '(06:35) Shotgun F.Mendoza pass complete short left to E.Sarratt caught at Ind31, for 5 yards to the Ind31 (I.Obidegwu)', driveText: '2 and  at Ind26', homeScore: null, visitorScore: null, clock: '06:35' }] },
      { teamId: 759, plays: [{ playText: 'Q.Warren kick attempt good (H: M.McCarthy, LS: M.Langston)', driveText: '- and true at -3', homeScore: 7, visitorScore: 0, clock: '00:00' }] },
      { teamId: 759, plays: [{ playText: 'Q.Warren field goal attempt from 43 GOOD', driveText: '4 and true at Ore26', homeScore: 10, visitorScore: 0, clock: '01:00' }] },
      { teamId: 759, plays: [{ playText: 'Q.Warren field goal attempt from 52 NO GOOD', driveText: '4 and true at Ore35', homeScore: 10, visitorScore: 0, clock: '00:30' }] }
    ] }] };
    const plays = NB.parseNCAADetail(ncaaGame, null, pbp, null).plays;
    assert.strictEqual(plays.length, 4);
    assert.strictEqual(plays[0].clock, '06:35');
    assert.ok(plays[0].text.indexOf('(06:35)') === -1);
    assert.ok(plays[0].text.indexOf('Shotgun F.Mendoza') === 0);
    assert.strictEqual(plays[1].scoringType, 'PAT');   // was mistagged 'FG' by "kick.*good"
    assert.strictEqual(plays[1].scoringPlay, true);
    assert.strictEqual(plays[2].scoringType, 'FG');
    assert.strictEqual(plays[2].scoringPlay, true);
    assert.strictEqual(plays[3].scoringPlay, false);   // "NO GOOD" is not a score
    assert.strictEqual(plays[3].scoringType, null);
  });

  console.log('--- live booth (flags & reviews) ---');
  // Build a raw ESPN college-football play object (same field shape as the
  // summary/Core API plays already normalized by normalizePlay) and normalize it.
  function boothRawPlay(over) {
    return Object.assign({
      id: 'p', sequenceNumber: '0', type: { text: 'Play' }, text: 'play',
      awayScore: 0, homeScore: 0, scoringPlay: false, isPenalty: false,
      period: { number: 2 }, clock: { displayValue: '10:00' },
      start: { yardsToEndzone: 50, downDistanceText: '1st & 10 at MIZ 40', possessionText: 'MIZ 40', yardLine: 40, team: { id: '245' } },
      end: { yardsToEndzone: 45, downDistanceText: '1st & 10 at MIZ 45', possessionText: 'MIZ 45', yardLine: 45, team: { id: '245' } },
      teamParticipants: [{ type: 'offense', id: '245' }, { type: 'defense', id: '142' }]
    }, over);
  }
  function boothNorm(over) { return NB.normalizePlay(boothRawPlay(over), 'd1'); }
  const teamMap = {
    '245': { abbr: 'TA&M', displayName: 'Texas A&M Aggies', logo: '' },
    '142': { abbr: 'MIZ', displayName: 'Missouri Tigers', logo: '' }
  };

  test('normalizePlay preserves start.yardsToEndzone and penalty details for the booth', () => {
    const p = boothNorm({ id: '1', text: 'No Huddle #22 E.Smith rush for 40 yards TOUCHDOWN', scoringPlay: true, type: { text: 'Rushing Touchdown' }, start: { yardsToEndzone: 10, downDistanceText: '2nd & Goal at MIZ 10', possessionText: 'MIZ 10', yardLine: 10, team: { id: '245' } } });
    assert.strictEqual(p.start.yardsToEndzone, 10);
    assert.strictEqual(p.start.downDistanceText, '2nd & Goal at MIZ 10');
    assert.strictEqual(p.start.teamId, '245');
    const pen = boothNorm({ id: '2', text: 'PENALTY Mizzou Holding (#45 C.Weselman) 7 yards from Mizzou14 to Mizzou07', isPenalty: true, type: { text: 'Penalty' }, penalty: { yards: 7, type: { text: 'Holding' } } });
    assert.strictEqual(pen.penalty.yards, 7);
    assert.strictEqual(pen.penalty.typeText, 'Holding');
    assert.strictEqual(pen.penaltyText, '7-yard Holding');
    // NCAA-fallback plays carry null position (must never be guessed).
    const ncaaPlay = { id: 'n', seq: 1, type: 'Play', text: 'yard run', period: 1, clock: '10:00', awayScore: 0, homeScore: 0, start: null, end: null, penalty: null };
    assert.strictEqual(NB.boothYardsToEndzone(ncaaPlay, teamMap), null);
  });

  test('boothClassify detects the embedded "PENALTY <team> <foul>" flag (verified fixture) ', () => {
    // Verified verbatim in the summary fixture: a kickoff row with isPenalty:false
    // carries a penalty appended to the play text. The booth must still surface it.
    const kickoff = boothNorm({ id: 'k', type: { text: 'Kickoff' }, text: '#99 J.Zirkel kickoff 65 yards to the Mizzou00 #11 D.Fowlkes return 33 yards to the Mizzou33, End Of Play PENALTY Mizzou Holding (#45 C.Weselman) 7 yards from Mizzou14 to Mizzou07', isPenalty: false });
    assert.strictEqual(NB.boothClassify(kickoff), 'penalty');
    const ev = NB.boothEvent(kickoff);
    assert.strictEqual(ev.heading, '7-yard Holding');
    // A kickoff-return flag may not nullify a prior score (no rollback eligible).
    const plays = [boothNorm({ id: 'a', seq: 1, text: '#22 E.Smith rush for 2 yards', awayScore: 0, homeScore: 0 }), kickoff];
    const effect = NB.boothScoreEffect(plays, 1);
    assert.strictEqual(effect.removesPoints, false);
  });

  test('boothClassify separates flag / challenge / replay / review', () => {
    assert.strictEqual(NB.boothClassify(boothNorm({ id: 'a', text: 'PENALTY on MIZ-#1 A.Brown, Holding, 10 yards', isPenalty: true })), 'penalty');
    assert.strictEqual(NB.boothClassify(boothNorm({ id: 'b', text: 'The Missouri head coach has challenged the ruling of incomplete pass.', })), 'challenge');
    assert.strictEqual(NB.boothClassify(boothNorm({ id: 'c', text: 'The Replay Official reviewed the play, and the ruling on the field was overturned.', })), 'replay');
    assert.strictEqual(NB.boothClassify(boothNorm({ id: 'd', text: 'The play is under further review.' })), 'review');
    assert.strictEqual(NB.boothClassify(boothNorm({ id: 'e', text: '#22 E.Smith rush for 2 yards' })), '');
  });

  test('boothResult matches NCAA 2025 "upheld"/"overturned" and legacy wording', () => {
    assert.strictEqual(NB.boothResult('After further review, the ruling on the field is upheld.'), 'upheld');
    assert.strictEqual(NB.boothResult('After further review, the ruling on the field is confirmed.'), 'confirmed');
    assert.strictEqual(NB.boothResult('After further review, the ruling on the field stands.'), 'stands');
    assert.strictEqual(NB.boothResult('The play is under further review.'), 'pending');
    assert.strictEqual(NB.boothResult('After further review, the ruling is overturned. Therefore, the pass was incomplete.'), 'overturned');
    assert.strictEqual(NB.boothResult('The penalty is declined.'), 'declined');
  });

  test('nullifiedScoreText recognizes NCAA/ESPN nullification wording only on scoring plays', () => {
    // Must be true: text names a score AND reports it as nullified / no play / reversed.
    assert.strictEqual(NB.nullifiedScoreText('#22 E.Smith rush for 4 yards, TOUCHDOWN NULLIFIED by Penalty.PENALTY on MIZ-#45 C.Weselman, Defensive Offside, 4 yards - No Play.'), true);
    assert.strictEqual(NB.nullifiedScoreText('#22 E.Smith rush for 28 yards, TOUCHDOWN. The Replay Official reviewed the runner broke the plane ruling, and the play was REVERSED.'), true);
    assert.strictEqual(NB.nullifiedScoreText('#22 E.Smith rush for 40 yards TOUCHDOWN OVERTURNED by review.'), true);
    assert.strictEqual(NB.nullifiedScoreText('Q.Warren field goal attempt from 43 GOOD is OVERTURNED by review.'), true);
    assert.strictEqual(NB.nullifiedScoreText('TOUCHDOWN nullified on review.'), true);
    // Must be false: no score named, or not actually nullified.
    assert.strictEqual(NB.nullifiedScoreText('PENALTY Mizzou Holding 7 yards from Mizzou10 to Mizzou07'), false);
    assert.strictEqual(NB.nullifiedScoreText('#22 E.Smith rush for 2 yards'), false);
    assert.strictEqual(NB.nullifiedScoreText('Q.Warren field goal attempt from 43 GOOD'), false);
    assert.strictEqual(NB.nullifiedScoreText('Kickoff 65 yards Touchback'), false);
  });

  test('boothScoreEffect tracks before -> during -> after and a score rollback', () => {
    const plays = [
      boothNorm({ id: '1', seq: 1, text: '#22 E.Smith rush for 2 yards', awayScore: 0, homeScore: 0 }),
      boothNorm({ id: '2', seq: 2, text: '#22 E.Smith rush for 40 yards TOUCHDOWN', scoringPlay: true, type: { text: 'Rushing Touchdown' }, awayScore: 7, homeScore: 0, start: { yardsToEndzone: 10, downDistanceText: '2nd & Goal at MIZ 10', possessionText: 'MIZ 10', yardLine: 10, team: { id: '245' } } }),
      boothNorm({ id: '3', seq: 3, text: 'PENALTY Mizzou Holding (#45 C.Weselman) 10 yards from Mizzou10 to Mizzou20 - No Play', isPenalty: true, type: { text: 'Penalty' }, awayScore: 0, homeScore: 0, start: { yardsToEndzone: 10, downDistanceText: '2nd & Goal at MIZ 10', possessionText: 'MIZ 10', yardLine: 10, team: { id: '245' } } })
    ];
    const effect = NB.boothScoreEffect(plays, 2); // the wiping penalty
    assert.deepStrictEqual(effect.before, { away: 7, home: 0 });
    assert.deepStrictEqual(effect.during, { away: 0, home: 0 });
    assert.deepStrictEqual(effect.after, { away: 0, home: 0 });
    assert.strictEqual(effect.removesPoints, true);
    assert.strictEqual(effect.pointsRemoved, 7);
    assert.strictEqual(effect.team, 'away');
  });

  test('boothEvents produces a nullified red-zone score with the score trail', () => {
    const plays = [
      boothNorm({ id: '1', seq: 1, text: '#22 E.Smith rush for 2 yards', awayScore: 0, homeScore: 0 }),
      boothNorm({ id: '2', seq: 2, text: '#22 E.Smith rush for 40 yards TOUCHDOWN', scoringPlay: true, type: { text: 'Rushing Touchdown' }, awayScore: 7, homeScore: 0, start: { yardsToEndzone: 10, downDistanceText: '2nd & Goal at MIZ 10', possessionText: 'MIZ 10', yardLine: 10, team: { id: '245' } } }),
      boothNorm({ id: '3', seq: 3, text: 'PENALTY Mizzou Holding (#45 C.Weselman) 10 yards from Mizzou10 to Mizzou20 - No Play', isPenalty: true, type: { text: 'Penalty' }, awayScore: 0, homeScore: 0, start: { yardsToEndzone: 10, downDistanceText: '2nd & Goal at MIZ 10', possessionText: 'MIZ 10', yardLine: 10, team: { id: '245' } } })
    ];
    const events = NB.boothEvents(plays, null, teamMap);
    assert.strictEqual(events.length, 1);
    const e = events[0];
    assert.strictEqual(e.kind, 'penalty');
    assert.strictEqual(e.nullified, true);
    assert.strictEqual(e.removesPoints, true);
    assert.strictEqual(e.pointsRemoved, 7);
    assert.strictEqual(e.redZone, true); // started at MIZ 10 (<= 20)
    assert.strictEqual(e.beforeAwayScore, 7);
    assert.strictEqual(e.duringAwayScore, 0);
    assert.strictEqual(e.afterAwayScore, 0);
    assert.strictEqual(e.team.abbr, 'TA&M');
    assert.ok(e.relatedScoringPlay && /TOUCHDOWN/.test(e.relatedScoringPlay.text));
  });

  test('boothEvents ignores ordinary plays and marks a pending review', () => {
    const plays = [
      boothNorm({ id: '1', seq: 1, text: '#22 E.Smith rush for 2 yards', awayScore: 0, homeScore: 0 }),
      boothNorm({ id: '2', seq: 2, text: 'The play is under further review.', type: { text: 'Play' } })
    ];
    const events = NB.boothEvents(plays, null, teamMap);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].kind, 'review');
    assert.strictEqual(events[0].result, 'pending');
    assert.strictEqual(events[0].nullified, false);
  });

  test('boothEvents merges a live last-play replacement (under review -> overturned)', () => {
    const plays = [
      boothNorm({ id: '1', seq: 1, text: 'The play is under further review.', type: { text: 'Play' } })
    ];
    const live = boothNorm({ id: '1', seq: 1, text: 'After further review, the ruling is overturned. Therefore, no touchdown.', type: { text: 'Replay Review' } });
    const events = NB.boothEvents(plays, live, teamMap);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].result, 'overturned');
  });

  test('dayBoothFeed merges the day feed, first occurrence wins, no invented ids', () => {
    const g1 = { id: 'g1', shortName: 'TA&M @ MIZ', awayAbbr: 'TA&M', homeAbbr: 'MIZ', date: null, live: true, events: [
      { id: 'p1', seq: 1, kind: 'penalty', text: 'PENALTY ...' },
      { id: 'p2', seq: 2, kind: 'review', text: 'under review' }
    ] };
    const g2 = { id: 'g2', shortName: 'ORE @ IU', awayAbbr: 'ORE', homeAbbr: 'IU', date: null, live: true, events: [
      { id: 'q1', seq: 1, kind: 'penalty', text: 'PENALTY ...' }
    ] };
    const feed = NB.dayBoothFeed([g1, g2]);
    assert.strictEqual(feed.length, 3);
    assert.strictEqual(feed[0].gameId, 'g1');
    assert.strictEqual(feed[1].gameId, 'g1');
    assert.strictEqual(feed[2].gameId, 'g2');
    // Exactly the same play passed twice is kept once.
    const dup = NB.dayBoothFeed([g1, g1]);
    assert.strictEqual(dup.length, 2);
  });

  test('reconcileDayBoothFeed preserves discovery order and replaces updated plays', () => {
    const existing = [ { key: 'g1:p1', text: 'under review' }, { key: 'g1:p2', text: 'flag' } ];
    const fresh = [
      { key: 'g1:p1', text: 'overturned' },   // updated in place
      { key: 'g1:p3', text: 'new' }            // genuinely new
    ];
    const merged = NB.reconcileDayBoothFeed(existing, fresh);
    assert.strictEqual(merged.length, 3);
    assert.strictEqual(merged[0].text, 'overturned');
    assert.strictEqual(merged[1].text, 'flag');
    assert.strictEqual(merged[2].text, 'new');
  });

  console.log('--- server ---');
  const port = 8137;
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });

  try {
    await atest('server starts and serves /healthz', async () => {
      await waitForPort(base + '/healthz', 5000);
      const res = await fetch(base + '/healthz');
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.ok, true);
    });
    await atest('serves index.html at /', async () => {
      const res = await fetch(base + '/');
      assert.strictEqual(res.status, 200);
      assert.ok((res.headers.get('content-type') || '').indexOf('text/html') !== -1);
      const html = await res.text();
      assert.ok(html.indexOf('NCAA Football Scoreboard') !== -1);
      assert.ok(html.indexOf('app.js') !== -1);
      assert.ok(html.indexOf('styles.css') !== -1);
    });
    await atest('serves app.js and styles.css', async () => {
      const js = await (await fetch(base + '/app.js')).text();
      assert.ok(js.indexOf('CONFERENCES') !== -1);
      assert.ok(js.indexOf('/api/espn?url=') !== -1);
      assert.ok(js.indexOf('site.web.api.espn.com') !== -1);
      assert.ok(js.indexOf('sdataprod.ncaa.com') !== -1);
      assert.ok((await (await fetch(base + '/styles.css')).text()).indexOf('.game-row') !== -1);
    });
    await atest('same-origin provider relay rejects arbitrary targets', async () => {
      const target = encodeURIComponent('https://example.com/not-espn');
      const res = await fetch(base + '/api/espn?url=' + target);
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.ok(body.error);
    });
    await atest('same-origin provider relay rejects credentials and alternate ports', async () => {
      const credentialed = encodeURIComponent('https://user:pass@site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260829');
      const alternatePort = encodeURIComponent('https://site.api.espn.com:444/apis/site/v2/sports/football/college-football/scoreboard?dates=20260829');
      assert.strictEqual((await fetch(base + '/api/espn?url=' + credentialed)).status, 400);
      assert.strictEqual((await fetch(base + '/api/espn?url=' + alternatePort)).status, 400);
    });
    await atest('relay allowlists the verified ESPN Core API plays path', async () => {
      // The upstream is unreachable from the offline test runner, so a
      // successful allowlist match surfaces as a 502 relay error — anything
      // but the 400 the relay returns for a rejected target.
      const core = encodeURIComponent('https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/401769074/competitions/401769074/plays?limit=400&page=2');
      const res = await fetch(base + '/api/espn?url=' + core);
      assert.notStrictEqual(res.status, 400);
      assert.strictEqual(res.status, 502);
    });
    await atest('relay rejects Core API paths outside the plays collection and non-numeric ids', async () => {
      const item = encodeURIComponent('https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/401769074/competitions/401769074/plays/123');
      const seasons = encodeURIComponent('https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2025/teams/84');
      const badId = encodeURIComponent('https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/abc/competitions/abc/plays');
      assert.strictEqual((await fetch(base + '/api/espn?url=' + item)).status, 400);
      assert.strictEqual((await fetch(base + '/api/espn?url=' + seasons)).status, 400);
      assert.strictEqual((await fetch(base + '/api/espn?url=' + badId)).status, 400);
    });
    await atest('404 for unknown paths, no file escape via traversal', async () => {
      assert.strictEqual((await fetch(base + '/nope.js')).status, 404);
      // Encoded so the URL client keeps the dots intact; server must refuse
      // anything that escapes the app root.
      const st = (await fetch(base + '/..%2f..%2fetc%2fpasswd')).status;
      assert.ok(st >= 400, 'expected 4xx/5xx, got ' + st);
    });
  } finally {
    child.kill('SIGKILL');
  }

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
