/**
 * Rules about protective outputs: how a declared function's firing condition
 * changed and why.
 *
 * When a firing condition is weakened, several explanations can be true at
 * once (a new writer that also introduces a new term, for example). The
 * classifier picks the most specific one in a fixed precedence order so each
 * weakening yields exactly one finding:
 *
 *   1. PROTECTIVE_OUTPUT_BYPASSED  a new writer outside the declared implementation, or the function can never act
 *   2. PROTECTIVE_PATH_REMOVED     a baseline writer no longer executes
 *   3. NEW_INHIBIT                 fixing one new term restores the baseline exactly (proved)
 *   4. PROTECTIVE_PATH_REMOVED     a baseline trip cause no longer appears
 *   5. SETPOINT_RELAXED            a comparison constant on a trip input moved
 *   6. SHUTDOWN/INTERLOCK/PERMISSIVE_WEAKENED  weaker, for a reason not listed above
 */
import type { FindingType, Severity } from '../../model/analysis.ts'
import type { SafetyFunction } from '../../model/safety.ts'
import { negatedLabel, numericLabel } from '../../logic/expr.ts'
import type { RawComparison } from '../../logic/truth.ts'
import type { SfAnalysis, Suppressor } from '../safety.ts'
import { findSuppressors, isWeakening } from '../safety.ts'
import type { Effect, EvidenceHint, Rule, RuleContext } from './types.ts'
import { KIND_NOUN, capByCriticality } from './types.ts'

export interface WeakeningClass {
  type: FindingType
  suppressors: Suppressor[]
  removedAtoms: string[]
  setpoints: Array<{ subject: string; before: string[]; after: string[] }>
  neverFires: boolean
}

const MEANINGFUL = new Set(['logic', 'execution', 'interface', 'configuration'])

export function meaningfulChangeIds(ctx: RuleContext, sfId: string): string[] {
  return (ctx.sfChanges.get(sfId) ?? []).filter((id) => MEANINGFUL.has(ctx.changeById.get(id)?.category ?? ''))
}

function genericType(sf: SafetyFunction): FindingType {
  if (sf.kind === 'INTERLOCK') return 'INTERLOCK_WEAKENED'
  if (sf.kind === 'PERMISSIVE') return 'PERMISSIVE_WEAKENED'
  return 'SHUTDOWN_WEAKENED'
}

export function classifyProtective(ctx: RuleContext, a: SfAnalysis): WeakeningClass | null {
  const p = a.protective
  if (!p || !isWeakening(p.raw.verdict)) return null
  const pool = ctx.pool
  const base: WeakeningClass = { type: genericType(a.sf), suppressors: [], removedAtoms: [], setpoints: [], neverFires: false }
  if (p.newWriters.length > 0) return { ...base, type: 'PROTECTIVE_OUTPUT_BYPASSED' }
  if (p.raw.verdict === 'NEVER_FIRES' || !p.raw.afterSatisfiable) return { ...base, type: 'PROTECTIVE_OUTPUT_BYPASSED', neverFires: true }
  if (p.lostWriters.length > 0) return { ...base, type: 'PROTECTIVE_PATH_REMOVED' }
  const suppressors = findSuppressors(pool, p.tripB, p.tripC)
  if (suppressors.length > 0) return { ...base, type: 'NEW_INHIBIT', suppressors }
  const before = new Set(pool.atomsOf([p.tripB]))
  const after = new Set(pool.atomsOf([p.tripC]))
  const removed = [...before].filter((x) => !after.has(x) && !pool.atoms[x]!.numeric && !pool.atoms[x]!.range)
  if (removed.length > 0) return { ...base, type: 'PROTECTIVE_PATH_REMOVED', removedAtoms: removed.map((x) => pool.atoms[x]!.label) }
  const bySubject = (set: Set<number>) => {
    const m = new Map<string, string[]>()
    for (const x of set) {
      const at = pool.atoms[x]!
      if (!at.numeric) continue
      const list = m.get(at.numeric.subjectLabel) ?? []
      list.push(numericLabel(at.numeric))
      m.set(at.numeric.subjectLabel, list)
    }
    return m
  }
  const sb = bySubject(before)
  const sa = bySubject(after)
  const setpoints: WeakeningClass['setpoints'] = []
  for (const [subject, list] of sb) {
    const other = sa.get(subject)
    if (other && other.slice().sort().join('|') !== list.slice().sort().join('|')) setpoints.push({ subject, before: list, after: other })
  }
  if (setpoints.length > 0) return { ...base, type: 'SETPOINT_RELAXED', setpoints }
  return base
}

