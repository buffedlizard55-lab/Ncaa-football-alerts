'use strict';
/*
 * Offline starvation harness — NOT part of `npm test`.
 *
 * It executes the REAL browser half of app.js (same code the page runs) inside
 * a stubbed browser: virtual clock, virtual timers, a DOM surface limited to
 * exactly what app.js touches, and a fetch shim that enforces the documented
 * browser connection-pool limit (6 sockets per host, FIFO queue). The
 * "providers" are local simulators that reuse the shapes verified in
 * test/fixtures/*.json, scaled to a full live Saturday slate (30 live + 9
 * final games on 2026-08-29), with realistic payload sizes (the summary is
 * hundreds of KB — see README), latency, and a configurable upstream rate
 * limiter (HTTP 429) plus the keyless Jina Reader budget (20 requests/min,
 * https://github.com/jina-ai/reader; also documented in the README).
 *
 * The rate limits are simulation POLICY chosen to reproduce the class of
 * behaviour the README already recorded (ESPN throttling under fan-out,
 * Reader RPM cap, broken public proxies). They are not vendor promises.
 *
 * Usage:
 *   node test/perf-harness.js [path-to-app.js] [--minutes=10] [--json-out=file]
 *
 * Metrics printed: scoreboard first paint, day-switch paint latency, upstream
 * request counts per host, 429 counts, relay queue peak, booth feed events.
 */

// Keep this file out of `npm test`'s process: it monkey-patches globals.
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const argv = process.argv.slice(2);
const APP = path.resolve(argv[0] || path.join(__dirname, '..', 'app.js'));
const MINUTES = Number((argv.find(a => a.startsWith('--minutes=')) || '').split('=')[1] || 10);
const JSON_OUT = (argv.find(a => a.startsWith('--json-out=')) || '').split('=')[1] || '';

// ---------------- configuration of the simulated environment ----------------
const LIVE_AT_KICKOFF_PLUS = 135 * 60 * 1000; // minutes after scheduled start the sim begins
const DAY = '20260829';
const PREV_DAY = '20260828';
const NEXT_DAY = '20260830';
const V_START = Date.parse('2026-08-29T17:00:00Z'); // 13:00 EDT — live afternoon
const SLOTS_PER_HOST = 6;              // Chromium HTTP/1.1 documented limit
const UPSTREAM_LIMIT_PER_SEC = 4;      // token-bucket refill per second (POLICY)
const UPSTREAM_BURST = 40;             // bucket size (POLICY)
const UPSTREAM_PENALTY_MS = 10000;     // sustained flood -> 429 for 10 s
const RELAY_LATENCY = 30;              // browser -> local node relay
const UP_LATENCY_MIN = 90, UP_LATENCY_SPREAD = 220; // relay -> ESPN (sim)
const SUMMARY_KB = 380;                // approx verified live size class
const DAY_KB = 300;
const HEADERS_KB = 42;
const CORE_MS = 160;

// ---------------- virtual clock & timers ----------------
let vnow = V_START;
const RealDate = Date;
let timers = [];
let nextTimerId = 1;
function schedule(fn, ms, repeatMs) {
  const t = { id: nextTimerId++, time: vnow + Math.max(0, ms | 0), fn, repeatMs: repeatMs || 0 };
  timers.push(t);
  timers.sort((a, b) => a.time - b.time || a.id - b.id);
  return t.id;
}
function cancelTimer(id) { timers = timers.filter(t => { if (t.id === id) { t.cancelled = true; return false; } return true; }); }
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(vnow); else super(...a); }
  static now() { return vnow; }
  static parse(s) { return RealDate.parse(s); }
  static UTC(...a) { return RealDate.UTC(...a); }
}
globalThis.Date = FakeDate;
globalThis.setTimeout = (fn, ms = 0) => schedule(fn, ms, 0);
globalThis.setInterval = (fn, ms = 0) => schedule(fn, ms, Math.max(1, ms | 0));
globalThis.clearTimeout = cancelTimer;
globalThis.clearInterval = cancelTimer;
function afterVirtual(ms) { return new Promise(res => schedule(res, ms, 0)); }

// ---------------- metrics ----------------
const M = {
  byHost: {},            // host -> {requests, queuePeak, rejected429, aborted, bytesUp}
  relayConcurrentPeak: 0,
  firstScoreboardPaintMs: null,
  paints: [],            // {t, kind: 'day'|'refresh', day}
  daySwitch: null,       // {clickedAt, paintedAt} for the scripted day switch
  readerBudgetUsed: 0,
  readerRejected: 0,
  uncaught: [],
  boothFeedFinal: 0,
  boothGamesFinal: 0,
  dayRequestsTotal: 0,
  summaryRequestsTotal: 0,
  headerRequestsTotal: 0,
  coreRequestsTotal: 0,
  ncaaRequestsTotal: 0,
  proxyRequestsTotal: 0,
  clockEnd: null,
  maxQueueDepthByHost: {}
};
function hostStat(host) {
  if (!M.byHost[host]) M.byHost[host] = { requests: 0, rejected429: 0, aborted: 0, bytesUp: 0 };
  return M.byHost[host];
}

