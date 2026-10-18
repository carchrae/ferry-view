<template>
  <q-page class="q-pa-md tech-page">
    <div class="row items-center q-mb-sm">
      <div class="text-h6 col">Technical details</div>
      <q-btn flat dense no-caps color="primary" icon="menu_book" label="Plain-language version" to="/how-it-works" />
    </div>
    <p class="text-grey-8">
      How each part of the app reaches its answer: the method, the thresholds that matter, and the
      evidence behind them. Where a decision came out of an experiment, the section says what was
      measured; the robots' live results pages are linked where they exist.
    </p>

    <section id="data">
      <h2>Data sources and fallbacks</h2>
      <p>
        Once a minute the server reads bowenferry.ca's status feed, which relays the ferry's AIS
        position, an arrival-and-departure log, and the deck space BC Ferries publishes. That log is
        the primary record of when the boat left and arrived, and it occasionally freezes while the
        position feed keeps flowing. When it does, arrivals and departures are inferred from position
        alone: a boat at near-zero speed within 600 m of a terminal is docked there, and a change in
        that state between two polls is an arrival or a departure. Only when both are stale does the
        server fall back to BC Ferries' own current-conditions page, which covers the Horseshoe Bay
        to Bowen direction.
      </p>
      <p>
        The timetable comes from BC Ferries' seasonal schedule page rather than the status feed. The
        feed ignores the "except Aug 3, Sep 7…" notes that cancel particular sailings on holidays, so
        the schedule page is scraped nightly, kept as the weekly table with its exceptions, and any
        date in range is worked out from that.
      </p>
    </section>

    <section id="lateness">
      <h2>Lateness</h2>
      <p>
        Lateness is the newest logged departure compared with its scheduled time. Up to four minutes
        early still counts as on time, because a loaded boat often leaves a little before the hour;
        two minutes behind is late, and six or more is shown in red. Delay notifications use the same
        number: each subscriber picks a threshold between five and thirty minutes, is notified once
        when lateness reaches it, and becomes eligible again once the boat has recovered.
      </p>
    </section>

    <section id="estimate">
      <h2>Estimating when a sailing will leave</h2>
      <p>
        There is one boat on the route, so its next few departures follow from where it is now. The
        estimate starts at the last logged arrival or departure and walks the boat forward one leg at a
        time. A departure happens at the latest of three moments: the scheduled time, the arrival plus
        the time needed to load, and the present. The following arrival is that departure plus the
        crossing time. A boat running early therefore waits for its slot, a boat running late leaves
        the moment it is loaded, and lateness carries forward or dissolves depending on how busy the
        next sailings are.
      </p>
      <p>
        Loading time is the uncertain part, and it depends on how full the departing sailing is. The
        defaults were measured over two weeks of Bowen departures in which the boat arrived too late to
        make its slot, so that loading rather than the timetable set the departure:
      </p>
      <table class="tech-table">
        <thead><tr><th>Sailing</th><th>Typical</th><th>Range</th></tr></thead>
        <tbody>
          <tr><td>light (not full)</td><td>12 min</td><td>10–14</td></tr>
          <tr><td>busy (60–99% full)</td><td>18 min</td><td>16–20</td></tr>
          <tr><td>full</td><td>23 min</td><td>21–26</td></tr>
          <tr><td>not yet known</td><td>14 min</td><td>11–23</td></tr>
        </tbody>
      </table>
      <p>
        Today's own departures nudge those defaults, and today's crossings set the crossing time once
        there have been three of them (20 minutes until then). The walk is run three times, with
        typical, quick and slow timings, which gives the point estimate and the range shown on each
        sailing. When nobody yet knows how full a sailing will be, its range spans light to full, so
        the width of the range says how much hangs on how busy it turns out to be. The panel "How the
        lateness estimate works" under each estimate shows the timings actually in use.
      </p>
      <pre>start at the boat's last logged arrival or departure
for each remaining sailing today, alternating terminals:
    loading   = minutes for this sailing's fullness band (table above)
    departure = latest of (scheduled time, arrival + loading, now)
    arrival   = departure + crossing            # at the other terminal
