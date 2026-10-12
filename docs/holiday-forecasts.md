# Holiday forecasts

How the "usually +5m / often full / C 2:50pm" hints are built on holidays and
long weekends, the evidence behind it, and what to re-check once there's more
data. Code: `src/lib/holiday-forecast.js` (rules), `functions/lib/holidays.js`
(`dayType`, `holidayKind`), `functions/lib/history-aggregate.js`
(`aggregates/holidayStats`). Backtest: `node scripts/holiday-backtest.mjs`.

**Status (2026-10-12): provisional.** Built from 5 months of data (May 18 –
Oct 11, 2026): 6 holidays and 4 long weekends, nearly all of them summer.
Revisit once Thanksgiving, Remembrance Day and the Christmas season have been
through, and again after a full year (see [Revisit](#revisit)).

## Current rules

Every date is one of three day types (`dayType`):

| Day type | What | Forecast from |
|---|---|---|
| ordinary | everything else, **including the weekdays either side of a holiday** | the same weekday over the last 8 weeks (unchanged) |
| holiday | the statutory holiday itself | holiday rules below |
| long-weekend | a Saturday/Sunday bridging to a holiday | long-weekend rules below |

Holidays and long-weekend days are left out of the ordinary baselines.

Holidays come in three kinds (`holidayKind`), and forecasts only pool holidays
of the same kind:

| Kind | Holidays |
|---|---|
| family | Family Day, Good Friday, Easter Monday, Victoria Day, BC Day, Labour Day, Thanksgiving; Canada Day when it falls on a Monday or Friday |
| day-off | Truth and Reconciliation Day, Remembrance Day, Canada Day midweek |
| christmas | Christmas Day, Boxing Day, New Year's Day (borrows the family holidays until it has history of its own) |

**Fullness and crosswalk**, per sailing, from the first source with data:

- holiday: (1) the same holiday in earlier years, up to 3 → (2) same-kind
  holidays on the same weekday, last 6 months → (3) same-kind holidays, any
  weekday, last 6 months → (4) ordinary Sundays (family/christmas) or the
  ordinary same weekday (day-off)
- long weekend: (1) the same holiday's weekend day in earlier years → (2)
  same-kind long-weekend days of the same weekday, last 6 months → (3) the
  ordinary same weekday

**Lateness** always comes from the ordinary same weekday.

Holiday-sourced hints are worded from as few as 1 past day (ordinary days need
4); the app labels them "holiday forecast" and the sailing dialog says which
days they came from.

## Evidence

Method: hide each holiday-period day, predict every sailing from a candidate
source, and compare with what happened. Errors are mean absolute: lateness in
minutes, % full of sailings leaving HSB, and the crosswalk miss rate for
sailings leaving Bowen (crosswalk tracking started 2026-07-13).

**Holidays are not their weekday.** Boats leaving HSB ran 40–54% full on
holidays against ~66% on ordinary Mondays/Wednesdays, with more crosswalk
lineups leaving Bowen. Summer holidays, average error:

| Source | Lateness | % full | Crosswalk |
|---|---|---|---|
| ordinary same weekday (the app before) | 7.1 | 22.6 | 0.35 |
| other holidays, same weekday | 9.4 | **11.3** | **0.19** |
| ordinary Sundays | 7.2 | 13.4 | 0.24 |
| holidays + the weekdays around them | 7.9 | 21.9 | 0.35 |

**The weekdays around a holiday are ordinary.** The Friday before and Tuesday
after were predicted best by ordinary days of the same weekday (fullness 11.1
vs 11.8; 9.8 vs 10.5). They used to be excluded from the baseline; they're
back in.

**Long-weekend Saturdays/Sundays are their own pattern.** Earlier long-weekend
days of the same weekday beat the ordinary weekday for fullness (6.3 vs 10.8)
and crosswalk (0.13 vs 0.22).

**Lateness isn't predictable from holiday history — it tracks busyness.**
Summer long weekends ran very late (BC Day +18.4, BC Day and Labour Day
Sundays +13 to +16); the fall ones didn't (Thanksgiving Sunday +0.9, Thanksgiving
morning −0.4, Truth and Reconciliation Day 0.0). The holiday pool's lateness
error was worse than the ordinary weekday's every time (summer 9.4 vs 7.1;
Thanksgiving Sunday 13.9 vs 4.0). Across all sailings, lateness climbs with
how busy the boat is:

| Sailing | Avg late |
|---|---|
| leaving HSB, under 40% full | 1.8 min |
| leaving HSB, 40–69% full | 2.9 min |
| leaving HSB, 70–99% full | 4.8 min |
| leaving HSB, Full | 8.6 min |
| leaving Bowen, no lineup to the crosswalk | 3.7 min |
| leaving Bowen, lineup reached the crosswalk | 10.6 min |

(and one boat means a busy morning compounds through the day).

**Holidays differ by kind.** Truth and Reconciliation Day (and Canada Day,
both Wednesdays in 2026) were *quieter* than an ordinary Wednesday — 44–49%
full vs 66%, lineups on 6% of sailings — unlike the family-travel long
weekends. Canada Day predicted Truth and Reconciliation Day almost exactly
(lateness 0.8, fullness 8.5).

**Fall holidays were quieter than summer ones**, though ordinary days were not
(October's ordinary days were as full as August's). Thanksgiving morning
leaving HSB: 13% full against a 47% forecast from the summer holidays. That
was still the best available source (ordinary Mondays: 51).

**Tried and dropped: the earlier days of the same long weekend.** For the
holiday Monday it was worse than other same-kind holidays (fullness 27.1 vs
20.4, crosswalk 0.28 vs 0.14) — the Monday is the travel-home day and looks
nothing like its Saturday. For the Sunday it was mixed (best for Thanksgiving,
worse on crosswalk for the summer weekends).

## Open questions

1. **Lateness from busyness.** Rather than the ordinary weekday's lateness,
   predict a holiday sailing's lateness from its *predicted* fullness/crosswalk
   using the ordinary relationship above (plus the knock-on from earlier
   sailings). The live departure estimate already does a version of this.
2. **Seasonality of holidays.** Do fall/winter holidays need their own pool
   (a "season" dimension on top of kind), or a scaling factor, once there are
   enough of them? Thanksgiving 2026 is the only fall family holiday so far.
3. **Same weekend as a scale signal.** Not as a direct source (dropped above),
   but maybe as a multiplier: was this weekend's Saturday busier or quieter
   than other long-weekend Saturdays? Thanksgiving Saturday/Sunday would have
   correctly signalled "quieter than summer".
4. **Kinds.** Is Family Day really "family"? Easter (Good Friday vs Easter
   Monday)? Canada Day on a Monday/Friday vs midweek? Remembrance Day? No data
   yet for any of these.
5. **Christmas season** — its own pattern once there's a year of it; the days
   between Christmas and New Year's are ordinary by `dayType` but probably
   aren't.

## Revisit

Re-run `node scripts/holiday-backtest.mjs` (pulls staging, a production
restore; refresh staging first) and update this note:

- [ ] after Thanksgiving 2026 is complete (full day of data)
- [ ] after Remembrance Day 2026 (first non-summer day-off holiday)
- [ ] after Christmas / New Year's 2026–27
- [ ] after Family Day and Easter 2027 (first winter/spring family holidays)
- [ ] after a full year (May 2027): same-holiday-last-year (rule 1) starts
  applying; compare it against the pooled rules
