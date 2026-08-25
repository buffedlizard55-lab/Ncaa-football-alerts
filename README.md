# NCAA Football Scoreboard

A clean, dark-themed scoreboard for **college football**, focused on five conferences:

**ACC · SEC · Big Ten · Big 12 · American**

- Clickable scoreboard: browse a day's games, click any game to open it, click back to switch games.
- **Live**: scores, quarter/clock, per-period line scores, live play-by-play with a play tracker
  (possession, down & distance, clock), auto-refresh while a game is live.
- **Play-by-play**: full drive-by-drive, play-by-play text with scoring plays, penalties and
  turnovers highlighted, filters (All / Scores / Turnovers), "follow live" pinning.
- **Game stats**: team comparison table (first downs, down efficiency, yards, penalties,
  turnovers, possession…) with leaders highlighted.
- **Player stats**: per-team box score by category (passing, rushing, receiving, scoring,
  kicking, defense, returns…) exactly as reported.
- Final-game recap headline + text.
- **No videos.** Odds are not shown. Only official game stats and scoring as reported.

## Run

```bash
npm start          # or: node server.js
```

Zero npm dependencies (Node 18+). The server is a small static file server on
`http://localhost:8000` (set `PORT` to change). Open the page and use the date
picker / ◀ ▶ arrows to move between days; the season opens with live games on
game days (this sandbox's ESPN data has the 2026 season starting the weekend of
Aug 29, 2026).

Tests (offline, no network needed):

```bash
npm test
```

## How it works — reverse-engineered from the ESPN site

The app uses the same public JSON API that `espn.com` itself uses
(`site.api.espn.com`). No API key. All endpoints and parameters below were
**verified against live responses on 2026-08-25** (this is how the data
contract was derived — no guesswork):

| Purpose | Endpoint | Verified evidence |
|---|---|---|
| Day scoreboard, all games | `GET /apis/site/v2/sports/football/college-football/scoreboard?dates=YYYYMMDD` | 2026-08-29 returned games (UNC @ TCU, Aviva Stadium, Dublin) |
| Day scoreboard, one conference | same + `&groups={id}` | `groups=4` cut the response from 14 chunks to 3 and tagged it `"groups":["4"]` (TCU game); `groups=8` returned TA&M @ MIZ on 2025-11-08 |
| Game detail (PBP + stats) | `GET .../summary?event={gameId}` | `summary?event=401752763` returned boxscore, drives+plays, recap. **Note:** the parameter is `event`, not `gameId` — `summary?gameId=` returns `{"code":1,"detail":"general error: invalid URI"}` and `boxscore?gameId=`/`boxscore?event=` return `404`; the box score is inside the `summary` payload |
| Team detail (conference group) | `GET .../teams/{id}` | `teams/2628` (TCU) → `groups:{id:"4",isConference:true}` |

### Conference filter (the five conferences)

The scoreboard's `groups=` parameter is the official conference filter (the
same one behind espn.com's conference dropdown). IDs, each verified against
live team data, not documentation alone:

| Conference | `groups` id | Verified via |
|---|---|---|
| ACC | `1` | Virginia & Wake Forest games (Week 11, 2025); UNC `conferenceId "1"` (2026) |
| Big 12 | `4` | TCU games; TCU `conferenceId "4"` (2026) |
| Big Ten | `5` | Ohio State @ Purdue (both `conferenceId "5"`) |
| SEC | `8` | Texas A&M @ Missouri (both `conferenceId "8"`); response even carries `groups:{name:"Southeastern Conference",shortName:"SEC"}` |
| American | `151` | Navy @ Notre Dame returned under `groups=151` (Navy is the in-conference team) |

