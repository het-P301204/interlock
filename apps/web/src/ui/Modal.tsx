/**
 * Modal — centered dialog with focus trap, Esc to close, aria-modal.
 *
 *   <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts"
 *          description="Every action is reachable from the keyboard."
 *          footer={<Button onClick={close}>Done</Button>}>
 *     ...
 *   </Modal>
 *
 * Rendered in a portal. Clicking the scrim closes it unless `dismissible` is
 * false. Focus returns to the trigger on close.
 */
import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cx } from '../lib/cx.ts'
import { IconButton } from './IconButton.tsx'
import { useFocusTrap } from './useFocusTrap.ts'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  dismissible?: boolean
}

const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }

function ModalPanel({ onClose, title, description, eyebrow, children, footer, size = 'md', dismissible = true }: Omit<ModalProps, 'open'>) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  useFocusTrap(ref, true, { onEscape: dismissible ? onClose : undefined })

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-[rgb(var(--ink-fixed)/0.38)] backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={dismissible ? onClose : undefined}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-panel bg-surface shadow-overlay outline-none ring-1 ring-line',
          widths[size],
        )}
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      >
        <header className="flex items-start gap-4 border-b border-line px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="il-label mb-1.5">{eyebrow}</p>}
            <h2 id={titleId} className="text-title-3 text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-ink-2">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <IconButton label="Close dialog" size="sm" onClick={onClose} tooltip={false} className="-mr-2 -mt-1">
              <X />
            </IconButton>
          )}
        </header>
        <div className="il-scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper-2/60 px-6 py-4">{footer}</footer>}
      </motion.div>
    </div>
  )
}

export function Modal(props: ModalProps) {
  return createPortal(<AnimatePresence>{props.open && <ModalPanel key="modal" {...props} />}</AnimatePresence>, document.body)
}
