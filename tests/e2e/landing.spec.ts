import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { trackErrors, trackForeignRequests } from './helpers.ts'

const HEADLINE = 'When PLC logic changes, the diff is only the beginning.'
const hero = (page: Page) => page.getByRole('region', { name: HEADLINE })

test.describe('Landing page', () => {
  test('hero, metadata, footer, no console errors and no foreign requests', async ({ page, baseURL }) => {
    const errors = trackErrors(page)
    const foreign = trackForeignRequests(page, baseURL!)

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible()
    await expect(page.getByText('INTERLOCK traces reusable logic, evaluates declared safety functions, and reveals the operational impact hidden inside PLC project changes.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'How INTERLOCK Works' })).toBeVisible()

    await expect(page).toHaveTitle('INTERLOCK — PLC Safety Logic Integrity Analyzer')
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'Analyze PLC project changes for safety-function impact, reusable-module blast radius, alarm suppression, and review priority.',
    )
    const icons = page.locator('link[rel="icon"]')
    expect(await icons.count()).toBeGreaterThan(0)
    const iconHref = await icons.first().getAttribute('href')
    expect(iconHref).toBeTruthy()
    const iconRes = await page.request.get(new URL(iconHref!, baseURL).toString())
    expect(iconRes.ok()).toBe(true)

    const footer = page.getByRole('contentinfo')
    await footer.scrollIntoViewIfNeeded()
    await expect(footer).toContainText('Defensive analysis only')
    await expect(footer).toContainText('No live-controller interaction')
    await expect(footer).toContainText('PLC Safety Logic Integrity & Impact Analyzer')
    const footerNav = footer.getByRole('navigation', { name: 'Footer' })
    for (const name of ['Documentation', 'Security', 'Privacy']) await expect(footerNav.getByRole('link', { name })).toBeVisible()
    await expect(footerNav.getByRole('link', { name: /GitHub/ })).toBeVisible()

    // Scroll the whole page so viewport-triggered sections load what they need.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(footer).toBeInViewport()
    await page.waitForLoadState('networkidle')

    expect(errors).toEqual([])
    expect(foreign).toEqual([])
  })

  test('Analyze a Project opens the ingest page', async ({ page }) => {
    await page.goto('/')
    await hero(page).getByRole('link', { name: 'Analyze a Project' }).click()
    await expect(page).toHaveURL(/\/app\/new$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Compare two exports of one project' })).toBeVisible()
  })

  test('Explore Demo opens the demo scenarios', async ({ page }) => {
    await page.goto('/')
    await hero(page).getByRole('link', { name: 'Explore Demo' }).click()
    await expect(page).toHaveURL(/\/app\/demo$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Northgate Pump Station' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load Demo Scenario' }).first()).toBeVisible()
  })

  test('How INTERLOCK Works link opens the documentation', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'How INTERLOCK Works' }).click()
    await expect(page).toHaveURL(/\/how-it-works$/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
