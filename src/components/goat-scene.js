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
// Walk-on j's spot on the dock (a big crowd packs in tighter).
const WAIT_S = (j) => 14 + 6 * Math.min(j, 4) + 3 * Math.max(0, j - 4)
// The line moves off together, like real traffic, keeping its spacing.
const CAR_LOAD = (k) => 2.0 + 0.05 * k
const PED_LOAD = (j) => 1.6 + 0.06 * j
const CAR_UNLOAD = (i) => 0.15 + 0.12 * i
const PED_UNLOAD = (j) => 0.4 + 0.3 * j
// Extra crowds on particular sailings — school kids on school runs, tourists
// in summer (the 'kid' line): bunched up on the dock, never left behind,
// dashing aboard and off in a stream, crowding the passenger deck.
const KID_V = 85
const KID_WAIT_S = (k) => 6 + 2.2 * k // a packed crowd
const KID_LOAD = (k) => 1.7 + 0.035 * k // …streaming aboard
const KID_UNLOAD = (k) => 0.5 + 0.07 * k
// The school bus never boards: it drops the kids at their dock (parking on
// the shoulder by the dock, BUS_S up the road) and another meets them off
// the ferry at the other end.
const BUS_S = 36
const BUS_V = 200
// Both buses pull in just as the ferry leaves the other dock: the drop-off
// bus as it sets off to fetch the kids, the pick-up bus as it sets off with
// them. busDriveS() is the drive down the hill.
const busDriveS = () => (ROAD.length - BUS_S) / BUS_V
// When kid i (of n) steps out of the drop-off bus, after it parks.
const kidOutAt = (i, n) => 0.3 + i * Math.min(0.15, 3 / n)
const isSchool = (crowd) => crowd.length > 0 && !!crowd[0].kid
// The bus at road position s, facing downhill (arriving) or uphill (leaving),
// on the shoulder in front of the lanes.
function bus(id, s, uphill, mirror) {
  const p = roadAt(s)
  const [dx, dy] = uphill ? [p.tx, p.ty] : [-p.tx, -p.ty]
  return car({ id, color: '#fbc02d' }, 'bus', p.x, p.y + LANE.walk + 7, dx, dy, mirror)
}
// Driving down from the top of the road to park at BUS_S from time `from`,
// then (from `leave`) back up and away; null once gone (or not yet come).
function busTrip(id, clock, from, leave, mirror) {
  if (clock < from) return null
  if (clock < leave)
    return bus(id, Math.max(BUS_S, ROAD.length - (clock - from) * BUS_V), false, mirror)
  const s = BUS_S + (clock - leave) * BUS_V
  return s < ROAD.length ? bus(id, s, true, mirror) : null
}
// They start gathering as soon as the previous sailing has left.
const KID_ARRIVE = (i, n) => 4.4 + i * Math.min(0.35, 6.5 / n)
const kidSpot = (k, n) => -33 + (66 * (k + 0.5)) / n // on the roof, ferry frame
const PACKS = ['#e53935', '#1e88e5', '#fdd835', '#8e24aa', '#43a047', '#fb8c00']
const HATS = ['#fff176', '#ff8a65', '#f48fb1', '#80deea', '#ffffff']
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
//  - at sea: the ferry stalls mid-channel, smoking, for BREAKDOWN_S (one
//    crossing in a hundred);
//  - at the dock: on arrival the ramp jams, flapping up and down, for
//    DOCK_BREAKDOWN_S before anyone can get off (one arrival in a hundred) —
//    the whole dock schedule for that visit runs that much later.
// Never more than MAX_BREAKDOWNS (of either kind) in a day — a replayed day,
// or every DAY_HALVES halves of random traffic.
const BREAKDOWN_S = 3.5
const DOCK_BREAKDOWN_S = 3
// After either kind, everything waits for the smoke to clear (a puff's
// lifetime, SMOKE_LIFE below).
const SMOKE_CLEAR_S = 2.4
const MAX_BREAKDOWNS = 3
const DAY_HALVES = 32
const seaRoll = (h) => h > 0 && rnd(h, 7) < 0.01
const jamRoll = (h) => h > 0 && rnd(h, 9) < 0.01
// What goes wrong in half h ({ jam, sea }), after the daily cap: earlier
// halves of the same day use up the allowance first (a jam on arrival comes
// before a breakdown at sea). Cached per scene in S.trouble.
function troubleAt(S, h) {
  if (h < 0) return { jam: false, sea: false }
  const memo = S.trouble
  if (memo.has(h)) return memo.get(h)
  const dayStart = S.sampler ? (S.sampler.dayStart(h) ?? 0) : h - mod(h, DAY_HALVES)
  let used = 0
  for (let k = Math.max(0, dayStart); k < h; k++) {
    const r = troubleAt(S, k)
    used += r.jam + r.sea
  }
  const jam = jamRoll(h) && used < MAX_BREAKDOWNS
  const sea = seaRoll(h) && used + jam < MAX_BREAKDOWNS
  const r = { jam, sea }
  memo.set(h, r)
  return r
}
const jamDelay = (S, h) => (troubleAt(S, h).jam ? DOCK_BREAKDOWN_S + SMOKE_CLEAR_S : 0)
// Replaying real days: after a day's last sailing arrives at Horseshoe Bay
// and everyone's off and away (UNLOAD_END), the ferry sleeps NIGHT_S while
// the docks empty out, then the sky brightens for MORNING_S as Bowen's
// morning line turns up, and the day's (empty) first run sets off.
const UNLOAD_END = 6 // every car and walk-on off and away up the road
export const NIGHT_S = 16
export const MORNING_S = 10
const LOAD_START = 1.6 // = PED_LOAD(0): when boarding begins on the load clock
const nightDelay = (S, h) =>
  S.sampler?.isDayStart(h) ? UNLOAD_END + NIGHT_S + MORNING_S - LOAD_START : 0
