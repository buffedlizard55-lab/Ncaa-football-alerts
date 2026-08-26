# NCAA Football Scoreboard

A clean, dark-themed scoreboard for **college football**, focused on five conferences:

**ACC · SEC · Big Ten · Big 12 · American**

- Clickable scoreboard: browse a day's games, click any game to open it, click back to switch games.
- **Default opens on the next game day**: on a fresh visit, an empty or completed-only
  current slate advances to the next day with a scheduled game. A date with a scheduled
  or live game stays selected.
- **Empty days are never dead ends**: if the selected day has no games (e.g. midweek in
  August), the app automatically finds and lists the **next upcoming games** and the
  **most recent results** for the enabled conferences, with one-click jump buttons.
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
picker / ◀ ▶ arrows to move between days. On days with no games the page
automatically lists the next upcoming games and the most recent results (the
2026 season opens Sat, Aug 29 — UNC @ TCU in Dublin is the first game for
these five conferences; the most recent result is the Jan 19, 2026 CFP title
game).

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
| Day scoreboard, all games | `GET /apis/site/v2/sports/football/college-football/scoreboard?dates=YYYYMMDD` | 2026-08-29 returned games (UNC @ TCU, Aviva Stadium, Dublin); 2026-08-25 returned `events: []` (no games that day) |
| Day scoreboard, one conference | same + `&groups={id}` | `groups=4` cut the response from 14 chunks to 3 and tagged it `"groups":["4"]` (TCU game); `groups=8` returned TA&M @ MIZ on 2025-11-08 |
| Day scoreboard, several conferences at once | same + `&groups=1,8,5,4,151` (raw commas) | on 2025-11-08: `groups=8` → SEC games, `groups=5` → Big Ten games, `groups=8,5` → 11 events (the union). The app now sends ONE combined request per day and falls back to per-conference requests if it fails |
| Ranged scoreboard (nearby-games search) | same + `dates=YYYYMMDD-YYYYMMDD` | `dates=20260825-20260831&groups=…` returned the week's 6 events; `dates=20260110-20260131&groups=…` returned 1 event (the CFP title game). **Ranged responses carry `"calendar": []`** — the season calendar only appears on single-day responses |
| Game detail (PBP + stats) | `GET .../summary?event={gameId}` | `summary?event=401752763` returned boxscore, drives+plays, recap. **Note:** the parameter is `event`, not `gameId` — `summary?gameId=` returns `{"code":1,"detail":"general error: invalid URI"}` and `boxscore?gameId=`/`boxscore?event=` return `404`; the box score is inside the `summary` payload |
| Pre-game summary shape | `GET .../summary?event=401856766` (UNC @ TCU, 2026-08-29) | `boxscore.teams` present with **empty** `statistics`, no `drives`/`plays`/`article`, and `header.competitions[0].date = "2026-08-29T16:00Z"` — this is how deep links to *upcoming* games resolve their date |
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

The scoreboard response is `{"leagues":[{…season, calendar…}], "events":[…],
"groups":[…]}` — **`events` is a TOP-LEVEL array**, next to `leagues`, not
inside it. (This exact shape is verified in every live dump; reading
`leagues[0].events` yields nothing — see the bug note under Verification.)

Per event, `competitions[0]` → `status` (`type.state` = `pre`/`in`/`post`, `period`,
`displayClock`), `competitors[]` (team, logo, `color`, `score`, `linescores[]`
per period, `records[]`, `curatedRank`, `winner`), `broadcasts`, `venue`,
`attendance`, `notes`, `groups` (conference name), `leaders` (game leaders),
`headlines` (recap text).

### Upcoming & recent results

For every loaded scoreboard date, the app also runs a nearby-games search and
shows the closest upcoming slate and most recent completed slate as clickable
rows below the selected day's games. On an empty date these sections are the
main scoreboard content; on a date with games they remain visible below the
current slate:

1. One ranged request each for the next 14 days and the previous 14 days
   (`dates=FROM-TO`, combined `groups=`), grouped by Eastern date.
2. If a direction comes back empty (deep offseason), it uses the season
   `calendar` from that day's single-day response to jump straight to the
   likely window: the last 3 weeks of the previous league year backwards
   (for the 2026 league year starting 2026-02-01 that is 2026-01-11..31,
   which contains the Jan 19 title game), or the next season/segment start
   forwards (e.g. the 2026 opener window starting 2026-08-22).
3. Rows reuse the normal scoreboard renderer — click any game to open it, or
   use the "Go to …" button to land on that day's full scoreboard.

On 2026-08-25 (a Tuesday with no games) this surfaces: *Upcoming — Sat, Aug 29*
(Week 1: UNC @ TCU in Dublin, among others) and *Recent results — Mon, Jan 19*
(CFP National Championship: Indiana 27, Miami 21).

### Live behavior

