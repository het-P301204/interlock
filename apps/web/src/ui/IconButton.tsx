/**
 * IconButton — a square button holding only an icon.
 *
 *   <IconButton label="Copy SHA-256" onClick={copy}><Copy /></IconButton>
 *
 * `label` is required: it becomes the accessible name and the tooltip.
 */
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/cx.ts'
import { Tooltip } from './Tooltip.tsx'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  label: string
  children: ReactNode
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'secondary'
  /** Show the label as a tooltip on hover/focus (default true). */
  tooltip?: boolean
  tooltipSide?: 'top' | 'bottom' | 'right'
  tooltipAlign?: 'center' | 'end'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, size = 'md', variant = 'ghost', tooltip = true, tooltipSide = 'bottom', tooltipAlign = 'center', className, type = 'button', ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors duration-fast ease-out-quart',
        'hover:text-ink disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'ghost' ? 'hover:bg-ink/[0.06]' : 'bg-surface shadow-inset-line hover:bg-surface-raised',
        size === 'sm' ? 'size-8 rounded-[10px] [&_svg]:size-4' : 'size-10 [&_svg]:size-[18px]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
  return tooltip ? (
    <Tooltip content={label} side={tooltipSide} align={tooltipAlign} decorative>
      {button}
    </Tooltip>
  ) : (
    button
  )
})
