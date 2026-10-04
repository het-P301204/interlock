/**
 * Change-level rules: what happened to changes that no declared safety
 * function explains, plus declaration and change-management hygiene.
 *
 * The undeclared rule is the one that keeps INTERLOCK honest. A logic change
 * outside every declared function's dependency cone, in logic the engineer
 * has not declared non-safety, is UNDECLARED: INTERLOCK has no safety intent
 * to check it against and therefore cannot conclude that it is safe.
 */
import type { Severity } from '../../model/analysis.ts'
import type { DiffChange } from '../diff.ts'
import { lc } from '../project-index.ts'
import { isWeakening } from '../safety.ts'
import { capByCriticality, maxSeverity, sortSfIds, type Effect, type Rule, type RuleContext } from './types.ts'

const PROTECTIVE_NAME = /(^|[_.])(ESD|TRIP|TRP|SHUTDOWN|SHDN|SD|INTERLOCK|ILK|INTLK|PERMISSIVE|PERM|ALARM|ALM|BYPASS|BYP|INHIBIT|INH|OVERRIDE|OVRD|ESTOP|EMERGENCY|SIS|HH|LL|SAFETY|PROTECT)([_.]|\d|$)/i

/** Safety functions whose cone contains any anchor of the change. */
export function sfIdsForChange(ctx: RuleContext, c: DiffChange): string[] {
  const out = new Set<string>()
  const pick = (anchors: string[] | undefined, side: 'baseline' | 'current') => {
    for (const a of anchors ?? []) {
      if (a.startsWith('routine:')) continue
      for (const id of ctx.sfIdsForAnchor(a, side)) out.add(id)
    }
  }
  pick(c.anchors.baseline, 'baseline')
  pick(c.anchors.current, 'current')
  return [...out]
}

function routineOf(c: DiffChange): string | undefined {
  return c.entity.routineId
}

const isLogic = (c: DiffChange) => c.category === 'logic' || c.category === 'execution'

/** Real locations a logic change alters that no declared function depends on. */
function undeclaredLocs(ctx: RuleContext, c: DiffChange): string[] {
  const locs = [...new Set([...c.changedLocs.baseline, ...c.changedLocs.current])]
  return locs.filter((l) => !l.startsWith('#') && !l.startsWith('m:') && ctx.sfIdsForLoc(l).length === 0)
}

/** Display label for a location, including the pseudo-locations rung interpretation uses. */
function locLabel(ctx: RuleContext, l: string): string {
  const preset = /^(.*)\.#preset$/.exec(l)
  if (preset) return `${locLabel(ctx, preset[1]!)}.PRE`
  return ctx.current.scan.meta.get(l)?.label ?? ctx.baseline.scan.meta.get(l)?.label ?? l.replace(/^[cp]:(?:[^:]+:)?/, '')
}

