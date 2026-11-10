import { expect, test, type Page } from '@playwright/test'

const enabled = process.env.MYTUBE_LIVE === '1'
test.skip(!enabled, 'Requires local production Worker and real YouTube Data API key')
const channel = 'UCNymqCXr3sxL8dnmO_jScuA'
const list = 'PLFquu03WUN0gsRef1K2O1OcbcNiKaYCXk'
const video = 'dQw4w9WgXcQ'

async function add(page: Page, url: string, title: string | RegExp, button: string) {
  await page.getByRole('button', { name: '添加内容', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('YouTube 链接').fill(url)
  await dialog.getByRole('button', { name: '解析链接' }).click()
  await expect(dialog.getByText(title)).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: button }).click()
  await expect(dialog).toBeHidden()
}
test('real add, channel tabs, playlist, comments and replies on workerd', async ({ page, browser }) => {
  const unexpected: string[] = []
  page.on('pageerror', error => unexpected.push(error.message))
  await page.goto('/')
  await expect(page.getByText('你的内容库还是空的')).toBeVisible()
  await add(page, 'https://www.youtube.com/@ETALENT-TV', '주식회사 중계진', '加入内容库')
  await expect(page.locator('.video-card').first()).toBeVisible({ timeout: 15_000 })
  await add(page, `https://youtu.be/${video}?t=90s&si=tracking`, /Rick Astley - Never Gonna/, '只保存此视频')
  await add(page, `https://www.youtube.com/playlist?list=${list}`, '중계진 토크', '加入内容库')
  await page.reload()
  await expect(page.locator('.video-card').first()).toBeVisible()
  await page.getByRole('textbox', { name: '搜索我的内容库' }).fill('Rick Astley')
  await page.getByRole('textbox', { name: '搜索我的内容库' }).press('Enter')
  await expect(page).toHaveURL(/\/results\?search_query=/)
  await expect(page.locator('.video-title').filter({ hasText: 'Rick Astley' })).toHaveCount(1)
  await page.locator('.video-title').filter({ hasText: 'Rick Astley' }).click()
  await expect(page).toHaveURL(/t=90s/)
  await expect(page.locator('.player iframe')).toHaveCount(0)
  await page.getByRole('heading', { name: '公开评论' }).scrollIntoViewIfNeeded()
  const row = page.locator('.comment-row').first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /展开 \d+ 条回复/ }).first().click()
  await expect(page.locator('.replies .comment-row').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.comments img, .comments [data-slot=avatar]')).toHaveCount(0)
  await page.getByRole('combobox', { name: '评论排序' }).selectOption('time')
  await expect(page.locator('.comment-row').first()).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: /Rick Astley.*搜索结果/ })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { name: /Rick Astley - Never Gonna/ })).toBeVisible()
  await page.goto('/@ETALENT-TV/videos')
  await expect(page.getByRole('heading', { name: '주식회사 중계진' })).toBeVisible()
  await expect(page.locator('.channel-avatar img')).toBeVisible()
  await page.getByRole('navigation', { name: '频道页签' }).getByRole('link', { name: '播放列表' }).click()
  await expect(page).toHaveURL('/@ETALENT-TV/playlists')
  await expect(page.getByRole('heading', { name: '중계진 토크', exact: true })).toBeVisible()
  await page.goto(`/channel/${channel}`)
  await expect(page.getByRole('heading', { name: '주식회사 중계진' })).toBeVisible()
  await page.goto(`/playlist?list=${list}`)
  await expect(page.getByRole('heading', { name: '중계진 토크' })).toBeVisible()
  await expect(page.locator('.playlist-items li').first()).toBeVisible()
  await page.locator('.playlist-item-link').first().click()
  await expect(page).toHaveURL(/watch\?v=.*&list=.*&index=1/)
  await expect(page.locator('.queue-current')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '播放视频', exact: true })).toBeVisible()
  expect(unexpected).toEqual([])

  const isolated = await browser.newContext()
  const fresh = await isolated.newPage()
  await fresh.goto(page.url().split('/watch')[0])
  await expect(fresh.getByText('你的内容库还是空的')).toBeVisible()
  await isolated.close()
})
test('real privacy embed decodes a frame, advances time and detaches on navigation', async ({ page }) => {
  const playbackId = 'EE_FNROtzQM'
  const embedRequests: string[] = []
  await page.addInitScript(() => {
    if (location.hostname !== 'www.youtube-nocookie.com') return
    document.addEventListener('playing', event => {
      if (event.target instanceof HTMLVideoElement) event.target.requestVideoFrameCallback(() => {
        performance.mark('observed-video-frame')
      })
    }, true)
  })
  page.on('request', r => { if (r.url().includes('youtube-nocookie.com/embed/') || r.url().includes('youtube.com/iframe_api')) embedRequests.push(r.url()) })
  await page.goto(`/watch?v=${playbackId}&t=10s`)
  const play = page.getByRole('button', { name: '播放视频', exact: true })
  await expect(play).toBeVisible()
  expect(embedRequests).toEqual([])
  const start = await page.evaluate(() => performance.timeOrigin + performance.now())
  await play.click()
  await expect(page.locator('iframe')).toHaveAttribute('src', new RegExp('^https://www[.]youtube-nocookie[.]com/embed/' + playbackId))
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName('mytube-playback-progress').length), {
    timeout: 30_000, message: 'Real YouTube IFrame Player API must report the clock advancing while playing',
  }).toBeGreaterThan(0)
  const frame = page.frame({ url: /youtube-nocookie[.]com\/embed/ })!
  const firstFrame = await frame.evaluate(() => {
    const mark = performance.getEntriesByName('observed-video-frame')[0]
    const video = document.querySelector('video')
    return { at: mark ? performance.timeOrigin + mark.startTime : 0, width: video?.videoWidth, position: video?.currentTime }
  })
  expect(firstFrame.at).toBeGreaterThan(start)
  expect(firstFrame.width).toBeGreaterThan(0)
  expect(firstFrame.position).toBeGreaterThan(10)
  const elapsed = await page.evaluate(() => performance.getEntriesByName('mytube-playback-progress')[0]?.duration)
  console.log('First playing video frame (ms)', Math.round(firstFrame.at - start), 'Advancing player clock (ms)', Math.round(elapsed ?? 0))
  await page.getByRole('link', { name: 'mytube 首页' }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
})
