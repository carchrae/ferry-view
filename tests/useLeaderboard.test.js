import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  capacityCamp,
  scoreSailing,
  aggregateLeaderboard,
  aggregateRideLeaderboard,
  formatReporterName,
} from '../functions/lib/leaderboard-score.js'

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

  it('breaks credit/report ties by most recent report', () => {
    const reports = [
      { sailingKey: 'S1', userUid: 'A', capacity: 'Full', recordedAt: 5 },
      { sailingKey: 'S2', userUid: 'B', capacity: 'Full', recordedAt: 9 },
    ]
    const board = aggregateLeaderboard(reports)
    // Both 1.0 credit / 1 report; B reported more recently, so B ranks first.
    assert.equal(board[0].userUid, 'B')
    assert.equal(board[1].userUid, 'A')
  })

  it('follows the most recent report for the anonymous flag', () => {
    const anon = aggregateLeaderboard([
      { sailingKey: 'S1', userUid: 'A', capacity: 'Full', recordedAt: 1, anonymous: false },
      { sailingKey: 'S2', userUid: 'A', capacity: 'Full', recordedAt: 9, anonymous: true },
    ])
    assert.equal(anon[0].anonymous, true)

    const unhidden = aggregateLeaderboard([
      { sailingKey: 'S1', userUid: 'A', capacity: 'Full', recordedAt: 1, anonymous: true },
      { sailingKey: 'S2', userUid: 'A', capacity: 'Full', recordedAt: 9, anonymous: false },
    ])
    assert.equal(unhidden[0].anonymous, false)
  })
})

describe('aggregateRideLeaderboard', () => {
  it('credits offers at 10 and requests at 5, and ranks by credits', () => {
    const rides = [
      { authorUid: 'A', authorName: 'Ann Alpha', createdAt: 1, type: 'offer' },
      { authorUid: 'A', authorName: 'Ann Alpha', createdAt: 2, type: 'offer' },
      { authorUid: 'A', authorName: 'Ann Alpha', createdAt: 3, type: 'request' },
      { authorUid: 'B', authorName: 'Bob Beta', createdAt: 4, type: 'offer' },
      { authorUid: 'B', authorName: 'Bob Beta', createdAt: 5, type: 'offer' },
      { authorUid: 'C', authorName: 'Cy Gamma', createdAt: 6, type: 'offer' }, // single ride — excluded
    ]
    const board = aggregateRideLeaderboard(rides)
    assert.equal(board.length, 2)
    assert.equal(board[0].userUid, 'A') // 10 + 10 + 5 = 25
    assert.equal(board[0].credits, 25.0)
    assert.equal(board[0].reportCount, 3)
    assert.equal(board[1].userUid, 'B') // 10 + 10 = 20
    assert.equal(board[1].credits, 20.0)
    assert.ok(!board.some((e) => e.userUid === 'C'))
  })

  it('treats a missing/unknown type as a request (5 credits)', () => {
    const board = aggregateRideLeaderboard([
      { authorUid: 'A', authorName: 'A', createdAt: 1 },
      { authorUid: 'A', authorName: 'A', createdAt: 2 },
    ])
    assert.equal(board[0].credits, 10.0)
  })

  it('excludes riders with only one ride', () => {
    const board = aggregateRideLeaderboard([
      { authorUid: 'A', authorName: 'A', createdAt: 1 },
      { authorUid: 'A', authorName: 'A', createdAt: 2 },
      { authorUid: 'B', authorName: 'B', createdAt: 3 },
    ])
    assert.equal(board.length, 1)
    assert.equal(board[0].userUid, 'A')
  })

  it('keeps the most recent name and photo, ignores authorless rides', () => {
    const rides = [
      { authorUid: 'A', authorName: 'Old', authorPhoto: 'old.png', createdAt: 1 },
      { authorUid: 'A', authorName: 'New', authorPhoto: null, createdAt: 9 },
      { authorName: 'Ghost', createdAt: 5 },
    ]
    const board = aggregateRideLeaderboard(rides)
    assert.equal(board.length, 1)
    assert.equal(board[0].userName, 'New')
    assert.equal(board[0].userPhoto, 'old.png')
  })

  it('breaks ties by most recent ride', () => {
    const board = aggregateRideLeaderboard([
      { authorUid: 'A', authorName: 'A', createdAt: 5 },
      { authorUid: 'A', authorName: 'A', createdAt: 5 },
      { authorUid: 'B', authorName: 'B', createdAt: 9 },
      { authorUid: 'B', authorName: 'B', createdAt: 9 },
    ])
    assert.equal(board[0].userUid, 'B')
    assert.equal(board[1].userUid, 'A')
  })
})

describe('formatReporterName', () => {
  it('formats first name + last initial', () => {
    assert.equal(formatReporterName('Tom Carchrae'), 'Tom C.')
    assert.equal(formatReporterName('Tom'), 'Tom')
    assert.equal(formatReporterName('tom@example.com'), 'tom')
    assert.equal(formatReporterName('  Jane  Q  Doe '), 'Jane D.')
    assert.equal(formatReporterName(''), 'Anonymous')
    assert.equal(formatReporterName(null), 'Anonymous')
  })
})
