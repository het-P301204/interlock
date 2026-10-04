/**
 * Kbd — a keyboard key.
 *
 *   <Kbd>Ctrl</Kbd><Kbd>K</Kbd>      or      <KeyCombo keys={['Ctrl', 'K']} />
 */
import type { ReactNode } from 'react'
import { cx } from '../lib/cx.ts'

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border border-line-strong border-b-2 bg-surface px-1.5 font-mono text-[0.6875rem] font-medium text-ink-2',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

export function KeyCombo({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1', className)}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  )
}