// ---------------- rate limiter per upstream host ----------------
const upHostState = new Map(); // host -> {window:[ts], penaltyUntil}
function upAllow(host) {
  // Token bucket: refills UPSTREAM_LIMIT_PER_SEC/s up to a burst allowance.
  // Bursty-but-moderate traffic (a scoreboard's own fan-out) is tolerated, the
  // way a CDN edge is; a sustained flood trips the penalty. Policy, not vendor
  // spec — chosen so the flood/fix contrast is driven by app behaviour.
  const st = upHostState.get(host) || { tokens: UPSTREAM_BURST, last: vnow, penaltyUntil: 0 };
  upHostState.set(host, st);
  if (vnow < st.penaltyUntil) return false;
  st.tokens = Math.min(UPSTREAM_BURST, st.tokens + (vnow - st.last) / 1000 * UPSTREAM_LIMIT_PER_SEC);
  st.last = vnow;
  if (st.tokens < 1) {
    st.penaltyUntil = vnow + UPSTREAM_PENALTY_MS;
    return false;
  }
  st.tokens -= 1;
  return true;
}

// ---------------- provider content (fixture-shaped) ----------------
const fixtureEvent = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scoreboard-event.json'), 'utf8'));
delete fixtureEvent._fixture_note;
const TEAMS = []; // [id, abbrev, displayName, location, name, color, conferenceId]
[
  ['150', 'FSU', 'Florida State Seminoles', 'Florida State', 'Seminoles', 'ceeb21', '1'],
  ['103', 'AUB', 'Auburn Tigers', 'Auburn', 'Tigers', '0c2340', '8'],
  ['2', 'WASH', 'Washington Huskies', 'Washington', 'Huskies', '4b2e83', '5'],
  ['275', 'UCLA', 'UCLA Bruins', 'UCLA', 'Bruins', '2d75bb', '5'],
  ['15', 'UK', 'Kentucky Wildcats', 'Kentucky', 'Wildcats', '0033a0', '8'],
  ['236', 'VAN', 'Vanderbilt Commodores', 'Vanderbilt', 'Commodores', '866759', '8'],
  ['158', 'NEB', 'Nebraska Cornhuskers', 'Nebraska', 'Cornhuskers', 'f1f1f1', '5'],
  ['219', 'PSU', 'Penn State Nittany Lions', 'Penn State', 'Nittany Lions', '0c2340', '5'],
  ['201', 'OKLA', 'Oklahoma Sooners', 'Oklahoma', 'Sooners', '84161f', '4'],
  ['264', 'TEX', 'Texas Longhorns', 'Texas', 'Longhorns', 'bf5730', '8'],
  ['142', 'MIZ', 'Missouri Tigers', 'Missouri', 'Tigers', 'f1b82d', '8'],
  ['245', 'TA&M', 'Texas A&M Aggies', 'Texas A&M', 'Aggies', '500056', '8'],
  ['2628', 'TCU', 'TCU Horned Frogs', 'TCU', 'Horned Frogs', '4d1979', '4'],
  ['153', 'UNC', 'North Carolina Tar Heels', 'North Carolina', 'Tar Heels', '7bafd4', '1'],
  ['30', 'USC', 'USC Trojans', 'USC', 'Trojans', '990033', '5'],
  ['23', 'SJSU', 'San José State Spartans', 'San José State', 'Spartans', '0038a8', '151'],
  ['2483', 'IND', 'Indiana Hoosiers', 'Indiana', 'Hoosiers', '990033', '5'],
  ['84', 'ORE', 'Oregon Ducks', 'Oregon', 'Ducks', 'fce122', '5'],
  ['2294', 'HOUST', 'Houston Cougars', 'Houston', 'Cougars', 'c8102e', '151'],
  ['20053', 'NAVY', 'Navy Midshipmen', 'Navy', 'Midshipmen', '00205b', '151'],
  ['110', 'GT', 'Georgia Tech Yellow Jackets', 'Georgia Tech', 'Yellow Jackets', 'ae3324', '1'],
  ['93', 'CLEM', 'Clemson Tigers', 'Clemson', 'Tigers', 'f56600', '1'],
  ['152', 'LOU', 'Louisville Cardinals', 'Louisville', 'Cardinals', 'ad0001', '1'],
  ['238', 'SYR', 'Syracuse Orange', 'Syracuse', 'Orange', 'd44500', '1'],
  ['230', 'UCF', 'UCF Knights', 'UCF', 'Knights', 'baa21e', '151'],
  ['2413', 'MEM', 'Memphis Tigers', 'Memphis', 'Tigers', '003087', '151'],
  ['66', 'ISU', 'Iowa State Cyclones', 'Iowa State', 'Cyclones', 'c8102e', '4'],
  ['248', 'CIN', 'Cincinnati Bearcats', 'Cincinnati', 'Bearcats', 'e00336', '151'],
  ['96', 'NE', 'Kansas State Wildcats', 'Kansas State', 'Wildcats', '51288a', '4'],
  ['235', 'TENN', 'Tennessee Volunteers', 'Tennessee', 'Volunteers', 'ff8200', '8'],
  ['257', 'VAN2', 'Vanderbilt', 'Vanderbilt2', 'Second', '866759', '8'],
  ['251', 'WAKE', 'Wake Forest Demon Deacons', 'Wake Forest', 'Demon Deacons', 'a67e3c', '1'],
  ['104', 'BAY', 'Baylor Bears', 'Baylor', 'Bears', '154734', '4'],
  ['259', 'TTU', 'Texas Tech Red Raiders', 'Texas Tech', 'Red Raiders', 'cc0000', '4'],
  ['32', 'MICH', 'Michigan Wolverines', 'Michigan', 'Wolverines', '00274c', '5'],
  ['261', 'OSU', 'Ohio State Buckeyes', 'Ohio State', 'Buckeyes', 'bb0000', '5'],
  ['2304', 'ILL', 'Illinois Fighting Illini', 'Illinois', 'Fighting Illini', 'e84a27', '5'],
  ['2294', 'SMU', 'SMU Mustangs', 'SMU', 'Mustangs', 'd23c4a', '151'],
  ['252', 'BYU', 'BYU Cougars', 'BYU', 'Cougars', '002e5d', '4'],
  ['229', 'PUR', 'Purdue Boilermakers', 'Purdue', 'Boilermakers', 'c29100', '5']
].forEach(t => TEAMS.push(t));

