// Daylight-banded classifier models.
//
// A model JSON may carry `members`: one logistic sub-model per solar-elevation
// band, each `{ name, elevation: { min, max }, weights, bias }` (any number
// of them; `min` inclusive, `max` exclusive, degrees; omit either side for
// open-ended). Scoring a frame picks the member whose band contains the
// frame's solar elevation at capture time; the top-level `weights`/`bias` —
// trained on every band — remain the fallback for elevations no member
// covers, for callers that pass no timestamp, and for anything (old deploys,
// the report's weight maps) that only knows the single-model shape.
// `regions`, `masks`, `threshold`, `emptyThreshold` stay top-level and shared:
// members only change how a frame is scored, never what a score means.
//
// Why bands: the terminal cam's sunrise false positives (precision 0.6
// between civil twilight and 8°, 0.9+ by day — docs/lineup-classifier.md §7)
// are a different scene, not a harder one; one linear template cannot serve
// both, two can (CV: F1 0.906 → 0.928 with a split at 0°).
import { solarElevation } from './daylight.js'

// A weight vector: a plain array (model JSON) or a typed array (the trainer
// scoring its own in-memory members).
const isVector = (w) => Array.isArray(w) || ArrayBuffer.isView(w)

// The weights/bias to score with for a frame captured at `ts` (epoch ms).
export function selectMember(model, ts) {
  const members = model?.members
  if (!Array.isArray(members) || !members.length || ts == null) return model
  const e = solarElevation(ts)
  for (const m of members) {
    const lo = m.elevation?.min ?? -Infinity
    const hi = m.elevation?.max ?? Infinity
    if (e >= lo && e < hi && isVector(m.weights)) return m
  }
  return model
}

// Logistic score of `features` under the member that applies at `ts`.
export function scoreWithMembers(model, features, ts) {
  const m = selectMember(model, ts)
  let z = m.bias || 0
  const w = m.weights
  for (let i = 0; i < w.length; i++) z += w[i] * features[i]
  return 1 / (1 + Math.exp(-z))
}

// Every member (if any) must have a full-length weight vector, or a member
// could be selected and score garbage. The top-level weights are checked by
// the runtime's own `usable` test.
export function membersUsable(model, featureLength) {
  const members = model?.members
  if (members == null) return true
  return (
    Array.isArray(members) &&
    members.every((m) => isVector(m.weights) && m.weights.length === featureLength && m.elevation)
  )
}

// Human-readable band list for logs and the report, e.g. "<0°, ≥0°".
export function describeMembers(model) {
  const members = model?.members
  if (!Array.isArray(members) || !members.length) return 'single model'
  return members
    .map((m) => {
      const lo = m.elevation?.min, hi = m.elevation?.max
      return lo == null ? `<${hi}°` : hi == null ? `≥${lo}°` : `${lo}°…${hi}°`
    })
    .join(', ')
}
