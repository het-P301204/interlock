/** Display formatting helpers. Pure functions; no locale-dependent surprises. */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/** "3f9a12c4…e07b" — keeps both ends so two hashes can be told apart at a glance. */
export function shortHash(hash: string, head = 10, tail = 6): string {
  if (hash.length <= head + tail + 1) return hash
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`
}

/** "READY_WITH_WARNINGS" -> "READY WITH WARNINGS". */
export function enumLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

/** ISO timestamp -> "04 Oct 2026, 14:12" in the viewer's zone. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}