function hasOpaque(ctx: RuleContext, raw: RawComparison): boolean {
  return raw.atoms.some((x) => ctx.pool.atoms[x]!.kind === 'opaque')
}

export function confidenceOf(ctx: RuleContext, a: SfAnalysis, raw: RawComparison): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (!raw.exhaustive) return 'LOW'
  const unsupportedInCone = [ctx.baseline, ctx.current].some((side) =>
    side.scan.diagnostics.some((d) => d.locs.some((l) => (side === ctx.baseline ? a.coneB : a.coneC).has(`loc:${l}`))),
  )
  return hasOpaque(ctx, raw) || unsupportedInCone ? 'MEDIUM' : 'HIGH'
}

function witnessText(ctx: RuleContext, raw: RawComparison): string | null {
  if (!raw.witness) return null
  const parts = [...raw.witness.values.entries()].map(([atom, v]) => {
    const at = ctx.pool.atoms[atom]!
    if (at.numeric || at.range) return v ? at.label : negatedLabel(at)
    return `${at.label} = ${v ? 1 : 0}`
  })
  return parts.join(', ')
}

function tripStateText(sf: SafetyFunction): string {
  return sf.protectiveOutput?.tripState === 'ENERGIZE' ? 'energized (1) to act' : 'de-energized (0) to act'
}

function accessNote(ctx: RuleContext, label: string, atomIndex: number): string[] {
  const out: string[] = []
  const atom = ctx.pool.atoms[atomIndex]!
  const key = atom.key.startsWith('tag:') ? atom.key.slice(4) : null
  if (!key) return out
  const meta = ctx.current.scan.meta.get(key)
  const writers = ctx.current.scan.executedWrites(key)
  if (writers.length === 0) out.push(`No executing logic writes ${label}; its value comes from outside the controller logic (an input, an HMI or another client).`)
  if (meta && meta.externalAccess === 'Read/Write') out.push(`${label} has external access Read/Write: an HMI or OPC client can set it.`)
  return out
}

function protectiveEvidence(ctx: RuleContext, a: SfAnalysis, changeIds: string[], extra: EvidenceHint[] = []): EvidenceHint[] {
  const p = a.protective!
  return [
    ...changeIds.map((changeId) => ({ kind: 'change' as const, changeId })),
    ...extra,
    { kind: 'declaration', sfId: a.sf.id },
    {
      kind: 'computation',
      title: `Firing condition of ${a.sf.name}`,
      comparison: p.raw,
      note: `Protective output ${p.outC.label} (${tripStateText(a.sf)}). ${p.raw.exhaustive ? `Every consistent combination of ${p.raw.atoms.length} input(s) was checked (${p.raw.checked.toLocaleString('en-US')} assignments).` : (p.raw.reason ?? 'Not decided.')}`,
    },
  ]
}

function baseExplanation(a: SfAnalysis): string[] {
  const p = a.protective!
  const noun = KIND_NOUN[a.sf.kind]!
  return [
    `In the baseline, the ${noun} acts (${p.outB.label} ${a.sf.protectiveOutput!.tripState === 'ENERGIZE' ? '= 1' : '= 0'}) when: ${p.raw.before.text}.`,
    `In the current project, it acts when: ${p.raw.after.text}.`,
  ]
}

function location(a: SfAnalysis) {
  const impl = a.sf.implementation
  const loc: Effect['location'] = { tag: a.protective?.outC.label ?? a.sf.protectiveOutput?.tag ?? '' }
  if (impl.program) loc.program = impl.program
  if (impl.routine) loc.routine = impl.routine
  if (impl.program && impl.routine) loc.routineId = `program:${impl.program}/${impl.routine}`
  return loc
}

