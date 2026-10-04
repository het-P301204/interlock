/**
 * Reuse Graph, Safety Map and cross-project Drift on real engine output.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expected, loadDemo, navTo, trackErrors } from './helpers.ts'

const graphStatus = (page: Page) => page.getByText(/^(Showing \d+ of \d+ nodes|Tracing )/)

test.describe('Reuse Graph', () => {
  test('a deep link selects a node; toolbar toggles; list view is keyboard navigable', async ({ page }) => {
    const errors = trackErrors(page)
    await loadDemo(page, '04')
    await page.goto('/app/graph?node=module:aoi_pumpinterlock')
    await expect(page.getByRole('heading', { level: 1, name: 'Reuse graph' })).toBeVisible()
    await expect(page.getByText(/1 definition changed → 5 downstream instantiations affected,\s+3 safety-relevant, 2 operational/)).toBeVisible()

    // The deep-linked node is selected and inspected.
    await expect(page.getByRole('complementary', { name: 'Inspector: AOI_PumpInterlock' })).toBeVisible()
    await expect(graphStatus(page)).toContainText('selected AOI_PumpInterlock')

    // Toolbar: viewport controls and pressed-state filters.
    const viewport = page.getByRole('group', { name: 'Viewport' })
    for (const name of ['Zoom in', 'Zoom out', 'Fit', 'Focus']) await expect(viewport.getByRole('button', { name })).toBeVisible()
    const filters = page.getByRole('group', { name: 'Filters' })
    const safetyOnly = filters.getByRole('button', { name: /^Safety only/ })
    await expect(safetyOnly).toHaveAttribute('aria-pressed', 'false')
    const before = await graphStatus(page).innerText()
    await safetyOnly.click()
    await expect(safetyOnly).toHaveAttribute('aria-pressed', 'true')
    await expect(graphStatus(page)).toContainText('(filtered)')
    await safetyOnly.click()
    await expect(safetyOnly).toHaveAttribute('aria-pressed', 'false')
    await expect(graphStatus(page)).toHaveText(before)

    const changedOnly = filters.getByRole('button', { name: /^Changed only/ })
    await changedOnly.click()
    await expect(changedOnly).toHaveAttribute('aria-pressed', 'true')
    await changedOnly.click()
    await expect(changedOnly).toHaveAttribute('aria-pressed', 'false')

    // Trace impact downstream from the selected module.
    const traceImpact = page.getByRole('group', { name: 'Trace' }).getByRole('button', { name: 'Trace impact' })
    await traceImpact.click()
    await expect(traceImpact).toHaveAttribute('aria-pressed', 'true')
    await expect(graphStatus(page)).toContainText('Tracing impact downstream from AOI_PumpInterlock')
    await traceImpact.click()
    await expect(traceImpact).toHaveAttribute('aria-pressed', 'false')

    // List view: the accessible alternative to the canvas.
    const view = page.getByRole('group', { name: 'View' })
    await view.getByRole('button', { name: 'List view' }).click()
    await expect(view.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/[?&]view=list/)
    const tree = page.getByRole('tree', { name: 'Reuse graph as a tree' })
    await expect(tree).toBeVisible()
    const items = tree.getByRole('treeitem')
    expect(await items.count()).toBeGreaterThan(1)

    // Roving tabindex: exactly one item is in the tab order; arrows move focus.
    await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1)
    const first = items.first()
    await first.focus()
    await expect(first).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(first).toBeFocused()
    await page.keyboard.press('End')
    await expect(items.last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(first).toBeFocused()

    // Enter on a node row selects it (URL and aria-selected follow).
    const nodeRow = tree.getByRole('treeitem').filter({ hasText: 'PUMP_01' }).first()
    await nodeRow.focus()
    await page.keyboard.press('Enter')
    // Selecting can reveal more rows above it, so follow the focused row rather than re-querying by text.
    const focused = tree.locator('[role="treeitem"]:focus')
    await expect(focused).toHaveAttribute('aria-selected', 'true')
    await expect(focused).toContainText('PUMP_01')
    await expect(page).toHaveURL(/[?&]node=/)
    await expect(page).not.toHaveURL(/node=module%3Aaoi_pumpinterlock|node=module:aoi_pumpinterlock/)

    expect(errors).toEqual([])
  })
})

test.describe('Safety Map', () => {
  test('scenario 04 lists the eight declared functions with their statuses', async ({ page }) => {
    const errors = trackErrors(page)
    const exp = expected('04')
    await loadDemo(page, '04')
    await navTo(page, 'Safety Map')
    await expect(page.getByRole('heading', { level: 1, name: 'Safety functions' })).toBeVisible()

    const panel = page.getByRole('tabpanel', { name: /Safety map/ })
    const rows = panel.getByRole('article')
    await expect(rows).toHaveCount(8)
    for (const [id, status] of Object.entries(exp.safetyStatus!)) {
      const row = rows.filter({ has: page.getByText(id, { exact: true }) })
      await expect(row).toHaveCount(1)
      await expect(row.getByText(status === 'NO_CHANGE' ? 'NO CHANGE' : status.replace(/_/g, ' '), { exact: true }).first()).toBeVisible()
    }
    // Impacted functions are listed first.
    const firstThree = await Promise.all([0, 1, 2].map((i) => rows.nth(i).innerText()))
    for (const t of firstThree) expect(t).toContain('IMPACTED')

    // Details expand from the keyboard.
    const details = rows.first().getByRole('button', { name: /^Details for / })
    await details.focus()
    await page.keyboard.press('Enter')
    await expect(rows.first().getByRole('button', { name: /^Hide details for / })).toHaveAttribute('aria-expanded', 'true')

    expect(errors).toEqual([])
  })
})

test.describe('Module drift', () => {
  test('/app/drift?scenario=07 reports AOI_PumpInterlock drift and AOI_ValveCtl missing sites', async ({ page }) => {
    const errors = trackErrors(page)
    const exp = expected('07').drift as {
      AOI_PumpInterlock: { status: string; variants: Record<string, string> }
      AOI_ValveCtl: { missingAt: string[] }
    }
    await page.goto('/app/drift?scenario=07')

    const pump = page.getByRole('region', { name: 'AOI_PumpInterlock' })
    await expect(pump).toBeVisible({ timeout: 30_000 })
    expect(exp.AOI_PumpInterlock.status).toBe('DRIFT')
    await expect(pump.getByText('DRIFT DETECTED', { exact: true })).toBeVisible()

    const variants = pump.getByRole('listitem').filter({ hasText: /revision .* · definition #/ })
    for (const [site, behavior] of Object.entries(exp.AOI_PumpInterlock.variants)) {
      const label = behavior === 'REFERENCE' ? 'Reference' : behavior === 'WEAKER' ? 'Weaker' : behavior
      const card = variants.filter({ hasText: site })
      await expect(card.first()).toBeVisible()
      await expect(card.first().getByText(label, { exact: true })).toBeVisible()
    }

    const valve = page.getByRole('region', { name: 'AOI_ValveCtl' })
    await expect(valve).toBeVisible()
    await expect(valve).toContainText(`missing at ${exp.AOI_ValveCtl.missingAt.join(', ')}`)

    expect(errors).toEqual([])
  })
})
