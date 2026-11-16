import { expect, test } from '@playwright/test'

test.use({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })

const quota = {
  day: '2026-11-17', resetsAt: Date.parse('2026-11-18T08:00:00Z'),
  used: 875, limit: 3500, remaining: 2625, blocked: false, configured: true,
}

test('shows shared API usage, refreshes it and fits desktop and mobile settings', async ({ page }) => {
  let used = quota.used
  await page.route('**/api/quota?**', route => route.fulfill({ json: { ...quota, used, remaining: quota.limit - used } }))
  await page.goto('/settings')
  const section = page.getByRole('region', { name: 'YouTube API 配额' })
  await expect(section).toContainText('今日已用 875 / 3,500 单位')
  await expect(section).toContainText('剩余 2,625 单位')
  await expect(section).toContainText('2026/11/18 16:00')
  await expect(section).toContainText('所有用户')
  await expect(section).toContainText('Google Cloud 项目的完整配额')
  await expect(section.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '875')
  await expect(section.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '3500')
  await expect(section.getByRole('link', { name: '查看 Google Cloud 配额' })).toHaveAttribute('href', 'https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas')
  used = 900
  await section.getByRole('button', { name: '刷新配额' }).click()
  await expect(section).toContainText('今日已用 900 / 3,500 单位')
  await page.screenshot({ path: 'output/playwright/quota-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(section).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: 'output/playwright/quota-mobile.png', fullPage: true })
})

test('shows a quota failure and allows retrying without disrupting local settings', async ({ page }) => {
  let failed = true
  await page.route('**/api/quota?**', route => failed
    ? route.fulfill({ status: 503, json: { error: 'service' } })
    : route.fulfill({ json: quota }))
  await page.goto('/settings')
  const section = page.getByRole('region', { name: 'YouTube API 配额' })
  await expect(section.getByRole('alert')).toContainText('服务暂时不可用')
  await expect(page.getByRole('switch', { name: '用视频画面替代封面' })).toBeEnabled()
  failed = false
  await section.getByRole('button', { name: '重试', exact: true }).click()
  await expect(section).toContainText('今日已用 875 / 3,500 单位')
})

for (const [state, message] of [
  [{ blocked: true, remaining: 0 }, 'YouTube 今日配额已用完'],
  [{ used: 3500, remaining: 0 }, '应用今日同步预算已用完'],
  [{ configured: false }, '服务尚未配置 YouTube API 密钥'],
] as const) {
  test(`explains API availability: ${message}`, async ({ page }) => {
    await page.route('**/api/quota?**', route => route.fulfill({ json: { ...quota, ...state } }))
    await page.goto('/settings')
    await expect(page.getByRole('region', { name: 'YouTube API 配额' }).getByRole('alert')).toContainText(message)
  })
}