function makeProtectiveEffect(ctx: RuleContext, a: SfAnalysis, cls: WeakeningClass, ruleId: string): Effect {
  const p = a.protective!
  const sf = a.sf
  const noun = KIND_NOUN[sf.kind]!
  const Noun = noun[0]!.toUpperCase() + noun.slice(1)
  const changeIds = meaningfulChangeIds(ctx, sf.id)
  const explanation = baseExplanation(a)
  const impact: string[] = []
  const recommendation: string[] = []
  const evidence: EvidenceHint[] = []
  let title: string
  let summary: string
  let severity: Severity = capByCriticality('CRITICAL', sf)
  let bonus = 0
  let loc = location(a)
  const witness = witnessText(ctx, p.raw)
  const lostText = p.raw.lost?.text

  switch (cls.type) {
    case 'PROTECTIVE_OUTPUT_BYPASSED': {
      if (cls.neverFires) {
        title = `Protective output bypassed: ${sf.name} can no longer act`
        summary = `The ${noun} condition for ${p.outC.label} can never become true in the current project.`
        explanation.push(`No combination of inputs drives ${p.outC.label} to its safe state any more. The function has been bypassed in logic.`)
      } else {
        const w = p.newWriters[0]!
        const routine = ctx.current.index.routines.get(w.routineId)
        const where = routine ? `${routine.container.name}/${routine.name} rung ${w.rung}` : `${w.routineId} rung ${w.rung}`
        if (routine) {
          loc = { program: routine.container.name, routine: routine.name, routineId: routine.id, rung: w.rung, tag: p.outC.label }
          const rungText = routine.rungs.find((x) => x.number === w.rung)?.text
          if (rungText) explanation.push(`The new rung in ${where}: ${rungText}`)
        }
        const impl = new Set([
          ...(sf.implementation.program && sf.implementation.routine ? [`program:${sf.implementation.program}/${sf.implementation.routine}`.toLowerCase()] : []),
        ])
        const outside = !impl.has(w.routineId.toLowerCase()) && !(sf.implementation.module && w.routineId.toLowerCase().startsWith(`module:${sf.implementation.module.toLowerCase()}/`))
        title = `Protective output ${p.outC.label} bypassed by a new writer`
        summary = `${w.instruction} in ${where} now writes the protective output of ${sf.name}${outside ? ', outside its declared implementation' : ', overriding the protective logic'}.`
        explanation.push(
          `${p.newWriters.length === 1 ? 'A new instruction writes' : `${p.newWriters.length} new instructions write`} ${p.outC.label}: ${p.newWriters.map((x) => `${x.instruction} (${x.routineId.replace(/^program:/, '')} rung ${x.rung})`).join('; ')}.`,
          `INTERLOCK executes the scan in order, so the last write wins: the output can now hold a value the protective logic did not choose.`,
        )
        for (const x of p.newWriters) evidence.push({ kind: 'writer', side: 'current', writer: x, note: 'New writer of the protective output' })
      }
      impact.push(`${sf.name} can be defeated: in the situations below the protective output no longer reaches its safe state.`)
      if (lostText) impact.push(`No longer acts when: ${lostText}.`)
      recommendation.push(
        `Treat every write to ${p.outC.label} outside ${sf.implementation.routine ?? sf.implementation.module ?? 'the declared implementation'} as a bypass until shown otherwise.`,
        'If a commissioning or manual override is required, implement it inside the protective logic with an explicit, alarmed bypass state and an expiry.',
        'Confirm the change went through management of change and that the override cannot be left active.',
      )
      bonus = 6
      break
    }
    case 'PROTECTIVE_PATH_REMOVED': {
      if (p.lostWriters.length > 0) {
        title = `Protective path removed: ${sf.name} logic no longer executes`
        summary = `${p.lostWriters[0]!.reason[0]!.toUpperCase()}${p.lostWriters[0]!.reason.slice(1)}, so ${p.outC.label} is no longer driven by the protective logic.`
        explanation.push(...p.lostWriters.map((w) => `Baseline writer ${w.instruction} (${w.routineId.replace(/^program:/, '')} rung ${w.rung}): ${w.reason}.`))
        explanation.push(
          p.writersC.length === 0
            ? `Nothing that executes writes ${p.outC.label} now, so it keeps whatever value it had: the ${noun} cannot act on its trip conditions.`
            : `Remaining writers: ${p.writersC.map((w) => `${w.instruction} (${w.routineId.replace(/^program:/, '')} rung ${w.rung})`).join('; ')}.`,
        )
        for (const w of p.lostWriters) {
          evidence.push({ kind: 'writer', side: 'baseline', writer: w, note: `Baseline writer: ${w.reason}` })
          evidence.push({ kind: 'routine', side: 'current', routineId: w.routineId, note: w.reason })
        }
      } else {
        title = `Protective path removed: ${cls.removedAtoms.join(', ')} no longer ${cls.removedAtoms.length === 1 ? 'trips' : 'trip'} ${sf.name}`
        summary = `${cls.removedAtoms.join(', ')} ${cls.removedAtoms.length === 1 ? 'was a cause' : 'were causes'} of the ${noun} in the baseline and ${cls.removedAtoms.length === 1 ? 'is' : 'are'} no longer part of its firing condition.`
        explanation.push(`Removed from the firing condition: ${cls.removedAtoms.join(', ')}.`)
      }
      if (lostText) impact.push(`${Noun} no longer acts when: ${lostText}.`)
      impact.push(`Affected safety function: ${sf.name}.`)
      recommendation.push(
        'Confirm the removed protective path was intentionally retired and replaced; check the hazard analysis (HAZOP/LOPA) that required it.',
        'If the path was removed by accident (a deleted JSR, a disabled program or an inhibited task), restore it before the change is downloaded.',
      )
      break
    }
    case 'NEW_INHIBIT': {
      const s = cls.suppressors[0]!
      const when = s.suppressesWhen ? `${s.label} = 1` : `${s.label} = 0`
      title = `${Noun} condition weakened by new inhibit`
      summary = `${s.suppressesWhen ? s.label : `NOT ${s.label}`} now suppresses ${sf.name}.`
      explanation.push(
        `The new term ${s.label} is an inhibit: with ${s.suppressesWhen ? `${s.label} = 0` : `${s.label} = 1`} the current condition is exactly the baseline condition, and with ${when} the ${noun} does not act. ${p.raw.exhaustive ? `Proved over ${p.raw.checked.toLocaleString('en-US')} input combinations.` : ''}`.trim(),
      )
      for (const x of cls.suppressors) explanation.push(...accessNote(ctx, x.label, x.atom))
      if (cls.suppressors.length > 1) explanation.push(`Other new inhibit terms: ${cls.suppressors.slice(1).map((x) => x.label).join(', ')}.`)
      impact.push(`${s.suppressesWhen ? s.label : `NOT ${s.label}`} now suppresses ${noun}.`, `Affected safety function: ${sf.name}.`)
      if (ctx.current.scan.meta.get(ctx.pool.atoms[s.atom]!.key.slice(4))?.externalAccess === 'Read/Write') bonus = 6
      recommendation.push(
        `Confirm that a bypass of ${sf.name} through ${s.label} was approved through management of change.`,
        `If a maintenance bypass is intended, make it time-limited, alarmed and visible on the HMI; verify operators can see when ${s.label} is active.`,
        `Review who can write ${s.label} and restrict external write access if it is not required.`,
      )
      break
    }
    case 'SETPOINT_RELAXED': {
      const sp = cls.setpoints[0]!
      title = `${Noun} setpoint relaxed on ${sp.subject}`
      summary = `${sp.before.join(', ')} became ${sp.after.join(', ')}: ${sf.name} acts in fewer situations.`
      explanation.push(`The comparison on ${sp.subject} changed from ${sp.before.join(', ')} to ${sp.after.join(', ')}. Comparisons on the same tag were analyzed together, so only values ${sp.subject} can actually take were considered.`)
      if (lostText) impact.push(`No longer acts when: ${lostText}.`)
      severity = capByCriticality('HIGH', sf)
      recommendation.push('Check the new setpoint against the safety requirements specification and the instrument range.', 'Confirm the change is recorded in the setpoint register and was approved.')
      break
    }
    default: {
      title = `${Noun} condition weakened`
      summary = `${sf.name} acts in fewer situations than in the baseline.`
      if (lostText) impact.push(`No longer acts when: ${lostText}.`)
      severity = cls.type === 'SHUTDOWN_WEAKENED' ? capByCriticality('CRITICAL', sf) : capByCriticality('HIGH', sf)
      recommendation.push(`Review the change to the ${noun} logic against the function's safety requirements.`, 'Confirm the weakening was intended and approved through management of change.')
    }
  }
  if (witness) explanation.push(`Example: with ${witness}, the ${noun} ${p.raw.witness!.before ? 'acted in the baseline and does not act now' : 'did not act in the baseline and acts now'}.`)
  if (p.raw.verdict === 'MIXED' && p.raw.gained) explanation.push(`The change also makes the ${noun} act in new situations: ${p.raw.gained.text}.`)
  if (a.notes.length) explanation.push(...a.notes)
  return {
    ruleId,
    type: cls.type,
    severity,
    confidence: confidenceOf(ctx, a, p.raw),
    disposition: 'REVIEW',
    safetyFunctionIds: [sf.id],
    ...(sf.implementation.module ? { module: sf.implementation.module } : {}),
    location: loc,
    changeIds,
    notificationImpact: 'NONE',
    title,
    summary,
    explanation,
    impact,
    recommendation,
    firing: p.raw,
    evidence: protectiveEvidence(ctx, a, changeIds, evidence),
    groupKey: `${cls.type}|${changeIds.slice().sort().join(',')}|${cls.suppressors.map((s) => s.label.replace(/^[^.]*\./, '')).join(',')}`,
    bonus,
  }
}

