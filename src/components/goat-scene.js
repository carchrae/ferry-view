// Timeline for the Bowen GOATs dialog's ferry scene — a pure function of time,
// so the component just renders goatScene(t) each animation frame.
//
// One "half" (H seconds) = the ferry's visit to one dock, then its crossing:
//   0 .. ~2.9    cars unload fast up the hill (far lane), foot passengers walk off
//   1.6 .. ~3.9  waiting walk-ons, then the line of cars, board — up to capacity
//   DEPART .. H  the ferry crosses to the other dock (double-ended: no turning)
// Each visit brings a different number of cars and walk-ons. Whoever doesn't
// fit waits for the next sailing (and the walk-ons hop up and down, furious);
// meanwhile the next line builds behind them.
//
// Everything is laid out for the Bowen side (dock to the west of its berth)
// and mirrored for the mainland across the middle of a world W units wide
// (default 1200; wider screens get a wider world — more water, same hills).
// SVG viewBox is 0 0 W 260.

export const H = 7 // seconds per half cycle
const DEPART = 4.2
const CAR_V = 320 // units/s — "much faster"
const PED_V = 55
const PED_V_ARRIVE = 70
const BERTH = 476 // ferry centre at the Bowen dock (mainland: W - BERTH)
export const WORLD_W = 1200
export const berths = (W = WORLD_W) => [BERTH, W - BERTH]
export const BERTHS = berths()
const DECK_Y = 186 // car deck height (waterline 198 - 12)
const DOCK = { x: 396, y: 198 } // where the road meets the ramp (s = 0)
// The dock's hinged ramp: pivots at the dock edge and, lowered, rests on the
// ferry's car deck at RAMP_TOP. Cars and walk-ons all cross it.
export const RAMP_PIVOT = { x: 398, y: 198 }
const RAMP_TOP = { x: BERTH - 64, y: DECK_Y }
export const RAMP_LENGTH = Math.hypot(RAMP_TOP.x - RAMP_PIVOT.x, RAMP_TOP.y - RAMP_PIVOT.y)
const RAMP_DOWN = (Math.atan2(RAMP_TOP.y - RAMP_PIVOT.y, RAMP_TOP.x - RAMP_PIVOT.x) * 180) / Math.PI
const RAMP_UP = -80 // degrees, raised while the ferry is away
// Deck spot per boarding car k, farthest from the dock first. Cars overlap.
const FAR_SLOTS = Array.from({ length: 10 }, (_, k) => 54 - 12 * k) // 54 … -54
export const CAR_CAPACITY = FAR_SLOTS.length
// Walk-ons ride on the passenger deck roof, either side of the tower.
const RIDER_SPOTS = [-34, -27, 25, 32]
export const PED_CAPACITY = RIDER_SPOTS.length
const QUEUE_S = (k) => 50 + 22 * k // car k's spot in line (0 = front, at the dock)
const WAIT_S = (j) => 14 + 8 * j // walk-on j's spot on the dock
// The line moves off together, like real traffic, keeping its spacing.
const CAR_LOAD = (k) => 2.0 + 0.05 * k
const PED_LOAD = (j) => 1.6 + 0.15 * j
const CAR_UNLOAD = (i) => 0.15 + 0.12 * i
const PED_UNLOAD = (j) => 0.4 + 0.3 * j
const HOP = [3.2, 7.6] // left-behind walk-ons hop mad at the front of the dock
// When the next line's i-th of n newcomers turns up (σ = time since the
// ferry last arrived at this dock).
const PED_ARRIVE = (i, n) => 7.8 + i * Math.min(1.4, 4 / n)
const PED_START_S = 130 // walk-ons appear this far up the road
const PED_GONE_S = 240
const LANE = { out: -3, in: 3, walk: 4 }
export const CAR_COLORS = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00']
const SHIRTS = ['#ff7043', '#26c6da', '#d4e157', '#ec407a', '#ffca28']

