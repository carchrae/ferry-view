// Bowen hilltop wildlife for the GOATs scene — a pure function of time, in
// the hill's own coordinates (hillY gives the ground height at x).
//
// A small herd (doe, buck, fawn) grazes on the open slope past the trees; a
// cougar lives at the tree line and a black bear in the forest. Every
// CYCLE_S seconds a different story plays out (picked per cycle):
//   chase    the cougar stalks out of the trees, the herd bolts away from it
//            down the slope and out of sight behind the far trees, the
//            cougar sprinting after; later it slinks back, then they do
//   spotted  the cougar creeps up but the deer spot it and freeze, the buck
//            stamps, and the cougar slinks back into the trees
//   quiet    the cougar dozes curled up in the trees; the fawn frolics
//   bear     the bear wanders out, rears up to sniff, and the herd trots off
//            down the slope until it's gone back
// Between visits the bear ambles through the forest, stopping now and then
// to rear up and sniff the air.

const CYCLE_S = 26
const HIDE_X = 95 // the cougar's spot at the edge of the trees
const BEAR_HOME = 55
const GONE_X = 250 // behind the far clump of trees, down the slope
const FADE_FROM = 222 // they fade out as they pass behind those trees
const fadeAt = (x) => Math.max(0, Math.min(1, (GONE_X - x) / (GONE_X - FADE_FROM)))
// The herd: where each grazes, how big it is, whether it has antlers.
const HERD = [
  { id: 'doe', x: 160, size: 1, antlers: false, seed: 1 },
  { id: 'buck', x: 180, size: 1.12, antlers: true, seed: 2 },
  { id: 'fawn', x: 146, size: 0.68, antlers: false, seed: 3 },
]

function rnd(n, salt) {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}
const clamp01 = (u) => Math.max(0, Math.min(1, u))
const lerp = (a, b, u) => a + (b - a) * clamp01(u)

export function cycleKind(n) {
  const r = rnd(n, 91)
  return r < 0.4 ? 'chase' : r < 0.65 ? 'spotted' : r < 0.85 ? 'quiet' : 'bear'
}

// Each deer this frame: x, facing, lift (a hop), head pose, gait.
function herdAt(t, kind, c) {
  return HERD.map((d, i) => {
    const lag = i * 0.25 // they don't all move at once
    let x = d.x + Math.sin(t * 0.13 + d.seed) * 4 // slow drift while grazing
    let face = Math.sin(t * 0.09 + d.seed * 2) > 0 ? 1 : -1
    let lift = 0
    let alert = false
    let gait = 'stand'
    if (kind === 'chase') {
      // Bolting away from the cougar (it comes from the trees on the left).
      if (c >= 10 + lag && c < 13.5) {
        x = lerp(d.x, GONE_X + 10, (c - 10 - lag) / 2.2)
        face = 1
        lift = Math.abs(Math.sin(c * 11 + i)) * 5 * d.size
        gait = 'run'
      } else if (c >= 13.5 && c < 21 + lag) x = GONE_X + 10
      else if (c >= 21 + lag) {
        x = lerp(GONE_X, d.x, (c - 21 - lag) / 4)
        face = -1
        gait = 'walk'
      } else alert = c > 8.5
    } else if (kind === 'spotted') {
      alert = c >= 7 && c < 14
      if (alert) face = -1 // staring at the tree line
      if (d.antlers && c >= 8 && c < 11) lift = Math.max(0, Math.sin(c * 9)) * 2.5 // stamping
    } else if (kind === 'bear') {
      if (c >= 6 + lag && c < 18) {
        x = lerp(d.x, d.x + 45, (c - 6 - lag) / 2)
        face = c < 8 + lag ? 1 : -1
        alert = true
        gait = c < 8 + lag ? 'run' : 'stand'
        if (gait === 'run') lift = Math.abs(Math.sin(c * 10 + i)) * 3
      } else if (c >= 18) {
        x = lerp(d.x + 45, d.x, (c - 18 - lag) / 5)
        face = -1
        gait = c < 23 + lag ? 'walk' : 'stand'
      }
    } else if (kind === 'quiet' && d.id === 'fawn') {
      // the fawn skips about
      x += Math.sin(t * 0.7) * 10
      face = Math.cos(t * 0.7) > 0 ? 1 : -1
      lift = Math.max(0, Math.sin(t * 6)) * 3
      gait = 'walk'
    }
    // Head: grazing (down) with a look around now and then; up when alert
    // or on the move.
    const look = Math.max(0, Math.sin(t * 0.7 + d.seed * 1.9)) ** 3
    const up = alert || gait !== 'stand' ? 1 : look
    const stride = Math.sin(t * (gait === 'run' ? 22 : 8) + i)
    return { ...d, x, face, lift, up, gait, stride }
  })
}

