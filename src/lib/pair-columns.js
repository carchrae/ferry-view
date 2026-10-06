// Side-by-side sailing columns ("to Horseshoe Bay" left, "to Bowen" right)
// as rows, so each row reads left-to-right in time order. One boat shuttles
// back and forth, so departures alternate terminals and the two lists
// interleave; if the left column's first sailing is later than the right's,
// the left column starts one row down (a single empty cell) and every row
// after that falls into order on its own.
//
// Pure, so it is unit-testable. `timeOf` returns something comparable with
// `>` (a Date, dayjs, or minutes).
// @returns {Array<{l: object|null, r: object|null}>}
export function pairColumns(left, right, timeOf) {
  const l = [...(left || [])]
  const r = [...(right || [])]
  if (l.length && r.length && timeOf(l[0]) > timeOf(r[0])) l.unshift(null)
  const rows = []
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    rows.push({ l: l[i] ?? null, r: r[i] ?? null })
  }
  return rows
}
