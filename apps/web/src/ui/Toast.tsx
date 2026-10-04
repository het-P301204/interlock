/**
 * Toast — transient confirmations in an aria-live region.
 *
 *   import { toast } from '../ui/Toast.tsx'
 *   toast({ title: 'SHA-256 copied', tone: 'neutral' })
 *   toast({ title: 'Analysis could not be completed.', body: reason, tone: 'error' })
 *   <Toaster />   (mounted once at the app root)
 *
 * Errors use an assertive region and stay until dismissed; everything else is
 * polite and dismisses after 5 s (paused while hovered or focused).
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { create } from 'zustand'
import { cx } from '../lib/cx.ts'
import { Glyph } from './Badge.tsx'

export type ToastTone = 'neutral' | 'success' | 'error'

export interface ToastItem {
  id: number
  title: string
  body?: ReactNode
  tone: ToastTone
}

interface ToastStore {
  items: ToastItem[]
  push: (t: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
}

let nextId = 1

const useToasts = create<ToastStore>((set) => ({
  items: [],
  push: (t) => set((s) => ({ items: [...s.items.slice(-3), { ...t, id: nextId++ }] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}))

export function toast(t: { title: string; body?: ReactNode; tone?: ToastTone }): void {
  useToasts.getState().push({ tone: 'neutral', ...t })
}

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss)
  const [paused, setPaused] = useState(false)
  const remaining = useRef(5000)

  useEffect(() => {
    if (item.tone === 'error' || paused) return
    const started = performance.now()
    const t = window.setTimeout(() => dismiss(item.id), remaining.current)
    return () => {
      window.clearTimeout(t)
      remaining.current = Math.max(1200, remaining.current - (performance.now() - started))
    }
  }, [item.id, item.tone, paused, dismiss])

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-card bg-inverse p-4 text-inverse-ink shadow-overlay sm:w-[22rem]"
    >
      <Glyph
        shape={item.tone === 'error' ? 'octagon' : item.tone === 'success' ? 'check' : 'square'}
        className={cx('mt-1', item.tone === 'error' ? 'fill-coral' : item.tone === 'success' ? 'text-sage' : 'fill-iris')}
      />
      <div className="min-w-0 flex-1">
        <p className="il-ident text-sm font-semibold">{item.title}</p>
        {item.body && <div className="il-ident mt-0.5 text-[0.8125rem] text-inverse-2">{item.body}</div>}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismiss(item.id)}
        className="-mr-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] text-inverse-2 hover:bg-inverse-ink/10 hover:text-inverse-ink focus-visible:outline-inverse-ink"
      >
        <X className="size-4" />
      </button>
    </motion.li>
  )
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  const polite = items.filter((i) => i.tone !== 'error')
  const assertive = items.filter((i) => i.tone === 'error')
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[90] flex flex-col items-end gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 lg:bottom-6">
      <ol aria-live="assertive" aria-relevant="additions" className="flex w-full flex-col items-end gap-2">
        <AnimatePresence initial={false}>
          {assertive.map((i) => (
            <ToastCard key={i.id} item={i} />
          ))}
        </AnimatePresence>
      </ol>
      <ol aria-live="polite" aria-relevant="additions" className="flex w-full flex-col items-end gap-2">
        <AnimatePresence initial={false}>
          {polite.map((i) => (
            <ToastCard key={i.id} item={i} />
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}
