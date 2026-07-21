// Top-level Firestore collections backed up/restored/reset by backup-db.js,
// restore-db.js, and reset-db.js. Single source of truth — these three
// scripts used to each hardcode their own copy of this list, which is how
// `aggregates` and `lineupReports` silently fell out of staging refreshes
// after they were added (see firestore.rules for the authoritative set of
// collections the app actually reads/writes).
export const BACKUP_COLLECTIONS = [
  'ferryStatus',
  'sailingStatus',
  'capacityHistory',
  'lineupReports',
  'snapshots',
  'aggregates',
  'rides',
  'pushSubscriptions',
]
