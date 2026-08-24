import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { useToday, syncToday } from '../src/composables/useToday.js'

// Both the home page's day-of-week predictions and the history page's "today"
// card once read the date from `computed(() => nowInVancouver().format(...))`,
// which has no reactive dependency and so is evaluated once and cached
// forever — a tab left open across midnight kept showing yesterday. These
// tests pin the behaviour that replaced it.
describe('useToday', () => {
  // Late evening in Vancouver (23:30 PDT on Aug 24 2026 = 06:30Z Aug 25).
  const BEFORE = Date.UTC(2026, 7, 25, 6, 30)
  const AFTER = Date.UTC(2026, 7, 25, 7, 30) // 00:30 PDT, next day

  it('tracks the Vancouver date across a rollover', () => {
    mock.timers.enable({ apis: ['Date'], now: BEFORE })
    try {
      const { todayIso, todayDow } = useToday()
      assert.equal(todayIso.value, '2026-08-24')
      assert.equal(todayDow.value, 'Monday')

      mock.timers.setTime(AFTER)
      // Stale until something ticks — the value is polled, not derived.
      assert.equal(todayIso.value, '2026-08-24')

      syncToday()
      assert.equal(todayIso.value, '2026-08-25')
      assert.equal(todayDow.value, 'Tuesday')
    } finally {
      mock.timers.reset()
    }
  })

  it('leaves the ref untouched when the date has not changed', () => {
    mock.timers.enable({ apis: ['Date'], now: BEFORE })
    try {
      const { today } = useToday()
      const before = today.value
      mock.timers.setTime(BEFORE + 60_000)
      syncToday()
      // Same object identity: a poll on an unchanged date must not invalidate
      // every downstream computed four times a minute.
      assert.equal(today.value, before)
    } finally {
      mock.timers.reset()
    }
  })
})
