/**
 * Tabs — WAI-ARIA tabs with roving tabindex (←/→, Home/End; activation follows focus).
 *
 *   <Tabs label="Diff views" idBase="diff" value={tab} onChange={setTab}
 *         items={[{ id: 'structural', label: 'Structural', count: 17 }, { id: 'semantic', label: 'Semantic' }]} />
 *   <TabPanel idBase="diff" id="structural" active={tab === 'structural'}>...</TabPanel>
 *
 * Pass the same `idBase` to Tabs and TabPanel so the aria-controls / labelledby pair up.
 */
import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { motion } from 'motion/react'
import { cx } from '../lib/cx.ts'

export interface TabItem {
  id: string
  label: ReactNode
  count?: number
  disabled?: boolean
  /** Steps variant: the question this step answers, e.g. "WHAT CHANGED". */
  caption?: string
}

export interface TabsProps {
  label: string
  idBase: string
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  className?: string
  /** 'line' (default) underlined tabs; 'steps' a numbered progression where each tab is a step. */
  variant?: 'line' | 'steps'
}

export function Tabs({ label, idBase, items, value, onChange, className, variant = 'line' }: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = items.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0)

  const move = (e: KeyboardEvent, index: number) => {
    const pos = enabled.indexOf(index)
    let next: number | undefined
    if (e.key === 'ArrowRight') next = enabled[(pos + 1) % enabled.length]
    else if (e.key === 'ArrowLeft') next = enabled[(pos - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') next = enabled[0]
    else if (e.key === 'End') next = enabled[enabled.length - 1]
    if (next === undefined) return
    e.preventDefault()
    const item = items[next]
    if (!item) return
    onChange(item.id)
    refs.current[next]?.focus()
  }

  if (variant === 'steps') {
    const activeIndex = items.findIndex((t) => t.id === value)
    return (
      <div role="tablist" aria-label={label} className={cx('il-scroll-thin relative grid max-w-full auto-cols-[minmax(10.5rem,1fr)] grid-flow-col gap-2 overflow-x-auto overflow-y-hidden pb-1', className)}>
        {items.map((item, i) => {
          const selected = item.id === value
          const passed = i < activeIndex
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              id={`${idBase}-tab-${item.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${idBase}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange(item.id)}
              onKeyDown={(e) => move(e, i)}
              className={cx(
                'relative flex min-w-0 flex-col items-start gap-1 rounded-card px-4 py-3 text-left transition-colors duration-fast',
                selected ? 'bg-ink text-paper shadow-lift' : 'bg-surface text-ink shadow-inset-line hover:bg-surface-raised',
                'disabled:cursor-not-allowed disabled:opacity-45',
              )}
            >
              <span className="flex w-full items-center gap-2">
                <span className={cx('il-num font-mono text-[0.6875rem] font-semibold', selected ? 'text-paper/70' : passed ? 'text-ink' : 'text-ink-2')}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span aria-hidden="true" className={cx('h-px flex-1', selected ? 'bg-paper/30' : passed ? 'bg-ink' : 'bg-line-strong')} />
                {item.count !== undefined && <span className={cx('il-num font-mono text-[0.6875rem]', selected ? 'text-paper/80' : 'text-ink-2')}>{item.count}</span>}
              </span>
              {item.caption && <span className={cx('font-mono text-[0.625rem] font-medium uppercase tracking-[0.1em]', selected ? 'text-paper/75' : 'text-ink-2')}>{item.caption}</span>}
              <span className="text-[0.9375rem] font-bold">{item.label}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div role="tablist" aria-label={label} className={cx('il-scroll-thin relative flex max-w-full gap-1 overflow-x-auto overflow-y-hidden border-b border-line', className)}>
      {items.map((item, i) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            id={`${idBase}-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => move(e, i)}
            className={cx(
              'relative inline-flex h-11 shrink-0 items-center gap-2 px-3 text-sm font-semibold transition-colors duration-fast',
              selected ? 'text-ink' : 'text-ink-2 hover:text-ink',
              'disabled:cursor-not-allowed disabled:opacity-45',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cx('il-num rounded-full px-1.5 font-mono text-[0.6875rem]', selected ? 'bg-ink text-paper' : 'bg-ink/[0.07] text-ink-2')}>
                {item.count}
              </span>
            )}
            {selected && (
              <motion.span
                layoutId={`${idBase}-indicator`}
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-ink"
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ idBase, id, active, children, className }: { idBase: string; id: string; active: boolean; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} hidden={!active} tabIndex={0} className={cx('outline-none', className)}>
      {active && children}
    </div>
  )
}
