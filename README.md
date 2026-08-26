# NCAA Football Scoreboard

A zero-dependency, dark-themed college-football scoreboard for:

**ACC · SEC · Big Ten · Big 12 · American**

The app is intended to behave like a scoreboard rather than a single-day
lookup:

- A fresh visit searches from the current Eastern date and opens the next
  available game day. If the current date has a live or scheduled game, it is
  kept open so a live/current scoreboard is not skipped; an empty or
  final-only current date advances to the closest future slate.
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

## GitHub Pages deployment

The repository's published GitHub Pages site is a legacy **static** deployment
from the configured branch. GitHub Pages serves `index.html`, `app.js`, and
`styles.css`; it does not start `server.js`, so the same-origin `/api/espn`
relay exists only when the Node server is running locally or on a separate
backend.

The client detects a `*.github.io` host and skips that known-nonexistent relay.
It then tries the public ESPN/NCAA endpoint directly and uses the documented
CORS-enabled Jina Reader transport as a browser fallback. This keeps the
published static path separate from the local server path without turning the
relay into an open proxy. A Pages deployment must contain the current static
client files before its public URL can show the fallback behavior; changing
`server.js` alone cannot update a legacy Pages site.

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

The loader first makes one no-group request for the selected day and filters
its complete FBS event list locally. This keeps the normal path to one network
operation instead of five independent requests. It does **not** rely on a
comma-separated group list. During the live investigation,
`groups=1,8,5,4,151` returned placeholder `{}` events even though the HTTP
response was successful. If the no-group request fails or contains only
placeholders, the loader checks the exact NCAA contest-date query before
retrying one conference at a time. If the fallback returns a usable NCAA
slate, it is rendered directly; otherwise the per-conference ESPN recovery
path still merges and deduplicates any usable events.

A genuinely empty ESPN response is cross-checked once with NCAA as well. This
covers a source disagreement without multiplying requests on the normal
non-empty path. An empty placeholder response is never treated as a legitimate
no-games response. These distinctions fix the original blank-scoreboard
behavior and keep the first page's normal path to one inspectable request plus
at most one exact fallback check.

### Browser-safe Reader transport fallback

The hosted preview can have two separate network failures: the Node relay may
not be allowed to make outbound TLS connections, and a browser may reject a
direct provider request because of CORS. After the same-origin relay and direct
ESPN/NCAA host attempts, `app.js` tries the free Jina Reader transport:

```text
https://r.jina.ai/http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=YYYYMMDD&limit=300
```

The Reader fetches that exact public provider URL and returns the provider JSON
inside its documented response envelope (or its text-mode `Markdown Content`
form); the adapter strips only that envelope and then runs the same strict
ESPN/NCAA payload validation. A short cache bucket is added to the Reader target
so a live fallback is not held indefinitely in Reader cache. The Reader is
transport only — it does not invent games or replace ESPN/NCAA as the source of
truth. The public Reader service is rate-limited, so it is deliberately after
the app relay and direct provider requests, and polling remains conservative.

Independent checks on 2026-08-26 fetched ESPN JSON through the Reader for the
empty current date (`20260826`), the upcoming Aug. 29 slate, the Jan. 19 CFP
final, the 14-day range used for adjacent-game discovery, and the pre-game
summary endpoint. Those responses retained the provider's JSON structure.

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

These were called directly rather than accepted from search-result marketing
copy:

- Big Balls Sports Data: `GET https://api.bigballsdata.com/v1/matches?sport=american_football&league=ncaaf`
  returned HTTP JSON saying `missing API key`; the advertised free tier still
  requires creating a key, so it cannot be embedded as a keyless source.
- SportSRC: `GET https://api.sportsrc.org/?data=matches&category=american-football`
  returned JSON, but the observed rows were streaming listings for mostly
  Division II games with null team fields and no scores. Its `football`
  category returned soccer, not American football. It is not suitable for this
  FBS scoreboard.
- CollegeFootballData advertises useful college-football data, but its bearer
  key is required; it is not a key-free scoreboard source.
- API-Sports advertises NCAA coverage and a free quota, but account/API-key
  setup is required and was not used here.
- CBS Sports and NCAA.com rendered scoreboard pages contain useful schedule
  text, but neither was adopted as an HTML scraper when the structured ESPN
  and NCAA JSON contracts were available.
- Public CORS proxies were tested as network fallbacks. `api.allorigins.win`
  returned a server error, `corsproxy.io` explicitly refused the ESPN domain,
  and `api.codetabs.com` returned a Cloudflare 522 in the direct checks. They
  remain only after the app relay, direct provider hosts, and Reader transport;
  they are third-party infrastructure, not the scoreboard's source of truth.

## Date and nearby-game behavior

ESPN's `dates=` filter is an Eastern calendar date. The app therefore uses
`America/New_York` for the current date, kickoff labels, and ranged-response
grouping. It does not silently interpret a late UTC kickoff as a different
scoreboard day.

For each loaded date, nearby discovery requests the next and previous 14-day
windows without `groups=` and filters the complete event objects locally. If a
range returns no matching day or is unusable, it retries one request per
enabled conference when possible, then scans the exact NCAA date query from
the near edge of the window and stops at the first matching day. A valid empty
range is kept as a non-network-error result, but is still checked against NCAA
so a provider disagreement cannot hide an upcoming or prior slate. The
current season calendar is also used for an offseason jump window when ESPN
supplies one; if it is unavailable, bounded season-boundary windows are probed
through the exact NCAA date source instead. Results are grouped by Eastern day
and remain clickable.

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
provider-host alternative, direct access, the browser-safe Reader transport,
and finally the older public proxy chain. The Reader target is not added to the
relay allowlist because it is a client-side transport fallback; the server
relay itself remains restricted to the actual ESPN/NCAA hosts. Diagnostics
identify the source, provider, relay/proxy status, counts, and last update.

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
5. The exact Reader URLs were called independently for the current empty
   date, the Aug. 29 upcoming slate, the Jan. 19 final, the adjacent-game
   range, and a pre-game summary. Both the Reader text form and its documented
   JSON-envelope form were parsed in the adapter tests.
6. The exact Big Balls Data, SportSRC, allorigins, corsproxy.io, and
   api.codetabs.com candidates were called independently; their observed
   authentication, coverage, or transport failures are recorded above rather
   than treated as working providers.
7. `npm test` passes **68 offline checks**, including syntax, URL construction,
   Reader normalization/fallback behavior, ESPN response validation, NCAA
   scoreboard/detail parsing, conference filtering, single-day date filtering,
   real ESPN fixtures, date boundaries, merge/deduplication, live and final
   view models, and the running server's health/static/security routes.

A real Chromium browser was also executed against the running local app using
an extracted Chromium binary and its bundled NSS/NSPR libraries. The actual
page rendered without a `pageerror`, and the browser captured the same-origin
relay, direct-provider, Reader, and public-proxy attempts. In this sandbox,
all live upstream requests were blocked or reset, so that run honestly showed
`games: 0` and the visible network error. It proves the browser shell and
failure state, not successful live data delivery.

A separate real-browser smoke run intercepted the provider requests with
known response bodies and rendered the NCAA fallback's live/upcoming/final
rows, the adjacent upcoming/recent cards, and the fresh-visit next-game-day
navigation. That proves the end-to-end DOM path with a browser, but it is not a
live-provider proof. The browser path has three progressively independent ways
to receive real provider data in an environment with outbound access: the
same-origin relay, direct provider fetch, and the documented Reader transport.
The UI shows source/provider diagnostics and an explicit network error instead
of rendering an unexplained blank slate if all are unavailable.

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
