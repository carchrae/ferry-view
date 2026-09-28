import { Dialog } from 'quasar'
import { scoreSailing, scoreCrosswalk } from '../../functions/lib/leaderboard-score.js'

// Loot-box feedback for recording a capacity tag / full-to-crosswalk time:
// a synthesized "kerching" plus a fireworks burst and a floating "+N pt"
// label, all scaled to the leaderboard credits the tag earns (see
// leaderboard-score.js) — a first report gets the jackpot, a redundant
// agreement gets a modest plink:
//   >= 1.0  jackpot — coin kerching + sparkle arpeggio, triple burst
//   >= 0.5  nice    — coin chime, single burst
//   <  0.5  plink   — soft blip, a few sparkles
// Sounds are Web Audio oscillators (no assets); visuals are Web Animations
// API on throwaway divs (no CSS/deps). Runs only from click handlers, so the
// AudioContext is always allowed to start.

// What the new report would earn given the other reports already on the
// sailing, per the real scoring model. Approximate by nature — later reports
// can re-resolve a dispute — but matches what the leaderboard would show now.
export function estimateCredits(otherReports, mine) {
  try {
    const { credits } = scoreSailing([...(otherReports || []), mine])
    return credits.get(mine.userUid) ?? 0.1
  } catch {
    return 0.1
  }
}

// Same, for a full-to-crosswalk mark (scored by 5-minute time bucket).
export function estimateCrosswalkCredits(otherMarks, mine) {
  try {
    const { credits } = scoreCrosswalk([...(otherMarks || []), mine])
    return credits.get(mine.userUid) ?? 0.1
  } catch {
    return 0.1
  }
}

// --- Effects preference --------------------------------------------------
// 'on'/'off' in localStorage; unset means the rider was never asked (effects
// default on). After the 3rd tag of a session — session count only, prior
// sessions aren't tracked — we ask once whether to keep them; the answer can
// be changed anytime on the profile page.

const EFFECTS_KEY = 'celebrationEffects'

