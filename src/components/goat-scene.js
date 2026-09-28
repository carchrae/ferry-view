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
const QUEUE_S = (k) => 78 + 22 * k // car k's spot in line (0 = front, past the school-bus spot)
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
// Summer tourists (the hats) amble and wander erratically: slow walkers,
// spread out rather than clumped, drifting about while they wait. Off the
// ferry they dawdle at the foot of the ramp — and the cars have to wait for
// them to clear (see touristHold).
const TOURIST_V = 30
const TOURIST_BOARD_V = 45 // shuffling aboard once it's loading
const TOURIST_START_S = 95
const TOURIST_GONE_S = 120
// Each tourist gets off in their own time, dawdles their own while and
// ambles off at their own pace — so they straggle rather than march.
const TOURIST_UNLOAD = (k) => 0.5 + 0.25 * k
const touristDawdle = (item) => 1.5 + 2 * rnd(seedOf(item.id), 71)
const touristPace = (item) => TOURIST_V * (0.75 + 0.5 * rnd(seedOf(item.id), 72))
const TOURIST_WAIT_S = (i) => 12 + 8 * i + 3 * Math.sin(i * 2.7)
// They start shuffling aboard a little early (getting in the way of the
// last cars off).
const TOURIST_LOAD = (k) => 1.2 + 0.03 * k
const crowdLoad = (item, k) => (item.kid ? KID_LOAD(k) : TOURIST_LOAD(k))
const crowdV = (item) => (item.kid ? KID_V : TOURIST_V)
const boardV = (item) => (item.kid ? KID_V : TOURIST_BOARD_V)
const crowdSpot = (item, k) => (item.kid ? KID_WAIT_S(k) : TOURIST_WAIT_S(k))
const KID_WAIT_S = (k) => 6 + 2.2 * k // a packed crowd
const KID_LOAD = (k) => 1.7 + 0.035 * k // …streaming aboard
const KID_UNLOAD = (k) => 0.5 + 0.07 * k
// The school bus never boards: it drops the kids at their dock (parking at
// the bus stop, see stopSpot) and another meets them off the ferry at the
// other end.
// Buses are drawn at BUS_SCALE (the shapes are laid out at half size).
const BUS_SCALE = 2
const scaled = (c, k = BUS_SCALE) => ({ ...c, transform: `${c.transform} scale(${k})` })
const BUS_V = 320 // as quick as the cars, so nothing catches it up the hill
const LANE_SWAP = 10 // road length over which it changes lanes
// Both buses pull in just as the ferry leaves the other dock: the drop-off
// bus as it sets off to fetch the kids, the pick-up bus as it sets off with
// them. busDriveS(spot) is the drive down the hill to its spot.
const busDriveS = (spot) => (ROAD.length - spot) / BUS_V
// When kid i (of n) steps out of the drop-off bus, after it parks.
const kidOutAt = (i, n) => 0.3 + i * Math.min(0.15, 3 / n)
const isSchool = (crowd) => crowd.length > 0 && !!crowd[0].kid
// The bus at road position s, facing downhill (arriving) or uphill
// (leaving), `lane` (a LANE offset) across the road — it drives in the cars'
// lanes.
function bus(id, s, uphill, mirror, lane) {
  const p = roadAt(s)
  const [dx, dy] = uphill ? [p.tx, p.ty] : [-p.tx, -p.ty]
  const c = scaled(car({ id, color: '#fbc02d' }, 'bus', p.x, p.y + lane, dx, dy, mirror))
  return { ...c, kind: 'school', leaving: uphill }
}
const mixLane = (a, b, u) => a + (b - a) * Math.max(0, Math.min(1, u))
// Driving down from the top of the road to park at the bus stop (road
// position `spot`) from time `from`, then (from `leave`) back up and away;
// null once gone (or not yet come). It comes down the roadside, like the
// transit buses; leaving, it pulls into the uphill lane behind anything
// already going up (cars are faster, so it never catches them).
function busTrip(id, clock, from, leave, mirror, spot) {
  if (clock < from) return null
  if (clock < leave) {
    const s = Math.max(spot, ROAD.length - (clock - from) * BUS_V)
    return bus(id, s, false, mirror, stopLane())
  }
  const s = spot + (clock - leave) * BUS_V
  if (s >= ROAD.length) return null
  return bus(id, s, true, mirror, mixLane(stopLane(), LANE.out, (s - spot) / LANE_SWAP))
}
// When the pick-up bus at visit h's dock leaves (unload clock), or 0 if none.
function busLeaves(S, h) {
  const kids = boarders(S, 'kid', h - 1)
  if (!isSchool(kids)) return 0
  const kidsOn = KID_UNLOAD(kids.length - 1) + (WALK_ON_LENGTH + schoolFarthest(h)) / KID_V + 0.5
  return Math.max(kidsOn, carsClearU(S, h))
}
// When visit h's cars have all driven off the ferry and on past road
// position `at` (unload clock) — a bus pulling out waits for that traffic
// rather than cut in among it. (School buses go by the farthest spot they
// might have parked at, so their timing needn't know which.)
function carsClearU(S, h, at = schoolFarthest(h)) {
  const n = boarders(S, 'car', h - 1).length
  if (!n) return 0
  const route = pathLength(deckPath(BERTH - FAR_SLOTS[n - 1]))
  // (+70: the last car well clear ahead, since a bus is long)
  return touristHold(S, h) + CAR_UNLOAD(n - 1) + (route + at + 70) / CAR_V
}
// When the drop-off bus that brought visit w's kids leaves (scene time):
// once they're all out — and if the ferry's in by then, once its cars have
// gone by.
function dropOffLeaves(S, w, kids) {
  const kidsOut = departsAt(S, w - 1) + kidOutAt(kids.length - 1, kids.length) + 0.8
  const arrived = halfStartOf(S, w) + jamDelay(S, w)
  return arrived < kidsOut ? Math.max(kidsOut, arrived + carsClearU(S, w)) : kidsOut
}
// The pick-up bus pulls out across the boarding path: the new line can't
// start down to the ferry until it's gone (and clear of the dock).
const busHold = (S, h) => {
  const leaves = busLeaves(S, h)
  return leaves ? Math.max(0, leaves + (LANE_SWAP + 40) / BUS_V - LOAD_START) : 0
}
// --- Transit buses -----------------------------------------------------------
// Each dock has a bus stop on the roadside a little way up from where the
// school bus parks (drawn over the car lanes, under the school bus).
//  - Bowen: a short blue community shuttle pulls in as the ferry leaves
//    Horseshoe Bay and waits for the walk-offs. It has SHUTTLE_SEATS seats;
//    tourists grab them first, and if they fill it the locals left at the
//    stop are fuming.
//  - Horseshoe Bay: an articulated bus (two sections) runs to its own (random)
//    timetable. Pull away while someone's still walking up from the ferry
//    and they've missed it.
// A local who misses their bus hops mad until someone drives back down to
// pick them up (a ❤ as the car pulls in). Tourists just wander about and
// catch the next one (or wander off); school kids always get their bus.
// The bus stop, on the roadside STOP_S up from the dock: the transit bus and
// the school bus both use it. First there takes the front; a bus turning up
// while another's parked pulls in right behind it (see stopSpot). (Far
// enough up that a bus at the front has its nose off the dock.)
const STOP_S = 100
// Waiting for the bus: on the roadside just short of the front bus's door
// (just past its front wheel, see busDoors), so they walk up to it, not back.
const STOP_WAIT = STOP_S - 20
// …the rest lining up behind, back towards the dock, LINE_GAP apart — closer
// only if there isn't room.
const LINE_GAP = 5
const LINE_END = 14 // (not onto the dock)
const stopLane = () => LANE.walk + 7 // the roadside, in front of the lanes
const SHUTTLE_SEATS = 8
const ARTIC_EVERY = 10
// Share of walk-on locals who come and go by bus: nearly all at Horseshoe
// Bay, about half on Bowen.
const BUS_SHARE = [0.5, 0.9] // [Bowen, Horseshoe Bay]
const takesBus = (item, side, salt) => rnd(seedOf(item.id), salt) < BUS_SHARE[side]
const MAD_WAIT = 1.2 // fuming before the rescue car sets off
const CAR_SEATS = 3 // a rescue car takes up to three
const PICKUP_V = 320
const LOVE_S = 0.8 // the ❤ moment before they hop in
// The Bowen shuttle's last run meets the sailing that left Horseshoe Bay at
// 8:10pm (in by ~8:30). After that it's a ride or a walk home up the hill
// in the dark, by flashlight.
const LAST_SHUTTLE = '20:10'
const GETS_A_RIDE = 0.45
// Is there a shuttle for Bowen visit v (the sailing that brought them in)?
const shuttleRuns = (S, v) => {
  const time = S.sampler?.sailing(v - 1)?.time
  return !time || time <= LAST_SHUTTLE
}
// Transit bus parts along the road (front first): offsets behind the front,
// and each part's length.
const SHUTTLE_PARTS = [0]
const ARTIC_SCALE = 2.4 // a little bigger than the other buses
const ARTIC_PARTS = [0, 24 * ARTIC_SCALE]
const transitDriveS = () => (ROAD.length - STOP_S) / BUS_V
// The articulated bus, cycle n: parked from park to leave (scene time).
const articPark = (n) => n * ARTIC_EVERY + 3 + rnd(n, 111) * 2
const articDue = (n) => articPark(n) + 3.5 + rnd(n, 112) * 2.5
// When it actually pulls out: on time, unless the ferry's unloading at that
// moment — then it waits for the cars to go by.
function articLeave(S, n) {
  const due = articDue(n)
  const { h } = halfAt(S, due)
  const v = h - mod(h - 1, 2) // Horseshoe Bay's latest visit
  if (v < 0) return due
  const base = halfStartOf(S, v) + jamDelay(S, v)
  const clear = base + carsClearU(S, v, STOP_S)
  return due >= base && due < clear ? clear : due
}
// The articulated bus runs from 4am until midnight (by the simulated clock).
const ARTIC_FROM = 4 * 60
function articRuns(S, n) {
  const drive = transitDriveS()
  const from = simClock(S, articPark(n) - drive)
  const to = simClock(S, articLeave(S, n) + drive)
  if (!from || !to) return true // (no replay: it just runs)
  const sameDay = Math.floor(from.minutes / 1440) === Math.floor(to.minutes / 1440)
  return sameDay && mod(from.minutes, 1440) >= ARTIC_FROM
}
// First articulated bus (its cycle n) someone reaching the stop at `at` can
// catch.
function articBoard(S, at) {
  for (let n = Math.floor(at / ARTIC_EVERY) - 1; n < Math.floor(at / ARTIC_EVERY) + 60; n++)
    if (articRuns(S, n) && articLeave(S, n) >= at) return n
}
// Did one pull away between `from` (off the ferry) and `at` (at the stop)?
function articMissed(S, from, at) {
  for (let n = Math.floor(from / ARTIC_EVERY) - 1; articPark(n) < at; n++) {
    if (!articRuns(S, n)) continue
    const l = articLeave(S, n)
    if (l >= from && l < at) return true
  }
  return false
}
// A transit bus (its parts) at road position s — the front — driving
// downhill (arriving) or uphill (leaving), on the roadside.
// Arriving it pulls in along the roadside; leaving, it swings out into the
// uphill lane with the departing cars.
// `s` is where the downhill end is: arriving that's its front; leaving (it's
// turned round) its back — so each section stays where it physically is.
function transitBus(id, kind, s, uphill, mirror, parts, spot) {
  const last = parts.length - 1
  return parts.flatMap((off, k) => {
    const sp = s + off
    if (sp < 0 || sp > ROAD.length + 30) return []
    const p = roadAt(sp)
    const [dx, dy] = uphill ? [p.tx, p.ty] : [-p.tx, -p.ty]
    const lane = uphill ? mixLane(stopLane(), LANE.out, (sp - spot) / LANE_SWAP) : stopLane()
    return [
      {
        ...scaled(
          car({ id: `${id}.${k}`, color: '' }, 'transit', p.x, p.y + lane, dx, dy, mirror),
          kind === 'artic' ? ARTIC_SCALE : BUS_SCALE,
        ),
        kind,
        leaving: uphill,
        // the leading section gets the nose, the others the bellows behind
        front: uphill ? k === last : k === 0,
        trailing: uphill ? k === 0 : k === last,
      },
    ]
  })
}
// Down the hill to park at the stop (at road position `spot`) by `park`,
// then away from `leave`.
function transitTrip(id, kind, t, park, leave, mirror, parts, spot) {
  const drive = transitDriveS()
  if (t < park - drive || t > leave + drive + 1) return []
  const s = t < park ? spot + (park - t) * BUS_V : t < leave ? spot : spot + (t - leave) * BUS_V
  return transitBus(id, kind, s, t >= leave, mirror, parts, spot)
}

