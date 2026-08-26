# NCAA Football Scoreboard

A zero-dependency, dark-themed college-football scoreboard for:

**ACC · SEC · Big Ten · Big 12 · American**

The app is intended to behave like a scoreboard rather than a single-day
lookup:

- A fresh visit starts on the current Eastern date, then moves to the next day
  with an upcoming game when the current slate is empty or contains only final
  games. A day with a live or scheduled game stays selected.
- The selected day is divided into **Live**, **Upcoming**, and **Final**.
- Every selected day also gets an adjacent **Upcoming** slate and **Recent
  results** slate, including when the selected day itself is empty.
- Rows are clickable. Game detail includes the score, line scores, venue,
  play-by-play, team stats, player stats when the source provides them, and
  final recaps when available.
- Live scoreboards refresh automatically. Live game views refresh the
  provider's current status and play-by-play without showing video.

## Run

```bash
npm start          # or: node server.js
npm test           # offline tests; no API key or network is required
```

The server requires Node 18 or newer, has no runtime dependencies, and binds to
`0.0.0.0` on port 8000 by default. Set `PORT` to change the port.

## Provider strategy

The browser does not assume that a syntactically valid JSON response contains
real games. Each response is checked for an event/contest with both a home and
an away competitor; ESPN's placeholder `{}` events are rejected.

### Primary source: ESPN public JSON

The app uses the public JSON contract used by ESPN's college-football site. No
API key is required.

| Use | Verified request/behavior |
|---|---|
| Single-day scoreboard | `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=YYYYMMDD&limit=300` returned complete event objects. |
| One conference | The same URL with one `groups=` value. The configured IDs are ACC `1`, SEC `8`, Big Ten `5`, Big 12 `4`, and American `151`. |
| Nearby discovery | A no-group range such as `dates=20260827-20260909&limit=500` returned complete events and is filtered locally by team `conferenceId`. |
| Game detail | `.../summary?event={eventId}` returned the box score, drives, plays, and recap for a completed game. The parameter is `event`; `gameId` is not interchangeable. |
| Alternate host | `site.web.api.espn.com` was independently checked with the same scoreboard and summary paths and is tried if the primary ESPN host fails. |

The loader intentionally makes one request per enabled conference in parallel.
It does **not** rely on a comma-separated group list. During the live
investigation, `groups=1,8,5,4,151` returned placeholder `{}` events even
though the HTTP response was successful. The per-group responses are merged
and deduplicated by event ID. If a per-group response fails or contains
placeholders, the loader retries with the verified no-group day response and
filters the complete events locally.

This distinction fixes the original blank-scoreboard behavior: an empty
placeholder response is not treated as a legitimate no-games response.

### Verified free NCAA fallback

When ESPN day requests cannot produce a usable payload, the app uses the
current NCAA persisted-query scoreboard contract:

- host: `sdataprod.ncaa.com`
- persisted-query SHA-256 hash:
  `7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c`
- variables: `sportCode: "MFB"`, numeric FBS `division: 11`, numeric
  `seasonYear`, and `contestDate: "YYYY-MM-DD"`
- response: `data.contests[]`

That exact request was independently called for August 29, 2026 and January
19, 2026. It returned the August 29 schedule and the January 19 CFP title game
(Indiana 27, Miami (FL) 21). The adapter uses the NCAA `isHome` field, contest
state, epoch, scores, linescores, rank, record, and conference SEO values; it
does not assume ESPN's competitor ordering.

NCAA contest IDs are not ESPN event IDs. When an NCAA fallback row is opened,
the app uses the public NCAA-backed game feed for that contest ID:

- `https://ncaa-api.henrygd.me/game/{contestId}` for the authoritative game
  overview
- `/boxscore`, `/play-by-play`, and `/team-stats` when the overview advertises
  those capabilities

A completed Army–Navy game (`6458979`) was independently verified with the
overview and all three detail route shapes. Pre-game secondary routes may
return 502 or be unavailable, so each optional request is isolated and a
usable overview still renders. NCAA detail data is normalized into the same
scoreboard/detail view model as ESPN data.

### Options investigated but not used as primary providers

- CollegeFootballData advertises useful college-football data, but its bearer
  key is required; it is not a key-free scoreboard source.