// --- Road: dock → up the Bowen hill, sampled by arc length -----------------
// Matches the road path drawn in GoatsDialog.vue (ROAD_D).
export const ROAD_D = 'M396 198 L352 198 L336 186 Q 200 88 60 92 L-60 98'
const ROAD = (() => {
  const pts = []
  const line = (a, b, n) => {
    for (let i = 0; i < n; i++)
      pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
  }
  line([396, 198], [352, 198], 20)
  line([352, 198], [336, 186], 10)
  for (let i = 0; i < 120; i++) {
    const u = i / 120
    const x = (1 - u) ** 2 * 336 + 2 * (1 - u) * u * 200 + u ** 2 * 60
    const y = (1 - u) ** 2 * 186 + 2 * (1 - u) * u * 88 + u ** 2 * 92
    pts.push([x, y])
  }
  line([60, 92], [-60, 98], 40)
  pts.push([-60, 98])
  const s = [0]
  for (let i = 1; i < pts.length; i++) {
    s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  }
  return { pts, s, length: s[s.length - 1] }
})()
export const ROAD_LENGTH = ROAD.length

// Point + uphill unit tangent at arc length s.
function roadAt(s) {
  const { pts, s: cum, length } = ROAD
  const d = Math.min(Math.max(s, 0), length)
  let i = 1
  while (i < cum.length - 1 && cum[i] < d) i++
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
  const [x0, y0] = pts[i - 1]
  const [x1, y1] = pts[i]
  const len = Math.hypot(x1 - x0, y1 - y0) || 1
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, tx: (x1 - x0) / len, ty: (y1 - y0) / len }
}

const mod = (a, n) => ((a % n) + n) % n

// --- Timeline -------------------------------------------------------------
// Halves are H long, plus any breakdown time:
//  - at sea: the ferry stalls mid-channel, smoking, for BREAKDOWN_S (about
//    one crossing in seven);
//  - at the dock: on arrival the ramp jams, flapping up and down, for
//    DOCK_BREAKDOWN_S before anyone can get off (about one in ten) — the
//    whole dock schedule for that visit runs that much later.
// Each gets a guaranteed early occurrence so a short visit still sees one.
const BREAKDOWN_S = 3.5
const DOCK_BREAKDOWN_S = 3
const FIRST_BREAKDOWN = 3
const FIRST_DOCK_BREAKDOWN = 6
export const breaksDown = (h) => h === FIRST_BREAKDOWN || (h > FIRST_BREAKDOWN && rnd(h, 7) < 0.15)
export const rampJams = (h) =>
  h === FIRST_DOCK_BREAKDOWN || (h > FIRST_DOCK_BREAKDOWN && rnd(h, 9) < 0.1)
const dockDelay = (h) => (h >= 0 && rampJams(h) ? DOCK_BREAKDOWN_S : 0)
// Whale crossings: a tail surfaces in the ferry's path, so it eases to a stop
// just short of it and waits until the whale has gone back under (about one
// crossing in five, never on a breakdown crossing; the first comes early).
const WHALE_S = 3.4
const FIRST_WHALE = 1
export const whaleCrossing = (h) =>
  h >= 0 && !breaksDown(h) && (h === FIRST_WHALE || (h > FIRST_WHALE && rnd(h, 13) < 0.2))
const halfLen = (h) =>
  H + (h >= 0 && breaksDown(h) ? BREAKDOWN_S : 0) + dockDelay(h) + (whaleCrossing(h) ? WHALE_S : 0)
const STARTS = [0] // STARTS[h] = when half h begins (h >= 0)
export function halfStart(h) {
  if (h <= 0) return h * H
  while (STARTS.length <= h) STARTS.push(STARTS[STARTS.length - 1] + halfLen(STARTS.length - 1))
  return STARTS[h]
}
// Which half t falls in, how far into it (tau), and how far into its dock
// schedule (tauE — negative while a jammed ramp holds everything up).
function halfAt(t) {
  let h = Math.floor(t / H) // upper bound: halves are never shorter than H
  while (halfStart(h) > t) h--
  const tau = t - halfStart(h)
  return { h, tau, tauE: tau - dockDelay(h) }
}
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2)

