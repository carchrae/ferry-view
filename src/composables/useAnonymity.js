// Per-user "appear anonymously on the leaderboard" preference. Stored in
// localStorage keyed by uid — like display-name changes, it is stamped onto
// each new report/ride at write time, so it takes effect on the user's next
// contribution (older records keep whatever they were stamped with, and the
// leaderboard follows each user's most-recent record).

const KEY = 'bowenlift.anonymous'

function keyFor(uid) {
  return `${KEY}:${uid}`
}

export function isAnonymous(uid) {
  if (!uid) return false
  try {
    return localStorage.getItem(keyFor(uid)) === '1'
  } catch {
    return false
  }
}

export function setAnonymous(uid, value) {
  if (!uid) return
  try {
    if (value) localStorage.setItem(keyFor(uid), '1')
    else localStorage.removeItem(keyFor(uid))
  } catch {
    // localStorage unavailable (private mode) — preference just won't persist.
  }
}
