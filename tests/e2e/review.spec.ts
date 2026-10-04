/**
 * The review workflow on real analysis results: finding detail and its
 * evidence panel, URL-backed filters, the command palette and report exports.
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loadDemo, navTo, trackErrors } from './helpers.ts'

const findingsList = (page: Page) => page.getByRole('list', { name: 'Findings in review order' })
const shownLabel = (page: Page) => page.getByText(/^\d+ of \d+ shown$/)

test.describe('Finding detail and evidence', () => {
  test('IL-0001 of scenario 04: blast radius, firing condition, impact chain, evidence panel', async ({ page }) => {
    const errors = trackErrors(page)
    await loadDemo(page, '04')
    await navTo(page, 'Findings')
    const card = findingsList(page).getByRole('article').filter({ hasText: 'IL-0001' })
    await card.getByRole('link').click()
    await expect(page).toHaveURL(/\/app\/findings\/IL-0001$/)

    const article = page.getByRole('article', { name: /./ }).filter({ has: page.getByRole('heading', { level: 1 }) })
    await expect(article.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('IL-0001', { exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(article.getByText('IL-0001', { exact: true }).last()).toBeVisible()
    await expect(article.getByText('CRITICAL', { exact: true }).first()).toBeVisible()

    // Facts: 1 definition -> 5 instances, 3 safety-relevant.
    const facts = article.getByRole('term')
    await expect(facts.filter({ hasText: 'Affected module' })).toBeVisible()
    await expect(article.getByRole('definition').filter({ hasText: 'AOI_PumpInterlock' }).first()).toBeVisible()
    const blast = article.getByRole('definition').filter({ hasText: /instances/ }).first()
    await expect(blast).toContainText('5 instances')
    await expect(blast).toContainText('2 operational')
    const safetyTerm = facts.filter({ hasText: 'Safety-relevant sites' })
    await expect(safetyTerm).toBeVisible()
    await expect(safetyTerm.locator('xpath=following-sibling::dd[1]')).toHaveText('3')

    // Before / after condition.
    const firing = page.getByRole('region', { name: 'Firing condition, before and after' })
    await expect(firing).toBeVisible()
    await expect(firing).toContainText('BASELINE')
    await expect(firing).toContainText('CURRENT')
    await expect(firing).toContainText('Maint_Bypass')

    // Impact chain.
    const impact = page.getByRole('region', { name: 'Impact chain' })
    await expect(impact).toBeVisible()
    const chain = impact.getByRole('list', { name: 'Impact chain' })
    await expect(chain).toContainText('Instances')
    await expect(chain).toContainText('5')
    await expect(chain).toContainText('Safety-relevant')
    await expect(chain).toContainText('3')

    // Evidence panel: SHA-256 and XML location; Esc closes and focus returns.
    const ledger = page.getByRole('region', { name: 'Evidence ledger' })
    const view = ledger.getByRole('button', { name: 'View Evidence' }).first()
    await view.scrollIntoViewIfNeeded()
    await view.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'Provenance' })).toBeVisible()
    await expect(sheet.getByRole('term').filter({ hasText: 'SHA-256' })).toBeVisible()
    await expect(sheet.getByText(/^[0-9a-f]{64}$/)).toBeVisible()
    await expect(sheet.getByRole('term').filter({ hasText: 'XML location' })).toBeVisible()
    await expect(sheet).toContainText('RSLogix5000Content')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(view).toBeFocused()

    expect(errors).toEqual([])
  })
})

test.describe('Filters', () => {
  test('severity filter through the drawer updates the URL and the list, and survives a reload', async ({ page }) => {
    await loadDemo(page, '08')
    await navTo(page, 'Findings')
    const list = findingsList(page)
    await expect(list).toBeVisible()
    const all = await list.getByRole('article').count()
    expect(all).toBeGreaterThan(1)
    await expect(shownLabel(page)).toHaveText(`${all} of ${all} shown`)

    await page.getByRole('button', { name: 'Filters' }).click()
    const drawer = page.getByRole('dialog', { name: 'Filters' })
    await expect(drawer).toBeVisible()
    await drawer.getByRole('group', { name: 'Severity' }).getByRole('checkbox', { name: /^HIGH\b/ }).check()
    await drawer.getByRole('button', { name: 'Show results' }).click()
    await expect(drawer).toBeHidden()

    await expect(page).toHaveURL(/[?&]severity=HIGH(&|$)/)
    const high = await list.getByRole('article').count()
    expect(high).toBeGreaterThan(0)
    expect(high).toBeLessThan(all)
    await expect(shownLabel(page)).toHaveText(`${high} of ${all} shown`)
    for (const card of await list.getByRole('article').all()) await expect(card.getByText('HIGH', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove filter Severity: HIGH' })).toBeVisible()

    await page.reload()
    await expect(page).toHaveURL(/[?&]severity=HIGH(&|$)/)
    await expect(shownLabel(page)).toHaveText(`${high} of ${all} shown`)
    await expect(findingsList(page).getByRole('article')).toHaveCount(high)
    await expect(page.getByRole('button', { name: 'Remove filter Severity: HIGH' })).toBeVisible()
  })
})

test.describe('Command palette', () => {
  test('Ctrl+K opens it, a finding id navigates, Escape closes; keyboard only', async ({ page }) => {
    await loadDemo(page, '04')
    await navTo(page, 'Overview')
    await expect(page.getByRole('heading', { level: 1, name: 'Impact Review' })).toBeVisible()

    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command menu' })
    await expect(palette).toBeVisible()
    const input = palette.getByRole('combobox')
    await expect(input).toBeFocused()
    await page.keyboard.type('IL-0002')
    await expect(palette.getByRole('option', { selected: true })).toContainText('IL-0002')
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    await expect(page).toHaveURL(/\/app\/findings\/IL-0002$/)
    await expect(page.getByText('IL-0002', { exact: true }).first()).toBeVisible()

    // Arrow keys move the active option; Escape closes without navigating.
    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible()
    await page.keyboard.type('critical findings')
    const first = palette.getByRole('option', { selected: true })
    await expect(first).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await expect(palette.getByRole('option', { selected: true })).toHaveText(await first.innerText())
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()
    await expect(page).toHaveURL(/\/app\/findings\/IL-0002$/)

    // A command runs from the keyboard too.
    await page.keyboard.press('Control+k')
    await page.keyboard.type('Show Critical Findings')
    await expect(palette.getByRole('option', { selected: true })).toContainText('Show Critical Findings')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/app\/findings\?severity=CRITICAL$/)
  })
})

test.describe('Reports', () => {
  test('PDF, JSON, CSV and Markdown downloads have the right content', async ({ page }) => {
    const errors = trackErrors(page)
    await loadDemo(page, '02')
    await navTo(page, 'Reports')
    await expect(page.getByRole('heading', { level: 1, name: 'Export the review' })).toBeVisible()

    const save = async (button: string) => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()])
      const file = await download.path()
      return { name: download.suggestedFilename(), bytes: readFileSync(file) }
    }

    const pdf = await save('Export PDF')
    expect(pdf.name).toMatch(/\.pdf$/)
    expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    const json = await save('Export JSON')
    expect(json.name).toMatch(/\.json$/)
    const parsed = JSON.parse(json.bytes.toString('utf8')) as { schema?: string; findings?: unknown[] }
    expect(parsed.schema).toBe('interlock.analysis/v1')
    expect(Array.isArray(parsed.findings)).toBe(true)

    const csv = await save('Export CSV')
    expect(csv.name).toMatch(/\.csv$/)
    const csvText = csv.bytes.toString('utf8')
    const header = (csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText).split('\n')[0]!.replace(/\r$/, '')
    expect(header.toLowerCase()).toContain('severity')
    expect(header.split(',').length).toBeGreaterThan(3)

    const md = await save('Export MD')
    expect(md.name).toMatch(/\.md$/)
    expect(md.bytes.toString('utf8')).toContain('Executive summary')

    expect(errors).toEqual([])
  })
})
