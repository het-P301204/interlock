/** Global keyboard shortcuts: Ctrl/Cmd+K command menu, ? shortcuts, [ sidebar. */
import { useEffect } from 'react'
import { useUi } from '../state/ui.ts'

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

export function useGlobalShortcuts(): void {
  const setCommandOpen = useUi((s) => s.setCommandOpen)
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen)
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen(!useUi.getState().commandOpen)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (document.querySelector('[aria-modal="true"]')) return
      if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen(true)
      } else if (e.key === '[') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setCommandOpen, setShortcutsOpen, toggleSidebar])
}
