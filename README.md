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
node test/perf-harness.js app.js --minutes=10   # offline load/rate-limit simulator (see item 19)
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
| Game detail | `.../summary?event={eventId}` returned the box score, drives, plays, and recap for a completed game. The parameter is `event`; `gameId` is not interchangeable. Its `drives` section arrives in at least two live shapes — a plain array, and `{"previous": [...]}`; both are parsed (see “Historical game backfill”). |
| Historical play-by-play index | `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/{eventId}/competitions/{eventId}/plays?limit=400[&page=N]` returned the full paginated play collection for the same event id (168 plays for event 401769074), with items shaped like summary plays. Used only as a backfill when the summary document has no usable plays or cannot be transported. |
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

Initial independent checks on 2026-08-26 fetched ESPN JSON through the
Reader for the empty current date (`20260826`), the upcoming Aug. 29 slate,
the Jan. 19 CFP final, the 14-day range used for adjacent-game discovery, and
the pre-game summary endpoint. Those responses retained the provider's JSON
structure; the endpoint contracts and current-date NCAA response were repeated
on 2026-08-27.

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

### Historical game backfill (2025-season and older games)

Old games are not stored anywhere by this app — they are re-fetched on demand,
and the providers still serve them (the 2025 season was re-verified on
2026-08-28; see the verification list). Getting a past game's play-by-play to
render is a retrieval problem in three independent places, and each is now
covered by an explicit fallback:

1. **Summary shape variance.** `summary?event=` does not serve one `drives`
   shape. A 2025-11-08 regular-season summary (event 401752763) returns
   `drives: [...]`, while a 2026-01-09 CFP semifinal summary (event 401769074)
   returns `drives: {"previous": [...]}`. Reading only the array form hid
   every play of the postseason game even though the provider returned all of
   them ("no pbp data" on an old game). `summaryDrivesOf` accepts both
   envelope forms plus the optional `drives.current` of a live game, and the
   extractor also drops provider re-issues (the same play listed twice in one
   drive under one sequence number, observed live in event 401769074).
2. **Summary transport failure / trimmed summaries.** The summary document for
   a completed game is several hundred KB. When it parses but carries no
   plays — or every transport allowed in the visitor's environment fails on
   it — the app backfills PBP from the much smaller, paginated ESPN Core API
   plays collection for the same event id (168 plays were indexed for event
   401769074). The game view is badged "ESPN Core backfill" and the
   diagnostics footer records `detailSource`.
3. **Different id namespaces.** ESPN event ids and NCAA contest ids are
   unrelated namespaces, but a game is uniquely identified by its Eastern
   date and both teams. If the ESPN detail cannot be retrieved at all, the
   app cross-walks the clicked game to the same-day NCAA contest
   (conservative team-name matching on both the away and the home side; a
   miss is preferred over a wrong match) and serves the verified NCAA detail
   pipeline (overview, play-by-play, boxscore, team stats). Verified: ESPN
   event 401769074 ↔ NCAA contest 6531853 (Oregon at Indiana, 2026-01-09).

The NCAA detail normalizer also learned two facts from the live 6531853
feed: play texts repeat the quarter clock as a `"(MM:SS)"` prefix (now
stripped like ESPN rows), and an NCAA PAT is rendered `"… kick attempt good"`
— it must be tagged `PAT`, not mistaken for a field goal.

## Live booth — flags & reviews

The scoreboard carries a **Live booth · flags & reviews** feed, ported from the
NFL scoreboard's booth. It is a chat-style list of every penalty, coach's
challenge, replay review and play-under-review from **all of the selected
day's games**, plus a **Flags & Reviews** tab and a **Red Zone** tab inside each
game. There is no manual input: the app discovers flags/reviews itself from the
same play-by-play it already fetches.

How it is driven (pure reshapes of the verified ESPN/NCAA play objects the app
already normalizes — see `boothClassify`, `boothEvents`, `dayBoothFeed`):