// --- Who's where at the bus stop ---------------------------------------------
// How far each kind of bus reaches (road units) from its position: [nose,
// downhill; tail, uphill].
const reach = (kind) =>
  kind === 'artic' ? [28, ARTIC_PARTS[1] + 28] : kind === 'shuttle' ? [29, 26] : [32, 32]
const STOP_GAP = 4
// Where people get on (road position, with the bus parked at `spot`): the
// door just past the front wheel — and on the articulated bus, the one just
// past the second section's front wheel too.
const busDoors = (kind, spot) =>
  kind === 'artic' ? [spot - 9, spot + ARTIC_PARTS[1] - 9] : [spot - 12] // (school bus and shuttle: front wheel ~18 ahead of centre)
// The farthest up a school bus parks at visit h's dock: behind that side's
// transit bus.
const schoolFarthest = (h) =>
  STOP_S + reach(mod(h, 2) === 0 ? 'shuttle' : 'artic')[1] + STOP_GAP + reach('school')[0]
// Every bus stopping at `side`'s stop around scene time `at`, with when it
// parks and leaves: school buses (dropping off for visit w, or meeting the
// kids in at w), the Bowen shuttle, the articulated bus.
function stopVisitors(S, side, at) {
  const list = []
  const { h } = halfAt(S, at)
  for (let w = h - 3; w <= h + 2; w++) {
    if (w < 1 || mod(w, 2) !== side) continue
    const park = departsAt(S, w - 1)
    const out = lineAt(S, 'kid', w)
    if (isSchool(out))
      list.push({ id: `busD${w}`, kind: 'school', park, leave: dropOffLeaves(S, w, out) })
    if (isSchool(boarders(S, 'kid', w - 1)))
      list.push({ id: `busP${w - 1}`, kind: 'school', park, leave: pickUpLeaves(S, w) })
    if (side === 0 && shuttleRuns(S, w)) {
      const plan = walkOffPlan(S, w, 0)
      list.push({
        id: `shuttle${w}`,
        kind: 'shuttle',
        park: shuttlePark(S, w),
        leave: plan.base + plan.leave,
      })
    }
  }
  if (side === 1) {
    const n = Math.floor(at / ARTIC_EVERY)
    for (let k = n - 2; k <= n + 1; k++)
      if (articRuns(S, k))
        list.push({ id: `artic${k}`, kind: 'artic', park: articPark(k), leave: articLeave(S, k) })
  }
  return list
}
// Where bus `id` (a `kind`, parking at scene time `park`) stops: the front of
// the stop, or — if others are parked there as it pulls in — right behind
// the last of them to arrive. (Transit buses win a dead heat: it's their
// stop.) Nobody ever has to drive through a parked bus.
function stopSpot(S, side, id, kind, park) {
  const key = `${side}:${id}`
  if (S.spots.has(key)) return S.spots.get(key)
  const me = { id, kind, park }
  const rank = (b) => (b.kind === 'school' ? 1 : 0)
  const before = (a, b) =>
    a.park < b.park ||
    (a.park === b.park && (rank(a) < rank(b) || (rank(a) === rank(b) && a.id < b.id)))
  // (anyone still parked as it comes down the roadside, not just when it
  // pulls in — it mustn't drive through them)
  const comingDown = (ROAD.length - STOP_S) / BUS_V
  const ahead = stopVisitors(S, side, park).filter(
    (b) => b.id !== id && before(b, me) && b.leave + 0.2 > park - comingDown,
  )
  let spot = STOP_S
  if (ahead.length) {
    const last = ahead.reduce((a, b) => (before(a, b) ? b : a))
    spot =
      stopSpot(S, side, last.id, last.kind, last.park) +
      reach(last.kind)[1] +
      STOP_GAP +
      reach(kind)[0]
  }
  S.spots.set(key, spot)
  return spot
}
// When the pick-up bus meeting visit w's kids leaves (scene time).
const pickUpLeaves = (S, w) => halfStartOf(S, w) + jamDelay(S, w) + busLeaves(S, w)

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
// The crosswalk up the hill on Bowen (where the crosswalk camera looks): it
// sits about 80% of a full load up the line — once the queue reaches past
// it, the sailing's nearly full. Between the 8th and 9th car in line.
const CROSSWALK_K = Math.round(0.8 * CAR_CAPACITY) // cars in line below it
export const CROSSWALK = (() => {
  const p = roadAt((QUEUE_S(CROSSWALK_K - 1) + QUEUE_S(CROSSWALK_K)) / 2)
  return { x: p.x, y: p.y, deg: (Math.atan2(p.ty, p.tx) * 180) / Math.PI }
})()

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
// Random traffic: rolled per half, mixed with the scene's seed — otherwise
// every opening of the dialog (which restarts at half 0) would replay the
// same failures. (Replays only break down where the real ferry suddenly ran
// late — see lateCause.)
const seaRoll = (S, h) => !S.sampler && h > 0 && rnd(h + S.seed, 7) < 0.01
const jamRoll = (S, h) => !S.sampler && h > 0 && rnd(h + S.seed, 9) < 0.01
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
  // Replaying real days, a sailing that suddenly ran late owes it to a
  // breakdown on the crossing just before: the ferry broke down on the way
  // in (h - 1), or the ramp jammed as it arrived (at h). Random traffic has
  // the odd random failure instead.
  const jam = (jamRoll(S, h) || S.sampler?.lateCause(h) === 'jam') && used < MAX_BREAKDOWNS
  const sea =
    (seaRoll(S, h) || S.sampler?.lateCause(h + 1) === 'sea') && used + jam < MAX_BREAKDOWNS
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
// Dock clocks per visit: walk-offs wait only for a jammed ramp; cars also
// wait for dawdling tourists; loading (and departure) waits for all that
// and any night.
// (Halves before the scene opens run on a fixed clock: no delays.)
const dockDelay = (S, h) =>
  h < 0 ? 0 : jamDelay(S, h) + touristHold(S, h) + busHold(S, h) + nightDelay(S, h)