function protectiveRule(id: string, type: FindingType, title: string, description: string, severity: Severity): Rule {
  return {
    id,
    type,
    title,
    description,
    severity,
    evaluate(ctx) {
      const out: Effect[] = []
      for (const a of ctx.sf) {
        const cls = classifyProtective(ctx, a)
        if (cls && cls.type === type) out.push(makeProtectiveEffect(ctx, a, cls, id))
      }
      return out
    },
  }
}

export const ProtectiveOutputBypassRule = protectiveRule(
  'IL-R003',
  'PROTECTIVE_OUTPUT_BYPASSED',
  'Protective output bypassed',
  'A declared protective output gained a writer outside the declared implementation that weakens the function, or the function can no longer act at all.',
  'CRITICAL',
)
export const RemovedProtectivePathRule = protectiveRule(
  'IL-R001',
  'PROTECTIVE_PATH_REMOVED',
  'Protective path removed',
  'Logic that drove a protective output no longer executes (deleted rung, removed JSR, disabled program, inhibited task), or a baseline trip cause no longer appears in the firing condition.',
  'CRITICAL',
)
export const NewInhibitTermRule = protectiveRule(
  'IL-R002',
  'NEW_INHIBIT',
  'New inhibit added',
  'A new term X appears in the firing condition such that fixing X restores the baseline condition exactly; X therefore suppresses the function.',
  'CRITICAL',
)
export const SetpointRelaxationRule = protectiveRule(
  'IL-R007',
  'SETPOINT_RELAXED',
  'Trip setpoint relaxed',
  'A numeric comparison on a trip input changed so the function acts in fewer situations.',
  'HIGH',
)
export const ShutdownWeakeningRule = protectiveRule(
  'IL-R004',
  'SHUTDOWN_WEAKENED',
  'Shutdown condition weakened',
  'A shutdown or trip function acts in fewer situations, for a reason no more specific rule explains.',
  'CRITICAL',
)
export const InterlockWeakeningRule = protectiveRule(
  'IL-R005',
  'INTERLOCK_WEAKENED',
  'Interlock weakened',
  'An interlock function acts in fewer situations, for a reason no more specific rule explains.',
  'HIGH',
)
export const PermissiveWeakeningRule = protectiveRule(
  'IL-R006',
  'PERMISSIVE_WEAKENED',
  'Permissive weakened',
  'A permissive is satisfied in more situations (the equipment may start or run when it previously could not), for a reason no more specific rule explains.',
  'HIGH',
)

