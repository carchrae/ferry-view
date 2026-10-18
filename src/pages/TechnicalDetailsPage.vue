<template>
  <q-page class="q-pa-md tech-page">
    <div class="row items-center q-mb-sm">
      <div class="text-h6 col">Technical details</div>
      <q-btn flat dense no-caps color="primary" icon="menu_book" label="Plain-language version" to="/how-it-works" />
    </div>
    <p class="text-grey-8">
      The rules, constants and evidence behind each technique, with links to the source and to the
      write-up of the experiment that decided it. The code is public at
      <a :href="REPO" target="_blank" rel="noopener">github.com/carchrae/ferry-view</a>; every
      experiment is recorded under
      <a :href="gh('docs/experiments/README.md')" target="_blank" rel="noopener">docs/experiments</a>.
    </p>

    <section id="data">
      <h2>Data sources and fallbacks</h2>
      <ul>
        <li>
          <strong>Status poll</strong>, once a minute: bowenferry.ca's status API (AIS position, the
          "atberth" arrival/departure log, deck space). Writes <code>ferryStatus/current</code>, and
          skips the write when nothing changed.
        </li>
        <li>
          <strong>AIS position fallback</strong> (<code>functions/lib/ais-position.js</code>): when the
          event log freezes but positions keep flowing, a boat parked (speed ≈ 0) within 600 m of a
          terminal is classified as docked there; a change in that classification between polls is
          injected as an Arrived/Departed event. Recovers both directions.
        </li>
        <li>
          <strong>BC Ferries departures scrape</strong> (<code>bcferries-departures.js</code>): the
          server-rendered current-conditions page, used only for Horseshoe Bay → Bowen when both of
          the above are stale.
        </li>
        <li>
          <strong>Seasonal schedule</strong> (<code>seasonal-schedule.js</code>, <code>seasonal-rules.js</code>):
          BC Ferries' HSB–Bowen timetable scraped nightly behind its waiting room, kept as the weekly
          table plus its "Except …" notes; any date in range is derived from it and replaces the feed's
          schedule, which ignores holiday exceptions.
        </li>
      </ul>
    </section>

    <section id="lateness">
      <h2>Lateness</h2>
      <p>
        Lateness is departure time minus scheduled time, from the newest logged departure
        (<code>functions/lib/constants.js</code>). Up to 4 minutes early is on time; ≥ 2 minutes late is
        late; ≥ 6 is red. Push notifications (<code>lateness.js</code>) fire once per subscriber when
        lateness reaches their threshold (default 5, options 5–30 minutes) and reset when the boat
        recovers.
      </p>
    </section>

    <section id="estimate">
      <h2>Departure estimate: simulating the boat forward</h2>
      <p>
        <code>src/lib/departure-estimate.js</code>, pure and unit-tested. The single boat is simulated
        from its last logged arrival or departure: each departure is
        <code>max(scheduled, arrival + loading, now)</code>, each arrival is departure plus crossing.
        Loading time depends on how full the departing sailing is, measured over 14 days of Bowen
        departures where the boat arrived too late to make its slot (2026-09-19 to 10-02):
      </p>
      <table class="tech-table">
        <thead><tr><th>Band</th><th>Point</th><th>Range</th></tr></thead>
        <tbody>
          <tr><td>light (not full)</td><td>12 min</td><td>10–14</td></tr>
          <tr><td>busy (60–99% full)</td><td>18</td><td>16–20</td></tr>
          <tr><td>full</td><td>23</td><td>21–26</td></tr>
          <tr><td>unknown</td><td>14</td><td>11–23</td></tr>
        </tbody>
      </table>
      <p>
        Today's own loading-paced departures shift those defaults and today's crossings set the
        crossing time (default 20 min until three trips exist). The simulation runs with typical,
        fast and slow timings to give a point and a low/high range; the per-sailing "How the lateness
        estimate works" panel shows the timings actually in use.
      </p>
    </section>

    <section id="history">
      <h2>Typical-sailing hints</h2>
      <p>
        <code>src/lib/historical-stats.js</code> aggregates the last 8 weeks of
        <code>sailingStatus</code> (served from a nightly aggregate document, one read instead of
        ~1,700) by direction, weekday and scheduled time. Thresholds behind the words:
      </p>
      <ul>
        <li>late: ≥ 40% of departures late and an average lateness ≥ 3 minutes (<code>LATE_PCT_WARN</code>, <code>LATE_MIN_WARN</code>); severity steps up at a 6-minute average;</li>
        <li>full: ≥ 30% of departures with a rider "Full" report, at least 3 reports (<code>FULL_PCT_WARN</code>, <code>MIN_CAPACITY_REPORTS</code>);</li>
        <li>busy: reported deck space averaging ≥ 60% full (<code>BUSY_PCT_WARN</code>);</li>
        <li>frequency words: "usually" ≥ 60%, "often" 30–59%, "sometimes" below 30% (<code>freqWord</code>); "usually on time" and "rarely full" are the reassurance facts shown when nothing warrants a warning.</li>
      </ul>
      <p>
        <strong>Exceptions:</strong> with at least 4 samples, a departure is an outlier when its
        lateness deviates from the median by more than <code>max(3 × MAD, 12 min)</code> (median
        absolute deviation, with an absolute floor so a very consistent sailing doesn't flag wobble).
        Outliers are excluded from every average and flagged in the history view. Holiday-impacted
        dates are excluded from ordinary baselines (<code>functions/lib/holidays.js</code>).
      </p>
      <p>
        <strong>Prediction check</strong> (<code>predictionCheck</code>): after a sailing departs, each
        call the hint made is scored. A lateness call is right within 5 minutes
        (<code>CHECK_LATE_MIN</code>, with "exact" also recorded). A "full" call is made only when the
        full rate was ≥ 60% or the call came from crosswalk history (<code>CHECK_FULL_PCT</code>) and is
        right when the sailing left full; a "busy" call is right when it left ≥ 70% full
        (<code>CHECK_BUSY_PCT</code>); a "room" call is right when it did not leave full.
      </p>
    </section>

    <section id="holidays">
      <h2>Holiday and long-weekend forecasts</h2>
      <p>
        <code>src/lib/holiday-forecast.js</code> over <code>aggregates/holidayStats</code>. Holidays are
        classified by kind (family-travel long weekend, a day off, Christmas season). Fullness and
        crosswalk come from, in order: the same holiday in earlier years (up to three), same-kind
        holidays on the same weekday in the last six months, same-kind holidays on any weekday, then
        ordinary days. Lateness always comes from the ordinary same weekday, because it tracks how busy
        the boat is and compounds through the day rather than following the date. Provisional; the
        evidence, open questions and backtest script are in
        <a :href="gh('docs/holiday-forecasts.md')" target="_blank" rel="noopener">docs/holiday-forecasts.md</a>.
      </p>
    </section>

    <section id="cameras">
      <h2>Camera capture and attribution</h2>
      <p>
        <code>functions/lib/webcam-decision.js</code> (pure) decides on every poll whether to capture:
        the lineup timelapse from the community camera every 5 minutes from 15 minutes after the
        previous Bowen departure until the ferry is back at the dock, and the departure timelapse from
        the terminal camera every minute from arrival (or T−10) until the ferry leaves. Frames attribute
        to the earliest sailing that hasn't departed, bounded by each sailing's schedule window, so a
        late ferry's photos don't slide onto the next sailing. Details and retention in
        <a :href="gh('docs/webcams.md')" target="_blank" rel="noopener">docs/webcams.md</a>.
      </p>
      <p>
        <strong>Stalled cameras</strong> (<code>webcam-health.js</code>): both cameras burn a clock into
        the frame, so identical bytes across captures mean a frozen feed. The terminal camera's
        once-a-minute cadence tolerates one repeat; the five-minute lineup cadence treats a single
        repeat as conclusive. Capture and classification are suspended per camera while it repeats, and
        the outage is published for the app to show.
      </p>
      <p>
        <strong>Darkness</strong> (<code>daylight.js</code>): the cameras auto-expose, so pixels cannot tell
        night from day; solar elevation can. Below −7° the crosswalk classifier does not run (all 26
        dark-hour detections in a 45-day archive were wrong). The terminal camera has a street light
        and its classifier runs at night.
      </p>
    </section>

    <section id="crosswalk">
      <h2>Crosswalk robot (community camera)</h2>
      <p>
        <code>functions/lib/lineup-classifier.js</code>: logistic regression over downscaled greyscale
        pixels of two regions ("on the hill", "past crosswalk"), trained by
        <code>scripts/train-lineup-classifier.mjs</code> from rider crosswalk marks turned into per-frame
        labels (<code>lineup-labels.js</code>: frames at or after the effective mark are positive).
        The browser runs the same weights for sailings the server hasn't judged.
      </p>
      <p>
        <strong>Live call</strong> (<code>crosswalk-robot.js</code>, pure state machine): the first positive
        frame publishes a report marked "checking" and schedules one-minute check photos; a second
        positive confirms; two misses withdraw. A confirmed call stays correctable until the ferry is
        back at Bowen. Checks are only trusted when frames are consecutive (gap ≤ 7 minutes). Every
        transition is logged on the sailing for scoring. A rider's mark or "not yet" always takes
        precedence (latest valid report wins, <code>effectiveCrosswalk</code>), and a robot detection
        without a standing mark means it was overruled.
      </p>
      <p>
        Scoring is by severity: a detection on a rider-refuted sailing (phantom) costs most, then early
        calls, late calls, misses. Model history, nightly retraining and the current results pages:
        <a :href="RESULTS + 'crosswalk.html'" target="_blank" rel="noopener">crosswalk results</a>.
      </p>
    </section>

    <section id="terminal">
      <h2>Terminal robot (front-of-lineup camera)</h2>
      <p>
        <code>functions/lib/terminal-classifier.js</code> answers one question per frame, "are cars
        waiting?", with logistic regression over two regions (near lane 32×18 cells, far queue 20×18)
        with the signpost and the walkway masked out. Since 2026-10-18 the features are
        <strong>local texture</strong> (<code>localStd-v1</code>, <code>terminal-feature-math.js</code>):
        each cell is the standard deviation of the native pixels it covers, standardised per region.
        The previous brightness-minus-frame-mean features read sunlit asphalt as cars at daybreak.
        Model files carry their feature set and are refused by code built for another. Trained by
        <code>scripts/train-terminal-classifier.mjs</code> from hand labels and riders' frame tags, with
        class balancing.
      </p>
      <p>
        <strong>Sailing verdicts</strong> (<code>lineup-labels.js</code>, mirrored in the streaming code in
        <code>webcam.js</code> and in the browser):
      </p>
      <ul>
        <li>
          <em>Not full</em> (tail rule): two consecutive empty frames after the last <em>solid</em> cars
          frame (a cars frame with a cars neighbour; isolated blips don't count), or ten observed-empty
          frames with no solid cars at all. Chosen because every wrong flag in a 510-sailing sweep was
          an empty window mid-sailing with cars returning after: 62% coverage, 0 wrong among 239 flags.
        </li>
        <li>
          <em>Full</em>: the last four frames all ≥ 0.7 cars, and the lineup must have reached the
          crosswalk (effective mark). Without the crosswalk the cars at the end were probably late
          arrivals, so the rider is asked instead. Terminal frames alone were 54–67% precise; with
          the veto 95.7%.
        </li>
      </ul>
      <p>
        Experiments:
        <a :href="gh('docs/experiments/2026-10-18-terminal-features-daybreak.md')" target="_blank" rel="noopener">terminal features at daybreak</a>
        (why texture replaced brightness),
        <a :href="gh('docs/experiments/2026-10-17-full-gate-refuted-detection.md')" target="_blank" rel="noopener">the full call vs a refuted detection</a>,
        and the live <a :href="RESULTS + 'terminal.html'" target="_blank" rel="noopener">terminal results page</a>.
        Earlier work (the tail rule, the full rule, rider labels) is indexed in
        <a :href="gh('docs/experiments/README.md')" target="_blank" rel="noopener">docs/experiments</a>.
      </p>
    </section>

    <section id="tagging">
      <h2>Rider tagging and inference</h2>
      <p>
        The tagging dialog asks per-frame questions and infers the sailing's answer
        (<code>src/lib/tagging-progress.js</code>): on the crosswalk camera the crossing is the first
        "yes" with a "no" on the frame before, which implies "not yet" for every earlier frame and
        "at the crosswalk" for every later one; on the terminal camera the same tail rules run over the
        rider's answers merged with the robot's scores, a rider's answer winning per frame. A rider's
        verdict is saved as the sailing's report automatically.
      </p>
    </section>

    <section id="leaderboard">
      <h2>Leaderboard credit</h2>
      <p>
        <code>functions/lib/leaderboard-score.js</code>: per sailing, each rider's latest report counts
        once. Undisputed: first reporter 1.0, later agreers 0.1. Disputed with a strict plurality:
        first winner 1.0, other winners 0.5, losers 0.1. Tied: everyone 0.1 and the sailing shows a
        disagreement. Crosswalk marks are scored the same way, with marks within about 5 minutes of
        each other counting as agreement; ride offers earn 10 and requests 5.
      </p>
    </section>

    <section id="costs">
      <h2>Keeping it cheap</h2>
      <p>
        Nightly aggregates (<code>aggregates/*</code>) replace range scans on page load; the
        one-minute poll writes only on change; staging functions sleep unless woken. The reasons and
        the July 2026 read spike are in
        <a :href="gh('docs/firestore-optimization.md')" target="_blank" rel="noopener">docs/firestore-optimization.md</a>.
      </p>
    </section>
  </q-page>
</template>

<script setup>
// Technical companion to HowItWorksPage.vue. Numbers here must match the
// constants in the modules they cite; when a threshold changes, change it
// here too (grep the constant's name).
const REPO = 'https://github.com/carchrae/ferry-view'
const gh = (path) => `${REPO}/blob/main/${path}`
// The classifier results pages, published nightly to the production bucket.
const RESULTS = 'https://storage.googleapis.com/bowen-ferry.firebasestorage.app/classifier-results/'
</script>

<style scoped>
.tech-page {
  max-width: 52rem;
  margin: 0 auto;
  line-height: 1.5;
}
.tech-page h2 {
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 1.4rem 0 0.4rem;
  scroll-margin-top: 64px;
}
.tech-page p,
.tech-page li {
  margin: 0 0 0.6rem;
}
.tech-page ul {
  padding-left: 1.2rem;
}
.tech-page code {
  font-size: 0.85em;
  background: rgba(128, 128, 128, 0.12);
  padding: 0 3px;
  border-radius: 3px;
}
.tech-table {
  border-collapse: collapse;
  margin: 0.4rem 0 0.8rem;
  font-size: 0.9rem;
}
.tech-table th,
.tech-table td {
  text-align: left;
  padding: 2px 12px 2px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}
</style>