// Whale crossings: a tail surfaces in the ferry's path, so it eases to a stop
// just short of it and waits until the whale has gone back under (about one
// crossing in thirty-odd, never on a breakdown crossing; the first comes early).
const WHALE_S = 2.4 // as long as its surprised jingle
export const WHALE_Y = 198 // the whale breaks the surface right at the horizon line
const FIRST_WHALE = 1
const whaleStop = (S, h) =>
  h >= 0 &&
  !troubleAt(S, h).sea &&
  (h === FIRST_WHALE || (h > FIRST_WHALE && rnd(h + S.seed, 13) < 0.03))
// A big crowd (a summer tour group) can take longer to shuffle aboard than
// the usual turnaround — and on Bowen the cars wait for the foot passengers:
// the ferry holds at the dock until the last of them is on and the ramp's up
// — nobody steps off the end into the sea, no car's left on the ramp.
function boardHold(S, h) {
  if (h < 0) return 0 // (the scene opens mid-cycle, on a fixed clock)
  let last = 0
  lineAt(S, 'kid', h).forEach((item, k) => {
    last = Math.max(last, crowdLoad(item, k) + (crowdSpot(item, k) + WALK_ON_LENGTH) / boardV(item))
  })
  boarders(S, 'car', h).forEach((_, k) => {
    last = Math.max(last, carAboard(S, h, k))
  })
  // …and everyone getting off is off the ramp (their unload clock runs
  // ahead of the load clock by the dock's holds)
  const lag = dockDelay(S, h) - jamDelay(S, h)
  boarders(S, 'kid', h - 1).forEach((x, k) => {
    const off = x.kid
      ? KID_UNLOAD(k) + WALK_ON_LENGTH / KID_V
      : TOURIST_UNLOAD(k) + WALK_ON_LENGTH / touristPace(x)
    last = Math.max(last, off - lag)
  })
  boarders(S, 'ped', h - 1).forEach((_, j) => {
    last = Math.max(last, PED_UNLOAD(j) + WALK_ON_LENGTH / PED_V - lag)
  })
  return Math.max(0, last + 0.35 - DEPART)
}
// When the ferry casts off, on half h's load clock.
const departAfter = (S, h) => DEPART + boardHold(S, h)
const halfLen = (S, h) =>
  H +
  boardHold(S, h) +
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
  const tauC = tauU - touristHold(S, h) // cars' unload clock
  let overnight = null
  if (nightDelay(S, h)) {
    const rel = tauC - UNLOAD_END
    if (rel >= 0 && rel < NIGHT_S) overnight = { phase: 'night', u: rel / NIGHT_S }
    else if (rel >= NIGHT_S && rel < NIGHT_S + MORNING_S)
      overnight = { phase: 'morning', u: (rel - NIGHT_S) / MORNING_S }
  }
  return { h, tau, tauU, tauC, tauE: tau - dockDelay(S, h), overnight }
}
// When the ferry leaves the dock of half h (scene time).
const departsAt = (S, h) => halfStartOf(S, h) + dockDelay(S, h) + departAfter(S, h)

