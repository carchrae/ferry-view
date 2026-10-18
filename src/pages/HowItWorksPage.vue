<template>
  <q-page class="q-pa-md how-page">
    <div class="row items-center q-mb-sm">
      <div class="text-h6 col">How Bowen Lift works</div>
      <q-btn flat dense no-caps color="primary" icon="code" label="Technical details" to="/how-it-works/technical" />
    </div>
    <p class="text-grey-8">
      It's a ferry, so nothing here is certain. This page says where each thing on the app comes
      from and how much to trust it. If you want the actual rules and numbers, there's a
      <router-link to="/how-it-works/technical">technical page</router-link>.
    </p>

    <section>
      <h2>Where the information comes from</h2>
      <ul>
        <li>
          <strong>The boat itself.</strong> The ferry broadcasts its position, like a ship's version
          of a phone's location. Carlos's bowenferry.ca collects that and keeps a diary of when the
          boat arrives and leaves. If the diary stops updating, the app can still tell from the
          position whether the boat is sitting at a dock or moving.
        </li>
        <li>
          <strong>The timetable.</strong> Read from BC Ferries every night, including the small print
          about which sailings don't run on holidays.
        </li>
        <li>
          <strong>Lineup webcams.</strong> The camera at the front of the Bowen lineup and the
          community centre's camera looking at the crosswalk on the hill. The app takes a photo of
          each as a sailing loads up, so you can look back at how the line built. Photos are kept
          for two weeks.
        </li>
        <li>
          <strong>You.</strong> Riders tag how full a sailing was and when the line reached the
          crosswalk. Those tags are what everything else is checked against.
        </li>
      </ul>
    </section>

    <section>
      <h2>Is the ferry late right now?</h2>
      <p>
        We compare when the boat actually left with when it was meant to. Leaving a few minutes
        early is normal once everyone is on, so that still counts as on time. A couple of minutes
        behind shows as late; more than five goes red.
      </p>
    </section>

    <section>
      <h2>When will my sailing actually leave?</h2>
      <p>
        There is one boat, and it can only be in one place. So the app follows it: once it arrives,
        it needs time to unload and load, then it crosses. A quiet sailing loads in about a dozen
        minutes, a packed one takes well over twenty, and the crossing is about twenty.
      </p>
      <p>
        A boat that's ahead of schedule waits for its departure time. A boat that's behind leaves
        as soon as it's loaded. That's why a late boat catches up on quiet sailings and stays late
        through busy ones. The app runs this with quick and slow timings as well as typical ones,
        which is where the range (say, "11:19 to 11:24") comes from.
      </p>
    </section>

    <section>
      <h2>What's usual for this sailing</h2>
      <p>
        The small note under each sailing, like "usually on time" or "often full", comes from the
        last two months of that same sailing on that same day of the week. "Sometimes" means now
        and then, "often" means a good share of those days, and "usually" means most of them. Tap
        the note and it shows you the actual count it was built from.
      </p>
      <p>
        The occasional disaster, a breakdown or a medical hold, is left out of the averages so one
        terrible day doesn't make a dependable sailing look bad. Those days are still shown, just
        marked as one-offs.
      </p>
    </section>

    <section>
      <h2>Holidays and long weekends</h2>
      <p>
        A holiday Monday is nothing like a normal Monday. So for holidays, the "how full" note is
        built from the same holiday in past years, or from similar holidays. Lateness is different:
        it depends on how busy the boat is, not on the date, so that part still comes from ordinary
        days. These rules are new and get checked after each holiday.
      </p>
    </section>

    <section>
      <h2>Marking our own homework</h2>
      <p>
        After a sailing leaves, the app looks back at what it predicted and whether it was right.
        You can see the day's score in the Today view, so you know how good the guesses have been
        lately rather than taking them on faith.
      </p>
    </section>

    <section>
      <h2>The robots</h2>
      <p>
        Two small programs look at the Bowen webcams and make a call. They learn from riders' tags,
        and they are wrong often enough that every call is shown with a robot icon and can be
        corrected by a person. Your tap beats their guess, every time.
      </p>
      <h3>The crosswalk robot</h3>
      <p>
        Every few minutes it looks at the hill camera and asks: has the line reached the crosswalk
        yet? The first time it thinks so, it says so straight away but marks it "checking", then
        takes a couple more photos a minute apart to be sure. If the next photo agrees, the call
        stands; if two in a row disagree, it takes the call back. It keeps checking until the ferry
        is back at the dock. It doesn't look after dark at all, because that camera goes black at
        night and the robot used to mistake streetlights for a lineup. An owl marks those photos.
      </p>
      <h3>The terminal robot</h3>
      <p>
        While the ferry loads, it looks at the front-of-lineup camera every minute and asks: are
        there still cars waiting? When the road has been empty for a couple of photos after the
        last cars, everyone got on, so the sailing left with room. When cars are still there right
        up to the moment the boat leaves, it probably left full, but only if the line had reached
        the crosswalk earlier. If it never did, those last cars most likely turned up too late to
        board, and the robot asks a rider instead of guessing.
      </p>
      <p>
        This robot used to judge by how light or dark the road looked. At daybreak that fooled it:
        a grey car on grey asphalt was invisible, and sunshine on the hill looked like a queue. It
        now looks at texture, the pattern of edges and shadows that makes a car look like a car,
        which is much closer to how your own eye does it.
      </p>
      <h3>When a camera freezes</h3>
      <p>
        Sometimes a camera gets stuck and keeps sending the same picture, which looks perfectly
        normal. Each camera prints the time on its photos, so two fresh photos can never be
        identical. When they are, the app knows the camera is stuck, stops trusting it, and says
        so until a new picture arrives.
      </p>
      <h3>Which sailing does a photo belong to?</h3>
      <p>
        A photo of the line is filed under the next sailing that hasn't left yet, and photos of
        loading under the sailing that's loading, based on when the boat really arrived rather than
        the timetable. That way a late ferry's photos don't end up under the wrong sailing.
      </p>
    </section>

    <section>
      <h2>Your tags and the leaderboard</h2>
      <p>
        The first rider to tag a sailing gets a point; agreeing with a tag that's already there gets
        a tenth of one. When riders disagree, the answer most of them gave wins, and the sailing
        shows the disagreement until it's settled. Your tags also teach the robots: every crosswalk
        mark and every frame you answer in the tagging screen becomes an example they learn from.
      </p>
    </section>

    <section>
      <h2>Notifications</h2>
      <p>
        If you turn on delay alerts, you choose how late is late enough, five minutes unless you
        change it. You get one message when the boat falls that far behind, not one every minute.
      </p>
    </section>

    <p class="text-grey-7 q-mt-lg">
      Curious about the exact rules, the numbers, and the experiments behind them? They're on the
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
