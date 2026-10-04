/**
 * ImpactChain — how far a finding reaches, as a left-to-right chain:
 *   AOI definition → N instances → M safety-relevant → safety function(s) → protective output(s)
 * or, without a module:
 *   routine / rung → safety function(s) → protective output / alarm
 * Every node is read from the finding, result.modules and result.safetyFunctions.
 * Horizontal from 1024px, vertical below. Nodes reveal in order once.
 */
import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import type { AnalysisResult, Finding } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { locationLabel, sfIndex } from './meta.ts'

interface ChainNode {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'normal' | 'emphasis' | 'dashed'
}

export function buildChain(f: Finding, result: AnalysisResult): ChainNode[] {
  const sfs = sfIndex(result)
  const fns = f.safetyFunctionIds.map((id) => sfs.get(id)).filter((x): x is NonNullable<typeof x> => !!x)
  const nodes: ChainNode[] = []
  const mod = f.module ? result.modules.find((m) => m.module === f.module) : undefined

  if (f.module && f.blastRadius) {
    nodes.push({
      label: 'Module definition',
      value: <span className="font-mono">{f.module}</span>,
      sub: mod?.revisionBefore && mod.revisionAfter && mod.revisionBefore !== mod.revisionAfter ? `revision ${mod.revisionBefore} → ${mod.revisionAfter}` : mod?.revisionAfter ? `revision ${mod.revisionAfter}` : undefined,
    })
    nodes.push({ label: 'Instances', value: f.blastRadius.instances, sub: 'call sites run the changed definition' })
    nodes.push({
      label: 'Safety-relevant',
      value: f.blastRadius.safetyRelevant,
      sub: `${f.blastRadius.operational} operational, no declared intent`,
      tone: 'emphasis',
    })
  } else {
    nodes.push({ label: 'Changed logic', value: <span className="font-mono">{locationLabel(f) || f.location.tag || '—'}</span>, sub: `${f.changeIds.length} change${f.changeIds.length === 1 ? '' : 's'}: ${f.changeIds.join(', ')}` })
  }

  if (fns.length === 0) {
    nodes.push({ label: 'Safety function', value: 'None declared', sub: 'INTERLOCK cannot conclude this logic is safe', tone: 'dashed' })
    return nodes
  }

  nodes.push({
    label: fns.length === 1 ? 'Safety function' : 'Safety functions',
    value: fns.length === 1 ? fns[0]!.function.name : `${fns.length} functions`,
    sub: fns.map((s) => s.function.id).join(', '),
    tone: 'emphasis',
  })

  const alarm = f.type === 'ALARM_SUPPRESSED' || f.notificationImpact !== 'NONE'
  const outputs = fns.flatMap((s) => (s.function.protectiveOutput ? [s.function.protectiveOutput.tag] : []))
  const alarms = fns.flatMap((s) => (s.function.alarm ? [s.function.alarm.tag] : []))
  if (alarm && alarms.length) {
    nodes.push({ label: alarms.length === 1 ? 'Alarm' : 'Alarms', value: <span className="font-mono">{alarms.length === 1 ? alarms[0] : `${alarms.length} alarms`}</span>, sub: alarms.length > 1 ? alarms.join(', ') : 'operator notification' })
  } else if (outputs.length) {
    nodes.push({
      label: outputs.length === 1 ? 'Protective output' : 'Protective outputs',
      value: <span className="font-mono">{outputs.length === 1 ? outputs[0] : `${outputs.length} outputs`}</span>,
      sub: outputs.length > 1 ? outputs.join(', ') : fns[0]?.function.protectiveOutput?.tripState === 'ENERGIZE' ? 'energizes to act' : 'de-energizes to act',
    })
  }
  return nodes
}

export function ImpactChain({ finding, result, className }: { finding: Finding; result: AnalysisResult; className?: string }) {
  const nodes = buildChain(finding, result)
  return (
    <ol className={cx('flex min-w-0 flex-col gap-0 lg:flex-row lg:items-stretch', className)} aria-label="Impact chain">
      {nodes.map((n, i) => (
        <Fragment key={n.label}>
          {i > 0 && (
            <li aria-hidden="true" className="flex shrink-0 items-center justify-center py-1 lg:w-8 lg:py-0">
              <motion.span
                className="block h-5 w-[2px] origin-top bg-ink lg:h-[2px] lg:w-full lg:origin-left"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.25, delay: 0.1 + i * 0.12 }}
              />
            </li>
          )}
          <motion.li
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
            className={cx(
              'flex min-w-0 flex-col gap-1.5 rounded-card px-4 py-3.5 lg:min-w-[8.5rem]',
              i === 0 ? 'lg:flex-[1.5]' : 'lg:flex-1',
              n.tone === 'dashed' ? 'border border-dashed border-line-strong' : n.tone === 'emphasis' ? 'bg-ink text-paper' : 'bg-surface shadow-inset-line',
            )}
          >
            <span className={cx('font-mono text-label uppercase', n.tone === 'emphasis' ? 'text-paper/70' : 'text-ink-2')}>{n.label}</span>
            <span className={cx('il-ident il-num text-[0.9875rem] font-bold leading-snug', n.tone === 'emphasis' ? 'text-paper' : 'text-ink')}>{n.value}</span>
            {n.sub && <span className={cx('il-ident text-xs leading-snug', n.tone === 'emphasis' ? 'text-paper/75' : 'text-ink-2')}>{n.sub}</span>}
          </motion.li>
        </Fragment>
      ))}
    </ol>
  )
}
