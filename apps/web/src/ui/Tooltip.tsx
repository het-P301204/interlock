/**
 * Tooltip — short supplementary text on hover and keyboard focus.
 *
 *   <Tooltip content="Firing condition compared over 8 assignments"><span>exhaustive</span></Tooltip>
 *
 * The tooltip is wired with aria-describedby unless `decorative` (when the
 * trigger already carries the same text as its accessible name). Esc hides it.
 * Never put essential information only in a tooltip.
 */
import { cloneElement, isValidElement, useEffect, useId, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { cx } from '../lib/cx.ts'

export interface TooltipProps {
  content: ReactNode
  children: ReactElement<Record<string, unknown>>
  side?: 'top' | 'bottom' | 'right'
  /** Horizontal alignment for top/bottom tooltips; use 'end' near the right edge of the screen. */
  align?: 'center' | 'end'
  decorative?: boolean
  className?: string
}

const sideClass = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
}

const alignClass = {
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
}

export function Tooltip({ content, children, side = 'top', align = 'center', decorative = false, className }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const trigger = isValidElement(children)
    ? cloneElement(children, decorative ? {} : { 'aria-describedby': id })
    : children

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible')) setOpen(true)
      }}
      onBlur={() => setOpen(false)}
    >
      {trigger}
      <span
        id={id}
        role="tooltip"
        // Closed tooltips are display:none so they never widen the page; they remain valid aria-describedby targets.
        hidden={!open}
        className={cx(
          'pointer-events-none absolute z-50 w-max max-w-[min(16rem,calc(100vw-2rem))] rounded-chip bg-inverse px-2.5 py-1.5 text-xs font-medium leading-snug text-inverse-ink shadow-lift',
          sideClass[side],
          side !== 'right' && alignClass[align],
          className,
        )}
      >
        {content}
      </span>
    </span>
  )
}
