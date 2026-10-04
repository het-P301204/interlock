/**
 * FilterBar + FilterDrawer — compact active-filter chips with a drawer holding
 * every filter group (severity, safety relevance, module, program, routine,
 * finding type, notification impact, declared/undeclared, side, confidence).
 *
 *   const [filters, setFilters] = useState<FilterValue>({})
 *   <FilterBar groups={groups} value={filters} onChange={setFilters} search={<SearchBar …/>} />
 *
 * Group options carry optional counts. The drawer edits a draft and applies on
 * "Show results", so screen readers are not flooded by live result changes.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { cx } from '../lib/cx.ts'
import { Button } from './Button.tsx'
import { Checkbox } from './Checkbox.tsx'
import { Sheet } from './Sheet.tsx'

export interface FilterOption {
  value: string
  label: string
  count?: number
}

export interface FilterGroup {
  id: string
  label: string
  options: FilterOption[]
}

export type FilterValue = Record<string, string[]>

export function activeFilterCount(value: FilterValue): number {
  return Object.values(value).reduce((n, v) => n + v.length, 0)
}

export interface FilterBarProps {
  groups: FilterGroup[]
  value: FilterValue
  onChange: (value: FilterValue) => void
  search?: ReactNode
  resultLabel?: ReactNode
  className?: string
}

export function FilterBar({ groups, value, onChange, search, resultLabel, className }: FilterBarProps) {
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(value)

  const chips = groups.flatMap((g) =>
    (value[g.id] ?? []).map((v) => ({ group: g, value: v, label: g.options.find((o) => o.value === v)?.label ?? v })),
  )

  const remove = (groupId: string, v: string) => onChange({ ...value, [groupId]: (value[groupId] ?? []).filter((x) => x !== v) })

  return (
    <div className={cx('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {search && <div className="min-w-0 flex-1 basis-60">{search}</div>}
        <Button variant="secondary" iconLeft={<SlidersHorizontal />} onClick={() => setOpen(true)} aria-haspopup="dialog">
          Filters
          {count > 0 && <span className="il-num ml-1 rounded-full bg-ink px-1.5 font-mono text-[0.6875rem] text-paper">{count}</span>}
        </Button>
        {resultLabel && (
          <p aria-live="polite" className="ml-auto font-mono text-xs text-ink-2">
            {resultLabel}
          </p>
        )}
      </div>
      {chips.length > 0 && (
        <ul aria-label="Active filters" className="flex min-w-0 flex-wrap gap-1.5">
          {chips.map((c) => (
            <li key={`${c.group.id}:${c.value}`} className="min-w-0">
              <button
                type="button"
                onClick={() => remove(c.group.id, c.value)}
                aria-label={`Remove filter ${c.group.label}: ${c.label}`}
                className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-ink/[0.06] pl-3 pr-2 text-xs text-ink ring-1 ring-inset ring-ink/10 hover:bg-ink/[0.1]"
              >
                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-ink-2">{c.group.label}</span>
                <span className="il-ident truncate font-medium">{c.label}</span>
                <X aria-hidden="true" className="size-3.5 shrink-0" />
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => onChange({})} className="h-7 rounded-full px-2.5 text-xs font-semibold text-ink-2 underline-offset-4 hover:text-ink hover:underline">
              Clear all
            </button>
          </li>
        </ul>
      )}
      <FilterDrawer open={open} onClose={() => setOpen(false)} groups={groups} value={value} onApply={onChange} />
    </div>
  )
}

export interface FilterDrawerProps {
  open: boolean
  onClose: () => void
  groups: FilterGroup[]
  value: FilterValue
  onApply: (value: FilterValue) => void
}

export function FilterDrawer({ open, onClose, groups, value, onApply }: FilterDrawerProps) {
  const [draft, setDraft] = useState<FilterValue>(value)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setDraft(value)
  }

  const toggle = (groupId: string, v: string, on: boolean) => {
    const current = draft[groupId] ?? []
    setDraft({ ...draft, [groupId]: on ? [...current, v] : current.filter((x) => x !== v) })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      eyebrow="Refine"
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft({})}>
            Reset
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
          >
            Show results
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {groups.map((g) => (
          <fieldset key={g.id} className="min-w-0">
            <legend className="il-label mb-2">{g.label}</legend>
            <div className="flex flex-col">
              {g.options.map((o) => (
                <Checkbox
                  key={o.value}
                  label={o.label}
                  description={o.count !== undefined ? `${o.count} in this analysis` : undefined}
                  checked={(draft[g.id] ?? []).includes(o.value)}
                  onChange={(e) => toggle(g.id, o.value, e.target.checked)}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Sheet>
  )
}
