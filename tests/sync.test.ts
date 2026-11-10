import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Miniflare } from 'miniflare'
import { enroll, runScheduled, runSource } from '../src/server/sync'
import { feed, playlistPage } from '../src/server/queries'
import type { Bindings } from '../src/server/db'

const channel = 'UC' + 'a'.repeat(22)
const other = 'UC' + 'b'.repeat(22)
const playlist = 'PLexample1234'
const id = (n: number) => String(n).padStart(11, 'x')
let mf: Miniflare
let env: Bindings
let contents: Record<string, number[]>
let breakSecond: boolean
let upstream: string[]
let quota: boolean

beforeEach(async () => {
  contents = { uploads: Array.from({ length: 33 }, (_, i) => i + 1), other: [90], [playlist]: [90, 2, 2, 99, 4] }
  breakSecond = quota = false
  upstream = []
  mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: ['DB'], compatibilityDate: '2026-07-30' })
  env = { DB: await mf.getD1Database('DB') as unknown as D1Database, YOUTUBE_API_KEY: 'fixture' }
  for (const file of ['0001_public_cache.sql', '0002_uploads.sql', '0003_retire_snapshots.sql']) {
    const sql = await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8')
    await env.DB.batch(sql.match(/\s*CREATE TRIGGER[\s\S]*?^END;|[^;]+;/gm)!.map(s => env.DB.prepare(s.trim())))
  }
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input)
    const p = url.searchParams
    const endpoint = url.pathname.split('/').at(-1)!
    upstream.push(endpoint)
    if (quota) return Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 })
    if (endpoint === 'playlistItems') {
      const values = contents[p.get('playlistId')!] ?? []
      const cursor = +(p.get('pageToken') ?? 0)
      if (cursor && breakSecond) throw new Error('fixture network interruption')
      const rows = values.slice(cursor, cursor + 24)
      return Response.json({ items: rows.map((n, i) => ({ id: 'entry' + (i + cursor), snippet: { position: i + cursor, resourceId: { videoId: id(n) } } })), nextPageToken: cursor + rows.length < values.length ? String(cursor + rows.length) : undefined })
    }
    if (endpoint === 'videos') return Response.json({ items: p.get('id')!.split(',').filter(key => key !== id(99)).map(key => ({
      id: key, snippet: { title: 'Video ' + key.slice(-2).padStart(2, '0').replace('x','0'), channelId: key === id(90) ? other : channel,
        channelTitle: key === id(90) ? 'Other' : 'Selected', publishedAt: '2025-01-' + key.slice(-2).padStart(2, '0').replace('x','0').replace('x', '0') },
      status: { privacyStatus: 'public', embeddable: true }, contentDetails: { duration: 'PT1M' },
    })) })
    throw new Error('Unexpected fixture request')
  })
})
afterEach(async () => { vi.unstubAllGlobals(); await mf.dispose() })

function channelSource(key = channel) {
  return { kind: 'channel' as const, id: key, uploads: key === channel ? 'uploads' : 'other', title: key, thumbnail: '', description: '' }
}
const listSource = { kind: 'playlist' as const, id: playlist, title: 'Mixed', thumbnail: '', description: '', channelId: channel, channelTitle: 'Selected', count: 5 }
const forceDue = () => env.DB.prepare('UPDATE job SET due=0').run()
const library = (channels: string[], playlists: string[] = [], q = '') => feed(env, { channels, playlists, q, order: 'new' })

it('leases one batch across concurrent callers and completes history on a later cron, searchable beyond page one', async () => {
  await enroll(env, channelSource())
  await Promise.all([runSource(env, 'channel', channel), runSource(env, 'channel', channel)])
  expect(upstream).toEqual(['playlistItems', 'videos'])
  expect((await library([channel], [], 'Video 33')).items).toEqual([])
  expect((await library([channel])).statuses[0].checked).toBeGreaterThan(0)
  await forceDue()
  await runScheduled({ ...env })
  expect((await library([channel], [], 'Video 33')).items.map(v => v.id)).toEqual([id(33)])
  expect((await library([channel])).statuses[0]).toMatchObject({ complete: true, count: 33 })
})
it('keeps cross-source scope, duplicate playlist items and unavailable positions during an interrupted rescan', async () => {
  await enroll(env, listSource)
  await enroll(env, channelSource(other))
  await runSource(env, 'channel', other)
  await runSource(env, 'playlist', playlist)
  expect((await library([channel], [], 'Other')).items).toEqual([])
  expect((await library([channel], [playlist], 'Other')).items.map(v => v.id)).toEqual([id(90)])
  const previous = (await playlistPage(env, playlist)).items.map(x => [x.videoId, !!x.video])
  expect(previous).toEqual([[id(90), true], [id(2), true], [id(2), true], [id(99), false], [id(4), true]])
  contents[playlist] = [4, ...Array.from({ length: 27 }, () => 2)]
  await forceDue()
  await runSource(env, 'playlist', playlist)
  breakSecond = true
  await forceDue()
  await runSource(env, 'playlist', playlist)
  expect((await playlistPage(env, playlist)).items.map(x => [x.videoId, !!x.video])).toEqual(previous)
  breakSecond = false
  await forceDue()
  await runSource(env, 'playlist', playlist)
  const reordered = await playlistPage(env, playlist)
  expect(reordered.items.slice(0, 2).map(x => x.videoId)).toEqual([id(4), id(2)])
  expect(reordered.items).toHaveLength(28)
})
it('keeps completed cache during quota blocks and stops touching inactive sources', async () => {
  contents.uploads = [1]
  await enroll(env, channelSource())
  await runSource(env, 'channel', channel)
  contents.uploads = [3, 1]
  quota = true
  await forceDue()
  await runScheduled(env)
  expect((await library([channel])).statuses[0]).toMatchObject({ complete: true, error: 'quota', count: 1 })
  const calls = upstream.length
  await forceDue()
  await runScheduled(env)
  expect(upstream).toHaveLength(calls)
  quota = false
  await env.DB.batch([env.DB.prepare('DELETE FROM budget'), env.DB.prepare('UPDATE source SET seen=0')])
  await forceDue()
  await runScheduled(env)
  expect(upstream).toHaveLength(calls)
  await enroll(env, channelSource())
  await runScheduled(env)
  expect((await library([channel], [], 'Video 03')).items).toHaveLength(1)
})

