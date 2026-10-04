/**
 * Every compare scenario (01..09, 07 is drift) loaded from the Demo page runs
 * the real engine on the fixture files; the UI must show the facts the
 * fixture oracle in fixtures/expected/<id>-<slug>.json requires.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { FINDING_TYPE_LABEL, SCENARIOS, completeBlock, expected, loadDemo, navTo, trackErrors } from './helpers.ts'

const COMPARE = SCENARIOS.filter((s) => s.kind === 'compare')

async function completeNumbers(page: Page): Promise<{ total: number; meaningful: number }> {
  const text = (await completeBlock(page).first().innerText()).replace(/,/g, '')
  const total = Number(/(\d+) changes? detected/.exec(text)?.[1])
  const meaningful = Number(/(\d+) meaningful logic changes?/.exec(text)?.[1])
  return { total, meaningful }
}

test.describe('Demo scenarios', () => {
  test('the demo catalogue lists all nine scenarios', async ({ page }) => {
    await page.goto('/app/demo')
    for (const s of SCENARIOS) await expect(page.getByRole('heading', { level: 2, name: s.title })).toBeVisible()
    expect(COMPARE.map((s) => s.id)).toEqual(['01', '02', '03', '04', '05', '06', '08', '09'])
  })

  for (const s of COMPARE) {
    test(`scenario ${s.id} ${s.slug} shows its oracle facts`, async ({ page }) => {
      const errors = trackErrors(page)
      const exp = expected(s.id)
      await loadDemo(page, s.id)
      const block = completeBlock(page)

      // Review priority as computed by the engine.
      if (exp.priority === 'NONE') await expect(block.getByText('NONE', { exact: true })).toBeVisible()
      else if (exp.priority) await expect(block.getByText(exp.priority, { exact: true })).toBeVisible()
      if (exp.trust) await expect(block.getByText(exp.trust.replace(/_/g, ' '), { exact: true })).toBeVisible()
      if (exp.surface?.['undeclaredAffected'] !== undefined) {
        const n = exp.surface['undeclaredAffected']
        await expect(block).toContainText(`${n} undeclared affected routine${n === 1 ? '' : 's'}`)
      }

      // Findings page: every required finding type is labelled; forbidden ones are absent.
      await navTo(page, 'Findings')
      await expect(page).toHaveURL(/\/app\/findings/)
      await expect(page.getByRole('heading', { level: 1, name: 'Findings' })).toBeVisible()
      const list = page.getByRole('list', { name: 'Findings in review order' })
      await expect(list).toBeVisible()
      for (const m of exp.findings?.mustInclude ?? []) {
        const types = Array.isArray(m.type) ? m.type : [m.type]
        const labels = types.map((t) => FINDING_TYPE_LABEL[t]!)
        const cards = list.getByRole('article').filter({ hasText: new RegExp(labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')) })
        await expect(cards.first()).toBeVisible()
        if (m.severity) await expect(list.getByRole('article').filter({ hasText: labels[0]! }).filter({ hasText: m.severity }).first()).toBeVisible()
      }
      for (const t of exp.findings?.mustNotIncludeTypes ?? []) {
        await expect(list.getByRole('article').filter({ hasText: FINDING_TYPE_LABEL[t]! })).toHaveCount(0)
      }

      if (s.id === '01') {
        // Priority NONE: nothing to review, said with the spec's wording and coverage lines.
        await navTo(page, 'Overview')
        const empty = page.getByRole('heading', { name: 'No safety-impacting changes identified within the declared analysis scope.' })
        await expect(empty).toBeVisible()
        // The innermost section holding the heading is the empty state itself.
        const emptyBlock = page.locator('section').filter({ has: empty }).last()
        await expect(emptyBlock).toContainText('Safety functions analyzed')
        await expect(emptyBlock).toContainText('8/8')
        await expect(emptyBlock).toContainText('Declared routines covered')
        await expect(emptyBlock).toContainText('Undeclared routines touched')
        await expect(page.getByText(/no vulnerabilities/i)).toHaveCount(0)
      }

      if (s.id === '06') {
        await expect(list.getByText('No safety intent has been declared for this logic. INTERLOCK therefore cannot conclude that it is safe.').first()).toBeVisible()
        await expect(list.getByText('UNDECLARED', { exact: true }).first()).toBeVisible()
        await expect(list.getByRole('article')).toHaveCount(3)
      }

      if (s.id === '08') {
        await navTo(page, 'Overview')
        await expect(completeBlock(page).first()).toBeVisible()
        const { total, meaningful } = await completeNumbers(page)
        expect(total).toBeGreaterThanOrEqual(100)
        expect(total).toBeLessThan(1000)
        expect(meaningful).toBeGreaterThan(0)
        expect(meaningful).toBeLessThanOrEqual(10)
        expect(meaningful * 20).toBeLessThan(total)
      }

      expect(errors).toEqual([])
    })
  }
})
