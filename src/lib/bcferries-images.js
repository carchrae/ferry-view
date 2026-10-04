// BC Ferries blocks an IP after it sees image requests whose Referer is
// localhost — i.e. a dev server loading its terminal webcams every minute.
// So in dev builds the bcferries.com cameras are not loaded at all (a
// placeholder shows instead). To see them anyway, run once in the console:
//   localStorage.setItem('bowenlift.devBcfCams', '1')
// Prod is unaffected (its Referer is the real site, which BC Ferries allows).

const isDev = process.env.DEV === true || process.env.DEV === 'true'

function devOptIn() {
  try {
    return localStorage.getItem('bowenlift.devBcfCams') === '1'
  } catch {
    return false
  }
}

export const BCF_IMAGES_ENABLED = !isDev || devOptIn()

export function isBcferriesUrl(url) {
  return typeof url === 'string' && url.includes('bcferries.com')
}

// The URL to load, or null when it's a BC Ferries image and they're off.
export function bcfSafeSrc(url) {
  return !BCF_IMAGES_ENABLED && isBcferriesUrl(url) ? null : url
}
