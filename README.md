# NCAA Football Scoreboard

A clean, no-video scoreboard for college football games in the **ACC, SEC, Big Ten, Big 12, and American** conferences. It pulls **official ESPN live data** (scores, live play-by-play, team stats, player stats) from ESPN's public JSON endpoints and renders them in a simple click-through UI.

## Run it

```bash
npm start        # serves http://localhost:3000 (or PORT env)
npm test         # parser unit tests against real ESPN response shapes
```

`server.js` has no dependencies. In a normal machine it serves the app and also exposes an optional same-origin ESPN proxy at `/api/espn?url=...`.

> In this Arena sandbox, the server process has **no outbound internet**, so the local proxy returns `502`. The app handles that automatically: the **browser** fetches ESPN directly (ESPN's own website calls `site.api.espn.com` from the browser, so the endpoint permits it), and the UI orders its sources:
>
> 1. `site.api.espn.com` (direct, browser)
> 2. `site.web.api.espn.com` (alternate ESPN host)
> 3. local `/api/espn` proxy (works when the server has internet)
> 4. killcors / cors.lol / codetabs public CORS proxies (last-resort fallbacks)
>
> If every source fails, the UI shows the exact error instead of inventing data.

## Features

- **Scoreboard** for the 5 focused conferences, grouped by conference, ordered so live games appear first.
- **Click between games** — pick any game from the left scoreboard (or right detail panel on mobile).
- **Live play-by-play**, quarter by quarter, with scoring/penalty/turnover tags and the score after each play. Includes a "scoring plays only" toggle and quarter filter.
- **Team stats** (1st downs, total yards, rushing, passing, penalties, turnovers, possession, etc.).
- **Player stats** per team (passing, rushing, receiving, defense, etc.).
- **Date navigation** (yesterday / today / tomorrow / date picker) and **conference filters**.
- **No videos**. The app intentionally never renders ESPN media/video payloads.
- **Auto-refresh** every 60 seconds (more frequent only happens already every minute; the selected live game summary also refreshes).

## Data source (verified, not guessed)

The app reads two ESPN endpoints:

```text
GET https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=YYYYMMDD&limit=300
GET https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=GAMEID
```

Fields used (verified against live responses during development):

- `events[].id`, `.name`, `.shortName`, `.week.number`, `.date`, `.competitions[0].competitors[].team` (`id`, `abbreviation`, `displayName`, `shortDisplayName`, `logo`, `conferenceId`), `.score`, `.homeAway`, `.winner`, `.linescores`, `.records`, `.status.type` (`state`, `detail`, `shortDetail`, `completed`), `.venue`, `.broadcasts`.
- Summary `header.competitions[0].competitors` (team / score / status / broadcasts / venue), `boxscore.teams[].statistics[]`, `boxscore.players[].statistics[]` (`name`/`text`/`labels`/`athletes[].athlete`+`stats`/`totals`), `plays[]` (`text`, `type`, `period.number`, `clock.displayValue`, `teamParticipants`, `scoringPlay`, `statYardage`, `start.downDistanceText`, `awayScore`/`homeScore`), `drives[]`, `scoringPlays[]`.

**Conference group IDs** (from ESPN's own standings endpoint; used for filtering):

| Conference | ESPN group ID |
| --- | --- |
| ACC | 1 |
| Big 12 | 4 |
| Big Ten | 5 |
| SEC | 8 |
| American | 151 |

## Notes / limitations

- This is an **unofficial, undocumented** ESPN API and can change or rate-limit without notice. The app treats it as a data feed and always renders exactly what it parses.
- Cross-conference games appear under **each** focused conference involved.
- The app needs internet in the browser. The Arena sandbox's server cannot proxy ESPN, so if your browser also blocks ESPN, the live-data route that uses `proxy.killcors.com` etc. is tried; if none work, the UI reports the failing source.

## Tests

```bash
npm test        # unit tests + headless render smoke test
```

`test/espn.test.mjs` runs against fixtures shaped exactly like the live ESPN responses and checks:

- Conference ID set and filtering.
- Scoreboard parsing (team, score, status, venue, conference).
- Summary parsing (header, team stats, player stats, plays, drives, scoring plays).
- Status formatting and date parameter formatting.

`test/smoke.mjs` boots `app.js` against the same fixtures with a minimal DOM and stubbed `fetch`, then asserts that the scoreboard renders focused games and the detail panel renders the game header + tabs — verifying the whole render pipeline, not just the parser.
