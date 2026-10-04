/**
 * Phone / tablet navigation (< 1024px): a bottom bar with the four primary
 * destinations and "More", which opens a bottom sheet with every page, the
 * Analysis actions and the theme switcher.
 */
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { Ellipsis, Plus } from 'lucide-react'
import { cx } from '../lib/cx.ts'
import { Badge } from '../ui/Badge.tsx'
import { buttonClasses } from '../ui/Button.tsx'
import { Sheet } from '../ui/Sheet.tsx'
import { APP_NAV } from './nav.ts'
import { ThemeSwitcher } from './ThemeSwitcher.tsx'

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const primary = APP_NAV.filter((n) => n.primary)
  const moreActive = !primary.some((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto grid h-16 max-w-xl grid-cols-5">
          {primary.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.to} className="min-w-0">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx('flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold', isActive ? 'text-ink' : 'text-ink-2')
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={cx('flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-ink/[0.08]')}>
                        <Icon aria-hidden="true" className="size-[19px]" strokeWidth={isActive ? 2.2 : 1.8} />
                      </span>
                      <span className="max-w-full truncate px-1">{item.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            )
          })}
          <li className="min-w-0">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className={cx('flex h-full w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold', moreActive ? 'text-ink' : 'text-ink-2')}
            >
              <span className={cx('flex h-7 w-12 items-center justify-center rounded-full', moreActive && 'bg-ink/[0.08]')}>
                <Ellipsis aria-hidden="true" className="size-[19px]" />
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={open} onClose={() => setOpen(false)} side="bottom" title="Workspace" eyebrow="Navigate">
        <div className="flex flex-col gap-5">
          <NavLink to="/app/new" onClick={() => setOpen(false)} className={buttonClasses('primary', 'md', 'w-full')}>
            <Plus />
            <span>New analysis</span>
          </NavLink>
          <ul className="grid grid-cols-2 gap-1.5">
            {APP_NAV.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.to} className="min-w-0">
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cx(
                        'flex h-12 min-w-0 items-center gap-2.5 rounded-[14px] px-3 text-sm font-semibold',
                        isActive ? 'bg-ink text-paper' : 'bg-paper-2/70 text-ink shadow-inset-line',
                      )
                    }
                  >
                    <Icon aria-hidden="true" className="size-[18px] shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {item.badge && <Badge tone="iris" className="ml-auto h-5 px-1.5 text-[0.5625rem]">
                        <span aria-hidden="true">Exp.</span>
                        <span className="sr-only">Experimental</span>
                      </Badge>}
                  </NavLink>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <span className="il-label">Theme</span>
            <ThemeSwitcher />
          </div>
        </div>
      </Sheet>
    </>
  )
}
