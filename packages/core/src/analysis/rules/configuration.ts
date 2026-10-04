/**
 * Rules about things that change protection without changing a firing
 * condition: alarm-instruction configuration stored in the tag, and new
 * writers of a protective output that later logic currently overrides.
 */
import type { NotificationImpact, Severity } from '../../model/analysis.ts'
import { classifyProtective, meaningfulChangeIds } from './protective.ts'
import type { Effect, Rule } from './types.ts'
import { bumpSeverity, capByCriticality } from './types.ts'

function parseConfig(value: string | undefined): Map<string, string> {
  const m = new Map<string, string>()
  for (const part of (value ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) m.set(part.slice(0, i), part.slice(i + 1))
  }
  return m
}

const isTrue = (v: string | undefined) => v !== undefined && /^(true|1)$/i.test(v)

export const AlarmConfigurationRule: Rule = {
  id: 'IL-R019',
  type: 'ALARM_SUPPRESSED',
  title: 'Alarm configuration weakened',
  description:
    'The stored configuration of a declared ALMD alarm changed in a way that delays, inverts, disables or suppresses it (Condition, MinDurationPRE, ProgDisable/OperDisable, ProgSuppress/OperSuppress, OperShelve), even though no rung changed.',
  severity: 'CRITICAL',
  evaluate(ctx) {
    const out: Effect[] = []
    for (const a of ctx.sf) {
      if (!a.sf.alarm) continue
      const name = a.sf.alarm.tag.replace(/^\\[^.]+\./, '').toLowerCase()
      for (const c of ctx.changes) {
        if (c.entity.type !== 'tag' || c.field !== 'value' || c.entity.name.toLowerCase() !== name) continue
        const b = parseConfig(c.before)
        const n = parseConfig(c.after)
        const problems: Array<{ text: string; impact: NotificationImpact }> = []
        if (b.get('Condition') !== undefined && b.get('Condition') !== n.get('Condition'))
          problems.push({ text: `Condition changed from ${b.get('Condition')} to ${n.get('Condition')}: the alarm now activates on the opposite state of its input.`, impact: 'BROKEN' })
        const db = Number(b.get('MinDurationPRE') ?? 0)
        const dn = Number(n.get('MinDurationPRE') ?? 0)
        if (dn > db) problems.push({ text: `MinDurationPRE raised from ${db.toLocaleString('en-US')} to ${dn.toLocaleString('en-US')} ms: the condition must persist that long before the operator is notified.`, impact: 'DEGRADED' })
        for (const key of ['ProgDisable', 'OperDisable'])
          if (!isTrue(b.get(key)) && isTrue(n.get(key))) problems.push({ text: `${key} is stored as true: the alarm is disabled.`, impact: 'BROKEN' })
        for (const key of ['ProgSuppress', 'OperSuppress', 'OperShelve'])
          if (!isTrue(b.get(key)) && isTrue(n.get(key))) problems.push({ text: `${key} is stored as true: the alarm is suppressed.`, impact: 'SUPPRESSED' })
        if (problems.length === 0) continue
        const impact: NotificationImpact = problems.some((p) => p.impact === 'BROKEN') ? 'BROKEN' : problems.some((p) => p.impact === 'SUPPRESSED') ? 'SUPPRESSED' : 'DEGRADED'
        let severity: Severity = a.sf.criticality === 'CRITICAL' ? 'CRITICAL' : 'HIGH'
        if (impact === 'BROKEN') severity = bumpSeverity(severity)
        out.push({
          ruleId: 'IL-R019',
          type: 'ALARM_SUPPRESSED',
          severity,
          confidence: 'HIGH',
          disposition: 'REVIEW',
          safetyFunctionIds: [a.sf.id],
          location: { tag: c.entity.name },
          changeIds: [c.id],
          notificationImpact: impact,
          title: impact === 'BROKEN' ? 'Alarm configuration breaks operator notification' : 'Alarm configuration weakened',
          summary: `The stored configuration of ${c.entity.name} (${a.sf.name}) changed: ${problems.map((p) => p.text.split(':')[0]).join('; ')}.`,
          explanation: [
            ...problems.map((p) => p.text),
            'No rung changed: the alarm instruction reads this configuration from the tag. A logic-only diff would miss it.',
          ],
          impact: [`Operator notification path: ${impact}.`],
          recommendation: ['Confirm the alarm configuration change against the alarm rationalization record (ISA-18.2 master alarm database) and restore it if it was not approved.'],
          evidence: [{ kind: 'change', changeId: c.id }, { kind: 'declaration', sfId: a.sf.id }],
          groupKey: `ALMCFG|${c.id}`,
          bonus: 0,
        })
      }
    }
    return out
  },
}

export const OverriddenWriterRule: Rule = {
  id: 'IL-R020',
  type: 'PROTECTIVE_OUTPUT_BYPASSED',
  title: 'New writer of a protective output (currently overridden)',
  description:
    'A new instruction writes a declared protective output, but later logic in the same scan overwrites it, so the end-of-scan value is unchanged. Logix updates outputs asynchronously to the scan, so an intermediate value can still reach the field; and the override holds only as long as the later logic does.',
  severity: 'HIGH',
  evaluate(ctx) {
    const out: Effect[] = []
    for (const a of ctx.sf) {
      const p = a.protective
      if (!p || p.newWriters.length === 0 || classifyProtective(ctx, a)) continue
      const w = p.newWriters[0]!
      const routine = ctx.current.index.routines.get(w.routineId)
      const where = routine ? `${routine.container.name}/${routine.name} rung ${w.rung}` : `${w.routineId} rung ${w.rung}`
      const changeIds = ctx.changes.filter((c) => c.anchors.current?.includes(`rung:${w.routineId}#${w.rung}`)).map((c) => c.id)
      out.push({
        ruleId: 'IL-R020',
        type: 'PROTECTIVE_OUTPUT_BYPASSED',
        severity: capByCriticality('HIGH', a.sf),
        confidence: 'MEDIUM',
        disposition: 'REVIEW',
        safetyFunctionIds: [a.sf.id],
        location: { ...(routine ? { program: routine.container.name, routine: routine.name, routineId: routine.id } : {}), rung: w.rung, tag: p.outC.label },
        changeIds: [...new Set([...changeIds, ...meaningfulChangeIds(ctx, a.sf.id)])],
        notificationImpact: 'NONE',
        title: `New writer of protective output ${p.outC.label}`,
        summary: `${w.instruction} in ${where} writes the protective output of ${a.sf.name}; later logic overwrites it in the same scan.`,
        explanation: [
          `${p.newWriters.map((x) => `${x.instruction} (${x.routineId.replace(/^program:/, '')} rung ${x.rung})`).join('; ')} did not exist in the baseline.`,
          'At the end of the scan the protective logic still decides the output, so the firing condition is unchanged. But Logix transmits outputs asynchronously to the scan: the intermediate value can reach the field, and the bypass becomes effective the moment the later logic changes.',
        ],
        impact: [`${a.sf.name}: a second writer of ${p.outC.label} exists.`],
        recommendation: ['Remove writes to protective outputs from outside the protective logic, or justify them in the change record.'],
        evidence: [...changeIds.map((changeId) => ({ kind: 'change' as const, changeId })), { kind: 'writer', side: 'current', writer: w, note: 'New writer of the protective output' }, { kind: 'declaration', sfId: a.sf.id }],
        groupKey: `OVERRIDDEN|${a.sf.id}|${w.routineId}#${w.rung}`,
        bonus: 0,
      })
    }
    return out
  },
}