run it three times — typical, quick, slow — for the estimate and its range</pre>
      <div class="example">
        <strong>Example.</strong> The boat ties up at Bowen at 11:12 for the 11:15, a sailing the
        history says is usually full. Full loading is 23 minutes, so it leaves at 11:35, twenty
        late; the quick and slow runs (21 and 26 minutes) give the range 11:33 to 11:38. A 20-minute
        crossing puts it at Horseshoe Bay at 11:55, exactly its next slot; that sailing is light, so
        it loads in 12 and leaves at 12:07, twelve late. Back at Bowen at 12:27 for the 12:35, which
        is busy: 12:27 + 18 = 12:45, ten late. The lateness shrinks on light sailings and holds on
        busy ones, which is what riders see on the day.
      </div>
    </section>

    <section id="history">
      <h2>What's usual for a sailing</h2>
      <p>
        The hint under each upcoming sailing is built from the last eight weeks of the same sailing on
        the same weekday, grouped by direction and scheduled time. A sailing is described as late when
        at least 40% of those departures were late and the average lateness was three minutes or more
        (the warning strengthens at a six-minute average); as full when riders reported it full on at
        least 30% of departures, given at least three reports; and as busy when reported deck space
        averaged 60% full or more. The frequency words are fixed bands: "usually" for 60% or more,
        "often" for 30 to 59%, "sometimes" below that. When nothing warrants a warning the hint says
        so ("usually on time", "rarely full") rather than staying silent, because silence reads as
        "no data".
      </p>
      <p>
        One-off disruptions are detected and excluded. With at least four departures on record, a
        departure counts as an exception when its lateness is more than three median absolute
        deviations from the median, with a floor of twelve minutes so that a very consistent sailing
        does not flag ordinary wobble. Exceptions are left out of every average but shown in the
        history view. Holiday-affected dates are excluded from ordinary baselines as well.
      </p>
      <p>
        After each sailing departs, the hint's calls are scored against what happened. A lateness call
        is right if within five minutes. A "full" call is only made when the full rate was 60% or more
        or the call rested on crosswalk history, and is right if the sailing left full; a "busy" call
        is right if it left at least 70% full; a "room" call is right if it did not leave full. The
        Today view shows the day's tally.
      </p>
      <pre>for each (direction, weekday, scheduled time) over the last 8 weeks:
    m = median(lateness values), d = median absolute deviation
    exception  if |value − m| > max(3·d, 12 min)      # needs ≥ 4 departures
    over the rest: latePct, avgLateness, fullPct, avgDeckSpace
late fact   if latePct ≥ 40% and avgLateness ≥ 3 min
full fact   if fullPct ≥ 30% with ≥ 3 reports
busy fact   if reported deck space averages ≥ 60% full
word        = usually (≥ 60%) · often (30–59%) · sometimes (&lt; 30%)</pre>
      <div class="example">
        <strong>Example.</strong> The Saturday 8:45 from Bowen over eight weeks ran 0, 1, 1, 2, 3, 4,
        41 and 2 minutes late. Median 2, MAD 1, so the exception bound is the 12-minute floor and
        the 41 (a medical hold) is set aside. Of the remaining seven, three were late (43%) averaging
        3 minutes: "often +3 min". Riders reported it full on two of seven (29%), just under the 30%
        line, so there is no full warning. It then leaves six minutes late: the lateness call was
        within five, so it scores as right; had the hint said "usually full" and the sailing left
        with room, that call would score as wrong.
      </div>
    </section>

    <section id="holidays">
      <h2>Holiday and long-weekend forecasts</h2>
      <p>
        Holidays are sorted by kind: family-travel long weekends, a plain day off, and the Christmas
        season. For a holiday the fullness and crosswalk history comes from, in order of preference,
        the same holiday in earlier years, same-kind holidays on the same weekday within six months,
        same-kind holidays on any weekday, and finally ordinary days. Lateness is deliberately not
        treated that way: it tracks how busy the boat is and compounds through the day rather than
        following the date, so it always comes from the ordinary same weekday. The rules are young and
        are backtested after each holiday; the evidence so far and the open questions are kept with
        the project's design notes.
      </p>
    </section>

    <section id="cameras">
      <h2>Camera capture and attribution</h2>
      <p>
        Two timelapses are captured around every Bowen sailing. The lineup timelapse photographs the
        community camera every five minutes from fifteen minutes after the previous departure until the
        ferry is back at the dock. The departure timelapse photographs the terminal camera every minute
        from the ferry's arrival (or ten minutes before the scheduled time, whichever is later) until it
        leaves. Frames are attributed to the earliest sailing that has not yet departed, bounded by each
        sailing's own window in the schedule, so a late ferry's photos stay with the sailing they
        belong to.
      </p>
      <p>
        Both cameras print a clock into the image, so two genuinely fresh frames can never be identical
        bytes. Identical frames therefore mean a frozen camera serving its last good picture. At the
        terminal camera's once-a-minute cadence one repeat is tolerated, since a capture can land twice
        inside one refresh; at the five-minute lineup cadence a single repeat is conclusive. While a
        camera repeats, its captures and classifier verdicts are suspended and the outage is published
        to the app.
      </p>
      <pre>hash = digest(new frame)
