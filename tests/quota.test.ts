import { readFile } from 'node:fs/promises'
import { Miniflare } from 'miniflare'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { handleApi } from '../src/server/api'
import { charge, type Bindings } from '../src/server/db'
import { getVideos } from '../src/server/youtube'

let mf: Miniflare
let env: Bindings

beforeEach(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: ['DB'], compatibilityDate: '2026-07-30' })
  env = { DB: await mf.getD1Database('DB') as unknown as D1Database, YOUTUBE_API_KEY: 'private-fixture-key' }
  const sql = await readFile(new URL('../migrations/0001_public_cache.sql', import.meta.url), 'utf8')
  await env.DB.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => env.DB.prepare(s)))
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-17T12:00:00Z'))
  vi.stubGlobal('fetch', async () => { throw new Error('Quota reporting must not call YouTube') })
})

afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await mf.dispose() })

async function quota(overrides: Partial<Bindings> = {}) {
  const limit = { limit: async () => ({ success: true }) } as unknown as RateLimit
  return handleApi(new Request('https://mytube.test/api/quota'), 'quota', {
    ...env, ...overrides, REQUEST_LIMIT: limit, LOOKUP_LIMIT: limit,
  })
}

it('reports an unused day without spending quota or exposing credentials', async () => {
  const response = await quota()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({
    day: '2026-11-17', resetsAt: Date.parse('2026-11-18T08:00:00Z'),
    used: 0, limit: 3500, remaining: 3500, blocked: false, configured: true,
  })
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM budget').first('count')).toBe(0)
})

it('reports the shared API budget independently of sync batches and matches its enforced limit', async () => {
  await charge(env, 'api')
  await charge(env, 'api')
  await charge(env, 'sync')
  expect(await (await quota({ API_DAILY_LIMIT: '3' })).json()).toMatchObject({ used: 2, limit: 3, remaining: 1 })
  const limited = { ...env, API_DAILY_LIMIT: '3' }
  await charge(limited, 'api')
  await expect(charge(limited, 'api')).rejects.toMatchObject({ code: 'budget' })
  expect(await (await quota({ API_DAILY_LIMIT: '3' })).json()).toMatchObject({ used: 3, limit: 3, remaining: 0 })
  expect(await (await quota({ API_DAILY_LIMIT: '50000' })).json()).toMatchObject({ limit: 9500, remaining: 9497 })
  expect(await (await quota({ API_DAILY_LIMIT: 'invalid' })).json()).toMatchObject({ limit: 3500, remaining: 3497 })
})

it('reports upstream quota exhaustion even before the local budget is spent', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 }))
  await expect(getVideos(env, ['aaaaaaaaaaa'])).rejects.toMatchObject({ code: 'quota' })
  expect(await (await quota()).json()).toMatchObject({ used: 1, blocked: true, remaining: 0 })
})

it('clamps remaining quota when the daily budget is lowered and reports a missing key', async () => {
  await charge(env, 'api')
  await charge(env, 'api')
  expect(await (await quota({ API_DAILY_LIMIT: '1', YOUTUBE_API_KEY: ' ' })).json())
    .toMatchObject({ used: 2, limit: 1, remaining: 0, configured: false })
})

it.each([
  ['2026-07-01T06:59:59Z', '2026-06-30', '2026-07-01T07:00:00Z'],
  ['2026-07-01T07:00:00Z', '2026-07-01', '2026-07-02T07:00:00Z'],
  ['2026-03-08T09:00:00Z', '2026-03-08', '2026-03-09T07:00:00Z'],
  ['2026-11-01T08:00:00Z', '2026-11-01', '2026-11-02T08:00:00Z'],
])('resets on Pacific midnight, including daylight saving changes: %s', async (now, day, reset) => {
  await charge(env, 'api')
  vi.mocked(Date.now).mockReturnValue(Date.parse(now))
  expect(await (await quota()).json()).toMatchObject({ day, resetsAt: Date.parse(reset), used: 0, remaining: 3500 })
})
