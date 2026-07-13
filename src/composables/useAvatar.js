// Resolve a display avatar URL for a user. Prefer the auth provider's photo
// (e.g. Google's photoURL); otherwise fall back to Gravatar keyed on the user's
// email. Gravatar accepts a SHA-256 hash of the trimmed, lowercased email and
// serves a "mystery person" silhouette (d=mp) when no custom image exists — so
// users add their own photo either on their Google account or on gravatar.com.

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function gravatarUrl(email, { size = 128, defaultImg = 'mp' } = {}) {
  if (!email) return null
  const hash = await sha256Hex(email.trim().toLowerCase())
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=${defaultImg}`
}

// Best avatar URL for a (plain snapshot) user object, or null if none derivable.
export async function resolveAvatarUrl(user) {
  if (!user) return null
  if (user.photoURL) return user.photoURL
  if (user.email) return await gravatarUrl(user.email)
  return null
}
