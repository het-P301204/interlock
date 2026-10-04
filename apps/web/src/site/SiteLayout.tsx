/**
 * Layout for the public pages (landing, how it works, security, privacy, 404):
 * slim header, content, footer exactly per spec.
 */
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { ArrowUpRight, Menu as MenuIcon, X } from 'lucide-react'
import { cx } from '../lib/cx.ts'
import { useGlobalShortcuts } from '../shell/shortcuts.ts'
import { GITHUB_URL } from '../shell/nav.ts'
import { SkipLink } from '../shell/SkipLink.tsx'
import { CommandMenu } from '../ui/CommandMenu.tsx'
import { useCommands } from '../shell/useCommands.tsx'
import { useUi } from '../state/ui.ts'
import { ButtonLink } from '../ui/Button.tsx'
import { Wordmark } from '../ui/Mark.tsx'
import { SiteFooter } from './SiteFooter.tsx'

const LINKS = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/security', label: 'Security' },
  { to: '/privacy', label: 'Privacy' },
]

function SiteHeader() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={cx('sticky top-0 z-40 transition-[background-color,border-color] duration-base', scrolled || open ? 'border-b border-line bg-paper/90 backdrop-blur-md' : 'border-b border-transparent')}>
      <div className="mx-auto flex h-16 max-w-page items-center gap-6 px-4 sm:px-6 lg:px-10">
        <Link to="/" aria-label="INTERLOCK home" className="rounded-[10px]">
          <Wordmark />
        </Link>
        <nav aria-label="Site" className="ml-auto hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => cx('rounded-[10px] px-3 py-2 text-sm font-semibold transition-colors', isActive ? 'text-ink' : 'text-ink-2 hover:text-ink')}
            >
              {l.label}
            </NavLink>
          ))}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-[10px] px-3 py-2 text-sm font-semibold text-ink-2 hover:text-ink">
            GitHub
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <ButtonLink to="/app" variant="primary" size="sm" className="ml-2">
            Open workstation
          </ButtonLink>
        </nav>
        <button
          type="button"
          className="ml-auto inline-flex size-10 items-center justify-center rounded-control text-ink md:hidden"
          aria-expanded={open}
          aria-controls="site-mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-5" /> : <MenuIcon className="size-5" />}
        </button>
      </div>
      <nav id="site-mobile-nav" aria-label="Site" hidden={!open} className="border-t border-line px-4 pb-5 pt-2 md:hidden">
        <ul className="flex flex-col">
          {LINKS.map((l) => (
            <li key={l.to}>
              <NavLink to={l.to} className="flex h-12 items-center border-b border-line text-[0.9375rem] font-semibold text-ink">
                {l.label}
              </NavLink>
            </li>
          ))}
          <li>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="flex h-12 items-center gap-1 border-b border-line text-[0.9375rem] font-semibold text-ink">
              GitHub <ArrowUpRight aria-hidden="true" className="size-4" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        </ul>
        <ButtonLink to="/app" variant="primary" className="mt-4 w-full">
          Open workstation
        </ButtonLink>
      </nav>
    </header>
  )
}

export function SiteLayout() {
  const commandOpen = useUi((s) => s.commandOpen)
  const setCommandOpen = useUi((s) => s.setCommandOpen)
  const commands = useCommands()
  useGlobalShortcuts()
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SkipLink />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <SiteFooter />
      <ScrollRestoration />
      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} commands={commands} />
    </div>
  )
}