| Concern | Behavior |
|---|---|
| What counts as a booth event | A play whose text/type is a penalty, a coach's challenge, a replay review, or an under-review play. A flag that is published only as the trailing phrase `PENALTY <team> <foul> (<player>) <yards> yards from <spot> to <spot>` on the preceding row (`isPenalty:false`) is still caught (verified in the summary fixture). |
| Score before → during → after | Rebuilt from the running `awayScore`/`homeScore` ESPN publishes on each play, scanning forward for a rolled-back score only when the event could actually rule on it (a scoring/nullification play, a review/challenge/replay, or a penalty right after a score). A routine kickoff/punt foul cannot remove a prior score. |
| Nullified scores only | A nullified-score event is surfaced only when the play text mentions a score (TD, FG, PAT, 2-pt conversion, safety) **and** the text/verdict wipes it (`nullified`, `No Play`, `reversed`, `overturned`, `overruled`, `void the score`, `erased`). Ordinary plays are never flagged as nullified. |
| Red zone | Opponent's 20 or closer, from the verified `start.yardsToEndzone` with a `downDistanceText`/goal-to-go fallback. An unknown distance is `null` — never guessed. |
| All-games day feed | One merged, chat-ordered list (kickoff order), first occurrence wins; a play later re-issued (e.g. `under review` → `overturned`) replaces its row in place. |
| Polling | Score/status refresh from the ESPN scoreboard-header feed every **250 ms** while the tab is visible and a live game exists (`LIVE_SCORES_INTERVAL_MS`, one request in flight at a time; the header is a single small feed for the whole slate, so rows update at scoreboard speed without 39 per-game polls). Play-by-play scanning is scheduled per game by `boothRefreshPlan` with a **1000 ms** minimum interval per game (`LIVE_REVIEWS_INTERVAL_MS`), widened so a full live day never exceeds about 2.5 summary fetches per second (`BOOTH_BUSY_DAY_GAME_MS`, max 2 concurrent, max 8 per pass / 12 on the seeding pass). The full scoreboard reload runs every 15 s while any game is live and every 60 s otherwise (`SCOREBOARD_INTERVAL_MS` / `SCOREBOARD_IDLE_INTERVAL_MS`). A final is fetched exactly one more time after the clock stops, and games whose scoreboard entry says `playByPlayAvailable: false` are never polled. |

**NCAA wording.** The college-football feed shares ESPN's play-by-play writer
with the NFL, but the referee announcements differ, so the booth never applies
NFL wording blindly:

- An accepted foul that wipes a down is announced as **"No Play"** and NCAA
  Rule 10 states the **"play is nullified"** (vs. the NFL's "nullified" too, but
  the app accepts the NCAA-specific `No Play` / `void the score` / `erased`
  forms so college games are matched from evidence, not assumed).
- NCAA replay results are announced only as **"upheld"** or **"overturned"**
  starting with the **2025** season (the old `confirmed` / `stands` language
  was retired). The booth matches both the new NCAA language and the older
  ESPN/NFL wording so 2025 and pre-2025 games are both handled.

Verified wording evidence (used to build the classifiers, reviewed line by
line):

- NCAA Football Rules (Rule 10 penalty enforcement; "Play is nullified",
  "void the score", fouls during/after a TD, FG or Try) —
  `https://rulebook.github.io/en/interpretations/rules/10/`,
  `http://fs.ncaa.org/Docs/stats/Stats_Manuals/Football/2020.pdf`,
  `https://www.sdcfoa.org/ncaa/rule-10-penalty-enforcement/college-10-2-5`,
  `https://www.sdcfoa.org/ncaa/rule-8-scoring`.
- 2025 NCAA instant-replay announcements ("upheld"/"overturned" only) —
  Wikipedia "Replay review in gridiron football" (`https://en.wikipedia.org/wiki/Replay_review_in_gridiron_football`)
  and the NCAA All Divisions Instant Replay Coaches Manual; ESPN's replay
  coverage (`https://www.espn.com/college-football/story/_/id/9796302/replay-leaves-some-uncertainty-field`)
  uses the same "upheld"/"reversed" language.
- The penny-flag shape (`isPenalty:false` + trailing `PENALTY <team> …`) was
  confirmed verbatim in the verified `summary.json` fixture.

The booth is added in three files: `index.html` declares the `#day-booth`
section, `styles.css` styles the booth, and `app.js` carries the pure engine +
browser wiring. The offline suite covers it (`test/run.js`, "live booth").

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
so a provider disagreement cannot hide an upcoming or prior slate. For the
selected day itself, an empty-but-valid ESPN slate is only accepted as "no
games" when that request genuinely succeeded (it is still cross-checked
against NCAA, which can revive the slate). When the day request *fails* with a
transport or rate-limit error, a valid-but-empty NCAA response is held only as
a safety net while per-conference ESPN recovery runs first, so a throttled
provider can never paint a real game day as empty; if every path failed and
NCAA alone reports no contests, the day renders empty with the transport error
kept visible. The
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
- the ESPN Core API plays collection on `sports.core.api.espn.com` (numeric
  event/competition ids only — the historical PBP backfill index)
