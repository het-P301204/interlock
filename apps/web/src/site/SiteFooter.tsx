/**
 * Footer, per spec: INTERLOCK / PLC Safety Logic Integrity & Impact Analyzer /
 * Defensive analysis only. No live-controller interaction. /
 * Documentation · GitHub · Security · Privacy.
 */
import { Link } from 'react-router'
import { Mark } from '../ui/Mark.tsx'
import { GITHUB_URL } from '../shell/nav.ts'

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper-2/60">
      <div className="mx-auto flex max-w-page flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-10">
        <div className="flex items-start gap-4">
          <Mark className="mt-0.5 size-9 text-ink" />
          <div>
            <p className="text-[0.9375rem] font-extrabold tracking-[0.16em] text-ink">INTERLOCK</p>
            <p className="mt-1 text-sm text-ink-2">PLC Safety Logic Integrity &amp; Impact Analyzer</p>
            <p className="mt-3 font-mono text-xs text-ink-2">Defensive analysis only. No live-controller interaction.</p>
          </div>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center gap-x-1 text-sm font-semibold text-ink">
            <li>
              <Link to="/how-it-works" className="rounded-[8px] px-2 py-1 hover:underline hover:underline-offset-4">
                Documentation
              </Link>
            </li>
            <li aria-hidden="true" className="text-ink-3">
              ·
            </li>
            <li>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="rounded-[8px] px-2 py-1 hover:underline hover:underline-offset-4">
                GitHub<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
            <li aria-hidden="true" className="text-ink-3">
              ·
            </li>
            <li>
              <Link to="/security" className="rounded-[8px] px-2 py-1 hover:underline hover:underline-offset-4">
                Security
              </Link>
            </li>
            <li aria-hidden="true" className="text-ink-3">
              ·
            </li>
            <li>
              <Link to="/privacy" className="rounded-[8px] px-2 py-1 hover:underline hover:underline-offset-4">
                Privacy
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  )
}