export function effectsEnabled() {
  try {
    return localStorage.getItem(EFFECTS_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setEffectsEnabled(on) {
  try {
    localStorage.setItem(EFFECTS_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode — the session just keeps the default */
  }
}

function effectsChosen() {
  try {
    return localStorage.getItem(EFFECTS_KEY) != null
  } catch {
    return true
  }
}

let sessionTagCount = 0

// One-time explainer shown on a rider's very first report (any session —
// tracked in localStorage). Marked as shown immediately, so it appears once.
const EXPLAINED_KEY = 'reportingExplained'
let explainedThisSession = false

function maybeExplainReporting() {
  if (explainedThisSession) return
  explainedThisSession = true
  try {
    if (localStorage.getItem(EXPLAINED_KEY)) return
    localStorage.setItem(EXPLAINED_KEY, 'yes')
  } catch {
    /* private mode — the session flag above still limits it to once */
  }
  Dialog.create({
    title: 'Your first report — thanks!',
    message:
      'Your report is now attached to this sailing with your name, and it earns ' +
      'leaderboard points. Tapped the wrong answer? Just tap another one — only your ' +
      'latest report counts. You can also remove your report with the X on your chip ' +
      'in the Reports row. When riders disagree, the answer most riders back wins.',
    ok: { label: 'Got it', color: 'primary', noCaps: true },
  })
}

function askAboutEffects() {
  Dialog.create({
    title: 'Keep the fireworks?',
    message:
      "You've tagged 3 sailings — want to keep the celebration fireworks and sound? " +
      'You can change this anytime on your profile page.',
    ok: { label: 'Keep them', color: 'primary', noCaps: true },
    cancel: { label: 'Turn off', flat: true, noCaps: true },
  })
    .onOk(() => setEffectsEnabled(true))
    .onCancel(() => setEffectsEnabled(false))
}

export function celebrate(credits, { label } = {}) {
  maybeExplainReporting()
  // Dismissing the dialog without choosing stores nothing, so the next
  // session's 3rd tag asks again.
  sessionTagCount++
  if (sessionTagCount === 3 && !effectsChosen()) askAboutEffects()
  if (!effectsEnabled()) return

  const tier = credits >= 1 ? 'jackpot' : credits >= 0.5 ? 'nice' : 'plink'
  try {
    playSound(tier)
  } catch {
    /* no audio is never worth breaking the tag flow */
  }
  try {
    showEffects(tier, label === undefined ? `+${formatCredits(credits)} pt` : label)
  } catch {
    /* ditto */
  }
}

function formatCredits(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// --- sound ---------------------------------------------------------------

let audioCtx = null
function getCtx() {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  if (!audioCtx) audioCtx = new AC()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

// Slot-machine bell "ding": a bright square hit doubled by a quieter sine an
// octave up, which reads as the metallic ring of a payout bell.
function ding(f, at, d, g = 0.045) {
  return [
    { f, at, d, g, type: 'square' },
    { f: f * 2, at, d: d * 1.3, g: g * 0.5, type: 'sine' },
  ]
}

// C6 / E6 / G6 / C7 / E7 / G7 — a bright major arpeggio, like a payout bell
// run up the machine.
const C6 = 1046.5
const E6 = 1318.51
const G6 = 1567.98
const C7 = 2093.0
const E7 = 2637.02
const G7 = 3135.96

const SOUNDS = {
  // Rapid ding-ding-ding-ding! up the arpeggio, then the prize bells ring out
  // on top with a lingering shimmer.
  jackpot: [
    ...ding(C6, 0, 0.14),
    ...ding(E6, 0.07, 0.14),
    ...ding(G6, 0.14, 0.14),
    ...ding(C7, 0.21, 0.16),
    ...ding(E7, 0.31, 0.34, 0.05),
    ...ding(G7, 0.43, 0.3, 0.035),
  ],
  // A three-bell mini payout.
  nice: [...ding(C6, 0, 0.12), ...ding(E6, 0.08, 0.12), ...ding(G6, 0.16, 0.24)],
  // One modest ding.
  plink: ding(E6, 0, 0.14, 0.035),
}

function playSound(tier) {
  const ctx = getCtx()
  if (!ctx) return
  const t0 = ctx.currentTime
  for (const { f, at, d, type = 'square', g = 0.08 } of SOUNDS[tier]) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(f, t0 + at)
    gain.gain.setValueAtTime(0.0001, t0 + at)
    gain.gain.exponentialRampToValueAtTime(g, t0 + at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0 + at)
    osc.stop(t0 + at + d + 0.05)
  }
}

// --- visuals -------------------------------------------------------------

// Bursts erupt where the user tapped (tracked passively) — falls back to the
// viewport centre before any interaction.
let lastTap = null
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      lastTap = { x: e.clientX, y: e.clientY }
    },
    { capture: true, passive: true },
  )
}

const EFFECTS = {
  jackpot: { bursts: 5, particles: 26, distance: 220, labelSize: 34 },
  nice: { bursts: 2, particles: 18, distance: 140, labelSize: 24 },
  plink: { bursts: 1, particles: 10, distance: 70, labelSize: 16 },
}

// Every spark gets its own fully-saturated random hue — a proper multicolour
// firework rather than a fixed palette.
function sparkColor() {
  return `hsl(${Math.floor(rand(0, 360))}, 100%, ${Math.floor(rand(55, 70))}%)`
}

function showEffects(tier, label) {
  if (typeof document === 'undefined') return
  const { bursts, particles, distance, labelSize } = EFFECTS[tier]
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const origin = lastTap || { x: window.innerWidth / 2, y: window.innerHeight / 2 }

  const layer = document.createElement('div')
  layer.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;'
  document.body.appendChild(layer)

  if (label) floatLabel(layer, origin, label, labelSize)
  if (!reduced) {
    for (let b = 0; b < bursts; b++) {
      // First shell bursts at the tap; jackpot follow-ups launch all over the
      // upper part of the screen like a real display, smaller tiers stay near
      // the tap.
      const at =
        b === 0
          ? origin
          : tier === 'jackpot'
            ? {
                x: rand(0.15, 0.85) * window.innerWidth,
                y: rand(0.12, 0.55) * window.innerHeight,
              }
            : { x: origin.x + rand(-110, 110), y: origin.y + rand(-90, 30) }
      setTimeout(() => burst(layer, at.x, at.y, particles, distance), b * 180)
    }
  }
  setTimeout(() => layer.remove(), bursts * 180 + 1900)
}

function burst(layer, x, y, count, distance) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    const size = rand(6, 12)
    const color = sparkColor()
    // The glow (box-shadow in the spark's own colour) is what makes it read
    // as a firework instead of moving confetti.
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:50%;background:${color};box-shadow:0 0 ${size}px ${size / 2}px ${color};`
    layer.appendChild(p)
    const angle = (i / count) * 2 * Math.PI + rand(-0.2, 0.2)
    const dist = distance * rand(0.55, 1)
    p.animate(
      [
        { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * dist * 0.75}px), calc(-50% + ${
            Math.sin(angle) * dist * 0.75
          }px)) scale(1)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          // gravity pulls the sparks down as they die out
          transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${
            Math.sin(angle) * dist + dist * 0.45
          }px)) scale(0.3)`,
          opacity: 0,
        },
      ],
      { duration: rand(950, 1500), easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)', fill: 'forwards' },
    )
  }
}

