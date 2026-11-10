import type { Source, SourceKind, Video } from '../lib/data'
import { MAX_FAVORITES, MAX_PERSONAL, MAX_SOURCES } from '../lib/library'
import { channelId, handle, parseYouTube, playlistId, videoId } from '../lib/youtube-url'
import { ApiError, fail, life, nowMs, readCache, stmt, writeCache, type Bindings } from './db'
import { feed, firstPlayable, playlistPage, queueWindow, statuses, touchSources, type FeedInput } from './queries'
import { enroll, refreshSource, runSource, storeSource, storeVideos } from './sync'
import { getChannel, getChannelPlaylists, getComments, getPlaylist, getVideos } from './youtube'

async function cached<T>(env: Bindings, key: string, read: () => Promise<T | undefined>, load: () => Promise<T>): Promise<T> {
  const hit = await read()
  if (hit !== undefined) return hit
  await env.limitLookup?.()
  const now = nowMs()
  const token = crypto.randomUUID()
  const owner = await stmt(env, `INSERT INTO lookup_lease VALUES(?,?,?) ON CONFLICT(key) DO UPDATE
    SET token=excluded.token,expires=excluded.expires WHERE lookup_lease.expires<=? RETURNING token`,
    key, token, now + 20_000, now).first()
  if (!owner) {
    const fresh = await read()
    if (fresh !== undefined) return fresh
    fail('busy', 409)
  }
  try { return (await read()) ?? await load() }
  finally { await stmt(env, 'DELETE FROM lookup_lease WHERE key=? AND token=?', key, token).run() }
}

function cachedResponse<T>(env: Bindings, key: string, load: () => Promise<T>, ttl = 5 * 60_000) {
  return cached(env, key, () => readCache<T>(env, key), async () => {
    const value = await load()
    if (JSON.stringify(value).length < 96_000) await writeCache(env, key, value, ttl)
    return value
  })
}

async function source(env: Bindings, kind: SourceKind, id?: string, alias?: string, start = false) {
  const read = async () => {
    const row = id ? await stmt(env, 'SELECT data FROM source WHERE kind=? AND id=? AND expires>?', kind, id, nowMs()).first<string>('data')
      : await stmt(env, 'SELECT data FROM source WHERE alias=? AND expires>? LIMIT 1', alias!.toLowerCase(), nowMs()).first<string>('data')
    return row ? JSON.parse(row) as Source : undefined
  }
  const result = await cached(env, `source:${kind}:${id ?? alias?.toLowerCase()}`, read, async () => {
    const metadata = kind === 'playlist' ? await getPlaylist(env, id!) : await getChannel(env, id ? { id } : { handle: alias! })
    await storeSource(env, metadata).run()
    return metadata
  })
  if (start) {
    await enroll(env, result, false)
    const job = await stmt(env, 'SELECT due,token,checked,lease_until FROM job WHERE kind=? AND id=?', kind, result.id)
      .first<{ due: number; token: string | null; checked: number; lease_until: number }>()
    if (job && !job.token && !job.checked && job.lease_until <= nowMs() && job.due <= nowMs()) {
      await env.limitLookup?.()
      await runSource(env, kind, result.id)
    }
  }
  return result
}

async function video(env: Bindings, id: string) {
  return cached<Video>(env, 'video:' + id, async () => {
    const row = await stmt(env, 'SELECT data FROM video WHERE id=? AND expires>?', id, nowMs()).first<string>('data')
    return row ? JSON.parse(row) as Video : undefined
  }, async () => {
    const [value] = await getVideos(env, [id])
    if (!value) fail('missing', 404)
    await storeVideos(env, [value], nowMs() + life).run()
    return value
  })
}

function checked<T>(value: unknown, verify: (v: unknown) => v is T): T {
  if (!verify(value)) fail('input')
  return value
}
function list(value: unknown, verify: (v: unknown) => v is string, max: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > max || !value.every(verify)) fail('input')
  return [...new Set(value)]
}
async function body(req: Request): Promise<Record<string, unknown>> {
  const stream = req.body?.getReader()
  if (!stream || !req.headers.get('content-type')?.startsWith('application/json')) fail('input')
  const decoder = new TextDecoder()
  let bytes = 0
  let raw = ''
  for (;;) {
    const { value, done } = await stream.read()
    if (done) break
    bytes += value.length
    if (bytes > 45_000) { void stream.cancel(); fail('input', 413) }
    raw += decoder.decode(value, { stream: true })
  }
  let data: unknown
  try { data = JSON.parse(raw + decoder.decode()) } catch { fail('input') }
  if (typeof data !== 'object' || !data || Array.isArray(data)) fail('input')
  return data as Record<string, unknown>
}
function feedInput(data: Record<string, unknown>): FeedInput {
  const channels = list(data.channels, channelId, MAX_SOURCES)
  const playlists = list(data.playlists, playlistId, MAX_SOURCES)
  if (channels.length + playlists.length > MAX_SOURCES) fail('input')
  const favorites = list(data.favorites, videoId, MAX_FAVORITES)
  const hidden = list(data.hidden, videoId, MAX_PERSONAL)
  if (data.q !== undefined && (typeof data.q !== 'string' || data.q.length > 120)) fail('input')
  if (data.order !== 'old' && data.order !== 'new' && data.order !== undefined) fail('input')
  if (data.cursor !== undefined && (typeof data.cursor !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+Z\|[\w-]{11}$/.test(data.cursor) || data.cursor.length > 64)) fail('input')
  return { channels, playlists, favorites, hidden, q: data.q as string | undefined,
    order: data.order === 'old' ? 'old' : 'new', cursor: data.cursor as string | undefined }
}

