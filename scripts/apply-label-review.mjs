#!/usr/bin/env node
// Apply a reviewed label file (from the review page's "download assessment")
// back into the training set.
//
//   npm run terminal:apply-review -- ~/Downloads/terminal-labels-claude-reviewed.json
//
// Input: { "<frame path>": 1 | 0 | null } — the corrected label, null to drop
// it entirely. Updates BOTH training-data/terminal-labels.json (the training
// set) and terminal-labels-claude.json (the provenance record of which labels
// Claude contributed, so a later review sees only what is still Claude's).
// Prints a summary; re-run `npm run lineup:export` + `npm run terminal:train`
// afterwards to retrain on the corrected set.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(repoRoot, 'training-data')
const LABELS = join(DATA, 'terminal-labels.json')
const CLAUDE = join(DATA, 'terminal-labels-claude.json')

const input = process.argv[2]
if (!input || !existsSync(input)) {
  console.error('Usage: node scripts/apply-label-review.mjs <reviewed.json>')
  process.exit(1)
}
const reviewed = JSON.parse(readFileSync(input, 'utf8'))
const labels = JSON.parse(readFileSync(LABELS, 'utf8'))
const claude = existsSync(CLAUDE) ? JSON.parse(readFileSync(CLAUDE, 'utf8')) : {}

let kept = 0
let flipped = 0
let dropped = 0
for (const [path, value] of Object.entries(reviewed)) {
  const before = labels[path]
  if (value === null) {
    delete labels[path]
    delete claude[path]
    dropped++
  } else {
    if (before !== undefined && before !== value) flipped++
    else kept++
    labels[path] = value
    // A human has now vouched for this label, so it is no longer Claude's to
    // re-review — but it stays in the training set.
    delete claude[path]
  }
}
writeFileSync(LABELS, JSON.stringify(labels, null, 1) + '\n')
writeFileSync(CLAUDE, JSON.stringify(claude, null, 1) + '\n')

const pos = Object.values(labels).filter((v) => v === 1).length
console.log(`reviewed ${Object.keys(reviewed).length}: ${kept} confirmed, ${flipped} corrected, ${dropped} dropped`)
console.log(`training set now ${Object.keys(labels).length} labels (${pos} cars, ${Object.keys(labels).length - pos} no-cars)`)
console.log(`unreviewed Claude labels remaining: ${Object.keys(claude).length}`)
console.log('Next: npm run lineup:export && npm run terminal:train')