// Two dock clocks per visit: unloading waits only for a jammed ramp;
// loading (and departure) also waits out any night.
const dockDelay = (S, h) => jamDelay(S, h) + nightDelay(S, h)
// Whale crossings: a tail surfaces in the ferry's path, so it eases to a stop
// just short of it and waits until the whale has gone back under (about one
// crossing in thirty-odd, never on a breakdown crossing; the first comes early).
const WHALE_S = 2.4 // as long as its surprised jingle
export const WHALE_Y = 198 // the whale breaks the surface right at the horizon line
const FIRST_WHALE = 1
const whaleStop = (S, h) =>
  h >= 0 && !troubleAt(S, h).sea && (h === FIRST_WHALE || (h > FIRST_WHALE && rnd(h, 13) < 0.03))
const halfLen = (S, h) =>
  H +
  (troubleAt(S, h).sea ? BREAKDOWN_S + SMOKE_CLEAR_S : 0) +
  dockDelay(S, h) +
  (whaleStop(S, h) ? WHALE_S : 0)
// When half h begins; S.starts caches it per scene (nights make it
// scene-specific).
function halfStartOf(S, h) {
  if (h <= 0) return h * H
  const st = S.starts
  while (st.length <= h) st.push(st[st.length - 1] + halfLen(S, st.length - 1))
  return st[h]
}
// Which half t falls in and how far into it (tau); its unload clock (tauU —
// negative while a jammed ramp holds things up) and load clock (tauE — also
// held back through any night); and `overnight` ({ phase: 'night' |
// 'morning', u: 0..1 }) while the ferry's tied up between days.
function halfAt(S, t) {
  let h = Math.floor(t / H) // upper bound: halves are never shorter than H
  while (halfStartOf(S, h) > t) h--
  const tau = t - halfStartOf(S, h)
  const tauU = tau - jamDelay(S, h)
  let overnight = null
  if (nightDelay(S, h)) {
    const rel = tauU - UNLOAD_END
    if (rel >= 0 && rel < NIGHT_S) overnight = { phase: 'night', u: rel / NIGHT_S }
    else if (rel >= NIGHT_S && rel < NIGHT_S + MORNING_S)
      overnight = { phase: 'morning', u: (rel - NIGHT_S) / MORNING_S }
  }
  return { h, tau, tauU, tauE: tau - dockDelay(S, h), overnight }
}
// When the ferry leaves the dock of half h (scene time).
const departsAt = (S, h) => halfStartOf(S, h) + dockDelay(S, h) + DEPART