// Deterministic "random" in [0, 1) per visit — keeps the scene a pure
// function of time.
function rnd(v, salt) {
  const x = Math.sin(v * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Who's in line at a visit (half index v; a dock's visits are every other
// half): whoever missed the last sailing, then this visit's newcomers
// (3–8 cars and 1–3 walk-ons, or a rush of 11–14 and 5–6 — or, replaying a
// real day, as many as that sailing actually carried). Memoized per scene
// instance (S.lines) — each visit builds on the one before.
const CAPACITY = { car: CAR_CAPACITY, ped: PED_CAPACITY }
function newcomers(S, kind, v) {
  // Mostly quiet sailings; about one in five is a rush that won't all fit.
  const load = S.sampler?.load(v) // 0..1 how full, or 'full', or null
  const rush = load === 'full' || (load == null && rnd(v, 3) < 0.2)
  const r = rnd(v, kind === 'car' ? 1 : 2)
  const n =
    kind === 'car'
      ? rush
        ? CAR_CAPACITY + 1 + Math.floor(r * 4)
        : typeof load === 'number'
          ? Math.max(1, Math.round(load * CAR_CAPACITY))
          : 3 + Math.floor(r * 6)
      : rush
        ? 5 + Math.floor(r * 2)
        : 1 + Math.floor(r * 3)
  return Array.from({ length: n }, (_, i) => ({
    id: `${kind}${v}.${i}`,
    color:
      kind === 'car'
        ? CAR_COLORS[mod(v * 5 + i, CAR_COLORS.length)]
        : SHIRTS[mod(v * 3 + i, SHIRTS.length)],
  }))
}
function lineAt(S, kind, v) {
  if (v < -2) return []
  const memo = S.lines[kind]
  if (!memo.has(v)) {
    // Build up from the earliest visit so the recursion stays shallow.
    let start = v
    while (start - 2 >= -2 && !memo.has(start - 2)) start -= 2
    for (let u = start; u <= v; u += 2) {
      const carry = u - 2 >= -2 ? memo.get(u - 2).slice(CAPACITY[kind]) : []
      memo.set(u, carry.concat(newcomers(S, kind, u)))
    }
  }
  return memo.get(v)
}
// When each of visit v's n newcomer cars turns up (σ: time since the ferry
// last arrived at this dock): irregular gaps — sometimes a convoy
// nose to tail, sometimes a long lull — squeezed into the window before the
// next boarding if they'd overrun it.
const ARRIVE_WINDOW = [4.8, 11.5]
function carArrivals(v, n) {
  const gaps = Array.from({ length: n }, (_, i) => {
    const kind = rnd(v, 40 + i)
    const m = rnd(v, 60 + i)
    if (kind < 0.3) return 0.12 + m * 0.15 // convoy
    if (kind < 0.85) return 0.4 + m * 1.2
    return 2 + m * 2 // lull
  })
  const total = gaps.reduce((a, b) => a + b, 0)
  const scale = Math.min(1, (ARRIVE_WINDOW[1] - ARRIVE_WINDOW[0]) / total)
  let at = ARRIVE_WINDOW[0]
  return gaps.map((g) => (at += g * scale))
}
const boarders = (S, kind, v) => lineAt(S, kind, v).slice(0, CAPACITY[kind])

// A car at (x, y) heading along (dx, dy): its transform keeps it upright with
// the headlights (drawn at +x) leading.
// `mirror` is the world width when drawing the mainland side, else 0.
function car(item, lane, x, y, dx, dy, mirror, mad = false) {
  if (mirror) {
    x = mirror - x
    dx = -dx
  }
  const flip = dx < 0
  const deg = (Math.atan2(flip ? -dy : dy, flip ? -dx : dx) * 180) / Math.PI
  return {
    id: item.id,
    lane,
    color: item.color,
    mad,
    // Where to put the angry "!" (above the roof, unrotated).
    badge: { x: x.toFixed(1), y: (y - 24).toFixed(1) },
    transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})${flip ? ' scale(-1 1)' : ''}`,
  }
}

// mood: 'mad' (missed the boat — red face, "!") or 'confused' (breakdown —
// "?"); either way they hop, which callers bake into y.
function ped(item, x, y, dx, stride, opacity, mirror, mood = null) {
  if (mirror) {
    x = mirror - x
    dx = -dx
  }
  const swing = Math.sin(stride / 3) * 2.2
  return {
    id: item.id,
    shirt: item.color,
    mad: mood === 'mad',
    confused: mood === 'confused',
    flip: dx < 0, // mirrored figure — its ?/! marker counter-flips to stay readable
    transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})${dx < 0 ? ' scale(-1 1)' : ''}`,
    legs: `M0 -4 L${swing.toFixed(1)} 0 M0 -4 L${(-swing).toFixed(1)} 0`,
    opacity,
  }
}

// Position `e` units along a polyline, heading included; null once past its end.
function along(points, e) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (e < len) {
      const u = e / len
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, dx: b.x - a.x, dy: b.y - a.y }
    }
    e -= len
  }
  return null
}
const pathLength = (points) =>
  points.slice(1).reduce((n, b, i) => n + Math.hypot(b.x - points[i].x, b.y - points[i].y), 0)

