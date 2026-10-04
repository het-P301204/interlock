/**
 * Cross-project module drift (Advanced / Experimental).
 *
 * The same reusable module name can mean different logic at different sites.
 * For every module name across the supplied projects INTERLOCK groups the
 * definitions by content (parameters, local tags and normalized logic;
 * descriptions and revision excluded), picks a reference (highest revision,
 * then most sites), and compares each variant's output parameters against
 * the reference by symbolic evaluation of the module logic in isolation.
 *
 * Direction ("weaker"/"stronger") needs to know which way an output protects.
 * That comes only from safety declarations: a declared protective output
 * bound to a module output parameter at a call site gives that parameter a
 * trip state. Outputs without a declaration are reported as DIFFERENT or
 * EQUIVALENT, never guessed.
 */
import type { DriftFlag, DriftReport, FiringComparison, ModuleDrift, ModuleVariant, VariantBehavior } from '../model/analysis.ts'
import type { ModuleDefinition } from '../model/project.ts'
import type { SafetyManifest } from '../model/safety.ts'
import type { DriftInput, InspectResult } from '../api-types.ts'
import { ExprPool, negatedLabel } from '../logic/expr.ts'
import { compareConditions, type RawComparison } from '../logic/truth.ts'
import { instructionsOf, parseRung } from '../logic/rll.ts'
import { shortHash } from '../util/sha256.ts'
import { AnalysisInputError, ENGINE_VERSION, inspectProjectSync } from './pipeline.ts'
import { ProjectIndex, lc } from './project-index.ts'
import { SymbolicScan } from './scan.ts'

