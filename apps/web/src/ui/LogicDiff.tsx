/**
 * LogicDiff — baseline vs current logic with changed terms marked.
 * Side by side from 768px, stacked below.
 *
 *   <LogicDiff
 *     before="XIC(PT201_High)XIC(Safety_Enable)OTE(C201_Shutdown_Cmd);"
 *     after="XIC(PT201_High)XIC(Safety_Enable)XIO(Maintenance_Mode)OTE(C201_Shutdown_Cmd);"
 *     beforeMeta="known-good-project.L5X · Compressor/Main · rung 0"
 *     afterMeta="current.L5X · Compressor/Main · rung 0" />
 *   <LogicDiff language="condition" before="Pressure_High AND Safety_Enable"
 *     after="Pressure_High AND Safety_Enable AND NOT Maintenance_Mode" beforeLabel="FIRES WHEN (BASELINE)" />
 *
 * A missing side renders "Not present in baseline/current" rather than empty.
 */
import type { ReactNode } from 'react'
import { cx } from '../lib/cx.ts'
import { diffUnits } from './logicTokens.ts'
import { LogicText, tokenize } from './LogicText.tsx'
import type { LogicLanguage } from './LogicText.tsx'

export interface LogicDiffProps {
  before?: string
  after?: string
  language?: LogicLanguage
  beforeLabel?: ReactNode
  afterLabel?: ReactNode
  beforeMeta?: ReactNode
  afterMeta?: ReactNode
  /** Force stacked layout even on wide screens. */
  stacked?: boolean
  className?: string
}

function Side({ label, meta, children, tone }: { label: ReactNode; meta?: ReactNode; children: ReactNode; tone: 'before' | 'after' }) {
  return (
    <figure className="flex min-w-0 flex-col">
      <figcaption className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 pb-2 pt-3">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className={cx('size-1.5 rounded-full', tone === 'before' ? 'bg-ink-3' : 'bg-ink')} />
          <span className={cx('il-label', tone === 'after' && 'text-ink')}>{label}</span>
        </span>
        {meta && <span className="il-ident font-mono text-[0.6875rem] text-ink-2">{meta}</span>}
      </figcaption>
      <div className="min-w-0 flex-1 px-4 pb-4">{children}</div>
    </figure>
  )
}

export function LogicDiff({
  before,
  after,
  language = 'rung',
  beforeLabel = 'BASELINE',
  afterLabel = 'CURRENT',
  beforeMeta,
  afterMeta,
  stacked = false,
  className,
}: LogicDiffProps) {
  const ua = before !== undefined ? tokenize(before, language) : []
  const ub = after !== undefined ? tokenize(after, language) : []
  const marks = before !== undefined && after !== undefined ? diffUnits(ua, ub) : undefined

  const absent = (side: string) => <p className="font-mono text-data italic text-ink-2">Not present in {side}</p>

  return (
    <div
      className={cx(
        'grid min-w-0 overflow-hidden rounded-card bg-surface shadow-inset-line',
        stacked ? 'grid-cols-1 divide-y divide-line' : 'grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0',
        className,
      )}
    >
      <Side label={beforeLabel} meta={beforeMeta} tone="before">
        {before !== undefined ? <LogicText text={before} units={ua} marks={marks?.a} language={language} /> : absent('baseline')}
      </Side>
      <div className="bg-paper-2/45">
        <Side label={afterLabel} meta={afterMeta} tone="after">
          {after !== undefined ? <LogicText text={after} units={ub} marks={marks?.b} language={language} /> : absent('current')}
        </Side>
      </div>
    </div>
  )
}