// Dock → up the ramp → along the car deck to its spot (and the reverse).
const deckPath = (deckX) => [DOCK, RAMP_TOP, { x: deckX, y: DECK_Y }]
// Walk-ons cross the ramp and step aboard at its top.
const WALK_ON = [{ x: DOCK.x, y: DOCK.y + LANE.walk }, RAMP_TOP]
const WALK_ON_LENGTH = pathLength(WALK_ON)

// Drive from road position s0 down to the dock, then up the ramp to deckX.
function toDeck(e, s0, deckX) {
  if (e < s0) {
    const p = roadAt(s0 - e)
    return { x: p.x, y: p.y + LANE.in, dx: -p.tx, dy: -p.ty }
  }
  const at = along(deckPath(deckX), e - s0)
  return at && { ...at, onRamp: true }
}
const carBoarded = (sigma, k) => {
  const e = (sigma - CAR_LOAD(k)) * CAR_V
  return e > 0 && !toDeck(e, QUEUE_S(k), BERTH + FAR_SLOTS[k])
}
const pedBoarded = (sigma, j) => sigma >= PED_LOAD(j) + (WAIT_S(j) + WALK_ON_LENGTH) / PED_V

// Cars waiting (downhill-facing, near lane) at queue spot s.
function queued(item, s, mirror, bounce = 0) {
  const p = roadAt(s)
  return car(item, 'in', p.x, p.y + LANE.in - bounce, -p.tx, -p.ty, mirror, bounce > 0)
}

// Everything at one dock (side 0 = Bowen, 1 = mainland) at time t.
// A confused little hop, out of step person to person.
const puzzledHop = (t, id) =>
  Math.abs(Math.sin(t * 9 + id.length * 1.3 + id.charCodeAt(id.length - 1))) * 4

