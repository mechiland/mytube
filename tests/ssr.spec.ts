import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const channelId = 'UC' + 's'.repeat(22)
const video = { kind: 'video', id: 'ssrfixture1', title: '服务端视频标题', description: '服务端描述',
  thumbnail: '', channelId, channelTitle: '服务端频道', published: '2026-01-01T00:00:00Z', duration: 90, embeddable: true }
const channel = { kind: 'channel', id: channelId, title: '服务端频道', handle: '@ssrfixture', uploads: 'UU' + 's'.repeat(22), thumbnail: '', description: '频道介绍' }
const playlist = { kind: 'playlist', id: 'PLssrfixture01', title: '服务端播放列表', description: '列表介绍', thumbnail: '', channelId, channelTitle: channel.title, count: 1 }
const sqlValue = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'`
const execute = (command: string) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'mytube', '--local', '--command', command], { stdio: 'pipe' })

test.describe('server rendered pages', () => {
  test.use({ javaScriptEnabled: false, locale: 'zh-CN' })

  test.beforeAll(() => {
    execute(`INSERT OR REPLACE INTO source VALUES ('channel','${channelId}',${sqlValue(channel)},'@ssrfixture','${channel.uploads}',4102444800000,0);
      INSERT OR REPLACE INTO source VALUES ('playlist','PLssrfixture01',${sqlValue(playlist)},NULL,'',4102444800000,0);
      INSERT OR REPLACE INTO video VALUES ('ssrfixture1','${channelId}','2026-01-01T00:00:00Z','服务端视频标题','服务端频道',${sqlValue(video)},4102444800000,1);
      INSERT OR REPLACE INTO job(kind,id,due,active,checked) VALUES ('playlist','PLssrfixture01',4102444800000,1,1);
      INSERT OR REPLACE INTO member VALUES ('PLssrfixture01',1,0,'ssr-entry','ssrfixture1');
      INSERT OR REPLACE INTO response_cache VALUES ('channel-lists:${channelId}:',${sqlValue({ items: [playlist] })},4102444800000);`)
  })

  test.afterAll(() => {
    execute(`DELETE FROM member WHERE playlist='PLssrfixture01'; DELETE FROM job WHERE id IN ('PLssrfixture01','${channelId}');
      DELETE FROM source WHERE id IN ('PLssrfixture01','${channelId}'); DELETE FROM video WHERE id='ssrfixture1';
      DELETE FROM response_cache WHERE key='channel-lists:${channelId}:';`)
  })

  test('renders cached video details and its playlist queue without JavaScript', async ({ page }) => {
    await page.goto('/watch?v=ssrfixture1&list=PLssrfixture01&index=1')
    await expect(page.getByRole('heading', { level: 1, name: video.title })).toBeVisible()
    await expect(page.getByRole('region', { name: '视频播放器' })).toBeVisible()
    await expect(page.locator('.queue-current')).toContainText(video.title)
    await expect(page.getByRole('button', { name: '播放视频', exact: true })).toBeVisible()
    await page.screenshot({ path: 'output/playwright/ssr-watch.png', fullPage: true })
  })

  test('renders cached playlist items without JavaScript', async ({ page }) => {
    await page.goto('/playlist?list=PLssrfixture01')
    await expect(page.getByRole('heading', { level: 1, name: playlist.title })).toBeVisible()
    await expect(page.locator('.playlist-items')).toContainText(video.title)
    await page.screenshot({ path: 'output/playwright/ssr-playlist.png', fullPage: true })
  })

  test('renders channel videos and profile subpages without JavaScript', async ({ page }) => {
    for (const path of [`/channel/${channelId}`, '/@ssrfixture/videos', '/@ssrfixture/about']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name: channel.title })).toBeVisible()
      if (!path.endsWith('/about')) await expect(page.locator('.video-title')).toHaveText(video.title)
    }
    await page.goto('/@ssrfixture/playlists')
    await expect(page.locator('.playlist-card')).toContainText(playlist.title)
  })

  test('renders navigation and page content before JavaScript loads', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await expect(page.getByRole('navigation', { name: '内容库导航' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '语言' })).toBeVisible()
  })

  test('uses a saved language for the HTML response', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'mytube-language', value: 'ar', url: baseURL! }])
    await page.goto('/settings')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { name: 'الإعدادات', exact: true })).toBeVisible()
  })

  test('shows a quiet placeholder while personal data stays in the browser', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: '内容库导航' })).toBeVisible()
    await expect(page.getByRole('main').locator('[data-slot="skeleton"]').first()).toBeVisible()
    await expect(page.getByRole('main').getByText('正在读取本地内容库…')).toBeHidden()
  })

  test('allows short edge caching with separate language variants', async ({ request }) => {
    const response = await request.get('/settings')
    expect(response.headers()['cache-control']).toBe('public, max-age=0')
    expect(response.headers()['cloudflare-cdn-cache-control']).toBe('public, max-age=60, stale-while-revalidate=300, stale-if-error=0')
    expect(response.headers().vary?.toLowerCase()).toContain('accept-language')
    expect(response.headers().vary?.toLowerCase()).toContain('cookie')
  })

  test('does not cache a cold metadata placeholder or a personal feed response', async ({ request }) => {
    const cold = await request.get('/watch?v=ssrmissing1')
    expect(cold.headers()['cache-control']).toBe('no-store')
    const feed = await request.post('/api/feed', { data: { channels: [], playlists: [], favorites: [], hidden: [] } })
    expect(feed.headers()['cache-control']).toBe('no-store')
  })

  test('hydrates cached video data without requesting the same video again', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: true, locale: 'zh-CN', timezoneId: 'America/Los_Angeles' })
    const page = await context.newPage()
    await page.route('https://i.ytimg.com/vi/ssrfixture1/hq2.jpg', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"/>',
    }))
    await page.route('**/api/comments?**', route => route.fulfill({ json: { items: [] } }))
    const errors: string[] = []
    const videoRequests: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/video') videoRequests.push(request.url())
    })
    try {
      await page.goto(`${baseURL}/playlist?list=PLssrfixture01`)
      await expect(page.getByRole('heading', { level: 1, name: playlist.title })).toBeVisible()
      await page.locator('.list-description summary').click()
      await page.goto(`${baseURL}/watch?v=ssrfixture1`)
      await expect(page.getByRole('heading', { level: 1, name: video.title })).toBeVisible()
      await page.getByRole('button', { name: '影院模式' }).click()
      await expect(page.locator('.watch-page')).toHaveClass(/theater/)
      expect(videoRequests).toEqual([])
      expect(errors).toEqual([])
    } finally {
      await context.close()
      expect(errors).toEqual([])
    }
  })
})
