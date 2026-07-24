// Shared crosswalk-tag semantics. This module is the single source of truth
// for turning raw lineupReports into an effective crosswalk time and frame
// labels — the SAME code runs in the app's Cloud Function triggers
// (index.js) and in the training pipeline (scripts/export-lineup-dataset.mjs),
// so the classifier can never drift from what riders see in the UI.
//
// Kept free of native deps (no sharp) so the exporter can run it anywhere.

// A report counts only when it has an author and a numeric mark — the same
// validity check the triggers and client loaders apply.
export function isValidLineupReport(r) {
  return Boolean(r && r.userUid && typeof r.crosswalkAt === 'number')
}

// The app's "latest wins" rule: of a sailing's valid reports, the one most
// recently recorded defines the sailing's crosswalk time (later riders
// correct earlier marks; deleting yours falls back to the latest remaining).
// Returns the crosswalkAt epoch-ms, or null when no valid report exists.
export function effectiveCrosswalkAt(reports) {
  let latest = null
  for (const r of reports || []) {
    if (!isValidLineupReport(r)) continue
    if (!latest || (r.recordedAt || 0) > (latest.recordedAt || 0)) latest = r
  }
  return latest ? latest.crosswalkAt : null
}

// Label a timelapse frame from the effective crosswalk time: frames captured
// at or after it show a lineup that has reached the crosswalk.
export function labelForTimestamp(frameTs, crosswalkAt) {
  if (typeof frameTs !== 'number' || typeof crosswalkAt !== 'number') return null
  return frameTs >= crosswalkAt ? 1 : 0
}