it('resumes a persisted cursor after an expired lease and excludes a still-leased job', async () => {
  await enroll(env, channelSource())
  await runSource(env, 'channel', channel)
  await forceDue()
  await env.DB.prepare("UPDATE job SET lease='abandoned', lease_until=?").bind(Date.now() + 90_000).run()
  const calls = upstream.length
  await runScheduled(env)
  expect(upstream).toHaveLength(calls)
  await env.DB.prepare('UPDATE job SET lease_until=1').run()
  await runScheduled({ ...env })
  expect((await library([channel])).statuses[0]).toMatchObject({ count: 33, complete: true })
})

it('pauses before calling YouTube when storage is near the soft threshold', async () => {
  await enroll(env, channelSource())
  await runSource({ ...env, DB_SOFT_BYTES: '1' }, 'channel', channel)
  expect(upstream).toEqual([])
  expect((await library([channel])).statuses[0]).toMatchObject({ error: 'storage', complete: false, count: 0 })
  await forceDue()
  await runScheduled(env)
  expect((await library([channel])).statuses[0]).toMatchObject({ count: 24, complete: false })
})

it('shows a shared sync-budget pause and resumes after the budget window advances', async () => {
  await enroll(env, channelSource())
  const limited = { ...env, SYNC_DAILY_LIMIT: '1' }
  await runSource(limited, 'channel', channel)
  await forceDue()
  await runScheduled(limited)
  expect((await feed(limited, { channels: [channel], order: 'new' })).statuses[0]).toMatchObject({ error: 'budget', count: 24, complete: false })
  await env.DB.prepare('DELETE FROM budget').run()
  await runScheduled(limited)
  expect((await feed(limited, { channels: [channel], order: 'new' })).statuses[0]).toMatchObject({ count: 33, complete: true })
})

it('classifies missing and restricted credentials without exposing upstream messages', async () => {
  const { getChannel } = await import('../src/server/youtube')
  await expect(getChannel({ ...env, YOUTUBE_API_KEY: undefined }, { id: channel })).rejects.toMatchObject({ code: 'configuration' })
  vi.stubGlobal('fetch', async () => Response.json({
    error: { message: 'private fixture details', details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }] },
  }, { status: 403 }))
  await expect(getChannel(env, { id: channel })).rejects.toMatchObject({ code: 'credentials', status: 503 })
})

it('projects avatar-free plain text and requests the independent reply cursor', async () => {
  const { getComments } = await import('../src/server/youtube')
  const calls: string[] = []
  const raw = { id: 'comment', snippet: { authorDisplayName: 'fixture', authorChannelId: { value: other }, textDisplay: '<b>literal</b>',
    likeCount: 2, publishedAt: '2025-01-01T00:00:00Z', authorProfileImageUrl: 'https://example.test/avatar' } }
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input)
    expect(url.searchParams.get('textFormat')).toBe('plainText')
    expect(url.searchParams.get('fields')).not.toContain('authorProfileImageUrl')
    if (url.pathname.endsWith('/commentThreads')) {
      calls.push('top:' + url.searchParams.get('order'))
      return Response.json({ items: [{ snippet: { topLevelComment: raw, totalReplyCount: 41 } }] })
    }
    calls.push('reply:' + url.searchParams.get('parentId') + ':' + url.searchParams.get('pageToken'))
    return Response.json({ items: [raw], nextPageToken: 'tail' })
  })
  const top = await getComments(env, id(1), '', 'time')
  expect(top.items[0]).toEqual({ id: 'comment', author: 'fixture', channelId: other, text: '<b>literal</b>', likes: 2,
    published: '2025-01-01T00:00:00Z', replies: 41 })
  expect((await getComments(env, id(1), 'second', 'time', 'comment')).next).toBe('tail')
  expect(calls).toEqual(['top:time', 'reply:comment:second'])
})
