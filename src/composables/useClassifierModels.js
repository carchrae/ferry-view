import { shallowRef } from 'vue'
import { doc, getDoc, getDocFromCache } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import bundledLineup from '../../functions/models/lineup-classifier.json'
import bundledTerminal from '../../functions/models/terminal-cars-classifier.json'

// The classifier models the browser mirrors run — the same ones the Cloud
// Functions run, chosen the same way: Firestore's classifierModels/live
// pointer names a version per classifier, classifierModels/{name}-v{n}
// holds it (see functions/lib/classifier-models.js and
// functions/publish-classifier-models.js). So a retrained model reaches
// riders' devices without a webapp deploy, and the "Robot says" chips agree
// with what the server stamps on sailingStatus.
//
// What it costs, and what is cached where:
//  - No read for the pointer: the versions the robots run ride on
//    ferryStatus/current as `classifierModels` (functions/lib/api.js
//    LIVE_FIELDS), the doc the home page already listens to, and
//    useFirestoreFerryListener pushes them here (applyLiveVersions) on every
//    snapshot — so a publish reaches an open app with the next status patch.
//    A page without that listener (a deep link to /departures) falls back to
//    the status doc in the persistent cache, and only with no cache at all
//    to one read of the tiny classifierModels/live doc.
//  - A model doc (13–25 KB) is fetched ONLY when the pointer names a version
//    other than the one in memory, and then from the persistent cache first:
//    versions are immutable, so a doc this device has ever read is final.
//    The server is asked once per version per device, ever.
//  - The JSONs bundled at build time are the fallback and the starting
//    point: live from the first tick (no flash of "robot unavailable"),
//    used offline, when there is no pointer, and whenever the named doc is
//    missing or malformed. When the pointer names the bundled version,
//    nothing is fetched at all.
//
// No geometry check here, unlike the server: the browser extracts features
// FROM the model's own regions and masks, so any well-formed model is
// self-consistent. The server refuses a model whose crops differ from its
// compiled feature code because its extraction is fixed at deploy time.
export const lineupModel = shallowRef(bundledLineup)
export const terminalModel = shallowRef(bundledTerminal)

const wellFormed = (m) =>
  Boolean(m?.enabled) &&
  Array.isArray(m.weights) &&
  Array.isArray(m.regions) &&
  m.regions.length > 0 &&
  m.regions.every((r) => r?.roi && r.width > 0 && r.height > 0) &&
  m.weights.length === m.regions.reduce((a, r) => a + r.width * r.height, 0)

const TARGETS = [
  { name: 'lineup', target: lineupModel, bundled: bundledLineup },
  { name: 'terminal-cars', target: terminalModel, bundled: bundledTerminal },
]

// Immutable docs: cache first, server only for a version never seen here.
async function fetchModel(name, version) {
  const ref = doc(db, 'classifierModels', `${name}-v${version}`)
  try {
    const cached = await getDocFromCache(ref)
    if (cached.exists()) return cached.data()
  } catch {
    // Not in the local cache (or no persistence) — ask the server.
  }
  return (await getDoc(ref)).data()
}

// Apply one pointer reading. Resolves when every classifier it names is in
// place (or has fallen back), so callers can await a settled state.
let generation = 0
async function applyPointer(live) {
  const gen = ++generation
  await Promise.all(
    TARGETS.map(async ({ name, target, bundled }) => {
      const version = live?.[name]
      // No pointer for this classifier → the bundled model, as before.
      const wanted = version == null ? bundled.version : version
      if (wanted === target.value?.version) return
      if (wanted === bundled.version) {
        target.value = bundled
        return
      }
      try {
        const m = await fetchModel(name, version)
        // A newer pointer reading arrived while this fetch was in flight.
        if (gen !== generation) return
        if (wellFormed(m)) target.value = m
        else
          console.warn(
            `Live classifier ${name}-v${version} missing or malformed — bundled model in use`,
          )
      } catch (e) {
        console.warn(
          `Live classifier ${name}-v${version} unavailable — bundled model in use:`,
          e?.message,
        )
      }
    }),
  )
}

let started = null
let pushed = false
// Versions from ferryStatus/current.classifierModels, pushed by
// useFirestoreFerryListener on every snapshot. Cheap when unchanged
// (applyPointer compares versions before doing anything).
export function applyLiveVersions(versions) {
  if (!versions || typeof versions !== 'object') return
  pushed = true
  loadLiveModels()
  return applyPointer(versions)
}

// Starts the one-off fallback for pages that never receive a push (once;
// later calls return the same promise). Resolves once a first reading has
// been applied, or the attempt is over and the bundled models stand.
export function loadLiveModels() {
  if (started) return started
  started = (async () => {
    // Give the status listener a moment to deliver; it usually already has.
    await new Promise((r) => setTimeout(r, 1500))
    if (pushed) return
    try {
      const status = await getDocFromCache(doc(db, 'ferryStatus', 'current'))
      if (status.exists() && status.data()?.classifierModels) {
        await applyPointer(status.data().classifierModels)
        return
      }
    } catch {
      // Nothing cached — fall through to the pointer itself.
    }
    try {
      const live = await getDoc(doc(db, 'classifierModels', 'live'))
      await applyPointer(live.exists() ? live.data() : null)
    } catch (e) {
      console.warn('Live classifier pointer unavailable — bundled models in use:', e?.message)
    }
  })()
  return started
}
