import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { emptyLibrary } from '../src/lib/library'
import type { Channel, Item, Playlist, Video } from '../src/lib/data'

test.use({ locale: 'zh-CN' })

const channelId = 'UC' + 'a'.repeat(22)
const otherId = 'UC' + 'b'.repeat(22)
const listId = 'PLtestplaylist'
const thumbnail = 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg'
const a: Video = { kind: 'video', id: 'aaaaaaaaaaa', title: '已选频道视频', thumbnail, description: '示例描述', published: '2025-01-01T12:00:00Z',
  channelId, channelTitle: '频道 A', duration: 100, embeddable: true }
const b: Video = { ...a, id: 'bbbbbbbbbbb', title: '跨频道列表成员', channelId: otherId, channelTitle: '频道 B' }
const channel: Channel = { kind: 'channel', id: channelId, title: '频道 A', thumbnail: '', description: '频道简介', uploads: 'UU' + 'a'.repeat(22) }
const list: Playlist = { kind: 'playlist', id: listId, title: '例子播放列表', thumbnail: '', description: '列表简介', count: 4, channelId, channelTitle: '频道 A' }
const items: Item[] = [
  { itemId: 'entry0', position: 0, videoId: a.id, video: a },
  { itemId: 'entry1', position: 1, videoId: null, video: null },
  { itemId: 'entry2', position: 2, videoId: b.id, video: b },
  { itemId: 'entry3', position: 3, videoId: a.id, video: a },
]
const comment = { id: 'comment-one', author: '公开作者', text: '<script>window.bad=true</script>\n第二行', likes: 12, published: a.published, replies: 24 }
async function mockData(page: Page) {
  await page.route(thumbnail, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="black"/><rect y="45" width="480" height="270" fill="white"/></svg>',
  }))
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    const q = url.searchParams
    switch (url.pathname) {
      case '/api/resolve': return route.fulfill({ json: { target: { kind: 'channel', id: channelId }, value: channel } })
      case '/api/source': return route.fulfill({ json: { data: q.get('kind') === 'playlist' ? list : channel } })
      case '/api/feed': {
        const f = route.request().postDataJSON()
        const videos = f.playlists?.includes(listId) ? [a,b] : f.channels?.includes(channelId) || f.favorites?.includes(a.id) ? [a] : []
        return route.fulfill({ json: { items: videos.filter(v => !f.hidden?.includes(v.id) && (!f.q || v.title.includes(f.q))), statuses: [] } })
      }
      case '/api/playlist': return route.fulfill({ json: { items } })
      case '/api/video': return route.fulfill({ json: q.get('id') === b.id ? b : a })
      case '/api/queue': {
        const position = q.get('v') === a.id ? (q.get('index') === '4' ? 3 : 0) : 2
        return route.fulfill({ json: { items, position, complete: true, first: items[0],
          previous: position === 2 ? items[0] : position === 3 ? items[2] : undefined,
          next: position === 0 ? items[2] : position === 2 ? items[3] : undefined } })
      }
      case '/api/comments': {
        if (q.get('id') === b.id) return route.fulfill({ status: 403, json: { error: 'commentsDisabled', message: '此视频已关闭评论。' } })
        if (q.get('parent')) return route.fulfill({ json: { items: [{ ...comment, id: q.get('cursor') ? 'reply2' : 'reply1',
          text: q.get('cursor') ? '后一页回复' : '第一页回复', replies: 0 }], next: q.get('cursor') ? undefined : 'replynext' } })
        if (q.get('order') === 'time') return route.fulfill({ json: { items: [] } })
        return route.fulfill({ json: { items: [{ ...comment, id: q.get('cursor') ? 'comment-two' : comment.id }], next: q.get('cursor') ? undefined : 'next' } })
      }
      default: return route.fulfill({ status: 404, json: { error: 'missing', message: 'fixture resource not found' } })
    }
  })
  await page.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({ body: '<!doctype html><title>Controlled player frame</title>' }))
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.YT={Player:class {
      constructor(el,o) {
        this.start=Number(new URL(el.src).searchParams.get('start'));
        this.began=performance.now(); this.cb=o.events.onStateChange;
        this.getCurrentTime=()=>this.start+5+(performance.now()-this.began)/1000;
        this.getDuration=()=>100; this.destroy=()=>el.remove();
        window.fixtureEnd=()=>this.cb({data:0,target:this});
        setTimeout(()=>{o.events.onReady({target:this});this.cb({data:1,target:this})},30);
      }
    }}; window.onYouTubeIframeAPIReady();`,
  }))
}

test('watch poster fills the player before playback', async ({ page }) => {
  await mockData(page)
  await page.goto(`/watch?v=${a.id}`)
  const player = page.getByRole('region', { name: '视频播放器' })
  const poster = player.locator('img')
  await expect(poster).toHaveJSProperty('naturalWidth', 480)
  expect(await poster.boundingBox()).toEqual(await player.boundingBox())
  await expect(poster).toHaveCSS('object-fit', 'cover')

  await page.getByRole('button', { name: '影院模式' }).click()
  expect(await poster.boundingBox()).toEqual(await player.boundingBox())

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await poster.boundingBox()).toEqual(await player.boundingBox())
})

test('playlist gesture, duplicate position, progress restoration, and deferred avatar-free comments', async ({ page }) => {
  await mockData(page)
  await page.goto(`/playlist?list=${listId}`)
  await expect(page.locator('.playlist-items li')).toHaveCount(4)
  await expect(page.getByText('此视频不可用')).toBeVisible()
  await page.getByRole('button', { name: '播放全部' }).click()
  await expect(page.locator('iframe')).toHaveAttribute('src', /aaaaaaaaaaa\?.*autoplay=1/)
  await expect(page.locator('iframe')).toHaveAttribute('src', /[?&]hl=zh-CN(?:&|$)/)
  await expect(page.locator('.queue-current')).toHaveText(/已选频道视频/)
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName('mytube-playback-progress').length)).toBeGreaterThan(0)
  await page.evaluate(() => (window as Window & { fixtureEnd?: () => void }).fixtureEnd?.())
  await expect(page).toHaveURL(/v=bbbbbbbbbbb.*index=3/)
  await expect(page.locator('iframe')).toHaveAttribute('src', /bbbbbbbbbbb/)
  await expect(page.getByText('此视频已关闭评论。')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '播放视频', exact: true })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)

  await page.goto(`/watch?v=${a.id}&list=${listId}&index=2`)
  await expect(page).toHaveURL(/index=1/)
  await expect(page.getByText(/将从 0:0[5-9] 开始播放/)).toBeVisible()
  await page.getByRole('heading', { name: '公开评论' }).scrollIntoViewIfNeeded()
  await expect(page.getByText('<script>window.bad=true</script>', { exact: false })).toBeVisible()
  await expect(page.locator('.comments script, .comments img')).toHaveCount(0)
  await page.getByRole('button', { name: '展开 24 条回复' }).click()
  await expect(page.getByText('第一页回复')).toBeVisible()
  await page.locator('.replies').getByRole('button', { name: '加载更多' }).click()
  await expect(page.getByText('后一页回复')).toBeVisible()
  await page.getByRole('combobox', { name: '评论排序' }).selectOption('time')
  await expect(page.getByText('暂无公开评论。')).toBeVisible()
  await expect(page.getByText('后一页回复')).toHaveCount(0)
})

test('mobile dark plum portals, backup merge, hidden restore, and isolation', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockData(page)
  await page.goto('/settings')
  await page.getByLabel('主题').selectOption('dark')
  await expect(page.locator('.ds-theme')).toHaveAttribute('data-accent-color', 'plum')
  await expect(page.locator('.ds-theme')).toHaveClass(/dark/)
  const selectFile = page.getByLabel('选择备份文件')
  const invalid = Buffer.from('{"schemaVersion":2}')
  await selectFile.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: invalid })
  await expect(page.getByText('无法导入备份')).toBeVisible()
  await selectFile.setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.alloc(500_001) })
  await expect(page.getByText(/超过 500 KB/)).toBeVisible()
  const backup = { ...emptyLibrary(), channels: [channelId], playlists: [listId], favorites: [a.id], hidden: [b.id] }
  for (const repeat of [false, true]) {
    await selectFile.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('预览合并')).toBeVisible()
    await expect(page.locator('.ds-theme.dark [data-theme-portal]').getByRole('dialog')).toHaveCount(1)
    await expect(dialog.locator('dd').first()).toHaveText(repeat ? '+0' : '+1')
    await dialog.getByRole('button', { name: '确认合并' }).click()
    await expect(dialog).toBeHidden()
  }
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON' }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toMatch(/^mytube-.*\.json$/)
  const exported = await readFile(await download.path())
  expect(JSON.parse(exported.toString())).toMatchObject({ schemaVersion: 1, channels: [channelId], favorites: [a.id] })
  await page.getByRole('link', { name: 'mytube 首页' }).click()
  await expect(page.locator('.video-title')).toHaveCount(1)
  await page.getByRole('button', { name: '已选频道视频的操作' }).click()
  await expect(page.locator('.ds-theme.dark [data-theme-portal]').getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: '隐藏视频' }).click()
  await expect(page.locator('.video-title')).toHaveCount(0)
  await page.getByRole('button', { name: '切换导航' }).click()
  await page.getByRole('navigation', { name: '内容库导航' }).getByRole('link', { name: '设置' }).click()
  await expect(page.getByRole('heading', { name: '隐藏的视频' })).toBeVisible()
  await page.getByRole('button', { name: '恢复显示' }).filter({ visible: true }).last().click()
  await page.reload()
  await expect(page.locator('.ds-theme')).toHaveClass(/dark/)
  const another = await browser.newContext({ locale: 'zh-CN' })
  const fresh = await another.newPage()
  await mockData(fresh)
  const home = page.url().replace('/settings', '/')
  await fresh.goto(home)
  await expect(fresh.getByText('你的内容库还是空的')).toBeVisible()
  await fresh.goto(home + 'settings')
  await fresh.getByLabel('选择备份文件').setInputFiles({ name: 'exported.json', mimeType: 'application/json', buffer: exported })
  await fresh.getByRole('button', { name: '确认合并' }).click()
  await fresh.getByRole('link', { name: 'mytube 首页' }).click()
  await expect(fresh.locator('.video-title')).toHaveCount(1)
  await fresh.goto(home + 'settings')
  await fresh.getByRole('button', { name: '清空本地个人数据' }).click()
  await expect(fresh.getByRole('dialog')).toBeVisible()
  await fresh.getByRole('button', { name: '确认清空' }).click()
  await fresh.getByRole('link', { name: 'mytube 首页' }).click()
  await expect(fresh.getByText('你的内容库还是空的')).toBeVisible()
  await another.close()
})
