// Rebuild aggregates/holidayStats now instead of waiting for the nightly
// refreshHistoryAggregate run (which only rebuilds it the day after a holiday
// or long-weekend day). Same code path: every sailing on a holiday or
// long-weekend Saturday/Sunday over the last three years.
//
//   node rebuild-holiday-stats.js                       # staging
//   node rebuild-holiday-stats.js --project bowen-ferry # production
//
// Auth: connectAdmin() in script-auth.js — `firebase login`, or
// GOOGLE_APPLICATION_CREDENTIALS pointing at a key file.

import { connectAdmin, detectProjectId } from './script-auth.js'
import { STAGING_PROJECT_ID } from './lib/control.js'
import { recomputeHolidayStats } from './lib/history-aggregate.js'

const projectId = detectProjectId() || STAGING_PROJECT_ID
const { db, via } = await connectAdmin(projectId)
console.log(`Rebuilding aggregates/holidayStats on ${projectId} (as ${via})…`)
const r = await recomputeHolidayStats(db, { force: true })
console.log(`  ${r.count} sailings on ${r.dates} holiday/long-weekend dates, ${r.start} – ${r.end}`)
process.exit(0)
