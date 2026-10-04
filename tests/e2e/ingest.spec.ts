import { expect, test } from '@playwright/test'
import { completeBlock, completeHeading, fixture, pipelineStages, sha256Of, trackErrors } from './helpers.ts'

const BASELINE = fixture('l5x', 'baseline-safe.L5X')
const CURRENT = fixture('l5x', 'current-shutdown-weakened.L5X')

test.describe('Ingest', () => {
  test('two real uploads, demo declarations, ten stages, CRITICAL review priority', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/app/new')

    const versions = page.getByRole('region', { name: 'Project versions' })
    await versions.getByLabel(/^BASELINE/).setInputFiles(BASELINE)
    await versions.getByLabel(/^CURRENT/).setInputFiles(CURRENT)

    for (const [role, file, name] of [
      ['BASELINE', BASELINE, 'baseline-safe.L5X'],
      ['CURRENT', CURRENT, 'current-shutdown-weakened.L5X'],
    ] as const) {
      const card = page.getByRole('region', { name: `${role} project` })
      await expect(card.getByText('READY', { exact: true })).toBeVisible()
      await expect(card).toContainText(name)
      const sha = sha256Of(file)
      await expect(card).toContainText(sha.slice(0, 16))
      await expect(card.getByText('SHA-256', { exact: true })).toBeVisible()
      await expect(card).toContainText('NORTHGATE_PS')
      await expect(card).toContainText('Rockwell')
    }

    const analyze = page.getByRole('button', { name: 'Analyze Project' })
    await expect(analyze).toBeDisabled()
    await page.getByRole('button', { name: 'Use the Northgate demo declarations' }).click()
    await expect(page.getByRole('region', { name: 'Safety declarations' })).toContainText('8 declared functions')
    await expect(analyze).toBeEnabled()
    await analyze.click()

    const stages = pipelineStages(page)
    await expect(stages).toHaveCount(10)
    for (const label of [
      'INGEST',
      'NORMALIZE',
      'RESOLVE MODULES',
      'BUILD REUSE GRAPH',
      'MAP SAFETY FUNCTIONS',
      'COMPARE LOGIC',
      'TRACE PROTECTIVE PATHS',
      'ANALYZE ALARMS',
      'RANK IMPACT',
      'GENERATE REVIEW SET',
    ]) {
      await expect(stages.filter({ hasText: label })).toContainText('— complete')
    }
    await expect(stages.filter({ hasText: '— complete' })).toHaveCount(10)

    await expect(completeHeading(page)).toBeVisible()
    const block = completeBlock(page)
    await expect(block).toContainText('Review priority')
    await expect(block).toContainText('CRITICAL')

    await block.getByRole('link', { name: 'Open Impact Review' }).click()
    await expect(page).toHaveURL(/\/app$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Impact Review' })).toBeVisible()
    await expect(page.getByText('Total changes', { exact: true })).toBeVisible()

    expect(errors).toEqual([])
  })
})

test.describe('Malformed input', () => {
  test('a DOCTYPE (XXE) export is refused with location and reason; analysis stays disabled', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/app/new')
    await page.getByRole('region', { name: 'Project versions' }).getByLabel(/^BASELINE/).setInputFiles(fixture('adversarial', 'xxe-external-entity.L5X'))

    const card = page.getByRole('region', { name: 'BASELINE project' })
    const alert = card.getByRole('alert')
    await expect(alert.getByRole('heading', { name: /project parse failed/i })).toBeVisible()
    await expect(alert).toContainText('DOCTYPE')
    await expect(alert).toContainText('Location')
    await expect(alert).toContainText('Reason')
    await expect(alert).toContainText('XML_DOCTYPE_FORBIDDEN')
    await expect(alert).toContainText('INTERLOCK did not continue analysis because the semantic model could not be trusted.')
    await expect(card.getByText('BLOCKED', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Use the Northgate demo declarations' }).click()
    await page.getByRole('region', { name: 'Project versions' }).getByLabel(/^CURRENT/).setInputFiles(fixture('l5x', 'current-normal.L5X'))
    await expect(page.getByRole('region', { name: 'CURRENT project' }).getByText('READY', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Analyze Project' })).toBeDisabled()
    await expect(page.getByRole('list', { name: 'Still needed' })).toContainText('Baseline project could not be parsed')

    expect(errors).toEqual([])
  })

  test('a non-L5X root element gets a clear parse error, not a crash', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/app/new')
    await page.getByRole('region', { name: 'Project versions' }).getByLabel(/^CURRENT/).setInputFiles(fixture('adversarial', 'wrong-root.xml'))

    const card = page.getByRole('region', { name: 'CURRENT project' })
    const alert = card.getByRole('alert')
    await expect(alert.getByRole('heading', { name: /project parse failed/i })).toBeVisible()
    await expect(alert).toContainText(/RSLogix5000Content|root/i)
    await expect(page.getByRole('button', { name: 'Analyze Project' })).toBeDisabled()
    // The page is still alive: the failed file can be replaced.
    await expect(card.getByText('Choose another file')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Compare two exports of one project' })).toBeVisible()

    expect(errors).toEqual([])
  })
})
