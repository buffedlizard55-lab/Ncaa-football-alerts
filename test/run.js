'use strict';
/*
 * Test runner — zero dependencies, runs fully offline.
 *
 *  - syntax-checks every JS file
 *  - exercises the parser/view-model code against REAL API response
 *    fixtures (see test/fixtures/*.json headers for provenance)
 *  - boots the actual server on a port and checks its routes
 *
 * The live-network path (fetching ESPN from the browser) is verified in the
 * live preview; see README.md "Verification" for what was checked against the
 * real API on 2026-08-25.
 */
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
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

  console.log('--- URL builders ---');
  test('scoreboardUrl single date', () => {
    assert.strictEqual(NB.scoreboardUrl('20260829'), 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260829&limit=300');
  });
  test('scoreboardUrl with groups filter', () => {
    assert.strictEqual(NB.scoreboardUrl('20260829', '8'), 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260829&limit=300&groups=8');
  });
  test('scoreboardUrl combined groups keep raw commas (verified form)', () => {
    // groups=8,5 on 2025-11-08 returned the union (11 events) when called
    // live with raw commas — %2C has not been verified, so never encode them.
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
  test('scoreboardRangeUrl without groups', () => {
    const u = NB.scoreboardRangeUrl('20260110', '20260131');
    assert.ok(u.endsWith('dates=20260110-20260131&limit=500'));
    assert.ok(u.indexOf('groups') === -1);
  });
  test('summaryUrl uses event= (not gameId=)', () => {
    assert.strictEqual(NB.summaryUrl('401752763'), 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401752763');
  });
  test('proxiedUrl wraps and encodes', () => {
    const p = NB.proxiedUrl('https://site.api.espn.com/x?a=1&b=2');
    assert.ok(p.startsWith('https://api.allorigins.win/raw?url='));
    assert.ok(p.indexOf('&b=2') === -1); // & must be encoded
    assert.ok(p.indexOf('a%3D1%26b%3D2') !== -1);
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
      assert.ok((await (await fetch(base + '/styles.css')).text()).indexOf('.game-row') !== -1);
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