function teamObj(t, id, abbr, name, loc, color, confId) {
  return {
    id: Number(id), uid: `s:20~l:23~t:${id}`, location: loc, name: name, abbreviation: abbr,
    displayName: `${loc} ${name}`, shortDisplayName: loc, color, alternateColor: '000000', isActive: true,
    logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`, conferenceId: String(confId),
    links: []
  };
}
function competitorFor(t, homeAway, score, winner, lines) {
  return {
    id: Number(t[0]), uid: `s:20~l:23~t:${t[0]}`, type: 'team', order: homeAway === 'home' ? 0 : 1,
    homeAway, winner: !!winner, team: teamObj(null, t[0], t[1], t[4], t[3], t[5], t[6]),
    score: String(score), curatedRank: { current: 99 }, statistics: [],
    linescores: lines.map((v, i) => ({ value: v, displayValue: String(v), period: i + 1 })),
    records: [{ name: 'overall', abbreviation: 'overall', type: 'total', summary: '1-0' }]
  };
}

const GAMES = []; // 39 games: 0..29 live, 30..38 final
for (let i = 0; i < 39; i++) {
  const aw = TEAMS[(i * 2) % TEAMS.length];
  const hm = TEAMS[(i * 2 + 1) % TEAMS.length];
  const live = i < 30;
  const aScore = live ? (i % 3) * 7 + 3 : 24 + (i % 4) * 3;
  const hScore = live ? (i % 5) * 7 : 31 + (i % 3) * 3;
  GAMES.push({
    id: String(900000001 + i), aw, hm, live, aScore, hScore,
    conf: String(i % 2 === 0 ? aw[6] : hm[6]),
    date: `2026-08-29T${live ? '16' : '19'}:0${i % 6}Z`
  });
}
function dayEventsPayload(dateStr, onlyLive) {
  const list = GAMES.filter(g => dateStr === DAY ? true : false);
  if (dateStr !== DAY) return [];
  return list.map(g => {
    const ev = JSON.parse(JSON.stringify(fixtureEvent));
    ev.id = g.id; ev.uid = `s:20~l:23~e:${g.id}`; ev.date = g.date;
    ev.name = `${g.aw[3]} at ${g.hm[3]}`; ev.shortName = `${g.aw[1]} @ ${g.hm[1]}`;
    const comp = ev.competitions[0];
    comp.id = g.id; comp.uid = `s:20~l:23~e:${g.id}~c:${g.id}`; comp.date = g.date;
    comp.playByPlayAvailable = true;
    comp.groups = { id: Number(g.conf), name: 'Conference', shortName: 'CONF' };
    const awayLines = [Math.floor(g.aScore / 4), 0, 0, 0].map((v, i) => Math.min(v + (i === 0 ? 0 : 0), g.aScore));
    const homeLines = [Math.floor(g.hScore / 4), 0, 0, 0].map(v => Math.min(v, g.hScore));
    awayLines[3] = g.aScore - awayLines[0] - awayLines[1] - awayLines[2];
    homeLines[3] = g.hScore - homeLines[0] - homeLines[1] - homeLines[2];
    comp.competitors = [competitorFor(g.aw, 'away', g.aScore, false, awayLines), competitorFor(g.hm, 'home', g.hScore, !g.live && g.hScore > g.aScore, homeLines)];
    if (g.live) {
      comp.status = {
        type: { id: '2', name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, description: 'In Progress', detail: '2nd 6:31', shortDetail: '2nd 6:31' },
        displayClock: '6:31', period: 2, clock: 391
      };
    } else {
      comp.status = {
        type: { id: '3', name: 'STATUS_FINAL', state: 'post', completed: true, description: 'Final', detail: 'Final', shortDetail: 'Final' },
        displayClock: '0:00', period: 4, clock: 0
      };
    }
    return ev;
  });
}
// Prev/next day tiny slates so findNearby terminates without probing NCAA for
// every date in the window.
const PREV_EVENTS = [0, 1].map(i => {
  const ev = JSON.parse(JSON.stringify(fixtureEvent));
  const g = { aw: TEAMS[2 + i], hm: TEAMS[3 + i], aScore: 21, hScore: 17 };
  ev.id = String(800000001 + i); ev.date = '2026-08-28T16:00Z'; ev.name = `${g.aw[3]} at ${g.hm[3]}`;
  const comp = ev.competitions[0];
  comp.id = ev.id; comp.date = ev.date;
  comp.competitors = [competitorFor(g.aw, 'away', 21, true, [7, 7, 0, 7]), competitorFor(g.hm, 'home', 17, false, [3, 7, 0, 7])];
  comp.status = { type: { id: '3', name: 'STATUS_FINAL', state: 'post', completed: true, description: 'Final', detail: 'Final', shortDetail: 'Final' }, displayClock: '0:00', period: 4, clock: 0 };
  return ev;
});
const NEXT_EVENTS = [0, 1, 2].map(i => {
  const ev = JSON.parse(JSON.stringify(fixtureEvent));
  const g = { aw: TEAMS[6 + i], hm: TEAMS[7 + i], aScore: 0, hScore: 0 };
  ev.id = String(700000001 + i); ev.date = '2026-08-30T16:00Z'; ev.name = `${g.aw[3]} at ${g.hm[3]}`;
  const comp = ev.competitions[0];
  comp.id = ev.id; comp.date = ev.date;
  comp.competitors = [competitorFor(g.aw, 'away', 0, false, [0, 0, 0, 0]), competitorFor(g.hm, 'home', 0, false, [0, 0, 0, 0])];
  comp.status = { type: { id: '1', name: 'STATUS_SCHEDULED', state: 'pre', completed: false, description: 'Scheduled', detail: 'Sun, August 30th', shortDetail: '8/30' }, displayClock: '0:00', period: 0, clock: 0 };
  return ev;
});

// ---- summaries: big, play-bearing, with review + nullified-score rows ----
function buildSummary(g) {
  const plays = [];
  let seq = 0, a = 0, h = 0;
  const push = (obj) => { seq++; plays.push(Object.assign({ id: `${g.id}-${seq}`, sequenceNumber: String(seq), period: { number: 2 }, clock: { value: 420 - seq * 2, displayValue: '7:00' }, awayScore: a, homeScore: h, scoringPlay: false, isPenalty: false, isTurnover: false, priority: false, scoreValue: 0, type: { id: '51', text: 'Rushing', abbreviation: 'RUSH' }, teamParticipants: [{ team: { id: Number(g.hm[0]) }, id: String(g.hm[0]), order: 1, type: 'offense' }, { team: { id: Number(g.aw[0]) }, id: String(g.aw[0]), order: 2, type: 'defense' }], start: { down: 1, distance: 10, yardLine: 45, yardsToEndzone: 55, downDistanceText: '1st & 10', possessionText: 'MID 45', team: { id: Number(g.hm[0]) } }, end: { down: 2, distance: 8, yardLine: 47, yardsToEndzone: 53, downDistanceText: '2nd & 8 at MID 47', possessionText: 'MID 47', team: { id: Number(g.hm[0]) } }, wallclock: '2026-08-29T17:05:00Z' }, obj)); };
  for (let i = 0; i < 8; i++) push({ text: `#${10 + i} R.Harrison rush for ${3 + (i % 5)} yards` });
  // TD that gets nullified by a flag on the play — the booth's core case.
  a += 0; h += 7;
  push({ text: `#${21} J.Moore rush for 40 yards TOUCHDOWN`, scoringPlay: true, type: { id: '43', text: 'Rushing Touchdown', abbreviation: 'TD' }, start: { down: 2, distance: 3, yardLine: 60, yardsToEndzone: 20, downDistanceText: '2nd & Goal at OPP 20', possessionText: 'OPP 20', team: { id: Number(g.hm[0]) } }, end: { down: 0, distance: 0, yardLine: 0, yardsToEndzone: 0, downDistanceText: '', possessionText: '', team: { id: Number(g.hm[0]) } }, awayScore: a, homeScore: h, scoreValue: 6 });
  push({ text: 'The play is under review.', type: { id: '90', text: 'Timeout', abbreviation: 'TO' } });
  h -= 7;
  push({ text: 'After further review, the ruling on the field is overturned. The play is nullified. #21 J.Moore is called for holding on the play.', type: { id: '98', text: 'Play Overturned', abbreviation: 'OVR' }, awayScore: a, homeScore: h });
  push({ text: `PENALTY ${g.hm[3]} Holding (#61 T.Baker) 10 yards from ${g.hm[1]}14 to ${g.hm[1]}04`, isPenalty: true, type: { id: '97', text: 'Penalty', abbreviation: 'PEN' }, penalty: { yards: 10, type: { text: 'Holding' } }, awayScore: a, homeScore: h });
  // A trailing-phrase flag on a kickoff — the other verified booth case.
  push({ text: `#${99} K.Boyd kickoff 65 yards to the ${g.aw[1]}00 #11 D.Fowlkes return 33 yards to the ${g.aw[1]}33, End Of Play PENALTY ${g.aw[3]} Holding (#45 C.Weselman) 7 yards from ${g.aw[1]}14 to ${g.aw[1]}07`, isPenalty: false });
  for (let i = 0; i < 6; i++) push({ text: `#${20 + i} D.Smith pass complete to #7 L.Jones for ${5 + i * 3} yards` });
  // padding to realistic payload size
  const target = SUMMARY_KB * 1024;
  const base = {
    boxscore: { teams: [{ team: teamObj(null, g.aw[0], g.aw[1], g.aw[4], g.aw[3], g.aw[5], g.aw[6]), statistics: [] }, { team: teamObj(null, g.hm[0], g.hm[1], g.hm[4], g.hm[3], g.hm[5], g.hm[6]), statistics: [] }] },
    header: {
      id: g.id, name: `${g.aw[3]} at ${g.hm[3]}`, shortName: `${g.aw[1]} @ ${g.hm[1]}`,
      competitions: [{ id: g.id, date: g.date, venue: { fullName: 'Sim Stadium', address: { city: 'Simulation City', state: 'SC' } }, competitors: [competitorFor(g.aw, 'away', g.aScore, false, [0, 0, 0, 0]), competitorFor(g.hm, 'home', g.hScore, false, [0, 0, 0, 0])] }],
      season: { year: 2026 }
    },
    drives: [{ id: `${g.id}1`, team: { id: Number(g.hm[0]), abbreviation: g.hm[1] }, start: {}, end: {}, plays }],
    roster: [], articles: [], vegas: null, winInformation: null,
    padding: 'x'.repeat(Math.max(0, target - 20000))
  };
  return base;
}
const SUMMARY_CACHE = new Map();
function summaryFor(id) {
  if (!SUMMARY_CACHE.has(id)) {
    const g = GAMES.find(x => x.id === String(id));
    if (!g) return null;
    SUMMARY_CACHE.set(id, JSON.stringify(buildSummary(g)));
  }
  return SUMMARY_CACHE.get(id);
}

function headerPayload() {
  return JSON.stringify({
    sports: [{ id: '20', name: 'Football', leagues: [{ id: '23', name: 'NCAA - Football', slug: 'college-football', events: GAMES.map(g => ({
      id: g.id, competitionId: g.id, date: g.date,
      status: g.live ? 'in' : 'final',
      fullStatus: { clock: g.live ? 391 : 0, displayClock: g.live ? '6:31' : '0:00', period: 2, type: { id: g.live ? '2' : '3', name: g.live ? 'STATUS_IN_PROGRESS' : 'STATUS_FINAL', state: g.live ? 'in' : 'post', completed: !g.live, description: g.live ? 'In Progress' : 'Final', detail: '', shortDetail: '' } },
      competitors: [{ id: Number(g.aw[0]), homeAway: 'away', score: String(g.aScore), winner: false }, { id: Number(g.hm[0]), homeAway: 'home', score: String(g.hScore), winner: g.live ? false : g.hScore > g.aScore }],
      situation: g.live ? { lastPlay: { id: `${g.id}-live`, sequenceNumber: '900', text: `#${22} L.Bell rush for 6 yards`, type: { id: '51', text: 'Rushing', abbreviation: 'RUSH' }, period: { number: 2 }, clock: { displayValue: '6:28' }, awayScore: g.aScore, homeScore: g.hScore, isPenalty: false, teamParticipants: [{ team: { id: Number(g.hm[0]) }, id: String(g.hm[0]), type: 'offense' }] } } : undefined
    })) }] }]
  });
}

function corePlaysPayload(id) {
  const g = GAMES.find(x => x.id === String(id));
  const plays = g ? buildSummary(g).drives[0].plays : [];
  return JSON.stringify({ count: plays.length, pageIndex: 1, pageSize: 400, pageCount: 1, items: plays });
}

function scoreboardPayload(dates) {
  if (/\d{8}-\d{8}/.test(dates)) {
    const [from, to] = dates.split('-');
    const events = [];
    if (from <= PREV_DAY && PREV_DAY <= to) events.push(...PREV_EVENTS);
    if (from <= DAY && DAY <= to) events.push(...dayEventsPayload(DAY));
    if (from <= NEXT_DAY && NEXT_DAY <= to) events.push(...NEXT_EVENTS);
    return JSON.stringify({ leagues: [{ id: '23', name: 'NCAA - Football', season: { year: 2026, type: { name: 'Regular Season' } }, calendar: [] }], events });
  }
  let events = [];
  if (dates === DAY) events = dayEventsPayload(DAY);
  else if (dates === PREV_DAY) events = PREV_EVENTS;
  else if (dates === NEXT_DAY) events = NEXT_EVENTS;
  return JSON.stringify({
    leagues: [{ id: '23', name: 'NCAA - Football', season: { year: 2026, type: { name: 'Regular Season' } }, calendar: [{ label: 'Regular Season', startDate: '2026-08-22T07:00Z', endDate: '2026-12-13T07:59Z', entries: [{ label: 'Week 1', startDate: '2026-08-22T07:00Z', endDate: '2026-09-08T06:59Z' }] }] }],
    events
  });
}

function ncaaPayload() { return JSON.stringify({ data: { contests: [] } }); }

// ---------------- the simulated upstream ----------------
async function serveProvider(url) {
  const u = new URL(url);
  const host = u.hostname;
  const st = hostStat(host);
  st.requests++;
  if (!upAllow(host)) { st.rejected429++; await afterVirtual(40); return { status: 429, body: 'Too Many Requests' }; }
  let body, status = 200;
  const p = u.pathname;
  const simLatency = UP_LATENCY_MIN + (st.requests % 7) * (UP_LATENCY_SPREAD / 7);
  if (p === '/apis/espn-relay-miss') { status = 400; body = '{}'; }
  else if (p === '/apis/site/v2/sports/football/college-football/scoreboard') {
    M.dayRequestsTotal++;
    const dk = 'dates=' + (u.searchParams.get('dates') || '?') + (u.searchParams.get('groups') ? ' g' + u.searchParams.get('groups') : '');
    M.dayByKind = M.dayByKind || {};
    M.dayByKind[dk] = (M.dayByKind[dk] || 0) + 1;
    body = scoreboardPayload(u.searchParams.get('dates') || DAY);
  } else if (p === '/apis/site/v2/sports/football/college-football/summary') {
    M.summaryRequestsTotal++;
    const ev = u.searchParams.get('event');
    const s = summaryFor(ev);
    if (!s) { status = 404; body = 'not found'; } else body = s;
  } else if (p === '/apis/v2/scoreboard/header') {
    M.headerRequestsTotal++;
    body = headerPayload();
  } else if (/^\/v2\/sports\/football\/leagues\/college-football\/events\/\d+\/competitions\/\d+\/plays$/.test(p)) {
    M.coreRequestsTotal++;
    const m = p.match(/events\/(\d+)\//);
    body = corePlaysPayload(m && m[1]);
  } else if (host === 'sdataprod.ncaa.com') { M.ncaaRequestsTotal++; body = ncaaPayload(); }
  else if (host === 'ncaa-api.henrygd.me') { M.ncaaRequestsTotal++; status = 502; body = 'bad gateway (pre-game secondary route behavior documented in README)'; }
  else { status = 500; body = 'public proxy failing (README-documented)'; M.proxyRequestsTotal++; }
  await afterVirtual(Math.max(status === 200 ? simLatency : 60, 20));
  st.bytesUp += (body || '').length;
  return { status, body };
}

async function serveReader(url) {
  const st = hostStat('r.jina.ai');
  st.requests++;
  M.readerBudgetWindow = (M.readerBudgetWindow || []);
  M.readerBudgetWindow = M.readerBudgetWindow.filter(t => t > vnow - 60000);
  if (M.readerBudgetWindow.length >= 20) { M.readerRejected++; st.rejected429++; return { status: 429, body: 'Rate limit exceeded (keyless 20 RPM)' }; }
  M.readerBudgetWindow.push(vnow);
  M.readerBudgetUsed++;
  // r.jina.ai/http://... -> the text is the provider body with a markdown prefix.
  const inner = url.replace(/^https?:\/\/r\.jina\.ai\/http:\/\//, 'http://');
  const real = await serveProvider(inner.replace(/^http:/, 'https:'));
  return { status: real.status === 200 ? 200 : real.status, body: real.status === 200 ? `Title: ESPN\n\nMarkdown Content:\n${real.body}` : real.body };
}

async function serveCorsProxy(url) {
  const u = new URL(url);
  const st = hostStat(u.hostname);
  st.requests++;
  await afterVirtual(180);
  st.rejected429++;
  return { status: 500, body: JSON.stringify({ error: 'upstream refused (README-documented proxy failures)' }) };
}

// ---------------- connection pool (6 sockets/host, FIFO) ----------------
const pools = new Map(); // origin -> {active, waiting[]}
function poolDispatch(origin, job) {
  const p = pools.get(origin) || { active: 0, waiting: [], peak: 0 };
  pools.set(origin, p);
  p.waiting.push(job);
  p.peak = Math.max(p.peak, p.waiting.length);
  M.maxQueueDepthByHost[origin] = Math.max(M.maxQueueDepthByHost[origin] || 0, p.waiting.length);
  while (p.active < SLOTS_PER_HOST && p.waiting.length) {
    const j = p.waiting.shift();
    p.active++;
    runJob(origin, p, j);
  }
}
function runJob(origin, p, j) {
  Promise.resolve().then(j.exec).then(v => j.done ? undefined : j.resolve(v), e => j.done ? undefined : j.reject(e)).finally(() => {
    if (p.active > M.relayConcurrentPeak) M.relayConcurrentPeak = p.active;
    p.active--;
    if (p.waiting.length) { const n = p.waiting.shift(); p.active++; runJob(origin, p, n); }
  });
}

let fetchCount = 0;
const DEBUG = process.env.HARNESS_DEBUG === '1';
globalThis.fetch = function (input, init) {
  fetchCount++;
  const raw = String(input);
  const signal = init && init.signal;
  const isRelay = raw.startsWith('/api/espn');
  const origin = isRelay ? 'http://localhost:8000' : new URL(raw).origin;
  let settled = false;
  let timerCancel = null;
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
    const job = {
      exec: () => {
        const enqueue = vnow;
        const started = vnow;
        M.maxQueueDepthByHost[origin + '#wait'] = Math.max(M.maxQueueDepthByHost[origin + '#wait'] || 0, started - enqueue);
        if (DEBUG) console.error('[fetch] exec', origin, raw.slice(0, 60), 't=', vnow);
        const work = (isRelay ? serveRelay(raw) : raw.includes('r.jina.ai') ? serveReader(raw) : /allorigins|corsproxy|codetabs/.test(raw) ? serveCorsProxy(raw) : serveProvider(raw))
          .then(({ status, body }) => {
            if (DEBUG) console.error('[fetch] provider-done', raw.slice(0, 40), 'status', status, 't=', vnow);
            if (status !== 200) return { ok: false, status, text: async () => body, json: async () => { const e = new Error('bad json'); throw e; } };
            return { ok: true, status, text: async () => body, json: async () => JSON.parse(body) };
          });
        return new Promise((res, rej) => {
          const onAbort = () => { hostStat('aborted').aborted++; rej(Object.assign(new Error('aborted by timeout'), { name: 'AbortError' })); };
          if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener ? signal.addEventListener('abort', onAbort, { once: true }) : (signal.onabort = onAbort); }
          work.then(v => { if (DEBUG) console.error('[fetch] resolving to app', raw.slice(0, 40), 't=', vnow); if (signal) { signal.removeEventListener && signal.removeEventListener('abort', onAbort); } res(v); }, e => { if (DEBUG) console.error('[fetch] rejecting', raw.slice(0, 40), String(e).slice(0,120), 't=', vnow); rej(e); });
        });
      },
      resolve: (v) => { if (!settled) { settled = true; resolve(v); } },
      reject: (e) => { if (!settled) { settled = true; reject(e); } }
    };
    poolDispatch(origin, job);
  });
};
async function serveRelay(raw) {
  const u = new URL(raw, 'http://localhost:8000');
  const target = u.searchParams.get('url');
  const st = hostStat('relay:localhost:8000');
  st.requests++;
  await afterVirtual(RELAY_LATENCY);
  return serveProvider(target);
}

