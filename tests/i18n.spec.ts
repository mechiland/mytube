import { expect, test } from '@playwright/test'

test.use({ locale: 'en-US' })

test.describe('French browser', () => {
  test.use({ locale: 'fr-CA' })

  test('matches the browser language on a direct route', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Paramètres', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Langue' })).toHaveValue('browser')
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  })

  test('keeps translated controls within a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 })
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Ajouter du contenu' })).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  })

  test('keeps a manual language across reloads and can return to the browser language', async ({ page }) => {
    await page.goto('/settings')
    const language = page.locator('#language')
    await language.selectOption('ar')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { name: 'الإعدادات', exact: true })).toBeVisible()

    await page.reload()
    await expect(language).toHaveValue('ar')
    await expect(page.getByRole('heading', { name: 'الإعدادات', exact: true })).toBeVisible()
    await language.selectOption('browser')
    await expect(page.getByRole('heading', { name: 'Paramètres', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  })
})

test('uses the next supported browser language and matches traditional Chinese regions', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', { value: ['eo', 'zh-HK', 'en'] })
    Object.defineProperty(navigator, 'language', { value: 'eo' })
  })
  await page.goto('/settings')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible()
})

test('uses English when none of the browser languages are supported', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', { value: ['eo'] })
    Object.defineProperty(navigator, 'language', { value: 'eo' })
  })
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
})

test('translates an API error using its code in the active language', async ({ page }) => {
  await page.route('**/api/video?**', route => route.fulfill({
    status: 404,
    json: { error: 'missing', message: '资源不存在、已删除或不公开。' },
  }))
  await page.goto('/watch?v=aaaaaaaaaaa')
  await expect(page.getByRole('alert')).toContainText('This resource is missing, deleted, or private.')
})
