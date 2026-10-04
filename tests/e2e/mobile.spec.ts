/**
 * Phone layout (Pixel 7 project). Tagged @mobile: the mobile project runs
 * only these; on the desktop project they are skipped.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loadDemo, navTo } from './helpers.ts'

test.skip(({ isMobile }) => !isMobile, 'Phone layout only')

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

test.describe('Phone layout', () => {
  test('landing renders without horizontal scroll @mobile', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.getByRole('contentinfo')).toBeInViewport()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2)

    // The site menu replaces the header links.
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'How it works' })).toBeVisible()
  })

  test('bottom navigation reaches Findings, and a demo renders findings as stacked cards @mobile', async ({ page }) => {
    await page.goto('/app')
    const bottom = page.getByRole('navigation', { name: 'Primary' })
    await expect(bottom).toBeVisible()
    await bottom.getByRole('link', { name: 'Findings', exact: true }).click()
    await expect(page).toHaveURL(/\/app\/findings$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Findings' })).toBeVisible()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2)

    // The More sheet reaches every other page.
    await bottom.getByRole('button', { name: 'More' }).click()
    const sheet = page.getByRole('dialog', { name: 'Workspace' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Reports' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    await loadDemo(page, '04')
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2)
    await navTo(page, 'Findings')
    const cards = page.getByRole('list', { name: 'Findings in review order' }).getByRole('article')
    await expect(cards.first()).toBeVisible()
    const n = await cards.count()
    expect(n).toBeGreaterThan(1)
    const width = page.viewportSize()!.width
    let prevBottom = -Infinity
    for (let i = 0; i < n; i++) {
      const box = (await cards.nth(i).boundingBox())!
      expect(box.width).toBeGreaterThan(width * 0.8) // full-width card, not a table row squeezed into columns
      expect(box.y).toBeGreaterThanOrEqual(prevBottom) // stacked one below the other
      prevBottom = box.y + box.height
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2)
  })

  test('the reuse graph opens in list mode on a phone @mobile', async ({ page }) => {
    await loadDemo(page, '04')
    await navTo(page, 'Reuse Graph')
    await expect(page).toHaveURL(/\/app\/graph/)
    const view = page.getByRole('group', { name: 'View' })
    await expect(view.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')
    await expect(view.getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('AOI_PumpInterlock').first()).toBeVisible()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2)
  })
})
