// Run the nightly seasonal-schedule scrape now, instead of waiting for
// refreshSeasonalScheduleDaily at 00:05 — e.g. right after deploying, so the
// poll switches to BC Ferries' schedule straight away. Same code path as the
// scheduled function: scrapes the HSB-BOW seasonal page and writes the next
// timetable (with its holiday exceptions) to snapshots/seasonalSchedule.
//
//   node refresh-seasonal-schedule.js                       # staging
//   node refresh-seasonal-schedule.js --project bowen-ferry # production
//
// The fetch goes out from this machine, and bcferries.com blocks IPs that
// make too many requests — run it once, not in a loop.
//
// Auth: connectAdmin() in script-auth.js — `firebase login`, or
// GOOGLE_APPLICATION_CREDENTIALS pointing at a key file.

import { connectAdmin, detectProjectId } from './script-auth.js'
import { STAGING_PROJECT_ID } from './lib/control.js'
import { refreshSeasonalSchedule, SEASONAL_SCHEDULE_DOC } from './lib/seasonal-schedule.js'
import { nowInVancouver } from './lib/time.js'

const projectId = detectProjectId() || STAGING_PROJECT_ID
const { db, via } = await connectAdmin(projectId)
const todayIso = nowInVancouver().format('YYYY-MM-DD')
console.log(`Refreshing seasonal schedule on ${projectId} from ${todayIso} (as ${via})…`)

const { parsed, skipped } = await refreshSeasonalSchedule(db, todayIso)
console.log(`  Timetable ${parsed.range?.start} – ${parsed.range?.end}`)
for (const { dateIso, cancelled } of skipped) {
  console.log(`  ${dateIso}  skipped: ${cancelled.map((c) => `${c.time} from ${c.location}`).join(', ')}`)
}
if (!skipped.length) console.log('  No skipped sailings from today to the end of the range.')
console.log(`Wrote snapshots/${SEASONAL_SCHEDULE_DOC}. The poll picks it up on its next date rollover or cold start (or within the hour if it had found nothing for today).`)
process.exit(0)
