#!/usr/bin/env node
// Build the night (dark-frame) labelling page for the crosswalk classifier:
// training-data/lineup-dark-labeling.html, plus the composites it shows.
//
// For every community-cam frame below DARK_ELEVATION_DEG with pixels on disk,
// the page shows the raw frame AND its stable-pixel composite (the exact
// window rule scripts/train-night-classifier.mjs trains on: up to COMPOSITE.k
// trailing frames, ≤ COMPOSITE.maxGapMs apart, same exposure mode) — passing
// headlights vanish from the composite, a standing queue stays, so the
// composite is usually the easier picture to judge. Daylight frames of the
// same sailing are shown greyed as context (reusing the day report's thumbs).
//
// Labels come from three places, shown side by side:
//   training-data/lineup-dark-labels.json         hand labels (authoritative)
//   training-data/lineup-dark-labels-claude.json  Claude's proposed labels
//   manifest.csv                                   rider crosswalk marks
// The page edits the "effective" label per sailing (crosswalk from frame N /
// never) and exports ONLY the changes as {path: 0|1} JSON — paste that into
// a file and run scripts/apply-dark-label-review.mjs to fold it into the
// hand labels (the Claude file loses those paths: a human now vouches).
//
//   npm run lineup:dark-label            # rebuild page + composites
//   node scripts/build-dark-label-page.mjs --since 2026-10-01   # a subset
//
// Also writes training-data/dark-frames.json (the per-frame table the page
// renders, with composite thumb names) for other tools.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  COMPOSITE,
  compositeStable,
  compositeWindow,
  greyToJpeg,
  meanLuminance,
} from '../functions/lib/lineup-features.js'
import { isDarkAt, solarElevation } from '../functions/lib/daylight.js'
import { TZ } from '../functions/lib/time.js'

// sharp resolves against functions/node_modules (see lineup-features.js).
const sharp = createRequire(new URL('../functions/lib/lineup-features.js', import.meta.url))('sharp')

const args = process.argv.slice(2)
const flag = (n, d) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = flag('data', join(repoRoot, 'training-data'))
const SINCE = flag('since', '0000-00-00')
const OUT_DIR = join(DATA, 'report', 'dark')
const DAY_THUMBS = join(DATA, 'report', 'thumbs')
mkdirSync(OUT_DIR, { recursive: true })

const thumbName = (p) => createHash('md5').update(p).digest('hex').slice(0, 16)
const loadJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d)
const hand = loadJson(join(DATA, 'lineup-dark-labels.json'), {})
const claude = loadJson(join(DATA, 'lineup-dark-labels-claude.json'), {})

// --- frames by sailing ----------------------------------------------------------
const bySailing = new Map()
for (const line of readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts, label, crosswalkAt] = line.split(',')
  if (!path.startsWith('webcams/community/')) continue
  if (sailingKey.slice(0, 10) < SINCE) continue
  const file = join(DATA, 'frames', path)
  if (!existsSync(file)) continue
  if (!bySailing.has(sailingKey)) bySailing.set(sailingKey, [])
  bySailing.get(sailingKey).push({
    path,
    sailingKey,
    ts: Number(ts),
    riderLabel: label === '0' ? 0 : label === '1' ? 1 : null,
    crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null,
    file,
    dark: isDarkAt(Number(ts)),
    elev: solarElevation(Number(ts)),
  })
}
for (const l of bySailing.values()) l.sort((a, b) => a.ts - b.ts)