// ---------------- DOM / window / location stubs ----------------
function makeEl(id) {
  const listeners = {};
  const el = {
    id, _html: '', innerHTML: '', textContent: '', hidden: false, value: '', checked: false,
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; },
    focus() {}, scrollTop: 0, scrollHeight: 100, clientHeight: 100,
    style: {},
    fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || { target: el, preventDefault() {} })); }
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = v; if (id === 'main') onMainPaint(v); } });
  return el;
}
const els = new Map();
const docListeners = {};
const hiddenState = { hidden: false };
globalThis.document = {
  getElementById(id) {
    if (id === 'main' || id === 'subbar' || id === 'liveBadge' || id === 'liveCount' || id === 'dateInput' || id === 'day-booth' || id === 'diagWrap' || id === 'diag' || id === 'prevDay' || id === 'nextDay' || id === 'todayBtn') {
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    }
    return null;
  },
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  removeEventListener() {},
  get hidden() { return hiddenState.hidden; },
  get visibilityState() { return hiddenState.hidden ? 'hidden' : 'visible'; },
  createElement() { return makeEl('anon'); }
};
function onMainPaint(html) {
  if (typeof html === 'string' && html.indexOf('grouplabel') !== -1) {
    M.paints.push({ t: vnow - V_START });
    if (M.firstScoreboardPaintMs === null) M.firstScoreboardPaintMs = vnow - V_START;
    if (M.daySwitch && M.daySwitch.paintedAt === null && M.paints.length >= M.daySwitch.paintsBefore + 1 && vnow >= M.daySwitch.clickedAt) {
      M.daySwitch.paintedAt = vnow;
    }
  }
}
const winListeners = {};
globalThis.window = {
  addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
  removeEventListener() {}, scrollTo() {}, AudioContext: undefined
};
let hash = '';
globalThis.location = {
  origin: 'http://localhost:8000', hostname: 'localhost', protocol: 'http:',
  get hash() { return hash; },
  set hash(v) {
    const next = v.startsWith('#') ? v : '#' + v;
    if (next === hash) return;
    hash = next;
    schedule(() => (winListeners['hashchange'] || []).forEach(fn => fn()), 0, 0);
  }
};
globalThis.localStorage = {
  _s: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
  setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; }
};
globalThis.AbortController = class {
  constructor() { this.signal = { aborted: false, listeners: [], addEventListener(t, f) { this.listeners.push(f); }, removeEventListener() {}, dispatch() {} }; }
  abort() { if (this.signal.aborted) return; this.signal.aborted = true; this.signal.listeners.forEach(f => f()); }
};
globalThis.requestAnimationFrame = fn => schedule(fn, 16, 0);
globalThis.self = globalThis;
process.on('unhandledRejection', (e) => { M.uncaught.push(String((e && e.stack) || e).split('\n')[0]); });

