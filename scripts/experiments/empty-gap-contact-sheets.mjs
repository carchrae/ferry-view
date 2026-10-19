// Contact sheets for the sailings where a trailing-cars-run cap on the
// one-way empty-gap rule would make a difference (2026-10-19, follows
// empty-gap-one-way.mjs — run that first; it writes the results JSON).
//   node scripts/experiments/empty-gap-contact-sheets.mjs
// Every archived terminal frame of each sailing, in capture order, with the
// model's p (v11) and the time; green = empty, red = cars, the confirming
// empty frame outlined. Two sheets in docs/experiments/img/:
//   2026-10-19-tail-cap-cost.jpg   Full-tagged sailings the one-way rule flags
//   2026-10-19-tail-cap-lost.jpg   room-tagged late-arrival sailings a cap of
//                                  4+ trailing cars frames would lose
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { classifyTerminal } from '../../functions/lib/terminal-classifier.js'
import { terminalEmptyFrameTs } from '../../functions/lib/lineup-labels.js'

const ROOT = join(import.meta.dirname, '../..')
const sharp = createRequire(join(ROOT, 'functions/package.json'))('sharp')
const DATA = join(ROOT, 'training-data')
const IMG = join(ROOT, 'docs/experiments/img')
const W = 160, H = 120, PER_ROW = 8, HEAD = 22
const results = JSON.parse(readFileSync(join(ROOT, 'docs/experiments/2026-10-19-empty-gap-one-way-results.json'), 'utf8'))
const manifest = new Map()
for (const l of readFileSync(join(DATA, 'terminal-manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts] = l.split(',')
  if (!manifest.has(sailingKey)) manifest.set(sailingKey, [])
  manifest.get(sailingKey).push({ path, ts: Number(ts) })
}
const hhmm = (ts) => new Date(ts).toLocaleTimeString('en-CA', { timeZone: 'America/Vancouver', hour12: false }).slice(0, 5)
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

async function sailingStrip(s) {
  const frames = (manifest.get(s.key) || []).sort((a, b) => a.ts - b.ts)
  const seq = []
  for (const f of frames) {
    const buf = readFileSync(join(DATA, 'frames', f.path))
    const r = await classifyTerminal(buf, undefined, { ts: f.ts })
    seq.push({ ...f, buf, p: r?.probability ?? null, carsPresent: r?.carsPresent ?? null })
  }
  const emptyTs = terminalEmptyFrameTs(seq)
  const rows = Math.ceil(seq.length / PER_ROW)
  const height = HEAD + rows * H
  const tiles = []
  const svgParts = [`<rect width="${PER_ROW * W}" height="${HEAD}" fill="#222"/>`,
    `<text x="6" y="16" font-family="sans-serif" font-size="14" fill="#fff">${esc(s.key)} — tagged ${esc(s.tag)} — trailing cars ${s.trailingCars} — ${esc(s.shape)}</text>`]
  for (let i = 0; i < seq.length; i++) {
    const f = seq[i]
    const x = (i % PER_ROW) * W, y = HEAD + Math.floor(i / PER_ROW) * H
    tiles.push({ input: await sharp(f.buf).resize(W, H).toBuffer(), left: x, top: y })
    const col = f.carsPresent ? '#e53935' : '#43a047'
    svgParts.push(`<rect x="${x + 2}" y="${y + 2}" width="${W - 4}" height="16" fill="${col}" opacity="0.85"/>`)
    svgParts.push(`<text x="${x + 6}" y="${y + 14}" font-family="sans-serif" font-size="12" fill="#fff">${hhmm(f.ts)}  p=${f.p?.toFixed(2)}</text>`)
    if (f.ts === emptyTs) svgParts.push(`<rect x="${x + 1}" y="${y + 1}" width="${W - 2}" height="${H - 2}" fill="none" stroke="#ffeb3b" stroke-width="4"/>`)
  }
  const svg = Buffer.from(`<svg width="${PER_ROW * W}" height="${height}">${svgParts.join('')}</svg>`)
  return sharp({ create: { width: PER_ROW * W, height, channels: 3, background: '#111' } })
    .composite([...tiles, { input: svg, left: 0, top: 0 }]).png().toBuffer()
}

async function sheet(list, file) {
  const strips = []
  for (const s of list) strips.push(await sailingStrip(s))
  const metas = await Promise.all(strips.map((b) => sharp(b).metadata()))
  const total = metas.reduce((a, m) => a + m.height + 8, 0)
  let top = 0
  const comp = strips.map((b, i) => { const c = { input: b, left: 0, top }; top += metas[i].height + 8; return c })
  await sharp({ create: { width: PER_ROW * W, height: total, channels: 3, background: '#000' } }).composite(comp).jpeg({ quality: 82 }).toFile(join(IMG, file))
  console.log(`wrote docs/experiments/img/${file} (${list.length} sailings)`)
}

await sheet(results.newlyWrong, '2026-10-19-tail-cap-cost.jpg')
await sheet(results.newlyRight.filter((s) => s.trailingCars >= 4), '2026-10-19-tail-cap-lost.jpg')
