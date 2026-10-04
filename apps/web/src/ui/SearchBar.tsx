/**
 * SearchBar — labelled search input with clear button and optional shortcut hint.
 *
 *   <SearchBar label="Search findings" value={q} onChange={setQ} placeholder="IL-0007, AOI, tag…" />
 *
 * Esc clears the field when it has text.
 */
import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { cx } from '../lib/cx.ts'

export interface SearchBarProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: ReactNode
  className?: string
  autoFocus?: boolean
}

export function SearchBar({ label, value, onChange, placeholder, hint, className, autoFocus }: SearchBarProps) {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div role="search" className={cx('relative flex min-w-0 items-center', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 size-4 text-ink-2" />
      <input
        ref={ref}
        id={id}
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation()
            onChange('')
          }
        }}
        className={cx(
          'h-11 w-full min-w-0 rounded-input border border-line bg-surface pl-10 text-[0.9375rem] text-ink placeholder:text-ink-3',
          'transition-[border-color] duration-fast hover:border-line-strong focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15',
          '[&::-webkit-search-cancel-button]:appearance-none',
          value ? 'pr-10' : hint ? 'pr-24' : 'pr-4',
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('')
            ref.current?.focus()
          }}
          className="absolute right-2 inline-flex size-7 items-center justify-center rounded-[8px] text-ink-2 hover:bg-ink/[0.06] hover:text-ink"
        >
          <X className="size-4" />
        </button>
      ) : (
        hint && <span className="pointer-events-none absolute right-3 hidden sm:inline-flex">{hint}</span>
      )}
    </div>
  )
}