// The overnight window before day-start half h0, in scene time.
function overnightWindow(S, h0) {
  const N0 = halfStartOf(S, h0) + jamDelay(S, h0) + touristHold(S, h0) + UNLOAD_END
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
  // Replaying a sailing that wasn't full: everyone in line got on (a big
  // crowd of foot passengers or not — see newcomers, which keeps the line
  // within the deck).
  const load = S.sampler?.load(v)
  if (load != null && load !== 'full') return CAR_CAPACITY
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
    // Kids: a busload. Tourists: the later the sailing really ran, the more
    // of them there were to blame.
    const late = Math.max(0, S.sampler.sailing(v)?.lateMin ?? 0)
    const n = kids
      ? 20 + Math.floor(rnd(v, 4) * 11)
      : Math.min(16, 3 + Math.round(late / 2.5) + Math.floor(rnd(v, 4) * 2))
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
  let n =
    kind === 'car'
      ? rush
        ? // (a line a few longer than the deck, counting any still waiting
          // from last time — not a fresh overflow on top of theirs)
          Math.max(1, CAR_CAPACITY + 1 + Math.floor(r * 4) - carried)
        : typeof load === 'number'
          ? Math.max(1, Math.round(load * CAR_CAPACITY))
          : 3 + Math.floor(r * 6)
      : rush
        ? 5 + Math.floor(r * 2)
        : 1 + Math.floor(r * 3)
  // Seen reaching the crosswalk: at least that long a line.
  const seen = kind === 'car' && S.sampler?.sailing(v)?.crosswalkAt != null
  if (seen) n = Math.max(n, CROSSWALK_K + 1 - carried)
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
// Replaying a Bowen sailing whose line was seen reaching the crosswalk (by
// the crosswalk camera, or a rider): the car taking the first spot past it
// pulls in right then by the simulated clock, the cars before and after it
// spaced out around that. `a`: visit v + 2's newcomer arrivals (on v's load
// clock), `left` cars already in line ahead of them.
function crosswalkTimed(S, v, side, left, a) {
  const at = side === 0 ? S.sampler?.sailing(v + 2)?.crosswalkAt : null
  const j = CROSSWALK_K - left
  if (at == null || j < 0 || j >= a.length) return a
  const base = halfStartOf(S, v) + dockDelay(S, v)
  const drive = (ROAD.length - QUEUE_S(CROSSWALK_K)) / CAR_V // down to its spot
  // (all in line before boarding starts — even if, as a real line sometimes
  // does, it only gets that long while the ferry's in unloading)
  const boarding = halfStartOf(S, v + 2) + dockDelay(S, v + 2) + carLoad(S, v + 2, 0)
  const until = boarding - 0.4 - ROAD.length / CAR_V - base
  const when = whenClockReads(S, at, halfStartOf(S, v), departsAt(S, v + 2))
  const target = Math.min(until, Math.max(ARRIVE_WINDOW[0], when - base - drive))
  const [w0, A, last] = [ARRIVE_WINDOW[0], a[j], a[a.length - 1]]
  const early = (target - w0) / (A - w0)
  const late = last > A ? Math.min(1, (until - target) / (last - A)) : 1
  return a.map((x, i) => (i <= j ? w0 + (x - w0) * early : target + (x - A) * late))
}
// Crosswalk-timed cars in visit v's line that only turn up once the ferry's
// back in (while it unloads): when car k does (scene time), else null.
function lateArrival(S, v, side, k) {
  if (side !== 0 || S.sampler?.sailing(v)?.crosswalkAt == null || firstOfDay(S, v)) return null
  const prev = lineAt(S, 'car', v - 2)
  const left = prev.length - Math.min(prev.length, capOf(S, 'car', v - 2))
  const i = k - left
  if (i < 0) return null
  const n = lineAt(S, 'car', v).length - left
  const a = crosswalkTimed(S, v - 2, side, left, carArrivals(v, n))
  const at = halfStartOf(S, v - 2) + dockDelay(S, v - 2) + a[i]
  return at > halfStartOf(S, v) ? at : null
}
const boarders = (S, kind, v) => lineAt(S, kind, v).slice(0, capOf(S, kind, v))
const kidBoarded = (sigma, k, item) =>
  sigma >= crowdLoad(item, k) + (crowdSpot(item, k) + WALK_ON_LENGTH) / boardV(item)
// Tourists coming off at visit h hold the cars up until they've wandered
// clear of the ramp: how long the cars wait (on the unload clock).
// On Bowen the cars wait for every foot passenger to get off and clear the
// ramp first. (At Horseshoe Bay they just roll off alongside them.)
function touristHold(S, h) {
  const bowen = mod(h, 2) === 0
  if (!bowen) return 0
  let clear = 0
  boarders(S, 'kid', h - 1).forEach((x, k) => {
    if (!x.kid)
      clear = Math.max(
        clear,
        TOURIST_UNLOAD(k) + WALK_ON_LENGTH / touristPace(x) + touristDawdle(x),
      )
    else clear = Math.max(clear, KID_UNLOAD(k) + WALK_ON_LENGTH / KID_V)
  })
  boarders(S, 'ped', h - 1).forEach((x, j) => {
    clear = Math.max(clear, PED_UNLOAD(j) + WALK_ON_LENGTH / PED_V)
  })
  return clear ? clear + 0.4 : 0
}

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
    love: mood === 'love',
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
// On Bowen the cars only start boarding once every foot passenger (and any
// crowd) is aboard: how much later than usual, on visit v's load clock.
function carsWaitToBoard(S, v) {
  if (v < 0 || mod(v, 2) !== 0) return 0
  let done = 0
  lineAt(S, 'ped', v).forEach((_, j) => {
    done = Math.max(done, PED_LOAD(j) + (WAIT_S(j) + WALK_ON_LENGTH) / PED_V)
  })
  lineAt(S, 'kid', v).forEach((item, k) => {
    done = Math.max(done, crowdLoad(item, k) + (crowdSpot(item, k) + WALK_ON_LENGTH) / boardV(item))
  })
  return Math.max(0, done + 0.2 - CAR_LOAD(0))
}
// When visit v's car k sets off aboard (load clock).
const carLoad = (S, v, k) => CAR_LOAD(k) + carsWaitToBoard(S, v)
// …and when it's parked on the deck.
const carAboard = (S, v, k) =>
  carLoad(S, v, k) + (QUEUE_S(k) + pathLength(deckPath(BERTH + FAR_SLOTS[k]))) / CAR_V
const carBoarded = (S, v, sigma, k) => {
  const e = (sigma - carLoad(S, v, k)) * CAR_V
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

// A tourist's erratic drift: three out-of-step sways, so they dither, double
// back and wander off at their own pace. `off` is how far they've strayed.
function touristWander(t, id) {
  const k = seedOf(id)
  const [a, b, c] = [0.7 + (k % 0.3), 1.9 + (k % 0.5), 4.1]
  const off =
    9 * Math.sin(a * t + k) + 5 * Math.sin(b * t + 1.3 * k) + 2.5 * Math.sin(c * t + 2.1 * k)
  const vel =
    9 * a * Math.cos(a * t + k) +
    5 * b * Math.cos(b * t + 1.3 * k) +
    2.5 * c * Math.cos(c * t + 2.1 * k)
  return { off, dir: vel >= 0 ? 1 : -1, moving: Math.abs(vel) > 6 }
}
// Someone in a crowd waiting around road position s: tourists wander about
// erratically; students just fidget a little on the spot.
function strollPed(item, t, s, mirror, dy = 0) {
  const w = touristWander(item.kid ? t * 1.4 : t, item.id)
  const p = roadAt(Math.max(2, s + (item.kid ? 1 + w.off * 0.18 : 4 + w.off * 0.55)))
  const dx = w.dir > 0 ? p.tx : -p.tx
  return ped(item, p.x, p.y + LANE.walk + dy, dx, w.moving ? t * 12 : 0, 1, mirror, null, s)
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
  const { N0 } = overnightWindow(S, h0)
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
  // (Bowen's line for the day's first sailing arrives from 5am — dockDay.)
  // The ferry's own arrivals keep unloading and heading home as normal.
  walkOffs(S, t, side, h0 - mod(h0 - side, 2), peds, cars, W)
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
  // The day's first line at Bowen turns up from 5am: the one this visit is
  // about to load (opensNow, scene time), or the next one (dawn, load clock).
  const opensNow = side === 0 ? bowenOpens(S, v) : null
  const opens = side === 0 && dayBreak && !quietEvening ? bowenOpens(S, v + 2) : null
  const dawn = opens == null ? null : opens - halfStartOf(S, v) - dockDelay(S, v)

  // --- cars: board up to capacity; the rest roll forward with the line and
  // stop at the front of the dock, still there as the ferry pulls away ---
  const line = lineAt(S, 'car', v)
  const nBoard = Math.min(line.length, capOf(S, 'car', v))
  line.forEach((item, k) => {
    if (k >= nBoard) {
      if (t >= homeTime) return // went home for the night
      // Didn't make it: pull up to the dock and bounce on the springs in a
      // rage, alongside the walk-ons, while the ferry sails off.
      const moved = Math.max(0, sigma - carLoad(S, v, k)) * CAR_V
      const mad = sigma >= HOP[0] && sigma < HOP[1]
      const bounce = mad ? 0.3 + Math.abs(Math.sin(sigma * 15 + k * 2.3)) * 3 : 0
      cars.push(queued(item, Math.max(QUEUE_S(k - nBoard), QUEUE_S(k) - moved), mirror, bounce))
    } else if (sigma < carLoad(S, v, k)) {
      if (opensNow != null) {
        // (the day's first line at Bowen: driving in from 5am)
        const start = opensNow + 0.1 + k * 0.25
        if (t < start) return
        cars.push(queued(item, Math.max(QUEUE_S(k), ROAD.length - (t - start) * CAR_V), mirror))
        return
      }
      const late = lateArrival(S, v, side, k)
      if (late != null) {
        // (still on its way down: the line reached the crosswalk late)
        if (t < late) return
        const s = Math.max(QUEUE_S(k), ROAD.length - (t - late) * CAR_V)
        if (s > QUEUE_S(k)) return cars.push(queued(item, s, mirror))
      }
      cars.push(queued(item, QUEUE_S(k), mirror, fuming(v, t, k)))
    } else {
      const at = toDeck((sigma - carLoad(S, v, k)) * CAR_V, QUEUE_S(k), BERTH + FAR_SLOTS[k])
      // On the ramp it's drawn with the far lane, i.e. behind the ferry's wall.
      if (at) cars.push(car(item, at.onRamp ? 'out' : 'in', at.x, at.y, at.dx, at.dy, mirror))
    }
  })
  const leftCars = dayBreak ? 0 : line.length - nBoard
  const nextCars = quietEvening ? none : lineAt(S, 'car', v + 2).slice(leftCars)
  const arrivals = crosswalkTimed(S, v, side, leftCars, carArrivals(v + 2, nextCars.length))
  nextCars.forEach((item, i) => {
    const start = dawn != null ? dawn + 0.1 + i * 0.25 : arrivals[i]
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
      if (opensNow != null) {
        // (the day's first walk-ons at Bowen: down the hill from 5am)
        const e = (t - (opensNow + 0.6 + j * 0.3)) * PED_V_ARRIVE
        if (e < 0) return
        const p = roadAt(Math.max(WAIT_S(j), PED_START_S - e))
        peds.push(ped(item, p.x, p.y + LANE.walk, 1, e, Math.min(1, e / 20), mirror))
        return
      }
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
    const slot = WAIT_S(leftPeds + i)
    // Off the bus at the stop, walking down to the dock — or down the hill.
    const dropped = busDropOff(S, side, v + 2, item)
    let s
    let e
    if (dropped != null) {
      if (t < dropped) return
      e = (t - dropped) * PED_V
      s = Math.max(slot, STOP_S - 12 - e) // (from the front bus's door)
    } else {
      const start = dawn != null ? dawn + 0.6 + i * 0.3 : PED_ARRIVE(i, nextPeds.length)
      if (sigma < start) return
      e = (sigma - start) * PED_V_ARRIVE
      s = Math.max(slot, PED_START_S - e)
    }
    const p = roadAt(s)
    const walking = s > slot
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
        dropped != null ? 1 : Math.min(1, e / 20),
        mirror,
        null,
        walking ? null : slot,
      ),
    )
  })

  // --- school kids: bunched on the dock (a little staggered), all board ---
  lineAt(S, 'kid', v).forEach((item, k) => {
    const s0 = crowdSpot(item, k)
    const dy = (k % 2) * 2
    if (sigma < crowdLoad(item, k)) {
      if (puzzled) return peds.push(lostPed(item, t, s0, mirror))
      return peds.push(strollPed(item, t, s0, mirror, dy))
    }
    const e = (sigma - crowdLoad(item, k)) * boardV(item)
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
  const dropSpot = schoolDrop ? stopSpot(S, side, `busD${v + 2}`, 'school', busParks) : STOP_S
  const [dropDoor] = busDoors('school', dropSpot)
  if (schoolDrop) {
    // The drop-off bus: down to the dock, kids pour out, back up the hill.
    const leave = dropOffLeaves(S, v + 2, nextKids)
    const from = busParks - busDriveS(dropSpot)
    const b = busTrip(`busD${v + 2}`, t, from, leave, mirror, dropSpot)
    if (b) cars.push(b)
  }
  // The drop-off bus that brought this sailing's kids may still be parked or
  // pulling away after the ferry's arrived (the visit ticks over, but it
  // hasn't gone yet).
  const ownKids = lineAt(S, 'kid', v)
  if (isSchool(ownKids)) {
    const parked = departsAt(S, v - 1)
    const leave = dropOffLeaves(S, v, ownKids)
    const spot = stopSpot(S, side, `busD${v}`, 'school', parked)
    const b = busTrip(`busD${v}`, t, parked - busDriveS(spot), leave, mirror, spot)
    if (b) cars.push(b)
  }
  // The ferry's setting off for here with school kids aboard: a bus comes
  // down to meet them (it leaves once they're all on — see unloadAt).
  if (isSchool(boarders(S, 'kid', v + 1))) {
    const spot = stopSpot(S, side, `busP${v + 1}`, 'school', busParks)
    const b = busTrip(`busP${v + 1}`, t, busParks - busDriveS(spot), Infinity, mirror, spot)
    if (b) cars.push(b)
  }
  nextKids.forEach((item, i) => {
    // School kids come out of the bus; tourists turn up on their own.
    const since = schoolDrop
      ? t - (busParks + kidOutAt(i, nextKids.length))
      : sigma - KID_ARRIVE(i, nextKids.length)
    if (since < 0) return
    const e = since * crowdV(item)
    const slot = crowdSpot(item, i)
    // School kids pile out of the bus; tourists amble down the road.
    const s = schoolDrop
      ? dropDoor + Math.sign(slot - dropDoor) * Math.min(e, Math.abs(slot - dropDoor))
      : Math.max(slot, TOURIST_START_S - e)
    if (puzzled && s === slot) return peds.push(lostPed(item, t, slot, mirror))
    if (s === slot) return peds.push(strollPed(item, t, slot, mirror, (i % 2) * 2))
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

  walkOffs(S, t, side, v, peds, cars, W)
  if (ferryHere) unloadAt(S, t, side, cars, peds, W)
}

// Who got off at visit v's dock (walk-on locals and tourists), and what each
// does about the bus. Times are on v's unload clock.
function walkOffPlan(S, v, side) {
  const key = `${v}:${side}`
  if (!S.plans.has(key)) S.plans.set(key, planWalkOffs(S, v, side))
  return S.plans.get(key)
}
function planWalkOffs(S, v, side) {
  const riders = []
  boarders(S, 'ped', v - 1).forEach((item, j) => {
    const start = PED_UNLOAD(j)
    riders.push({
      item,
      local: true,
      start,
      pace: PED_V,
      wants: takesBus(item, side, 101),
      arrive: start + (WALK_ON_LENGTH + STOP_WAIT) / PED_V,
    })
  })
  boarders(S, 'kid', v - 1).forEach((item, k) => {
    if (item.kid) return // school kids have their school bus
    const start = TOURIST_UNLOAD(k)
    const pace = touristPace(item)
    const dawdle = touristDawdle(item)
    riders.push({
      item,
      local: false,
      start,
      pace,
      dawdle,
      wants: true,
      arrive: start + WALK_ON_LENGTH / pace + dawdle + (STOP_WAIT - 10) / pace,
    })
  })
  const base = halfStartOf(S, v) + jamDelay(S, v)
  let leave = null
  if (side === 0 && !shuttleRuns(S, v)) {
    // After the last shuttle: some locals get a ride (waiting calmly for the
    // car); everyone else walks home, all the way up the hill, by torchlight.
    for (const r of riders) {
      if (r.local && rnd(seedOf(r.item.id), 103) < GETS_A_RIDE) {
        r.wants = true
        r.ride = true
        r.strandedAt = r.arrive
      } else {
        r.wants = false
        r.torch = true
      }
    }
  } else if (side === 0) {
    // Bowen shuttle: it goes as the cars start loading for the next sailing
    // (once the ones off this ferry have gone by). Tourists take the seats
    // first, then locals — whoever's at the stop by then.
    const park = shuttlePark(S, v) - base
    leave = Math.max(
      dockDelay(S, v) - jamDelay(S, v) + carLoad(S, v, 0),
      carsClearU(S, v, STOP_S),
      park + 1, // (and it stops a moment)
    )
    const byArrival = (a, b) => a.arrive - b.arrive
    const queue = [
      ...riders.filter((r) => r.wants && !r.local).sort(byArrival),
      ...riders.filter((r) => r.wants && r.local).sort(byArrival),
    ]
    let seats = SHUTTLE_SEATS
    for (const r of queue) {
      // (+0.6: along to the door and aboard)
      // (on once it's here — they wait in line for it if they're early)
      const on = Math.max(r.arrive, park)
      if (seats > 0 && on + 0.6 <= leave) {
        r.board = on
        seats--
      } else r.strandedAt = Math.max(r.arrive, leave)
    }
  } else {
    // Horseshoe Bay: whichever articulated bus is there when they get there.
    for (const r of riders) {
      if (!r.wants) continue
      const at = base + r.arrive
      let n = articBoard(S, at)
      // (none till the morning — the buses stop at midnight, and the ferry's
      // asleep — is no bus at all)
      if (n != null && (articPark(n) - at > 2 * ARTIC_EVERY || halfAt(S, articPark(n)).overnight))
        n = null
      if (n == null && r.local) {
        // no bus till morning: someone comes to fetch them
        r.ride = true
        r.strandedAt = r.arrive
      } else if (n == null)
        r.wants = false // (a tourist just wanders off)
      else if (articMissed(S, base + r.start, at) && r.local) r.strandedAt = r.arrive
      else {
        r.board = Math.max(at, articPark(n)) - base
        r.artic = n
      }
    }
  }
  // Stranded locals get fetched: a car sets off down after a moment's fuming
  // (staggered), pulls up beside them, and they hop in — up to CAR_SEATS to a
  // car, in the order they were stranded.
  const stranded = riders
    .filter((r) => r.strandedAt != null && r.local)
    .sort((a, b) => a.strandedAt - b.strandedAt)
  for (let g = 0; g * CAR_SEATS < stranded.length; g++) {
    const group = stranded.slice(g * CAR_SEATS, (g + 1) * CAR_SEATS)
    const wait = Math.max(...group.map((r) => r.strandedAt + (r.ride ? 0.4 : MAD_WAIT)))
    const carFrom = wait + g * 1.1
    const carAt = carFrom + (ROAD.length - STOP_WAIT) / PICKUP_V
    group.forEach((r, i) => {
      Object.assign(r, { carFrom, carAt, board: carAt + LOVE_S, bringsCar: i === 0 })
    })
  }
  return { riders, base, leave }
}

// One walk-off at unload-clock time u.
// `bus`: the door they're boarding by and when that bus goes (both on v's
// unload clock), if they're catching one. `slot`: their place in the line at
// the stop.
function walkOff(r, u, t, mirror, bus, slot = STOP_WAIT) {
  const e = u - r.start
  if (e < 0) return null
  const { item, pace } = r
  // Off the ferry and down the ramp…
  const ramp = WALK_ON_LENGTH / pace
  if (e < ramp) {
    const off = along([...WALK_ON].reverse(), e * pace)
    return off && ped(item, off.x, off.y, -1, e * 12, 1, mirror)
  }
  // (tourists dawdle at the foot of it first)
  let d = e - ramp
  if (!r.local) {
    if (d < r.dawdle) {
      const w = touristWander(t, item.id)
      const p = roadAt(Math.max(1, 10 + w.off * 0.8))
      return ped(
        item,
        p.x,
        p.y + LANE.walk,
        w.dir > 0 ? p.tx : -p.tx,
        w.moving ? t * 12 : 0,
        1,
        mirror,
      )
    }
    d -= r.dawdle
  }
  const from = r.local ? 0 : 10
  const s = from + d * pace
  // Walking home in the dark goes all the way up the hill.
  const gone = r.torch ? ROAD.length : r.local ? PED_GONE_S : TOURIST_GONE_S
  if (!r.wants || s < slot) {
    if (s > gone) return null
    const p = roadAt(s)
    const q = ped(item, p.x, p.y + LANE.walk, p.tx, e * 12, Math.min(1, (gone - s) / 40), mirror)
    // (the flashlight bobs up and down with their stride)
    return r.torch ? { ...q, torch: true, torchTilt: Math.sin(e * 6) * 7 } : q
  }
  // In line at the bus stop (shifting from foot to foot).
  const w = touristWander(t * (r.local ? 0.5 : 1), item.id)
  const spot = slot + w.off * 0.12
  if (r.board != null && u >= r.board) {
    // Boarding: along to the door and in. (In the car: just gone.)
    if (!bus || u >= bus.gone) return null
    const gap = bus.door - spot
    const walked = (u - r.board) * PED_V
    if (walked >= Math.abs(gap)) return null
    const q = roadAt(spot + Math.sign(gap) * walked)
    return ped(item, q.x, q.y + LANE.walk, gap > 0 ? q.tx : -q.tx, t * 12, 1, mirror)
  }
  const p = roadAt(spot)
  const facing = w.dir > 0 ? p.tx : -p.tx
  if (r.strandedAt != null && u >= r.strandedAt) {
    if (!r.local) {
      // A tourist who couldn't get on just wanders about, then off up the road.
      const on = u - r.strandedAt - 4
      if (on > 0) {
        const s2 = spot + on * pace
        if (s2 > gone) return null
        const q = roadAt(s2)
        return ped(item, q.x, q.y + LANE.walk, q.tx, t * 12, Math.min(1, (gone - s2) / 40), mirror)
      }
      return ped(item, p.x, p.y + LANE.walk, facing, w.moving ? t * 12 : 0, 1, mirror)
    }
    if (u >= r.carAt) return ped(item, p.x, p.y + LANE.walk, 1, 0, 1, mirror, 'love')
    // (a ride they'd arranged: just waiting)
    if (r.ride) return ped(item, p.x, p.y + LANE.walk, facing, 0, 1, mirror)
    const hop = Math.abs(Math.sin(u * 11 + seedOf(item.id))) * 6
    return ped(item, p.x, p.y + LANE.walk - hop, facing, 0, 1, mirror, 'mad')
  }
  return ped(item, p.x, p.y + LANE.walk, facing, w.moving && !r.local ? t * 12 : 0, 1, mirror)
}

// When the Bowen shuttle for visit w pulls in (scene time): as the ferry
// leaves Horseshoe Bay — once the previous run's been and gone.
function shuttlePark(S, w) {
  let prevLeave = -Infinity
  if (w - 2 >= 0 && shuttleRuns(S, w - 2)) {
    const prev = walkOffPlan(S, w - 2, 0)
    prevLeave = prev.base + prev.leave
  }
  const opens = bowenOpens(S, w) ?? -Infinity // (not before 5am)
  return Math.max(shuttleDue(S, w), prevLeave + 2 * transitDriveS() + 0.3, opens)
}
// When it's due: replaying, 10–15 minutes before the sailing's scheduled
// departure (by the simulated clock); otherwise as the ferry leaves Horseshoe
// Bay.
function shuttleDue(S, w) {
  const s = S.sampler?.sailing(w)
  if (!s || s.empty) return departsAt(S, w - 1)
  const [hh, mm] = s.time.split(':').map(Number)
  const day = Math.round(Date.parse(`${s.dateIso}T00:00:00Z`) / 86400000)
  const due = day * 1440 + hh * 60 + mm - (10 + rnd(w, 113) * 5)
  return whenClockReads(S, due, halfStartOf(S, w - 2), departsAt(S, w))
}
// If walk-on `item`, lining up for visit w on `side`, comes by bus: when they
// step off it at the stop (scene time), else null (they walk down the hill).
// Bowen: the shuttle drops them as it pulls in. Horseshoe Bay: one of the
// articulated buses that stops between the last sailing and this boarding.
function busDropOff(S, side, w, item) {
  if (!takesBus(item, side, 104)) return null
  const jitter = 0.4 + rnd(seedOf(item.id), 105) * 1.2
  if (side === 0) return shuttleRuns(S, w) ? shuttlePark(S, w) + jitter : null
  const from = departsAt(S, w - 2) + 0.5
  const until = halfStartOf(S, w) + dockDelay(S, w) + PED_LOAD(0) - 2
  const buses = []
  for (let n = Math.floor(from / ARTIC_EVERY); articPark(n) < until; n++)
    if (articPark(n) >= from && articRuns(S, n)) buses.push(n)
  if (!buses.length) return null
  const n = buses[Math.floor(rnd(seedOf(item.id), 106) * buses.length)]
  return articPark(n) + jitter
}

// Visit v's walk-offs, the buses that take them, and any rescue cars.
function walkOffs(S, t, side, v, peds, cars, W) {
  if (v < 0) return
  const mirror = side === 1 ? W : 0
  const plan = walkOffPlan(S, v, side)
  const u = t - plan.base
  // The bus each rider's catching: its door (a second section's for some, on
  // the articulated bus) and when it goes.
  const busFor = (r) => {
    if (r.board == null || r.carFrom != null) return null
    const [id, kind, park, leave] =
      side === 0
        ? [`shuttle${v}`, 'shuttle', shuttlePark(S, v), plan.base + plan.leave]
        : [`artic${r.artic}`, 'artic', articPark(r.artic), articLeave(S, r.artic)]
    const doors = busDoors(kind, stopSpot(S, side, id, kind, park))
    const door = doors[Math.floor(rnd(seedOf(r.item.id), 107) * doors.length)]
    return { door, gone: leave - plan.base }
  }
  // The line at the stop, in the order they got there: each one's place is
  // behind everyone ahead who's still waiting.
  const inLine = plan.riders
    .filter((r) => r.wants)
    .sort((a, b) => a.arrive - b.arrive || (a.item.id < b.item.id ? -1 : 1))
  const leavesLine = (r) =>
    r.board != null ? r.board : r.strandedAt != null ? r.strandedAt + 4 : Infinity
  // (as of `at`; someone who's left the line to board keeps the place they
  // left it from)
  const slotOf = (r, at = Math.min(u, leavesLine(r) - 1e-6)) => {
    const waiting = inLine.filter((q) => at < leavesLine(q))
    const gap = Math.min(LINE_GAP, (STOP_WAIT - LINE_END) / Math.max(1, waiting.length - 1))
    return STOP_WAIT - Math.max(0, waiting.indexOf(r)) * gap
  }
  if (u >= 0) {
    for (const r of plan.riders) {
      const q = walkOff(r, u, t, mirror, busFor(r), slotOf(r))
      if (q) peds.push(q)
      if (r.bringsCar && u >= r.carFrom) {
        // The rescue car: down the roadside, pause, back up the hill.
        const id = `rescue-${r.item.id}`
        const color = CAR_COLORS[Math.floor(rnd(seedOf(r.item.id), 102) * CAR_COLORS.length)]
        const spot = STOP_WAIT + 14 // (pulling up beside them)
        const drive = (ROAD.length - spot) / PICKUP_V
        let sPos
        let uphill = false
        if (u < r.carFrom + drive) sPos = ROAD.length - (u - r.carFrom) * PICKUP_V
        else if (u < r.board + 0.2) sPos = spot
        else {
          sPos = spot + (u - r.board - 0.2) * PICKUP_V
          uphill = true
        }
        if (sPos < ROAD.length) {
          const p = roadAt(sPos)
          const [dx, dy] = uphill ? [p.tx, p.ty] : [-p.tx, -p.ty]
          // Home again in the uphill lane, like everyone else leaving.
          const lane = uphill
            ? mixLane(stopLane(), LANE.out, (sPos - spot) / LANE_SWAP)
            : stopLane()
          cars.push({ ...car({ id, color }, 'rescue', p.x, p.y + lane, dx, dy, mirror) })
        }
      }
    }
  }
  if (side === 0) {
    // The Bowen shuttle for this arrival, and the one coming for the next.
    for (const w of [v, v + 2]) {
      if (!shuttleRuns(S, w)) continue // (after the last one of the day)
      const pw = w === v ? plan : walkOffPlan(S, w, 0)
      const park = shuttlePark(S, w)
      const spot = stopSpot(S, side, `shuttle${w}`, 'shuttle', park)
      cars.push(
        ...transitTrip(
          `shuttle${w}`,
          'shuttle',
          t,
          park,
          pw.base + pw.leave,
          mirror,
          SHUTTLE_PARTS,
          spot,
        ),
      )
    }
  } else {
    // The articulated bus, on its own timetable.
    const n = Math.floor(t / ARTIC_EVERY)
    for (const k of [n - 1, n, n + 1].filter((k) => articRuns(S, k)))
      cars.push(
        ...transitTrip(
          `artic${k}`,
          'artic',
          t,
          articPark(k),
          articLeave(S, k),
          mirror,
          ARTIC_PARTS,
          stopSpot(S, side, `artic${k}`, 'artic', articPark(k)),
        ),
      )
  }
}

// Arrivals leave the ferry (on the unload clock): cars nearest the dock
// first, then the walk-offs, all heading up the road.
function unloadAt(S, t, side, cars, peds, W) {
  const mirror = side === 1 ? W : 0
  const { h: v, tauU: sigma, tauC } = halfAt(S, t)
  boarders(S, 'car', v - 1).forEach((item, i) => {
    const start = CAR_UNLOAD(i)
    if (tauC < start) return // (still waiting for the tourists to clear)
    const route = deckPath(BERTH - FAR_SLOTS[i]).reverse()
    const e = (tauC - start) * CAR_V
    const at = along(route, e)
    if (at) {
      cars.push(car(item, 'out', at.x, at.y, at.dx, at.dy, mirror))
    } else if (e - pathLength(route) < ROAD.length) {
      const p = roadAt(e - pathLength(route))
      cars.push(car(item, 'out', p.x, p.y + LANE.out, p.tx, p.ty, mirror))
    }
  })
  // (walk-on locals and tourists: see walkOffs — they may wait for a bus)
  const arriving = boarders(S, 'kid', v - 1)
  const school = isSchool(arriving)
  const spot = school ? stopSpot(S, side, `busP${v - 1}`, 'school', departsAt(S, v - 1)) : STOP_S
  arriving.forEach((item, k) => {
    if (!item.kid) return
    const e = (sigma - KID_UNLOAD(k)) * crowdV(item)
    const gone = item.kid ? PED_GONE_S : TOURIST_GONE_S
    if (e < 0 || e > gone + WALK_ON_LENGTH) return
    const off = along([...WALK_ON].reverse(), e)
    if (off) return peds.push(ped(item, off.x, off.y, -1, e, 1, mirror))
    const s = e - WALK_ON_LENGTH
    if (school && s >= busDoors('school', spot)[0]) return // on the bus
    const p = roadAt(s)
    peds.push(ped(item, p.x, p.y + LANE.walk, p.tx, e, Math.min(1, (gone - s) / 40), mirror))
  })
  if (school) {
    // The bus that met them waits until the last kid's aboard, then goes.
    const b = busTrip(`busP${v - 1}`, sigma, -Infinity, busLeaves(S, v), mirror, spot)
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
  const underway = tau >= departAfter(S, h)
  const c = tau - departAfter(S, h)
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
  const { h, tau: tauRaw, tauU, tauC, tauE: tau, overnight } = halfAt(S, t)
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
    if (tauC < CAR_UNLOAD(i))
      deck.push({ id: item.id, dx: -sign * FAR_SLOTS[i], color: item.color })
  })
  boarders(S, 'car', h).forEach((item, k) => {
    if (carBoarded(S, h, tau, k))
      deck.push({ id: item.id, dx: sign * FAR_SLOTS[k], color: item.color })
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
    if (kidBoarded(tau, k, item)) riders.push(riderAt(item, sign * kidSpot(k, kidsOn.length)))
  })

  // Each dock's ramp: lowered onto the ferry while it's berthed there,
  // raised a moment before it leaves and while it's away.
  const ramps = [0, 1].map((d) => {
    let down =
      d === side && !moving ? Math.min(1, tauU / 0.15, (departAfter(S, h) - tau) / 0.25) : 0
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
    // Buses arriving/parked (drawn in front) vs pulling away in the far lane
    // (drawn behind the waiting cars).
    buses: cars.filter((c) => c.lane === 'bus' && !c.leaving),
    transit: cars.filter((c) => c.lane === 'transit' && !c.leaving),
    busesLeaving: cars.filter((c) => (c.lane === 'bus' || c.lane === 'transit') && c.leaving),
    rescues: cars.filter((c) => c.lane === 'rescue'),
    carsIn: cars.filter((c) => c.lane === 'in'),
    peds,
  }
}

// --- The simulated clock -----------------------------------------------------
// Replaying real days, each departure happens at its real (actual) time, so
// the clock at scene time t interpolates between the departures either side.
// Returns { minutes (since the epoch, simulated), rate (scene seconds per
// simulated second) }, or null without a replay.
function sailingMinutes(S, h) {
  const s = S.sampler?.sailing(h)
  if (!s) return null
  const [hh, mm] = s.time.split(':').map(Number)
  const day = Math.round(Date.parse(`${s.dateIso}T00:00:00Z`) / 86400000)
  return day * 1440 + hh * 60 + mm + Math.max(0, s.lateMin ?? 0)
}
function simClock(S, t) {
  if (!S.sampler) return null
  // A picked date opens at 4am, running up to its first sailing from Bowen
  // (half 0) — not on from the previous day's last sailing.
  const dawn = S.sampler.opensAt
  if (dawn != null && t < departsAt(S, 0)) {
    const [t1, m1] = [departsAt(S, 0), sailingMinutes(S, 0)]
    if (m1 != null && m1 > dawn) {
      const u = Math.max(0, t) / t1
      return { minutes: dawn + (m1 - dawn) * u, rate: t1 / ((m1 - dawn) * 60) }
    }
  }
  let { h } = halfAt(S, t)
  if (departsAt(S, h) > t) h -= 1
  const [t0, t1] = [departsAt(S, h), departsAt(S, h + 1)]
  const m0 = sailingMinutes(S, h)
  let m1 = sailingMinutes(S, h + 1)
  if (m0 == null) return null
  // (gappy data: if the next departure isn't later, assume a usual gap)
  if (m1 == null || m1 <= m0) m1 = m0 + 35
  const u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)))
  return { minutes: m0 + (m1 - m0) * u, rate: (t1 - t0) / ((m1 - m0) * 60) }
}

// The scene time (between lo and hi) at which the simulated clock reaches
// `minutes` — the clock only runs forwards between departures.
function whenClockReads(S, minutes, lo, hi) {
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if ((simClock(S, mid)?.minutes ?? Infinity) < minutes) lo = mid
    else hi = mid
  }
  return hi
}
// Bowen wakes up at 5am: nobody (cars, the shuttle, walk-ons) turns up for
// the day's first sailing from Bowen (visit v) before then. Scene time of
// 5:00 that morning, or null if v isn't a day's first Bowen visit.
const BOWEN_OPENS = 5 * 60
function bowenOpens(S, v) {
  if (S.sampler?.dayIndex(v) !== 1) return null
  const s = S.sampler.sailing(v)
  if (!s) return null
  const day = Math.round(Date.parse(`${s.dateIso}T00:00:00Z`) / 86400000)
  return whenClockReads(S, day * 1440 + BOWEN_OPENS, halfStartOf(S, v - 2), departsAt(S, v))
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
// `seed` varies the random breakdowns and whales between openings (the tests
// keep the default, 0, so they're repeatable).
export function createGoatScene({ sampler = null, seed = 0 } = {}) {
  const S = {
    seed,
    lines: { car: new Map(), ped: new Map(), kid: new Map() },
    spots: new Map(), // where each bus stops at the bus stop (stopSpot)
    plans: new Map(), // who does what off each ferry (walkOffPlan)
    starts: [0],
    trouble: new Map(),
    sampler,
  }
  const frame = (t, W = WORLD_W) => sceneFrame(S, t, W)
  frame.halfStart = (h) => halfStartOf(S, h)
  frame.clock = (t) => simClock(S, t)
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
// How much later than the sailing before counts as a sudden jump.
const LATE_JUMP = 12
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
// next recorded day. It starts on a random day at a random point — or, with
// { date: 'YYYY-MM-DD' }, on that day first thing in the morning (its first
// sailing from Bowen); { schoolDay: true } limits the random pick to school
// days (a weekday, September–June) and { startAt: 'HH:MM' } joins at the
// first sailing from then on. `days` lists the dates it can replay.
// lastCapacity is "Full", "Not Full" or "NN%" = space *left*.
// Returns null when no day has enough data. `pick` supplies the randomness
// (0..1, injectable for tests).
// Wall-clock minutes at the terminal for a timestamp, counted like the
// simulated clock: days since the epoch × 1440 + minutes into the day.
const VANCOUVER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
function terminalMinutes(ms) {
  const f = Object.fromEntries(VANCOUVER.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  const day = Date.UTC(+f.year, +f.month - 1, +f.day) / 86400000
  return day * 1440 + +f.hour * 60 + +f.minute + (ms % 60000) / 60000
}

export function seasonSampler(
  docs,
  pick = Math.random,
  { schoolDay = false, startAt = null, date = null } = {},
) {
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
  const isSchoolDay = ({ dateIso }) => {
    const date = new Date(`${dateIso}T12:00:00Z`)
    const month = date.getUTCMonth() + 1
    const weekday = date.getUTCDay()
    return month !== 7 && month !== 8 && weekday !== 0 && weekday !== 6
  }
  const choices = schoolDay && days.some(isSchoolDay) ? days.filter(isSchoolDay) : days
  const chosen =
    days.find((d) => d.dateIso === date) ??
    choices[Math.min(choices.length - 1, Math.floor(pick() * choices.length))]
  const k0 = days.indexOf(chosen)
  const dayOf = (k) => days[mod(k, days.length)]
  // Local index i within a day: even → its (i/2)th "To Bowen", odd → its
  // ((i-1)/2)th "To HSB". Half 0 is always a Bowen visit, so the first
  // day's start (starts[0]) must be odd.
  let firstI = 2 * Math.floor(pick() * (dayOf(k0).halves / 2))
  if (startAt) {
    const { sides, halves } = dayOf(k0)
    const timeOf = (i) => sides[i % 2 ? 0 : 1][Math.floor(i / 2)]?.sailingTime ?? ''
    const i = [...Array(halves).keys()].find((j) => timeOf(j) >= startAt)
    // Line the first sailing at/after startAt up with half 0 (a Bowen visit)
    // or half 1 (mainland).
    if (i != null) firstI = i % 2 ? i + 1 : i
  }
  // A picked date starts first thing: its first sailing from Bowen (local
  // index 1) at half 0 — the empty run before it is never shown.
  if (date && chosen.dateIso === date) firstI = 2
  const starts = [1 - firstI]
  function dayAt(h) {
    // Before the day we join: the previous recorded day's last sailings.
    if (h < starts[0])
      return { k: k0 - 1, i: mod(h - starts[0], dayOf(k0 - 1).halves), start: null }
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
    // A picked date's replay starts at 4am (simulated-clock minutes).
    opensAt:
      date && chosen.dateIso === date
        ? (Date.parse(`${date}T00:00:00Z`) / 86400000) * 1440 + 4 * 60
        : null,
    days: days.map((d) => d.dateIso),
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
        // Tourists over in the morning, home in the afternoon — and on any
        // summer sailing that ran noticeably late (they were the hold-up).
        if (d.direction === 'To Bowen' && hour >= 7 && hour < 12) return 'tourists'
        if (d.direction === 'To HSB' && hour >= 13 && hour < 19) return 'tourists'
        if ((minutesLate(d) ?? 0) >= 8) return 'tourists'
        return null
      }
      const weekday = date.getUTCDay()
      if (weekday === 0 || weekday === 6) return null
      if (d.direction === 'To HSB' && d.sailingTime === '07:30') return 'kids'
      if (d.direction === 'To Bowen' && d.sailingTime === '15:55') return 'kids'
      return null
    },
    // Why sailing v ran late, if a breakdown's the story: a sudden jump —
    // LATE_JUMP minutes or more later than the sailing before it (the
    // other way). Half the time its ramp jammed as it arrived ('jam'), else
    // it broke down at sea on the way in ('sea').
    lateCause(v) {
      const d = sailingFor(v)
      if (!d || dayAt(v).i === 0) return null
      const late = minutesLate(d) ?? 0
      const before = Math.max(0, dayAt(v).i > 1 ? (minutesLate(sailingFor(v - 1)) ?? 0) : 0)
      if (late - before < LATE_JUMP) return null
      return rnd(v, 81) < 0.5 ? 'jam' : 'sea'
    },
    // Visit v's position in its day (0 = the empty first run, 1 = the first
    // sailing from Bowen, …).
    dayIndex: (v) => dayAt(v).i,
    // Visit v is a day's empty first run (Horseshoe Bay → Bowen).
    emptyRun: (v) => dayAt(v).i === 0,
    // Half h is the first of a new day (so the night before it is slept).
    isDayStart(h) {
      if (h <= 0) return false
      const { i, start } = dayAt(h)
      // (not the day we join at — no night before the replay even starts)
      return i === 0 && start !== null && start !== starts[0]
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
          // when its line reached the crosswalk (simulated-clock minutes)
          crosswalkAt: d.crosswalkFullAt ? terminalMinutes(Number(d.crosswalkFullAt)) : null,
        }
      )
    },
  }
}
