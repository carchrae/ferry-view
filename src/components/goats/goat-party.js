// The Bowen GOATs party: the dialog's music, sound cues and looping
// fireworks (sharing the tag celebration's audio context and sparks).
import { burst, effectsEnabled, getCtx, rand } from 'src/composables/useTagCelebration'

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

  // Fireworks: a random shell over the upper screen every ~0.8 s, while on —
  // kept above `ceiling` (a viewport y, e.g. the banner plane) when given.
  let fireworksOn = fireworks
  let ceiling = null
  let layer = null
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!reduced && typeof document !== 'undefined') {
    layer = document.createElement('div')
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;'
    document.body.appendChild(layer)
    const shell = () => {
      if (stopped) return
      // (only while stop.setFireworks has them on)
      if (fireworksOn) {
        const floor = ceiling ?? 0.6 * window.innerHeight
        // (a shell's sparks spread ~its distance, and fall a little)
        const distance = Math.min(rand(120, 220), Math.max(50, floor * 0.55))
        const top = 0.06 * window.innerHeight
        const y = rand(top, Math.max(top, floor - distance * 0.9))
        burst(layer, rand(0.1, 0.9) * window.innerWidth, y, 22, distance)
      }
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
  stop.setFireworks = (on, below = null) => {
    fireworksOn = on
    ceiling = below
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
