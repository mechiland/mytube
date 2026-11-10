import { errors } from '../lib/data'

export interface Bindings {
  DB: D1Database
  limitLookup?: () => Promise<void>
  YOUTUBE_API_KEY?: string
  SYNC_INTERVAL_SECONDS?: string
  API_DAILY_LIMIT?: string
  SYNC_DAILY_LIMIT?: string
  DB_SOFT_BYTES?: string
}
export const dayMs = 86_400_000
export const nowMs = () => Date.now()
const quotaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })
export const apiDay = (now = Date.now()) => quotaDay.format(now)
export const life = 28 * dayMs
export const bounded = (raw: string | undefined, fallback: number, max: number) => Math.min(max, Math.max(1, Number(raw) || fallback))
export const stmt = (env: Bindings, sql: string, ...args: (string | number | null)[]) => env.DB.prepare(sql).bind(...args)
export class ApiError extends Error {
  constructor(public code: string, public status: number, message = errors[code] ?? errors.service) { super(message) }
}
export function fail(code: string, status = 400): never { throw new ApiError(code, status) }

export async function charge(env: Bindings, column: 'api' | 'sync') {
  const limit = column === 'api' ? bounded(env.API_DAILY_LIMIT, 3500, 9500) : bounded(env.SYNC_DAILY_LIMIT, 220, 650)
  const entry = await stmt(env, `INSERT INTO budget(day,${column}) VALUES (?,1)
    ON CONFLICT(day) DO UPDATE SET ${column}=${column}+1
    WHERE ${column} < ? AND blocked=0 RETURNING ${column}`, apiDay(), limit).run()
  if ((entry.meta.size_after ?? 0) >= bounded(env.DB_SOFT_BYTES, 220_000_000, 400_000_000)) fail('storage', 503)
  if (!entry.results.length) {
    const blocked = await stmt(env, 'SELECT blocked FROM budget WHERE day=?', apiDay()).first<number>('blocked')
    fail(blocked ? 'quota' : 'budget', 429)
  }
}
export async function readCache<T>(env: Bindings, key: string) {
  const row = await stmt(env, 'SELECT data FROM response_cache WHERE key=? AND expires>?', key, nowMs()).first<string>('data')
  return row ? JSON.parse(row) as T : undefined
}
export function writeCache(env: Bindings, key: string, data: unknown, ttl: number) {
  return stmt(env, 'INSERT INTO response_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires',
    key, JSON.stringify(data), nowMs() + ttl).run()
}
