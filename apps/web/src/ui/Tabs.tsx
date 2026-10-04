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
}

export interface TabsProps {
  label: string
  idBase: string
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  className?: string
}

export function Tabs({ label, idBase, items, value, onChange, className }: TabsProps) {
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

  return (
    <div role="tablist" aria-label={label} className={cx('il-scroll-thin relative flex max-w-full gap-1 overflow-x-auto border-b border-line', className)}>
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
