/**
 * The INTERLOCK mark and wordmark.
 *
 *   <Mark className="size-7" />           glyph only (decorative unless `title` is given)
 *   <Wordmark />                          glyph + INTERLOCK
 *
 * The mark is a normally-closed ladder contact, ─┤/├─: the rung conducts until
 * the inhibit term (the coral trip slash) opens it. Plates and leads follow
 * currentColor; the slash is always coral.
 */
import { cx } from '../lib/cx.ts'

export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cx('shrink-0', className)} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="5">
        <path d="M5 32H20" />
        <path d="M44 32H59" />
        <path d="M20 16V48" />
        <path d="M44 16V48" />
      </g>
      <path d="M25.5 45L38.5 19" fill="none" stroke="rgb(var(--coral))" strokeLinecap="round" strokeWidth="5.5" />
    </svg>
  )
}

export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5 text-ink', className)}>
      <Mark className="size-7" />
      {!compact && <span className="text-[0.9375rem] font-extrabold tracking-[0.16em]">INTERLOCK</span>}
    </span>
  )
}
