// Tests must never reach bcferries.com: it blocks the developer's IP after a
// few requests. Code under test takes an injectable fetch (defaulting to the
// real one), so a test that forgets to pass its fake would quietly hit the
// live site — this makes that fail loudly instead. Tests that replace
// global.fetch with their own stub are unaffected.
const realFetch = globalThis.fetch

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || String(input)
  if (url.includes('bcferries.com')) {
    throw new Error(
      `Test tried to fetch ${url} — pass a fake fetch / saved fixture instead (bcferries.com blocks IPs)`,
    )
  }
  return realFetch(input, init)
}
