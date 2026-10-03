import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  parseServiceNotices,
  fetchServiceNotices,
  sameNotices,
  BC_FERRIES_CONDITIONS_URL,
} from '../lib/service-notices.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(__dirname, 'fixtures', 'bow-hsb-conditions.html'), 'utf8')

describe('service-notices', () => {
  it('parses each notice with code, title and absolute url', () => {
    expect(parseServiceNotices(fixture)).toEqual([
      {
        code: '8803994611464',
        title: 'Revised Schedule – Right Angle Drive Exchange',
        url: 'https://www.bcferries.com/current-conditions/service-notices?serviceNoticeCode=8803994611464',
      },
      {
        code: '8803205000968',
        title: 'Horseshoe Bay & Langdale Infrastructure Program',
        url: 'https://www.bcferries.com/current-conditions/service-notices?serviceNoticeCode=8803205000968',
      },
    ])
  })

  it('returns [] for a conditions page with no notices', () => {
    expect(parseServiceNotices('<div id="ccDetails"></div>')).toEqual([])
  })

  it('returns null when the page is not a conditions page', () => {
    expect(parseServiceNotices('<html><body>Maintenance</body></html>')).toBeNull()
  })

  it('fetches with a browser UA and throws on a non-conditions page', async () => {
    let seen
    const ok = async (url, opts) => {
      seen = { url, opts }
      return { ok: true, text: async () => fixture }
    }
    expect(await fetchServiceNotices(ok)).toHaveLength(2)
    expect(seen.url).toBe(BC_FERRIES_CONDITIONS_URL)
    expect(seen.opts.headers['User-Agent']).toMatch(/Mozilla/)

    const broken = async () => ({ ok: true, text: async () => '<html></html>' })
    await expect(fetchServiceNotices(broken)).rejects.toThrow(/ccDetails/)
    const down = async () => ({ ok: false, status: 503 })
    await expect(fetchServiceNotices(down)).rejects.toThrow(/503/)
  })

  it('sameNotices compares code/title/url in order', () => {
    const a = parseServiceNotices(fixture)
    expect(sameNotices(a, parseServiceNotices(fixture))).toBe(true)
    expect(sameNotices(a, a.slice(1))).toBe(false)
    expect(sameNotices(undefined, [])).toBe(false)
  })
})