function floatLabel(layer, origin, text, size) {
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText = `position:absolute;left:${origin.x}px;top:${origin.y - 14}px;transform:translate(-50%,-50%);font-weight:700;font-size:${size}px;color:#ffb300;text-shadow:0 1px 3px rgba(0,0,0,0.45);white-space:nowrap;`
  layer.appendChild(el)
  el.animate(
    [
      { transform: 'translate(-50%,-50%) scale(0.5)', opacity: 0 },
      { transform: 'translate(-50%,-90%) scale(1.15)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%,-160%) scale(1)', opacity: 0 },
    ],
    { duration: 1100, easing: 'ease-out', fill: 'forwards' },
  )
}

function rand(min, max) {
  return min + Math.random() * (max - min)
}

// --- GOAT party ----------------------------------------------------------
// Looping fireworks + a deliberately cheesy chiptune stadium anthem (an
// original tune, not a cover) while the leaderboard's "Bowen GOATs" panel is
// open. Returns a stop() that silences and clears everything. Honours the
// effects preference; fireworks also skip under prefers-reduced-motion.
//
// Browsers keep audio locked until the user interacts with the page — e.g.
// when the party opens straight from a link. The anthem then waits for the
// AudioContext to run; onSoundBlocked(true/false) reports the lock, and
// stop.unlockSound() (call it from a click) lifts it. stop.setMuted(bool)
// silences/restores the anthem; start muted with { muted: true }.

const NOTE = { A2: 110, C3: 130.81, F2: 87.31, G2: 98, E4: 329.63, F4: 349.23, G4: 392 }
Object.assign(NOTE, { A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46 })

// Lead line as "note:eighths", one bar per string (I–vi–IV–V, twice, big finish).
const ANTHEM_LEAD = [
  'E4:2 G4:2 C5:3 B4:1',
  'A4:4 E4:2 A4:2',
  'F4:2 A4:2 C5:2 D5:2',
  'D5:4 B4:2 G4:2',
  'E5:3 D5:1 C5:2 G4:2',
  'A4:2 C5:2 F5:4',
  'E5:2 D5:2 C5:2 D5:2',
  'C5:8',
]
  .join(' ')
  .split(' ')
  .map((s) => s.split(':'))
// Bass root per half bar, pumped as eighth notes.
const ANTHEM_BASS = 'C3 C3 A2 A2 F2 F2 G2 G2 C3 C3 A2 F2 G2 G2 C3 C3'.split(' ')
const EIGHTH = 60 / 76 / 2 // seconds, at a stately 76 bpm