if hash == last hash from this camera: repeats += 1 else repeats = 0
stalled when repeats ≥ 2 (terminal, 1 frame/min) or repeats ≥ 1 (lineup, 1 frame/5 min)
recovery is immediate: the next differing frame clears it</pre>
      <p>
        Darkness is judged by the sun, not the pixels: both cameras auto-expose, so a night frame is
        not measurably darker than a day one. Below a solar elevation of −7° the crosswalk classifier
        does not run, because every one of its 26 dark-hour detections in a 45-day archive turned out to
        be wrong. The terminal camera has a street light and its classifier runs at night.
      </p>
    </section>

    <section id="crosswalk">
      <h2>The crosswalk robot</h2>
      <p>
        A logistic regression over downscaled greyscale pixels from two regions of the community
        camera's view, "on the hill" and "past crosswalk", answers one question per frame: does the
        lineup extend past the crosswalk? Its training labels come from riders' crosswalk marks:
        every frame at or after a sailing's effective mark is a positive example, every frame before
        it a negative. The browser runs the same weights for sailings the server has not judged.
      </p>
      <p>
        Live, the robot treats a single positive frame as a lead rather than a fact. It publishes the
        call at once, marked "checking", and takes extra photos a minute apart. A second positive
        confirms the call; two misses withdraw it. A confirmed call remains open to correction until
        the ferry is back at Bowen, and a check only counts when its frames are consecutive (no gap
        over seven minutes). A rider's mark or "not yet" always outranks the robot, latest report
        winning, and a robot detection with no standing mark means a rider overruled it. Each
        detection is scored by severity after the fact: a detection on a sailing riders refuted
        (a phantom) costs most, then calls that were early, late, or missed.
      </p>
      <pre>off:       positive frame → publish "checking", start 1-minute check photos
checking:  positive → confirmed (on) · negative → one more photo · 2nd negative → withdraw
on:        negative → "checking" (doubt) · positive → on · 2nd negative → withdraw
any time:  ferry back at Bowen → stop correcting; a rider's mark or "not yet" outranks all</pre>
      <div class="example">
        <strong>Example</strong> (Saturday 2026-10-17 10:00). 09:30:25, first positive frame at p 0.78:
        the sailing shows "lineup may have reached the crosswalk (checking)". 09:31, the check photo
        agrees: confirmed. 09:34, a rider says "not yet": the mark is cleared and the robot's call
        is recorded as overruled. 10:09 the same rider marks the real crossing at 09:45.
      </div>
      <p>
        Live results and model history are on the
        <a :href="RESULTS + 'crosswalk.html'" target="_blank" rel="noopener">crosswalk results page</a>.
      </p>
    </section>

    <section id="terminal">
      <h2>The terminal robot</h2>
      <p>
        A second logistic regression, over the front-of-lineup camera, answers "are cars waiting?" for
        each frame. It reads two regions, the near lane (32 × 18 cells) and the far queue (20 × 18),
        with the signpost and the pedestrian walkway masked out. Since October 2026 each cell is a
        measure of local texture, the standard deviation of the native pixels it covers, standardised
        within its region. The previous features, brightness relative to the frame average, could not
        separate a grey car from grey asphalt at low sun and read sunlight on the hill as a queue;
        texture can, and the change lifted cross-validated frame F1 from 0.92 to 0.97. A model file
        records which feature set it was trained on, and code built for a different set refuses it
        rather than scoring it.
      </p>
      <p>
        Per-frame answers become a verdict for the sailing through two rules. A sailing left with room
        when two consecutive frames read empty after the last solid run of cars (a lone cars frame
        between empties is a blip and does not count), or when ten or more frames read empty with no
        solid cars at all. This rule was chosen after a sweep of 510 tagged sailings showed that every
        wrong "not full" flag was an empty window in the middle of loading with cars returning after,
        not a low-confidence frame; it covers 62% of sailings riders tagged as having room with no
        wrong flags among 239. A sailing left full when the last four frames all read cars with high
        confidence, provided the lineup had reached the crosswalk. Without that, the cars at the end
        were most likely late arrivals, and the app asks a rider instead: terminal frames alone were
        54 to 67% precise about fullness, with the crosswalk condition 96%.
      </p>
      <pre>for each region (near lane, far queue):
    crop at native resolution, greyscale
    for each grid cell: value = standard deviation of the pixels it covers
    standardise the region's cells (subtract mean, divide by spread); masked cells = 0
