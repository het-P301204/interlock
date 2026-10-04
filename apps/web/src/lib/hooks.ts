import { useEffect, useState, useSyncExternalStore } from 'react'

/** Subscribes to a CSS media query. SSR-safe default is `false`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

/** True on platforms where the command key is ⌘. */
export function useIsMac(): boolean {
  const [mac, setMac] = useState(false)
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
  }, [])
  return mac
}

/** Sets document.title for a page, restoring nothing (each page sets its own). */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · INTERLOCK` : 'INTERLOCK — PLC Safety Logic Integrity Analyzer'
  }, [title])
}