function hintFor(ctx: RuleContext, changes: DiffChange[], locs: string[] = []): string | undefined {
  const names = new Set<string>()
  // Also look one step downstream: what the changed locations feed in the current scan.
  const bases = new Set(locs.map((l) => l.replace(/\.#preset$/, '').replace(/\.(pre|acc)$/, '')))
  for (const [loc, v] of ctx.current.scan.cur) {
    if (loc.includes('#')) continue
    for (const b of bases) {
      if (v.prov.has(`loc:${b}`) || v.prov.has(`loc:${b}.dn`) || v.prov.has(`loc:${b}.en`)) {
        const label = ctx.current.scan.meta.get(loc)?.label
        if (label && PROTECTIVE_NAME.test(label)) names.add(label)
      }
    }
  }
  for (const c of changes) {
    for (const text of [c.before, c.after]) {
      if (!text) continue
      for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/g)) {
        const tok = m[0]
        if (/^(XIC|XIO|OTE|OTL|OTU|TON|TOF|RTO|JSR|MOV|ALMD|ALMA|GRT|GEQ|LES|LEQ|EQU|NEQ|LIM|ONS|CTU|CTD|RES|NOP|AFI|TND|JMP|LBL|MCR|CPT|ADD|SUB|MUL|DIV)$/.test(tok)) continue
        if (PROTECTIVE_NAME.test(tok)) names.add(tok)
      }
    }
  }
  void ctx
  if (names.size === 0) return undefined
  const list = [...names].slice(0, 4)
  return `Tag names suggest protective intent (${list.join(', ')}${names.size > 4 ? ', …' : ''}). This is a name-based hint, not a conclusion.`
}

export const UndeclaredSafetyCoverageRule: Rule = {
  id: 'IL-R012',
  type: 'UNDECLARED_LOGIC_CHANGED',
  title: 'Undeclared routine affected',
  description:
    'Logic changed outside every declared safety function and outside the declared non-safety scope. No safety intent is declared for it, so INTERLOCK cannot conclude that it is safe.',
  severity: 'MEDIUM',
  evaluate(ctx) {
    const byRoutine = new Map<string, DiffChange[]>()
    for (const c of ctx.changes) {
      if (!isLogic(c) || c.semantic === 'equivalent') continue
      const rid = routineOf(c)
      if (!rid || rid.startsWith('module:')) continue
      if (ctx.isNonSafety(rid)) continue
      const covered = sfIdsForChange(ctx, c).length > 0
      const loose = undeclaredLocs(ctx, c)
      const realLocs = [...c.changedLocs.baseline, ...c.changedLocs.current].filter((l) => !l.startsWith('#') && !l.startsWith('m:'))
      if (covered && loose.length === 0) continue
      if (!covered && realLocs.length > 0 && loose.length === 0) continue
      const list = byRoutine.get(rid) ?? []
      list.push(c)
      byRoutine.set(rid, list)
    }
    const out: Effect[] = []
    for (const [rid, changes] of byRoutine) {
      const index = ctx.current.index.routines.has(rid) ? ctx.current.index : ctx.baseline.index
      const r = index.routines.get(rid)
      const where = r ? `${r.container.name}/${r.name}` : rid.replace(/^program:/, '')
      const locs = [...new Set(changes.flatMap((c) => undeclaredLocs(ctx, c)))]
      const labels = locs.map((l) => locLabel(ctx, l))
      const hint = hintFor(ctx, changes, locs)
      const explanation = [
        'UNDECLARED: no safety intent has been declared for this logic.',
        'INTERLOCK therefore cannot conclude that it is safe.',
        `${changes.length} logic change${changes.length === 1 ? '' : 's'} in ${where}${labels.length ? ` alter${changes.length === 1 ? 's' : ''} ${labels.join(', ')}` : ''}, which no declared safety function depends on.`,
      ]
      if (hint) explanation.push(hint)
      out.push({
        ruleId: 'IL-R012',
        type: 'UNDECLARED_LOGIC_CHANGED',
        severity: 'MEDIUM',
        confidence: hint ? 'MEDIUM' : 'HIGH',
        disposition: 'UNDECLARED',
        safetyFunctionIds: [],
        location: { routineId: rid, ...(r ? { routine: r.name, program: r.container.name } : {}), ...(labels[0] ? { tag: labels[0] } : {}) },
        changeIds: changes.map((c) => c.id),
        notificationImpact: 'NONE',
        title: `Undeclared logic changed in ${where}`,
        summary: `${where} changed behaviour and has no declared safety intent; it needs review.`,
        explanation,
        impact: labels.length ? [`Behaviour of ${labels.join(', ')} changed.`] : ['Execution of this routine changed.'],
        recommendation: [
          'Decide whether this logic carries safety intent. If it does, declare a safety function for it and re-run the analysis.',
          'If it does not, add it to the declared non-safety scope so future changes are classified as informational.',
        ],
        evidence: changes.map((c) => ({ kind: 'change' as const, changeId: c.id })),
        groupKey: `UNDECLARED|${rid}`,
        bonus: hint ? 4 : 0,
      })
    }
    return out
  },
}

export const CosmeticChangeRule: Rule = {
  id: 'IL-R014',
  type: 'COSMETIC_LOGIC_CHANGE',
  title: 'Cosmetic logic change',
  description: 'A rung was rewritten but every location it writes has a provably equivalent condition (for example, reordered contacts).',
  severity: 'LOW',
  evaluate(ctx) {
    const out: Effect[] = []
    for (const c of ctx.changes) {
      if (c.category !== 'logic' || c.semantic !== 'equivalent') continue
      const sfIds = sortSfIds(sfIdsForChange(ctx, c), ctx)
      const where = `${c.entity.container ?? ''}/${c.entity.name}`
      out.push({
        ruleId: 'IL-R014',
        type: 'COSMETIC_LOGIC_CHANGE',
        severity: 'LOW',
        confidence: 'HIGH',
        disposition: 'INFORMATIONAL',
        safetyFunctionIds: sfIds,
        location: {
          ...(c.entity.routineId ? { routineId: c.entity.routineId, routine: c.entity.routineId.split('/').slice(1).join('/') } : {}),
          ...(c.entity.rung !== undefined ? { rung: c.entity.rung } : {}),
          ...(c.entity.container && !c.entity.routineId?.startsWith('module:') ? { program: c.entity.container } : {}),
        },
        changeIds: [c.id],
        notificationImpact: 'NONE',
        title: `Cosmetic logic change in ${where}`,
        summary: 'The rung text changed but every output it writes has an equivalent condition.',
        explanation: [
          `Before: ${c.before ?? ''}`,
          `After: ${c.after ?? ''}`,
          'INTERLOCK interpreted both versions and proved every written location equivalent over all input combinations.',
          ...(sfIds.length ? [`The rung is part of ${sfIds.map((id) => ctx.sfById.get(id)!.sf.name).join(', ')}; that function's firing condition is unchanged.`] : []),
        ],
        impact: ['No behavioural change.'],
        recommendation: ['No action needed beyond normal change review.'],
        evidence: [{ kind: 'change', changeId: c.id }],
        groupKey: `COSMETIC|${c.id}`,
        bonus: 0,
      })
    }
    return out
  },
}

export const NonSafetyChangeRule: Rule = {
  id: 'IL-R015',
  type: 'NON_SAFETY_LOGIC_CHANGE',
  title: 'Non-safety logic change',
  description: 'Logic changed in a routine the engineer declared non-safety, and none of the locations it alters feeds a declared safety function.',
  severity: 'INFO',
  evaluate(ctx) {
    const byRoutine = new Map<string, DiffChange[]>()
    for (const c of ctx.changes) {
      if (!isLogic(c) || c.semantic === 'equivalent') continue
      const rid = routineOf(c)
      if (!rid || !ctx.isNonSafety(rid)) continue
      if (sfIdsForChange(ctx, c).length > 0) continue
      const list = byRoutine.get(rid) ?? []
      list.push(c)
      byRoutine.set(rid, list)
    }
    const out: Effect[] = []
    for (const [rid, changes] of byRoutine) {
      const index = ctx.current.index.routines.has(rid) ? ctx.current.index : ctx.baseline.index
      const r = index.routines.get(rid)
      const where = r ? `${r.container.name}/${r.name}` : rid.replace(/^program:/, '')
      out.push({
        ruleId: 'IL-R015',
        type: 'NON_SAFETY_LOGIC_CHANGE',
        severity: 'INFO',
        confidence: 'HIGH',
        disposition: 'INFORMATIONAL',
        safetyFunctionIds: [],
        location: { routineId: rid, ...(r ? { routine: r.name, program: r.container.name } : {}) },
        changeIds: changes.map((c) => c.id),
        notificationImpact: 'NONE',
        title: `Non-safety logic changed in ${where}`,
        summary: `${changes.length} change${changes.length === 1 ? '' : 's'} in declared non-safety logic; none feeds a declared safety function.`,
        explanation: [`${where} is in the declared non-safety scope, and INTERLOCK found no dependency from the changed locations to any declared protective output or alarm.`],
        impact: ['Operational behaviour changed; no declared safety function is affected.'],
        recommendation: ['Review as a normal operational change.'],
        evidence: changes.map((c) => ({ kind: 'change' as const, changeId: c.id })),
        groupKey: `NONSAFETY|${rid}`,
        bonus: 0,
      })
    }
    return out
  },
}

export const SharedModulePropagationRule: Rule = {
  id: 'IL-R011',
  type: 'SHARED_MODULE_PROPAGATION',
  title: 'Shared module modified',
  description:
    'A reusable module (Add-On Instruction) definition changed. Every call site executes the new definition, so the change propagates to all instances; safety-relevant instances are listed first.',
  severity: 'HIGH',
  evaluate(ctx) {
    const out: Effect[] = []
    for (const m of ctx.modules) {
      if (!m.changed || m.instances.length < 2) continue
      const executed = m.instances.filter((i) => i.executed)
      const safety = executed.filter((i) => i.safetyFunctionIds.length > 0)
      const operational = executed.filter((i) => i.safetyFunctionIds.length === 0)
      const notExecuted = m.instances.filter((i) => !i.executed)
      const sfIds = sortSfIds(safety.flatMap((i) => i.safetyFunctionIds), ctx)
      const impacted = sfIds.filter((id) => {
        const a = ctx.sfById.get(id)!
        return (a.protective && isWeakening(a.protective.raw.verdict)) || (a.notification && ['SUPPRESSED', 'DEGRADED', 'BROKEN'].includes(a.notification.status))
      })
      let severity: Severity = impacted.length
        ? maxSeverity(...impacted.map((id) => capByCriticality('CRITICAL', ctx.sfById.get(id)!.sf)))
        : operational.length
          ? 'MEDIUM'
          : 'LOW'
      if (safety.length === 0 && operational.length === 0) severity = 'LOW'
      const rev = m.revisionBefore !== m.revisionAfter ? ` (revision ${m.revisionBefore ?? '?'} → ${m.revisionAfter ?? '?'})` : ''
      const site = (i: (typeof m.instances)[number]) => `${i.backingLabel} in ${i.routineId.replace(/^program:/, '')}`
      const explanation = [
        `The definition of ${m.name} changed${rev}. Every call site runs the new definition, so the change reaches all ${m.instances.length} instances.`,
        safety.length ? `${safety.length} instance${safety.length === 1 ? '' : 's'} feed${safety.length === 1 ? 's' : ''} declared safety functions: ${safety.map((i) => `${site(i)} → ${i.safetyFunctionIds.map((id) => ctx.sfById.get(id)!.sf.name).join(', ')}`).join('; ')}.` : 'No instance feeds a declared safety function.',
      ]
      if (operational.length)
        explanation.push(`${operational.length} instance${operational.length === 1 ? ' has' : 's have'} no declared safety intent: ${operational.map(site).join('; ')}. INTERLOCK cannot conclude the change is safe for ${operational.length === 1 ? 'it' : 'them'}.`)
      if (notExecuted.length) explanation.push(`${notExecuted.length} call site${notExecuted.length === 1 ? ' does' : 's do'} not execute: ${notExecuted.map(site).join('; ')}.`)
      if (impacted.length) explanation.push(`Safety functions whose behaviour changed because of this definition: ${impacted.map((id) => ctx.sfById.get(id)!.sf.name).join(', ')}.`)
      out.push({
        ruleId: 'IL-R011',
        type: 'SHARED_MODULE_PROPAGATION',
        severity,
        confidence: 'HIGH',
        disposition: safety.length || operational.length ? 'REVIEW' : 'INFORMATIONAL',
        safetyFunctionIds: sfIds,
        module: m.name,
        location: {},
        changeIds: [...m.changeIds, ...m.revisionChangeIds],
        notificationImpact: 'NONE',
        title: `Shared module ${m.name} modified: ${m.instances.length} instances affected`,
        summary: `1 definition changed; ${m.instances.length} downstream instantiations affected (${safety.length} safety-relevant, ${operational.length} operational${notExecuted.length ? `, ${notExecuted.length} not executed` : ''}).`,
        explanation,
        impact: [`Blast radius: ${m.instances.length} instances, ${safety.length} safety-relevant.`],
        recommendation: [
          'Review the definition change once, then confirm it is acceptable for every instance listed, starting with the safety-relevant ones.',
          'For operational instances with no declared safety intent, decide whether a safety function should be declared.',
          'Version reusable modules deliberately: bump the revision and record why.',
        ],
        blastRadius: { instances: m.instances.length, safetyRelevant: safety.length, operational: operational.length },
        evidence: [...m.changeIds, ...m.revisionChangeIds].map((changeId) => ({ kind: 'change' as const, changeId })),
        groupKey: `MODULE|${lc(m.name)}`,
        bonus: Math.min(10, safety.length * 2),
      })
    }
    return out
  },
}

export const DeclarationResolutionRule: Rule = {
  id: 'IL-R016',
  type: 'DECLARATION_UNRESOLVED',
  title: 'Safety declaration does not resolve',
  description: 'A declared protective output, alarm, routine or module is not present in the current project, so the function cannot be analyzed there. Never treated as "no change".',
  severity: 'HIGH',
  evaluate(ctx) {
    const out: Effect[] = []
    for (const a of ctx.sf) {
      const r = a.resolution
      const unresolved = (['protectiveOutput', 'alarm', 'routine', 'module'] as const).filter((k) => r[k] === 'UNRESOLVED')
      const incomplete = !a.sf.protectiveOutput && !a.sf.alarm
      if (unresolved.length === 0 && !incomplete && a.analyzable) continue
      const undecided = unresolved.length === 0 && !incomplete
      const critical = r.protectiveOutput === 'UNRESOLVED' || r.alarm === 'UNRESOLVED'
      out.push({
        ruleId: 'IL-R016',
        type: 'DECLARATION_UNRESOLVED',
        severity: critical ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        disposition: 'REVIEW',
        safetyFunctionIds: [a.sf.id],
        location: { ...(a.sf.implementation.program ? { program: a.sf.implementation.program } : {}), ...(a.sf.implementation.routine ? { routine: a.sf.implementation.routine } : {}) },
        changeIds: [],
        notificationImpact: 'NONE',
        title: `${a.sf.name} could not be analyzed`,
        summary: incomplete
          ? 'The declaration names no protective output and no alarm.'
          : undecided
            ? a.notification && !a.notification.raw
              ? 'The alarm uses an analog alarm instruction (ALMA), whose thresholds INTERLOCK does not analyze.'
              : 'A comparison for this function was not decided (it exceeded the exhaustive-analysis bound or depends on constructs INTERLOCK does not model).'
            : `Declared ${unresolved.join(', ').replace('protectiveOutput', 'protective output')} not found in the current project.`,
        explanation: [...a.notes, 'INTERLOCK does not treat an unanalyzed function as unchanged. Until the declaration resolves, this function is outside verified scope.'],
        impact: ['Coverage is partial: this function was not analyzed.'],
        recommendation: ['If the tag or routine was renamed, update the safety declaration. If it was removed, confirm the protective function was intentionally retired.'],
        evidence: [{ kind: 'declaration', sfId: a.sf.id }],
        groupKey: `DECL|${a.sf.id}`,
        bonus: 0,
      })
    }
    return out
  },
}

export const ModuleRevisionRule: Rule = {
  id: 'IL-R017',
  type: 'MODULE_REVISION_NOT_BUMPED',
  title: 'Module changed without a revision change',
  description: 'A reusable module\'s logic or interface changed but its revision did not. Sites comparing revisions will believe they run the same definition.',
  severity: 'LOW',
  evaluate(ctx) {
    return ctx.modules
      .filter((m) => m.changed && m.revisionChangeIds.length === 0)
      .map(
        (m): Effect => ({
          ruleId: 'IL-R017',
          type: 'MODULE_REVISION_NOT_BUMPED',
          severity: 'LOW',
          confidence: 'HIGH',
          disposition: 'REVIEW',
          safetyFunctionIds: sortSfIds(m.instances.flatMap((i) => i.safetyFunctionIds), ctx),
          module: m.name,
          location: {},
          changeIds: m.changeIds,
          notificationImpact: 'NONE',
          title: `${m.name} changed but its revision is still ${m.revisionAfter ?? 'unspecified'}`,
          summary: 'The definition changed without a revision change; revision numbers no longer identify behaviour.',
          explanation: [`${m.changeIds.length} logic or interface change(s) to ${m.name}; revision unchanged at ${m.revisionAfter ?? 'unspecified'}.`],
          impact: ['Other sites and future reviews cannot tell this definition apart from the previous one by revision.'],
          recommendation: ['Bump the module revision and add a revision note describing the change.'],
          evidence: m.changeIds.map((changeId) => ({ kind: 'change' as const, changeId })),
          groupKey: `REV|${lc(m.name)}`,
          bonus: 0,
        }),
      )
  },
}

export const ExternalWriteAccessRule: Rule = {
  id: 'IL-R018',
  type: 'EXTERNAL_WRITE_ACCESS_GRANTED',
  title: 'External write access granted on safety tag',
  description: 'A tag a declared safety function depends on became writable by HMI/OPC clients (external access changed to Read/Write).',
  severity: 'HIGH',
  evaluate(ctx) {
    const out: Effect[] = []
    for (const c of ctx.changes) {
      if (c.field !== 'externalAccess' || c.after !== 'Read/Write' || c.before === 'Read/Write') continue
      const sfIds = sortSfIds(sfIdsForChange(ctx, c), ctx)
      if (sfIds.length === 0) continue
      out.push({
        ruleId: 'IL-R018',
        type: 'EXTERNAL_WRITE_ACCESS_GRANTED',
        severity: maxSeverity(...sfIds.map((id) => capByCriticality('HIGH', ctx.sfById.get(id)!.sf))),
        confidence: 'HIGH',
        disposition: 'REVIEW',
        safetyFunctionIds: sfIds,
        location: { tag: c.entity.name },
        changeIds: [c.id],
        notificationImpact: 'NONE',
        title: `${c.entity.name} is now writable from outside the controller`,
        summary: `External access of ${c.entity.name} changed from ${c.before} to Read/Write; it feeds ${sfIds.map((id) => ctx.sfById.get(id)!.sf.name).join(', ')}.`,
        explanation: ['Any HMI, OPC or other client with access to the controller can now write this tag directly, bypassing the logic that normally sets it.'],
        impact: [`Affects ${sfIds.length} declared safety function${sfIds.length === 1 ? '' : 's'}.`],
        recommendation: ['Restore Read Only unless a client must write the tag; if so, document which client and why.'],
        evidence: [{ kind: 'change', changeId: c.id }, ...sfIds.map((sfId) => ({ kind: 'declaration' as const, sfId }))],
        groupKey: `EXT|${c.id}`,
        bonus: 4,
      })
    }
    return out
  },
}
