import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tallyVotes,
  isReportHidden,
  visibleReports,
  nextVote,
  reportScore,
  groupReportsByDay,
  USER_REPORT_WINDOW_MS,
} from '../src/lib/user-reports.js'

test('tallyVotes counts ups and downs, ignoring junk', () => {
  assert.deepEqual(tallyVotes({ a: 1, b: -1, c: -1, d: 0 }), { up: 1, down: 2 })
  assert.deepEqual(tallyVotes(undefined), { up: 0, down: 0 })
})

test('hidden only after MORE than 3 thumbs down', () => {
  assert.equal(isReportHidden({ votes: { a: -1, b: -1, c: -1 } }), false)
  assert.equal(isReportHidden({ votes: { a: -1, b: -1, c: -1, d: -1 } }), true)
  // Up-votes don't rescue it — the rule is a plain down-vote count.
  assert.equal(isReportHidden({ votes: { a: -1, b: -1, c: -1, d: -1, e: 1, f: 1 } }), true)
})

test('visibleReports drops old and hidden, newest first', () => {
  const now = 10 * USER_REPORT_WINDOW_MS
  const reports = [
    { id: 'old', createdAt: now - USER_REPORT_WINDOW_MS - 1, votes: {} },
    { id: 'a', createdAt: now - 1000, votes: {} },
    { id: 'b', createdAt: now - 10, votes: { x: 1 } },
    { id: 'down', createdAt: now - 5, votes: { a: -1, b: -1, c: -1, d: -1 } },
  ]
  assert.deepEqual(
    visibleReports(reports, now).map((r) => r.id),
    ['b', 'a'],
  )
})

test('nextVote toggles off a repeated vote', () => {
  assert.equal(nextVote({}, 'u', 1), 1)
  assert.equal(nextVote({ u: 1 }, 'u', 1), null)
  assert.equal(nextVote({ u: 1 }, 'u', -1), -1)
})

test('reportScore is thumbs up minus thumbs down', () => {
  assert.equal(reportScore({ votes: { a: 1, b: 1, c: -1 } }), 1)
  assert.equal(reportScore({}), 0)
})

test('groupReportsByDay: newest day first, most popular first, nothing past 48h', () => {
  // 1:00 pm Oct 3 in the app's fixed UTC-7 zone.
  const now = Date.UTC(2026, 9, 3, 20, 0)
  const at = (d, h) => Date.UTC(2026, 9, d, h + 7, 0) // local d @ h:00
  const reports = [
    { id: 'today-new', createdAt: at(3, 12), votes: {} },
    { id: 'today-top', createdAt: at(3, 8), votes: { a: 1, b: 1 } },
    { id: 'today-tie-old', createdAt: at(3, 7), votes: {} },
    { id: 'yest', createdAt: at(2, 10), votes: { a: 1, b: -1 } },
    { id: 'yest-top', createdAt: at(2, 9), votes: { a: 1 } },
    { id: 'two-days', createdAt: at(1, 14), votes: {} }, // 47h ago
    { id: 'too-old', createdAt: at(1, 12), votes: { a: 1, b: 1, c: 1 } }, // 49h ago
  ]
  const groups = groupReportsByDay(reports, now)
  assert.deepEqual(
    groups.map((g) => [g.label, g.reports.map((r) => r.id)]),
    [
      ['Today', ['today-top', 'today-new', 'today-tie-old']],
      ['Yesterday', ['yest-top', 'yest']],
      ['Thursday', ['two-days']],
    ],
  )
})
