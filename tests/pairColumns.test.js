import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pairColumns } from '../src/lib/pair-columns.js'

const t = (x) => x.t
const ids = (rows) => rows.map(({ l, r }) => [l?.id ?? null, r?.id ?? null])

test('pairs rows as-is when the left column already leads', () => {
  const left = [{ id: 'L1', t: 10 }, { id: 'L2', t: 30 }]
  const right = [{ id: 'R1', t: 20 }, { id: 'R2', t: 40 }]
  assert.deepEqual(ids(pairColumns(left, right, t)), [
    ['L1', 'R1'],
    ['L2', 'R2'],
  ])
})

test('one gap at the top of the left column when it starts later', () => {
  // 5:15 to HSB sits after 4:40 to Bowen, so the left column drops a row.
  const left = [{ id: '5:15', t: 515 }, { id: '6:15', t: 615 }, { id: '7:30', t: 730 }]
  const right = [{ id: '4:40', t: 440 }, { id: '5:45', t: 545 }, { id: '6:50', t: 650 }, { id: '8:05', t: 805 }]
  assert.deepEqual(ids(pairColumns(left, right, t)), [
    [null, '4:40'],
    ['5:15', '5:45'],
    ['6:15', '6:50'],
    ['7:30', '8:05'],
  ])
})

test('uneven lengths pad with empty cells; an empty side needs no gap', () => {
  assert.deepEqual(ids(pairColumns([{ id: 'L1', t: 1 }], [], t)), [['L1', null]])
  assert.deepEqual(ids(pairColumns([], [{ id: 'R1', t: 1 }, { id: 'R2', t: 2 }], t)), [
    [null, 'R1'],
    [null, 'R2'],
  ])
  assert.deepEqual(pairColumns([], [], t), [])
})
