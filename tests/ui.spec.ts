import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { emptyLibrary } from '../src/lib/library'
import type { Channel, Item, Playlist, SyncStatus, Video } from '../src/lib/data'

test.use({ locale: 'zh-CN' })

const channelId = 'UC' + 'a'.repeat(22)
const otherId = 'UC' + 'b'.repeat(22)
const listId = 'PLtestplaylist'
const thumbnail = 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg'
const a: Video = { kind: 'video', id: 'aaaaaaaaaaa', title: '已选频道视频', thumbnail, description: '示例描述', published: '2025-01-01T12:00:00Z',
  channelId, channelTitle: '频道 A', duration: 100, embeddable: true }
const b: Video = { ...a, id: 'bbbbbbbbbbb', title: '跨频道列表成员', channelId: otherId, channelTitle: '频道 B', published: '2024-12-31T12:00:00Z' }
const channel: Channel = { kind: 'channel', id: channelId, title: '频道 A', thumbnail: '', description: '频道简介', uploads: 'UU' + 'a'.repeat(22) }
const list: Playlist = { kind: 'playlist', id: listId, title: '例子播放列表', thumbnail: '', description: '列表简介', count: 4, channelId, channelTitle: '频道 A' }
const channelLists = [list, ...['第二个列表', '第三个列表', '第四个列表'].map((title, i) => ({ ...list, title, id: `${listId}${i}` }))]
const items: Item[] = [
  { itemId: 'entry0', position: 0, videoId: a.id, video: a },
  { itemId: 'entry1', position: 1, videoId: null, video: null },
  { itemId: 'entry2', position: 2, videoId: b.id, video: b },
  { itemId: 'entry3', position: 3, videoId: a.id, video: a },
]
const comment = { id: 'comment-one', author: '公开作者', text: '<script>window.bad=true</script>\n第二行', likes: 12, published: a.published, replies: 24 }
async function mockData(page: Page, statuses: SyncStatus[] = []) {
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
      case '/api/channel-lists': return route.fulfill({ json: { items: channelLists } })
      case '/api/feed': {
        const f = route.request().postDataJSON()
        const videos = f.playlists?.includes(listId) ? [a,b] : f.channels?.includes(channelId) || f.favorites?.includes(a.id) ? [a] : []
        return route.fulfill({ json: { items: videos.filter(v => !f.hidden?.includes(v.id) && (!f.q || v.title.includes(f.q))), statuses } })
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

async function importSearchLibrary(page: Page, overrides: Partial<ReturnType<typeof emptyLibrary>> = {}) {
  await mockData(page)
  await page.goto('/settings')
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'search-library.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...emptyLibrary(), channels: [channelId], playlists: [listId], ...overrides })),
  })
  await page.getByRole('button', { name: '确认合并' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('link', { name: 'mytube 首页' }).click()
}

test('search opens with either shortcut or the header and returns focus on desktop and mobile', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: '打开搜索', exact: true }).filter({ visible: true })
  const dialog = page.getByRole('dialog', { name: '搜索我的内容库' })
  await expect(trigger).toBeVisible()
  for (const shortcut of ['Control+k', 'Meta+k']) {
    await page.keyboard.press(shortcut)
    await expect(dialog.getByRole('combobox')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  }
  await trigger.click()
  await expect(dialog.getByRole('combobox')).toBeFocused()
  await page.keyboard.press('Control+k')
  await expect(dialog).toBeHidden()
  await trigger.click()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await trigger.click()
  await expect(dialog.getByRole('combobox')).toBeFocused()
  await expect(dialog).toBeInViewport({ ratio: 1 })
  expect(await dialog.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(390)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('search updates results as you type and opens the keyboard-selected video', async ({ page }) => {
  await importSearchLibrary(page)
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: '搜索我的内容库' })
  const input = dialog.getByRole('combobox')
  await input.fill('频道')
  await expect(dialog.getByRole('option')).toHaveCount(2)
  await expect(page).toHaveURL('/')
  await expect(dialog.getByRole('option', { name: /已选频道视频/ })).toBeVisible()
  await expect(dialog.getByRole('option', { name: /跨频道列表成员/ })).toBeVisible()
  await expect(dialog.getByText('在 YouTube 搜索', { exact: true })).toHaveCount(0)
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(page).toHaveURL(`/watch?v=${b.id}`)
  await expect(dialog).toBeHidden()
})

test('search preserves the saved start time when opening a favorite', async ({ page }) => {
  await importSearchLibrary(page, { favorites: [a.id], contexts: { [a.id]: { t: '90s' } } })
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: '搜索我的内容库' })
  await dialog.getByRole('combobox').fill('已选')
  await dialog.getByRole('option', { name: /已选频道视频/ }).click()
  await expect(page).toHaveURL(`/watch?v=${a.id}&t=90s`)
})