// `puzzled`: a breakdown is on, so anyone standing around hops, confused.
function dockItems(S, t, side, cars, peds, ferryHere, W, puzzled) {
  const mirror = side === 1 ? W : 0
  const { h } = halfAt(t)
  const v = h - mod(h - side, 2) // this dock's latest visit (half index)
  const sigma = t - halfStart(v) - dockDelay(v) // this visit's dock schedule clock

  // --- cars: board up to capacity; the rest roll forward with the line and
  // stop at the front of the dock, still there as the ferry pulls away ---
  const line = lineAt(S, 'car', v)
  const nBoard = Math.min(line.length, CAR_CAPACITY)
  line.forEach((item, k) => {
    if (k >= nBoard) {
      // Didn't make it: pull up to the dock and bounce on the springs in a
      // rage, alongside the walk-ons, while the ferry sails off.
      const moved = Math.max(0, sigma - CAR_LOAD(k)) * CAR_V
      const mad = sigma >= HOP[0] && sigma < HOP[1]
      const bounce = mad ? 0.3 + Math.abs(Math.sin(sigma * 15 + k * 2.3)) * 3 : 0
      cars.push(queued(item, Math.max(QUEUE_S(k - nBoard), QUEUE_S(k) - moved), mirror, bounce))
    } else if (sigma < CAR_LOAD(k)) {
      cars.push(queued(item, QUEUE_S(k), mirror))
    } else {
      const at = toDeck((sigma - CAR_LOAD(k)) * CAR_V, QUEUE_S(k), BERTH + FAR_SLOTS[k])
      // On the ramp it's drawn with the far lane, i.e. behind the ferry's wall.
      if (at) cars.push(car(item, at.onRamp ? 'out' : 'in', at.x, at.y, at.dx, at.dy, mirror))
    }
  })
  const leftCars = line.length - nBoard
  const nextCars = lineAt(S, 'car', v + 2).slice(leftCars)
  const arrivals = carArrivals(v + 2, nextCars.length)
  nextCars.forEach((item, i) => {
    const start = arrivals[i]
    if (sigma < start) return
    const slot = QUEUE_S(leftCars + i)
    cars.push(queued(item, Math.max(slot, ROAD.length - (sigma - start) * CAR_V), mirror))
  })

  // --- walk-ons: same, but the ones left behind hop up and down, mad ---
  const crowd = lineAt(S, 'ped', v)
  const nWalk = Math.min(crowd.length, PED_CAPACITY)
  crowd.forEach((item, j) => {
    if (j >= nWalk) {
      // Move up with the boarding crowd to the front of the loading dock,
      // then hop there, furious, as the ferry leaves without them.
      const mad = sigma >= HOP[0] && sigma < HOP[1]
      const hop = mad
        ? Math.abs(Math.sin(sigma * 11 + j * 1.7)) * 7
        : puzzled
          ? puzzledHop(t, item.id)
          : 0
      const e = Math.max(0, sigma - PED_LOAD(j)) * PED_V
      const s = Math.max(WAIT_S(j - nWalk), WAIT_S(j) - e)
      const p = roadAt(s)
      peds.push(
        ped(
          item,
          p.x,
          p.y + LANE.walk - hop,
          1,
          s < WAIT_S(j) && s > WAIT_S(j - nWalk) ? e : 0,
          1,
          mirror,
          mad ? 'mad' : puzzled ? 'confused' : null,
        ),
      )
    } else if (sigma < PED_LOAD(j)) {
      const p = roadAt(WAIT_S(j))
      const hop = puzzled ? puzzledHop(t, item.id) : 0
      peds.push(ped(item, p.x, p.y + LANE.walk - hop, 1, 0, 1, mirror, puzzled ? 'confused' : null))
    } else {
      const e = (sigma - PED_LOAD(j)) * PED_V
      if (e < WAIT_S(j)) {
        const p = roadAt(WAIT_S(j) - e)
        peds.push(ped(item, p.x, p.y + LANE.walk, 1, e, 1, mirror))
      } else {
        const at = along(WALK_ON, e - WAIT_S(j))
        if (at) peds.push(ped(item, at.x, at.y, 1, e, 1, mirror))
      }
    }
  })
  const leftPeds = crowd.length - nWalk
  const nextPeds = lineAt(S, 'ped', v + 2).slice(leftPeds)
  nextPeds.forEach((item, i) => {
    const start = PED_ARRIVE(i, nextPeds.length)
    if (sigma < start) return
    const e = (sigma - start) * PED_V_ARRIVE
    const slot = WAIT_S(leftPeds + i)
    const p = roadAt(Math.max(slot, PED_START_S - e))
    const walking = PED_START_S - e > slot
    const lost = puzzled && !walking
    const hop = lost ? puzzledHop(t, item.id) : 0
    peds.push(
      ped(
        item,
        p.x,
        p.y + LANE.walk - hop,
        1,
        walking ? e : 0,
        Math.min(1, e / 20),
        mirror,
        lost ? 'confused' : null,
      ),
    )
  })

  if (!ferryHere) return
  // --- arrivals leave the ferry: cars nearest the dock first, then walk-offs ---
  boarders(S, 'car', v - 1).forEach((item, i) => {
    const start = CAR_UNLOAD(i)
    if (sigma < start) return
    const route = deckPath(BERTH - FAR_SLOTS[i]).reverse()
    const e = (sigma - start) * CAR_V
    const at = along(route, e)
    if (at) {
      cars.push(car(item, 'out', at.x, at.y, at.dx, at.dy, mirror))
    } else if (e - pathLength(route) < ROAD.length) {
      const p = roadAt(e - pathLength(route))
      cars.push(car(item, 'out', p.x, p.y + LANE.out, p.tx, p.ty, mirror))
    }
  })
  boarders(S, 'ped', v - 1).forEach((item, j) => {
    const e = (sigma - PED_UNLOAD(j)) * PED_V
    if (e < 0 || e > PED_GONE_S + WALK_ON_LENGTH) return
    const off = along([...WALK_ON].reverse(), e)
    if (off) {
      peds.push(ped(item, off.x, off.y, -1, e, 1, mirror))
      return
    }
    const s = e - WALK_ON_LENGTH
    const p = roadAt(s)
    peds.push(ped(item, p.x, p.y + LANE.walk, p.tx, e, Math.min(1, (PED_GONE_S - s) / 40), mirror))
  })
}

