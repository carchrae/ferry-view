import { scoreSailing } from '../../functions/lib/leaderboard-score.js'

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

export function celebrate(credits, { label } = {}) {
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
