/**
 * Notification-path analysis is its own rule, separate from protective
 * outputs: an alarm can be silenced while the shutdown it accompanies still
 * works (and the reverse). Operators lose the warning either way.
 */
import type { NotificationImpact, Severity } from '../../model/analysis.ts'
import { negatedLabel } from '../../logic/expr.ts'
import { meaningfulChangeIds, confidenceOf } from './protective.ts'
import type { Effect, Rule } from './types.ts'
import { bumpSeverity } from './types.ts'

export const AlarmSuppressionRule: Rule = {
  id: 'IL-R008',
  type: 'ALARM_SUPPRESSED',
  title: 'Alarm path suppressed',
  description:
    'The condition under which a declared alarm notifies the operator became weaker: a new inhibit term, a ProgDisable/ProgSuppress input, a removed alarm instruction, or a condition that can no longer occur.',
  severity: 'CRITICAL',
  evaluate(ctx) {
    const out: Effect[] = []
    for (const a of ctx.sf) {
      const n = a.notification
      if (!n || (n.status !== 'SUPPRESSED' && n.status !== 'DEGRADED' && n.status !== 'BROKEN')) continue
      const sf = a.sf
      let severity: Severity = sf.criticality === 'CRITICAL' ? 'CRITICAL' : 'HIGH'
      if (n.status === 'BROKEN') severity = bumpSeverity(severity)
      const changeIds = meaningfulChangeIds(ctx, sf.id)
      const raw = n.raw!
      const suppressedBy = n.suppressors.map((s) => (s.suppressesWhen ? s.label : `NOT ${s.label}`))
      const title =
        n.status === 'BROKEN' ? 'Operator notification path broken' : n.status === 'SUPPRESSED' ? 'Alarm path suppressed by new inhibit' : 'Alarm notifies in fewer situations'
      const summary =
        n.status === 'BROKEN'
          ? `Alarm ${n.alarmC.label} for ${sf.name} can no longer reach the operator.`
          : n.status === 'SUPPRESSED'
            ? `${suppressedBy.join(' or ')} now suppresses alarm ${n.alarmC.label} (${sf.name}).`
            : `Alarm ${n.alarmC.label} (${sf.name}) no longer notifies when: ${raw.lost?.text ?? 'some baseline conditions'}.`
      const explanation = [
        `In the baseline, ${n.alarmB.label} notifies when: ${raw.before.text}.`,
        `In the current project, it notifies when: ${raw.afterSatisfiable === false ? 'never' : raw.after.text}.`,
      ]
      if (n.mechanismC === 'NOT_EXECUTED') explanation.push(`No executing ALMD instruction drives ${n.alarmC.label} in the current project, so the alarm never becomes active.`)
      if (n.useC && n.useB && n.useC.instruction !== n.useB.instruction) explanation.push(`Alarm instruction changed: ${n.useB.instruction} → ${n.useC.instruction}.`)
      for (const s of n.suppressors) {
        const key = ctx.pool.atoms[s.atom]!.key.slice(4)
        const meta = ctx.current.scan.meta.get(key)
        if (ctx.current.scan.executedWrites(key).length === 0) explanation.push(`No executing logic writes ${s.label}; it is set from outside the controller logic.`)
        if (meta?.externalAccess === 'Read/Write') explanation.push(`${s.label} has external access Read/Write: an HMI or OPC client can set it.`)
      }
      if (raw.witness) {
        const values = [...raw.witness.values.entries()].map(([atom, v]) => {
          const at = ctx.pool.atoms[atom]!
          return at.numeric || at.range ? (v ? at.label : negatedLabel(at)) : `${at.label} = ${v ? 1 : 0}`
        })
        explanation.push(`Example: with ${values.join(', ')}, the alarm ${raw.witness.before ? 'was raised in the baseline and is not raised now' : 'was not raised in the baseline and is raised now'}.`)
      }
      const path = (state: 'before' | 'after') => n.stages.map((s) => `${s.label}${s[state] === 'BROKEN' ? ' ✕' : s[state] === 'CONDITIONAL' ? ' (inhibited)' : ''}`).join(' → ')
      const impact = [`Before: ${path('before')}.`, `After: ${path('after')}.`, `Operator notification path: ${n.status}.`]
      const notificationImpact: NotificationImpact = n.status === 'BROKEN' ? 'BROKEN' : n.status === 'SUPPRESSED' ? 'SUPPRESSED' : 'DEGRADED'
      out.push({
        ruleId: 'IL-R008',
        type: 'ALARM_SUPPRESSED',
        severity,
        confidence: confidenceOf(ctx, a, raw),
        disposition: 'REVIEW',
        safetyFunctionIds: [sf.id],
        ...(sf.implementation.module ? { module: sf.implementation.module } : {}),
        location: { tag: n.alarmC.label, ...(sf.implementation.program ? { program: sf.implementation.program } : {}), ...(sf.implementation.routine ? { routine: sf.implementation.routine } : {}) },
        changeIds,
        notificationImpact,
        title,
        summary,
        explanation,
        impact,
        recommendation: [
          'Confirm with operations that suppressing this alarm was approved, and that a shelving or suppression state is visible on the HMI.',
          'Prefer the alarm system\'s own shelving (time-limited, audited) over logic that silences the alarm input.',
          ...(n.suppressors.length ? [`Review who can write ${n.suppressors.map((s) => s.label).join(', ')}.`] : []),
        ],
        firing: raw,
        evidence: [
          ...changeIds.map((changeId) => ({ kind: 'change' as const, changeId })),
          { kind: 'declaration', sfId: sf.id },
          { kind: 'computation', title: `Notification condition of ${n.alarmC.label}`, comparison: raw, note: `Mechanism: ${n.mechanismB}${n.mechanismB !== n.mechanismC ? ` → ${n.mechanismC}` : ''}. Declared notification: ${sf.alarm?.notification ?? 'none'}.` },
        ],
        groupKey: `ALARM|${n.status}|${changeIds.slice().sort().join(',')}|${n.suppressors.map((s) => s.label.replace(/^[^.]*\./, '')).join(',')}`,
        bonus: 0,
      })
    }
    return out
  },
}