- NCAA GraphQL root on `sdataprod.ncaa.com`
- the documented NCAA-backed scoreboard and game-detail paths on
  `ncaa-api.henrygd.me`

Other hosts, protocols, methods, URL paths, and file traversal attempts are
rejected.

The relay adds two provider-load controls for exactly this scoreboard's poll
pattern (documented in `server.js`): a one-second micro-cache (tunable via
`RELAY_CACHE_TTL_MS`, `0` disables it) that only stores successful JSON
responses of at most 64 entries / 8 MB, and per-URL request coalescing —
concurrent identical requests share one upstream fetch, so 39 header rows
refreshing through one relay cost one ESPN call per second at most. Responses
carry `X-Relay-Cache: hit|shared|miss`, and a joined request receives the
shared outcome verbatim including non-200 statuses, so rate-limit information
never gets hidden by caching. If the relay cannot reach a provider, the client tries the verified
provider-host alternative, direct access, the browser-safe Reader transport,
and finally the older public proxy chain — with one exception that matters
under load: when any attempt fails with an upstream 429, the remaining
transports are skipped for the rest of that request, because replaying a
throttled request through a third-party proxy multiplies the exact load ESPN
just refused and burns the keyless Reader's ~20-requests-per-minute budget
for no chance of success. The Reader target is not added to the
relay allowlist because it is a client-side transport fallback; the server
relay itself remains restricted to the actual ESPN/NCAA hosts. Diagnostics
identify the source, provider, relay/proxy status, counts, and last update.

## Repository review and verification

The implementation was reviewed across the complete data path: URL builders,
provider fallback order, response validation, conference filtering, NCAA
normalization, date math, merge/deduplication, rendering, hash routing, deep
links, live polling, detail parsing, server allowlisting, path confinement,
and the offline test runner.

Current verification performed on **2026-08-27**:

1. The live ESPN no-group scoreboard for `20260827` returned a valid empty
   slate with its 2026 season calendar, while `20260829` returned complete
   upcoming events. The live ESPN range `20260110-20260131` returned the CFP
   event at `2026-01-20T00:30Z`, which the app correctly groups as the Eastern
   date `20260119`.
2. The live NCAA persisted query for `20260827` returned a valid empty
   `data.contests` array; the same query for `20260829` returned the upcoming
   FBS contests and for `20260119` returned the completed CFP contest.
3. ESPN no-group ranges for `20260827-20260909` and `20260110-20260131`
   returned complete events; single-group requests for `groups=1` and `5`
   returned the January 20 championship event; comma-separated group requests
   returned placeholder events and are rejected by the app.
4. ESPN event `401856766` was verified as North Carolina at TCU on
   `2026-08-29T16:00Z`, with venue Aviva Stadium. Its summary returned a valid
   pre-game shape with teams and a scheduled header date.
5. The exact current NCAA persisted query above returned `data.contests` for
   both `contestDate` and `week` variables. FBS division `11` and football
   code `MFB` were confirmed from the current public adapter contract.
6. The NCAA-backed game overview and completed-game detail routes were called
   independently; optional-route failures are handled rather than assumed
   away.
7. The exact Reader URLs were called independently for the current empty
   date, the Aug. 29 upcoming slate, the Jan. 19 final, the adjacent-game
   range, and a pre-game summary. Both the Reader text form and its documented
   JSON-envelope form were parsed in the adapter tests.
8. The exact Big Balls Data, SportSRC, allorigins, corsproxy.io, and
   api.codetabs.com candidates were called independently; their observed
   authentication, coverage, or transport failures are recorded above rather
   than treated as working providers.
9. `npm test` passes **108 offline checks**, including syntax, URL construction,
   Reader normalization/fallback behavior, ESPN response validation, NCAA
   scoreboard/detail parsing, conference filtering, single-day date filtering,
   real ESPN fixtures, date boundaries, merge/deduplication, live and final
   view models, the historical-backfill fixtures below, the live booth engine
   (including the row-level `lastPlayBooth` helper, the `boothRefreshPlan`
   scheduling policy, provider-gate lane priority, rate-limit fail-fast, and a
   definedness scan of every scoreboard/booth wiring function), and the running
   server's health/static/security routes including relay shared-flight
   coalescing.

Additional verification on **2026-08-28** (the reported 2025-season case):

10. `summary?event=401769074` (Oregon at Indiana, CFP Peach Bowl semifinal,
    2026-01-09) was fetched in full. It returned the complete box score and a
    `drives: {"previous": [...]}` envelope — the shape that previously
    produced an empty play-by-play tab. Drive `4017690742` lists one
    interception touchdown twice (`sequenceNumber: "2"` with play ids
    `40176907417` and `401769074763`); the parser now renders it once. The
    same-day scoreboard (`dates=20260109`) returned the complete final event.