function scheduleAnthem(ctx, out, t0) {
  const tone = (f, at, d, type, g, detune = 0) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(f, at)
    osc.detune.setValueAtTime(detune, at)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(g, at + 0.02)
    gain.gain.setValueAtTime(g, at + Math.max(0.03, d - 0.06))
    gain.gain.exponentialRampToValueAtTime(0.0001, at + d)
    osc.connect(gain).connect(out)
    osc.start(at)
    osc.stop(at + d + 0.05)
  }
  let t = t0
  for (const [n, len] of ANTHEM_LEAD) {
    const d = Number(len) * EIGHTH
    // Two slightly detuned squares = that authentic General MIDI wobble.
    tone(NOTE[n], t, d * 0.95, 'square', 0.035)
    tone(NOTE[n], t, d * 0.95, 'square', 0.02, 9)
    t += d
  }
  ANTHEM_BASS.forEach((n, half) => {
    for (let i = 0; i < 4; i++)
      tone(NOTE[n], t0 + (half * 4 + i) * EIGHTH, EIGHTH * 0.8, 'triangle', 0.09)
  })
  return t - t0 // loop length in seconds
}

// --- Scene sound effects (same 8-bit voice as the anthem) ----------------

// One square/triangle voice: frequency follows `path` ([seconds, Hz] points,
// exponential between them), with an optional vibrato and a doubled,
// slightly detuned copy for the General MIDI wobble.
function voice(
  ctx,
  out,
  { at, d, g, type = 'square', path, vibrato = 0, rate = 5.5, attack = 0.03 },
) {
  for (const [detune, gain] of [
    [0, g],
    [9, g * 0.55],
  ]) {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = type
    osc.detune.value = detune
    osc.frequency.setValueAtTime(path[0][1], at)
    for (const [dt, f] of path.slice(1)) osc.frequency.exponentialRampToValueAtTime(f, at + dt)
    if (vibrato) {
      const lfo = ctx.createOscillator()
      const depth = ctx.createGain()
      lfo.frequency.value = rate
      depth.gain.value = vibrato // cents
      lfo.connect(depth).connect(osc.detune)
      lfo.start(at)
      lfo.stop(at + d + 0.05)
    }
    env.gain.setValueAtTime(0.0001, at)
    env.gain.exponentialRampToValueAtTime(gain, at + attack)
    env.gain.setValueAtTime(gain, at + Math.max(attack + 0.01, d - 0.12))
    env.gain.exponentialRampToValueAtTime(0.0001, at + d)
    osc.connect(env).connect(out)
    osc.start(at)
    osc.stop(at + d + 0.05)
  }
}

// "Wah wah wah waaah": four notes stepping down a semitone, each sagging
// flat as it goes, the last one long and wobbling.
function sadTrombone(ctx, out, t0) {
  const notes = [233.08, 220, 207.65, 196] // B♭3 A3 A♭3 G3
  notes.forEach((f, i) => {
    const last = i === notes.length - 1
    const d = last ? 1.6 : 0.46
    voice(ctx, out, {
      at: t0 + i * 0.5,
      d,
      g: 0.07,
      attack: 0.07,
      path: [
        [0, f * 1.02],
        [d * 0.85, f * (last ? 0.97 : 0.985)],
      ],
      vibrato: last ? 35 : 0,
      rate: 6,
    })
  })
}

// Tune helper: play "note:beats" tokens from t0 at `beat` seconds per beat.
const PITCH = {
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392,
  A4: 440,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  A5: 880,
}
function playTune(ctx, out, t0, tune, beat, style) {
  let t = t0
  for (const tok of tune.split(/\s+/).filter(Boolean)) {
    const [n, b = '1'] = tok.split(':')
    const d = Number(b) * beat
    style(t, PITCH[n], d)
    t += d
  }
  return t - t0
}

// Night: "Twinkle Twinkle Little Star" (traditional) on a little music box —
// soft triangle plinks with a faint octave shimmer.
const TWINKLE = `C5 C5 G5 G5 A5 A5 G5:2 F5 F5 E5 E5 D5 D5 C5:2
  G5 G5 F5 F5 E5 E5 D5:2 G5 G5 F5 F5 E5 E5 D5:2
  C5 C5 G5 G5 A5 A5 G5:2 F5 F5 E5 E5 D5 D5 C5:2`
function twinkleTwinkle(ctx, out, t0) {
  return playTune(ctx, out, t0, TWINKLE, 0.32, (at, f, d) => {
    voice(ctx, out, {
      at,
      d: Math.min(d, 0.6),
      g: 0.06,
      type: 'triangle',
      attack: 0.01,
      path: [[0, f]],
    })
    voice(ctx, out, { at, d: 0.25, g: 0.012, type: 'sine', attack: 0.01, path: [[0, f * 2]] })
  })
}

