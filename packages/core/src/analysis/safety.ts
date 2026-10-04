/**
 * Safety-function analysis: for each declared function, resolve what the
 * engineer declared in both projects, take the end-of-scan expression of the
 * protective output and of the alarm notification from the symbolic scans,
 * and compare baseline against current.
 *
 *   firing condition (DE_ENERGIZE) = NOT output      the function acts when the output drops
 *   firing condition (ENERGIZE)    = output          the function acts when the output rises
 *
 * Everything a rule later concludes about a safety function comes from the
 * SfAnalysis built here.
 */
import type { DeclarationResolution, NotificationStage, NotificationStatus, ResolutionState, Side } from '../model/analysis.ts'
import type { SafetyFunction } from '../model/safety.ts'
import type { ExprPool } from '../logic/expr.ts'
import type { RawComparison } from '../logic/truth.ts'
import { compareConditions } from '../logic/truth.ts'
import { lc, type ProjectIndex } from './project-index.ts'
import type { Anchor, AlarmUse, SymbolicScan, WriteEvent } from './scan.ts'

export interface SideContext {
  side: Side
  index: ProjectIndex
  scan: SymbolicScan
}

export interface ResolvedLoc {
  loc: string
  label: string
}

export interface ProtectiveState {
  outB: ResolvedLoc
  outC: ResolvedLoc
  tripB: number
  tripC: number
  raw: RawComparison
  writersB: WriteEvent[]
  writersC: WriteEvent[]
  /** Current writers that did not exist in the baseline and sit outside the declared implementation. */
  newWriters: WriteEvent[]
  /** Baseline writers with no counterpart that still executes in the current project. */
  lostWriters: Array<WriteEvent & { reason: string }>
}

export interface NotificationState {
  alarmB: ResolvedLoc
  alarmC: ResolvedLoc
  mechanismB: 'ALMD' | 'ALMA' | 'BOOL_TAG' | 'NOT_EXECUTED'
  mechanismC: 'ALMD' | 'ALMA' | 'BOOL_TAG' | 'NOT_EXECUTED'
  useB?: AlarmUse
  useC?: AlarmUse
  notifyB: number
  notifyC: number
  raw: RawComparison | null
  status: NotificationStatus
  stages: NotificationStage[]
  suppressors: Suppressor[]
}

export interface Suppressor {
  atom: number
  label: string
  /** The value of the atom that suppresses the function (true = when it is 1). */
  suppressesWhen: boolean
}

export interface SfAnalysis {
  sf: SafetyFunction
  resolution: DeclarationResolution
  protective?: ProtectiveState
  notification?: NotificationState
  coneB: Set<Anchor>
  coneC: Set<Anchor>
  /** True when at least one declared path could be compared in both projects. */
  analyzable: boolean
  notes: string[]
}

const WEAKENING = new Set(['WEAKENED', 'MIXED', 'NEVER_FIRES'])
export const isWeakening = (v: string) => WEAKENING.has(v)

function writerKey(w: WriteEvent): string {
  return `${w.routineId}|${w.kind}|${w.instruction.replace(/\s+/g, '').toLowerCase()}`
}

function implementationRoutines(sf: SafetyFunction, idx: ProjectIndex): Set<string> {
  const out = new Set<string>()
  const impl = sf.implementation
  if (impl.program && impl.routine) {
    const r = idx.routine(impl.program, impl.routine)
    if (r) out.add(r.id)
  }
  if (impl.module) {
    const m = idx.modules.get(lc(impl.module))
    if (m) for (const id of m.routineIds) out.add(id)
  }
  return out
}

/** Add tag anchors for alias names so a change to the alias tag itself lands in the cone. */
function expandCone(scan: SymbolicScan, anchors: Set<Anchor>): Set<Anchor> {
  const out = new Set(anchors)
  for (const a of anchors) {
    if (!a.startsWith('loc:')) continue
    const loc = a.slice(4)
    const meta = scan.meta.get(loc)
    if (meta?.tag) {
      const t = meta.tag
      const key = t.scope.kind === 'controller' ? `c:${lc(t.name)}` : t.scope.kind === 'program' ? `p:${lc(t.scope.program)}:${lc(t.name)}` : null
      if (key) out.add(`loc:${key}`)
    }
    // Members anchor their base tag too: a change to PUMP_01_IL's configuration is a change to its members.
    const dot = loc.indexOf('.')
    if (dot > 0) out.add(`loc:${loc.slice(0, dot)}`)
  }
  return out
}