11. The Core API plays collection for that event
    (`sports.core.api.espn.com/.../events/401769074/competitions/401769074/plays`)
    reported `count: 168` over 34 default pages; its items carry the same
    fields the summary play normalizer consumes (confirmed verbatim in the
    backfill fixtures).
12. The NCAA persisted query for `contestDate 2026-01-09, seasonYear 2025`
    returned contest `6531853` (Indiana 56, Oregon 22, `hasPbp: true`), and
    `ncaa-api.henrygd.me/game/6531853[/play-by-play]` returned the overview
    and full play-by-play — the inputs of the cross-provider backfill.
13. The ESPN single-day scoreboards for 2026-08-22, 2026-08-23, and
    2026-08-28 each returned a valid empty slate with the 2026 season
    calendar attached (no games before the Aug 29 opener weekend —
    confirmed, not an error state).
14. The live NCAA Core API play-by-play for event 401769074 (see item 11)
    confirmed the field-position fields the booth reads: each play carries
    `start`/`end` with `yardsToEndzone`, `downDistanceText`, `possessionText`,
    and `teamParticipants` with an offense/defense `id`. `scoreValue` is also
    present, so a score's point value is read from the data rather than
    inferred.
15. The live NCAA scoreboard header
    (`site.web.api.espn.com/apis/v2/scoreboard/header?sport=football&league=college-football`)
    returned `sports[].leagues[].events[]` with `id`, `competitionId`, `status`
    (pre/live/final), `fullStatus.clock/displayClock/period/detail`, and
    `competitors[].score/homeAway/winner` — the feed the booth's 250 ms
    score/status poll reads (same shape as the NFL header feed).

