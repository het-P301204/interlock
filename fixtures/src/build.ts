/**
 * Builds every generated fixture in memory: L5X files, manifests, expected
 * findings, the scenario registry and the README. scripts/build-fixtures.ts
 * writes the result to disk or compares it with disk (--check). Pure.
 */
import { EXPECTED_01, EXPECTED_02, EXPECTED_03, EXPECTED_04, EXPECTED_05, EXPECTED_06, EXPECTED_07, EXPECTED_08, EXPECTED_09 } from './expected.ts'
import { writeL5X } from './l5x-writer.ts'
import { largeBaseline, largeCurrent } from './large.ts'
import { northgateLargeManifest, northgateManifest } from './manifest.ts'
import { readme } from './readme.ts'
import { scenarioRegistry } from './registry.ts'
import {
  baseline,
  currentAlarmSuppressed,
  currentAoiModified,
  currentNormal,
  currentPathRemoved,
  currentProtectiveBypass,
  currentShutdownWeakened,
  currentUndeclaredChange,
  siteA,
  siteB,
  siteC,
} from './scenarios.ts'
import type { ControllerModel, Expected, FixtureFile } from './types.ts'

/** Every L5X model, keyed by its path relative to fixtures/. */
export function buildModels(): Map<string, ControllerModel> {
  const base = baseline()
  const lb = largeBaseline()
  return new Map<string, ControllerModel>([
    ['l5x/baseline-safe.L5X', base],
    ['l5x/current-normal.L5X', currentNormal(base)],
    ['l5x/current-shutdown-weakened.L5X', currentShutdownWeakened(base)],
    ['l5x/current-alarm-suppressed.L5X', currentAlarmSuppressed(base)],
    ['l5x/current-aoi-modified.L5X', currentAoiModified(base)],
    ['l5x/current-protective-bypass.L5X', currentProtectiveBypass(base)],
    ['l5x/current-undeclared-change.L5X', currentUndeclaredChange(base)],
    ['l5x/current-path-removed.L5X', currentPathRemoved(base)],
    ['l5x/site-a.L5X', siteA(base)],
    ['l5x/site-b-drift.L5X', siteB(base)],
    ['l5x/site-c-legacy.L5X', siteC(base)],
    ['l5x/baseline-large.L5X', lb],
    ['l5x/current-large.L5X', largeCurrent(lb)],
  ])
}

export function expectedById(): Map<string, Expected> {
  return new Map<string, Expected>(
    [EXPECTED_01, EXPECTED_02, EXPECTED_03, EXPECTED_04, EXPECTED_05, EXPECTED_06, EXPECTED_07, EXPECTED_08, EXPECTED_09].map((e) => [e.scenario, e]),
  )
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

export function buildFixtureFiles(): FixtureFile[] {
  const files: FixtureFile[] = []
  const models = buildModels()
  for (const [path, model] of models) files.push({ path, content: writeL5X(model) })

  files.push({ path: 'manifests/northgate.safety.json', content: json(northgateManifest()) })
  files.push({ path: 'manifests/northgate-large.safety.json', content: json(northgateLargeManifest()) })

  const registry = scenarioRegistry()
  const expected = expectedById()
  for (const s of registry.scenarios) {
    const e = expected.get(s.id)
    if (e === undefined) throw new Error(`No expected findings for scenario ${s.id}`)
    files.push({ path: s.expected, content: json(e) })
  }
  files.push({ path: 'scenarios.json', content: json(registry) })

  const base = models.get('l5x/baseline-safe.L5X')
  if (base === undefined) throw new Error('baseline missing')
  files.push({ path: 'README.md', content: readme(base, northgateManifest(), registry, expected) })

  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
