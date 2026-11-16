import { expect, test } from 'vitest'
import { newMetadataJob, syncMetadataStep, type MetadataJob, type MetadataPage, type MetadataRequest, type MetadataWrite } from '../src/lib/metadata-sync'
import type { Playlist, SyncStatus, Video } from '../src/lib/data'

const channelId = 'UC' + 'a'.repeat(22)
const playlist = (id: string): Playlist => ({ kind: 'playlist', id, title: id, thumbnail: '', description: '', count: 1, channelId, channelTitle: 'Channel' })
const video = (id: string): Video => ({ kind: 'video', id, title: id, description: '', thumbnail: '', channelId, channelTitle: 'Channel', published: '2026-01-01T00:00:00Z', duration: 90, embeddable: true })
const source = (complete: boolean, count: number, checked: number) => ({ data: playlist('PLfixture01'),
  status: { kind: 'playlist', id: 'PLfixture01', complete, count, checked, due: 100_000 } satisfies SyncStatus })

function state(initial: MetadataJob) {
  let job = structuredClone(initial)
  const pages = new Map<string, MetadataPage>()
  return {
    job: () => job,
    pages,
    active: () => [...pages].filter(([key]) => key.startsWith(`${job.key}:${job.activeEpoch}:`)).flatMap<MetadataPage['items'][number]>(([, page]) => page.items),
    step: (request: MetadataRequest, now = 1000, signal = new AbortController().signal) => syncMetadataStep(job, request, async (next, data: MetadataWrite) => {
      if (data.page) pages.set(`${data.page.collection}:${data.page.index}`, structuredClone(data.page.data))
      job = structuredClone(next)
    }, signal, now),
  }
}
const response = (value: unknown): MetadataRequest => async <T>() => structuredClone(value) as T

test('replaces a failed channel-list scan without retaining pages from its invalid cursor', async () => {
  const cache = state({ ...newMetadataJob('channel-lists', channelId), epoch: 'failed', page: 1, cursor: 'invalid' })
  cache.pages.set(`channel-lists:${channelId}:failed:1`, { items: [playlist('PLobsolete')] })
  await cache.step(async () => { throw { code: 'page' } })
  await cache.step(response({ items: [playlist('PLcurrent')] }), 10_000)
  expect(cache.active().map(item => 'id' in item ? item.id : undefined)).toEqual(['PLcurrent'])
})

test('keeps polling an incomplete upstream and only completes a verified full snapshot', async () => {
  const cache = state(newMetadataJob('playlist', 'PLfixture01'))
  await cache.step(response(source(false, 1, 1)))
  await cache.step(response({ items: [{ itemId: 'one', position: 0, videoId: 'aaaaaaaaaaa', video: video('aaaaaaaaaaa') }] }))
  await cache.step(response(source(false, 1, 1)))
  expect(cache.job().complete).toBe(false)
  expect(cache.job().nextAttempt).toBe(61_000)
  await cache.step(response(source(true, 2, 2)), 61_000)
  await cache.step(response({ items: [
    { itemId: 'one', position: 0, videoId: 'aaaaaaaaaaa', video: video('aaaaaaaaaaa') },
    { itemId: 'two', position: 1, videoId: 'bbbbbbbbbbb', video: video('bbbbbbbbbbb') },
  ] }), 62_000)
  expect(cache.job().complete).toBe(false)
  await cache.step(response(source(true, 2, 2)), 63_000)
  expect(cache.job().complete).toBe(true)
  expect(cache.active()).toHaveLength(2)
})

test('retains the saved cursor when a request is interrupted', async () => {
  const cache = state({ ...newMetadataJob('playlist', 'PLfixture01'), phase: 'pages', cursor: '1:29', page: 1 })
  const controller = new AbortController()
  await expect(cache.step(async () => {
    controller.abort()
    throw controller.signal.reason
  }, 1000, controller.signal)).rejects.toBeDefined()
  expect(cache.job().cursor).toBe('1:29')
  expect(cache.job().page).toBe(1)
})

test('backs off on rate limits without losing pagination progress', async () => {
  const cache = state({ ...newMetadataJob('playlist', 'PLfixture01'), phase: 'pages', cursor: '1:29', page: 1 })
  await cache.step(async () => { throw { code: 'rate' } }, 5000)
  expect(cache.job().cursor).toBe('1:29')
  expect(cache.job().page).toBe(1)
  expect(cache.job().nextAttempt).toBe(65_000)
})

test('rechecks a changed source from the first page while preserving its previous complete snapshot', async () => {
  const cache = state({ ...newMetadataJob('playlist', 'PLfixture01'), phase: 'verify', activeEpoch: 'previous', revision: '1:1:true' })
  cache.pages.set('playlist:PLfixture01:previous:0', { items: [{ itemId: 'one', position: 0, videoId: 'aaaaaaaaaaa', video: video('aaaaaaaaaaa') }] })
  await cache.step(response(source(true, 2, 2)))
  expect(cache.job().phase).toBe('pages')
  expect(cache.job().cursor).toBeUndefined()
  expect(cache.job().complete).toBe(false)
  expect(cache.active()).toHaveLength(1)
})
