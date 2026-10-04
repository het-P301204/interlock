/**
 * axe-core (WCAG 2.0 A/AA + 2.1 AA) on every primary page, light and dark.
 * Zero serious or critical violations. Each page is scanned after its motion
 * has settled, so contrast is measured on final colours, not mid-fade.
 */
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loadDemo, navTo } from './helpers.ts'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa']

/** Waits until no finite animation runs and inline motion styles stop changing between two samples. */
async function settle(page: Page): Promise<void> {
  let last = ''
  await expect
    .poll(
      async () => {
        const snap = await page.evaluate(() => {
          const running = document
            .getAnimations()
            .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity).length
          const styles = Array.from(document.querySelectorAll<HTMLElement>('[style]')).map((e) => e.style.opacity + ';' + e.style.transform).join('|')
          return `${running}#${styles}`
        })
        const stable = snap === last && snap.startsWith('0#')
        last = snap
        return stable
      },
      { intervals: [150], timeout: 15_000 },
    )
    .toBe(true)
}

/** Scrolls through the page so viewport-triggered reveals run, then returns to the top. */
async function revealAll(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  const step = await page.evaluate(() => window.innerHeight * 0.8)
  for (let y = 0; y < height; y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y)
    await settle(page)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}

interface Report {
  page: string
  violations: Array<{ id: string; impact: string | null | undefined; help: string; targets: string[] }>
}

async function scan(page: Page, name: string, reports: Report[]): Promise<void> {
  await revealAll(page)
  await settle(page)
  const res = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  reports.push({
    page: name,
    violations: bad.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 6).map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 160)} :: ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 220)}`) })),
  })
}

function assertClean(reports: Report[]): void {
  const dirty = reports.filter((r) => r.violations.length > 0)
  expect(dirty, JSON.stringify(dirty, null, 2)).toEqual([])
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Accessibility (${theme})`, () => {
    test.use({ reducedMotion: 'reduce', colorScheme: theme })

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => {
        try {
          window.localStorage.setItem('interlock.theme', t)
        } catch {
          /* storage unavailable */
        }
      }, theme)
    })

    test(`public pages and empty workspace have no serious or critical violations (${theme})`, async ({ page }) => {
      const reports: Report[] = []
      const visit = async (url: string, ready: () => Promise<void>) => {
        await page.goto(url)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await ready()
        await scan(page, url, reports)
      }
      await visit('/', () => expect(page.getByRole('heading', { level: 1 })).toBeVisible())
      await visit('/how-it-works', () => expect(page.getByRole('heading', { level: 1 })).toBeVisible())
      await visit('/app', () => expect(page.getByRole('heading', { name: 'Nothing analyzed yet.' })).toBeVisible())
      await visit('/app/new', () => expect(page.getByRole('heading', { level: 1, name: 'Compare two exports of one project' })).toBeVisible())
      await visit('/app/settings', () => expect(page.getByRole('heading', { level: 1, name: 'This browser' })).toBeVisible())
      assertClean(reports)
    })

    test(`analysis pages have no serious or critical violations (${theme})`, async ({ page }) => {
      const reports: Report[] = []
      await loadDemo(page, '04')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await scan(page, '/app/new (complete)', reports)

      await navTo(page, 'Overview')
      await expect(page.getByRole('heading', { level: 1, name: 'Impact Review' })).toBeVisible()
      await scan(page, '/app (results)', reports)

      await navTo(page, 'Findings')
      const list = page.getByRole('list', { name: 'Findings in review order' })
      await expect(list).toBeVisible()
      await scan(page, '/app/findings', reports)

      await list.getByRole('article').first().getByRole('link').click()
      await expect(page).toHaveURL(/\/app\/findings\/IL-/)
      await expect(page.getByRole('region', { name: 'Evidence ledger' })).toBeVisible()
      await scan(page, '/app/findings/:id', reports)

      await page.getByRole('region', { name: 'Evidence ledger' }).getByRole('button', { name: 'View Evidence' }).first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await settle(page)
      const sheet = await new AxeBuilder({ page }).withTags(TAGS).include('[role="dialog"]').analyze()
      reports.push({
        page: 'evidence sheet',
        violations: sheet.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 6).map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 160)} :: ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 220)}`) })),
      })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()

      await navTo(page, 'Changes')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await scan(page, '/app/changes', reports)

      await navTo(page, 'Reports')
      await expect(page.getByRole('heading', { level: 1, name: 'Export the review' })).toBeVisible()
      await scan(page, '/app/reports', reports)

      assertClean(reports)
    })

    test(`safety map, reuse graph and drift have no serious or critical violations (${theme})`, async ({ page }) => {
      const reports: Report[] = []
      await loadDemo(page, '04')

      await navTo(page, 'Safety Map')
      await expect(page.getByRole('heading', { level: 1, name: 'Safety functions' })).toBeVisible()
      await scan(page, '/app/safety', reports)

      await navTo(page, 'Reuse Graph')
      await expect(page.getByRole('heading', { level: 1, name: 'Reuse graph' })).toBeVisible()
      await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List view' }).click()
      await expect(page.getByRole('tree', { name: 'Reuse graph as a tree' })).toBeVisible()
      await scan(page, '/app/graph?view=list', reports)

      await page.goto('/app/drift?scenario=07')
      await expect(page.getByRole('region', { name: 'AOI_PumpInterlock' })).toBeVisible({ timeout: 30_000 })
      await scan(page, '/app/drift?scenario=07', reports)

      assertClean(reports)
    })
  })
}
