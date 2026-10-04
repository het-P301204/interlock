/**
 * Change vocabulary and the compact row used across the Changes views.
 */
import type { ReactNode } from 'react'
import type { Change, ChangeCategory } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { Badge, StatusPill } from '../../ui/Badge.tsx'

export const CATEGORY_ORDER: ChangeCategory[] = ['logic', 'execution', 'interface', 'configuration', 'data', 'documentation', 'metadata']

export const CATEGORY_LABEL: Record<ChangeCategory, string> = {
  logic: 'Logic',
  execution: 'Execution',
  interface: 'Interface',
  configuration: 'Configuration',
  data: 'Data',
  documentation: 'Documentation',
  metadata: 'Metadata',
}

export const CATEGORY_HINT: Record<ChangeCategory, string> = {
  logic: 'Rung text and routine bodies',
  execution: 'What runs and when: tasks, schedules, JSR calls',
  interface: 'Module parameters and data types',
  configuration: 'Tag attributes that change behaviour',
  data: 'Stored tag values',
  documentation: 'Descriptions and rung comments',
  metadata: 'Export date and bookkeeping',
}

export function OpBadge({ op }: { op: Change['op'] }) {
  return (
    <Badge tone={op === 'modified' ? 'outline' : 'neutral'} className="w-[5.75rem] justify-center">
      <span aria-hidden="true">{op === 'added' ? '+' : op === 'removed' ? '−' : '~'}</span>
      {op}
    </Badge>
  )
}

export function SemanticPill({ semantic }: { semantic: Change['semantic'] }) {
  if (!semantic) return null
  if (semantic === 'equivalent') return <StatusPill status="CHANGED_EQUIVALENT" label="EQUIVALENT" />
  if (semantic === 'different') return <Badge tone="neutral" solid>DIFFERENT</Badge>
  return <StatusPill status="NOT_ANALYZED" label="NOT DECIDED" />
}

/** Inserts break opportunities after ; and , so long value lists wrap between items, not inside names. */
export function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[;,])/)
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <wbr />}
        </span>
      ))}
    </>
  )
}

export function entityLabel(c: Change): string {
  const e = c.entity
  const where = e.container ? `${e.container} / ` : ''
  return `${where}${e.name}`
}

export function ChangeRow({ change: c, trailing, className }: { change: Change; trailing?: ReactNode; className?: string }) {
  const valueShown = c.before !== undefined || c.after !== undefined
  return (
    <div className={cx('grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[4.75rem_6rem_minmax(0,1fr)_auto] sm:items-start sm:px-5', className)}>
      <span className="font-mono text-xs font-semibold text-ink sm:pt-1">{c.id}</span>
      <span className="sm:pt-0.5">
        <OpBadge op={c.op} />
      </span>
      <div className="min-w-0">
        <p className="il-ident text-sm font-semibold text-ink">{c.summary}</p>
        <p className="il-ident font-mono text-[0.6875rem] text-ink-2">
          {c.entity.type}
          {c.field ? ` · ${c.field}` : ''} · {entityLabel(c)}
        </p>
        {valueShown && c.category !== 'logic' && (
          <p className="il-ident mt-1 line-clamp-2 font-mono text-[0.6875rem] text-ink-2" title={`${c.before ?? '∅'} → ${c.after ?? '∅'}`}>
            <span className="text-ink-3">
              <Breakable text={c.before ?? '∅'} />
            </span>
            <span aria-hidden="true" className="px-1.5 text-ink-3">
              →
            </span>
            <span className="sr-only"> changed to </span>
            <span className="text-ink">
              <Breakable text={c.after ?? '∅'} />
            </span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <SemanticPill semantic={c.semantic} />
        {trailing}
      </div>
    </div>
  )
}