// ---------------- run ----------------
const t0 = Date.now();
require(APP); // executes the real browser half against the stubs above
const NB = globalThis.NCBS;
assert.ok(NB, 'app.js did not attach NCBS');

async function pump(untilVirtual) {
  const quiesce = () => new Promise(r => setImmediate(r)); // full microtask drain
  let guard = 0;
  while (guard++ < 5e6) {
    await quiesce();
    const t = timers.find(t2 => t2.time <= untilVirtual);
    if (!t) { vnow = Math.max(vnow, untilVirtual); break; } // idle jump
    timers.splice(timers.indexOf(t), 1);
    vnow = t.time;
    try { t.fn(); } catch (e) { M.uncaught.push('timer: ' + String((e && e.message) || e)); }
    // Re-arm the SAME job object so its id survives — clearInterval(oldId)
    // from the app must still find and cancel it (native setInterval keeps
    // its handle identity across repeats; a fresh-id re-arm leaks).
    if (t.repeatMs && !t.cancelled) {
      t.time = vnow + t.repeatMs;
      timers.push(t);
      timers.sort((a, b) => a.time - b.time || a.id - b.id);
    }
  }
}

async function run() {
  const endAt = V_START + MINUTES * 60 * 1000;
  // Let boot + first load settle, then a scripted day switch at ~+30 s.
  const step = 20;
  let switchedDay = false, backToDay = false, firstSwitchPaintedAt = null;
  while (vnow < endAt) {
    await pump(vnow + 1000 * step);
    if (DEBUG && NB.state) {
      console.error('[snap] t=' + (vnow - V_START) / 1000 + 's games=' + NB.state.games.length +
        ' src=' + NB.state.source + ' err=' + JSON.stringify(NB.state.error) +
        ' booth=' + (NB.state.booth.feed || []).length + ' pass=' + JSON.stringify(NB.state.booth.lastPass) +
        ' gate=' + JSON.stringify(NB.providerGate ? NB.providerGate.stats() : null));
    }
    if (!switchedDay && vnow - V_START >= 30000) {
      switchedDay = true;
      const before = M.paints.length;
      M.daySwitch = { clickedAt: vnow, paintsBefore: before, paintedAt: null };
      globalThis.location.hash = '#/' + NEXT_DAY; // user jumps to the next day
    }
    if (switchedDay && !backToDay && M.daySwitch.paintedAt !== null && vnow >= M.daySwitch.paintedAt + 5000) {
      backToDay = true;
      globalThis.location.hash = '#/' + DAY;
    }
  }
  // Snapshot booth state.
  M.boothFeedFinal = NB.state ? (NB.state.booth.feed || []).length : -1;
  M.boothGamesFinal = NB.state ? Object.keys(NB.state.booth.eventsByGame || {}).length : -1;
  M.clockEnd = MINUTES;
  if (NB.state) { console.error("DEBUG state.error=", JSON.stringify(NB.state.error)); console.error("DEBUG state.loading=", NB.state.loading, "games=", NB.state.games.length, "loadedDate=", NB.state.loadedDate, "date=", NB.state.date); console.error("DEBUG main html len=", (globalThis.document.getElementById("main").innerHTML||"").length, "head=", (globalThis.document.getElementById("main").innerHTML||"").slice(0,300)); }
  const out = {
    appFile: path.relative(path.join(__dirname, '..'), APP),
    wallClockSeconds: +((Date.now() - t0) / 1000).toFixed(1),
    firstScoreboardPaintMs: M.firstScoreboardPaintMs,
    daySwitch: {
      clickedAtMs: M.daySwitch ? M.daySwitch.clickedAt - V_START : null,
      latencyMs: M.daySwitch && M.daySwitch.paintedAt !== null ? M.daySwitch.paintedAt - M.daySwitch.clickedAt : null,
      neverRepainted: M.daySwitch ? M.daySwitch.paintedAt === null : null
    },
    scoreboardPaints: M.paints.length,
    dayByKind: M.dayByKind,
    upstream: {
      dayRequests: M.dayRequestsTotal, summaryRequests: M.summaryRequestsTotal,
      headerRequests: M.headerRequestsTotal, coreRequests: M.coreRequestsTotal,
      ncaaRequests: M.ncaaRequestsTotal, proxyRequests: M.proxyRequestsTotal,
      totalFetchCalls: fetchCount,
      perHost429: Object.fromEntries(Object.entries(M.byHost).filter(([, v]) => v.rejected429).map(([k, v]) => [k, v.rejected429])),
      readerBudgetUsed: M.readerBudgetUsed, readerRejected: M.readerRejected
    },
    browserPools: Object.fromEntries([...Object.entries(M.maxQueueDepthByHost)].filter(([k]) => !k.includes('#wait')).map(([k, v]) => [k, { queuePeak: v }])),
    booth: { feedEvents: M.boothFeedFinal, gamesScanned: M.boothGamesFinal },
    uncaughtCount: M.uncaught.length,
    uncaughtSample: M.uncaught.slice(0, 5)
  };
  console.log(JSON.stringify(out, null, 2));
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
}
run().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
