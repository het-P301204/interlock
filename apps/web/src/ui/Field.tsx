/**
 * Form fields: Input, Select, Textarea, each with an optional label, hint and
 * error wired to aria-describedby / aria-invalid.
 *
 *   <Input label="Analysis name" hint="Shown in history" value={v} onChange={...} />
 *   <Select label="Severity" value={s} onChange={...}><option>CRITICAL</option></Select>
 *   <Textarea label="Notes" rows={4} />
 *
 * Inputs use the 16px input radius and a hairline border that darkens on hover.
 */
import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../lib/cx.ts'

const control =
  'w-full min-w-0 rounded-input border border-line bg-surface px-4 text-[0.9375rem] text-ink placeholder:text-ink-3 ' +
  'transition-[border-color,box-shadow] duration-fast ease-out-quart hover:border-line-strong ' +
  'focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15 ' +
  'disabled:cursor-not-allowed disabled:opacity-55 aria-[invalid=true]:border-coral-ink'

interface FieldFrameProps {
  id: string
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: ReactNode
}

function FieldFrame({ id, label, hint, error, className, children }: FieldFrameProps) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
      )}
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[0.8125rem] text-ink-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-[0.8125rem] font-medium text-coral-ink">
          {error}
        </p>
      )}
    </div>
  )
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  if (error) return `${id}-error`
  if (hint) return `${id}-hint`
  return undefined
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  wrapperClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id: idProp, className, wrapperClassName, ...rest },
  ref,
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} className={wrapperClassName}>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cx(control, 'h-11', className)}
        {...rest}
      />
    </FieldFrame>
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  wrapperClassName?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, id: idProp, className, wrapperClassName, children, ...rest },
  ref,
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} className={wrapperClassName}>
      <span className="relative flex">
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cx(control, 'h-11 appearance-none pr-10', className)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-2" />
      </span>
    </FieldFrame>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  wrapperClassName?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, id: idProp, className, wrapperClassName, rows = 4, ...rest },
  ref,
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} className={wrapperClassName}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cx(control, 'py-3 leading-relaxed', className)}
        {...rest}
      />
    </FieldFrame>
  )
})
