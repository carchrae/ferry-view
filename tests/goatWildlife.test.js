import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { wildlifeAt, cycleKind } from '../src/components/goat-wildlife.js'

const hillY = () => 90
const x = (transform) => +transform.match(/translate\(([-\d.]+)/)[1]
// First cycle (of CYCLE_S = 26 s) of each kind, and a time `c` into it.
const cycleOf = (kind) => [...Array(200).keys()].find((n) => cycleKind(n) === kind)
const at = (kind, c) => wildlifeAt(cycleOf(kind) * 26 + c, hillY)

describe('goat wildlife', () => {
  it('has a herd of three, the buck with antlers', () => {
    const w = wildlifeAt(1, hillY)
    assert.deepEqual(
      w.deer.map((d) => d.id),
      ['doe', 'buck', 'fawn'],
    )
    assert.ok(w.deer.find((d) => d.id === 'buck').antlers)
    assert.equal(w.deer.find((d) => d.id === 'doe').antlers, null)
  })

  it('plays every kind of story over time', () => {
    const kinds = new Set([...Array(40).keys()].map(cycleKind))
    assert.deepEqual([...kinds].sort(), ['bear', 'chase', 'quiet', 'spotted'])
  })

  it('chase: the cougar runs behind the herd, away from the trees, and they vanish', () => {
    for (let c = 11; c < 12.5; c += 0.25) {
      const w = at('chase', c)
      const lastDeer = Math.min(...w.deer.map((d) => x(d.transform)))
      assert.ok(x(w.cougar.transform) < lastDeer, `cougar behind the herd at c=${c}`)
      assert.ok(
        w.deer.every((d) => x(d.transform) > 140),
        'fleeing away from the trees',
      )
    }
    const gone = at('chase', 15)
    assert.ok(gone.deer.every((d) => d.opacity === 0) && gone.cougar.opacity === 0)
    // …and back grazing by the end of the cycle
    const back = at('chase', 25.9)
    assert.ok(back.deer.every((d) => d.opacity === 1 && x(d.transform) < 200))
  })

  it('spotted: the cougar creeps up, then slinks back to the trees', () => {
    assert.ok(x(at('spotted', 8).cougar.transform) > x(at('spotted', 15.5).cougar.transform))
  })

  it('quiet: the cougar sleeps', () => {
    assert.ok(at('quiet', 10).cougar.asleep)
  })

  it('bear visit: the bear rears up and the herd keeps its distance', () => {
    const w = at('bear', 8)
    assert.match(w.bear.body, /rotate\(-62/)
    assert.ok(w.deer.every((d) => x(d.transform) > x(w.bear.transform) + 30))
  })
})
