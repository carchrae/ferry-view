#!/usr/bin/env node
// Fold reviewed night labels back into the training set.
//
//   npm run lineup:dark-apply-review -- corrections.json
//
// Input, as exported by training-data/lineup-dark-labeling.html:
//   { frames: { "<frame path>": 1 | 0 | null }, crosswalk: { "<sailingKey>": epochMs | null } }
// (a bare { "<frame path>": 0|1 } map is accepted too). Frame labels go to
// training-data/lineup-dark-labels.json (hand labels, what
// scripts/train-night-classifier.mjs trains on) and leave
// lineup-dark-labels-claude.json (a human now vouches). Crosswalk times go
// to training-data/lineup-crosswalk-hand.json — a hand crosswalk mark per
// sailing (null = never past the crosswalk), which the exporter applies over
// rider marks when it labels the DAY frames, so a dawn/dusk review feeds
// both models. Mirrors scripts/apply-label-review.mjs for the terminal
// classifier.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(repoRoot, 'training-data')
const LABELS = join(DATA, 'lineup-dark-labels.json')
const CLAUDE = join(DATA, 'lineup-dark-labels-claude.json')
const CROSSWALK = join(DATA, 'lineup-crosswalk-hand.json')

const input = process.argv[2]
if (!input || !existsSync(input)) {
  console.error('Usage: node scripts/apply-dark-label-review.mjs <reviewed.json>')
  process.exit(1)
}
const loadJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {})
const reviewed = JSON.parse(readFileSync(input, 'utf8'))
const frames = reviewed.frames ?? (reviewed.crosswalk ? {} : reviewed)
const crosswalk = reviewed.crosswalk ?? {}
const labels = loadJson(LABELS)
const claude = loadJson(CLAUDE)
const hand = loadJson(CROSSWALK)

let kept = 0, flipped = 0, dropped = 0
for (const [path, value] of Object.entries(frames)) {
  const before = labels[path] ?? claude[path]
  if (value === null) { delete labels[path]; delete claude[path]; dropped++; continue }
  if (value !== 0 && value !== 1) continue
  if (before !== undefined && before !== value) flipped++; else kept++
  labels[path] = value
  delete claude[path]
}
let marks = 0, nevers = 0
for (const [key, ts] of Object.entries(crosswalk)) {
  if (ts === null) { hand[key] = null; nevers++ } else if (Number.isFinite(Number(ts))) { hand[key] = Number(ts); marks++ }
}
writeFileSync(LABELS, JSON.stringify(labels, null, 1) + '\n')
writeFileSync(CLAUDE, JSON.stringify(claude, null, 1) + '\n')
if (marks || nevers) writeFileSync(CROSSWALK, JSON.stringify(hand, null, 1) + '\n')

const pos = Object.values(labels).filter((v) => v === 1).length
console.log(`frames: ${kept} confirmed, ${flipped} corrected, ${dropped} dropped → hand night labels ${Object.keys(labels).length} (${pos} past crosswalk); Claude labels still unreviewed: ${Object.keys(claude).length}`)
console.log(`crosswalk times: ${marks} mark(s), ${nevers} never(s) → ${Object.keys(hand).length} hand crosswalk entries in lineup-crosswalk-hand.json`)
console.log('Next: npm run lineup:export (relabels day frames with the hand marks) · npm run lineup:dark-label · npm run lineup:train-night')
