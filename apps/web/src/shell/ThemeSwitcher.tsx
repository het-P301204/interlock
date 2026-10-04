/**
 * Theme switcher — a three-way radio group (Light / Dark / System).
 *
 *   <ThemeSwitcher />            segmented control
 */
import { Monitor, Moon, Sun } from 'lucide-react'
import { useId } from 'react'
import { cx } from '../lib/cx.ts'
import { useUi } from '../state/ui.ts'
import type { ThemePref } from '../state/ui.ts'

const OPTIONS: Array<{ value: ThemePref; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function ThemeSwitcher({ className, showLabels = true }: { className?: string; showLabels?: boolean }) {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const name = useId()
  return (
    <fieldset className={cx('min-w-0', className)}>
      <legend className="sr-only">Theme</legend>
      <div className="inline-flex rounded-[14px] bg-paper-2 p-1 shadow-inset-line">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cx(
              'relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[10px] px-2.5 text-[0.8125rem] font-semibold transition-colors duration-fast',
              'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
              theme === value ? 'bg-surface-raised text-ink shadow-soft' : 'text-ink-2 hover:text-ink',
            )}
          >
            <input type="radio" name={name} value={value} checked={theme === value} onChange={() => setTheme(value)} className="sr-only" />
            <Icon aria-hidden="true" className="size-4" />
            <span className={showLabels ? undefined : 'sr-only'}>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