// Morning: a rooster ("cock-a-doodle-doo!"), then "Morning Has Broken" — the
// traditional Gaelic tune Bunessan — in the anthem's square-wave voice.
function rooster(ctx, out, t0) {
  const crow = [
    [0, 0.12, 520, 680],
    [0.16, 0.12, 600, 760],
    [0.32, 0.14, 660, 860],
  ]
  for (const [at, d, a, b] of crow)
    voice(ctx, out, {
      at: t0 + at,
      d,
      g: 0.04,
      type: 'sawtooth',
      path: [
        [0, a],
        [d * 0.8, b],
      ],
    })
  voice(ctx, out, {
    at: t0 + 0.5,
    d: 0.85,
    g: 0.045,
    type: 'sawtooth',
    path: [
      [0, 700],
      [0.25, 1050],
      [0.8, 620],
    ],
    vibrato: 50,
    rate: 12,
  })
  return 1.4
}
const MORNING_HAS_BROKEN = `C4 E4 G4 C5:2 A4 G4 A4 G4 E4:3
  G4 A4 C5 D5:2 C5 A4 G4 E4 D4:3`
function morningHasBroken(ctx, out, t0) {
  return playTune(ctx, out, t0, MORNING_HAS_BROKEN, 0.34, (at, f, d) =>
    voice(ctx, out, { at, d: d * 0.95, g: 0.035, path: [[0, f]] }),
  )
}

// A surprised "whoa!" (a quick upward swoop and a sparkle), then a low,
// wobbly whale-song sweep.
function surprisedWhale(ctx, out, t0) {
  voice(ctx, out, {
    at: t0,
    d: 0.26,
    g: 0.045,
    path: [
      [0, 300],
      [0.24, 1250],
    ],
  })
  ;[1046.5, 1318.51, 1567.98].forEach((f, i) =>
    voice(ctx, out, { at: t0 + 0.28 + i * 0.07, d: 0.09, g: 0.035, path: [[0, f]] }),
  )
  voice(ctx, out, {
    at: t0 + 0.6,
    d: 1.7,
    g: 0.13,
    type: 'triangle',
    attack: 0.15,
    path: [
      [0, 140],
      [0.55, 270],
      [1.5, 105],
    ],
    vibrato: 30,
    rate: 4,
  })
}

