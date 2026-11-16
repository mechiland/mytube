import { expect, test, type Page } from '@playwright/test'
import { emptyLibrary } from '../src/lib/library'
import type { Channel, Item, Playlist, Video } from '../src/lib/data'

test.use({ locale: 'zh-CN' })
const channelId = 'UC' + 'z'.repeat(22)
const listId = 'PLbackground01'
const videoId = (n: number) => 'bg' + String(n).padStart(9, '0')
const channel: Channel = { kind: 'channel', id: channelId, title: '后台频道', uploads: 'UU' + 'z'.repeat(22), thumbnail: '', description: '' }
const list: Playlist = { kind: 'playlist', id: listId, title: '完整后台列表', count: 65, channelId, channelTitle: channel.title, thumbnail: '', description: '' }
const video = (n: number): Video => ({ kind: 'video', id: videoId(n), title: `后台视频 ${n}`, channelId,
  channelTitle: channel.title, description: '', thumbnail: '', published: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`, duration: 90, embeddable: true, public: true })
const channelVideos = Array.from({ length: 50 }, (_, i) => video(50 - i))
const members: Item[] = Array.from({ length: 65 }, (_, position) => ({ itemId: `background-item-${position}`, position,
  videoId: position === 4 ? null : videoId(position === 64 ? 1 : position + 1), video: position === 4 ? null : video(position === 64 ? 1 : position + 1) }))
const status = (kind: 'channel' | 'playlist') => ({ kind, id: kind === 'channel' ? channelId : listId,
  count: kind === 'channel' ? 50 : 65, checked: 1, complete: true, due: 4_102_444_800_000 })

async function fixtures(page: Page, requests: string[], hold?: (cursor: string) => Promise<void>) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const q = url.searchParams
    const cursor = q.get('cursor') ?? ''
    switch (url.pathname) {
      case '/api/source': return route.fulfill({ json: { data: q.get('kind') === 'playlist' ? list : channel, status: status(q.get('kind') === 'playlist' ? 'playlist' : 'channel') } })
      case '/api/feed': {
        const input = route.request().postDataJSON()
        requests.push(`feed:${input.cursor ?? ''}`)
        const values = input.channels?.includes(channelId) ? channelVideos : []
        const offset = input.cursor ? values.findIndex(value => value.id === String(input.cursor).split('|').at(-1)) + 1 : 0
        const last = values[offset + 23]
        return route.fulfill({ json: { items: values.slice(offset, offset + 24), next: offset + 24 < values.length ? `${last.published}|${last.id}` : undefined,
          statuses: input.channels?.includes(channelId) ? [status('channel')] : [] } })
      }
      case '/api/playlist': {
        requests.push(`playlist:${cursor}`)
        if (cursor && hold) await hold(cursor)
        const offset = cursor ? Number(cursor.split(':')[1]) + 1 : 0
        return route.fulfill({ json: { items: members.slice(offset, offset + 30), next: offset + 30 < members.length ? `1:${offset + 29}` : undefined } })
      }
      case '/api/channel-lists':
        requests.push(`channel-lists:${cursor}`)
        return route.fulfill({ json: { items: [{ ...list, id: cursor ? 'PLbackground02' : listId, title: cursor ? '频道的第二页列表' : list.title }], next: cursor ? undefined : 'second' } })
      case '/api/video':
        requests.push(`video:${q.get('id')}`)
        return route.fulfill({ json: video(Number(q.get('id')!.slice(2))) })
      case '/api/comments': return route.fulfill({ json: { items: [] } })
      default: return route.fulfill({ status: 404, json: { error: 'missing' } })
    }
  })
}

async function importLibrary(page: Page, library: ReturnType<typeof emptyLibrary>) {
  await page.goto('/settings')
  await page.getByLabel('选择备份文件').setInputFiles({ name: 'library.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(library)) })
  await page.getByRole('button', { name: '确认合并' }).click()
}

test('fills every library page in the background before those pages are visited', async ({ page }) => {
  const requests: string[] = []
  await fixtures(page, requests)
  await importLibrary(page, { ...emptyLibrary(), channels: [channelId], playlists: [listId], favorites: [videoId(900)], hidden: [videoId(901)],
    progress: { [videoId(902)]: { at: 20, duration: 90, updatedAt: 1 } } })
  await expect.poll(() => requests.includes(`feed:2026-01-01T00:00:03.000Z|${videoId(3)}`), { timeout: 25_000 }).toBe(true)
  await expect.poll(() => requests.includes('playlist:1:59'), { timeout: 25_000 }).toBe(true)
  await expect.poll(() => requests.includes('channel-lists:second'), { timeout: 25_000 }).toBe(true)
  for (const n of [900, 901, 902]) await expect.poll(() => requests.includes(`video:${videoId(n)}`)).toBe(true)
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mytube-library')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const request = db.transaction('jobs').objectStore('jobs').getAll()
        request.onsuccess = () => resolve(request.result.length === 6 && request.result.every(job => job.complete))
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  }), { timeout: 15_000 }).toBe(true)
  await expect(page).toHaveURL('/settings')

  const unexpected: string[] = []
  await page.route('**/api/**', route => {
    unexpected.push(new URL(route.request().url()).pathname)
    return route.abort('internetdisconnected')
  })
  await page.goto(`/channel/${channelId}`)
  await expect(page.locator('.video-title')).toHaveCount(24)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.video-title')).toHaveCount(48)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.video-title')).toHaveCount(50)
  await page.goto(`/playlist?list=${listId}`)
  await expect(page.locator('.playlist-items li')).toHaveCount(30)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.playlist-items li')).toHaveCount(60)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.playlist-items li')).toHaveCount(65)
  await expect(page.getByText('此视频不可用', { exact: true })).toBeVisible()
  await page.goto(`/watch?v=${videoId(63)}`)
  await expect(page.getByRole('heading', { level: 1, name: '后台视频 63', exact: true })).toBeVisible()
  expect(unexpected.filter(path => path !== '/api/comments')).toEqual([])
})

test('resumes a saved pagination cursor after reload', async ({ page }) => {
  const requests: string[] = []
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let paused = true
  await fixtures(page, requests, async () => { if (paused) await pending })
  try {
    await importLibrary(page, { ...emptyLibrary(), playlists: [listId] })
    await expect.poll(() => requests.includes('playlist:1:29'), { timeout: 15_000 }).toBe(true)
    await page.reload()
    paused = false
    release()
    await expect.poll(() => requests.includes('playlist:1:59'), { timeout: 15_000 }).toBe(true)
    expect(requests.filter(value => value === 'playlist:')).toHaveLength(1)
  } finally { release() }
})

test('pauses the background queue after a rate limit and resumes automatically', async ({ page }) => {
  await page.clock.install()
  let attempts = 0
  await page.route('**/api/video?**', route => {
    attempts++
    return route.fulfill(attempts === 1 ? { status: 429, json: { error: 'rate' } }
      : { json: video(Number(new URL(route.request().url()).searchParams.get('id')!.slice(2))) })
  })
  await importLibrary(page, { ...emptyLibrary(), favorites: [videoId(900), videoId(901)] })
  await expect.poll(() => attempts, { timeout: 10_000 }).toBe(1)
  await page.waitForTimeout(2500)
  expect(attempts).toBe(1)
  await page.clock.fastForward(65_000)
  await expect.poll(() => attempts).toBeGreaterThan(1)
})
