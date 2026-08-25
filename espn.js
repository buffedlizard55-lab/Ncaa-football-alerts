// espn.js
// Pure parsing helpers for ESPN's public NCAAF JSON endpoints.
// Every expected field here was verified against the live response shapes from:
//   GET https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=YYYYMMDD
//   GET https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=GAMEID

export const CONFERENCES = [
  { id: '1', key: 'ACC', label: 'ACC' },
  { id: '5', key: 'Big Ten', label: 'Big Ten' },
  { id: '4', key: 'Big 12', label: 'Big 12' },
  { id: '8', key: 'SEC', label: 'SEC' },
  { id: '151', key: 'American', label: 'American' }
];

export const CONFERENCE_IDS = new Set(CONFERENCES.map((c) => c.id));

export const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';

export function scoreboardUrl(dateParam, extra = {}) {
  const qs = new URLSearchParams({ dates: dateParam });
  if (extra.limit) qs.set('limit', String(extra.limit));
  return `${BASE_URL}/scoreboard?${qs.toString()}`;
}

export function summaryUrl(eventId) {
  return `${BASE_URL}/summary?event=${encodeURIComponent(eventId)}`;
}

// YYYYMMDD based on a Date object, using local time.
export function dateParamFor(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function conferenceByTeam(team = {}) {
  const id = String(team.conferenceId || '');
  return CONFERENCES.find((c) => c.id === id) || null;
}

export function conferenceKeysForTeams(teams = []) {
  const seen = new Set();
  const keys = [];
  for (const t of teams) {
    const conf = conferenceByTeam(t);
    if (conf && !seen.has(conf.key)) {
      seen.add(conf.key);
      keys.push(conf.key);
    }
  }
  return keys;
}

export function teamFromCompetitor(competitor = {}) {
  const team = competitor.team || {};
  return {
    id: String(team.id || competitor.id || ''),
    uid: team.uid || '',
    abbreviation: team.abbreviation || '',
    displayName: team.displayName || team.name || '',
    shortDisplayName: team.shortDisplayName || team.location || team.name || '',
    location: team.location || '',
    name: team.name || '',
    color: team.color || '#333',
    alternateColor: team.alternateColor || '#999',
    logo: team.logo || (team.logos && team.logos[0] && team.logos[0].href) || '',
    conferenceId: String(team.conferenceId || (team.groups && team.groups.id) || (team.conference && team.conference.id) || ''),
    conference: conferenceByTeam({
      ...team,
      conferenceId: team.conferenceId || (team.groups && team.groups.id) || (team.conference && team.conference.id) || ''
    }),
    homeAway: competitor.homeAway || '',
    score: competitor.score !== undefined ? String(competitor.score) : '0',
    winner: competitor.winner === true,
    linescores: Array.isArray(competitor.linescores) ? competitor.linescores : [],
    records: Array.isArray(competitor.records)
      ? competitor.records
      : Array.isArray(competitor.record)
        ? competitor.record
        : []
  };
}

export function statusInfo(status = {}) {
  const type = status.type || {};
  const state = type.state || '';
  const clock = status.displayClock || '';
  const period = status.period ? String(status.period) : '';
  const detail = type.detail || type.shortDetail || type.description || '';

  let statusText = detail || '—';
  if (type.completed) {
    statusText = type.detail || type.shortDetail || 'Final';
  } else if (state === 'in') {
    statusText = type.shortDetail || type.detail || [tokenToPeriod(period), clock].filter(Boolean).join(' ');
  }

  return {
    state,
    completed: !!type.completed,
    detail,
    shortDetail: type.shortDetail || '',
    period,
    clock,
    statusText,
    typeName: type.name || ''
  };
}

export function tokenToPeriod(token) {
  const s = String(token || '').toLowerCase();
  if (s.startsWith('qtr') || s.startsWith('quarter')) return '';
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    if (n === 4) return '4th';
    return `${n}th`;
  }
  return token;
}

export function gameFromEvent(event = {}) {
  const comp = (event.competitions && event.competitions[0]) || {};
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const teams = competitors.map(teamFromCompetitor);
  const status = statusInfo(comp.status || {});
  const confKeys = conferenceKeysForTeams(teams);
  const broadcasts = Array.isArray(comp.broadcasts) ? comp.broadcasts : [];
  const venue = comp.venue || {};
  const date = event.date || comp.date || '';

  return {
    id: String(event.id || comp.id || ''),
    uid: event.uid || comp.uid || '',
    date,
    name: event.name || '',
    shortName: event.shortName || '',
    week: event.week && event.week.number != null ? Number(event.week.number) : null,
    season: event.season || {},
    status,
    venue,
    broadcasts,
    teams,
    conferenceKeys: confKeys,
    primaryConferenceKey: confKeys[0] || '',
    playByPlayAvailable: comp.playByPlayAvailable !== false,
    neutralSite: !!comp.neutralSite,
    conferenceCompetition: !!comp.conferenceCompetition
  };
}

export function gameIsInConferences(game) {
  return game.conferenceKeys.length > 0;
}

// The summary header competes with the scoreboard event for richer detail.
export function summaryHeaderGame(summary = {}) {
  const header = summary.header || {};
  const comp = (header.competitions && header.competitions[0]) || {};
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const teams = competitors.map(teamFromCompetitor);
  const status = statusInfo(comp.status || {});
  const broadcasts = Array.isArray(comp.broadcasts) ? comp.broadcasts : [];
  const venue = comp.venue || {};

  return {
    id: header.id != null ? String(header.id) : '',
    season: header.season || {},
    seasonType: header.seasonType || null,
    week: header.week != null ? Number(header.week) : null,
    league: header.league || {},
    date: header.date || comp.date || '',
    name: header.competitions && header.competitions[0] && header.competitions[0].name || '',
    shortName: header.shortName || '',
    status,
    venue,
    broadcasts,
    teams,
    wallclockAvailable: header.wallclockAvailable !== false,
    links: Array.isArray(header.links) ? header.links : [],
    meta: header.meta || {}
  };
}

