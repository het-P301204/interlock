/**
 * The always-visible analysis-mode indicator. It is true by construction:
 * the engine runs in a Web Worker inside this page and no request carries
 * project content (the CSP sets connect-src 'self').
 */
import { cx } from '../lib/cx.ts'
import { Tooltip } from '../ui/Tooltip.tsx'

export function LocalModeIndicator({ variant = 'full', className }: { variant?: 'full' | 'compact'; className?: string }) {
  const dot = <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-sage ring-[3px] ring-sage/25" />
  if (variant === 'compact') {
    return (
      <Tooltip content="Analysis mode LOCAL: project files remain in this browser." side="bottom" align="end" decorative>
        <span
          tabIndex={0}
          aria-label="Analysis mode: LOCAL. Project files remain in this browser."
          className={cx('inline-flex h-7 items-center gap-1.5 rounded-full bg-sage/[0.14] px-2.5 font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-sage-ink ring-1 ring-inset ring-sage/35', className)}
        >
          {dot}
          LOCAL
        </span>
      </Tooltip>
    )
  }
  return (
    <p className={cx('inline-flex min-w-0 items-center gap-2 rounded-full bg-sage/[0.12] py-1 pl-2.5 pr-3 text-xs text-ink-2 ring-1 ring-inset ring-sage/30', className)}>
      {dot}
      <span className="font-mono font-medium tracking-[0.06em] text-sage-ink">
        <span className="sr-only">Analysis mode: </span>LOCAL
      </span>
      <span className="truncate">Project files remain in this browser</span>
    </p>
  )
}
