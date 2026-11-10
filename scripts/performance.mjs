import { chromium } from 'playwright'
import { gzipSync } from 'node:zlib'

const origin = process.env.MYTUBE_TEST_ORIGIN ?? 'http://127.0.0.1:4173'
const browser = await chromium.launch({ channel: 'chrome' })
const runs = []
try {
  for (let n = 0; n < 3; n++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
    const page = await context.newPage()
    const scripts = new Map()
    page.on('response', res => {
      const url = new URL(res.url())
      if (url.origin === origin && url.pathname.endsWith('.js') && !scripts.has(url.pathname))
        scripts.set(url.pathname, res.body().then(body => gzipSync(body).length))
    })
    await page.addInitScript(() => {
      window.metrics = { lcp: 0, cls: 0 }
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.metrics.lcp = entry.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      let shiftStart = 0
      let shiftLast = 0
      let windowScore = 0
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue
          const start = entry.startTime
          if (start - shiftLast > 1000 || start - shiftStart > 5000) {
            shiftStart = start
            windowScore = 0
          }
          windowScore += entry.value
          shiftLast = start
          window.metrics.cls = Math.max(window.metrics.cls, windowScore)
        }
      }).observe({ type: 'layout-shift', buffered: true })
    })
    await page.goto(origin)
    await page.getByRole('button', { name: '添加 YouTube 链接' }).waitFor()
    const ready = await page.evaluate(() => performance.now())
    await page.waitForTimeout(1200)
    const metrics = await page.evaluate(() => window.metrics)
    runs.push({
      ownJsGzipBytes: (await Promise.all(scripts.values())).reduce((a, b) => a + b, 0),
      lcpMs: Math.round(metrics.lcp), cls: Number(metrics.cls.toFixed(4)), libraryReadyMs: Math.round(ready),
    })
    await context.close()
  }
} finally { await browser.close() }
console.log(JSON.stringify({ origin, viewport: '1440x900', coldContexts: 3, runs }, null, 2))