p = logistic(weights · cells + bias)                 # cars when p ≥ 0.5

not full:  two consecutive empty frames after the last SOLID cars run
           (a cars frame with a cars neighbour), or ≥ 10 empty frames and no solid cars
full:      last 4 frames all p ≥ 0.7, and the lineup reached the crosswalk</pre>
      <div class="example">
        <strong>Examples.</strong> Frames C C C E C E E: the lone C between empties is a blip, so the
        tail is E E after the solid run and the sailing is confirmed "left with room" on the last
        frame. Frames C C E E C C: the empties were mid-loading and cars came back, so there is no
        verdict either way. On Sunday 2026-10-18 the 08:44 frame of an empty road scored 0.85 under
        the brightness features and 0.05 under texture; with texture the whole tail reads empty and
        the sailing is called "left with room" at 08:45, which is what riders tagged.
      </div>
      <p>
        Live results, model history and the nightly retraining record are on the
        <a :href="RESULTS + 'terminal.html'" target="_blank" rel="noopener">terminal results page</a>.
      </p>
    </section>

    <section id="tagging">
      <h2>Rider tagging</h2>
      <p>
        The tagging dialog never asks "was it full?" outright; it asks about one frame at a time and
        infers the sailing's answer. On the crosswalk camera the crossing is the first frame answered
        "yes" with a "no" on the frame before, which implies "not yet" for every earlier frame and "at
        the crosswalk" for every later one. On the terminal camera the same two rules above run over the
        rider's answers merged with the robot's scores, the rider's answer winning for any frame they
        answered. A verdict the rider's answers produce is saved as the sailing's report.
      </p>
      <div class="example">
        <strong>Example.</strong> A rider answers "no" at 8:05 and "yes" at 8:10: the crossing is
        8:10; 8:00 is implied "not yet" and 8:15 onward "at the crosswalk", and the mark is saved. A
        "no" on the last frame with no "yes" anywhere means the lineup never reached the crosswalk,
        saved as a refute. Answering "yes" at 8:10 alone saves nothing yet; the dialog asks for 8:05
        first.
      </div>
    </section>

    <section id="leaderboard">
      <h2>Leaderboard credit</h2>
      <p>
        For each sailing only a rider's latest report counts. When everyone agrees, the first reporter
        earns one point and each later agreer a tenth. When reports disagree and one value has a strict
        plurality, the first to give the winning value earns one point, others who gave it half a point,
        and the rest a tenth; while the top values are tied, everyone holds a tenth and the sailing is
        marked as disputed. Crosswalk marks are scored the same way, with marks within about five
        minutes of each other treated as agreement. Ride offers earn ten points and requests five.
      </p>
      <div class="example">
        <strong>Example.</strong> Three riders tag the 4:15: Full, then Full, then 25% available. Full
        has the plurality, so the first rider earns 1.0, the second 0.5 for confirming the winning
        value, the third 0.1. Had all three said Full, the second and third would earn 0.1 each as
        agreers. Had it been Full against 25% one to one, everyone would hold 0.1 and the sailing
        would show a disagreement until a third rider settled it.
      </div>
    </section>

    <section id="costs">
      <h2>Keeping it cheap</h2>
      <p>
        Pages read nightly summaries instead of scanning every sailing, the one-minute poll writes
        only when something changed, and the test environment's background jobs sleep unless woken.
        The app runs on a hobby budget and these are what keep it there.
      </p>
    </section>
  </q-page>
</template>

<script setup>
// Technical companion to HowItWorksPage.vue. Numbers here must match the
// constants in the code (historical-stats.js, departure-estimate.js,
// lineup-labels.js, crosswalk-robot.js, webcam-health.js, daylight.js,
// leaderboard-score.js); when a threshold changes, change it here too. No
// repository or file names on the page itself — Tom's call.
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
.tech-page pre {
  font-size: 0.78rem;
  line-height: 1.4;
  background: rgba(128, 128, 128, 0.1);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 0.4rem 0 0.6rem;
  overflow-x: auto;
  white-space: pre;
}
.tech-page .example {
  border-left: 3px solid rgba(63, 81, 181, 0.5);
  padding: 2px 0 2px 10px;
  margin: 0.4rem 0 0.8rem;
  font-size: 0.92rem;
}
.tech-page .src {
  font-size: 0.8rem;
  color: #666;
  margin-top: 0.2rem;
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
