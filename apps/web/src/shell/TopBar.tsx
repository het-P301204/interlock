/**
 * Workspace top bar: mark, current analysis, search / command trigger,
 * Analysis / Help / Workspace menus and the LOCAL analysis-mode indicator.
 * There are no accounts: the workspace menu offers only local settings.
 */
import { Link, useNavigate } from 'react-router'
import { BookOpen, FileDown, FlaskConical, Keyboard, Laptop, Monitor, Moon, Plus, Search, ShieldQuestion, Square, Sun, Trash2 } from 'lucide-react'
import { useIsMac } from '../lib/hooks.ts'
import { useWorkspace } from '../state/analysis.ts'
import { useUi } from '../state/ui.ts'
import { StatusPill } from '../ui/Badge.tsx'
import { KeyCombo } from '../ui/Kbd.tsx'
import { Mark } from '../ui/Mark.tsx'
import { Menu } from '../ui/Menu.tsx'
import { LocalModeIndicator } from './LocalModeIndicator.tsx'

export function TopBar() {
  const navigate = useNavigate()
  const mac = useIsMac()
  const result = useWorkspace((s) => s.result)
  const running = useWorkspace((s) => s.run.status === 'running')
  const cancel = useWorkspace((s) => s.cancelAnalysis)
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const openCommand = useUi((s) => s.setCommandOpen)
  const openShortcuts = useUi((s) => s.setShortcutsOpen)

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-line bg-paper/90 backdrop-blur-md supports-[backdrop-filter]:bg-paper/80">
      <div className="flex h-full min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-5">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-[10px] pr-1 text-ink" aria-label="INTERLOCK home">
          <Mark className="size-7" />
          <span className="hidden text-[0.9375rem] font-extrabold tracking-[0.16em] sm:inline">INTERLOCK</span>
        </Link>

        <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line md:block" />

        <div className="hidden min-w-0 flex-1 items-center gap-2.5 md:flex">
          {result ? (
            <>
              <p className="il-ident min-w-0 truncate font-mono text-xs text-ink-2">
                <span className="sr-only">Current analysis: </span>
                <span className="text-ink">{result.baseline.file.name}</span>
                <span aria-hidden="true" className="px-1.5 text-ink-3">
                  →
                </span>
                <span className="sr-only"> compared with </span>
                <span className="text-ink">{result.current.file.name}</span>
              </p>
              <StatusPill status={result.trust.status} className="hidden xl:inline-flex" />
            </>
          ) : (
            <p className="font-mono text-xs text-ink-2">{running ? 'Analysis running…' : 'No analysis loaded'}</p>
          )}
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={() => openCommand(true)}
            className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-line bg-surface pl-2.5 pr-2 text-sm text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
            aria-label="Search and commands"
            aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
          >
            <Search aria-hidden="true" className="size-4" />
            <span className="hidden lg:inline">Search</span>
            <KeyCombo keys={[mac ? '⌘' : 'Ctrl', 'K']} className="ml-3 hidden lg:inline-flex" />
          </button>

          <div className="hidden sm:block">
            <Menu
              label="Analysis"
              items={[
                { kind: 'item', label: 'New analysis', icon: <Plus />, onSelect: () => navigate('/app/new') },
                { kind: 'item', label: 'Load demo scenario', icon: <FlaskConical />, onSelect: () => navigate('/app/demo') },
                { kind: 'item', label: 'Export report', icon: <FileDown />, onSelect: () => navigate('/app/reports'), disabled: !result, description: result ? undefined : 'Run an analysis first' },
                { kind: 'separator' },
                { kind: 'item', label: 'Cancel running analysis', icon: <Square />, onSelect: cancel, disabled: !running },
              ]}
            />
          </div>
          <div className="hidden md:block">
            <Menu
              label="Help"
              items={[
                { kind: 'item', label: 'How INTERLOCK works', icon: <BookOpen />, onSelect: () => navigate('/how-it-works') },
                { kind: 'item', label: 'Keyboard shortcuts', icon: <Keyboard />, onSelect: () => openShortcuts(true) },
                { kind: 'separator' },
                { kind: 'item', label: 'Security model', icon: <ShieldQuestion />, onSelect: () => navigate('/security') },
                { kind: 'item', label: 'Privacy', icon: <Laptop />, onSelect: () => navigate('/privacy') },
              ]}
            />
          </div>

          <LocalModeIndicator variant="compact" className="2xl:hidden" />
          <LocalModeIndicator className="hidden 2xl:inline-flex" />

          <Menu
            label="Workspace"
            ariaLabel="Workspace settings"
            align="end"
            chevron={false}
            triggerClassName="w-9 justify-center px-0"
            trigger={<Laptop aria-hidden="true" className="size-[18px]" />}
            items={[
              { kind: 'heading', label: 'This browser · no account' },
              { kind: 'radio', label: 'Light', icon: <Sun />, checked: theme === 'light', onSelect: () => setTheme('light') },
              { kind: 'radio', label: 'Dark', icon: <Moon />, checked: theme === 'dark', onSelect: () => setTheme('dark') },
              { kind: 'radio', label: 'System', icon: <Monitor />, checked: theme === 'system', onSelect: () => setTheme('system') },
              { kind: 'separator' },
              { kind: 'item', label: 'Local data and settings', icon: <Trash2 />, onSelect: () => navigate('/app/settings') },
            ]}
          />
        </div>
      </div>
    </header>
  )
}
