/**
 * Layout primitives.
 *
 *   <PageHeader eyebrow="ANALYSIS" title="New analysis" description="…" actions={<Button/>} />
 *   <Section title="Safety declarations" eyebrow="STEP 3" description="…" actions={…}>…</Section>
 *   <Panel padding="lg">…</Panel>               an 18px-radius surface with a hairline
 *   <Panel as="section" tone="sunken">…</Panel>  paper-2 well, for secondary content
 *   <KeyValue items={[['SHA-256', <Hash/>], ['Vendor', 'Rockwell Automation']]} />
 */
import type { ElementType, ReactNode } from 'react'
import { cx } from '../lib/cx.ts'

export function PageHeader({ eyebrow, title, description, actions, className }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cx('flex min-w-0 flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <p className="il-label mb-2.5">{eyebrow}</p>}
        <h1 className="il-ident text-title-1 text-ink">{title}</h1>
        {description && <p className="mt-2.5 max-w-prose text-[0.9375rem] leading-relaxed text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Section({ eyebrow, title, description, actions, children, className, id }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cx('min-w-0', className)}>
      <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="il-label mb-1.5">{eyebrow}</p>}
          <h2 id={id ? `${id}-title` : undefined} className="text-title-2 text-ink">
            {title}
          </h2>
          {description && <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function Panel({
  as: Tag = 'div',
  children,
  className,
  padding = 'md',
  tone = 'raised',
}: {
  as?: ElementType
  children?: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  tone?: 'raised' | 'sunken'
}) {
  return (
    <Tag
      className={cx(
        'min-w-0 rounded-card',
        tone === 'raised' ? 'bg-surface shadow-inset-line' : 'bg-paper-2/60 shadow-inset-line',
        padding === 'sm' && 'p-4',
        padding === 'md' && 'p-5 sm:p-6',
        padding === 'lg' && 'p-6 sm:p-8',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

export function KeyValue({ items, className, mono = true }: { items: Array<[string, ReactNode]>; className?: string; mono?: boolean }) {
  return (
    <dl className={cx('grid grid-cols-[minmax(7.5rem,auto)_minmax(0,1fr)] gap-x-5 gap-y-2 text-sm', className)}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="il-label pt-[3px]">{k}</dt>
          <dd className={cx('il-ident min-w-0 text-ink', mono && 'font-mono text-data')}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}
