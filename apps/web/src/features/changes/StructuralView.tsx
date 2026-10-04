/**
 * Structural view: every change, grouped by category, virtualized against the
 * window scroll so 400+ documentation edits stay fast. Category chips filter;
 * search matches id, summary, entity and values.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { AnalysisResult, Change, ChangeCategory } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { matchesQuery } from '../../lib/useUrlFilters.ts'
import { SearchBar } from '../../ui/SearchBar.tsx'
import { EmptyState } from '../../ui/States.tsx'
import { CATEGORY_HINT, CATEGORY_LABEL, CATEGORY_ORDER, ChangeRow } from './ChangeRow.tsx'

type Item = { kind: 'header'; category: ChangeCategory; count: number } | { kind: 'change'; change: Change; first: boolean; last: boolean }

export function StructuralView({
  result,
  categories,
  onCategories,
  query,
  onQuery,
}: {
  result: AnalysisResult
  categories: string[]
  onCategories: (c: string[]) => void
  query: string
  onQuery: (q: string) => void
}) {
  const counts = result.surface.byCategory
  const items = useMemo(() => {
    const out: Item[] = []
    for (const cat of CATEGORY_ORDER) {
      if (categories.length && !categories.includes(cat)) continue
      const list = result.changes.filter((c) => c.category === cat && matchesQuery(query, c.id, c.summary, c.entity.name, c.entity.container, c.before, c.after, c.field))
      if (!list.length) continue
      out.push({ kind: 'header', category: cat, count: list.length })
      list.forEach((change, i) => out.push({ kind: 'change', change, first: i === 0, last: i === list.length - 1 }))
    }
    return out
  }, [result, categories, query])

  const listRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const update = () => setOffset(el.getBoundingClientRect().top + window.scrollY)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [])

  const v = useWindowVirtualizer({
    count: items.length,
    estimateSize: (i) => (items[i]?.kind === 'header' ? 60 : 78),
    overscan: 8,
    scrollMargin: offset,
  })

  const toggle = (cat: string) => onCategories(categories.includes(cat) ? categories.filter((c) => c !== cat) : [...categories, cat])
  const shownCount = items.filter((i) => i.kind === 'change').length

  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
        {CATEGORY_ORDER.map((cat) => {
          const n = counts[cat] ?? 0
          const on = categories.includes(cat)
          return (
            <button
              key={cat}
              type="button"
              aria-pressed={on}
              disabled={n === 0}
              onClick={() => toggle(cat)}
              title={CATEGORY_HINT[cat]}
              className={cx(
                'inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[0.8125rem] font-semibold transition-colors duration-fast disabled:cursor-default disabled:opacity-40',
                on ? 'bg-ink text-paper' : 'bg-surface text-ink shadow-inset-line hover:bg-surface-raised',
              )}
            >
              {CATEGORY_LABEL[cat]}
              <span className={cx('il-num font-mono text-xs', on ? 'text-paper/80' : 'text-ink-2')}>{n}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar label="Search changes" value={query} onChange={onQuery} placeholder="CH-0005, routine, tag, value…" className="min-w-0 flex-1 basis-64" />
        <p aria-live="polite" className="font-mono text-xs text-ink-2">
          {shownCount} of {result.changes.length} changes
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState eyebrow="Filtered" title="No changes match." body="Clear the search or select other categories." />
      ) : (
        <div ref={listRef} className="relative w-full" style={{ height: v.getTotalSize() }} role="list" aria-label="Changes by category">
          {v.getVirtualItems().map((row) => {
            const item = items[row.index]!
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={v.measureElement}
                role="listitem"
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${row.start - v.options.scrollMargin}px)` }}
              >
                {item.kind === 'header' ? (
                  <div className="flex items-end justify-between gap-3 px-1 pb-2 pt-5">
                    <h3 className="flex items-baseline gap-2.5">
                      <span className="text-title-3 text-ink">{CATEGORY_LABEL[item.category]}</span>
                      <span className="il-num font-mono text-xs text-ink-2">{item.count}</span>
                    </h3>
                    <span className="hidden font-mono text-[0.6875rem] text-ink-2 sm:inline">{CATEGORY_HINT[item.category]}</span>
                  </div>
                ) : (
                  <ChangeRow
                    change={item.change}
                    className={cx('border-x border-t border-line bg-surface', item.first && 'rounded-t-card', item.last && 'mb-1 rounded-b-card border-b')}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
