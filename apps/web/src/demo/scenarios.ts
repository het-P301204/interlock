/**
 * Built-in demo scenarios, read from fixtures/scenarios.json (the fixture
 * catalogue is the single source of truth). These are names and file paths
 * only: results always come from running the engine on the fixture files.
 */
export interface ScenarioSite {
  label: string
  name?: string
  file: string
}

export interface Scenario {
  id: string
  slug: string
  title: string
  summary: string
  kind: 'compare' | 'drift'
  baseline?: string
  current?: string
  sites?: ScenarioSite[]
  manifest?: string
  highlights: string[]
}

const catalogue = import.meta.glob<{ scenarios?: Scenario[] }>('../../../../fixtures/scenarios.json', { eager: true, import: 'default' })

export const SCENARIOS: Scenario[] = Object.values(catalogue)[0]?.scenarios ?? []

export const DEMO_MANIFEST = 'manifests/northgate.safety.json'