export interface DriftOptions {
  manifest?: SafetyManifest
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

function definitionText(m: ModuleDefinition, idx: ProjectIndex): string {
  const params = m.parameters.map((p) => `${lc(p.name)}:${p.usage}:${p.dataType}:${p.required ? 'r' : ''}`).join(',')
  const locals = m.localTags.map((t) => `${lc(t.name)}:${t.dataType}`).join(',')
  const routines = m.routineIds
    .map((id) => idx.routines.get(id))
    .filter((r) => r !== undefined)
    .map((r) => `${lc(r.name)}:${r.kind}:${r.protected ? 'protected' : r.rungs.map((x) => norm(x.text)).join('|')}`)
    .join(';')
  return `${params}#${locals}#${routines}`
}

function parameterSignature(m: ModuleDefinition): string {
  return m.parameters.map((p) => `${p.usage === 'Input' ? 'in' : p.usage === 'Output' ? 'out' : 'inout'} ${p.name}${p.required ? '' : '?'}`).join(', ')
}

function revisionKey(rev: string | undefined): number[] {
  return (rev ?? '').split(/[.\s]/).map((x) => Number.parseInt(x, 10)).map((n) => (Number.isNaN(n) ? -1 : n))
}

function compareRevisions(a: string | undefined, b: string | undefined): number {
  const x = revisionKey(a)
  const y = revisionKey(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function toFiring(pool: ExprPool, raw: RawComparison): FiringComparison {
  const out: FiringComparison = {
    verdict: raw.verdict,
    before: raw.before,
    after: raw.after,
    atoms: raw.atoms.map((i) => {
      const a = pool.atoms[i]!
      return { id: a.key, label: a.label, kind: a.kind, externalAccess: 'n/a', externallySet: false, inBaseline: true, inCurrent: true }
    }),
    exhaustive: raw.exhaustive,
    assignmentsChecked: raw.checked,
  }
  if (raw.lost) out.lost = raw.lost
  if (raw.gained) out.gained = raw.gained
  if (raw.reason) out.reason = raw.reason
  if (raw.witness)
    out.witness = {
      before: raw.witness.before,
      after: raw.witness.after,
      values: [...raw.witness.values.entries()].map(([i, v]) => {
        const a = pool.atoms[i]!
        return { atom: a.key, label: a.label, value: a.numeric || a.range ? (v ? a.label : negatedLabel(a)) : v ? '1' : '0' }
      }),
    }
  return out
}

/** Output parameters whose protective direction is declared: param (lc) → trip state. */
function declaredPolarity(manifest: SafetyManifest | undefined, module: string, idx: ProjectIndex): Map<string, 'DE_ENERGIZE' | 'ENERGIZE'> {
  const out = new Map<string, 'DE_ENERGIZE' | 'ENERGIZE'>()
  if (!manifest) return out
  const def = idx.modules.get(lc(module))
  if (!def) return out
  const required = def.parameters.filter((p) => p.required)
  for (const sf of manifest.functions) {
    if (!sf.protectiveOutput || lc(sf.implementation.module ?? '') !== lc(module)) continue
    const target = lc(sf.protectiveOutput.tag)
    for (const r of idx.project.routines) {
      if (r.kind !== 'RLL') continue
      for (const rung of r.rungs) {
        for (const ins of instructionsOf(parseRung(rung.text).elements)) {
          if (lc(ins.mnemonic) !== lc(module)) continue
          required.forEach((p, i) => {
            if (p.usage === 'Output' && lc(ins.operands[i + 1] ?? '') === target) out.set(lc(p.name), sf.protectiveOutput!.tripState)
          })
        }
      }
    }
  }
  return out
}

export async function analyzeDrift(input: DriftInput & DriftOptions): Promise<DriftReport> {
  return analyzeDriftSync(input)
}

export function analyzeDriftSync(input: DriftInput & DriftOptions): DriftReport {
  if (input.sites.length < 2) throw new AnalysisInputError('current', 'DRIFT_TOO_FEW_SITES', 'Module drift needs at least two projects.')
  const sites = input.sites.map((s) => {
    const r: InspectResult = inspectProjectSync(s, 'current')
    if (!r.ok) throw new AnalysisInputError('current', r.error.code, `${s.label}: ${r.error.message}`)
    return { label: s.label, result: r, index: new ProjectIndex(r.project) }
  })
  const pool = new ExprPool()
  const names = new Map<string, string>()
  for (const s of sites) for (const m of s.result.project.modules) if (!names.has(lc(m.name))) names.set(lc(m.name), m.name)

  const modules: ModuleDrift[] = []
  for (const [key, name] of [...names].sort((a, b) => a[1].localeCompare(b[1]))) {
    const present = sites.filter((s) => s.index.modules.has(key))
    const missingAt = sites.filter((s) => !s.index.modules.has(key)).map((s) => s.label)
    const groups = new Map<string, { def: ModuleDefinition; index: ProjectIndex; sites: string[] }>()
    for (const s of present) {
      const def = s.index.modules.get(key)!
      const hash = shortHash(definitionText(def, s.index))
      const g = groups.get(hash)
      if (g) g.sites.push(s.label)
      else groups.set(hash, { def, index: s.index, sites: [s.label] })
    }
    const entries = [...groups.entries()]
    entries.sort((a, b) => compareRevisions(b[1].def.revision, a[1].def.revision) || b[1].sites.length - a[1].sites.length)
    const [refHash, ref] = entries[0]!
    const polarity = declaredPolarity(input.manifest, name, ref.index)
    const outputsOf = (def: ModuleDefinition, idx: ProjectIndex) => {
      const scan = new SymbolicScan(pool, idx, { mode: 'rung', side: 'current' })
      const backing = scan.runModuleIsolated(def)
      const m = new Map<string, number>()
      for (const p of def.parameters) {
        if (p.usage === 'Input') continue
        const loc = `${backing}.${lc(p.name)}`
        m.set(lc(p.name), scan.valueOf({ loc, label: `${def.name}.${p.name}` }))
      }
      return m
    }
    const refOutputs = outputsOf(ref.def, ref.index)
    const notes: string[] = []
    if (polarity.size) notes.push(`Protective direction from declarations: ${[...polarity].map(([p, t]) => `${p} (${t === 'DE_ENERGIZE' ? 'acts at 0' : 'acts at 1'})`).join(', ')}.`)
    else if (entries.length > 1) notes.push('No safety declaration binds an output of this module, so differences are reported without a direction.')
    const variants: ModuleVariant[] = entries.map(([hash, g]) => {
      const variant: ModuleVariant = { hash, sites: g.sites, parameterSignature: parameterSignature(g.def), behavior: 'REFERENCE', outputs: [] }
      if (g.def.revision !== undefined) variant.revision = g.def.revision
      if (hash === refHash) return variant
      if (g.def.protected || ref.def.protected) {
        variant.behavior = 'NOT_DECIDED'
        return variant
      }
      const outs = outputsOf(g.def, g.index)
      let behavior: VariantBehavior = 'EQUIVALENT'
      const rank: Record<VariantBehavior, number> = { REFERENCE: 0, EQUIVALENT: 0, STRONGER: 1, DIFFERENT: 2, WEAKER: 3, NOT_DECIDED: 4 }
      for (const [param, refValue] of refOutputs) {
        const v = outs.get(param)
        const label = ref.def.parameters.find((p) => lc(p.name) === param)?.name ?? param
        if (v === undefined) {
          behavior = rank.DIFFERENT > rank[behavior] ? 'DIFFERENT' : behavior
          continue
        }
        const trip = polarity.get(param)
        const before = trip === 'DE_ENERGIZE' ? pool.not(refValue) : refValue
        const after = trip === 'DE_ENERGIZE' ? pool.not(v) : v
        const raw = compareConditions(pool, before, after)
        variant.outputs.push({ parameter: trip ? `${label} (acts ${trip === 'DE_ENERGIZE' ? 'at 0' : 'at 1'})` : label, comparison: toFiring(pool, raw) })
        let b: VariantBehavior
        if (raw.verdict === 'UNCHANGED' || raw.verdict === 'EQUIVALENT') b = 'EQUIVALENT'
        else if (raw.verdict === 'NOT_DECIDED') b = 'NOT_DECIDED'
        else if (!trip) b = 'DIFFERENT'
        else if (raw.verdict === 'WEAKENED' || raw.verdict === 'NEVER_FIRES' || raw.verdict === 'MIXED') b = 'WEAKER'
        else b = 'STRONGER'
        if (rank[b] > rank[behavior]) behavior = b
      }
      variant.behavior = behavior
      return variant
    })
    const flags: DriftFlag[] = []
    if (variants.length > 1) flags.push('SAME_NAME_DIFFERENT_DEFINITION')
    const byRevision = new Map<string, number>()
    for (const v of variants) byRevision.set(v.revision ?? '', (byRevision.get(v.revision ?? '') ?? 0) + 1)
    if ([...byRevision.values()].some((n) => n > 1)) {
      flags.push('REVISION_NOT_BUMPED')
      for (const [rev, n] of byRevision) if (n > 1) notes.push(`${n} different definitions all claim revision ${rev || 'unspecified'}.`)
    }
    if (variants.some((v) => compareRevisions(v.revision, ref.def.revision) < 0)) flags.push('OLDER_REVISION')
    if (variants.some((v) => v.behavior === 'WEAKER' || v.behavior === 'STRONGER' || v.behavior === 'DIFFERENT')) flags.push('SAFETY_BEHAVIOR_DIFFERS')
    if (missingAt.length) flags.push('MISSING_AT_SITE')
    for (const v of variants) {
      if (v.behavior === 'WEAKER') notes.push(`${v.sites.join(', ')} run${v.sites.length === 1 ? 's' : ''} a weaker implementation than the reference (${ref.sites.join(', ')}, revision ${ref.def.revision ?? 'unspecified'}).`)
    }
    modules.push({ module: name, status: variants.length > 1 || missingAt.length ? 'DRIFT' : 'CONSISTENT', reference: ref.sites[0]!, variants, flags, missingAt, notes })
  }
  return {
    schema: 'interlock.drift/v1',
    analyzedAt: input.analyzedAt,
    engineVersion: ENGINE_VERSION,
    sites: sites.map((s) => ({ label: s.label, file: s.result.file, controller: (s.result as Extract<InspectResult, { ok: true }>).project.metadata.controllerName })),
    modules,
  }
}
