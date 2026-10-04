/**
 * Metric / StatCard — a labelled number with optional context line.
 *
 *   <Metric label="SAFETY RELEVANT" value={4} detail="of 17 meaningful changes" tone="coral" />
 *   <MetricRow>{...metrics}</MetricRow>   a ruled row of metrics (not a card grid)
 *
 * `tone` draws a short accent tick beside the label; the value stays charcoal so
 * the row reads without color.
 */
import type { ReactNode } from 'react'
import { cx } from '../lib/cx.ts'

export interface MetricProps {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: 'coral' | 'marigold' | 'sage' | 'iris' | 'neutral'
  size?: 'md' | 'lg'
  className?: string
}

const tick = {
  coral: 'bg-coral',
  marigold: 'bg-marigold',
  sage: 'bg-sage',
  iris: 'bg-iris',
  neutral: 'bg-ink/30',
}

export function Metric({ label, value, detail, tone = 'neutral', size = 'md', className }: MetricProps) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-2', className)}>
      <dt className="flex items-center gap-2">
        <span aria-hidden="true" className={cx('h-2.5 w-[3px] rounded-full', tick[tone])} />
        <span className="il-label">{label}</span>
      </dt>
      <dd className={cx('il-num font-extrabold tracking-[-0.04em] text-ink', size === 'lg' ? 'text-[2.75rem] leading-none' : 'text-[2rem] leading-none')}>{value}</dd>
      {detail && <dd className="text-[0.8125rem] leading-snug text-ink-2">{detail}</dd>}
    </div>
  )
}

/** A horizontal, hairline-divided metric strip. Collapses to two columns on phones. */
export function MetricRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl
      className={cx(
        'grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none lg:gap-0 lg:divide-x lg:divide-line',
        'lg:[&>*]:px-6 lg:[&>*:first-child]:pl-0',
        className,
      )}
    >
      {children}
    </dl>
  )
}

/** StatCard — a Metric inside a panel, for places where one number stands alone. */
export function StatCard(props: MetricProps & { footer?: ReactNode }) {
  const { footer, className, ...metric } = props
  return (
    <dl className={cx('rounded-card bg-surface p-5 shadow-inset-line', className)}>
      <Metric {...metric} />
      {footer && <div className="mt-4 border-t border-line pt-3 text-[0.8125rem] text-ink-2">{footer}</div>}
    </dl>
  )
}
