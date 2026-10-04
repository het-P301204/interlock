/**
 * Display vocabulary and derivations for cross-project module drift. Every
 * value shown comes from the engine's DriftReport; the only derivation here
 * is which sites each flag is about, read from the variants' revisions and
 * behaviours.
 */
import type { DriftFlag, DriftReport, ModuleDrift, ModuleVariant, SafetyManifest, VariantBehavior } from '@interlock/core/types'
import type { GlyphShape, Tone } from '../../ui/Badge.tsx'
import { loadFixtureFile, loadFixtureText } from '../../demo/fixtures.ts'
import { SCENARIOS } from '../../demo/scenarios.ts'
import type { Scenario } from '../../demo/scenarios.ts'

export const FLAG_META: Record<DriftFlag, { label: string; tone: Tone; shape: GlyphShape; explain: string }> = {
  SAME_NAME_DIFFERENT_DEFINITION: {
    label: 'Same name, different definition',
    tone: 'marigold',
    shape: 'triangle',
    explain: 'Sites carry a module with this name whose parameters, local tags or logic differ. The name alone no longer tells you what runs.',
  },
  REVISION_NOT_BUMPED: {
    label: 'Revision not bumped',
    tone: 'coral',
    shape: 'octagon',
    explain: 'Different definitions claim the same revision: the module was edited in place, so its revision number no longer identifies its logic.',
  },
  OLDER_REVISION: {
    label: 'Older revision',
    tone: 'marigold',
    shape: 'triangle',
    explain: 'A site runs an older revision than the reference and lacks whatever later revisions added.',
  },
  SAFETY_BEHAVIOR_DIFFERS: {
    label: 'Safety behaviour differs',
    tone: 'coral',
    shape: 'octagon',
    explain: 'An output that a declared safety function depends on acts in different cases at different sites.',
  },
  MISSING_AT_SITE: {
    label: 'Missing at site',
    tone: 'outline',
    shape: 'ring',
    explain: 'The module is defined at some sites and absent from others.',
  },
}

export const BEHAVIOR_META: Record<VariantBehavior, { label: string; tone: Tone; shape: GlyphShape; explain: string }> = {
  REFERENCE: { label: 'Reference', tone: 'neutral', shape: 'diamond', explain: 'Highest revision, then most sites: every other variant is compared with this one.' },
  EQUIVALENT: { label: 'Equivalent', tone: 'iris', shape: 'square', explain: 'Different text, but every output acts in exactly the same cases.' },
  WEAKER: { label: 'Weaker', tone: 'coral', shape: 'octagon', explain: 'A protective output acts in fewer cases than the reference.' },
  STRONGER: { label: 'Stronger', tone: 'sage', shape: 'check', explain: 'A protective output acts in more cases than the reference.' },
  DIFFERENT: { label: 'Different', tone: 'marigold', shape: 'triangle', explain: 'Outputs differ, and no declaration says which direction is protective.' },
  NOT_DECIDED: { label: 'Not decided', tone: 'outline', shape: 'ring', explain: 'The comparison could not be completed (unsupported construct or bound exceeded).' },
}

function revKey(rev: string | undefined): number[] {
  return (rev ?? '').split(/[.\s]/).map((x) => Number.parseInt(x, 10)).map((n) => (Number.isNaN(n) ? -1 : n))
}

export function compareRevision(a: string | undefined, b: string | undefined): number {
  const x = revKey(a)
  const y = revKey(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function referenceVariant(m: ModuleDrift): ModuleVariant | undefined {
  return m.variants.find((v) => v.behavior === 'REFERENCE') ?? m.variants.find((v) => v.sites.includes(m.reference))
}

/** Sites each flag is about. */
export function flagSites(m: ModuleDrift): Partial<Record<DriftFlag, string[]>> {
  const ref = referenceVariant(m)
  const out: Partial<Record<DriftFlag, string[]>> = {}
  const others = m.variants.filter((v) => v !== ref)
  out.REVISION_NOT_BUMPED = others.filter((v) => m.variants.some((w) => w !== v && w.revision !== undefined && w.revision === v.revision)).flatMap((v) => v.sites)
  out.OLDER_REVISION = ref ? others.filter((v) => compareRevision(v.revision, ref.revision) < 0).flatMap((v) => v.sites) : []
  out.SAFETY_BEHAVIOR_DIFFERS = others.filter((v) => v.behavior === 'WEAKER' || v.behavior === 'STRONGER' || v.behavior === 'DIFFERENT').flatMap((v) => v.sites)
  out.SAME_NAME_DIFFERENT_DEFINITION = others.flatMap((v) => v.sites)
  out.MISSING_AT_SITE = m.missingAt
  return out
}

/** "AOI_PumpInterlock.ESD_Active OR …" → "ESD_Active OR …": the module prefix is implied by the context. */
export function stripModulePrefix(text: string, module: string): string {
  return text.split(`${module}.`).join('')
}

export function variantOf(m: ModuleDrift, site: string): ModuleVariant | undefined {
  return m.variants.find((v) => v.sites.includes(site))
}

export function driftSummary(r: DriftReport): { drift: number; consistent: number; weaker: number } {
  let weaker = 0
  for (const m of r.modules) for (const v of m.variants) if (v.behavior === 'WEAKER') weaker += v.sites.length
  return { drift: r.modules.filter((m) => m.status === 'DRIFT').length, consistent: r.modules.filter((m) => m.status === 'CONSISTENT').length, weaker }
}

/* ------------------------------------------------------- demo scenario */

export function driftScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id && s.kind === 'drift')
}

export interface LoadedScenario {
  sites: Array<{ label: string; name?: string; file: File }>
  manifest?: { name: string; json: unknown }
}

/** Loads a drift scenario's fixture files exactly as if the user had chosen them. */
export async function loadDriftScenario(s: Scenario): Promise<LoadedScenario> {
  if (s.kind !== 'drift' || !s.sites || s.sites.length < 2) throw new Error(`Scenario ${s.id} is not a multi-site drift scenario.`)
  const sites = await Promise.all(s.sites.map(async (x) => ({ label: x.label, name: x.name, file: await loadFixtureFile(x.file) })))
  let manifest: LoadedScenario['manifest']
  if (s.manifest) manifest = { name: s.manifest.slice(s.manifest.lastIndexOf('/') + 1), json: JSON.parse(await loadFixtureText(s.manifest)) as unknown }
  return { sites, manifest }
}

export type { SafetyManifest }
