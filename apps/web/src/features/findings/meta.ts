/**
 * Display vocabulary for findings. Labels only: every value shown next to
 * them comes from the AnalysisResult.
 */
import type { AnalysisResult, Disposition, Finding, FindingType, NotificationImpact, SafetyFunctionResult } from '@interlock/core/types'
import type { Tone } from '../../ui/Badge.tsx'

export const FINDING_TYPE_LABEL: Record<FindingType, string> = {
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

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  REVIEW: 'Review',
  UNDECLARED: 'Undeclared',
  INFORMATIONAL: 'Informational',
  POSITIVE: 'Positive',
}

export const UNDECLARED_COPY = 'No safety intent has been declared for this logic. INTERLOCK therefore cannot conclude that it is safe.'

export const NOTIFICATION_LABEL: Record<NotificationImpact, string> = {
  NONE: 'No notification impact',
  DEGRADED: 'Notification degraded',
  SUPPRESSED: 'Notification suppressed',
  BROKEN: 'Notification broken',
}

export const NOTIFICATION_TONE: Record<NotificationImpact, Tone> = {
  NONE: 'neutral',
  DEGRADED: 'marigold',
  SUPPRESSED: 'coral',
  BROKEN: 'coral',
}

export function sfIndex(result: AnalysisResult): Map<string, SafetyFunctionResult> {
  return new Map(result.safetyFunctions.map((s) => [s.function.id, s]))
}

export function locationLabel(f: Finding): string {
  const l = f.location
  const parts: string[] = []
  if (l.program && l.routine) parts.push(`${l.program}/${l.routine}`)
  else if (l.routine) parts.push(l.routine)
  else if (l.program) parts.push(l.program)
  if (l.rung !== undefined) parts.push(`rung ${l.rung}`)
  if (l.tag && parts.length === 0) parts.push(l.tag)
  return parts.join(' · ')
}

/** Findings in review order (rank ascending, then id). */
export function rankedFindings(result: AnalysisResult): Finding[] {
  return [...result.findings].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
}

/** Verb for a witness row: alarms notify, protective functions act. */
export function witnessVerb(f: Finding): { yes: string; no: string } {
  return f.type === 'ALARM_SUPPRESSED' ? { yes: 'notified', no: 'does not notify' } : { yes: 'acted', no: 'does not act' }
}

/** Compact file-name-safe slug. */
export function safeSlug(s: string, max = 48): string {
  const slug = s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, max)
  return slug || 'interlock'
}