Scoreboard-load verification on **2026-08-28** (the "extremely slow / no games
on this date" report; all claims re-verified live before and after the change):

16. The live scoreboard for `20260829` (`site.api.espn.com/.../scoreboard?dates=20260829`)
    returned the full 39-game Week-1 slate again, and its
    `competitions[].playByPlayAvailable: false` on pre-game events was confirmed
    as a real provider field — the booth plan now uses it to skip games that
    cannot have play-by-play yet.
17. The scoreboard-breaking defect was located line by line: `gameRowHtml`
    called an undefined `lastPlayBooth` helper for every row; the thrown
    `ReferenceError` aborted the render between fetch and paint, so every
    game day ended as "No games on this date" while the fetch itself had
    succeeded. A `rebuil`→`rebuild` typo (two sites) had likewise silently
    disabled per-game booth rebuild from the detail route. Both are fixed and
    regression-tested.
18. The slowness root cause was provider self-inflicted congestion: the booth
    re-fetched the full ~380 KB summary of every live game at a fixed
    1000 ms, sharing the browser's six-socket pool and ESPN's tolerance with
    the scoreboard; under a 39-game slate the day loads queued behind (and
    competed with) hundreds of booth requests, tripping 429s and cascading
    into Reader/proxy fallbacks. The fix paces the booth behind a priority
    gate (lanes: user, aux, booth with hard caps), adapts the scan interval to
    the number of live games, serializes the 250 ms header ticker, micro-caches
    and single-flights the same-origin relay, and makes 429s fail fast instead
    of replaying through third-party transports. The booth still scans every
    game of the day — the harness confirms "39 of 39" and identical feed
    content before vs. after (156 events across the simulated slate).
19. An offline load simulator, `test/perf-harness.js` (virtual clock, 6-socket
    per-host browser pools, token-bucket rate limiting in front of simulated
    ESPN hosts sized from the verified live payloads, ~20 rpm Reader budget),
    reproduces and measures the failure and the fix. Over a simulated 10
    minutes of a 39-game live day: HEAD paints **nothing** (4× `ReferenceError`);
    the `lastPlayBooth`-only repair paints in 151 ms but drives **6,010**
    upstream requests with real 429 storms on every host (292 on
    `site.api`, 455 on the Core-API fallback) and 178 Reader-budget hits; the
    complete fix runs **3,211** requests with **zero 429s**, no
    proxy/Reader/Core fallback use, queue depth ≤ 1 everywhere, 151 ms first
    paint, ~277 ms day-switch, and the full booth feed with 0 uncaught errors.
    Run it with `node test/perf-harness.js app.js --minutes=10
    --json-out=metrics.json`.
20. Two harness corrections were needed during this work (microtask drain
    between virtual timers; recurring timers keeping their identity across
    re-registration so `clearInterval` reaches them). The initial 2026-08-28
    harness passes had reported the `lastPlayBooth`-only build as showing an
    empty board; that was a harness scheduling artifact inflating the request
    flood, and after fixing the scheduler the honest reproduction is item 19 —
    recorded here because the earlier numbers circulated during review.
21. The suite grew to **108** checks: `lastPlayBooth` behavior,
    `boothRefreshPlan` (live pacing floor, final-exactly-once,
    `playByPlayAvailable: false` skip, per-pass caps, seed pass ordering),
    provider-gate lane priority/cap/FIFO against a blocked pool, `isRateLimitError`,
    a stub-`fetch` test proving a 429 stops the transport chain before Reader
    or proxies are touched, a definedness scan over every scoreboard/booth
    wiring function, and relay single-flight coalescing.
22. The relay's **200-response micro-cache was verified end to end** on
    2026-08-28, not just by unit test. This sandbox has no outbound HTTPS, so
    the offline suite could only prove the relay's error and single-flight
    paths; the cache-hit path was previously undemonstrated. It was closed by
    resolving the allowlisted host `site.api.espn.com` to a local HTTPS
    stand-in (temporary `/etc/hosts` entry plus a throwaway TLS certificate
    trusted only through `NODE_EXTRA_CA_CERTS`, both reverted afterwards) that
    counted the requests actually reaching it. Through the unmodified relay,
    **12 client requests produced 2 upstream calls**: ten concurrent identical
    requests returned one `X-Relay-Cache: miss` and nine `shared` from a single
    upstream fetch, a repeat inside the TTL returned `hit` with no upstream
    call, and a request after the TTL expired returned `miss` with exactly one
    new upstream call. `server.js` was not modified for this test and still
    performs normal TLS verification (no `rejectUnauthorized: false`).

The booth verification list above (item 15) is the score/status source: ESPN
NCAA header events mirror the NFL scoreboard header the NFL booth polls at
250 ms, so the same frame is used on the college side.

A real Chromium browser was also executed against the running local app using
an extracted Chromium binary and its bundled NSS/NSPR libraries. The actual
page rendered without a `pageerror`, and the browser captured the same-origin
relay, direct-provider, Reader, and public-proxy attempts. In this sandbox,
all live upstream requests were blocked or reset, so that run honestly showed
`games: 0` and the visible network error. It proves the browser shell and
failure state, not successful live data delivery.

Separate real-browser smoke runs also covered both deployment paths. With
controlled response bodies, a fresh visit to a local server advanced from the
empty `20260827` slate to `20260829` and rendered live/upcoming/final rows,
adjacent upcoming/recent cards, and a game detail view. A second run used a
real Chromium origin mapped to the GitHub Pages hostname; it made no
`/api/espn` request, fell through to the Reader transport, and rendered the
same scoreboard with `staticDeployment: true` and `proxy: jina-reader`. Those
controlled-response runs prove the end-to-end DOM and static-host paths, but
are not live-provider proofs. An un-intercepted Chromium run against the local
app and an un-intercepted Pages-shaped origin made the real relay/direct/
Reader/public-proxy attempts; all upstream requests were blocked or reset in
this sandbox, so those honest runs showed `games: 0` and the visible network
error rather than inventing data. The browser path has three progressively
independent ways to receive real provider data in an environment with outbound
access: the same-origin relay, direct provider fetch, and the documented Reader
transport.

## Files

```text
server.js                         static server, health check, allowlisted relay (1 s shared micro-cache, per-URL single-flight)
index.html                        scoreboard shell, #day-booth booth section, diagnostics footer
styles.css                        responsive dark scoreboard/detail UI, booth styling
app.js                            provider clients, parsers, live booth engine + wiring, UI, routing, polling
test/run.js                       zero-dependency offline test runner (108 checks, incl. live booth + load-policy units)
test/perf-harness.js              offline load simulator: virtual clock, per-host socket pools, provider rate-limit emulation
test/fixtures/scoreboard-event.json       verified ESPN final-game fixture
test/fixtures/summary.json                verified ESPN summary/PBP/stats fixture
test/fixtures/ncaa-scoreboard.json        verified NCAA contest-shape fixture
test/fixtures/ncaa-game.json              verified NCAA game-shape fixture
test/fixtures/summary-401769074.json      verified {previous}-envelope postseason summary
test/fixtures/espn-core-plays.json        verified ESPN Core API plays items
test/fixtures/ncaa-scoreboard-20260109.json  verified NCAA feed for the crosswalk case
```