/**
 * Find atoms that act as inhibits: a term X such that fixing X to v makes
 * the current condition exactly the baseline condition. Then X = !v is what
 * now suppresses the function.
 */
export function findSuppressors(pool: ExprPool, before: number, after: number): Suppressor[] {
  const beforeAtoms = new Set(pool.atomsOf([before]))
  const out: Suppressor[] = []
  for (const a of pool.atomsOf([after])) {
    if (beforeAtoms.has(a)) continue
    const atom = pool.atoms[a]!
    if (atom.numeric || atom.range) continue
    for (const v of [false, true]) {
      const restricted = pool.restrict(after, a, v)
      const cmp = compareConditions(pool, before, restricted)
      if (cmp.verdict === 'UNCHANGED' || cmp.verdict === 'EQUIVALENT') {
        out.push({ atom: a, label: atom.label, suppressesWhen: !v })
        break
      }
    }
  }
  return out
}

export function analyzeSafetyFunction(pool: ExprPool, sf: SafetyFunction, b: SideContext, c: SideContext): SfAnalysis {
  const notes: string[] = []
  const program = sf.implementation.program
  const resolveBoth = (tag: string) => ({ b: b.scan.resolveDeclared(tag, program), c: c.scan.resolveDeclared(tag, program) })
  const state = (bb: unknown, cc: unknown): ResolutionState => (cc ? 'RESOLVED' : 'UNRESOLVED')

  const resolution: DeclarationResolution = { protectiveOutput: 'NOT_DECLARED', alarm: 'NOT_DECLARED', routine: 'NOT_DECLARED', module: 'NOT_DECLARED', notes }
  if (sf.implementation.routine) {
    const rb = sf.implementation.program ? b.index.routine(sf.implementation.program, sf.implementation.routine) : undefined
    const rc = sf.implementation.program ? c.index.routine(sf.implementation.program, sf.implementation.routine) : undefined
    resolution.routine = state(rb, rc)
    if (!rc) notes.push(`Declared routine ${sf.implementation.program ?? '?'}/${sf.implementation.routine} is not in the current project.`)
    else if (rc.kind !== 'RLL') notes.push(`Declared routine ${rc.container.name}/${rc.name} is ${rc.kind}; only ladder logic is analyzed semantically.`)
    else if (c.scan.routineBlocked.has(rc.id)) notes.push(`Declared routine ${rc.container.name}/${rc.name} does not execute in the current project: ${c.scan.routineBlocked.get(rc.id)}.`)
  }
  if (sf.implementation.module) {
    const mb = b.index.modules.get(lc(sf.implementation.module))
    const mc = c.index.modules.get(lc(sf.implementation.module))
    resolution.module = state(mb, mc)
    if (!mc) notes.push(`Declared module ${sf.implementation.module} is not in the current project.`)
    if (sf.implementation.instance && mc) {
      const inst = c.index.resolveBase(sf.implementation.instance, program)
      if (!inst) notes.push(`Declared instance ${sf.implementation.instance} is not a tag in the current project.`)
      else if (lc(inst.tag.dataType) !== lc(mc.name)) notes.push(`Declared instance ${sf.implementation.instance} is a ${inst.tag.dataType}, not an instance of ${mc.name}.`)
    }
  }

  const coneB = new Set<Anchor>()
  const coneC = new Set<Anchor>()
  const addCone = (scan: SymbolicScan, target: Set<Anchor>, loc: string) => {
    for (const a of expandCone(scan, scan.cone(loc))) target.add(a)
  }

  const out: SfAnalysis = { sf, resolution, coneB, coneC, analyzable: false, notes }

  /* protective output */
  if (sf.protectiveOutput) {
    const r = resolveBoth(sf.protectiveOutput.tag)
    resolution.protectiveOutput = state(r.b, r.c)
    if (!r.c) notes.push(`Declared protective output ${sf.protectiveOutput.tag} is not a tag in the current project.`)
    if (!r.b) notes.push(`Declared protective output ${sf.protectiveOutput.tag} is not a tag in the baseline project.`)
    if (r.b && r.c && r.b.literal === undefined && r.c.literal === undefined) {
      const vB = b.scan.valueOf(r.b)
      const vC = c.scan.valueOf(r.c)
      const deEnergize = sf.protectiveOutput.tripState === 'DE_ENERGIZE'
      const tripB = deEnergize ? pool.not(vB) : vB
      const tripC = deEnergize ? pool.not(vC) : vC
      const raw = compareConditions(pool, tripB, tripC)
      const writersB = b.scan.executedWrites(r.b.loc)
      const writersC = c.scan.executedWrites(r.c.loc)
      const impl = implementationRoutines(sf, c.index)
      const baseKeys = new Set(writersB.map(writerKey))
      const newWriters = writersC.filter((w) => !baseKeys.has(writerKey(w)) && (impl.size === 0 ? writersB.length > 0 : !impl.has(w.routineId)))
      const curKeys = new Set(writersC.map(writerKey))
      const lostWriters = writersB
        .filter((w) => !curKeys.has(writerKey(w)))
        .map((w) => {
          const routine = c.index.routines.get(w.routineId)
          const blocked = c.scan.routineBlocked.get(w.routineId)
          const reason = !routine
            ? `routine ${w.routineId.replace(/^program:/, '')} no longer exists`
            : blocked
              ? `routine ${routine.container.name}/${routine.name} no longer executes (${blocked})`
              : `the writing instruction ${w.instruction} was removed from ${routine.container.name}/${routine.name}`
          return { ...w, reason }
        })
      out.protective = { outB: r.b, outC: r.c, tripB, tripC, raw, writersB, writersC, newWriters, lostWriters }
      out.analyzable = raw.verdict !== 'NOT_DECIDED'
      if (writersC.length === 0) notes.push(`No executing logic writes ${r.c.label} in the current project; its value is whatever it held at the start of the scan.`)
      if (writersC.length > 1) notes.push(`${r.c.label} has ${writersC.length} writers in the current scan; the last executed one determines the output.`)
      addCone(b.scan, coneB, r.b.loc)
      addCone(c.scan, coneC, r.c.loc)
    }
  }

  /* notification path */
  if (sf.alarm) {
    const r = resolveBoth(sf.alarm.tag)
    resolution.alarm = state(r.b, r.c)
    if (!r.c) notes.push(`Declared alarm ${sf.alarm.tag} is not a tag in the current project.`)
    if (r.b && r.c && r.b.literal === undefined && r.c.literal === undefined) {
      const side = (ctx: SideContext, ref: ResolvedLoc) => {
        const use = ctx.scan.alarms.get(ref.loc)
        const tagType = ctx.scan.meta.get(ref.loc)?.tag?.dataType ?? ''
        if (use) return { mechanism: use.mechanism, use, value: use.mechanism === 'ALMA' ? pool.TRUE : ctx.scan.valueOf({ loc: use.notifyLoc, label: `${ref.label} notification` }), loc: use.notifyLoc }
        if (/^ALARM_/i.test(tagType)) return { mechanism: 'NOT_EXECUTED' as const, use: undefined, value: pool.FALSE, loc: `${ref.loc}#notify` }
        return { mechanism: 'BOOL_TAG' as const, use: undefined, value: ctx.scan.valueOf(ref), loc: ref.loc }
      }
      const sb = side(b, r.b)
      const sc = side(c, r.c)
      const almaInvolved = sb.mechanism === 'ALMA' || sc.mechanism === 'ALMA'
      const raw = almaInvolved ? null : compareConditions(pool, sb.value, sc.value)
      const suppressors = raw && isWeakening(raw.verdict) ? findSuppressors(pool, sb.value, sc.value) : []
      let status: NotificationStatus
      if (!raw) status = 'NOT_ANALYZED'
      else if (raw.verdict === 'NOT_DECIDED') status = 'NOT_ANALYZED'
      else if (sc.mechanism === 'NOT_EXECUTED' && sb.mechanism !== 'NOT_EXECUTED') status = 'BROKEN'
      else if (raw.verdict === 'NEVER_FIRES' || !raw.afterSatisfiable) status = raw.beforeSatisfiable ? 'BROKEN' : 'INTACT'
      else if (isWeakening(raw.verdict)) status = suppressors.length ? 'SUPPRESSED' : 'DEGRADED'
      else status = 'INTACT'
      const stages = notificationStages(sf, raw, status, sb.mechanism, sc.mechanism, r.c.label, suppressors)
      const ns: NotificationState = {
        alarmB: r.b,
        alarmC: r.c,
        mechanismB: sb.mechanism,
        mechanismC: sc.mechanism,
        notifyB: sb.value,
        notifyC: sc.value,
        raw,
        status,
        stages,
        suppressors,
      }
      if (sb.use) ns.useB = sb.use
      if (sc.use) ns.useC = sc.use
      out.notification = ns
      if (raw && raw.verdict !== 'NOT_DECIDED') out.analyzable = true
      if (sb.mechanism === 'BOOL_TAG' && b.scan.executedWrites(r.b.loc).length === 0)
        notes.push(`Alarm tag ${r.b.label} is not written by baseline logic; INTERLOCK treats it as set outside the controller.`)
      addCone(b.scan, coneB, sb.loc)
      addCone(c.scan, coneC, sc.loc)
    }
  }
  if (!sf.protectiveOutput && !sf.alarm) notes.push('The declaration names neither a protective output nor an alarm, so there is nothing to analyze.')
  return out
}

