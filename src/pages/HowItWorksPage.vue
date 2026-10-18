<template>
  <q-page class="q-pa-md how-page">
    <div class="row items-center q-mb-sm">
      <div class="text-h6 col">How Bowen Lift works</div>
      <q-btn flat dense no-caps color="primary" icon="code" label="Technical details" to="/how-it-works/technical" />
    </div>
    <p class="text-grey-8">
      Nothing here is certain — it's a ferry. This page says, in plain words, where each number on the
      app comes from and how much to trust it. The
      <router-link to="/how-it-works/technical">technical page</router-link> has the rules, the
      thresholds and the experiments behind them.
    </p>

    <section>
      <h2>Where the information comes from</h2>
      <ul>
        <li>
          <strong>The boat's position.</strong> Carlos's bowenferry.ca feed relays the Queen of
          Capilano's AIS transponder and keeps a log of arrivals and departures. When that log
          freezes, the app works out arrivals and departures itself from the boat's position and
          speed, and as a last resort reads BC Ferries' own departures page.
        </li>
        <li>
          <strong>The timetable.</strong> BC Ferries' seasonal schedule, read once a night, including
          the small print ("except Aug 3, Sep 7…") that says which sailings don't run on a holiday.
        </li>
        <li>
          <strong>Three cameras.</strong> BC Ferries' camera at the front of the Bowen lineup, the
          community centre's camera looking at the crosswalk on the hill, and BC Ferries' cameras at
          Horseshoe Bay. Around each sailing the crosswalk camera is photographed every five minutes
          and the terminal camera every minute; the photos are kept for two weeks.
        </li>
        <li>
          <strong>You.</strong> Riders tag how full a sailing left and when the lineup reached the
          crosswalk. Those tags are the ground truth everything else is checked against.
        </li>
      </ul>
    </section>

    <section>
      <h2>Is the ferry late right now?</h2>
      <p>
        Lateness is the gap between the timetable and the last logged departure. Up to four minutes
        early still counts as on time (the boat often leaves a touch early when it's loaded). Two
        minutes behind reads as late, six or more turns red.
      </p>
    </section>

    <section>
      <h2>When will my sailing actually leave?</h2>
      <p>
        The old answer was "minutes since it was due", which told you nothing about a boat that was
        still unloading. Now the app follows the one boat forward from wherever it is: it arrives,
        it needs time to load, then it crosses. Loading takes about 12 minutes for a light sailing,
        18 for a busy one and 23 when it's full; the crossing takes about 20, measured from today's
        own trips once there have been three.
      </p>
      <p>
        Each sailing leaves at the <em>latest</em> of its scheduled time, "arrival plus loading", and
        now. That's why a late boat catches up on quiet sailings and stays late through busy ones.
        The estimate is run three times, quick, typical and slow, which is where the range comes
        from. When nobody knows yet how full a sailing will be, the range runs from light to full.
      </p>
    </section>

    <section>
      <h2>What's usual for this sailing</h2>
      <p>
        The hint under each upcoming sailing ("usually on time", "often +7 min", "usually full by
        4:15 pm") comes from the last eight weeks of the same sailing on the same weekday. "Often"
        and "usually" are real percentages ("often" is 30 to 59% of days, "usually" 60% or more): a
        sailing is called late when it left late on at least 40% of those days and averaged three
        minutes or more behind, and full when riders reported it full on at least 30%. Tap a hint to
        see the exact numbers it was built from.
      </p>
      <p>
        One-off disasters, a breakdown or a medical hold, are spotted statistically and left out of
        the averages so a single bad day doesn't make a reliable sailing look bad. They are still
        shown, marked as exceptions.
      </p>
    </section>

    <section>
      <h2>Holidays and long weekends</h2>
      <p>
        A holiday Monday behaves nothing like an ordinary Monday, so for holidays the fullness hint
        is built from the same holiday in earlier years, or from holidays of the same kind (family
        travel weekends, a plain day off, the Christmas season). Lateness, oddly, isn't like that: it
        tracks how busy the boat is rather than the date, so it keeps coming from ordinary weekdays.
        These rules are young and are being checked against each holiday as it passes.
      </p>
    </section>

    <section>
      <h2>Checking our own predictions</h2>
      <p>
        Once a sailing has left, the app compares what it predicted with what happened. A lateness
        call counts as right within five minutes; a "full" call only counts when it was a firm one.
        The score for the day is shown in the Today dialog so you can see how the guesses are doing,
        not just read them.
      </p>
    </section>

    <section>
      <h2>The robots</h2>
      <p>
        Two small image classifiers watch the Bowen cameras. They are deliberately simple, they learn
        from riders' tags, and they are wrong often enough that every call can be checked and
        corrected by a person. The robot icon marks anything that came from them.
      </p>
      <h3>The crosswalk robot</h3>
      <p>
        It looks at the community camera every five minutes and asks one question: has the lineup
        reached the crosswalk? The first time it thinks so it reports it at once, marked "checking",
        then takes extra photos a minute apart. A second yes confirms; two noes in a row take the
        report back. It keeps correcting itself until the ferry is back at the dock. It doesn't look
        at all in the dark, because that camera goes black at night and the robot was seeing queues
        in streetlights. An owl marks those frames.
      </p>
      <h3>The terminal robot</h3>
      <p>
        It looks at the front-of-lineup camera once a minute while the ferry loads and asks, frame by
        frame, whether cars are still waiting. Two empty frames in a row after the last cars means
        everyone got on: the sailing left with room. Cars still there in the final four frames means
        it left full, but only if the lineup had reached the crosswalk earlier; otherwise those cars
        probably arrived too late to board, and the robot asks a rider instead.
      </p>
      <p>
        Until October 2026 this robot judged brightness, and at daybreak a grey car on grey asphalt
        was invisible to it while sunlight on the hill looked like a queue. It now judges texture,
        which is what tells a car from a road. The
        <router-link to="/how-it-works/technical#terminal">technical page</router-link> has the
        experiment.
      </p>
      <h3>When a camera freezes</h3>
      <p>
        A frozen camera keeps serving the same picture, which looks perfectly valid. Each camera
        burns a clock into its frames, so two genuinely fresh photos can never be identical; when they
        are, the app stops using that camera and says so until a new frame arrives.
      </p>
      <h3>Which sailing does a photo belong to?</h3>
      <p>
        A photo of the lineup is filed under the next sailing that hasn't left, and the terminal
        photos under the sailing that is loading, worked out from the boat's actual arrival rather
        than the timetable, so a late ferry's photos don't drift onto the wrong sailing.
      </p>
    </section>

    <section>
      <h2>Your tags and the leaderboard</h2>
      <p>
        When you tag a sailing's fullness or its crosswalk time, the first report earns a point and
        agreeing with an existing one earns a tenth. When reports disagree, the value most riders
        gave wins and the sailing shows the disagreement until it's settled. Your tags also train the
        robots: the crosswalk marks become labels for the crosswalk model, and frame-by-frame answers
        in the tagging dialog become labels for the terminal model.
      </p>
    </section>

    <section>
      <h2>Notifications</h2>
      <p>
        If you turn on delay alerts you pick a threshold, five minutes by default, and you get one
        notification when the ferry falls that far behind, not one every minute.
      </p>
    </section>

    <p class="text-grey-7 q-mt-lg">
      Want the rules, numbers and evidence? See the
      <router-link to="/how-it-works/technical">technical details</router-link>, which link to the
      write-ups of the experiments behind each decision.
    </p>
  </q-page>
</template>

<script setup>
// Plain-language companion to TechnicalDetailsPage.vue, reached from the
// About dialog. Keep it readable by someone who has never seen a line of
// code: the numbers and file names live on the technical page.
</script>

<style scoped>
.how-page {
  max-width: 48rem;
  margin: 0 auto;
  line-height: 1.5;
}
.how-page h2 {
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 1.4rem 0 0.4rem;
}
.how-page h3 {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 1rem 0 0.3rem;
}
.how-page p,
.how-page li {
  margin: 0 0 0.6rem;
}
.how-page ul {
  padding-left: 1.2rem;
}
</style>