const upstreamCursor = (value: string | null) => {
  if (value && !/^[\w=.+/-]{1,400}$/.test(value)) fail('input')
  return value ?? ''
}
type ApiEnv = Bindings & { REQUEST_LIMIT: RateLimit; LOOKUP_LIMIT: RateLimit }

export async function handleApi(request: Request, name: string | undefined, bindings: ApiEnv): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
  try {
    const { searchParams: q } = new URL(request.url)
    if (request.url.length > 3600) fail('input', 414)
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
    if (!(await bindings.REQUEST_LIMIT.limit({ key: ip })).success) fail('rate', 429)
    const env: Bindings = {
      ...bindings,
      limitLookup: async () => { if (!(await bindings.LOOKUP_LIMIT.limit({ key: ip })).success) fail('rate', 429) },
    }
    const id = q.get('id')
    if (request.method === 'POST') {
      if (name === 'feed') {
        const input = feedInput(await body(request))
        if (!input.cursor) await touchSources(env, input.channels, input.playlists)
        return json(await feed(env, input))
      }
      if (name === 'refresh') {
        const data = await body(request)
        const kind = data.kind
        if (kind !== 'channel' && kind !== 'playlist') fail('input')
        const key = checked(data.id, kind === 'channel' ? channelId : playlistId)
        await source(env, kind, key, undefined, true)
        await env.limitLookup?.()
        await refreshSource(env, kind, key)
        return json((await statuses(env, kind === 'channel' ? [key] : [], kind === 'playlist' ? [key] : []))[0])
      }
      fail('missing', 404)
    }
    switch (name) {
      case 'resolve': {
        const raw = q.get('url')
        if (!raw) fail('input')
        let target
        try { target = parseYouTube(raw) } catch (error) {
          throw new ApiError('input', 400, error instanceof Error ? error.message : undefined)
        }
        const value = target.kind === 'video' ? await video(env, target.id)
          : await source(env, target.kind, target.id, target.kind === 'channel' ? target.handle : undefined)
        return json({ target, value })
      }
      case 'source': {
        const kind = q.get('kind')
        if (kind !== 'channel' && kind !== 'playlist') fail('input')
        const alias = q.get('handle')
        if (alias && kind === 'channel' && !id) checked(alias, handle)
        else checked(id, kind === 'channel' ? channelId : playlistId)
        const data = await source(env, kind, id ?? undefined, alias ?? undefined, q.get('start') === '1')
        const status = (await statuses(env, kind === 'channel' ? [data.id] : [], kind === 'playlist' ? [data.id] : []))[0]
        return json({ data, status })
      }
      case 'video': return json(await video(env, checked(id, videoId)))
      case 'playlist': {
        const key = checked(id, playlistId)
        const c = q.get('cursor')
        if (c && !/^\d{1,16}:\d{1,6}$/.test(c)) fail('input')
        const [generation, after] = c?.split(':').map(Number) ?? [undefined, -1]
        return json(await playlistPage(env, key, after, generation))
      }
      case 'playlist-first': return json(await firstPlayable(env, checked(id, playlistId)) ?? null)
      case 'queue': {
        const index = q.get('index')
        if (index && !/^[1-9]\d{0,5}$/.test(index)) fail('input')
        return json(await queueWindow(env, checked(id, playlistId), checked(q.get('v'), videoId), index ? +index : undefined))
      }
      case 'channel-lists': {
        const key = checked(id, channelId)
        const cursor = upstreamCursor(q.get('cursor'))
        return json(await cachedResponse(env, `channel-lists:${key}:${cursor}`, () => getChannelPlaylists(env, key, cursor), 3600_000))
      }
      case 'comments': {
        const key = checked(id, videoId)
        const cursor = upstreamCursor(q.get('cursor'))
        const order = q.get('order') ?? 'relevance'
        if (order !== 'relevance' && order !== 'time') fail('input')
        const parent = q.get('parent') ?? undefined
        if (parent && !/^[\w.-]{1,150}$/.test(parent)) fail('input')
        const value = await cachedResponse(env, `comments:${key}:${parent ?? order}:${cursor}`, async () => {
          try { return { page: await getComments(env, key, cursor, order, parent) } }
          catch (e) {
            if (e instanceof ApiError && ['commentsDisabled', 'commentsUnavailable', 'missing'].includes(e.code)) return { code: e.code === 'missing' ? 'commentsUnavailable' : e.code }
            throw e
          }
        })
        if (value.code) fail(value.code, 403)
        return json(value.page)
      }
      default: fail('missing', 404)
    }
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.code, message: e.message }, e.status)
    console.warn('mytube API unavailable', name && /^[a-z-]{1,30}$/.test(name) ? name : 'unknown')
    const error = new ApiError('service', 503)
    return json({ error: error.code, message: error.message }, 503)
  }
}
