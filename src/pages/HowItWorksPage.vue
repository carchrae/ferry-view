<template>
  <q-page class="q-pa-md how-page">
    <div class="row items-center q-mb-sm">
      <div class="text-h6 col">How Bowen Lift works</div>
      <q-btn flat dense no-caps color="primary" icon="code" label="Technical details" to="/how-it-works/technical" />
    </div>
    <p class="text-grey-8">
      Bowen Lift tries to help people navigate the uncertainty of the ferry service to Bowen Island.
      This page explains where each thing on the app comes from and how far to trust it. The
      <router-link to="/how-it-works/technical">technical page</router-link> has the rules and the
      numbers.
    </p>

    <section>
      <h2>Where the information comes from</h2>
      <ul>
        <li>
          <strong>The boat's position.</strong> The Queen of Capilano broadcasts her position, and
          Carlos's bowenferry.ca collects it along with a log of arrivals and departures. When that
          log stalls, the app works out arrivals and departures from the position itself: a boat
          stopped at a terminal has arrived, a boat under way has left.
        </li>
        <li>
          <strong>The timetable.</strong> BC Ferries' seasonal schedule, read each night, including
          the notes that cancel particular sailings on holidays.
        </li>
        <li>
          <strong>Lineup webcams.</strong> The camera at the front of the Bowen lineup and the
          community centre's camera on the crosswalk up the hill. The app photographs both while
          each sailing builds and loads, so the lineup can be looked back on. Photos are kept for two
          weeks.
        </li>
        <li>
          <strong>Riders.</strong> People tag how full a sailing was and when the lineup reached the
          crosswalk. Those tags are the ground truth everything else is checked against.
        </li>
      </ul>
    </section>

    <section>
      <h2>Is the ferry late right now?</h2>
      <p>
        Lateness is the difference between the scheduled time and when the boat actually left.
        Leaving a few minutes early once everyone is aboard is normal and counts as on time. Two
        minutes behind shows as late; six or more shows in red.
      </p>
    </section>

    <section>
      <h2>When will my sailing actually leave?</h2>
      <p>
        There is one boat on the route, so its next few departures follow from where it is now. The
        app follows it forward: after arriving it needs time to unload and load, then it crosses.
        Loading takes about twelve minutes for a light sailing and over twenty for a full one; the
        crossing takes about twenty.
      </p>
      <p>
        A boat that is early waits for its scheduled time. A boat that is behind leaves as soon as it
        is loaded. That is why a late boat catches up on quiet sailings and stays late through busy
        ones. The estimate is run with quick and slow timings as well as typical ones, which gives
        the range shown, for example "11:19 to 11:24". When how full a sailing will be is not yet
        known, the range is wider.
      </p>
    </section>

    <section>
      <h2>What's usual for this sailing</h2>
      <p>
        The note under each upcoming sailing, such as "usually on time" or "often full", comes from
        the last eight weeks of that sailing on the same day of the week. "Often" and "usually" are
        set percentages rather than impressions: "usually" means most of those days, "often" a
        substantial share of them. Tap the note to see the counts it was built from.
      </p>
      <p>
        A one-off disruption, a breakdown or a medical hold, is kept out of the averages so that a
        single bad day does not change what a sailing is usually like. Those days are still shown,
        marked as exceptions.
      </p>
    </section>

    <section>
      <h2>Holidays and long weekends</h2>
      <p>
        A holiday Monday does not behave like an ordinary Monday, so for holidays the fullness note is
        built from the same holiday in earlier years, or from holidays of a similar kind. Lateness is
        treated differently: it depends on how busy the boat is rather than on the date, so it
        continues to come from ordinary weekdays. These rules are recent and are reviewed after each
        holiday.
      </p>
    </section>

    <section>
      <h2>Checking the predictions</h2>
      <p>
        After each sailing leaves, the app compares what it predicted with what happened. The day's
        tally is shown in the Today view, so the quality of the predictions is visible rather than
        taken on trust.
      </p>
    </section>

    <section>
      <h2>The robots</h2>
      <p>
        Two small programs watch the Bowen webcams and make calls. They learn from riders' tags, and
        they are wrong often enough that every call is marked with a robot icon and can be corrected
        by anyone. A rider's tag overrides a robot's call.
      </p>
      <h3>The crosswalk robot</h3>
      <p>
        It looks at the hill camera every few minutes and asks whether the lineup has reached the
        crosswalk. The first time it thinks so, it says so immediately but marks the call "checking",
        then takes further photos a minute apart. If the next photo agrees, the call stands; if two in
        a row disagree, the call is withdrawn. It keeps checking until the ferry is back at the dock.
        It does not look after dark, because that camera goes black at night and the robot mistook
        streetlights for a lineup. An owl marks those photos.
      </p>
      <h3>The terminal robot</h3>
      <p>
        While the ferry loads, it looks at the front-of-lineup camera every minute and asks whether
        cars are still waiting. Once the road has been empty for two photos in a row after the last
        cars, everyone got on: the sailing left with room. If cars are still there in the final
        photos, the sailing probably left full, but only when the lineup had reached the crosswalk
        earlier. If it never did, those last cars most likely arrived too late to board, and the
        robot asks a rider rather than guessing.
      </p>
      <p>
        Until October 2026 this robot judged by how light or dark the road looked, and at daybreak
        that failed: a grey car on grey asphalt was invisible to it, while sunshine on the hill
        looked like a queue. It now judges by texture, the edges and shadows that distinguish a car
        from a road surface.
      </p>
      <h3>When a camera freezes</h3>
      <p>
        A stuck camera keeps sending the same picture, which looks perfectly normal. Each camera
        prints the time on its photos, so two fresh photos are never identical. When they are, the
        app stops trusting that camera and says so until a new picture arrives.
      </p>
      <h3>Which sailing does a photo belong to?</h3>
      <p>
        Photos of the lineup are filed under the next sailing that has not yet left, and photos of
        loading under the sailing that is loading, based on when the boat actually arrived rather
        than the timetable. A late ferry's photos therefore stay with the right sailing.
      </p>
    </section>

    <section>
      <h2>Tags and the leaderboard</h2>
      <p>
        The first rider to tag a sailing earns a point; agreeing with an existing tag earns a tenth
        of one. When riders disagree, the value most of them gave wins, and the sailing shows the
        disagreement until it is settled. Tags also train the robots: crosswalk marks and the
        frame-by-frame answers in the tagging screen become the examples they learn from.
      </p>
    </section>

    <section>
      <h2>Notifications</h2>
      <p>
        With delay alerts on, you choose how late counts as late, five minutes unless you change it,
        and receive one notification when the boat falls that far behind rather than one every
        minute.
      </p>
    </section>

    <p class="text-grey-7 q-mt-lg">
      The exact rules, thresholds and the experiments behind them are on the
      <router-link to="/how-it-works/technical">technical page</router-link>.
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