const fmt = (ts) =>
  new Date(ts).toLocaleTimeString('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })

// --- composites -----------------------------------------------------------------
const sailings = []
let built = 0
let reused = 0
for (const [key, list] of [...bySailing].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
  if (!list.some((f) => f.dark)) continue
  const frames = []
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    const row = {
      path: f.path,
      ts: f.ts,
      time: fmt(f.ts),
      elev: Math.round(f.elev * 10) / 10,
      dark: f.dark,
      riderLabel: f.riderLabel,
      hand: hand[f.path] ?? null,
      claude: claude[f.path] ?? null,
      thumb: `frames/${f.path}`,
    }
    if (f.dark) {
      const win = [f]
      for (let j = i - 1; j >= 0 && win.length < COMPOSITE.k; j--) {
        if (win[0].ts - list[j].ts > COMPOSITE.maxGapMs) break
        win.unshift(list[j])
      }
      const rawOut = join(OUT_DIR, `${thumbName(f.path)}.jpg`)
      const compOut = join(OUT_DIR, `${thumbName(f.path)}-c.jpg`)
      row.raw = `report/dark/${thumbName(f.path)}.jpg`
      row.comp = `report/dark/${thumbName(f.path)}-c.jpg`
      try {
        // The trainer's exact window rule (same exposure mode + level).
        const { greys: used, infrared } = await compositeWindow(win.map((w) => readFileSync(w.file)))
        row.lum = Math.round(meanLuminance(used[used.length - 1]) * 1000) / 1000
        row.infrared = infrared
        row.window = win.length
        row.used = used.length
        row.windowTimes = win.map((w) => fmt(w.ts))
        if (existsSync(rawOut) && existsSync(compOut)) reused++
        else {
          const comp = compositeStable(used)
          await sharp(await greyToJpeg(comp)).resize({ width: 480 }).jpeg({ quality: 70 }).toFile(compOut)
          await sharp(readFileSync(f.file)).resize({ width: 480 }).jpeg({ quality: 70 }).toFile(rawOut)
          built++
        }
      } catch (e) {
        row.error = e.message
      }
    }
    frames.push(row)
  }
  sailings.push({ key, crosswalkAt: list[0].crosswalkAt, frames })
}
writeFileSync(join(DATA, 'dark-frames.json'), JSON.stringify(sailings, null, 1))
const darkCount = sailings.reduce((a, s) => a + s.frames.filter((f) => f.dark).length, 0)
console.log(`${sailings.length} sailings with dark frames, ${darkCount} dark frames (${built} composites built, ${reused} reused)`)