- Scoreboard view: one combined conference request per load (≤1 normally, 5 only
  as fallback); auto-refresh every 20 s while any game is live (60 s otherwise).
- Game view (live): `summary` polled every 15 s (new plays appended, scores and
  stats refreshed, new plays flash and the list stays pinned if "follow live"
  is on), plus a scoreboard poll every 30 s for the authoritative clock/period
  and kickoff/final transitions. Scheduled games wait for kickoff automatically.
- Polling pauses while the browser tab is hidden.

### Free NCAA.com fallback

If ESPN cannot be reached, the day scoreboard tries the documented free NCAA.com
GraphQL scoreboard source. It sends `sportCode: "MFB"`, FBS division `11`, the
NCAA season year, and the selected `contestDate`, then normalizes the documented
`data.contests[]` / `teams[]` fields into the scoreboard model. This fallback is
for scoreboard rows only; ESPN remains required for the existing game summary,
box score, and play-by-play views.

### CORS / fallback

The page is served from this preview host and first calls the server's
same-origin `/api/espn?url=…` relay. The relay allowlists only
`site.api.espn.com/apis/site/v2/`, avoiding browser CORS failures and keeping
the ESPN request in one controlled place. If the relay cannot reach ESPN, the
browser falls back to a direct request and then public CORS proxies —
`api.allorigins.win`, `corsproxy.io`, and `api.codetabs.com`. The UI and
diagnostics identify whether the server relay or a public proxy supplied the
data. An error banner appears only if every path fails.

The nearby-games discovery also runs when the day's own feed errors, so a
transient single-day failure cannot dead-end the page: the surrounding-game
search still gets a chance to surface upcoming and recent results. It runs for
non-empty dates too, so the scoreboard always has clear context around the
selected slate.

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
styles.css    dark scoreboard theme (+ empty-day discovery panel)
app.js        data layer (pure, testable) + browser app
test/run.js   offline test runner (56 checks)
test/fixtures/ real API response fixtures (game 401752763, TA&M 38–17 MIZ,
               2025-11-08) with field-level provenance notes
```

## Verification performed (2026-08-25)

1. **Live API contract** — every endpoint/parameter above was called and the
   responses inspected directly (scoreboard with/without `groups`, combined
   `groups=8,5`, ranged `dates=FROM-TO`, `teams/{id}`, `summary?event=` for a
   completed game and a pre-game, including ~10 chunks of a full game:
   boxscore teams & players, drives, plays, recap, standings).
2. **Conference mapping** — each of the 5 conference IDs was confirmed with
   known teams (table above), matching published documentation.
3. **Offline tests** — `npm test`: 56 passing checks covering syntax, URL
   builders (single/combined/ranged), date/timezone math, event/summary
   parsing against the real fixtures (scores, line scores, leaders, drives,
   plays, player rows, merge/dedupe, live/final status logic), the top-level
   events array shape, nearby-day grouping, calendar probe windows, pre-game
   summaries, and the running server's routes (including path-traversal
   refusal).
4. **End-to-end DOM simulation** — the browser flow was driven headlessly
   against stubbed API responses shaped from the live dumps: empty-day
   discovery (upcoming + recent panels), clicking nearby rows, jump buttons,
   deep links to an upcoming game, and back-navigation.
5. **Known pitfalls found empirically** — `gameId` vs `event` parameter
   (invalid URI), `boxscore` endpoint 404 (data lives in `summary`),
   conference filter parameter is `groups` (not `conference`), `dates=`
   interpreted as an Eastern date (a 6:30 pm ET Sunday game is dated the
   following UTC day), `99` = unranked in `curatedRank`, ranged responses
   return `calendar: []`, commas in `groups=` are sent raw (never `%2C`).
6. **Bug fixed after line-by-line verification (2026-08-25)** — the day loader
   previously read events from `leagues[0].events`, but the payload puts
   `events` at the TOP level; the scoreboard therefore rendered every day as
   empty (no upcoming, no previous games — ever). The same wrong-shape read
   existed in the live-status poller and the deep-link resolver. All three
   now read the verified top-level array. Additionally, deep links to
   *upcoming* games previously showed a bogus "Final" status because they
   resolved the game date from the first play (pre-games have none); they now
   use `summary.header.competitions[0].date`.
7. **Observed environment notes** — the public `api.allorigins.win` CORS-proxy
   fallback was down (Cloudflare 522) during verification; the direct
   browser→ESPN path is the primary one. The Jan 19, 2026 single event under
   `groups=1,8,5,4,151` matches the externally reported CFP title game
   (Indiana 27, Miami 21 — Big Ten/ACC, both in the filter).

Not verifiable from this sandbox (no direct egress to espn.com): the
browser→ESPN CORS handshake itself and a full live-game watch — that's what
the live preview is for. If anything looks off in the preview, the
diagnostics panel (footer) shows exactly which requests/keys are in play.
