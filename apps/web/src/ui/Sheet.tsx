/**
 * Sheet — a side drawer for filters and the evidence panel. On phones the
 * `bottom` side becomes a bottom sheet.
 *
 *   <Sheet open={open} onClose={close} side="right" title="Filters" eyebrow="Findings"
 *          footer={<Button onClick={apply}>Apply</Button>}>...</Sheet>
 *
 * Same contract as Modal: portal, focus trap, Esc, aria-modal, focus restore.
 */
import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cx } from '../lib/cx.ts'
import { IconButton } from './IconButton.tsx'
import { useFocusTrap } from './useFocusTrap.ts'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  side?: 'right' | 'left' | 'bottom'
  width?: 'md' | 'lg' | 'xl'
  children?: ReactNode
  footer?: ReactNode
}

const widths = { md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' }

function SheetPanel({ onClose, title, eyebrow, description, side = 'right', width = 'md', children, footer }: Omit<SheetProps, 'open'>) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  useFocusTrap(ref, true, { onEscape: onClose })

  const offscreen = side === 'right' ? { x: '100%' } : side === 'left' ? { x: '-100%' } : { y: '100%' }
  const position =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-panel'
      : cx('inset-y-0 w-full', widths[width], side === 'right' ? 'right-0 sm:rounded-l-panel' : 'left-0 sm:rounded-r-panel')

  return (
    <div className="fixed inset-0 z-[70]">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-[rgb(var(--ink-fixed)/0.32)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx('absolute flex flex-col bg-surface shadow-overlay outline-none ring-1 ring-line', position)}
        initial={offscreen}
        animate={{ x: 0, y: 0 }}
        exit={offscreen}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        {side === 'bottom' && <span aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong" />}
        <header className="flex items-start gap-4 border-b border-line px-5 pb-4 pt-5 sm:px-6">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="il-label mb-1.5">{eyebrow}</p>}
            <h2 id={titleId} className="il-ident text-title-3 text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-ink-2">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close panel" size="sm" onClick={onClose} tooltip={false} className="-mr-2 -mt-1">
            <X />
          </IconButton>
        </header>
        <div className="il-scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper-2/60 px-5 py-4 sm:px-6">{footer}</footer>}
      </motion.div>
    </div>
  )
}

export function Sheet(props: SheetProps) {
  return createPortal(<AnimatePresence>{props.open && <SheetPanel key="sheet" {...props} />}</AnimatePresence>, document.body)
}
