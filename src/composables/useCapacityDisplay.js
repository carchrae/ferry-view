// Shared display helpers for capacity values. Stored capacity strings are
// percent *available* ("25%" = 75% full); "Full" means no deck space and
// "Not Full" means a rider reported room without knowing how much.

export function getDeckColor(available) {
  if (available === 'Full') return 'red'
  if (available === 'Not Full') return 'positive'
  if (!available) return 'grey'
  const pct = parseInt(available)
  if (isNaN(pct)) return 'grey'
  if (pct >= 80) return 'positive'
  if (pct >= 30) return 'warning'
  return 'negative'
}

export function capacityFullLabel(available) {
  if (!available) return ''
  if (available === 'Full') return 'Full'
  if (available === 'Not Full') return 'Not full'
  const pct = parseInt(available)
  return isNaN(pct) ? available : `${100 - pct}% full`
}
