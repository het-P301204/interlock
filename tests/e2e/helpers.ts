/**
 * Shared helpers for the INTERLOCK end-to-end suite. Selectors are roles,
 * labels and visible text only; waits are on visible state, never timeouts.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const fixture = (...p: string[]) => path.join(ROOT, 'fixtures', ...p)

export function sha256Of(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export interface Scenario {
  id: string
  slug: string
  title: string
  kind: 'compare' | 'drift'
}

export const SCENARIOS: Scenario[] = (JSON.parse(readFileSync(fixture('scenarios.json'), 'utf8')) as { scenarios: Scenario[] }).scenarios

export function scenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id)
  if (!s) throw new Error(`No scenario ${id} in fixtures/scenarios.json`)
  return s
}

export interface Expected {
  scenario: string
  title: string
  priority?: string
  trust?: string
  surface?: Record<string, number>
  findings?: { mustInclude?: Array<{ type: string | string[]; severity?: string }>; mustNotIncludeTypes?: string[] }
  safetyStatus?: Record<string, string>
  changeCounts?: Record<string, { min: number; max: number }>
  drift?: Record<string, unknown>
}

export function expected(id: string): Expected {
  const s = scenario(id)
  return JSON.parse(readFileSync(fixture('expected', `${s.id}-${s.slug}.json`), 'utf8')) as Expected
}

/** Display labels for finding types, mirrored from apps/web/src/features/findings/meta.ts. */
export const FINDING_TYPE_LABEL: Record<string, string> = {
  PROTECTIVE_PATH_REMOVED: 'Protective path removed',
  NEW_INHIBIT: 'New inhibit added',
  SHUTDOWN_WEAKENED: 'Shutdown condition weakened',
  PROTECTIVE_OUTPUT_BYPASSED: 'Protective output bypassed',
  ALARM_SUPPRESSED: 'Alarm path suppressed',
  PERMISSIVE_WEAKENED: 'Permissive weakened',
  INTERLOCK_WEAKENED: 'Interlock weakened',
  SETPOINT_RELAXED: 'Setpoint relaxed',
  TRIP_DELAY_INCREASED: 'Trip delay increased',
  EXECUTION_CONTROL_INTRODUCED: 'Execution control introduced',
  SHARED_MODULE_PROPAGATION: 'Shared module propagation',
  UNDECLARED_LOGIC_CHANGED: 'Undeclared routine affected',
  PROTECTION_STRENGTHENED: 'Protective condition strengthened',
  COSMETIC_LOGIC_CHANGE: 'Cosmetic logic change',
  NON_SAFETY_LOGIC_CHANGE: 'Non-safety logic change',
  DECLARATION_UNRESOLVED: 'Declaration unresolved',
  MODULE_REVISION_NOT_BUMPED: 'Module revision not bumped',
  EXTERNAL_WRITE_ACCESS_GRANTED: 'External write access granted',
}

/** Collects console errors and uncaught page errors for the whole test. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

/** Records every request whose origin is not the app's own (data: and blob: are local). */
export function trackForeignRequests(page: Page, baseURL: string): string[] {
  const own = new URL(baseURL).origin
  const foreign: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (url.startsWith('data:') || url.startsWith('blob:')) return
    if (new URL(url).origin !== own) foreign.push(url)
  })
  return foreign
}

export const completeHeading = (page: Page) => page.getByRole('heading', { name: 'ANALYSIS COMPLETE' })
export const pipelineStages = (page: Page) => page.getByRole('list', { name: 'Analysis pipeline stages' }).getByRole('listitem')

/** The ANALYSIS COMPLETE block on the ingest page or Overview. */
export const completeBlock = (page: Page): Locator => page.locator('section').filter({ has: completeHeading(page) })

/** Opens the Demo page, loads a compare scenario and waits for ANALYSIS COMPLETE. */
export async function loadDemo(page: Page, id: string): Promise<void> {
  const s = scenario(id)
  await page.goto('/app/demo')
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: s.title }) })
  await row.getByRole('button', { name: 'Load Demo Scenario' }).click()
  await expect(page).toHaveURL(/\/app\/new$/)
  await expect(completeHeading(page)).toBeVisible({ timeout: 45_000 })
}

/** In-app navigation through the visible workspace navigation (sidebar on desktop, bottom bar / More sheet on phones). */
export async function navTo(page: Page, label: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Primary' })
  const link = nav.getByRole('link', { name: label, exact: true })
  if (await link.isVisible()) {
    await link.click()
    return
  }
  await nav.getByRole('button', { name: 'More' }).click()
  await page.getByRole('dialog', { name: 'Workspace' }).getByRole('link', { name: label }).click()
}

/** Body background as an [r, g, b] triple. */
export async function bodyBackground(page: Page): Promise<[number, number, number]> {
  const css = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const m = css.match(/\d+(\.\d+)?/g)
  if (!m || m.length < 3) throw new Error(`Unparseable background ${css}`)
  return [Number(m[0]), Number(m[1]), Number(m[2])]
}
