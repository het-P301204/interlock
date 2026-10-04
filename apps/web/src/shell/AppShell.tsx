/**
 * Workspace shell for /app/*: skip link, top bar, collapsible sidebar, phone
 * bottom navigation, command palette, keyboard shortcuts and a subtle route
 * transition. Hydrates saved results from IndexedDB once.
 */
import { useEffect } from 'react'
import { Outlet, ScrollRestoration, useLocation } from 'react-router'
import { motion } from 'motion/react'
import { useIsMac } from '../lib/hooks.ts'
import { useWorkspace } from '../state/analysis.ts'
import { useUi } from '../state/ui.ts'
import { CommandMenu } from '../ui/CommandMenu.tsx'
import { Kbd } from '../ui/Kbd.tsx'
import { Modal } from '../ui/Modal.tsx'
import { Button } from '../ui/Button.tsx'
import { MobileNav } from './MobileNav.tsx'
import { Sidebar } from './Sidebar.tsx'
import { SkipLink } from './SkipLink.tsx'
import { TopBar } from './TopBar.tsx'
import { useCommands } from './useCommands.tsx'
import { useGlobalShortcuts } from './shortcuts.ts'

function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen)
  const setOpen = useUi((s) => s.setShortcutsOpen)
  const mac = useIsMac()
  const rows: Array<[string[], string]> = [
    [[mac ? '⌘' : 'Ctrl', 'K'], 'Search findings, modules, routines, tags and commands'],
    [['?'], 'Show keyboard shortcuts'],
    [['['], 'Collapse or expand the sidebar'],
    [['Esc'], 'Close a dialog, drawer or menu'],
    [['↑', '↓'], 'Move through menus and results'],
    [['←', '→'], 'Switch tabs'],
  ]
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      description="Every action in INTERLOCK is reachable from the keyboard."
      size="sm"
      footer={
        <Button variant="primary" onClick={() => setOpen(false)}>
          Done
        </Button>
      }
    >
      <dl className="flex flex-col divide-y divide-line">
        {rows.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-sm text-ink">{label}</dt>
            <dd className="flex shrink-0 gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}

export function AppShell() {
  const location = useLocation()
  const commandOpen = useUi((s) => s.commandOpen)
  const setCommandOpen = useUi((s) => s.setCommandOpen)
  const hydrate = useWorkspace((s) => s.hydrate)
  const commands = useCommands()
  useGlobalShortcuts()

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return (
    <div className="min-h-dvh bg-paper">
      <SkipLink />
      <TopBar />
      <div className="flex min-w-0">
        <Sidebar />
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto w-full max-w-page px-4 pb-28 pt-7 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
      <MobileNav />
      <ScrollRestoration />
      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} commands={commands} />
      <ShortcutsDialog />
    </div>
  )
}
