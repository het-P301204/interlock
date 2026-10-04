/**
 * The rule contract. A rule is a small, independently testable function from
 * the analysis context to zero or more effects. Rules never write prose about
 * things the context does not contain: every sentence they produce is built
 * from parsed names, computed conditions and declared intent.
 */
import type {
  Confidence, Disposition, FindingLocation, FindingType, NotificationImpact, RuleInfo, Severity, Side,
} from '../../model/analysis.ts'
import type { SafetyFunction, SafetyManifest } from '../../model/safety.ts'
import type { ExprPool } from '../../logic/expr.ts'
import type { RawComparison } from '../../logic/truth.ts'
import type { DiffChange } from '../diff.ts'
import type { ProjectIndex } from '../project-index.ts'
import type { SfAnalysis, SideContext } from '../safety.ts'
import type { CallSiteExec, WriteEvent } from '../scan.ts'

export interface InstanceInfo {
  id: string
  module: string
  backingLabel: string
  backingLoc: string
  routineId: string
  program: string
  rung: number
  executed: boolean
  safetyFunctionIds: string[]
}

export interface ModuleInfo {
  name: string
  changed: boolean
  /** Logic/interface changes to the definition (not documentation or revision). */
  changeIds: string[]
  revisionChangeIds: string[]
  revisionBefore?: string
  revisionAfter?: string
  instances: InstanceInfo[]
}

export interface RuleContext {
  pool: ExprPool
  manifest: SafetyManifest
  baseline: SideContext
  current: SideContext
  changes: DiffChange[]
  changeById: Map<string, DiffChange>
  sf: SfAnalysis[]
  sfById: Map<string, SfAnalysis>
  /** Change ids inside each function's cone (either side). */
  sfChanges: Map<string, string[]>
  modules: ModuleInfo[]
  /** Is a routine declared non-safety? */
  isNonSafety(routineId: string): boolean
  /** Safety functions whose cone (either side) contains the anchor. */
  sfIdsForAnchor(anchor: string, side?: Side): string[]
  /** Safety functions whose cone contains the location. */
  sfIdsForLoc(loc: string): string[]
  callSites: { baseline: CallSiteExec[]; current: CallSiteExec[] }
  indexOf(side: Side): ProjectIndex
}

export type EvidenceHint =
  | { kind: 'change'; changeId: string }
  | { kind: 'writer'; side: Side; writer: WriteEvent; note: string }
  | { kind: 'declaration'; sfId: string }
  | { kind: 'computation'; title: string; comparison: RawComparison; note: string }
  | { kind: 'routine'; side: Side; routineId: string; note: string }
  | { kind: 'tag'; side: Side; tag: string; note: string }

export interface Effect {
  ruleId: string
  type: FindingType
  severity: Severity
  confidence: Confidence
  disposition: Disposition
  safetyFunctionIds: string[]
  module?: string
  location: FindingLocation
  changeIds: string[]
  notificationImpact: NotificationImpact
  title: string
  summary: string
  explanation: string[]
  impact: string[]
  recommendation: string[]
  firing?: RawComparison
  blastRadius?: { instances: number; safetyRelevant: number; operational: number }
  evidence: EvidenceHint[]
  /** Effects with the same key merge into one finding. */
  groupKey: string
  /** Extra ranking weight (documented in the methodology). */
  bonus: number
}

export interface Rule extends RuleInfo {
  type: FindingType
  evaluate(ctx: RuleContext): Effect[]
}

const ORDER: Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export function maxSeverity(...s: Severity[]): Severity {
  return s.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), 'INFO' as Severity)
}

export function minSeverity(a: Severity, b: Severity): Severity {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b
}

export function bumpSeverity(s: Severity): Severity {
  return ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(s) + 1)]!
}

/** Severity a weakening gets, capped by the declared criticality of the function. */
export function capByCriticality(base: Severity, sf: SafetyFunction): Severity {
  return minSeverity(base, sf.criticality)
}

export const CRITICALITY_RANK: Record<string, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 }

export function sortSfIds(ids: string[], ctx: RuleContext): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const ca = CRITICALITY_RANK[ctx.sfById.get(a)?.sf.criticality ?? 'LOW']!
    const cb = CRITICALITY_RANK[ctx.sfById.get(b)?.sf.criticality ?? 'LOW']!
    return cb - ca || a.localeCompare(b)
  })
}

export const KIND_NOUN: Record<string, string> = {
  SHUTDOWN: 'shutdown',
  TRIP: 'trip',
  INTERLOCK: 'interlock',
  PERMISSIVE: 'permissive',
  ALARM: 'alarm',
}

export function sfName(ctx: RuleContext, id: string): string {
  const a = ctx.sfById.get(id)
  return a ? `${a.sf.name} (${id})` : id
}
