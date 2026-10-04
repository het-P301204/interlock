/**
 * CommandMenu — Ctrl/⌘+K palette following the ARIA combobox + listbox pattern.
 *
 *   <CommandMenu open={open} onClose={close} commands={[
 *     { id: 'new', group: 'Actions', label: 'Start Analysis', icon: <Play />, run: () => navigate('/app/new') },
 *     { id: 'IL-0007', group: 'Findings', label: 'IL-0007 Shutdown firing condition weakened', keywords: ['Compressor'], run: … },
 *   ]} />
 *
 * Focus stays in the input; ↑/↓ move the active option (aria-activedescendant),
 * Enter runs it, Esc closes. Matching is case-insensitive over label and
 * keywords; word-prefix matches rank first.
 */
import { useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, Search } from 'lucide-react'
import { cx } from '../lib/cx.ts'
import { Kbd } from './Kbd.tsx'
import { useFocusTrap } from './useFocusTrap.ts'

export interface Command {
  id: string
  group: string
  label: string
  keywords?: string[]
  icon?: ReactNode
  hint?: ReactNode
  disabled?: boolean
  run: () => void
}

function score(cmd: Command, q: string): number {
  if (!q) return 1
  const hay = [cmd.label, ...(cmd.keywords ?? [])].join(' ').toLowerCase()
  const needle = q.toLowerCase().trim()
  if (!needle) return 1
  const terms = needle.split(/\s+/)
  let total = 0
  for (const t of terms) {
    const at = hay.indexOf(t)
    if (at < 0) return 0
    total += at === 0 || /[\s_\-/.]/.test(hay[at - 1] ?? '') ? 3 : 1
  }
  return total
}

function Palette({ onClose, commands, placeholder }: { onClose: () => void; commands: Command[]; placeholder: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  useFocusTrap(ref, true, { onEscape: onClose, initialFocus: inputRef })

  const results = useMemo(() => {
    return commands
      .map((c, i) => ({ c, s: score(c, query), i }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, 60)
      .map((r) => r.c)
  }, [commands, query])

  const groups = useMemo(() => {
    const map = new Map<string, Command[]>()
    for (const c of results) map.set(c.group, [...(map.get(c.group) ?? []), c])
    return [...map.entries()]
  }, [results])

  const flat = groups.flatMap(([, cs]) => cs)
  const current = flat[Math.min(active, flat.length - 1)]
  const optionId = (c: Command) => `${listId}-${c.id.replace(/[^\w-]/g, '_')}`

  const run = (c: Command | undefined) => {
    if (!c || c.disabled) return
    onClose()
    c.run()
  }

  const scrollTo = (i: number) => {
    const c = flat[i]
    if (c) document.getElementById(optionId(c))?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center px-3 pt-[12vh]">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-[rgb(var(--ink-fixed)/0.34)] backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onClick={onClose}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        className="relative flex max-h-[min(34rem,76dvh)] w-full max-w-2xl flex-col overflow-hidden rounded-panel bg-surface-raised shadow-overlay ring-1 ring-line"
        initial={{ opacity: 0, y: -10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.99 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search aria-hidden="true" className="size-[18px] shrink-0 text-ink-2" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(current) : undefined}
            aria-label="Search commands, findings, modules, routines, safety functions and tags"
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                const n = flat.length ? (active + 1) % flat.length : 0
                setActive(n)
                scrollTo(n)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                const n = flat.length ? (active - 1 + flat.length) % flat.length : 0
                setActive(n)
                scrollTo(n)
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(current)
              } else if (e.key === 'Home' && e.ctrlKey) {
                setActive(0)
              }
            }}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div id={listId} role="listbox" aria-label="Results" className="il-scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
          {flat.length === 0 && (
            <p role="presentation" className="px-3 py-8 text-center text-sm text-ink-2">
              Nothing matches “{query}”. Try a finding id (IL-0007), a module, routine, tag or safety function.
            </p>
          )}
          {groups.map(([group, cs]) => (
            <div key={group} role="group" aria-labelledby={`${listId}-g-${group}`} className="mb-1">
              <div id={`${listId}-g-${group}`} role="presentation" className="il-label px-3 pb-1 pt-2.5">
                {group}
              </div>
              {cs.map((c) => {
                const isActive = c === current
                return (
                  <div
                    key={c.id}
                    id={optionId(c)}
                    role="option"
                    aria-selected={isActive}
                    aria-disabled={c.disabled || undefined}
                    onPointerMove={() => setActive(flat.indexOf(c))}
                    onClick={() => run(c)}
                    className={cx(
                      'flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm',
                      isActive ? 'bg-ink text-paper' : 'text-ink',
                      c.disabled && 'cursor-not-allowed opacity-45',
                    )}
                  >
                    {c.icon && <span className={cx('flex size-4 shrink-0 items-center justify-center [&_svg]:size-4', isActive ? 'text-paper' : 'text-ink-2')}>{c.icon}</span>}
                    <span className="il-ident min-w-0 flex-1 font-medium">{c.label}</span>
                    {c.hint && <span className={cx('shrink-0 font-mono text-[0.6875rem]', isActive ? 'text-paper/75' : 'text-ink-2')}>{c.hint}</span>}
                    {isActive && <CornerDownLeft aria-hidden="true" className="size-3.5 shrink-0 text-paper/80" />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-paper-2/50 px-5 py-2.5 font-mono text-[0.6875rem] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Enter</Kbd> open
          </span>
          <span className="ml-auto">{flat.length === 1 ? '1 result' : `${flat.length} results`}</span>
        </div>
      </motion.div>
    </div>
  )
}

export function CommandMenu({ open, onClose, commands, placeholder = 'Search or run a command…' }: { open: boolean; onClose: () => void; commands: Command[]; placeholder?: string }) {
  return createPortal(<AnimatePresence>{open && <Palette key="palette" onClose={onClose} commands={commands} placeholder={placeholder} />}</AnimatePresence>, document.body)
}