The app fetches the day's scoreboard **once per enabled conference** (≤5
parallel requests) and merges/dedupes by game id, so an inter-conference game
between two in-focus teams appears once. A game is shown when **at least one
team is in an enabled conference** (e.g. an SEC team's non-conference opener).
The conference label on each row comes from the API response itself.

### Game detail payload (`summary?event=`)

- `boxscore.teams[]` — team stats: `{name, label, displayValue, value}` per stat, plus `homeAway`.
- `boxscore.players[]` — player box by category: `{name, text, labels[], descriptions[], athletes[{athlete, stats[]}], totals[]}`. The UI renders whatever categories are present, so new stat groups show up automatically.
- `drives[]` — every drive: team, start/end position+clock, `yards`, `offensivePlays`, `timeElapsed`, `result` (`TD`, `FG`, `PUNT`, `DOWNS`, `END OF HALF`…), and its `plays[]`. **Every play lives in a drive** (verified: kickoffs, timeouts and "End of Nth quarter" markers are all inside drives) — the parser flattens drives into the PBP list and uses the last drive as the live play tracker.
- Play objects: `text`, `type`, `period`, `clock`, `awayScore`/`homeScore`,
  `start`/`end` (down & distance, yard line, possession team), `scoringPlay`,
  `scoringType`, `pointAfterAttempt`, `isPenalty`, `isTurnover`,
  `statYardage`, `teamParticipants`. Play types seen in live data: Rush, Pass
  Reception, Pass Incompletion, Penalty, Rushing/Passing Touchdown, Punt, Punt
  Return, Kickoff, Timeout, Fumble Recovery (Own/Opponent), End Period.
- `article` — post-game recap (headline + description text). The video fields
  in the payload are deliberately ignored.

### Scoreboard event payload

`competitions[0]` → `status` (`type.state` = `pre`/`in`/`post`, `period`,
`displayClock`), `competitors[]` (team, logo, `color`, `score`, `linescores[]`
per period, `records[]`, `curatedRank`, `winner`), `broadcasts`, `venue`,
`attendance`, `notes`, `groups` (conference name), `leaders` (game leaders),
`headlines` (recap text).

### Live behavior

- Scoreboard view: auto-refresh every 20 s while any game is live (60 s otherwise).
- Game view (live): `summary` polled every 15 s (new plays appended, scores and
  stats refreshed, new plays flash and the list stays pinned if "follow live"
  is on), plus a scoreboard poll every 30 s for the authoritative clock/period
  and kickoff/final transitions. Scheduled games wait for kickoff automatically.
- Polling pauses while the browser tab is hidden.

### CORS / fallback

The page is served from this preview host and calls `site.api.espn.com`
directly from your browser. If a network blocks that cross-origin call, the
app transparently retries the same request through the public
`api.allorigins.win` CORS proxy (the UI shows "via CORS proxy" when that path
is used), and shows an error banner if both fail.

### Diagnostics

Open the **diagnostics** details panel in the footer. It shows the current
view/date, conference filters, game counts, last update, proxy status, and —
for an open game — the summary payload's top-level JSON keys, play/drive
counts, boxscore teams and player categories. Handy for confirming exactly
what the API returned.

## Files

```
server.js     zero-dependency static server (0.0.0.0, PORT=8000 default)
index.html    page shell
styles.css    dark scoreboard theme
app.js        data layer (pure, testable) + browser app
test/run.js   offline test runner (39 checks)
test/fixtures/ real API response fixtures (game 401752763, TA&M 38–17 MIZ,
               2025-11-08) with field-level provenance notes
```

## Verification performed (2026-08-25)

1. **Live API contract** — every endpoint/parameter above was called and the
   responses inspected directly (scoreboard with/without `groups`, `teams/{id}`,
   `summary?event=` including ~10 chunks of a full game: boxscore teams &
   players, drives, plays, recap, standings).
2. **Conference mapping** — each of the 5 conference IDs was confirmed with
   known teams (table above), matching published documentation.
3. **Offline tests** — `npm test`: 39 passing checks covering syntax, URL
   builders, date/timezone math, event/summary parsing against the real
   fixtures (scores, line scores, leaders, drives, plays, player rows,
   merge/dedupe, live/final status logic), and the running server's routes
   (including path-traversal refusal).
4. **Known pitfalls found empirically** — `gameId` vs `event` parameter
   (invalid URI), `boxscore` endpoint 404 (data lives in `summary`),
   conference filter parameter is `groups` (not `conference`), `dates=`
   interpreted as an Eastern date (a 6:30 pm ET Sunday game is dated the
   following UTC day), `99` = unranked in `curatedRank`.

Not verifiable from this sandbox (no direct egress to espn.com): the
browser→ESPN CORS handshake itself and a full live-game watch — that's what
the live preview is for. If anything looks off in the preview, the
diagnostics panel (footer) shows exactly which requests/keys are in play.
