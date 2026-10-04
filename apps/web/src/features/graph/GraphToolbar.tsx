/**
 * Toolbar pieces and the legend for the Reuse Graph page. These do not import
 * React Flow, so they render immediately while the canvas chunk loads.
 *
 * Toggles are real buttons with aria-pressed; the pressed state is drawn as a
 * filled indicator square plus inverted fill, not by colour alone.
 */
import type { ReactNode } from 'react'
import type { GraphEdgeType } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { Glyph, SEVERITY_META } from '../../ui/Badge.tsx'
import { Tooltip } from '../../ui/Tooltip.tsx'
import { EDGE_TYPE_DESCRIPTION, NODE_TYPE_LABEL, NODE_TYPE_ORDER } from './graphModel.ts'
import type { EdgeFamily } from './graphModel.ts'
import { ChangeMarker, TypeIcon } from './nodeVisual.tsx'

export function ToolToggle({ pressed, onClick, children, count, disabled, hint }: { pressed: boolean; onClick: () => void; children: ReactNode; count?: number; disabled?: boolean; hint?: string }) {
  const btn = (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[12px] px-3 text-[0.8125rem] font-semibold transition-[background-color,color,box-shadow] duration-fast ease-out-quart',
        'disabled:cursor-not-allowed disabled:opacity-45',
        pressed ? 'bg-ink text-paper shadow-soft' : 'bg-surface text-ink shadow-inset-line hover:bg-surface-raised',
      )}
    >
      <span aria-hidden="true" className={cx('size-2.5 rounded-[3px] border', pressed ? 'border-paper bg-paper' : 'border-ink-3 bg-transparent')} />
      {children}
      {count !== undefined && <span className={cx('il-num font-mono text-[0.6875rem] font-medium', pressed ? 'text-paper/75' : 'text-ink-2')}>{count}</span>}
    </button>
  )
  return hint ? (
    <Tooltip content={hint} decorative={false}>
      {btn}
    </Tooltip>
  ) : (
    btn
  )
}

export function ToolButton({ onClick, children, icon, disabled, label }: { onClick: () => void; children?: ReactNode; icon: ReactNode; disabled?: boolean; label?: string }) {
  const btn = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cx(
        'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[12px] bg-surface text-[0.8125rem] font-semibold text-ink shadow-inset-line transition-colors duration-fast hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
        children ? 'px-3' : 'w-9',
      )}
    >
      {icon}
      {children}
    </button>
  )
  return label && !children ? (
    <Tooltip content={label} decorative>
      {btn}
    </Tooltip>
  ) : (
    btn
  )
}

export function ToolGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cx('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ legend */

const EDGE_SAMPLE: Record<EdgeFamily | 'changed', { stroke: string; width: number; dash?: string; types: GraphEdgeType[] | null; label: string }> = {
  structure: { stroke: 'stroke-ink-3', width: 1.25, types: ['schedules', 'calls', 'references'], label: 'Execution structure' },
  reuse: { stroke: 'stroke-ink-2', width: 1.6, types: ['instantiates', 'defines'], label: 'Module reuse' },
  safety: { stroke: 'stroke-ink', width: 1.6, types: ['implements', 'protects', 'alarms'], label: 'Safety path' },
  writes: { stroke: 'stroke-ink-2', width: 1.25, dash: '5 3', types: ['writes'], label: 'Writes' },
  influence: { stroke: 'stroke-ink-3', width: 1, dash: '1.5 3.5', types: ['influences'], label: 'Influence' },
  changed: { stroke: 'stroke-marigold-ink', width: 2.4, dash: '9 4', types: null, label: 'Changed relationship' },
}

function EdgeSwatch({ k }: { k: keyof typeof EDGE_SAMPLE }) {
  const s = EDGE_SAMPLE[k]
  return (
    <svg aria-hidden="true" viewBox="0 0 44 10" className="h-2.5 w-11 shrink-0">
      <path d="M1 5h38" strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap={k === 'influence' ? 'round' : 'butt'} className={cx('fill-none', s.stroke)} />
      {k === 'changed' && <rect x="16" y="1.5" width="7" height="7" transform="rotate(45 19.5 5)" strokeWidth="1.4" className="fill-surface stroke-marigold-ink" />}
      {k !== 'influence' && <path d="M37 1.6 43 5 37 8.4z" className={k === 'changed' ? 'fill-marigold-ink' : k === 'safety' ? 'fill-ink' : 'fill-ink-3'} />}
    </svg>
  )
}

export function GraphLegend({ className }: { className?: string }) {
  return (
    <details open className={cx('group min-w-0 rounded-card bg-surface shadow-inset-line', className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="il-label text-ink">Legend</span>
        <span className="text-xs font-semibold text-ink-2 underline decoration-ink-3 underline-offset-4">
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <div className="grid grid-cols-1 gap-6 border-t border-line px-5 py-5 md:grid-cols-3">
        <div className="min-w-0">
          <p className="il-label mb-2.5">Nodes</p>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 xs:grid-cols-2">
            {NODE_TYPE_ORDER.map((t) => (
              <li key={t} className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-ink">
                <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-[6px]', t === 'safety-function' ? 'bg-ink text-paper' : 'bg-ink/[0.06] text-ink-2')}>
                  <TypeIcon type={t} className="size-3" />
                </span>
                {NODE_TYPE_LABEL[t]}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="il-label mb-2.5">Relationships</p>
          <ul className="flex flex-col gap-2">
            {(Object.keys(EDGE_SAMPLE) as Array<keyof typeof EDGE_SAMPLE>).map((k) => {
              const s = EDGE_SAMPLE[k]
              return (
                <li key={k} className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-1.5">
                    <EdgeSwatch k={k} />
                  </span>
                  <span className="min-w-0 text-[0.8125rem] text-ink">
                    {s.label}
                    {s.types && (
                      <span className="block font-mono text-[0.6875rem] text-ink-2" title={s.types.map((t) => `${t}: ${EDGE_TYPE_DESCRIPTION[t]}`).join('\n')}>
                        {s.types.join(' · ')}
                      </span>
                    )}
                    {!s.types && <span className="block text-[0.6875rem] text-ink-2">Heavier, long dash, ◆ at midpoint</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="il-label mb-2.5">Markers</p>
          <ul className="flex flex-col gap-2 text-[0.8125rem] text-ink">
            <li className="flex flex-wrap items-center gap-1.5">
              <ChangeMarker change="added" />
              <ChangeMarker change="modified" />
              <ChangeMarker change="removed" />
            </li>
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-1 font-mono text-[0.625rem] font-semibold tracking-[0.06em]">
                  <Glyph shape={SEVERITY_META[s].shape} className={cx('size-2.5', s === 'CRITICAL' ? 'fill-coral' : s === 'HIGH' ? 'fill-marigold' : s === 'INFO' ? 'fill-iris' : 'fill-ink-2')} />
                  {s}
                </span>
              ))}
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="h-5 w-9 shrink-0 rounded-[6px] border-[1.5px] border-dashed border-ink-3" />
              Undeclared: no safety intent declared, never assumed safe
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="h-5 w-9 shrink-0 rounded-[6px] bg-ink" />
              Declared safety function (anchor of a protective path)
            </li>
          </ul>
        </div>
      </div>
    </details>
  )
}
