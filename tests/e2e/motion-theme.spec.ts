/**
 * Theme persistence and reduced motion.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { bodyBackground, completeHeading, loadDemo, pipelineStages, scenario } from './helpers.ts'

test.describe('Theme', () => {
  test('dark theme is graphite, not black or blue, and persists across reloads', async ({ page }) => {
    await page.goto('/app/settings')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    const [lr, lg, lb] = await bodyBackground(page)
    expect(lr + lg + lb).toBeGreaterThan(600) // warm paper

    // The radio itself is visually hidden; users click its visible label.
    const themeGroup = page.getByRole('group', { name: 'Theme' })
    await themeGroup.getByText('Dark', { exact: true }).click()
    await expect(themeGroup.getByRole('radio', { name: 'Dark' })).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(async () => (await bodyBackground(page)).join(',')).not.toBe(`${lr},${lg},${lb}`)

    const check = async () => {
      const [r, g, b] = await bodyBackground(page)
      expect([r, g, b]).not.toEqual([0, 0, 0])
      expect(Math.max(r, g, b)).toBeLessThan(60) // charcoal, not a mid grey
      expect(Math.max(r, g, b)).toBeGreaterThan(10) // not black
      expect(b - r).toBeLessThanOrEqual(6) // not blue or navy
      expect(b - g).toBeLessThanOrEqual(6)
    }
    await check()

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('group', { name: 'Theme' }).getByRole('radio', { name: 'Dark' })).toBeChecked()
    await check()

    // The landing page uses the same preference.
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await check()
  })

  test('the workspace menu switches the theme from the keyboard', async ({ page }) => {
    await page.goto('/app')
    const trigger = page.getByRole('button', { name: 'Workspace settings' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dark = page.getByRole('menuitemradio', { name: 'Dark' })
    await expect(dark).toBeVisible()
    await dark.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})

/** Records, in the page, when the first and the tenth pipeline stage were first shown complete. */
async function watchStages(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __stages: { first?: number; all?: number } }
    w.__stages = {}
    const obs = new MutationObserver(() => {
      const list = document.querySelector('ol[aria-label="Analysis pipeline stages"]')
      if (!list) return
      const done = Array.from(list.querySelectorAll(':scope > li')).filter((li) => li.textContent?.includes('— complete')).length
      const now = performance.now()
      if (done > 0 && w.__stages.first === undefined) w.__stages.first = now
      if (done === 10 && w.__stages.all === undefined) w.__stages.all = now
    })
    obs.observe(document.body, { subtree: true, childList: true, characterData: true })
  })
}

async function revealSpread(page: Page, scenarioId: string): Promise<number> {
  // Load the demo page first so the observer is installed before the analysis runs (client-side navigation keeps it).
  await page.goto('/app/demo')
  await watchStages(page)
  const s = scenario(scenarioId)
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: s.title }) })
  await row.getByRole('button', { name: 'Load Demo Scenario' }).click()
  await expect(completeHeading(page)).toBeVisible({ timeout: 45_000 })
  await expect(pipelineStages(page).filter({ hasText: '— complete' })).toHaveCount(10)
  const t = await page.evaluate(() => (window as unknown as { __stages: { first?: number; all?: number } }).__stages)
  expect(t.first).toBeDefined()
  expect(t.all).toBeDefined()
  return t.all! - t.first!
}

test.describe('Reduced motion', () => {
  test.describe('with prefers-reduced-motion: reduce', () => {
    test.use({ reducedMotion: 'reduce' })
    test('stages are shown complete as soon as the engine reports them, without the reveal stagger', async ({ page }) => {
      const spread = await revealSpread(page, '02')
      // The animated reveal spaces ten stages 120 ms apart (>= 1080 ms); reduced motion shows them at engine speed.
      expect(spread).toBeLessThan(500)
      await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0)
    })
  })

  test.describe('without reduced motion (control)', () => {
    test.use({ reducedMotion: 'no-preference' })
    test('stages are revealed one after another', async ({ page }) => {
      const spread = await revealSpread(page, '02')
      expect(spread).toBeGreaterThanOrEqual(1000)
    })
  })

  test('reduced motion: a loaded demo shows all ten stages complete on arrival', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    await loadDemo(page, '03')
    await expect(pipelineStages(page).filter({ hasText: '— complete' })).toHaveCount(10)
    await context.close()
  })
})