export const ProtectionStrengthenedRule: Rule = {
  id: 'IL-R013',
  type: 'PROTECTION_STRENGTHENED',
  title: 'Protective condition strengthened',
  description: 'A protective function now acts in every situation it did before and in more. Recorded as positive; never a weakening.',
  severity: 'INFO',
  evaluate(ctx) {
    const out: Effect[] = []
    for (const a of ctx.sf) {
      const p = a.protective
      if (!p || (p.raw.verdict !== 'STRENGTHENED' && p.raw.verdict !== 'ALWAYS_FIRES')) continue
      const noun = KIND_NOUN[a.sf.kind]!
      const changeIds = meaningfulChangeIds(ctx, a.sf.id)
      const explanation = [...baseExplanation(a), `Every situation in which the ${noun} acted before, it still acts. It now also acts when: ${p.raw.gained?.text ?? 'additional situations'}.`]
      if (p.raw.verdict === 'ALWAYS_FIRES') explanation.push(`The ${noun} now acts unconditionally: ${p.outC.label} is held in its safe state, which may stop the equipment from running at all.`)
      out.push({
        ruleId: 'IL-R013',
        type: 'PROTECTION_STRENGTHENED',
        severity: 'INFO',
        confidence: confidenceOf(ctx, a, p.raw),
        disposition: 'POSITIVE',
        safetyFunctionIds: [a.sf.id],
        ...(a.sf.implementation.module ? { module: a.sf.implementation.module } : {}),
        location: location(a),
        changeIds,
        notificationImpact: 'NONE',
        title: `${noun[0]!.toUpperCase()}${noun.slice(1)} condition strengthened`,
        summary: `${a.sf.name} now acts in more situations than in the baseline and in none fewer.`,
        explanation,
        impact: [`Additional trip cause(s): ${p.raw.gained?.text ?? 'see condition'}.`],
        recommendation: ['No safety regression. Confirm the additional trip cause will not produce nuisance trips at normal operating values.'],
        firing: p.raw,
        evidence: protectiveEvidence(ctx, a, changeIds),
        groupKey: `STRENGTHENED|${a.sf.id}`,
        bonus: 0,
      })
    }
    return out
  },
}