function cougarAt(t, kind, c) {
  let x = HIDE_X
  let face = 1
  let pose = 'crouch'
  if (kind === 'chase') {
    if (c < 10) x = HIDE_X + (c / 10) * 40
    else if (c < 13.5) {
      // sprinting after the herd, a length behind the last of them
      x = lerp(HIDE_X + 40, GONE_X + 10, (c - 10.4) / 2.4)
      pose = 'sprint'
    } else if (c < 16) x = GONE_X + 10
    else if (c < 21) {
      // gave up: slinking back to the trees ahead of the herd's return
      x = lerp(GONE_X, HIDE_X, (c - 16) / 4.5)
      face = -1
      pose = 'walk'
    }
  } else if (kind === 'spotted') {
    if (c < 8) x = HIDE_X + (c / 8) * 38
    else if (c < 11)
      x = HIDE_X + 38 // frozen, found out
    else {
      x = lerp(HIDE_X + 38, HIDE_X - 10, (c - 11) / 4)
      face = -1
      pose = 'walk'
    }
  } else if (kind === 'quiet') {
    x = HIDE_X - 18
    pose = 'sleep'
  } else {
    // bear visit: keeps its distance in the trees
    x = HIDE_X - 25 + Math.sin(t * 0.3) * 4
    face = Math.cos(t * 0.3) >= 0 ? 1 : -1
    pose = 'walk'
  }
  return { x, face, pose, breathe: 1 + Math.sin(t * 2) * 0.05 }
}

function bearAt(t, kind, c) {
  if (kind === 'bear') {
    let x
    let pose = 'walk'
    let face = 1
    if (c < 6) x = lerp(BEAR_HOME, 140, c / 6)
    else if (c < 11) {
      x = 140
      pose = 'stand' // rearing up to sniff the air
    } else if (c < 18) {
      x = 140 + Math.sin((c - 11) * 0.6) * 4
      pose = 'sniff'
    } else {
      x = lerp(140, BEAR_HOME, (c - 18) / 7)
      face = -1
    }
    return { x, face, pose, step: pose === 'walk' ? Math.sin(t * 5) : 0 }
  }
  // Ambling back and forth in the forest; when it pauses, sometimes rears up.
  const b = Math.sin(t * 0.12)
  const moving = Math.abs(Math.cos(t * 0.12)) > 0.25
  const pauseN = Math.floor((t * 0.12) / Math.PI) // which pause this is
  const pose = moving ? 'walk' : rnd(pauseN, 93) < 0.5 ? 'stand' : 'sniff'
  return {
    x: BEAR_HOME + 40 * b,
    face: Math.cos(t * 0.12) >= 0 ? 1 : -1,
    pose,
    step: moving ? Math.sin(t * 5) : 0,
  }
}

// Everything on the hilltop at time t. `hillY(x)` is the ground height.
export function wildlifeAt(t, hillY) {
  const n = Math.floor(t / CYCLE_S)
  const c = t - n * CYCLE_S
  const kind = cycleKind(n)
  const at = (x, lift = 0) =>
    `translate(${x.toFixed(1)} ${(hillY(Math.max(0, x)) - lift).toFixed(1)})`

  const deer = herdAt(t, kind, c).map((d) => {
    const head = { x: 8.5 + d.up, y: -3 - d.up * 12 }
    const s = d.stride
    const legs =
      d.gait === 'run'
        ? `M-5 -6 L${(-9 - s * 2).toFixed(1)} -1 M-3 -6 L${(-6 - s * 2).toFixed(1)} 0 M3.5 -6 L${(7 + s * 2).toFixed(1)} -1 M5.5 -6 L${(9 + s * 2).toFixed(1)} 0`
        : d.gait === 'walk'
          ? `M-5 -6 L${(-5.5 + s * 0.9).toFixed(1)} 0 M-3 -6 L${(-3 - s * 0.9).toFixed(1)} 0 M3.5 -6 L${(3.5 - s * 0.9).toFixed(1)} 0 M5.5 -6 L${(6 + s * 0.9).toFixed(1)} 0`
          : 'M-5 -6 L-5.5 0 M-3 -6 L-3 0 M3.5 -6 L3.5 0 M5.5 -6 L6 0'
    return {
      id: d.id,
      opacity: fadeAt(d.x),
      transform: `${at(d.x, d.lift)} scale(${d.face * d.size} ${d.size})`,
      legs,
      neck: `M5 -9.5 L${(head.x - 1.2).toFixed(1)} ${(head.y + 0.6).toFixed(1)}`,
      head,
      antlers: d.antlers
        ? `M${head.x - 0.5} ${head.y - 1.2} l -1.5 -4 l -1.5 -1 M${head.x - 1.6} ${head.y - 3.6} l 1.2 -1.8 M${head.x + 0.4} ${head.y - 1.2} l 0.6 -4.2 l 1.4 -1`
        : null,
    }
  })

  const cg = cougarAt(t, kind, c)
  const cougar = {
    opacity: fadeAt(cg.x),
    transform: `${at(cg.x)} scale(${cg.face} 1)`,
    body:
      cg.pose === 'sleep'
        ? `translate(0 1.5) scale(1 ${(0.55 * cg.breathe).toFixed(3)})`
        : cg.pose === 'crouch'
          ? 'scale(1 0.8)'
          : cg.pose === 'sprint'
            ? 'scale(1.1 0.85)'
            : '',
    asleep: cg.pose === 'sleep',
  }

  const br = bearAt(t, kind, c)
  const bs = br.step
  const bear = {
    transform: `${at(br.x)} scale(${br.face} 1)`,
    // Standing: the whole bear rocks back onto its hind legs.
    body: br.pose === 'stand' ? 'rotate(-62 -7 0)' : br.pose === 'sniff' ? 'rotate(-8 -7 0)' : '',
    legs: `M-6 -4 L${(-6 + bs).toFixed(1)} 0 M-2 -4 L${(-2 - bs).toFixed(1)} 0 M4 -4 L${(4 - bs).toFixed(1)} 0 M7 -4 L${(7 + bs).toFixed(1)} 0`,
  }

  return { kind, deer, cougar, bear }
}
