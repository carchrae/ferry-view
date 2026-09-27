// Local stand-in for the rebuildLeaderboard HTTP endpoint, which is disabled
// (docs/codebase-review-2026-09-06.md, H3): backfill the userReport flag on
// the last 30 days of user reports, then recompute aggregates/leaderboard.
//
//   npm run leaderboard:rebuild              # staging
//   npm run leaderboard:rebuild:production   # prod
//   node functions/rebuild-leaderboard.js --project <id>
//
// Auth: connectAdmin() — `firebase login`, or GOOGLE_APPLICATION_CREDENTIALS.

import { STAGING_PROJECT_ID } from './lib/control.js'
import { backfillUserReportFlag, recomputeLeaderboard } from './lib/leaderboard-aggregate.js'
import { connectAdmin } from './script-auth.js'

const flag = process.argv.indexOf('--project')
const projectId = flag !== -1 ? process.argv[flag + 1] : STAGING_PROJECT_ID

const { db, via } = await connectAdmin(projectId)
console.log(`[${projectId}] rebuilding leaderboard via ${via}`)

const backfilled = await backfillUserReportFlag(db)
const { reporters, riders } = await recomputeLeaderboard(db)
console.log(
  `[${projectId}] backfilled ${backfilled}; leaderboard: ${reporters.length} reporters, ${riders.length} riders`,
)