for (const saved of [false, true]) {
  test(`search opens YouTube in a new tab for an unmatched query in an ${saved ? 'existing' : 'empty'} library`, async ({ page, context }) => {
    if (saved) await importSearchLibrary(page)
    else await page.goto('/')
    await expect(page.getByRole('button', { name: '打开搜索', exact: true }).filter({ visible: true })).toBeVisible()
    await context.route('https://www.youtube.com/results?**', route => route.fulfill({ body: '<!doctype html><title>YouTube search</title>' }))
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: '搜索我的内容库' })
    const input = dialog.getByRole('combobox')
    await input.fill('   ')
    await expect(dialog.getByRole('option')).toHaveCount(0)
    const query = '中文 & jazz/lofi?'
    await input.fill(`  ${query}  `)
    await expect(dialog.getByText('没有匹配的视频', { exact: true })).toBeVisible()
    const youtube = dialog.getByRole('option', { name: /在 YouTube 搜索/ })
    await expect(youtube).toContainText(query)
    const opened = page.waitForEvent('popup')
    if (saved) await youtube.click()
    else await input.press('Enter')
    const popup = await opened
    await expect(popup).toHaveURL('https://www.youtube.com/results?search_query=%E4%B8%AD%E6%96%87+%26+jazz%2Flofi%3F')
    expect(await popup.evaluate(() => window.opener === null)).toBe(true)
    await expect(page).toHaveURL('/')
    await popup.close()
  })
}

test('search keeps loading and older responses from becoming results for a newer query', async ({ page }) => {
  await importSearchLibrary(page)
  await page.route('**/api/feed?**', async route => {
    const { q } = route.request().postDataJSON()
    await new Promise(resolve => setTimeout(resolve, q === '旧' ? 400 : 800))
    await route.fulfill({ json: { items: q === '旧' ? [a] : [b], statuses: [] } })
  })
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: '搜索我的内容库' })
  const input = dialog.getByRole('combobox')
  const requested = page.waitForRequest(request => request.url().includes('/api/feed?') && request.postDataJSON().q === '旧')
  await input.fill('旧')
  await requested
  await input.fill('新')
  await expect(dialog.getByRole('status')).toBeVisible()
  await expect(dialog.getByRole('option')).toHaveCount(0)
  await expect(dialog.getByText('没有匹配的视频', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('option', { name: /跨频道列表成员/ })).toBeVisible()
  await expect(dialog.getByRole('option', { name: /已选频道视频/ })).toHaveCount(0)
  await input.fill('')
  await expect(dialog.getByRole('option')).toHaveCount(0)
})

test('search shows a request failure instead of claiming there are no matches', async ({ page }) => {
  await importSearchLibrary(page)
  await page.route('**/api/feed?**', route => route.fulfill({ status: 500, json: { error: 'service' } }))
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: '搜索我的内容库' })
  await dialog.getByRole('combobox').fill('频道')
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByText('没有匹配的视频', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('option', { name: /在 YouTube 搜索/ })).toHaveCount(0)
})

test('settings is available through the sidebar without duplicate navigation or labels', async ({ page }) => {
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: '内容库导航' })
  const settings = navigation.getByRole('link', { name: '设置', exact: true })
  await expect(settings).toBeVisible()
  await expect(page.getByRole('banner').getByLabel('设置', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('complementary').getByText(/^(我的内容库|个人内容库 · 仅此浏览器)$/)).toHaveCount(0)
  await settings.click()
  await expect(page).toHaveURL('/settings')
})

test('library pages show a compact title without introductory copy', async ({ page }) => {
  for (const [path, title] of [
    ['/feed/subscriptions', '订阅频道'], ['/feed/playlists', '播放列表'],
    ['/feed/favorites', '收藏'], ['/feed/history', '继续观看'], ['/results', '搜索我的内容库'], ['/settings', '设置'],
  ]) {
    await test.step(path, async () => {
      await page.goto(path)
      const heading = page.getByRole('heading', { level: 1, name: title, exact: true })
      await expect(heading).toBeVisible()
      await expect(page.getByRole('main').locator('header')).toHaveText(title)
      await expect(heading).toHaveCSS('font-size', '32px')
    })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '22px')
})

test('keeps source IDs out of filters while metadata is loading', async ({ page }) => {
  await mockData(page)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/source?**', async route => {
    await pending
    await route.fulfill({ json: { data: channel } })
  })
  try {
    await page.goto('/settings')
    await page.getByLabel('选择备份文件').setInputFiles({ name: 'library.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...emptyLibrary(), channels: [channelId] })) })
    await page.getByRole('button', { name: '确认合并' }).click()
    await page.getByRole('link', { name: 'mytube 首页' }).click()
    await expect(page.getByRole('combobox', { name: '排序' })).toBeVisible()
    await expect(page.locator('.chips')).not.toContainText(channelId)
    await expect(page.locator('.chips [data-slot="skeleton"]')).toBeVisible()
    release()
    await expect(page.locator('.chips').getByRole('button', { name: channel.title })).toBeVisible()
  } finally { release() }
})

