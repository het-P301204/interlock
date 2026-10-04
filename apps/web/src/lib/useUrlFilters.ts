/**
 * Filter state kept in the URL query string, so a filtered view can be
 * bookmarked, shared within the team, and restored with Back.
 *
 *   const { filters, setFilters, query, setQuery } = useUrlFilters(['severity', 'module'])
 *   // ?severity=CRITICAL&severity=HIGH&q=pump
 */
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { FilterValue } from '../ui/FilterBar.tsx'

export function useUrlFilters(keys: readonly string[]) {
  const [params, setParams] = useSearchParams()
  const keyList = keys.join('|')

  const filters = useMemo(() => {
    const out: FilterValue = {}
    for (const k of keyList.split('|')) {
      const v = params.getAll(k).filter(Boolean)
      if (v.length) out[k] = v
    }
    return out
  }, [params, keyList])

  const query = params.get('q') ?? ''

  const setFilters = useCallback(
    (next: FilterValue) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          for (const k of keyList.split('|')) p.delete(k)
          for (const [k, vs] of Object.entries(next)) for (const v of vs) p.append(k, v)
          return p
        },
        { replace: true },
      )
    },
    [setParams, keyList],
  )

  const setQuery = useCallback(
    (q: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (q) p.set('q', q)
          else p.delete('q')
          return p
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return { filters, setFilters, query, setQuery, params, setParams }
}

/** Case-insensitive match of a query against any of the given strings. */
export function matchesQuery(q: string, ...fields: Array<string | undefined>): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = fields.filter(Boolean).join(' ').toLowerCase()
  return needle.split(/\s+/).every((t) => hay.includes(t))
}
