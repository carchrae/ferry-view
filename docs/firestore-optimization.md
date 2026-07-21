# Firestore read optimization — proposal & aggregate-windowing analysis

Status: **proposal only, not implemented** (July 2026). Firestore reads are the
project's largest cost; this doc records the audit, the recommended change, and
an analysis of splitting `aggregates/bowenSailings` into per-time-window docs.

## 1. Audit findings

### Aggregate docs today

| Doc | Data | Window | Size | Rewritten |
|---|---|---|---|---|
| `aggregates/bowenSailings` | To-HSB sailings with media: capacity, photo paths, timelapse frame **epochs** (not paths), crosswalk time. ~590 records. | 42 days | ~280 KB (28% of 1 MB limit) | Every webcam photo / timelapse frame / crosswalk report (transactional upsert) + nightly 03:20 full rebuild |
| `aggregates/historicalStats` | Departure/capacity scalars, both directions. ~1,700 records. | 8 weeks, ends yesterday | ~130 KB (13%) | Nightly 03:10 only |
| `aggregates/leaderboard` | Reporter + rider boards, 100 entries each | 30 days rolling | ~50 KB (5%) | Every capacity report / lineup report / ride write + daily 03:00 |

Size verdict: all healthy. Only `bowenSailings` needs watching; the
frame-epoch-suffix trick (13 chars/frame instead of a ~65-char storage path)
is load-bearing — full paths would put the doc at ~1.2 MB, over the limit.

### Per-user read costs (normal case, aggregates healthy)

