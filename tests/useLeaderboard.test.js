import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  capacityCamp,
  scoreSailing,
  aggregateLeaderboard,
  formatReporterName,
} from '../src/composables/leaderboardScore.js'

// Helper: build a report. Reports for one sailing share a sailingKey.
function rep(userUid, capacity, recordedAt, extra = {}) {
  return { sailingKey: 'S', userUid, capacity, recordedAt, ...extra }
}

describe('capacityCamp', () => {
  it('only "Full" is the FULL camp; everything else is NOTFULL', () => {
    assert.equal(capacityCamp('Full'), 'FULL')
    assert.equal(capacityCamp('Not Full'), 'NOTFULL')
    assert.equal(capacityCamp('25%'), 'NOTFULL') // 75% full
    assert.equal(capacityCamp('10%'), 'NOTFULL') // 90% full
    assert.equal(capacityCamp('0%'), 'NOTFULL')
  })
})

describe('scoreSailing', () => {
  it('single reporter earns the base credit', () => {
    const { credits, disputed, resolved, winner } = scoreSailing([rep('A', 'Full', 1)])
    assert.equal(credits.get('A'), 1.0)
    assert.equal(disputed, false)
    assert.equal(resolved, true)
    assert.equal(winner, 'FULL')
  })

  it('undisputed agreement: first 1.0, later agreer +0.1', () => {
    const { credits, disputed } = scoreSailing([rep('A', 'Full', 1), rep('B', 'Full', 2)])
    assert.equal(credits.get('A'), 1.0)
    assert.equal(credits.get('B'), 0.1)
    assert.equal(disputed, false)
  })

  it('"Not Full" agrees with a percent report (no dispute)', () => {
    // 75%-full (stored "25%") and "Not Full" are the same NOTFULL camp.
    const { credits, disputed } = scoreSailing([rep('A', 'Not Full', 1), rep('B', '25%', 2)])
    assert.equal(disputed, false)
    assert.equal(credits.get('A'), 1.0)
    assert.equal(credits.get('B'), 0.1)
  })

  it('disputed & tied: everyone 0.1, unresolved conflict', () => {
    const { credits, disputed, resolved, winner } = scoreSailing([
      rep('A', 'Full', 1),
      rep('B', '25%', 2),
    ])
    assert.equal(credits.get('A'), 0.1)
    assert.equal(credits.get('B'), 0.1)
    assert.equal(disputed, true)
    assert.equal(resolved, false)
    assert.equal(winner, null)
  })

  it("user's resolve example: A 1.0 (first correct), C 0.5 (confirm), B 0.1 (loser)", () => {
    const { credits, disputed, resolved, winner } = scoreSailing([
      rep('A', 'Full', 1),
      rep('B', '25%', 2), // 75% full — loses
      rep('C', 'Full', 3),
    ])
    assert.equal(credits.get('A'), 1.0)
    assert.equal(credits.get('C'), 0.5)
    assert.equal(credits.get('B'), 0.1)
    assert.equal(disputed, true)
    assert.equal(resolved, true)
    assert.equal(winner, 'FULL')
  })

  it('deduplicates to each user\'s latest report', () => {
    // A first said Full, then changed to Not Full; only the latest counts, so
    // there is no dispute and A is the sole (undisputed) reporter.
    const { credits, disputed } = scoreSailing([
      rep('A', 'Full', 1),
      rep('A', 'Not Full', 5),
    ])
    assert.equal(disputed, false)
    assert.equal(credits.size, 1)
    assert.equal(credits.get('A'), 1.0)
  })

  it('ignores reports without a userUid', () => {
    const { credits } = scoreSailing([{ sailingKey: 'S', capacity: 'Full', recordedAt: 1 }])
    assert.equal(credits.size, 0)
  })
})

describe('aggregateLeaderboard', () => {
  it('sums credits per user across sailings and ranks them', () => {
    const reports = [
      // Sailing 1: A first (1.0), B agrees (0.1)
      { sailingKey: 'S1', userUid: 'A', userName: 'Ann Alpha', capacity: 'Full', recordedAt: 1 },
      { sailingKey: 'S1', userUid: 'B', userName: 'Bob Beta', capacity: 'Full', recordedAt: 2 },
      // Sailing 2: B alone (1.0)
      { sailingKey: 'S2', userUid: 'B', userName: 'Bob Beta', capacity: 'Not Full', recordedAt: 3 },
    ]
    const board = aggregateLeaderboard(reports)
    assert.equal(board.length, 2)
    // B: 0.1 + 1.0 = 1.1 (rank 1); A: 1.0 (rank 2)
    assert.equal(board[0].userUid, 'B')
    assert.equal(board[0].credits, 1.1)
    assert.equal(board[0].reportCount, 2)
    assert.equal(board[1].userUid, 'A')
    assert.equal(board[1].credits, 1.0)
  })

  it('keeps the most recent userName for a user', () => {
    const reports = [
      { sailingKey: 'S1', userUid: 'A', userName: 'Old Name', capacity: 'Full', recordedAt: 1 },
      { sailingKey: 'S2', userUid: 'A', userName: 'New Name', capacity: 'Full', recordedAt: 9 },
    ]
    const board = aggregateLeaderboard(reports)
    assert.equal(board[0].userName, 'New Name')
  })
})

describe('formatReporterName', () => {
  it('formats first name + last initial', () => {
    assert.equal(formatReporterName('Tom Carchrae'), 'Tom C.')
    assert.equal(formatReporterName('Tom'), 'Tom')
    assert.equal(formatReporterName('tom@example.com'), 'tom')
    assert.equal(formatReporterName('  Jane  Q  Doe '), 'Jane D.')
    assert.equal(formatReporterName(''), 'A rider')
    assert.equal(formatReporterName(null), 'A rider')
  })
})
