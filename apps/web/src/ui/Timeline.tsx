/**
 * Timeline — the analysis pipeline, drawn as a power rail with one station per stage.
 *
 *   <Timeline label="Analysis pipeline" stages={[
 *     { id: 'INGEST', label: 'INGEST', state: 'done', detail: 'Read 2 files (1.2 MB)…', counts: { files: 2 }, elapsedMs: 41 },
 *     { id: 'NORMALIZE', label: 'NORMALIZE', state: 'active' },
 *     { id: 'RESOLVE_MODULES', label: 'RESOLVE MODULES', state: 'pending' },
 *   ]} />
 *
 * The component only renders what it is given: it never advances a stage on
 * its own. Detail lines and counts must come from the engine's StageReport.
 * The latest completed stage is announced through a polite live region.
 */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { cx } from '../lib/cx.ts'
import { formatCount, formatMs } from '../lib/format.ts'
import { Glyph } from './Badge.tsx'

export type TimelineState = 'pending' | 'active' | 'done' | 'failed' | 'cancelled'

export interface TimelineStage {
  id: string
  label: string
  state: TimelineState
  detail?: ReactNode
  counts?: Record<string, number>
  elapsedMs?: number
}

const stateText: Record<TimelineState, string> = {
  pending: 'pending',
  active: 'in progress',
  done: 'complete',
  failed: 'failed',
  cancelled: 'cancelled',
}

function countLabel(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase()
}

function Marker({ state }: { state: TimelineState }) {
  return (
    <span aria-hidden="true" className="relative z-10 flex size-[22px] items-center justify-center">
      {state === 'done' && (
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          className="flex size-[22px] items-center justify-center rounded-full bg-ink text-paper"
        >
          <Glyph shape="check" className="size-3" />
        </motion.span>
      )}
      {state === 'active' && (
        <span className="flex size-[22px] items-center justify-center rounded-full bg-surface ring-2 ring-ink">
          <span className="il-pulse-dot size-2 rounded-full bg-ink" />
        </span>
      )}
      {state === 'pending' && <span className="size-[14px] rounded-full bg-paper ring-[1.5px] ring-line-strong" />}
      {state === 'cancelled' && <span className="size-[14px] rounded-full border-[1.5px] border-dashed border-ink-3 bg-paper" />}
      {state === 'failed' && (
        <span className="flex size-[22px] items-center justify-center rounded-full bg-surface">
          <Glyph shape="octagon" className="size-[18px] fill-coral" />
        </span>
      )}
    </span>
  )
}

export function Timeline({ stages, label, className }: { stages: TimelineStage[]; label: string; className?: string }) {
  const lastDone = [...stages].reverse().find((s) => s.state === 'done')
  return (
    <div className={cx('min-w-0', className)}>
      <ol aria-label={label} className="relative flex flex-col">
        {stages.map((s, i) => {
          const last = i === stages.length - 1
          const next = stages[i + 1]
          const segmentDone = s.state === 'done' && next && next.state !== 'pending'
          return (
            <li key={s.id} className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-4">
              {/* rail segment to the next station */}
              {!last && (
                <span aria-hidden="true" className="absolute bottom-0 left-[10px] top-[22px] w-[2px] bg-line">
                  <motion.span
                    className="absolute inset-0 origin-top bg-ink"
                    initial={false}
                    animate={{ scaleY: segmentDone ? 1 : 0 }}
                    transition={{ duration: 0.22, ease: [0.45, 0, 0.55, 1] }}
                  />
                </span>
              )}
              <Marker state={s.state} />
              <div className={cx('min-w-0', last ? 'pb-0' : 'pb-5')}>
                <div className="flex min-h-[22px] flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <p className="flex items-baseline gap-2.5 font-mono text-xs font-semibold uppercase tracking-[0.1em]">
                    <span className="il-num text-ink-3">{String(i + 1).padStart(2, '0')}</span>
                    <span className={cx(s.state === 'pending' || s.state === 'cancelled' ? 'text-ink-3' : s.state === 'failed' ? 'text-coral-ink' : 'text-ink')}>
                      {s.label}
                    </span>
                    <span className="sr-only">— {stateText[s.state]}</span>
                  </p>
                  {s.state === 'done' && s.elapsedMs !== undefined && (
                    <span className="il-num font-mono text-[0.6875rem] text-ink-2">{formatMs(s.elapsedMs)}</span>
                  )}
                  {s.state === 'active' && <span className="font-mono text-[0.6875rem] text-ink-2">running</span>}
                </div>
                {s.state === 'done' && (s.detail || (s.counts && Object.keys(s.counts).length > 0)) && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    className="mt-1.5"
                  >
                    {s.detail && <p className="il-ident text-sm leading-snug text-ink-2">{s.detail}</p>}
                    {s.counts && Object.keys(s.counts).length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${s.label} counts`}>
                        {Object.entries(s.counts).map(([k, v]) => (
                          <li key={k} className="inline-flex h-6 items-center gap-1.5 rounded-chip bg-ink/[0.05] px-2 font-mono text-[0.6875rem] text-ink-2 ring-1 ring-inset ring-ink/[0.08]">
                            <span className="il-num font-semibold text-ink">{formatCount(v)}</span>
                            {countLabel(k)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.div>
                )}
                {s.state === 'failed' && s.detail && <p className="mt-1.5 text-sm text-coral-ink">{s.detail}</p>}
              </div>
            </li>
          )
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {lastDone ? `${lastDone.label} complete.` : ''}
      </p>
    </div>
  )
}