// The whole scene at time t (seconds): ferry position, the cars and walk-ons
// riding it (offsets relative to the ferry), and everyone ashore.
function ferryAt(t, W) {
  const { h, tauE: tau } = halfAt(t)
  const b = berths(W)
  const from = b[mod(h, 2)]
  const to = b[1 - mod(h, 2)]
  const cross = H - DEPART
  const underway = tau >= DEPART
  const c = tau - DEPART
  let p = underway ? ease(Math.min(1, c / cross)) : 0
  let stop = null // { kind, u } while stopped mid-channel; u = 0..1 through it
  const brk = breaksDown(h)
  if (underway && (brk || whaleCrossing(h))) {
    // Two legs with a stop between, anywhere from a fifth to four-fifths of
    // the way. A whale gets a gentle slow-down; a breakdown dies suddenly,
    // still at speed. The second leg eases back up either way.
    const qs = brk ? 0.2 + rnd(h, 16) * 0.6 : 0.3 + rnd(h, 14) * 0.3
    const pause = brk ? BREAKDOWN_S : WHALE_S
    const [t1, t2] = [cross * qs, cross * (1 - qs)]
    if (c < t1) p = qs * (brk ? 1 - (1 - c / t1) ** 2 : ease(c / t1))
    else if (c < t1 + pause) {
      p = qs
      stop = { kind: brk ? 'breakdown' : 'whale', u: (c - t1) / pause }
    } else p = qs + (1 - qs) * ease(Math.min(1, (c - t1 - pause) / t2))
  }
  return {
    x: from + (to - from) * p,
    dir: Math.sign(to - from),
    moving: underway && !stop,
    stalled: stop?.kind === 'breakdown',
    whaleStop: stop?.kind === 'whale' ? stop.u : null,
    jammed: !underway && tau < 0, // ramp stuck on arrival
    h,
  }
}

// Where a breakdown's smoke, sparks and flames come from: the control tower
// when stalled at sea, the ramp's hinge when it's jammed. null otherwise.
function troubleSpot(f, W) {
  if (f.stalled) return [f.x, 198 - 66]
  if (f.jammed) return [mod(f.h, 2) === 0 ? RAMP_PIVOT.x : W - RAMP_PIVOT.x, RAMP_PIVOT.y - 4]
  return null
}

// Sparks: a few fly out every SPARK_DT, arc under gravity and wink out.
const SPARK_DT = 0.05
const SPARK_LIFE = 0.7
function sparksAt(t, W) {
  const out = []
  const newest = Math.floor(t / SPARK_DT)
  for (let n = newest; n > newest - SPARK_LIFE / SPARK_DT; n--) {
    const born = n * SPARK_DT
    const src = troubleSpot(ferryAt(born, W), W)
    if (!src || rnd(n, 40) < 0.35) continue
    const age = t - born
    const vx = (rnd(n, 41) - 0.5) * 90
    const vy = -40 - rnd(n, 42) * 50
    out.push({
      id: `k${n}`,
      x: src[0] + vx * age,
      y: src[1] + vy * age + 110 * age * age,
      opacity: 1 - age / SPARK_LIFE,
      hot: rnd(n, 43) < 0.5, // yellow-white vs orange
    })
  }
  return out
}

// Flames: three flickering tongues licking up from the trouble spot.
function flamesAt(t, W) {
  const src = troubleSpot(ferryAt(t, W), W)
  if (!src) return []
  return [-6, 0, 6].map((dx, k) => {
    const flick = 0.6 + 0.4 * Math.abs(Math.sin(t * (17 + k * 5) + k * 2))
    const hgt = (k === 1 ? 17 : 11) * flick
    const w = k === 1 ? 6 : 4.5
    const [x, y] = [src[0] + dx, src[1] + 2]
    return {
      id: `f${k}`,
      d: `M${x - w} ${y} Q ${x - w * 0.6} ${y - hgt * 0.5} ${x} ${y - hgt} Q ${x + w * 0.6} ${y - hgt * 0.5} ${x + w} ${y} Z`,
      color: k === 1 ? '#ffca28' : '#ff7043',
    }
  })
}

// Breakdown smoke: a grey puff leaves the trouble spot every SMOKE_DT, then
// rises, drifts downwind, swells and fades.
const SMOKE_DT = 0.12
const SMOKE_LIFE = 2.4
function smokeAt(t, W) {
  const out = []
  const newest = Math.floor(t / SMOKE_DT)
  for (let n = newest; n > newest - SMOKE_LIFE / SMOKE_DT; n--) {
    const born = n * SMOKE_DT
    const src = troubleSpot(ferryAt(born, W), W)
    if (!src) continue
    const age = (t - born) / SMOKE_LIFE
    const [sx, sy] = src
    out.push({
      id: `s${n}`,
      x: sx + (rnd(n, 31) - 0.5) * 6 + age * 26,
      y: sy - age * 46,
      r: 2.5 + age * 9,
      opacity: (1 - age) * 0.75,
      shade: Math.round(70 + rnd(n, 32) * 60),
    })
  }
  return out
}