export function boxscoreTeams(summary = {}) {
  const boxscore = summary.boxscore || {};
  const list = Array.isArray(boxscore.teams) ? boxscore.teams : [];
  return list
    .map((entry) => ({
      id: entry.team && entry.team.id ? String(entry.team.id) : '',
      team: entry.team || {},
      homeAway: entry.homeAway || '',
      statistics: Array.isArray(entry.statistics) ? entry.statistics : []
    }))
    .filter((entry) => entry.team && entry.team.id);
}

export function boxscorePlayers(summary = {}) {
  const boxscore = summary.boxscore || {};
  const list = Array.isArray(boxscore.players) ? boxscore.players : [];
  return list
    .map((entry) => ({
      id: entry.team && entry.team.id ? String(entry.team.id) : '',
      team: entry.team || {},
      homeAway: entry.homeAway || '',
      statistics: Array.isArray(entry.statistics) ? entry.statistics : []
    }))
    .filter((entry) => entry.team && entry.team.id);
}

export function normalizeDrive(drive = {}) {
  return {
    id: String(drive.id || ''),
    description: drive.description || '',
    team: drive.team || {},
    start: drive.start || {},
    end: drive.end || {},
    timeElapsed: drive.timeElapsed || {},
    yards: drive.yards != null ? Number(drive.yards) : null,
    offensivePlays: drive.offensivePlays != null ? Number(drive.offensivePlays) : null,
    isScore: !!drive.isScore,
    result: drive.result || '',
    shortDisplayResult: drive.shortDisplayResult || '',
    displayResult: drive.displayResult || '',
    plays: Array.isArray(drive.plays) ? drive.plays.map(normalizePlay) : []
  };
}

export function normalizePlay(play = {}) {
  const participants = Array.isArray(play.teamParticipants) ? play.teamParticipants : [];
  const offense = participants.find((p) => p.type === 'offense') || participants[0] || {};
  const def = participants.find((p) => p.type === 'defense') || {};
  const periodNumber = play.period && play.period.number != null ? Number(play.period.number) : null;

  return {
    id: String(play.id || ''),
    sequenceNumber: play.sequenceNumber != null ? Number(play.sequenceNumber) : 0,
    index: play.index != null ? Number(play.index) : 0,
    period: periodNumber,
    clock: (play.clock && play.clock.displayValue) || '',
    text: play.text || '',
    type: (play.type && play.type.text) || '',
    typeId: play.type && play.type.id != null ? String(play.type.id) : '',
    abbreviation: (play.type && play.type.abbreviation) || '',
    isScoring: !!play.scoringPlay,
    isPenalty: !!play.isPenalty,
    isTurnover: !!play.isTurnover,
    priority: !!play.priority,
    statYardage: play.statYardage != null ? Number(play.statYardage) : null,
    awayScore: play.awayScore != null ? Number(play.awayScore) : null,
    homeScore: play.homeScore != null ? Number(play.homeScore) : null,
    offenseTeamId: (offense.team && offense.team.id) || (play.team && play.team.id) || '',
    offenseAbbr: (offense.team && offense.team.abbreviation) || (play.team && play.team.abbreviation) || '',
    defenseTeamId: (def.team && def.team.id) || '',
    offenseType: offense.type || '',
    startDownDistance: (play.start && (play.start.downDistanceText || play.start.shortDownDistanceText)) || '',
    endDownDistance: (play.end && (play.end.downDistanceText || play.end.shortDownDistanceText)) || '',
    wallclock: play.wallclock || ''
  };
}

export function normalizePlays(plays = []) {
  return Array.isArray(plays)
    ? plays.map(normalizePlay).sort((a, b) => {
        if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
        return a.id.localeCompare(b.id);
      })
    : [];
}

export function parseScoreboard(json = {}) {
  const events = Array.isArray(json.events) ? json.events : [];
  const games = events
    .map(gameFromEvent)
    .filter((g) => g.id && g.teams.length >= 2)
    .filter(gameIsInConferences);

  const league = (json.leagues && json.leagues[0]) || {};
  return {
    games,
    season: league.season || {},
    returnedAt: json.returnedAt || '',
    provider: json.provider || null
  };
}

export function parseSummary(json = {}) {
  const headerGame = summaryHeaderGame(json);
  const boxTeams = boxscoreTeams(json);
  const boxPlayers = boxscorePlayers(json);

  // If the header is missing a team for a team that appears in the boxscore,
  // fall back to the boxscore team metadata for the game header.
  if (headerGame.teams.length === 0 && boxTeams.length) {
    headerGame.teams = boxTeams.map((b) => ({
      ...b.team,
      homeAway: b.homeAway,
      score: b.team.statistics
        ? b.team.statistics.find((s) => s.name === 'totalYards' || s.name === 'points')
        : undefined
    }));
  }

  return {
    game: headerGame,
    boxscoreTeams: boxTeams,
    boxscorePlayers: boxPlayers,
    plays: normalizePlays(json.plays),
    drives: Array.isArray(json.drives) ? json.drives.map(normalizeDrive) : [],
    scoringPlays: Array.isArray(json.scoringPlays) ? json.scoringPlays.map(normalizePlay) : [],
    gameInfo: json.gameInfo || null,
    news: json.news || null,
    article: json.article || null
  };
}

export function teamLookup(game) {
  const map = new Map();
  for (const t of game.teams) map.set(t.id, t);
  return map;
}

export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}