export const TripDelayRule: Rule = {
  id: 'IL-R009',
  type: 'TRIP_DELAY_INCREASED',
  title: 'Trip delay increased',
  description: 'A timer inside a protective function\'s dependency cone has a larger preset than in the baseline. INTERLOCK does not model time, so this is reported separately from the firing-condition comparison.',
  severity: 'HIGH',
  evaluate(ctx) {
    const out: Effect[] = []
    for (const a of ctx.sf) {
      for (const [loc, uses] of ctx.current.scan.timers) {
        if (!a.coneC.has(`loc:${loc}.dn`) && !a.coneC.has(`loc:${loc}.en`)) continue
        const before = ctx.baseline.scan.timers.get(loc)
        if (!before) continue
        for (const u of uses) {
          const b = before.find((x) => x.kind === u.kind)
          if (!b || b.preset === null || u.preset === null || u.preset <= b.preset) continue
          const changeIds = meaningfulChangeIds(ctx, a.sf.id)
          out.push({
            ruleId: 'IL-R009',
            type: 'TRIP_DELAY_INCREASED',
            severity: capByCriticality('HIGH', a.sf),
            confidence: 'MEDIUM',
            disposition: 'REVIEW',
            safetyFunctionIds: [a.sf.id],
            location: { routineId: u.routineId, rung: u.rung, tag: u.label },
            changeIds,
            notificationImpact: 'NONE',
            title: `Delay in ${a.sf.name} increased`,
            summary: `${u.kind} ${u.label} preset changed from ${b.presetText} to ${u.presetText} in the dependency cone of ${a.sf.name}.`,
            explanation: [
              `${u.label} is a ${u.kind} timer on the path to ${a.protective?.outC.label ?? a.sf.alarm?.tag ?? 'the declared output'}. Its preset changed from ${b.presetText} to ${u.presetText} (${u.kind === 'TON' ? 'on-delay: the function acts later' : 'the timing behaviour changed'}).`,
              'INTERLOCK does not model time: the firing-condition comparison treats a timer as following its input. The preset change is reported here so it is reviewed against the process safety time.',
            ],
            impact: [`The protective action may occur up to ${(u.preset - b.preset).toLocaleString('en-US')} ms later.`],
            recommendation: ['Compare the new delay with the process safety time for the hazard this function protects against.'],
            evidence: [...changeIds.map((changeId) => ({ kind: 'change' as const, changeId })), { kind: 'declaration', sfId: a.sf.id }],
            groupKey: `DELAY|${loc}|${a.sf.id}`,
            bonus: 0,
          })
        }
      }
    }
    return out
  },
}

