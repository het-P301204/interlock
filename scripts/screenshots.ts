/**
 * Captures the README screenshots from the real production build, driving the
 * real app through the built-in demo scenarios (the engine runs in the
 * browser worker exactly as it does for a user).
 *
 *   npm run build && node scripts/screenshots.ts
 *
 * Writes docs/screenshots/*.png.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from '@playwright/test'

const root = join(import.meta.dirname, '..')
const out = join(root, 'docs', 'screenshots')
mkdirSync(out, { recursive: true })
const PORT = 8799
const base = `http://127.0.0.1:${PORT}`

const server = spawn(process.execPath, ['apps/api/src/index.ts', '--production'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', INTERLOCK_DB: 'memory', INTERLOCK_LOG_LEVEL: 'warn', INTERLOCK_RATE_LIMIT_PER_MINUTE: '1000' },
  stdio: 'inherit',
})

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('server did not start')
}

async function settle(page: Page) {
  await page.mouse.move(4, 4)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), undefined, { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(300)
}

async function shot(page: Page, name: string) {
  await settle(page)
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log('wrote', name)
}

async function loadScenario(page: Page, title: string) {
  await page.goto(`${base}/app/demo`)
  const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) })
  await item.getByRole('button', { name: 'Load Demo Scenario' }).click()
  await page.getByRole('link', { name: /Open Impact Review/ }).or(page.getByRole('button', { name: /Open Impact Review/ })).first().waitFor({ timeout: 60_000 })
}

try {
  await waitForServer()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' })
  const page = await ctx.newPage()

  await page.goto(base)
  await shot(page, '01-landing')

  await loadScenario(page, 'Shared pump interlock AOI modified')
  await page.setViewportSize({ width: 1440, height: 1250 })
  await page.goto(`${base}/app`)
  await shot(page, '02-impact-review')

  await page.setViewportSize({ width: 1440, height: 1700 })
  await page.goto(`${base}/app/findings/IL-0001`)
  await shot(page, '03-finding-detail')

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${base}/app/graph?node=${encodeURIComponent('module:aoi_pumpinterlock')}`)
  await page.waitForTimeout(1500)
  await shot(page, '04-reuse-graph')

  await page.setViewportSize({ width: 1440, height: 1300 })
  await page.goto(`${base}/app/safety`)
  await shot(page, '05-safety-map')

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${base}/app/findings/IL-0001`)
  await page.getByRole('button', { name: 'View Evidence' }).first().click()
  await shot(page, '06-evidence')

  await loadScenario(page, 'Large noisy export with three logic changes')
  await page.setViewportSize({ width: 1440, height: 1250 })
  await page.goto(`${base}/app`)
  await shot(page, '07-review-surface')

  await page.setViewportSize({ width: 1440, height: 2000 })
  await loadScenario(page, 'Compressor shutdown weakened by maintenance mode')
  await shot(page, '08-analysis-pipeline')

  await page.setViewportSize({ width: 1440, height: 1250 })
  await page.goto(`${base}/app/drift?scenario=07`)
  await page.getByRole('heading', { name: 'Drift detected' }).waitFor({ timeout: 60_000 })
  await page.locator('#drift-result').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24))
  await shot(page, '09-module-drift')

  const dark = await browser.newContext({ viewport: { width: 1440, height: 1250 }, reducedMotion: 'reduce', colorScheme: 'dark' })
  const dp = await dark.newPage()
  await loadScenario(dp, 'Protective paths removed')
  await dp.goto(`${base}/app/findings`)
  await dp.evaluate(() => {
    document.documentElement.dataset['theme'] = 'dark'
  })
  await shot(dp, '10-findings-dark')

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const mp = await mobile.newPage()
  await loadScenario(mp, 'Shared pump interlock AOI modified')
  await mp.goto(`${base}/app/findings/IL-0001`)
  await shot(mp, '11-mobile-finding')

  await browser.close()
} finally {
  server.kill()
}
