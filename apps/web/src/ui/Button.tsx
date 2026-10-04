/**
 * Button / ButtonLink
 *
 *   <Button variant="primary" onClick={run}>Analyze Project</Button>
 *   <Button variant="secondary" size="sm" loading>Verifying</Button>
 *   <ButtonLink to="/app/new" variant="primary" iconRight={<ArrowRight />}>Analyze a Project</ButtonLink>
 *
 * Variants: primary (charcoal), secondary (paper with hairline), ghost, danger
 * (coral fill, charcoal text). Buttons use the 14px control radius; they are
 * never capsules. `loading` keeps the label, sets aria-busy and disables the
 * button.
 */
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import type { LinkProps } from 'react-router'
import { cx } from '../lib/cx.ts'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold tracking-[-0.005em] ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-fast ease-out-quart ' +
  'disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px [&_svg]:shrink-0'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-paper shadow-soft hover:bg-ink/90 hover:shadow-lift',
  secondary: 'bg-surface text-ink shadow-inset-line hover:bg-surface-raised hover:shadow-[inset_0_0_0_1px_rgb(var(--line-strong))]',
  ghost: 'text-ink hover:bg-ink/[0.06]',
  danger: 'bg-coral text-[rgb(var(--ink-fixed))] shadow-soft hover:bg-coral/90',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[0.8125rem] [&_svg]:size-4',
  md: 'h-11 px-5 text-sm [&_svg]:size-[18px]',
  lg: 'h-[52px] px-6 text-[0.9375rem] [&_svg]:size-5',
}

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return cx(base, variants[variant], sizes[size], className)
}

function BusyBars() {
  return (
    <span aria-hidden="true" className="inline-flex items-end gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span key={i} className="il-pulse-dot block h-1.5 w-1.5 rounded-[2px] bg-current" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, iconLeft, iconRight, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <BusyBars /> : iconLeft}
      <span>{children}</span>
      {!loading && iconRight}
    </button>
  )
})

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant
  size?: ButtonSize
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

export function ButtonLink({ variant = 'secondary', size = 'md', iconLeft, iconRight, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, typeof className === 'string' ? className : undefined)} {...rest}>
      {iconLeft}
      <span>{children as ReactNode}</span>
      {iconRight}
    </Link>
  )
}
