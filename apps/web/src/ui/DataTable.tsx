/**
 * DataTable — sortable table that collapses to stacked cards under 640px.
 *
 *   <DataTable
 *     caption="Findings"
 *     rows={findings}
 *     rowKey={(f) => f.id}
 *     onRowClick={(f) => navigate(`/app/findings/${f.id}`)}
 *     initialSort={{ key: 'rank', dir: 'asc' }}
 *     columns={[
 *       { key: 'id', header: 'ID', cell: (f) => f.id, sortValue: (f) => f.id, mono: true },
 *       { key: 'sev', header: 'Severity', cell: (f) => <SeverityBadge severity={f.severity} />, sortValue: (f) => SEVERITY_ORDER.indexOf(f.severity) },
 *       { key: 'title', header: 'Finding', cell: (f) => f.title, primary: true },
 *     ]}
 *   />
 *
 * Sort state is announced through aria-sort on the header. Row activation is
 * a real link/button in the primary cell (not a clickable <tr>), so it works
 * with keyboard and screen readers.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cx } from '../lib/cx.ts'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  sortValue?: (row: T) => string | number
  align?: 'left' | 'right'
  mono?: boolean
  /** The cell that names the row: rendered as the card title on phones and as the activation target. */
  primary?: boolean
  className?: string
  /** Hide on the stacked phone layout. */
  hideOnMobile?: boolean
}

export interface DataTableProps<T> {
  caption: string
  captionVisible?: boolean
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  rowLabel?: (row: T) => string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  empty?: ReactNode
  className?: string
}

export function DataTable<T>({ caption, captionVisible = false, columns, rows, rowKey, onRowClick, rowLabel, initialSort, empty, className }: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
  }, [rows, columns, sort])

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  if (rows.length === 0 && empty) return <>{empty}</>

  const primary = columns.find((c) => c.primary) ?? columns[0]

  const activator = (row: T, content: ReactNode) =>
    onRowClick ? (
      <button
        type="button"
        onClick={() => onRowClick(row)}
        aria-label={rowLabel?.(row)}
        className="il-ident text-left font-semibold text-ink underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
      >
        {content}
      </button>
    ) : (
      content
    )

  return (
    <div className={cx('min-w-0', className)}>
      {/* Desktop / tablet */}
      <div className="relative hidden overflow-x-auto rounded-card bg-surface shadow-inset-line sm:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className={captionVisible ? 'px-5 pb-2 pt-4 text-left text-title-3' : 'sr-only'}>{caption}</caption>
          <thead>
            <tr className="border-b border-line">
              {columns.map((col) => {
                const active = sort?.key === col.key
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : col.sortValue ? 'none' : undefined}
                    className={cx('h-11 whitespace-nowrap px-4 first:pl-5 last:pr-5', col.align === 'right' && 'text-right')}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggle(col.key)}
                        className={cx('il-label inline-flex items-center gap-1.5 rounded-[6px] hover:text-ink', active && 'text-ink')}
                      >
                        {col.header}
                        {active ? (
                          sort.dir === 'asc' ? <ArrowUp aria-hidden="true" className="size-3.5" /> : <ArrowDown aria-hidden="true" className="size-3.5" />
                        ) : (
                          <ArrowUpDown aria-hidden="true" className="size-3.5 opacity-50" />
                        )}
                      </button>
                    ) : (
                      <span className="il-label">{col.header}</span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={rowKey(row)}
                className={cx('relative border-b border-line last:border-b-0', onRowClick && 'transition-colors duration-fast hover:bg-paper-2/70 focus-within:bg-paper-2/70')}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cx(
                      'min-w-0 px-4 py-3 align-middle first:pl-5 last:pr-5',
                      col.align === 'right' && 'text-right',
                      col.mono && 'font-mono text-data',
                      col.className,
                    )}
                  >
                    {col === primary ? activator(row, col.cell(row)) : col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: stacked cards */}
      <ul aria-label={caption} className="flex flex-col gap-2.5 sm:hidden">
        {sorted.map((row) => (
          <li key={rowKey(row)} className="relative min-w-0 rounded-card bg-surface p-4 shadow-inset-line focus-within:ring-2 focus-within:ring-focus">
            {primary && <div className="mb-3 min-w-0 text-[0.9375rem]">{activator(row, primary.cell(row))}</div>}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
              {columns
                .filter((c) => c !== primary && !c.hideOnMobile)
                .map((col) => (
                  <div key={col.key} className="contents">
                    <dt className="il-label pt-0.5">{col.header}</dt>
                    <dd className={cx('min-w-0 text-sm', col.mono && 'il-ident font-mono text-data')}>{col.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}