export const ExecutionControlRule: Rule = {
  id: 'IL-R010',
  type: 'EXECUTION_CONTROL_INTRODUCED',
  title: 'Execution-control instruction introduced',
  description: 'A TND, JMP, MCR or similar instruction now sits in a rung a declared function depends on. These change which rungs execute; INTERLOCK models forward jumps, TND and MCR zones, but any such instruction in safety logic deserves review.',
  severity: 'HIGH',
  evaluate(ctx) {
    const out: Effect[] = []
    const baseline = new Set(ctx.baseline.scan.executionControl.map((x) => `${x.routineId}|${x.instruction.toLowerCase()}`))
    for (const x of ctx.current.scan.executionControl) {
      if (baseline.has(`${x.routineId}|${x.instruction.toLowerCase()}`)) continue
      const sfIds = ctx.sf.filter((a) => a.coneC.has(`routine:${x.routineId}`)).map((a) => a.sf.id)
      if (sfIds.length === 0) continue
      const routine = ctx.current.index.routines.get(x.routineId)
      const where = routine ? `${routine.container.name}/${routine.name}` : x.routineId
      const sev = sfIds.map((id) => capByCriticality('HIGH', ctx.sfById.get(id)!.sf))
      const changeIds = ctx.changes.filter((c) => c.anchors.current?.includes(x.anchor)).map((c) => c.id)
      out.push({
        ruleId: 'IL-R010',
        type: 'EXECUTION_CONTROL_INTRODUCED',
        severity: sev.includes('HIGH') ? 'HIGH' : sev[0]!,
        confidence: 'HIGH',
        disposition: 'REVIEW',
        safetyFunctionIds: sfIds,
        location: { routineId: x.routineId, rung: x.rung, routine: routine?.name ?? '', program: routine?.container.name ?? '' },
        changeIds,
        notificationImpact: 'NONE',
        title: `${x.instruction.split('(')[0]} introduced in safety routine ${where}`,
        summary: `${x.instruction} in ${where} rung ${x.rung} controls which protective rungs execute.`,
        explanation: [
          `${x.instruction} was added to ${where}, a routine that ${sfIds.length === 1 ? 'a declared safety function depends' : `${sfIds.length} declared safety functions depend`} on.`,
          'Execution-control instructions skip or end rung execution; later rungs, including protective ones, may not run in every scan.',
        ],
        impact: [`Affected: ${sfIds.map((id) => ctx.sfById.get(id)!.sf.name).join(', ')}.`],
        recommendation: ['Avoid execution-control instructions in safety routines; if required, document exactly which rungs they skip and under which conditions.'],
        evidence: [...changeIds.map((changeId) => ({ kind: 'change' as const, changeId })), ...sfIds.map((sfId) => ({ kind: 'declaration' as const, sfId }))],
        groupKey: `EXEC|${x.anchor}|${x.instruction}`,
        bonus: 0,
      })
    }
    return out
  },
}