// Wake: a foam particle drops off the stern every WAKE_DT while under way,
// stays where it landed in the water, drifts apart and fades out.
const WAKE_DT = 0.05
const WAKE_LIFE = 1.4
function wakeAt(t, W) {
  const out = []
  const newest = Math.floor(t / WAKE_DT)
  for (let n = newest; n > newest - WAKE_LIFE / WAKE_DT; n--) {
    const born = n * WAKE_DT
    const f = ferryAt(born, W)
    if (!f.moving) continue
    const age = (t - born) / WAKE_LIFE
    for (let k = 0; k < 2; k++) {
      const r1 = rnd(n, 11 + k)
      const r2 = rnd(n, 21 + k)
      out.push({
        id: `w${n}.${k}`,
        x: f.x - f.dir * (64 + r1 * 10 + age * 12),
        y: 198 - 1 + (r2 - 0.5) * 4 + age * (k ? 3 : -2),
        r: 0.8 + r2 * 1.2 + age * 1.6,
        opacity: (1 - age) * 0.8,
      })
    }
  }
  return out
}

// The whale on a whale crossing, just ahead of the stopped ferry's bow: either
// its tail surfaces, hangs there and slips back under with a splash, or its
// back breaks the surface and it blows a spout of spray.
function whaleAt(t, W) {
  const f = ferryAt(t, W)
  if (f.whaleStop == null) return null
  const age = f.whaleStop
  // rise (0→1) over the first fifth, hold, sink over the last third
  const rise = age < 0.2 ? age / 0.2 : age > 0.67 ? Math.max(0, (1 - age) / 0.33) : 1
  const x = f.x + f.dir * (66 + 34 + rnd(f.h, 15) * 20) // bow + a respectful gap
  const kind = rnd(f.h, 17) < 0.45 ? 'spout' : 'tail'
  // Spout spray: droplets fanning up from the blowhole while the back is up.
  const spray = []
  const sprayT = (age - 0.22) * WHALE_S
  if (kind === 'spout' && sprayT > 0 && age < 0.8) {
    for (let k = 0; k < 14; k++) {
      const a = sprayT - (k % 4) * 0.12 // a few waves of droplets
      if (a <= 0 || a > 1.3) continue
      const vx = (rnd(f.h * 31 + k, 18) - 0.5) * 34
      const vy = -58 - rnd(f.h * 31 + k, 19) * 26
      spray.push({
        id: k,
        x: x + vx * a,
        y: 205 - 7 + vy * a + 70 * a * a,
        r: 1.2 + a * 1.4,
        opacity: Math.max(0, 1 - a / 1.3) * 0.9,
      })
    }
  }
  return {
    id: `whale${f.h}`,
    kind,
    spray,
    x,
    rise,
    tilt: (rnd(f.h, 52) - 0.5) * 16 + (age > 0.67 ? (age - 0.67) * 40 : 0),
    flip: rnd(f.h, 53) < 0.5,
    splash: age > 0.67 ? (age - 0.67) / 0.33 : 0, // 0..1 once it's going under
  }
}