export function startGoatParty({
  onSoundBlocked,
  muted = false,
  music = true,
  fireworks = true,
} = {}) {
  if (typeof window === 'undefined' || !effectsEnabled()) return () => {}
  const timers = []
  let stopped = false
  let onState = null

  // Music: schedule one loop at a time, queueing the next just before the end.
  const ctx = getCtx()
  let master = null
  let anthem = null
  if (ctx) {
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 1
    master.connect(ctx.destination)
    // The anthem runs through its own bus so scene events can fade it out
    // (breakdown) or dip it (whale) while their jingles play on top.
    anthem = ctx.createGain()
    anthem.gain.value = music ? 1 : 0
    anthem.connect(master)
    const loop = (at) => {
      if (stopped) return
      const len = scheduleAnthem(ctx, anthem, at)
      timers.push(setTimeout(() => loop(at + len), (at + len - ctx.currentTime - 0.3) * 1000))
    }
    // Only start the anthem once audio actually runs (see above).
    let started = false
    onState = () => {
      const running = ctx.state === 'running'
      onSoundBlocked?.(!running)
      if (running && !started && !stopped) {
        started = true
        loop(ctx.currentTime + 0.05)
      }
    }
    ctx.addEventListener('statechange', onState)
    onState()
  }

  // Fireworks: a random shell over the upper screen every ~0.8 s, while on.
  let fireworksOn = fireworks
  let layer = null
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!reduced && typeof document !== 'undefined') {
    layer = document.createElement('div')
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;'
    document.body.appendChild(layer)
    const shell = () => {
      if (stopped) return
      // (only while stop.setFireworks has them on)
      if (fireworksOn)
        burst(
          layer,
          rand(0.1, 0.9) * window.innerWidth,
          rand(0.1, 0.6) * window.innerHeight,
          22,
          rand(120, 220),
        )
      // Spent sparks are invisible (fill: forwards) — prune them.
      while (layer.childElementCount > 200) layer.firstChild.remove()
      timers.push(setTimeout(shell, rand(500, 1100)))
    }
    shell()
  }

  function stop() {
    if (stopped) return
    stopped = true
    timers.forEach(clearTimeout)
    clearTimeout(chatterTimer)
    if (onState) ctx.removeEventListener('statechange', onState)
    if (master && ctx) {
      // Quick fade so already-scheduled notes don't cut off with a click.
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.05)
      setTimeout(() => master.disconnect(), 400)
    }
    if (layer) setTimeout(() => layer.remove(), 1600) // let the last sparks fall
  }
  stop.unlockSound = () => ctx?.resume()
  stop.setFireworks = (on) => {
    fireworksOn = on
  }

  // Scene events. A breakdown silences the anthem and plays a sad trombone
  // until it's over; a whale dips the anthem under a surprised jingle.
  const playing = () => !stopped && master && ctx.state === 'running'
  // The anthem is silenced while there's trouble or it's night/morning — or
  // for good, if the theme music's been switched off (stop.setMusic).
  let trouble = false
  let phase = 'day'
  let musicOn = music
  const anthemOn = () => musicOn && !trouble && phase === 'day'
  stop.setMusic = (on) => {
    musicOn = on
    if (master) applyAnthem(false)
  }
  const applyAnthem = (fast) => {
    anthem.gain.cancelScheduledValues(ctx.currentTime)
    anthem.gain.setTargetAtTime(anthemOn() ? 1 : 0, ctx.currentTime, fast ? 0.12 : 0.4)
  }
  stop.setTrouble = (on) => {
    if (!master || on === trouble) return
    trouble = on
    applyAnthem(on)
    if (on && playing()) sadTrombone(ctx, master, ctx.currentTime + 0.15)
  }
  // Day/night: at nightfall a lullaby; at dawn a rooster and a morning hymn.
  stop.setPhase = (next) => {
    if (!master || next === phase) return
    phase = next
    applyAnthem(next !== 'day')
    if (!playing()) return
    const now = ctx.currentTime + 0.3
    if (next === 'night') twinkleTwinkle(ctx, master, now)
    if (next === 'morning') morningHasBroken(ctx, master, now + rooster(ctx, master, now))
  }
  stop.cue = (name) => {
    if (name !== 'whale' || !playing()) return
    const now = ctx.currentTime
    if (anthemOn()) {
      anthem.gain.cancelScheduledValues(now)
      anthem.gain.setTargetAtTime(0.25, now, 0.1)
      anthem.gain.setTargetAtTime(1, now + 2.3, 0.4)
    }
    surprisedWhale(ctx, master, now + 0.05)
  }
  // Teen chatter: while school kids are around, a low babble of short
  // syllables from a few voices, each with its own pitch, rising and falling.
  let chatterTimer = null
  const VOICES = [150, 185, 220, 260, 300]
  const babble = () => {
    if (!playing()) return
    const at = ctx.currentTime + 0.02
    const base = VOICES[Math.floor(Math.random() * VOICES.length)]
    const d = 0.07 + Math.random() * 0.12
    const f = base * (0.9 + Math.random() * 0.25)
    voice(ctx, master, {
      at,
      d,
      g: 0.018,
      type: Math.random() < 0.5 ? 'triangle' : 'square',
      attack: 0.015,
      path: [
        [0, f],
        [d * 0.9, f * (0.8 + Math.random() * 0.45)],
      ],
    })
    chatterTimer = setTimeout(babble, 70 + Math.random() * 160)
  }
  stop.setChatter = (on) => {
    if (on && !chatterTimer) babble()
    if (!on && chatterTimer) {
      clearTimeout(chatterTimer)
      chatterTimer = null
    }
  }
  stop.setMuted = (m) => {
    if (master && !stopped) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05)
  }
  return stop
}
