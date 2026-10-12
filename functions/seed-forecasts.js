// Seed the forecast docs on one project right away, instead of waiting for
// the nightly jobs: snapshots/seasonalSchedule (BC Ferries timetable, scraped
// as refreshSeasonalScheduleDaily does) and aggregates/holidayStats (past
// holiday sailings, as refreshHistoryAggregate rebuilds them the day after a
// holiday). Run it once after deploying the functions.
//
//   node seed-forecasts.js --project bowen-ferry                      # production
//   node seed-forecasts.js --project bowen-ferry-staging --if-missing # only what's absent
//
// --project is required: this never falls back to another project. The
// scrape goes out from this machine and bcferries.com blocks IPs that make too
// many requests — run it once, not in a loop.
//
// Auth: connectAdmin() in script-auth.js — `firebase login`, or
// GOOGLE_APPLICATION_CREDENTIALS pointing at a key file.

import { connectAdmin } from './script-auth.js'
import { refreshSeasonalSchedule, SEASONAL_SCHEDULE_DOC } from './lib/seasonal-schedule.js'
import { recomputeHolidayStats } from './lib/history-aggregate.js'
import { nowInVancouver } from './lib/time.js'

const flag = process.argv.indexOf('--project')
const projectId = flag !== -1 ? process.argv[flag + 1] : null
if (!projectId) {
  console.error('Usage: node seed-forecasts.js --project <id> [--if-missing]')
  process.exit(1)
}
const ifMissing = process.argv.includes('--if-missing')

const { db, via } = await connectAdmin(projectId)
console.log(`Seeding forecasts on ${projectId} (as ${via})${ifMissing ? ', only missing docs' : ''}…`)

const exists = async (col, id) => (await db.collection(col).doc(id).get()).exists

if (ifMissing && (await exists('snapshots', SEASONAL_SCHEDULE_DOC))) {
  console.log(`  snapshots/${SEASONAL_SCHEDULE_DOC}: present, kept`)
} else {
  const todayIso = nowInVancouver().format('YYYY-MM-DD')
  const { parsed, skipped } = await refreshSeasonalSchedule(db, todayIso)
  console.log(`  snapshots/${SEASONAL_SCHEDULE_DOC}: timetable ${parsed.range?.start} – ${parsed.range?.end}`)
  for (const { dateIso, cancelled } of skipped) {
    console.log(`    ${dateIso}  skipped: ${cancelled.map((c) => `${c.time} from ${c.location}`).join(', ')}`)
  }
}

if (ifMissing && (await exists('aggregates', 'holidayStats'))) {
  console.log('  aggregates/holidayStats: present, kept')
} else {
  const r = await recomputeHolidayStats(db, { force: true })
  console.log(`  aggregates/holidayStats: ${r.count} sailings on ${r.dates} dates, ${r.start} – ${r.end}`)
}

console.log('Done. The poll picks up the schedule on its next date rollover or cold start.')
process.exit(0)