// --- page -----------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Night lineup labels</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  select { background:#2a2a2a; color:var(--fg); border:1px solid #444; border-radius:6px; padding:4px 6px; font:inherit; }
  :root { color-scheme: dark; font-family: system-ui, sans-serif; --bg:#111; --card:#1c1c1c; --fg:#eee; --mut:#999; --pos:#f0a030; --neg:#4a90d9; --hand:#7bd88f; }
  body { margin:0; background:var(--bg); color:var(--fg); }
  header { position:sticky; top:0; background:#000c; backdrop-filter:blur(6px); padding:10px 16px; border-bottom:1px solid #333; z-index:5; display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0 12px 0 0; }
  button { background:#2a2a2a; color:var(--fg); border:1px solid #444; border-radius:6px; padding:5px 10px; cursor:pointer; font:inherit; }
  button:hover { background:#333; } button.primary { background:#2d5a8c; border-color:#3a74b4; }
  .legend { color:var(--mut); font-size:12px; }
  section { padding:12px 16px; border-bottom:1px solid #222; }
  section h2 { font-size:14px; margin:0 0 6px; display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
  section h2 .state { font-weight:normal; color:var(--mut); }
  section h2 .state.changed { color:var(--pos); }
  .strip { display:flex; gap:8px; overflow-x:auto; padding-bottom:6px; }
  .frame { flex:0 0 auto; width:200px; background:var(--card); border-radius:8px; padding:6px; border:2px solid transparent; }
  .frame.day { opacity:.75; }
  .frame.day.pos { opacity:1; }
  .more { flex:0 0 auto; align-self:center; margin-right:4px; }
  .more button { white-space:nowrap; }
  .frame.pos { border-color:var(--pos); } .frame.neg { border-color:var(--neg); }
  .frame img { width:100%; display:block; border-radius:4px; background:#000; aspect-ratio:16/9; object-fit:cover; cursor:pointer; }
  .frame .pair img + img { margin-top:4px; }
  .meta { font-size:11px; color:var(--mut); margin-top:4px; display:flex; justify-content:space-between; gap:6px; }
  .meta b { color:var(--fg); }
  .tags { font-size:11px; margin-top:3px; min-height:14px; }
  .tag { display:inline-block; padding:0 5px; border-radius:3px; margin-right:4px; }
  .tag.rider { background:#333; } .tag.claude { background:#4b3a12; color:#f0c060; } .tag.hand { background:#1e4a28; color:var(--hand); }
  .actions { margin-top:5px; display:flex; gap:4px; }
  .actions button { padding:3px 7px; font-size:11px; }
  .frame.pos .from { background:#6b4a10; }
  .filters label { margin-right:10px; font-size:13px; }
  textarea { width:100%; height:40vh; background:#000; color:#ddd; border:1px solid #444; font:12px/1.3 monospace; }
  .hidden { display:none; }
  #out.hidden { display:none; }
  #out { position:fixed; inset:0; background:#000a; z-index:20; display:flex; align-items:center; justify-content:center; padding:16px; }
  #out .box { background:#181818; border:1px solid #444; border-radius:10px; padding:14px; width:min(900px, 100%); display:flex; flex-direction:column; gap:10px; }
  #out .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  #out .note { color:var(--mut); font-size:12px; }
</style></head><body>
<header>
  <h1>Night lineup labels</h1>
  <span class="legend">${sailings.length} sailings · ${darkCount} dark frames · click <b>from here</b> on the first frame (dark or daylight) where the lineup is past the crosswalk — every dark frame from there on becomes 1, earlier dark frames 0 — or <b>never</b>. A daylight pick is exported too, as the sailing's crosswalk time (a hand mark for the day model, same meaning as a rider's). Export writes only what you changed.</span>
  <span class="filters">
    <label>show <select id="filter">
      <option value="all">all sailings</option>
      <option value="changed">my changes</option>
      <option value="claudePos">Claude: past crosswalk</option>
      <option value="claudeNever">Claude: never</option>
      <option value="claudeAny">Claude labelled (any)</option>
      <option value="pos">currently past crosswalk (any source)</option>
      <option value="unlabeled">unlabelled</option>
      <option value="mixed">dark + daylight frames</option>
      <option value="rider">has a rider mark</option>
    </select></label>
    <label><input type="checkbox" id="showComp" checked> composite</label>
    <label><input type="checkbox" id="showRaw" checked> raw</label>
  </span>
  <button class="primary" id="export">Export changes</button>
  <button id="exportAll">Export all</button>
  <button id="resetTop" title="forget the picks saved in this browser">Reset picks</button>
  <span id="count" class="legend"></span>
  <span class="legend" title="page build time">build ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z</span>
</header>
<div id="out" class="hidden"><div class="box">
  <div class="row"><b id="outTitle">Export</b><span id="outNote" class="note"></span><span style="flex:1"></span>
    <button id="copyBtn">Copy</button><button id="downloadBtn">Download .json</button><button id="closeOut">Close</button></div>
  <textarea id="json" readonly></textarea>
  <div class="note">Paste this JSON back to Claude (or hand over the downloaded file). Your picks are also saved in this browser and survive a reload — <button id="resetBtn" style="font-size:11px;padding:1px 6px">forget saved picks</button>.</div>
</div></div>
<div id="summary" style="padding:10px 16px;border-bottom:1px solid #333;font-size:13px;color:#ccc"></div>
<main id="main"></main>
<script>
const SAILINGS = ${JSON.stringify(sailings)};
// Effective initial label per dark frame: hand > claude > rider.
const eff = (f) => (f.hand ?? f.claude ?? f.riderLabel);
// Per-sailing state: index into frames of the first positive dark frame, 'never', or null (unlabelled).
// Initial state per sailing: the first frame past the crosswalk, dark or
// daylight. A hand/Claude dark positive wins; else a rider's crosswalk mark
// (which may sit on a daylight frame — then every dark frame is 0 but the
// sailing is NOT "never"); else 'never' when every dark frame is labelled 0;
// else unlabelled.
const initial = {}, state = {}, expanded = {};
// Picks persist per browser so a reload (or a page rebuild) never loses a
// review in progress. Keyed by sailing; only differences from the page's
// initial state are stored.
const STORE_KEY = 'lineupDarkLabels.picks.v1';
const loadPicks = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') } catch { return {} } };
const savePicks = () => { try { const d = {}; for (const k in state) if (state[k] !== initial[k]) d[k] = state[k]; localStorage.setItem(STORE_KEY, JSON.stringify(d)) } catch {} };
for (const s of SAILINGS) {
  const darks = s.frames.filter((f) => f.dark);
  const firstDarkPos = darks.find((f) => eff(f) === 1);
  const riderFirst = s.crosswalkAt != null ? s.frames.find((f) => f.ts >= s.crosswalkAt) : null;
  const allLabelled = darks.length && darks.every((f) => eff(f) != null);
  initial[s.key] = firstDarkPos ? firstDarkPos.path : riderFirst ? riderFirst.path : allLabelled ? 'never' : null;
  state[s.key] = initial[s.key];
}
{
  const saved = loadPicks(); let restored = 0;
  for (const [k, v] of Object.entries(saved)) if (k in state) { state[k] = v; restored++ }
  if (restored) setTimeout(() => { document.getElementById('count').textContent = restored + ' saved pick(s) restored from this browser' }, 0);
}
// Labels for the DARK frames only (what the night trainer consumes); the
// chosen frame itself may be a daylight one.
const labelsFor = (s, st) => {
  const out = {}; let after = false;
  for (const f of s.frames) { if (st === f.path) after = true; if (!f.dark) continue; out[f.path] = st === 'never' ? 0 : st == null ? null : after ? 1 : 0; }
  return out;
};
const dayPositive = (s, st) => { let after = false; const out = {}; for (const f of s.frames) { if (st === f.path) after = true; if (!f.dark) out[f.path] = st === 'never' || st == null ? 0 : after ? 1 : 0; } return out; };
// Header summary: which sailings the current labels (hand > claude > rider)
// call positive, so a reviewer can jump straight to them.
(() => {
  const pos = [], unl = [];
  for (const s of SAILINGS) {
    const darks = s.frames.filter((f) => f.dark);
    const first = darks.find((f) => eff(f) === 1);
    const dayFirst = !first && s.crosswalkAt != null ? s.frames.find((f) => f.ts >= s.crosswalkAt && !f.dark) : null;
    if (first) pos.push('<a href="#s-' + s.key + '" style="color:var(--pos)">' + s.key.slice(0, 16) + ' from ' + first.time + '</a>');
    else if (dayFirst) pos.push('<a href="#s-' + s.key + '" style="color:var(--mut)">' + s.key.slice(0, 16) + ' in daylight ' + dayFirst.time + '</a>');
    else if (!darks.every((f) => eff(f) != null)) unl.push('<a href="#s-' + s.key + '" style="color:var(--neg)">' + s.key.slice(0, 16) + '</a>');
  }
  document.getElementById('summary').innerHTML = '<b>Current labels:</b> ' + pos.length + ' sailing(s) past the crosswalk in the dark — ' + (pos.join(', ') || 'none')
    + '. Unlabelled: ' + (unl.join(', ') || 'none') + '. Everything else: never. Fix with <b>from here</b> / <b>never</b>, then <b>Export changes</b>.';
})();
function render() {
  const filter = document.getElementById('filter').value;
  const showComp = document.getElementById('showComp').checked, showRaw = document.getElementById('showRaw').checked;
  let changed = 0;
  const html = SAILINGS.map((s) => {
    const st = state[s.key], cur = labelsFor(s, st), init = labelsFor(s, initial[s.key]);
    const isChanged = JSON.stringify(cur) !== JSON.stringify(init); if (isChanged) changed++;
    const darks = s.frames.filter((f) => f.dark);
    const claudePos = darks.some((f) => f.claude === 1), claudeAny = darks.some((f) => f.claude != null);
    const keep = filter === 'all' ? true
      : filter === 'changed' ? isChanged
      : filter === 'claudePos' ? claudePos
      : filter === 'claudeNever' ? claudeAny && !claudePos
      : filter === 'claudeAny' ? claudeAny
      : filter === 'pos' ? st != null && st !== 'never'
      : filter === 'unlabeled' ? st == null
      : filter === 'mixed' ? darks.length && darks.length < s.frames.length
      : filter === 'rider' ? s.crosswalkAt != null
      : true;
    if (!keep) return '';
    const pick = s.frames.find((f) => f.path === st);
    // A daylight pick still labels the dark frames: those before it 0, those
    // after it 1 (the app's rule — frames at/after the mark are positive).
    const darkBefore = pick && !pick.dark ? s.frames.filter((f) => f.dark && f.ts < pick.ts).length : 0;
    const darkAfter = pick && !pick.dark ? s.frames.filter((f) => f.dark && f.ts > pick.ts).length : 0;
    const stText = st === 'never' ? 'never past crosswalk' : st == null ? 'unlabelled' : 'past crosswalk from ' + (pick?.time ?? '?')
      + (pick && !pick.dark ? ' (daylight: ' + darkBefore + ' dark frame(s) before → 0' + (darkAfter ? ', ' + darkAfter + ' after → 1' : '') + ')' : '');
    const dayPos = dayPositive(s, st);
    const human = s.crosswalkAt ? ' · rider mark ' + new Date(s.crosswalkAt).toLocaleTimeString('en-CA', { timeZone: '${TZ}', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    // Collapse the frames before the crossing (keeping one for context), or
    // all but the last three of a "never" sailing — the queue builds at the
    // end, the start is empty road. A button brings them back.
    const pickIdx = pick ? s.frames.indexOf(pick) : -1;
    const firstShown = expanded[s.key] ? 0 : pickIdx >= 0 ? Math.max(0, pickIdx - 1) : st === 'never' ? Math.max(0, s.frames.length - 3) : 0;
    const hiddenHtml = firstShown > 0
      ? '<div class="more"><button data-expand="' + s.key + '">show ' + firstShown + ' earlier</button></div>'
      : expanded[s.key] && s.frames.length > 3 ? '<div class="more"><button data-collapse="' + s.key + '">hide earlier</button></div>' : '';
    return '<section id="s-' + s.key + '" data-key="' + s.key + '"><h2>' + s.key + '<span class="state' + (isChanged ? ' changed' : '') + '">' + stText + human + '</span>'
      + '<button data-never="' + s.key + '">never</button><button data-clear="' + s.key + '">clear</button></h2><div class="strip">' + hiddenHtml
      + s.frames.slice(firstShown).map((f) => {
        if (!f.dark) return '<div class="frame day' + (dayPos[f.path] === 1 ? ' pos' : st != null ? ' neg' : '') + '"><img loading="lazy" src="' + f.thumb + '" alt="" data-from="' + s.key + '" data-path="' + f.path + '" title="click: past crosswalk from here"><div class="meta"><b>' + f.time + '</b><span>' + f.elev + '°' + (f.riderLabel != null ? ' · rider ' + f.riderLabel : '') + '</span></div>'
          + '<div class="actions"><button class="from" data-from="' + s.key + '" data-path="' + f.path + '">from here</button></div></div>';
        const y = cur[f.path];
        return '<div class="frame' + (y === 1 ? ' pos' : y === 0 ? ' neg' : '') + '"><div class="pair">'
          + (showComp ? '<img loading="lazy" src="' + f.comp + '" data-from="' + s.key + '" data-path="' + f.path + '" title="composite of ' + (f.windowTimes || []).join(', ') + ' (' + f.used + ' used) — click: past crosswalk from here">' : '')
          + (showRaw ? '<img loading="lazy" src="' + f.raw + '" data-from="' + s.key + '" data-path="' + f.path + '" title="raw — click: past crosswalk from here">' : '') + '</div>'
          + '<div class="meta"><b>' + f.time + '</b><span>' + f.elev + '° · ' + (f.infrared ? 'IR' : 'colour') + ' · lum ' + f.lum + ' · win ' + f.used + '/' + f.window + '</span></div>'
          + '<div class="tags">' + (f.riderLabel != null ? '<span class="tag rider">rider ' + f.riderLabel + '</span>' : '') + (f.claude != null ? '<span class="tag claude">claude ' + f.claude + '</span>' : '') + (f.hand != null ? '<span class="tag hand">hand ' + f.hand + '</span>' : '') + (f.error ? '<span class="tag">' + f.error + '</span>' : '') + '</div>'
          + '<div class="actions"><button class="from" data-from="' + s.key + '" data-path="' + f.path + '">from here</button></div></div>';
      }).join('') + '</div></section>';
  }).join('');
  document.getElementById('main').innerHTML = html;
  const shown = document.querySelectorAll('#main section').length;
  document.getElementById('count').textContent = shown + ' of ' + SAILINGS.length + ' shown · ' + changed + ' sailing(s) changed';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button, img[data-from]'); if (!b) return;
  if (b.dataset.from) { state[b.dataset.from] = b.dataset.path; savePicks(); render(); }
  else if (b.dataset.never) { state[b.dataset.never] = 'never'; savePicks(); render(); }
  else if (b.dataset.clear) { state[b.dataset.clear] = null; savePicks(); render(); }
  else if (b.dataset.expand) { expanded[b.dataset.expand] = true; render(); }
  else if (b.dataset.collapse) { expanded[b.dataset.collapse] = false; render(); }
});
for (const id of ['filter', 'showComp', 'showRaw']) document.getElementById(id).addEventListener('change', render);
// Export = { frames: {path: 0|1} for DARK frames, crosswalk: {sailingKey:
// epochMs | null} } — null means "never". The crosswalk time is the picked
// frame's capture time whether that frame is dark or daylight, so a review
// of a dawn/dusk sailing also yields a hand crosswalk mark for the day
// model (scripts/apply-dark-label-review.mjs stores both).
function exportLabels(all) {
  const frames = {}, crosswalk = {};
  for (const s of SAILINGS) {
    const st = state[s.key], init = initial[s.key];
    const cur = labelsFor(s, st), was = labelsFor(s, init);
    for (const [p, v] of Object.entries(cur)) if (v != null && (all || v !== was[p])) frames[p] = v;
    if (st != null && (all || st !== init)) crosswalk[s.key] = st === 'never' ? null : (s.frames.find((f) => f.path === st)?.ts ?? null);
  }
  const out = { frames, crosswalk };
  const text = JSON.stringify(out, null, 1);
  lastExport = text;
  document.getElementById('outTitle').textContent = (all ? 'All effective labels' : 'Changes') + ': ' + Object.keys(frames).length + ' frame label(s), ' + Object.keys(crosswalk).length + ' crosswalk time(s)';
  document.getElementById('outNote').textContent = Object.keys(crosswalk).length || Object.keys(frames).length ? '' : '— nothing differs from the initial labels yet';
  const ta = document.getElementById('json'); ta.value = text;
  document.getElementById('out').classList.remove('hidden');
  ta.focus(); ta.select();
  copyText(text);
}
let lastExport = '';
// Clipboard writes need a secure origin (https or localhost); over plain http
// the API is missing, so fall back to the selected textarea and say so.
async function copyText(text) {
  const note = document.getElementById('outNote');
  try {
    if (!navigator.clipboard) throw new Error('no clipboard API on http');
    await navigator.clipboard.writeText(text);
    note.textContent = '— copied to clipboard';
  } catch (e) {
    const ta = document.getElementById('json'); ta.focus(); ta.select();
    let ok = false; try { ok = document.execCommand('copy') } catch {}
    note.textContent = ok ? '— copied to clipboard' : '— could not copy automatically (plain-http page): the text is selected, press Ctrl/Cmd+C, or Download';
  }
}
document.getElementById('copyBtn').addEventListener('click', () => copyText(lastExport));
document.getElementById('downloadBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lastExport], { type: 'application/json' }));
  a.download = 'dark-label-review-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
  document.body.appendChild(a); a.click(); a.remove();
});
document.getElementById('closeOut').addEventListener('click', () => document.getElementById('out').classList.add('hidden'));
document.getElementById('out').addEventListener('click', (e) => { if (e.target.id === 'out') document.getElementById('out').classList.add('hidden') });
document.getElementById('resetTop').addEventListener('click', () => { if (confirm('Forget the picks saved in this browser and go back to the initial labels?')) { localStorage.removeItem(STORE_KEY); location.reload() } });
document.getElementById('resetBtn').addEventListener('click', () => { if (confirm('Forget the picks saved in this browser and go back to the initial labels?')) { localStorage.removeItem(STORE_KEY); location.reload() } });
document.getElementById('export').addEventListener('click', () => exportLabels(false));
document.getElementById('exportAll').addEventListener('click', () => exportLabels(true));
render();
</script></body></html>
`
writeFileSync(join(DATA, 'lineup-dark-labeling.html'), html)
console.log(`Page: file://${join(DATA, 'lineup-dark-labeling.html')}`)
