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
  'frameLabels',
  'snapshots',
  'aggregates',
  'rides',
  'pushSubscriptions',
]

// Windowed backups (the default staging refresh) only read the recent slice
// of the collections that grow with time; a full scan of months of history
// costs thousands of reads and is rarely what staging needs. Each entry names
// the collection's date field and how to express the cutoff for it; the
// collections not listed here (status singletons, aggregates, subscriptions)
// are small and always copied whole.
//   dateIso — string "YYYY-MM-DD" compared lexicographically
//   epochMs — number, epoch milliseconds
//   timestamp — Firestore Timestamp
export const COLLECTION_WINDOW_FIELDS = {
  sailingStatus: { field: 'dateIso', type: 'dateIso' },
  capacityHistory: { field: 'recordedAt', type: 'epochMs' },
  lineupReports: { field: 'recordedAt', type: 'epochMs' },
  frameLabels: { field: 'recordedAt', type: 'epochMs' },
  rides: { field: 'createdAt', type: 'timestamp' },
}
