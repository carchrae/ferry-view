import {
  terminalEmptyFrameTs,
  terminalFullAtDeparture,
  FULL_TAIL_FRAMES,
  FULL_CONFIDENT_P,
} from '../../functions/lib/lineup-labels.js'

// Progress of a rider tagging one sailing's terminal frames, and whether the
// robot now has enough to decide if the ferry left full. Pure (no Firebase, no
// DOM) so the walk order and the "enough" rule are unit-testable.
//
// The two verdict rules (lineup-labels.js) are both decided by the TAIL of the
// capture-ordered sequence — not-full needs two empty frames after the last
// solid cars frame, full needs the last FULL_TAIL_FRAMES frames all confidently
// cars — so the frames a human answer is worth most on are the undecided ones
// in that tail. Everything else is optional training data.

// Robot score bands, mirroring useTerminalClassifier.terminalBand. Only used
// when a score comes without its band.
export const DEFAULT_THRESHOLD = 0.5
export const DEFAULT_EMPTY_THRESHOLD = 0.35

const lookup = (m, key) => (m instanceof Map ? m.get(key) : m ? m[key] : undefined)

function bandOf(p, threshold, emptyThreshold) {
  return p >= threshold ? 'cars' : p < emptyThreshold ? 'empty' : 'unsure'
}

// frames: capture-ordered [{ path, ts }]. scores: Map/object path → { p, band }
// or path → p. labels: Map/object path → boolean (a human's answer wins over
// the robot). Returns the merged sequence the verdict rules consume:
// [{ path, ts, p, carsPresent, source: 'human' | 'robot' | null, band }].
export function mergeFrameEvidence(frames, scores, labels, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const emptyThreshold = opts.emptyThreshold ?? DEFAULT_EMPTY_THRESHOLD
  return (frames || []).map((f) => {
    const label = lookup(labels, f.path)
    if (typeof label === 'boolean') {
      return {
        path: f.path,
        ts: f.ts,
        p: label ? 1 : 0,
        carsPresent: label,
        source: 'human',
        band: label ? 'cars' : 'empty',
      }
    }
    const raw = lookup(scores, f.path)
    const p = typeof raw === 'number' ? raw : typeof raw?.p === 'number' ? raw.p : null
    if (p == null) return { path: f.path, ts: f.ts, p: null, carsPresent: null, source: null, band: null }
    const band = raw?.band || bandOf(p, threshold, emptyThreshold)
    return {
      path: f.path,
      ts: f.ts,
      p,
      carsPresent: band === 'cars' ? true : band === 'empty' ? false : null,
      source: 'robot',
      band,
    }
  })
}

// A frame whose answer can no longer change the verdict: a human said so, the
// robot is confidently empty, or confidently cars at the stricter FULL cut.
// Weak cars (threshold ≤ p < FULL_CONFIDENT_P) is deliberately undecided — it
// counts as cars for the not-full rule but blocks the full rule, so a human
// answer there is exactly what unlocks a verdict.
export function isDecided(f) {
  if (!f) return false
  if (f.source === 'human') return true
  if (f.band === 'empty') return true
  return typeof f.p === 'number' && f.p >= FULL_CONFIDENT_P
}

// The rider's progress on this sailing.
//   verdict   'notFull' | 'full' | null — what the merged evidence decides
//   verdictTs the deciding frame's ts (confirming empty frame / last frame)
//   vetoed    the full rule fired but the lineup never reached the crosswalk
//   needed    tail frames still undecided (latest first) — empty once decided
//   unsure    other unlabelled frames the robot is unsure about (latest first)
//   walkOrder needed, then unsure, then every other unlabelled frame
//   enough    a verdict, a veto, or nothing left in the tail to ask about
export function taggingProgress(frames, { scores, labels, crosswalkOk = false, ...opts } = {}) {
  const seq = mergeFrameEvidence(frames, scores, labels, opts)
  const total = seq.length
  const labelled = seq.filter((f) => f.source === 'human').length

  const emptyTs = terminalEmptyFrameTs(seq)
  const fullAt = emptyTs == null ? terminalFullAtDeparture(seq) : null
  let verdict = null
  let verdictTs = null
  let vetoed = false
  if (emptyTs != null) {
    verdict = 'notFull'
    verdictTs = emptyTs
  } else if (fullAt != null) {
    if (crosswalkOk) {
      verdict = 'full'
      verdictTs = fullAt
    } else vetoed = true
  }

  const unlabelled = (i) => seq[i].source !== 'human'
  const tailStart = Math.max(0, total - FULL_TAIL_FRAMES)
  const latestFirst = (a, b) => b - a
  const needed =
    verdict || vetoed
      ? []
      : [...seq.keys()]
          .filter((i) => i >= tailStart && unlabelled(i) && !isDecided(seq[i]))
          .sort(latestFirst)
  const neededSet = new Set(needed)
  const unsure = [...seq.keys()]
    .filter((i) => !neededSet.has(i) && unlabelled(i) && seq[i].band === 'unsure')
    .sort(latestFirst)
  const taken = new Set([...needed, ...unsure])
  const rest = [...seq.keys()].filter((i) => !taken.has(i) && unlabelled(i)).sort(latestFirst)

  return {
    seq,
    total,
    labelled,
    verdict,
    verdictTs,
    vetoed,
    needed,
    unsure,
    walkOrder: [...needed, ...unsure, ...rest],
    enough: verdict != null || vetoed || needed.length === 0,
  }
}

// The one-line progress copy. `scoresReady` false = the robot hasn't scored the
// frames yet, so the "more to decide" count would be meaningless.
export function progressLine(progress, { scoresReady = true } = {}) {
  const { labelled, total, verdict, vetoed, needed, unsure } = progress
  const head = `${labelled} of ${total} frame${total === 1 ? '' : 's'} tagged`
  if (!scoresReady) return `${head} — robot is scoring the frames…`
  if (verdict || vetoed) return `${head} — enough to decide`
  if (needed.length) return `${head} — ${needed.length} more to decide`
  if (unsure.length)
    return `${head} — tail done; ${unsure.length} more the robot is unsure about (optional)`
  return head
}
