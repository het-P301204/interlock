/**
 * Menu — a button that opens a WAI-ARIA menu (↑/↓, Home/End, Esc, type-ahead).
 *
 *   <Menu label="Analysis" items={[
 *     { kind: 'item', label: 'New analysis', icon: <Plus />, onSelect: () => navigate('/app/new') },
 *     { kind: 'separator' },
 *     { kind: 'heading', label: 'Theme' },
 *     { kind: 'radio', label: 'Dark', checked: theme === 'dark', onSelect: () => setTheme('dark') },
 *   ]} />
 *
 * `trigger` replaces the default button content; `align` positions the popover.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from '../lib/cx.ts'

export type MenuEntry =
  | { kind: 'item'; label: string; icon?: ReactNode; hint?: ReactNode; onSelect: () => void; disabled?: boolean; description?: string }
  | { kind: 'radio'; label: string; icon?: ReactNode; checked: boolean; onSelect: () => void }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }

export interface MenuProps {
  label: string
  items: MenuEntry[]
  trigger?: ReactNode
  triggerClassName?: string
  align?: 'start' | 'end'
  /** Accessible name when the trigger shows only an icon. */
  ariaLabel?: string
  chevron?: boolean
}

export function Menu({ label, items, trigger, triggerClassName, align = 'start', ariaLabel, chevron = true }: MenuProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const actionable = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])

  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => actionable()[0]?.focus())
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }

  const onMenuKey = (e: KeyboardEvent) => {
    const list = actionable()
    const idx = list.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      list[(idx + 1) % list.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      list[(idx - 1 + list.length) % list.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      list[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      list[list.length - 1]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') {
      close(false)
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase()
      const start = idx + 1
      const order = [...list.slice(start), ...list.slice(0, start)]
      order.find((el) => el.textContent?.trim().toLowerCase().startsWith(ch))?.focus()
    }
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={cx(
          'inline-flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-sm font-semibold text-ink-2 transition-colors duration-fast hover:bg-ink/[0.06] hover:text-ink aria-expanded:bg-ink/[0.06] aria-expanded:text-ink',
          triggerClassName,
        )}
      >
        {trigger ?? label}
        {chevron && <ChevronDown aria-hidden="true" className={cx('size-3.5 transition-transform duration-fast', open && 'rotate-180')} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            id={id}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, transition: { duration: 0.1 } }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={cx(
              'absolute top-full z-[60] mt-2 w-64 origin-top rounded-card bg-surface-raised p-1.5 shadow-overlay ring-1 ring-line',
              align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left',
            )}
          >
            {items.map((item, i) => {
              if (item.kind === 'separator') return <div key={i} role="separator" className="my-1.5 h-px bg-line" />
              if (item.kind === 'heading')
                return (
                  <div key={i} role="presentation" className="il-label px-3 pb-1 pt-2">
                    {item.label}
                  </div>
                )
              const isRadio = item.kind === 'radio'
              const disabled = item.kind === 'item' && item.disabled
              return (
                <button
                  key={i}
                  type="button"
                  role={isRadio ? 'menuitemradio' : 'menuitem'}
                  aria-checked={isRadio ? item.checked : undefined}
                  aria-disabled={disabled || undefined}
                  tabIndex={-1}
                  onClick={() => {
                    if (disabled) return
                    item.onSelect()
                    close()
                  }}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-sm text-ink outline-none transition-colors duration-fast',
                    'hover:bg-ink/[0.06] focus-visible:bg-ink/[0.07] focus-visible:outline-none',
                    disabled && 'cursor-not-allowed opacity-45',
                  )}
                >
                  {item.icon && <span className="flex size-4 shrink-0 items-center justify-center text-ink-2 [&_svg]:size-4">{item.icon}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{item.label}</span>
                    {item.kind === 'item' && item.description && <span className="block text-xs text-ink-2">{item.description}</span>}
                  </span>
                  {item.kind === 'item' && item.hint}
                  {isRadio && item.checked && <Check aria-hidden="true" className="size-4 text-ink" />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
