/**
 * UI preferences: theme (light / dark / system) and sidebar collapse.
 * The resolved theme is written to <html data-theme>; public/theme-init.js
 * applies the same rule before first paint.
 */
import { create } from 'zustand'
import { lsGet, lsSet } from './persist.ts'

export type ThemePref = 'light' | 'dark' | 'system'

const THEME_KEY = 'interlock.theme'
const SIDEBAR_KEY = 'interlock.sidebar'

function readTheme(): ThemePref {
  const v = lsGet(THEME_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function applyTheme(pref: ThemePref): 'light' | 'dark' {
  const resolved = pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref
  document.documentElement.setAttribute('data-theme', resolved)
  // Keep the browser chrome color in step with an explicit choice.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const forMedia = m.media.includes('dark') ? '#151617' : '#F5F1E8'
    m.content = pref === 'system' ? forMedia : resolved === 'dark' ? '#151617' : '#F5F1E8'
  })
  return resolved
}

interface UiState {
  theme: ThemePref
  resolvedTheme: 'light' | 'dark'
  sidebarCollapsed: boolean
  commandOpen: boolean
  shortcutsOpen: boolean
  setTheme: (t: ThemePref) => void
  toggleSidebar: () => void
  setCommandOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
}

const initialTheme = readTheme()

export const useUi = create<UiState>((set) => ({
  theme: initialTheme,
  resolvedTheme: typeof document !== 'undefined' ? applyTheme(initialTheme) : 'light',
  sidebarCollapsed: lsGet(SIDEBAR_KEY) === 'collapsed',
  commandOpen: false,
  shortcutsOpen: false,
  setTheme: (theme) => {
    lsSet(THEME_KEY, theme)
    set({ theme, resolvedTheme: applyTheme(theme) })
  },
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed
      lsSet(SIDEBAR_KEY, next ? 'collapsed' : 'expanded')
      return { sidebarCollapsed: next }
    }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
}))

/** Follow OS theme changes while the preference is "system". */
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = useUi.getState()
    if (theme === 'system') useUi.setState({ resolvedTheme: applyTheme('system') })
  })
}
