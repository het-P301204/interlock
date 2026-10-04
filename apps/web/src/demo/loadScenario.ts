/**
 * Loads a demo scenario into the workspace exactly as if the user had chosen
 * the files: both exports go through inspect (hash + parse in the worker),
 * the declarations through validateManifest, then the analysis runs.
 */
import { useWorkspace } from '../state/analysis.ts'
import { loadFixtureFile, loadFixtureText } from './fixtures.ts'
import type { Scenario } from './scenarios.ts'

export function scenarioAvailable(s: Scenario, has: (p: string) => boolean): boolean {
  if (s.kind !== 'compare' || !s.baseline || !s.current || !s.manifest) return false
  return has(s.baseline) && has(s.current) && has(s.manifest)
}

export async function loadScenario(s: Scenario): Promise<void> {
  if (s.kind !== 'compare' || !s.baseline || !s.current || !s.manifest) throw new Error(`Scenario ${s.id} is not a two-version comparison.`)
  const ws = useWorkspace.getState()
  const [b, c, m] = await Promise.all([loadFixtureFile(s.baseline), loadFixtureFile(s.current), loadFixtureText(s.manifest)])
  const manifestName = s.manifest.slice(s.manifest.lastIndexOf('/') + 1)
  await Promise.all([ws.loadSide('baseline', b), ws.loadSide('current', c), ws.loadManifestJson(manifestName, JSON.parse(m) as unknown, 'demo')])
  const after = useWorkspace.getState()
  const ok = (side: 'baseline' | 'current') => after[side].phase === 'ready' && after[side].result?.ok && after[side].result.summary.readiness !== 'BLOCKED'
  if (ok('baseline') && ok('current') && after.manifest) await after.startAnalysis()
}