function sceneFrame(S, t, W) {
  const { h, tau: tauRaw, tauE: tau } = halfAt(t)
  const side = mod(h, 2)
  const { x: ferryX, moving, stalled, jammed } = ferryAt(t, W)
  const puzzled = stalled || jammed
  const riderAt = (item, x) =>
    ped(
      item,
      x,
      -45 - (puzzled ? puzzledHop(t, item.id) : 0),
      1,
      0,
      1,
      false,
      puzzled ? 'confused' : null,
    )

  // Aboard: last visit's riders until they get off, then this visit's once
  // they've boarded. Offsets are physical (ferry frame); the far dock's
  // layout is mirrored, hence `sign`.
  const sign = side === 0 ? 1 : -1
  const deck = []
  boarders(S, 'car', h - 1).forEach((item, i) => {
    if (tau < CAR_UNLOAD(i)) deck.push({ id: item.id, dx: -sign * FAR_SLOTS[i], color: item.color })
  })
  boarders(S, 'car', h).forEach((item, k) => {
    if (carBoarded(tau, k)) deck.push({ id: item.id, dx: sign * FAR_SLOTS[k], color: item.color })
  })
  const riders = []
  boarders(S, 'ped', h - 1).forEach((item, j) => {
    if (tau < PED_UNLOAD(j)) riders.push(riderAt(item, -sign * RIDER_SPOTS[j]))
  })
  boarders(S, 'ped', h).forEach((item, j) => {
    if (pedBoarded(tau, j)) riders.push(riderAt(item, sign * RIDER_SPOTS[j]))
  })

  // Each dock's ramp: lowered onto the ferry while it's berthed there,
  // raised a moment before it leaves and while it's away.
  const ramps = [0, 1].map((d) => {
    let down = d === side && !moving ? Math.min(1, tau / 0.15, (DEPART - tau) / 0.25) : 0
    // Jammed: the ramp flips up and down, never quite seating.
    if (d === side && tau < 0) down = 0.5 + 0.5 * Math.sin(tauRaw * 7)
    return RAMP_UP + (RAMP_DOWN - RAMP_UP) * Math.max(0, down)
  })

  const cars = []
  const peds = []
  dockItems(S, t, 0, cars, peds, side === 0, W, puzzled)
  dockItems(S, t, 1, cars, peds, side === 1, W, puzzled)
  return {
    ferryX,
    wake: wakeAt(t, W),
    smoke: smokeAt(t, W),
    sparks: sparksAt(t, W),
    flames: flamesAt(t, W),
    whale: whaleAt(t, W),
    stalled,
    jammed,
    // The real sailing being replayed right now (season sampler), if any.
    sailing: S.sampler?.sailing(h) ?? null,
    ramps,
    deck,
    riders,
    carsOut: cars.filter((c) => c.lane === 'out'),
    carsIn: cars.filter((c) => c.lane === 'in'),
    peds,
  }
}

// A scene instance: its own lines memo, optionally replaying a real day
// (see seasonSampler). Returns (t, W) => frame.
export function createGoatScene({ sampler = null } = {}) {
  const S = { lines: { car: new Map(), ped: new Map() }, sampler }
  return (t, W = WORLD_W) => sceneFrame(S, t, W)
}
const randomScene = createGoatScene()
export const goatScene = (t, W) => randomScene(t, W)

// --- Season sampler ----------------------------------------------------------
// Replays how full the ferry really was on one day, from the history page's
// sailing records ({ dateIso, sailingTime, direction, lastCapacity }). Bowen
// visits (even halves) take that day's "To HSB" sailings in order, mainland
// visits (odd halves) its "To Bowen" ones. lastCapacity is "Full",
// "Not Full" or "NN%" = space *left*. Returns null when no day has enough
// data. `pick` chooses the day (0..1, injectable for tests).
export function seasonSampler(docs, pick = Math.random) {
  const byDay = new Map()
  for (const d of docs || []) {
    if (!d?.dateIso || !d.sailingTime || !d.direction) continue
    if (!byDay.has(d.dateIso)) byDay.set(d.dateIso, [])
    byDay.get(d.dateIso).push(d)
  }
  const usable = [...byDay.entries()].filter(([, list]) => {
    const known = list.filter((d) => d.lastCapacity).length
    return known >= 6 && known >= list.length * 0.6
  })
  if (!usable.length) return null
  usable.sort(([a], [b]) => (a < b ? -1 : 1))
  const [dateIso, list] = usable[Math.min(usable.length - 1, Math.floor(pick() * usable.length))]
  const bySide = [0, 1].map((side) =>
    list
      .filter((d) => d.direction === (side === 0 ? 'To HSB' : 'To Bowen'))
      .sort((a, b) => (a.sailingTime < b.sailingTime ? -1 : 1)),
  )
  // Start somewhere in the day rather than always at the quiet first sailing.
  const offset = Math.floor(pick() * Math.max(...bySide.map((l) => l.length), 1))
  const sailingFor = (v) => {
    const l = bySide[mod(v, 2)]
    return l.length ? l[mod(Math.floor(v / 2) + offset, l.length)] : null
  }
  return {
    key: dateIso,
    dateIso,
    load(v) {
      const cap = sailingFor(v)?.lastCapacity
      if (!cap) return null
      if (cap === 'Full') return 'full'
      if (cap === 'Not Full') return 0.35 + rnd(v, 5) * 0.45
      const left = parseInt(cap)
      return Number.isNaN(left) ? null : Math.min(1, Math.max(0, 1 - left / 100))
    },
    sailing(v) {
      const d = sailingFor(v)
      return d && { dateIso, time: d.sailingTime, direction: d.direction, capacity: d.lastCapacity }
    },
  }
}