- API-Sports advertises NCAA coverage and a free quota, but account/API-key
  setup is required and was not used here.
- Public CORS proxies were tested as network fallbacks. `api.allorigins.win`
  returned a Cloudflare 522 during testing, and the other proxy paths are
  third-party infrastructure with no reliability guarantee. They remain only
  after the app's same-origin relay and direct provider-host attempts.

## Date and nearby-game behavior

ESPN's `dates=` filter is an Eastern calendar date. The app therefore uses
`America/New_York` for the current date, kickoff labels, and ranged-response
grouping. It does not silently interpret a late UTC kickoff as a different
scoreboard day.

For each loaded date, nearby discovery requests the next and previous 14-day
windows without `groups=` and filters the complete event objects locally. If a
range fails, it retries one request per enabled conference. The current
season calendar is also used for an offseason jump window when ESPN supplies
one. Results are grouped by Eastern day and remain clickable.

On a clean visit, the current day is kept if it contains a live or scheduled
game. If it is empty or final-only, the closest future game day is selected
once it has been found. This avoids both failure modes: opening on a stale
final-only date and jumping past a live/current slate.

## Server relay and security

The page calls the same-origin `/api/espn?url=...` route first. The relay is
not an open proxy: it permits only the retained provider hosts and paths:

- ESPN `site.api.espn.com` and `site.web.api.espn.com` scoreboard/summary paths
- NCAA GraphQL root on `sdataprod.ncaa.com`
- the documented NCAA-backed scoreboard and game-detail paths on
  `ncaa-api.henrygd.me`

Other hosts, protocols, methods, URL paths, and file traversal attempts are
rejected. If the relay cannot reach a provider, the client tries the verified
provider-host alternative, direct access, and finally the public proxy chain.
Diagnostics identify the source, provider, relay/proxy status, counts, and
last update.

## Repository review and verification

The implementation was reviewed across the complete data path: URL builders,
provider fallback order, response validation, conference filtering, NCAA
normalization, date math, merge/deduplication, rendering, hash routing, deep
links, live polling, detail parsing, server allowlisting, path confinement,
and the offline test runner.

Current verification performed on **2026-08-26**:

1. ESPN no-group ranges for `20260827-20260909` and `20260110-20260131`
   returned complete events; single-group requests for `groups=1` and `5`
   returned the January 20 championship event; comma-separated group requests
   returned placeholder events and are rejected by the app.
2. ESPN event `401856766` was verified as North Carolina at TCU on
   `2026-08-29T16:00Z`, with venue Aviva Stadium. Its summary returned a valid
   pre-game shape with teams and a scheduled header date.
3. The exact current NCAA persisted query above returned `data.contests` for
   both `contestDate` and `week` variables. FBS division `11` and football
   code `MFB` were confirmed from the current public adapter contract.
4. The NCAA-backed game overview and completed-game detail routes were called
   independently; optional-route failures are handled rather than assumed
   away.
5. `npm test` passes **62 offline checks**, including syntax, URL construction,
   ESPN response validation, NCAA scoreboard/detail parsing, conference
   filtering, real ESPN fixtures, date boundaries, merge/deduplication, live
   and final view models, and the running server's health/static/security
   routes.

The sandbox has no installed browser executable and its server-side outbound
TLS path to ESPN is restricted, so a real browser CORS handshake and a full
live-game watch cannot be proven by `npm test`. The live preview remains the
place to observe browser delivery; the relay and diagnostics are designed to
make a provider/network failure explicit instead of rendering an unexplained
blank slate.

## Files

```text
server.js                         static server, health check, allowlisted relay
index.html                        scoreboard shell and diagnostics footer
styles.css                        responsive dark scoreboard/detail UI
app.js                            provider clients, parsers, UI, routing, polling
test/run.js                       zero-dependency offline test runner
test/fixtures/scoreboard-event.json  verified ESPN final-game fixture
test/fixtures/summary.json           verified ESPN summary/PBP/stats fixture
test/fixtures/ncaa-scoreboard.json   verified NCAA contest-shape fixture
test/fixtures/ncaa-game.json          verified NCAA game-shape fixture
```
