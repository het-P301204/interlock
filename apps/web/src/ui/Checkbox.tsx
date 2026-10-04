/**
 * Checkbox and Switch — native inputs, custom drawn, fully keyboard operable.
 *
 *   <Checkbox label="CRITICAL" description="12 findings" checked={on} onChange={(e) => set(e.target.checked)} />
 *   <Switch label="Show undeclared logic" checked={on} onCheckedChange={set} />
 *
 * Switch renders role="switch" with an ON/OFF state that is also spelled out
 * in text, so state is never conveyed by color or position alone.
 */
import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cx } from '../lib/cx.ts'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  description?: ReactNode
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, id: idProp, className, ...rest },
  ref,
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <label htmlFor={id} className={cx('group flex min-w-0 cursor-pointer items-start gap-3 py-1.5', className)}>
      <span className="relative mt-0.5 flex size-[18px] shrink-0">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-[5px] border border-line-strong bg-surface transition-colors duration-fast checked:border-ink checked:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          aria-describedby={description ? `${id}-desc` : undefined}
          {...rest}
        />
        <Check aria-hidden="true" strokeWidth={3} className="pointer-events-none relative m-auto size-3 text-paper opacity-0 peer-checked:opacity-100" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="il-ident text-sm font-medium text-ink">{label}</span>
        {description && (
          <span id={`${id}-desc`} className="text-[0.8125rem] text-ink-2">
            {description}
          </span>
        )}
      </span>
    </label>
  )
})

export interface SwitchProps {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function Switch({ label, description, checked, onCheckedChange, disabled, className }: SwitchProps) {
  const id = useId()
  return (
    <div className={cx('flex min-w-0 items-start justify-between gap-4 py-1.5', className)}>
      <span className="flex min-w-0 flex-col">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        {description && (
          <span id={`${id}-desc`} className="text-[0.8125rem] text-ink-2">
            {description}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <span aria-hidden="true" className="w-7 text-right font-mono text-[0.6875rem] font-medium text-ink-2">
          {checked ? 'ON' : 'OFF'}
        </span>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-describedby={description ? `${id}-desc` : undefined}
          disabled={disabled}
          onClick={() => onCheckedChange(!checked)}
          className={cx(
            'relative h-7 w-12 shrink-0 rounded-full border transition-colors duration-fast ease-out-quart disabled:opacity-50',
            checked ? 'border-ink bg-ink' : 'border-line-strong bg-paper-2',
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              'absolute left-[3px] top-[3px] block size-5 rounded-full shadow-soft transition-transform duration-base ease-out-expo',
              checked ? 'translate-x-5 bg-paper' : 'translate-x-0 bg-surface-raised',
            )}
          />
        </button>
      </span>
    </div>
  )
}
