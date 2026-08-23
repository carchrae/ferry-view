import { ref, computed } from 'vue'
import { collection, query, where, getDocs, doc, getDoc, limit } from 'firebase/firestore'
import { db } from 'boot/firebase'
import { dayjs, nowInVancouver } from '../../functions/lib/time.js'
import { getImpactedDates } from '../../functions/lib/holidays.js'
import { aggregateSailings } from '../lib/historical-stats.js'

// The pure half of this module now lives in src/lib/historical-stats.js so it
// can be tested without Firestore. Re-exported here so every existing
// `from 'src/composables/useHistoricalStats'` import keeps working.
export {
  DAY_KEYS,
  EXCEPTION_MIN_SAMPLES,
  directionToPanel,
  labelToPanel,
  minutesToLabel,
  aggregateSailings,
  getTypical,
  typicalHints,
} from '../lib/historical-stats.js'

// ---------------------------------------------------------------------------
// Composable — fetch + aggregate sailingStatus over a date range
// ---------------------------------------------------------------------------

// The nightly refreshHistoryAggregate function mirrors the last 8 weeks of
// sailingStatus into this single doc (see functions/lib/history-aggregate.js
// for the short record keys). Reading it costs 1 doc read instead of the
// ~1,700-doc range scan every HomePage/HistoryPage mount used to run.
// A slightly-stale aggregate still beats the ~1,700-doc direct scan: over an
// 8-week day-of-week average, a few missing recent days barely move the
// numbers. Only fall back when the nightly rebuild has been dead for over a
// week (or the window's start isn't covered at all).
const STALE_GRACE_DAYS = 7

async function fetchFromAggregate(start, end) {
  try {
    const snap = await getDoc(doc(db, 'aggregates', 'historicalStats'))
    if (!snap.exists()) return null
    const agg = snap.data()
    // agg.end is yesterday-at-rebuild; allow it to lag the requested end by
    // up to the grace window before declaring the aggregate unusable.
    const graceEnd = dayjs(end).subtract(STALE_GRACE_DAYS, 'day').format('YYYY-MM-DD')
    if (!Array.isArray(agg.sailings) || agg.start > start || agg.end < graceEnd) return null
    return agg.sailings
      .filter((r) => r.d >= start && r.d <= end)
      .map((r) => ({
        dateIso: r.d,
        sailingTime: r.t,
        direction: r.dir,
        actualDepartureTime: r.dep,
        lastCapacity: r.cap,
        capacitySource: r.src,
        filledAt: r.fa,
        crosswalkFullAt: r.cw,
      }))
  } catch (e) {
    console.warn('[useHistoricalStats] aggregate read failed, falling back:', e)
    return null
  }
}

// Degraded-mode fallback when the aggregate is missing or long-stale. Bounded
// by a hard doc cap: a 52-week HistoryPage request could otherwise scan ~11k
// docs. Range scans return ascending dateIso, so truncation drops the newest
// days — acceptable for a fallback. Caching lives in loadHistoryDocs below.
const DIRECT_LIMIT = 2500

async function fetchDirect(start, end) {
  const q = query(
    collection(db, 'sailingStatus'),
    where('dateIso', '>=', start),
    where('dateIso', '<=', end),
    limit(DIRECT_LIMIT),
  )
  const snap = await getDocs(q)
  const out = []
  snap.forEach((d) => out.push(d.data()))
  return out
}

// One fetch per date range for the whole session, shared by every composable
// instance.
//
// HomePage and HistoryPage each call useHistoricalStats(), and both want the
// same default window — so without this, navigating home -> history -> home
// re-read the same data three times. That was one Firestore read per visit on
// the aggregate path and a bounded range scan on the fallback path, neither of
// which tells us anything we didn't already have.
//
// Keyed by range rather than a single slot, so a HistoryPage set to a longer
// window doesn't evict the home page's data (or vice versa) and send the next
// navigation back to the network. Capped because the key space is unbounded —
// the week count comes from the URL.
//
// `inflight` collapses concurrent callers onto one request: without it two
// components mounting in the same tick would both miss the cache and fire.
const DOCS_CACHE_TTL_MS = 10 * 60 * 1000
const DOCS_CACHE_MAX = 4
const docsCache = new Map() // key -> { docs, at }
const inflight = new Map() // key -> Promise

async function loadHistoryDocs(start, end) {
  const key = `${start}|${end}`
  const hit = docsCache.get(key)
  if (hit && Date.now() - hit.at < DOCS_CACHE_TTL_MS) return hit.docs
  const pending = inflight.get(key)
  if (pending) return pending

  const promise = (async () => {
    try {
      const docs = (await fetchFromAggregate(start, end)) ?? (await fetchDirect(start, end))
      docsCache.set(key, { docs, at: Date.now() })
      if (docsCache.size > DOCS_CACHE_MAX) docsCache.delete(docsCache.keys().next().value)
      return docs
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, promise)
  return promise
}

export function useHistoricalStats() {
  const loading = ref(false)
  const error = ref(null)
  const docs = ref([])
  const impactedDates = ref([])
  const excludeHolidays = ref(true)

  async function fetchStats({ weeksBack = 8, excludeHolidays: exclude = true } = {}) {
    loading.value = true
    error.value = null
    excludeHolidays.value = exclude
    try {
      const start = nowInVancouver().subtract(weeksBack, 'week').format('YYYY-MM-DD')
      const end = nowInVancouver().subtract(1, 'day').format('YYYY-MM-DD')
      // Always compute the impacted set so the holiday toggle can be flipped
      // without refetching — exclusion happens reactively in byDayOfWeek.
      impactedDates.value = [...getImpactedDates(start, end)].sort()
      docs.value = await loadHistoryDocs(start, end)
    } catch (e) {
      console.error('[useHistoricalStats] fetch failed:', e)
      error.value = e.message
    }
    loading.value = false
  }

  const byDayOfWeek = computed(() => {
    if (!excludeHolidays.value) return aggregateSailings(docs.value)
    const impacted = new Set(impactedDates.value)
    return aggregateSailings(docs.value.filter((d) => !impacted.has(d.dateIso)))
  })

  return { loading, error, docs, impactedDates, excludeHolidays, byDayOfWeek, fetchStats }
}