| Flow | Reads | Notes |
|---|---|---|
| HomePage mount | ~5–13 | All single-doc / small live queries |
| HistoryPage mount or refresh | 1 | Aggregate only |
| LeaderboardPage mount | 1 | Live-subscribed aggregate |
| **BowenDeparturesPage mount** | **~170–520** | Full 30-day `capacityHistory` scan + 14-day `lineupReports` scan for report chips, plus a redundant double read of the aggregate (getDoc + subscription initial) |
| **BowenDeparturesPage refresh click** | **~170–520** | Same scans, no cache |
| **Leaderboard user-row click** | **~200–500 per click** | Re-scans both collections to filter to one user (credits need other users' reports, so the scan is currently structural) |
| Rides / settings pages | 1–10 | Fine |

No Firestore reads exist in any polling loop; the big fallback scans
(`sailingStatus`, up to ~1,700 docs) only run when an aggregate is missing or
stale and are cached. The waste is concentrated in the two bold rows.

### A cost the read-count table hides

Every `upsertBowenSailing` (each webcam frame — up to ~1–2/min during active
departure windows) rewrites the whole aggregate, and every live subscriber on
the departures page is then sent the full ~280 KB doc: 1 billed read but
~280 KB of egress per snapshot. A client idling on the page through an active
hour costs ~60 reads and ~15–20 MB of egress. Reads are billed identically in
every design below; egress and doc-size headroom are where the designs differ.

## 2. Recommended proposal (Design 1): single doc + embedded reports + live delta queries

Goal: today's report chips update live; older chips may be nightly-fresh; no
feature loss.

1. **Server** (`functions/lib/bowen-sailings-aggregate.js`): the nightly
   rebuild additionally scans `capacityHistory` (userReport==true) and
   `lineupReports` over the same 42-day window (~600 reads nightly,
   negligible) and embeds latest-per-user reports on each sailing record:
   `r: [{u,n,c,at}]`, `cwr: [{u,n,cw,at}]` (uid, userName — already null for
   anonymous reporters, value, recordedAt). Adds a top-level `reportsAsOf`.
   Reuse `latestPerUser` from `functions/lib/leaderboard-score.js` (export it).
   `upsertBowenSailing` needs no change (it preserves unknown fields).
   Size: ~730 entries × ~90 B ≈ +66 KB → ~350 KB (~33% of limit).
2. **Client live delta**: two `onSnapshot` queries with cutoff
   `sinceMs = min(reportsAsOf, startOfToday)` (fallback now−36 h):
   `capacityHistory` where userReport==true AND recordedAt>=sinceMs;
   `lineupReports` where recordedAt>=sinceMs. Initial snapshot ~5–30 docs,
   then 1 read per new report, live. No new indexes — the
   `(userReport, recordedAt)` composite already exists; the lineup query is
   single-field. Anything tagged since the last rebuild is live, including
   late tags on old sailings.
3. **Client merge** (`BowenDeparturesPage.vue`): `reportsByKey`/
   `crosswalkByKey` become embedded ∪ live ∪ optimistic; existing
   latest-per-user dedupe resolves overlap; everything downstream (chips,
   credits, disagreement badges/filters) unchanged. Drop the mount-time
   `getDoc` (subscription seeds the page; a stale-aggregate signal triggers
   the legacy scan fallback once). Refresh button stays but becomes a single
   forced aggregate read.
4. **Leaderboard dialog**: 5-min module caches on `loadRecentUserReports` /
   `loadRecentLineupReports` (mirroring `useBowenSailings`' cache pattern),
   shared across the board fallback, the user dialog, and the HomePage
   champion fallback. First open still scans; repeats are free.

Outcome: departures mount ~170–520 → **~6–31** reads; refresh → **1**;
repeat leaderboard clicks → **0**.

Deploy order: verify indexes (no-op) → functions + manual
`rebuildBowenSailings` seed → client (degrades gracefully if `reportsAsOf`
is absent).

## 3. Windowed-aggregate analysis

The alternative: split `aggregates/bowenSailings` by time window, e.g.

- `aggregates/bowenSailingsToday` — today's sailings
- `aggregates/bowenSailingsWeek` — the 7 days up to and including yesterday
- `aggregates/bowenSailingsArchive` — weeks 2–6

with reports embedded in each window's doc (today's by trigger, older windows
nightly), so the client reads 3 docs and subscribes live only to the today
doc — no raw-collection queries at all.

### Sizes per window (same arithmetic as above)

| Doc | Records | Base size | + embedded reports | Total | % of 1 MB |
|---|---|---|---|---|---|
| Today | ~14 | ~7 KB | ~2 KB | **~9 KB** | ~1% |
| Week (7 d) | ~98 | ~47 KB | ~11 KB | **~58 KB** | ~6% |
| Archive (35 d) | ~490 | ~235 KB | ~53 KB | **~288 KB** | ~27% |

### Tradeoffs

| Dimension | Design 1: single doc (recommended) | Design 2: today + week + archive | Design 2b: today + rest (2 docs) |
|---|---|---|---|
| Mount reads | 1 aggregate + ~5–30 delta query docs | **3** (1 live + 2 one-shot) | **2** |
| Live update reads (today activity) | 1 per aggregate rewrite **+** 1 per new report (delta query) | 1 per today-doc rewrite (reports ride the same doc) | same as Design 2 |
| Egress per snapshot while page open | **~350 KB** every frame/report (~20 MB/hr during active sailings) | **~9 KB** (~0.5 MB/hr) — 30–40× less; week/archive docs static | ~9 KB |
| Server upsert transaction weight | Reads+rewrites ~350 KB per webcam frame | Reads+rewrites ~9 KB | ~9 KB |
| 1 MB headroom | ~33% used; single doc absorbs all future growth (more frames, more embedded data) | Worst doc ~27%; each window grows independently — much more future headroom | Rest-doc ~46%; still comfortable |
| Report liveness | Live via delta queries (needs the 2 extra queries + merge) | Live via today-doc trigger embeds — **no raw-collection client queries at all** | same |
| Trigger changes | None (nightly only) | `onCapacityReport`/`onLineupReport` must embed report entries into the today doc (small new code) | same |
| Midnight rollover | None | Needed: nightly job moves today → week → archive; between 00:00 and the 03:20 rebuild the "today" doc must still carry yesterday (define window as "since last rebuild", not calendar-day) | Same, one boundary instead of two |
| Client complexity | Merge embedded + live-query + optimistic reports | Merge 3 docs + optimistic; 3 stale guards, 3 fallbacks | Merge 2 docs |
| Stale/fallback logic | 1 guard (exists today) | 3 guards; a missing archive must not blank 5 weeks of history | 2 guards |
| Billed read cost | Baseline | +1–2 reads per mount; slightly **fewer** live reads (report writes don't add a second read) | +1 per mount |

### Assessment

- **Billed reads are nearly identical across designs** — Firestore charges per
  document read regardless of size, and the dominant live cost (one read per
  today-rewrite for each subscriber) is the same everywhere. Windowing is
  **not** a read-cost optimization.
- Windowing wins on **egress bandwidth** (~30× less pushed to each open
  departures page), **server transaction weight** (9 KB instead of 350 KB
  read-modify-write per webcam frame), and **doc-limit headroom** (the growth
  risk concentrates in the stable archive doc). It also eliminates the two
  client delta queries, since today's reports can ride the today doc.
- Windowing costs **complexity**: midnight rollover, three seed/rebuild paths,
  three stale guards, and trigger changes. The 3-way split adds little over a
  2-way (today + rest) split — the week/archive distinction only matters if
  the "rest" doc ever nears the limit, which at ~46% it doesn't.

### Recommendation

Implement **Design 1 now** — it fixes the actual billed-read waste (the
~170–520-read scans) with minimal moving parts and no trigger changes.
Treat windowing as the prepared second step: if the aggregate passes
~500 KB, or egress shows up in billing, split **two ways** (today + rest,
Design 2b) and drop the delta queries at that point. An orthogonal lever
worth remembering either way: batching timelapse-frame upserts (e.g. one
aggregate write per 2–3 min instead of per frame) directly divides both the
subscriber snapshot reads and the egress, in any design.
