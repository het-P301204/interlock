/**
 * Breadcrumbs — location trail; the last item is the current page.
 *
 *   <Breadcrumbs items={[{ label: 'Findings', to: '/app/findings' }, { label: 'IL-0007' }]} />
 */
import { Fragment } from 'react'
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { cx } from '../lib/cx.ts'

export interface Crumb {
  label: string
  to?: string
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cx('min-w-0', className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-xs text-ink-2">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <Fragment key={`${item.label}-${i}`}>
              <li className="il-ident min-w-0">
                {item.to && !last ? (
                  <Link to={item.to} className="rounded-[4px] hover:text-ink hover:underline hover:underline-offset-4">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={last ? 'page' : undefined} className={last ? 'text-ink' : undefined}>
                    {item.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className="text-ink-3">
                  <ChevronRight className="size-3.5" />
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