// The overnight window before day-start half h0, in scene time.
function overnightWindow(S, h0) {
  const N0 = halfStartOf(S, h0) + jamDelay(S, h0) + UNLOAD_END
  return { N0, M0: N0 + NIGHT_S }
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
// How many of each can board visit v. Walk-ons (and kids) always all get
// on; but a really big crowd of people takes room from the cars — one car
// spot per 3 people over 12, down to MIN_CARS.
const MIN_CARS = 6
const LATE_FUMING = 20 // minutes late before the waiting cars lose patience
function capOf(S, kind, v) {
  if (kind !== 'car') return Infinity
  const people = lineAt(S, 'ped', v).length + lineAt(S, 'kid', v).length
  return Math.max(MIN_CARS, CAR_CAPACITY - Math.max(0, Math.floor((people - 12) / 3)))
}
// Walk-on j's spot on the roof: the four usual ones, then spreading out.
const riderSpot = (j) => (j < RIDER_SPOTS.length ? RIDER_SPOTS[j] : -30 + (((j - 4) * 11) % 60))
// First visit of a replayed day at its dock (the previous day's stragglers
// went home overnight, so nobody carries over).
const firstOfDay = (S, v) => !!S.sampler && (S.sampler.isDayStart(v) || S.sampler.isDayStart(v - 1))

// `carried`: how many are already in line from the last sailing.
function newcomers(S, kind, v, carried = 0) {
  if (S.sampler?.emptyRun(v)) return [] // the day's first crossing runs empty
  if (kind === 'kid') {
    // A school run brings a crowd of kids with backpacks; a summer tourist
    // sailing, a gaggle in sun hats; otherwise nobody extra.
    const crowd = S.sampler?.extraCrowd(v)
    if (!crowd) return []
    const kids = crowd === 'kids'
    const n = kids ? 20 + Math.floor(rnd(v, 4) * 11) : 5 + Math.floor(rnd(v, 4) * 6)
    return Array.from({ length: n }, (_, i) => ({
      id: `kid${v}.${i}`,
      color: SHIRTS[mod(v * 7 + i * 3, SHIRTS.length)],
      ...(kids
        ? { kid: true, pack: PACKS[mod(v + i * 5, PACKS.length)] }
        : { hat: HATS[mod(v + i * 3, HATS.length)] }),
    }))
  }
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
  // Replaying a sailing that wasn't full: everyone waiting got on, so the
  // line never outgrows the ferry.
  const fits =
    S.sampler && load !== 'full' ? Math.max(carried ? 0 : 1, capOf(S, kind, v) - carried) : n
  return Array.from({ length: Math.min(n, fits) }, (_, i) => ({
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
      const carry =
        u - 2 >= -2 && !firstOfDay(S, u) ? memo.get(u - 2).slice(capOf(S, kind, u - 2)) : []
      memo.set(u, carry.concat(newcomers(S, kind, u, carry.length)))
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
const boarders = (S, kind, v) => lineAt(S, kind, v).slice(0, capOf(S, kind, v))
const kidBoarded = (sigma, k) => sigma >= KID_LOAD(k) + (KID_WAIT_S(k) + WALK_ON_LENGTH) / KID_V

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
// The time of the frame being built (set by sceneFrame) — lets ped() keep
// school kids bouncing wherever they are.
let frameT = 0

// `s`: road position of someone standing in line (so they can be sent home).
function ped(item, x, y, dx, stride, opacity, mirror, mood = null, s = null) {
  if (mirror) {
    x = mirror - x
    dx = -dx
  }
  // School kids never stop bouncing, each to their own rhythm.
  if (item.kid) y -= Math.abs(Math.sin(frameT * 8 + seedOf(item.id) * 1.9)) * 3
  const swing = Math.sin(stride / 3) * 2.2
  return {
    id: item.id,
    item,
    s,
    kid: !!item.kid,
    pack: item.pack,
    hat: item.hat,
    shirt: item.color,
    mad: mood === 'mad',
    confused: mood === 'confused',
    flip: dx < 0, // mirrored figure — its ?/! marker counter-flips to stay readable
    transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})${dx < 0 ? ' scale(-1 1)' : ''}${item.kid ? ' scale(0.72)' : ''}`,
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
// A car waiting in line at road position s (kept, with the item, so it can
// be sent home at nightfall).
function queued(item, s, mirror, bounce = 0) {
  const p = roadAt(s)
  return {
    ...car(item, 'in', p.x, p.y + LANE.in - bounce, -p.tx, -p.ty, mirror, bounce > 0),
    s,
    item,
  }
}

// Confused, during a breakdown: a little hop, out of step person to person…
const seedOf = (id) => id.length * 1.3 + id.charCodeAt(id.length - 1)
const puzzledHop = (t, id) => Math.abs(Math.sin(t * 9 + seedOf(id))) * 4
// …while wandering back and forth. `off` is how far they've strayed (units),
// `dir` which way they're heading (+1 = toward larger off).
function puzzledWander(t, id) {
  const k = seedOf(id)
  const off = 7 * Math.sin(t * 1.1 + k) + 3 * Math.sin(t * 2.3 + k * 1.7)
  const vel = 7.7 * Math.cos(t * 1.1 + k) + 6.9 * Math.cos(t * 2.3 + k * 1.7)
  return { off, dir: vel >= 0 ? 1 : -1 }
}
// A confused walk-on standing at road position s: wandering along the road
// around it, facing the way they're going, legs going, hopping.
function lostPed(item, t, s, mirror) {
  const w = puzzledWander(t, item.id)
  const p = roadAt(Math.max(2, s + w.off))
  const dx = w.dir > 0 ? p.tx : -p.tx
  return ped(
    item,
    p.x,
    p.y + LANE.walk - puzzledHop(t, item.id),
    dx,
    t * 25,
    1,
    mirror,
    'confused',
    s,
  )
}

// Everything at one dock (side 0 = Bowen, 1 = mainland) at time t.
// `puzzled`: a breakdown is on, so anyone standing around is confused.
function dockItems(S, t, side, cars, peds, ferryHere, W, puzzled) {
  const { h, overnight } = halfAt(S, t)
  if (overnight) return overnightDock(S, t, side, cars, peds, ferryHere, W, h)
  dockDay(S, t, side, cars, peds, ferryHere, W, puzzled)
}

// Overnight at a dock (h0 = the new day's first half, the ferry at Horseshoe
// Bay): everyone still standing around at either dock turns round and goes
// home up the road; the docks sit empty; then in the morning Bowen's line
// for the first sailing arrives.
const GO_HOME_V = { car: 140, ped: 40 }
function overnightDock(S, t, side, cars, peds, ferryHere, W, h0) {
  const mirror = side === 1 ? W : 0
  const { N0, M0 } = overnightWindow(S, h0)
  // Going home: the evening crowd as it stood at nightfall, heading uphill.
  const evening = { cars: [], peds: [] }
  dockDay(S, N0 - 1e-3, side, evening.cars, evening.peds, false, W, false)
  const gone = t - N0
  for (const c of evening.cars) {
    if (c.s == null) continue
    const s = c.s + gone * GO_HOME_V.car
    if (s >= ROAD.length) continue
    const p = roadAt(s)
    cars.push(car(c.item, 'in', p.x, p.y + LANE.in, p.tx, p.ty, mirror))
  }
  for (const q of evening.peds) {
    if (q.s == null) continue
    const s = q.s + gone * GO_HOME_V.ped
    if (s >= PED_GONE_S) continue
    const p = roadAt(s)
    peds.push(
      ped(q.item, p.x, p.y + LANE.walk, p.tx, s, Math.min(1, (PED_GONE_S - s) / 40), mirror),
    )
  }
  // Morning: Bowen's line for the day's first sailing to the mainland turns
  // up (nobody boards the empty first run at Horseshoe Bay).
  if (t >= M0 && side === 0) {
    const first = h0 + 1
    const line = lineAt(S, 'car', first)
    line.forEach((item, k) => {
      const at = M0 + 0.3 + k * Math.min(0.9, (MORNING_S - 2) / line.length)
      if (t < at) return
      cars.push(queued(item, Math.max(QUEUE_S(k), ROAD.length - (t - at) * CAR_V), mirror))
    })
    const crowd = lineAt(S, 'ped', first)
    crowd.forEach((item, j) => {
      const at = M0 + 1 + j * Math.min(1.2, (MORNING_S - 3.5) / crowd.length)
      if (t < at) return
      const e = (t - at) * PED_V_ARRIVE
      const s = Math.max(WAIT_S(j), PED_START_S - e)
      const p = roadAt(s)
      peds.push(
        ped(item, p.x, p.y + LANE.walk, 1, s > WAIT_S(j) ? e : 0, Math.min(1, e / 20), mirror),
      )
    })
  }
  // The ferry's own arrivals keep unloading and heading home as normal.
  if (ferryHere) unloadAt(S, t, side, cars, peds, W)
}

// A normal (daytime) dock.
function dockDay(S, t, side, cars, peds, ferryHere, W, puzzled) {
  // Waiting for a sailing that (really) ran more than LATE_FUMING minutes
  // late: the cars in line bounce on their springs, fuming.
  const fuming = (visit, time, k) =>
    (S.sampler?.sailing(visit)?.lateMin ?? 0) > LATE_FUMING
      ? 0.3 + Math.abs(Math.sin(time * 13 + k * 2.1)) * 2.5
      : 0
  const mirror = side === 1 ? W : 0
  const { h } = halfAt(S, t)
  const v = h - mod(h - side, 2) // this dock's latest visit (half index)
  const sigma = t - halfStartOf(S, v) - dockDelay(S, v) // this visit's load clock
  // Is the next visit here the first of a new replayed day? Then its line
  // starts fresh, and once night has fallen this visit's stragglers are home.
  const dayBreak = firstOfDay(S, v + 2)
  const homeTime = dayBreak
    ? overnightWindow(S, S.sampler.isDayStart(v + 2) ? v + 2 : v + 1).N0
    : Infinity
  // After the day's last sailing from here nobody new turns up — tomorrow's
  // first line arrives in the morning (see overnightDock), and is simply
  // there once the night's over.
  const quietEvening = dayBreak && t < homeTime
  const none = []

  // --- cars: board up to capacity; the rest roll forward with the line and
  // stop at the front of the dock, still there as the ferry pulls away ---
  const line = lineAt(S, 'car', v)
  const nBoard = Math.min(line.length, capOf(S, 'car', v))
  line.forEach((item, k) => {
    if (k >= nBoard) {
      if (t >= homeTime) return // went home for the night
      // Didn't make it: pull up to the dock and bounce on the springs in a
      // rage, alongside the walk-ons, while the ferry sails off.
      const moved = Math.max(0, sigma - CAR_LOAD(k)) * CAR_V
      const mad = sigma >= HOP[0] && sigma < HOP[1]
      const bounce = mad ? 0.3 + Math.abs(Math.sin(sigma * 15 + k * 2.3)) * 3 : 0
      cars.push(queued(item, Math.max(QUEUE_S(k - nBoard), QUEUE_S(k) - moved), mirror, bounce))
    } else if (sigma < CAR_LOAD(k)) {
      cars.push(queued(item, QUEUE_S(k), mirror, fuming(v, t, k)))
    } else {
      const at = toDeck((sigma - CAR_LOAD(k)) * CAR_V, QUEUE_S(k), BERTH + FAR_SLOTS[k])
      // On the ramp it's drawn with the far lane, i.e. behind the ferry's wall.
      if (at) cars.push(car(item, at.onRamp ? 'out' : 'in', at.x, at.y, at.dx, at.dy, mirror))
    }
  })
  const leftCars = dayBreak ? 0 : line.length - nBoard
  const nextCars = quietEvening ? none : lineAt(S, 'car', v + 2).slice(leftCars)
  const arrivals = carArrivals(v + 2, nextCars.length)
  nextCars.forEach((item, i) => {
    const start = arrivals[i]
    if (sigma < start) return
    const slot = QUEUE_S(leftCars + i)
    const s = Math.max(slot, ROAD.length - (sigma - start) * CAR_V)
    cars.push(queued(item, s, mirror, s === slot ? fuming(v + 2, t, leftCars + i) : 0))
  })

  // --- walk-ons: same, but the ones left behind hop up and down, mad ---
  const crowd = lineAt(S, 'ped', v)
  const nWalk = crowd.length // walk-ons always get on
  crowd.forEach((item, j) => {
    if (j >= nWalk) {
      if (t >= homeTime) return // went home for the night
      // Move up with the boarding crowd to the front of the loading dock,
      // then hop there, furious, as the ferry leaves without them.
      const mad = sigma >= HOP[0] && sigma < HOP[1]
      const hop = mad ? Math.abs(Math.sin(sigma * 11 + j * 1.7)) * 7 : 0
      const e = Math.max(0, sigma - PED_LOAD(j)) * PED_V
      const s = Math.max(WAIT_S(j - nWalk), WAIT_S(j) - e)
      if (puzzled && !mad) {
        peds.push(lostPed(item, t, s, mirror))
        return
      }
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
          mad ? 'mad' : null,
          s,
        ),
      )
    } else if (sigma < PED_LOAD(j)) {
      if (puzzled) {
        peds.push(lostPed(item, t, WAIT_S(j), mirror))
        return
      }
      const p = roadAt(WAIT_S(j))
      peds.push(ped(item, p.x, p.y + LANE.walk, 1, 0, 1, mirror, null, WAIT_S(j)))
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
  const leftPeds = dayBreak ? 0 : crowd.length - nWalk
  const nextPeds = quietEvening ? none : lineAt(S, 'ped', v + 2).slice(leftPeds)
  nextPeds.forEach((item, i) => {
    const start = PED_ARRIVE(i, nextPeds.length)
    if (sigma < start) return
    const e = (sigma - start) * PED_V_ARRIVE
    const slot = WAIT_S(leftPeds + i)
    const p = roadAt(Math.max(slot, PED_START_S - e))
    const walking = PED_START_S - e > slot
    if (puzzled && !walking) {
      peds.push(lostPed(item, t, slot, mirror))
      return
    }
    peds.push(
      ped(
        item,
        p.x,
        p.y + LANE.walk,
        1,
        walking ? e : 0,
        Math.min(1, e / 20),
        mirror,
        null,
        walking ? null : slot,
      ),
    )
  })

  // --- school kids: bunched on the dock (a little staggered), all board ---
  lineAt(S, 'kid', v).forEach((item, k) => {
    const s0 = KID_WAIT_S(k)
    const dy = (k % 2) * 2
    if (sigma < KID_LOAD(k)) {
      if (puzzled) return peds.push(lostPed(item, t, s0, mirror))
      const p = roadAt(s0)
      return peds.push(ped(item, p.x, p.y + LANE.walk + dy, 1, 0, 1, mirror, null, s0))
    }
    const e = (sigma - KID_LOAD(k)) * KID_V
    if (e < s0) {
      const p = roadAt(s0 - e)
      peds.push(ped(item, p.x, p.y + LANE.walk + dy, 1, e, 1, mirror))
    } else {
      const at = along(WALK_ON, e - s0)
      if (at) peds.push(ped(item, at.x, at.y, 1, e, 1, mirror))
    }
  })
  const nextKids = quietEvening ? none : lineAt(S, 'kid', v + 2)
  const schoolDrop = isSchool(nextKids)
  // When the ferry next leaves the other dock (coming here): the moment the
  // school buses pull in at this end.
  const busParks = departsAt(S, v + 1)
  if (schoolDrop) {
    // The drop-off bus: down to the dock, kids pour out, back up the hill.
    const leave = busParks + kidOutAt(nextKids.length - 1, nextKids.length) + 0.8
    const b = busTrip(`busD${v + 2}`, t, busParks - busDriveS(), leave, mirror)
    if (b) cars.push(b)
  }
  // The ferry's setting off for here with school kids aboard: a bus comes
  // down to meet them (it leaves once they're all on — see unloadAt).
  if (isSchool(boarders(S, 'kid', v + 1))) {
    const b = busTrip(`busP${v + 1}`, t, busParks - busDriveS(), Infinity, mirror)
    if (b) cars.push(b)
  }
  nextKids.forEach((item, i) => {
    // School kids come out of the bus; tourists turn up on their own.
    const since = schoolDrop
      ? t - (busParks + kidOutAt(i, nextKids.length))
      : sigma - KID_ARRIVE(i, nextKids.length)
    if (since < 0) return
    const e = since * KID_V
    const slot = KID_WAIT_S(i)
    // School kids pile out of the bus; tourists stroll down the road.
    const s = schoolDrop
      ? BUS_S + Math.sign(slot - BUS_S) * Math.min(e, Math.abs(slot - BUS_S))
      : Math.max(slot, PED_START_S - e)
    if (puzzled && s === slot) return peds.push(lostPed(item, t, slot, mirror))
    const p = roadAt(s)
    const here = s === slot
    peds.push(
      ped(
        item,
        p.x,
        p.y + LANE.walk + (i % 2) * 2,
        1,
        here ? 0 : e,
        Math.min(1, e / 20),
        mirror,
        null,
        here ? slot : null,
      ),
    )
  })

  if (ferryHere) unloadAt(S, t, side, cars, peds, W)
}

// Arrivals leave the ferry (on the unload clock): cars nearest the dock
// first, then the walk-offs, all heading up the road.
function unloadAt(S, t, side, cars, peds, W) {
  const mirror = side === 1 ? W : 0
  const { h: v, tauU: sigma } = halfAt(S, t)
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
  const arriving = boarders(S, 'kid', v - 1)
  const school = isSchool(arriving)
  arriving.forEach((item, k) => {
    const e = (sigma - KID_UNLOAD(k)) * KID_V
    if (e < 0 || e > PED_GONE_S + WALK_ON_LENGTH) return
    const off = along([...WALK_ON].reverse(), e)
    if (off) return peds.push(ped(item, off.x, off.y, -1, e, 1, mirror))
    const s = e - WALK_ON_LENGTH
    if (school && s >= BUS_S) return // on the bus
    const p = roadAt(s)
    peds.push(ped(item, p.x, p.y + LANE.walk, p.tx, e, Math.min(1, (PED_GONE_S - s) / 40), mirror))
  })
  if (school) {
    // The bus that met them waits until the last kid's aboard, then goes.
    const last = arriving.length - 1
    const leave = KID_UNLOAD(last) + (WALK_ON_LENGTH + BUS_S) / KID_V + 0.5
    const b = busTrip(`busP${v - 1}`, sigma, -Infinity, leave, mirror)
    if (b) cars.push(b)
  }
}

// The whole scene at time t (seconds): ferry position, the cars and walk-ons
// riding it (offsets relative to the ferry), and everyone ashore.
function ferryAt(S, t, W) {
  const { h, tauU, tauE: tau, overnight } = halfAt(S, t)
  const b = berths(W)
  const from = b[mod(h, 2)]
  const to = b[1 - mod(h, 2)]
  const cross = H - DEPART
  const underway = tau >= DEPART
  const c = tau - DEPART
  let p = underway ? ease(Math.min(1, c / cross)) : 0
  let stop = null // { kind, u } while stopped mid-channel; u = 0..1 through it
  const brk = troubleAt(S, h).sea
  if (underway && (brk || whaleStop(S, h))) {
    // Two legs with a stop between, anywhere from a fifth to four-fifths of
    // the way. A whale gets a gentle slow-down; a breakdown dies suddenly,
    // still at speed. The second leg eases back up either way.
    const qs = brk ? 0.2 + rnd(h, 16) * 0.6 : 0.3 + rnd(h, 14) * 0.3
    const pause = brk ? BREAKDOWN_S + SMOKE_CLEAR_S : WHALE_S
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
    // Broken down: smoking/sparking for BREAKDOWN_S, then still stopped while
    // the smoke clears (`troubled` covers both, for the sound cue).
    stalled: stop?.kind === 'breakdown' && stop.u * (BREAKDOWN_S + SMOKE_CLEAR_S) < BREAKDOWN_S,
    whaleStop: stop?.kind === 'whale' ? stop.u : null,
    // Ramp stuck on arrival (then held up while the smoke clears).
    jammed: !underway && tauU < -SMOKE_CLEAR_S,
    troubled: stop?.kind === 'breakdown' || (!underway && tauU < 0),
    overnight,
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
function sparksAt(S, t, W) {
  const out = []
  const newest = Math.floor(t / SPARK_DT)
  for (let n = newest; n > newest - SPARK_LIFE / SPARK_DT; n--) {
    const born = n * SPARK_DT
    const src = troubleSpot(ferryAt(S, born, W), W)
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
function flamesAt(S, t, W) {
  const src = troubleSpot(ferryAt(S, t, W), W)
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
function smokeAt(S, t, W) {
  const out = []
  const newest = Math.floor(t / SMOKE_DT)
  for (let n = newest; n > newest - SMOKE_LIFE / SMOKE_DT; n--) {
    const born = n * SMOKE_DT
    const src = troubleSpot(ferryAt(S, born, W), W)
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
function wakeAt(S, t, W) {
  const out = []
  const newest = Math.floor(t / WAKE_DT)
  for (let n = newest; n > newest - WAKE_LIFE / WAKE_DT; n--) {
    const born = n * WAKE_DT
    const f = ferryAt(S, born, W)
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
function whaleAt(S, t, W) {
  const f = ferryAt(S, t, W)
  if (f.whaleStop == null) return null
  const age = f.whaleStop
  // rise (0→1) over the first fifth, hold, sink over the last third
  // Always moving: up quickly, then slower and slower through the middle
  // (never quite frozen), then back down.
  const rise = Math.sin(Math.PI * age) ** 0.45
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
        y: WHALE_Y - 7 + vy * a + 70 * a * a,
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
    // A slow, steady sweep of the flukes the whole time it's up.
    tilt: (rnd(f.h, 52) - 0.5) * 12 + (age - 0.35) * 30,
    flip: rnd(f.h, 53) < 0.5,
    splash: age > 0.72 ? (age - 0.72) / 0.28 : 0, // 0..1 once it's going under
  }
}

function sceneFrame(S, t, W) {
  frameT = t
  const { h, tau: tauRaw, tauU, tauE: tau, overnight } = halfAt(S, t)
  const side = mod(h, 2)
  const { x: ferryX, moving, stalled, jammed, troubled } = ferryAt(S, t, W)
  const sleeping = overnight?.phase === 'night'
  const puzzled = stalled || jammed
  // Riders up top; confused ones pace the roof near their spot as they hop.
  const riderAt = (item, x) => {
    if (!puzzled) return ped(item, x, -45, 1, 0, 1, false)
    const w = puzzledWander(t, item.id)
    const hop = puzzledHop(t, item.id)
    const roofX = Math.max(-36, Math.min(36, x + w.off * 0.6)) // inside the railings
    return ped(item, roofX, -45 - hop, w.dir, t * 25, 1, false, 'confused')
  }

  // Aboard: last visit's riders until they get off, then this visit's once
  // they've boarded. Offsets are physical (ferry frame); the far dock's
  // layout is mirrored, hence `sign`.
  const sign = side === 0 ? 1 : -1
  const deck = []
  boarders(S, 'car', h - 1).forEach((item, i) => {
    if (tauU < CAR_UNLOAD(i))
      deck.push({ id: item.id, dx: -sign * FAR_SLOTS[i], color: item.color })
  })
  boarders(S, 'car', h).forEach((item, k) => {
    if (carBoarded(tau, k)) deck.push({ id: item.id, dx: sign * FAR_SLOTS[k], color: item.color })
  })
  const riders = []
  boarders(S, 'ped', h - 1).forEach((item, j) => {
    if (tauU < PED_UNLOAD(j)) riders.push(riderAt(item, -sign * riderSpot(j)))
  })
  boarders(S, 'ped', h).forEach((item, j) => {
    if (pedBoarded(tau, j)) riders.push(riderAt(item, sign * riderSpot(j)))
  })
  const kidsOff = boarders(S, 'kid', h - 1)
  kidsOff.forEach((item, k) => {
    if (tauU < KID_UNLOAD(k)) riders.push(riderAt(item, -sign * kidSpot(k, kidsOff.length)))
  })
  const kidsOn = boarders(S, 'kid', h)
  kidsOn.forEach((item, k) => {
    if (kidBoarded(tau, k)) riders.push(riderAt(item, sign * kidSpot(k, kidsOn.length)))
  })

  // Each dock's ramp: lowered onto the ferry while it's berthed there,
  // raised a moment before it leaves and while it's away.
  const ramps = [0, 1].map((d) => {
    let down = d === side && !moving ? Math.min(1, tauU / 0.15, (DEPART - tau) / 0.25) : 0
    // Jammed: the ramp flips up and down, never quite seating; then it's held
    // up until the smoke has cleared.
    if (d === side && tauU < 0) down = jammed ? 0.5 + 0.5 * Math.sin(tauRaw * 7) : 0
    return RAMP_UP + (RAMP_DOWN - RAMP_UP) * Math.max(0, down)
  })

  const cars = []
  const peds = []
  dockItems(S, t, 0, cars, peds, side === 0, W, puzzled)
  dockItems(S, t, 1, cars, peds, side === 1, W, puzzled)
  return {
    ferryX,
    wake: wakeAt(S, t, W),
    smoke: smokeAt(S, t, W),
    sparks: sparksAt(S, t, W),
    flames: flamesAt(S, t, W),
    whale: whaleAt(S, t, W),
    // Overnight between replayed days: how far through the night and the
    // morning (0..1, else null), and the sleepy Zs drifting up off the ferry.
    night: sleeping ? overnight.u : null,
    morning: overnight?.phase === 'morning' ? overnight.u : null,
    zs: sleeping ? sleepyZs(tauRaw, ferryX) : [],
    stalled,
    jammed,
    troubled,
    // The real sailing being replayed right now (season sampler), if any.
    sailing: S.sampler?.sailing(h) ?? null,
    ramps,
    deck,
    riders,
    carsOut: cars.filter((c) => c.lane === 'out'),
    buses: cars.filter((c) => c.lane === 'bus'),
    carsIn: cars.filter((c) => c.lane === 'in'),
    peds,
  }
}

// Three Zs rising off the sleeping ferry's tower, one after another.
function sleepyZs(time, ferryX) {
  return [0, 1, 2].map((k) => {
    const u = (time * 0.45 + k / 3) % 1
    return {
      id: k,
      x: ferryX + 8 + u * 16 + Math.sin(u * 6) * 3,
      y: 198 - 70 - u * 34,
      size: 11 + u * 9,
      opacity: Math.sin(Math.PI * u),
    }
  })
}

// A scene instance: its own lines and timeline caches, optionally replaying
// real days (see seasonSampler). Returns (t, W) => frame, with .halfStart(h).
export function createGoatScene({ sampler = null } = {}) {
  const S = {
    lines: { car: new Map(), ped: new Map(), kid: new Map() },
    starts: [0],
    trouble: new Map(),
    sampler,
  }
  const frame = (t, W = WORLD_W) => sceneFrame(S, t, W)
  frame.halfStart = (h) => halfStartOf(S, h)
  frame.breaksDown = (h) => troubleAt(S, h).sea
  frame.rampJams = (h) => troubleAt(S, h).jam
  frame.whaleCrossing = (h) => whaleStop(S, h)
  return frame
}
const randomScene = createGoatScene()
export const goatScene = (t, W) => randomScene(t, W)
export const { halfStart, breaksDown, rampJams, whaleCrossing } = randomScene

// How late a sailing really left (actual departure vs schedule, "HH:MM"),
// in minutes; null when unknown.
function minutesLate(d) {
  if (!d?.actualDepartureTime || !d.sailingTime) return null
  const mins = (hhmm) => {
    const [hh, mm] = String(hhmm).split(':').map(Number)
    return hh * 60 + mm
  }
  let late = mins(d.actualDepartureTime) - mins(d.sailingTime)
  if (late < -720) late += 1440 // left after midnight
  if (late > 720) late -= 1440
  return Number.isFinite(late) ? late : null
}

// --- Season sampler ----------------------------------------------------------
// Replays how full the ferry really was, day after real day, from the history
// page's sailing records ({ dateIso, sailingTime, direction, lastCapacity }).
// A day starts with the ferry at Horseshoe Bay making an empty first run to
// Bowen; then Bowen visits (even halves) take the day's "To HSB" sailings in
// order and mainland visits (odd halves) its "To Bowen" ones (the first of
// those being that empty run). The day ends with the last sailing arriving
// at Horseshoe Bay, where the ferry unloads and sleeps the night before the
// next recorded day. It starts on a random day at a random point. lastCapacity is "Full", "Not Full" or
// "NN%" = space *left*. Returns null when no day has enough data. `pick`
// supplies the randomness (0..1, injectable for tests).
export function seasonSampler(docs, pick = Math.random) {
  const byDay = new Map()
  for (const d of docs || []) {
    if (!d?.dateIso || !d.sailingTime || !d.direction) continue
    if (!byDay.has(d.dateIso)) byDay.set(d.dateIso, [])
    byDay.get(d.dateIso).push(d)
  }
  const days = [...byDay.entries()]
    .filter(([, list]) => {
      const known = list.filter((d) => d.lastCapacity).length
      return known >= 6 && known >= list.length * 0.6
    })
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([dateIso, list]) => {
      const sides = [0, 1].map((side) =>
        list
          .filter((d) => d.direction === (side === 0 ? 'To HSB' : 'To Bowen'))
          .sort((a, b) => (a.sailingTime < b.sailingTime ? -1 : 1)),
      )
      // Halves in the day: one per sailing, alternating sides — an even count,
      // so every day starts (odd half) at Horseshoe Bay, where it slept.
      return { dateIso, sides, halves: 2 * Math.max(1, Math.min(...sides.map((l) => l.length))) }
    })
  if (!days.length) return null

  // Day k (k >= k0) starts at half starts[k - k0]; the first day is joined
  // part-way through.
  const k0 = Math.min(days.length - 1, Math.floor(pick() * days.length))
  const dayOf = (k) => days[mod(k, days.length)]
  const starts = [1 - 2 * Math.floor(pick() * (dayOf(k0).halves / 2))]
  function dayAt(h) {
    if (h < starts[0]) return { k: k0, i: mod(h - starts[0], dayOf(k0).halves), start: null }
    let n = 0
    for (;;) {
      if (starts.length <= n + 1) starts.push(starts[n] + dayOf(k0 + n).halves)
      if (h < starts[n + 1]) return { k: k0 + n, i: h - starts[n], start: starts[n] }
      n++
    }
  }
  const sailingFor = (v) => {
    const { k, i } = dayAt(v)
    const l = dayOf(k).sides[mod(v, 2)]
    return l.length ? l[Math.min(l.length - 1, Math.floor(i / 2))] : null
  }
  return {
    key: dayOf(k0).dateIso,
    dateIso: dayOf(k0).dateIso,
    // First half of the day containing h (null before the first full day).
    dayStart: (h) => dayAt(h).start,
    // Who else rides visit v's sailing: 'kids' on school runs (the 7:30am
    // from Bowen and the 3:55pm back, weekdays, September–June), 'tourists'
    // in summer (July–August: over from the mainland in the morning, back in
    // the mid/late afternoon), else null.
    extraCrowd(v) {
      const d = sailingFor(v)
      if (!d || dayAt(v).i === 0) return null
      const date = new Date(`${d.dateIso}T12:00:00Z`)
      const month = date.getUTCMonth() + 1
      const hour = parseInt(d.sailingTime)
      if (month === 7 || month === 8) {
        if (d.direction === 'To Bowen' && hour >= 7 && hour < 12) return 'tourists'
        if (d.direction === 'To HSB' && hour >= 13 && hour < 19) return 'tourists'
        return null
      }
      const weekday = date.getUTCDay()
      if (weekday === 0 || weekday === 6) return null
      if (d.direction === 'To HSB' && d.sailingTime === '07:30') return 'kids'
      if (d.direction === 'To Bowen' && d.sailingTime === '15:55') return 'kids'
      return null
    },
    // Visit v is a day's empty first run (Horseshoe Bay → Bowen).
    emptyRun: (v) => dayAt(v).i === 0,
    // Half h is the first of a new day (so the night before it is slept).
    isDayStart(h) {
      if (h <= 0) return false
      const { i, start } = dayAt(h)
      return i === 0 && start !== null
    },
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
      return (
        d && {
          dateIso: d.dateIso,
          time: d.sailingTime,
          direction: d.direction,
          capacity: d.lastCapacity,
          empty: dayAt(v).i === 0,
          lateMin: minutesLate(d),
        }
      )
    },
  }
}
