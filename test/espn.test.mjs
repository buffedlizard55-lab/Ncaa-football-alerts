import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFERENCE_IDS,
  scoreboardUrl,
  summaryUrl,
  dateParamFor,
  parseScoreboard,
  parseSummary,
  statusInfo,
  gameIsInConferences
} from '../espn.js';
import { SCOREBOARD_FIXTURE, SUMMARY_FIXTURE } from './fixtures.js';

test('conference IDs include only the five focused conferences', () => {
  assert.deepEqual([...CONFERENCE_IDS].sort(), ['1', '151', '4', '5', '8']);
});

test('scoreboardUrl and summaryUrl point at ESPN public endpoints', () => {
  assert.equal(
    scoreboardUrl('20240928'),
    'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20240928'
  );
  assert.equal(
    summaryUrl('401752687'),
    'https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401752687'
  );
});

test('dateParamFor produces YYYYMMDD from local date', () => {
  const d = new Date(2024, 0, 5);
  assert.equal(dateParamFor(d), '20240105');
  const d2 = new Date(2024, 8, 9);
  assert.equal(dateParamFor(d2), '20240909');
});

test('statusInfo renders final, live, and scheduled states', () => {
  assert.equal(
    statusInfo({ type: { completed: true, detail: 'Final', shortDetail: 'Final', state: 'post' } }).statusText,
    'Final'
  );
  assert.equal(
    statusInfo({
      type: { completed: false, state: 'in', detail: '4th-QTR 0:53', shortDetail: '4th 0:53' },
      period: 4,
      displayClock: '0:53'
    }).statusText,
    '4th 0:53'
  );
  assert.equal(
    statusInfo({ type: { completed: false, state: 'pre', detail: '7 PM', shortDetail: '7 PM' } }).statusText,
    '7 PM'
  );
});

test('parseScoreboard keeps focused-conference games and drops others', () => {
  const parsed = parseScoreboard(SCOREBOARD_FIXTURE);
  assert.equal(parsed.games.length, 2);
  assert.deepEqual(parsed.games.map((g) => g.primaryConferenceKey).sort(), ['Big Ten', 'SEC']);

  const tex = parsed.games.find((g) => g.id === '401628378');
  assert.equal(tex.primaryConferenceKey, 'SEC');
  assert.equal(tex.status.completed, true);
  assert.equal(tex.status.statusText, 'Final');
  assert.equal(tex.teams.find((t) => t.id === '251').score, '35');
  assert.equal(tex.venue.fullName, 'DKR-Texas Memorial Stadium');

  const osu = parsed.games.find((g) => g.id === '401628379');
  assert.equal(osu.primaryConferenceKey, 'Big Ten');
  assert.equal(osu.status.state, 'in');
});

test('gameIsInConferences', () => {
  const parsed = parseScoreboard(SCOREBOARD_FIXTURE);
  assert.ok(parsed.games.every(gameIsInConferences));
});

test('parseSummary extracts header, boxscore team stats, player stats, plays, drives', () => {
  const s = parseSummary(SUMMARY_FIXTURE);

  assert.equal(s.game.id, '401752687');
  assert.equal(s.game.teams.length, 2);
  assert.equal(s.game.teams.find((t) => t.id === '99').score, '23');
  assert.equal(s.game.teams.find((t) => t.id === '2348').score, '7');
  assert.equal(s.game.status.statusText, 'Final');
  assert.equal(s.game.broadcasts[0].media.shortName, 'ESPN+');
  assert.equal(s.game.venue.fullName, 'Tiger Stadium');
  assert.equal(s.game.teams.find((t) => t.id === '99').records.length, 1);

  assert.equal(s.boxscoreTeams.length, 2);
  assert.equal(s.boxscoreTeams[0].statistics[0].label, 'Total Yards');
  assert.equal(s.boxscoreTeams[1].statistics[0].displayValue, '365');

  assert.equal(s.boxscorePlayers.length, 2);
  assert.equal(s.boxscorePlayers[0].statistics.length, 2);
  assert.equal(s.boxscorePlayers[0].statistics[0].labels[0], 'C/ATT');
  assert.equal(s.boxscorePlayers[0].statistics[0].athletes[0].athlete.displayName, 'Trey Kukuk');

  assert.equal(s.plays.length, 2);
  assert.equal(s.plays[0].sequenceNumber, 104889101);
  assert.equal(s.plays[1].sequenceNumber, 104999903);
  assert.equal(s.plays[1].isScoring, true);
  assert.equal(s.plays[1].offenseAbbr, 'LSU');

  assert.equal(s.drives.length, 1);
  assert.equal(s.drives[0].isScore, true);
  assert.equal(s.drives[0].displayResult, 'Field Goal');
  assert.equal(s.drives[0].plays.length, 1);

  assert.equal(s.scoringPlays.length, 1);
  assert.equal(s.scoringPlays[0].awayScore, 0);
  assert.equal(s.scoringPlays[0].homeScore, 7);
});
