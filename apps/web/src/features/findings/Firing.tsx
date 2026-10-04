/**
 * Firing-condition comparison for a finding: before/after condition with the
 * atoms that entered or left marked, what was lost or gained, the concrete
 * witness assignment, and how exhaustively it was checked.
 */
import type { FiringComparison, FiringVerdict, Finding } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { formatCount } from '../../lib/format.ts'
import { Badge, Glyph } from '../../ui/Badge.tsx'
import type { Tone } from '../../ui/Badge.tsx'
import { LogicDiff } from '../../ui/LogicDiff.tsx'
import { LogicText } from '../../ui/LogicText.tsx'
import { witnessVerb } from './meta.ts'

const VERDICT_TONE: Record<FiringVerdict, Tone> = {
  UNCHANGED: 'neutral',
  EQUIVALENT: 'iris',
  WEAKENED: 'coral',
  STRENGTHENED: 'sage',
  MIXED: 'marigold',
  NEVER_FIRES: 'coral',
  ALWAYS_FIRES: 'marigold',
  NOT_DECIDED: 'outline',
}

export function Witness({ finding, firing }: { finding: Finding; firing: FiringComparison }) {
  const w = firing.witness
  if (!w) return null
  const verb = witnessVerb(finding)
  const newAtoms = new Set(firing.atoms.filter((a) => !a.inBaseline).map((a) => a.label))
  return (
    <figure className="min-w-0 rounded-card bg-surface p-4 shadow-inset-line sm:p-5">
      <figcaption className="il-label mb-3">Witness · one input combination that shows the difference</figcaption>
      <p className="sr-only">
        With {w.values.map((v) => `${v.label} = ${v.value}`).join(', ')}: {w.before ? verb.yes : 'did not act'} in the baseline, {w.after ? verb.yes : verb.no} now.
      </p>
      <div aria-hidden="true" className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-xs text-ink-2">with</span>
        {w.values.map((v) => (
          <span
            key={v.atom}
            className={cx(
              'il-ident inline-flex items-center gap-1 rounded-[8px] px-2 py-1 font-mono text-[0.75rem]',
              newAtoms.has(v.label) ? 'bg-marigold/35 text-ink ring-1 ring-inset ring-marigold-ink/40' : 'bg-paper-2 text-ink ring-1 ring-inset ring-line',
            )}
          >
            {v.label}
            <span className="text-ink-3">=</span>
            <span className="font-semibold">{v.value}</span>
          </span>
        ))}
      </div>
      <div aria-hidden="true" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-input bg-paper-2/70 px-4 py-2.5 shadow-inset-line">
          <span className="font-mono text-xs text-ink-2">BASELINE</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-ink">
            <Glyph shape={w.before ? 'check' : 'cross'} />
            {w.before ? verb.yes.toUpperCase() : 'DID NOT ACT'}
          </span>
        </div>
        <div className={cx('flex items-center justify-between gap-3 rounded-input px-4 py-2.5', w.after === w.before ? 'bg-paper-2/70 shadow-inset-line' : 'bg-coral/[0.1] ring-1 ring-inset ring-coral/40')}>
          <span className="font-mono text-xs text-ink-2">CURRENT</span>
          <span className={cx('inline-flex items-center gap-1.5 font-mono text-xs font-semibold', w.after === w.before ? 'text-ink' : 'text-coral-ink')}>
            <Glyph shape={w.after ? 'check' : 'cross'} />
            {w.after ? verb.yes.toUpperCase() : verb.no.toUpperCase()}
          </span>
        </div>
      </div>
    </figure>
  )
}

export function FiringSection({ finding, firing }: { finding: Finding; firing: FiringComparison }) {
  const alarm = finding.type === 'ALARM_SUPPRESSED'
  const verb = alarm ? 'NOTIFIES WHEN' : 'ACTS WHEN'
  const removed = firing.atoms.filter((a) => a.inBaseline && !a.inCurrent).map((a) => a.label)
  const added = firing.atoms.filter((a) => !a.inBaseline && a.inCurrent).map((a) => a.label)
  const external = firing.atoms.filter((a) => a.externalAccess === 'Read/Write' && a.externallySet)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={VERDICT_TONE[firing.verdict]} size="md">
          {firing.verdict.replace(/_/g, ' ')}
        </Badge>
        <span className="font-mono text-xs text-ink-2">
          {firing.exhaustive
            ? `Exhaustive: every consistent combination checked (${formatCount(firing.assignmentsChecked)} assignments)`
            : `Not exhaustive: ${formatCount(firing.assignmentsChecked)} assignments checked`}
        </span>
      </div>
      <LogicDiff
        language="condition"
        before={firing.before.text}
        after={firing.after.text}
        beforeLabel={`${verb} · BASELINE`}
        afterLabel={`${verb} · CURRENT`}
        emphasis={{ before: removed, after: added }}
        stacked
      />
      {(firing.lost || firing.gained) && (
        <dl className={cx('grid grid-cols-1 gap-3', firing.lost && firing.gained && 'md:grid-cols-2')}>
          {firing.lost && (
            <div className="min-w-0 rounded-card border border-coral/40 bg-coral/[0.06] p-4">
              <dt className="il-label mb-1.5 text-coral-ink">{alarm ? 'No longer notifies when' : 'No longer acts when'}</dt>
              <dd className="min-w-0">
                <LogicText language="condition" text={firing.lost.text} />
              </dd>
            </div>
          )}
          {firing.gained && (
            <div className="min-w-0 rounded-card border border-sage/45 bg-sage/[0.08] p-4">
              <dt className="il-label mb-1.5 text-sage-ink">{alarm ? 'Now also notifies when' : 'Now also acts when'}</dt>
              <dd className="min-w-0">
                <LogicText language="condition" text={firing.gained.text} />
              </dd>
            </div>
          )}
        </dl>
      )}
      {firing.reason && <p className="text-sm text-ink-2">{firing.reason}</p>}
      <Witness finding={finding} firing={firing} />
      <details className="group rounded-card bg-surface shadow-inset-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span>
            Inputs considered <span className="il-num font-mono text-xs font-normal text-ink-2">({firing.atoms.length})</span>
          </span>
          {external.length > 0 && <span className="font-mono text-xs font-normal text-coral-ink">{external.length} writable from HMI/OPC</span>}
        </summary>
        <ul className="divide-y divide-line border-t border-line">
          {firing.atoms.map((a) => (
            <li key={a.id} className="grid grid-cols-1 gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <span className="il-ident font-mono text-data text-ink">
                {a.label}
                {!a.inBaseline && <span className="ml-2 text-[0.6875rem] text-marigold-ink">NEW</span>}
                {!a.inCurrent && <span className="ml-2 text-[0.6875rem] text-coral-ink">REMOVED</span>}
              </span>
              <span className="font-mono text-[0.6875rem] text-ink-2">
                {a.kind} · access {a.externalAccess}
                {a.externallySet ? ' · set outside logic' : ''}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