function notificationStages(
  sf: SafetyFunction,
  raw: RawComparison | null,
  status: NotificationStatus,
  mechB: string,
  mechC: string,
  alarmLabel: string,
  suppressors: Suppressor[],
): NotificationStage[] {
  const cond = raw?.before.text ?? 'not analyzed'
  const logicAfter = !raw || raw.verdict === 'NOT_DECIDED' ? 'UNKNOWN' : status === 'BROKEN' ? 'BROKEN' : status === 'SUPPRESSED' || status === 'DEGRADED' ? 'CONDITIONAL' : 'OK'
  const alarmAfter = mechC === 'NOT_EXECUTED' ? 'BROKEN' : status === 'BROKEN' ? 'BROKEN' : logicAfter === 'CONDITIONAL' ? 'CONDITIONAL' : logicAfter === 'UNKNOWN' ? 'UNKNOWN' : 'OK'
  const downstream = alarmAfter === 'BROKEN' ? 'BROKEN' : alarmAfter === 'CONDITIONAL' ? 'CONDITIONAL' : sf.alarm?.notification ? 'DECLARED' : 'UNKNOWN'
  const suppressText = suppressors.length
    ? `Suppressed when ${suppressors.map((s) => (s.suppressesWhen ? s.label : `NOT ${s.label}`)).join(' or ')}.`
    : status === 'DEGRADED'
      ? `Fires in fewer situations: ${raw?.lost?.text ?? ''}`
      : ''
  const mechText = (m: string) => (m === 'ALMD' ? 'digital alarm instruction (ALMD)' : m === 'ALMA' ? 'analog alarm instruction (ALMA)' : m === 'NOT_EXECUTED' ? 'alarm instruction not executed' : 'BOOL alarm tag')
  return [
    { id: 'CONDITION', label: 'Condition', before: 'OK', after: raw && !raw.afterSatisfiable && raw.beforeSatisfiable ? 'BROKEN' : 'OK', detail: `Alarm condition: ${cond}` },
    { id: 'LOGIC', label: 'Logic', before: 'OK', after: logicAfter, detail: logicAfter === 'OK' ? 'Alarm logic unchanged in effect.' : suppressText || 'Alarm logic changed.' },
    { id: 'ALARM', label: 'Alarm', before: mechB === 'NOT_EXECUTED' ? 'BROKEN' : 'OK', after: alarmAfter, detail: `${alarmLabel}: ${mechText(mechB)}${mechB !== mechC ? ` → ${mechText(mechC)}` : ''}` },
    { id: 'HMI', label: 'HMI', before: sf.alarm?.notification ? 'DECLARED' : 'UNKNOWN', after: downstream, detail: sf.alarm?.notification ? `Declared: ${sf.alarm.notification}. The project file cannot prove this link; it is shown as declared.` : 'No downstream notification declared.' },
    { id: 'OPERATOR', label: 'Operator', before: sf.alarm?.notification ? 'DECLARED' : 'UNKNOWN', after: downstream, detail: downstream === 'BROKEN' ? 'The operator is not notified.' : downstream === 'CONDITIONAL' ? 'The operator is notified only when the suppressing condition is false.' : 'Operator notification follows the declared HMI link.' },
  ]
}