test('restores library metadata locally and reuses feed videos on the watch page', async ({ page }) => {
  await mockData(page)
  await page.goto('/settings')
  await page.getByLabel('选择备份文件').setInputFiles({ name: 'library.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...emptyLibrary(), channels: [channelId], playlists: [listId] })) })
  await page.getByRole('button', { name: '确认合并' }).click()
  await page.getByRole('link', { name: 'mytube 首页' }).click()
  await expect(page.locator('.video-title').first()).toHaveText(a.title)
  await expect(page.locator('.chips').getByRole('button', { name: channel.title })).toBeVisible()
  await expect(page.locator('.chips').getByRole('button', { name: list.title })).toBeVisible()
  await page.getByRole('navigation', { name: '内容库导航' }).getByRole('link', { name: '播放列表', exact: true }).click()
  await page.getByRole('heading', { name: list.title, exact: true }).click()
  await expect(page.locator('.playlist-items li')).toHaveCount(4)
  await page.getByRole('link', { name: 'mytube 首页' }).click()
  await expect(page.locator('.video-title').first()).toHaveText(a.title)

  const metadataRequests: string[] = []
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (!route.request().headers()['x-mytube-background'] && ['/api/source', '/api/video', '/api/feed', '/api/playlist'].includes(path)) metadataRequests.push(path)
    return route.abort('internetdisconnected')
  })
  await page.reload()
  await expect(page.locator('.video-title').first()).toHaveText(a.title)
  await expect(page.locator('.chips').getByRole('button', { name: channel.title })).toBeVisible()
  await expect(page.locator('.chips').getByRole('button', { name: list.title })).toBeVisible()
  await page.locator('.video-title').first().click()
  await expect(page.getByRole('heading', { name: a.title, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '播放视频', exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: '内容库导航' }).getByRole('link', { name: '播放列表', exact: true }).click()
  await page.getByRole('heading', { name: list.title, exact: true }).click()
  await expect(page.locator('.playlist-items li')).toHaveCount(4)
  expect(metadataRequests).toEqual([])

  // Age the browser cache without delaying the suite; failed revalidation must keep its data.
  await page.addInitScript(() => {
    const now = Date.now
    Date.now = () => now() + 15 * 60_000
  })
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'configuration' } }))
  await page.reload()
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: list.title, exact: true })).toBeVisible()
  await expect(page.locator('.playlist-items li')).toHaveCount(4)
  await page.locator('.playlist-item-link').first().click()
  await expect(page.getByRole('heading', { name: a.title, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '播放视频', exact: true })).toBeVisible()
})

test('keeps a newly saved video visible using its locally resolved metadata', async ({ page }) => {
  await mockData(page)
  await page.route('**/api/resolve?**', route => route.fulfill({ json: { target: { kind: 'video', id: a.id }, value: a } }))
  await page.goto('/settings')
  await page.getByRole('button', { name: '添加内容', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('YouTube 链接').fill(`https://youtu.be/${a.id}`)
  await dialog.getByRole('button', { name: '解析链接' }).click()
  await expect(dialog.getByText(a.title, { exact: true })).toBeVisible()
  await page.route('**/api/feed?**', route => route.fulfill({ status: 503, json: { error: 'configuration' } }))
  await page.route('**/api/video?**', route => route.fulfill({ status: 503, json: { error: 'configuration' } }))
  await dialog.getByRole('button', { name: '只保存此视频' }).click()
  await page.getByRole('navigation', { name: '内容库导航' }).getByRole('link', { name: '收藏', exact: true }).click()
  await expect(page.locator('.video-title')).toHaveText(a.title)
  await page.reload()
  await expect(page.locator('.video-title')).toHaveText(a.title)
})

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

test('channel playlists fit four cards across on desktop and open the full playlist', async ({ page }) => {
  await mockData(page)
  await page.goto('/@example/playlists')
  await expect(page.getByRole('heading', { name: channel.title, exact: true })).toHaveCSS('font-size', '32px')
  await expect(page.getByText('仅订阅到此浏览器', { exact: true })).toHaveCount(0)
  const cards = page.locator('.playlist-card')
  await expect(cards).toHaveCount(4)
  const tops = () => cards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top))
  await expect.poll(async () => new Set(await tops()).size).toBe(1)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => new Set(await tops()).size).toBe(2)
  const first = cards.first()
  await expect(first.getByText('4 部视频', { exact: true })).toBeVisible()
  await first.getByText('查看完整播放列表', { exact: true }).click()
  await expect(page).toHaveURL(`/playlist?list=${listId}`)
})

test('playlist gesture, duplicate position, progress restoration, and deferred avatar-free comments', async ({ page }) => {
  await mockData(page)
  await page.goto(`/playlist?list=${listId}`)
  await expect(page.getByRole('heading', { name: list.title, exact: true })).toHaveCSS('font-size', '26px')
  await expect(page.getByText('公开播放列表', { exact: true })).toHaveCount(0)
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
  await mockData(page, [{ kind: 'channel', id: channelId, count: 1, complete: false, checked: 0, due: 0 }])
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
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '排序' })).toBeVisible()
  await expect(page.getByText('1 个来源尚未同步完毕。当前仅显示已同步内容。')).toHaveCount(0)
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
