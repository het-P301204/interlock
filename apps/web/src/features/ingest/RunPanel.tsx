/**
 * The analysis pipeline view. Truth comes from the store (engine StageEvents);
 * this component only staggers the *reveal* of stages the engine has already
 * reported done (about 120 ms apart) so the sequence is legible. "Skip" and
 * prefers-reduced-motion reveal everything at once. A stage is never shown as
 * done before the engine reported it.
 */
import { useEffect, useMemo, useState } from 'react'
import { FastForward, Square } from 'lucide-react'
import { formatMs } from '../../lib/format.ts'
import { usePrefersReducedMotion } from '../../lib/hooks.ts'
import type { RunState } from '../../state/analysis.ts'
import { STAGES } from '../../state/stages.ts'
import { StatusPill } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { Timeline } from '../../ui/Timeline.tsx'
import type { TimelineStage } from '../../ui/Timeline.tsx'

const REVEAL_MS = 120

function useElapsed(running: boolean): number {
  const [start] = useState(() => performance.now())
  const [now, setNow] = useState(start)
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNow(performance.now()), 100)
    return () => window.clearInterval(t)
  }, [running])
  return now - start
}

export function useStageReveal(run: RunState) {
  const reduced = usePrefersReducedMotion()
  const [revealed, setRevealed] = useState(0)
  const [skip, setSkip] = useState(false)
  const [token, setToken] = useState(run.token)
  if (token !== run.token) {
    setToken(run.token)
    setRevealed(0)
    setSkip(false)
  }

  // Leading run of stages the engine has reported done.
  let doneCount = 0
  for (const s of STAGES) {
    if (run.stages[s.id]?.report) doneCount++
    else break
  }

  useEffect(() => {
    if (revealed >= doneCount) return
    if (reduced || skip) {
      setRevealed(doneCount)
      return
    }
    const t = window.setTimeout(() => setRevealed((r) => Math.min(r + 1, doneCount)), REVEAL_MS)
    return () => window.clearTimeout(t)
  }, [revealed, doneCount, reduced, skip])

  return { revealed, doneCount, skip: () => setSkip(true), settled: revealed >= doneCount }
}

export function RunPanel({ run, onCancel, reveal }: { run: RunState; onCancel: () => void; reveal: ReturnType<typeof useStageReveal> }) {
  const running = run.status === 'running'
  const elapsed = useElapsed(running)
  const { revealed, doneCount } = reveal

  const stages: TimelineStage[] = useMemo(
    () =>
      STAGES.map((s, i) => {
        const track = run.stages[s.id]
        const base = { id: s.id, label: s.label }
        if (i < revealed && track?.report) {
          return {
            ...base,
            label: track.report.label || s.label,
            state: 'done' as const,
            detail: track.report.detail,
            counts: track.report.counts,
            elapsedMs: track.startedAtMs !== undefined && track.doneAtMs !== undefined ? track.doneAtMs - track.startedAtMs : undefined,
          }
        }
        if (i === revealed) {
          if (run.status === 'failed') return { ...base, state: 'failed' as const, detail: 'Stopped here. See the error below.' }
          if (run.status === 'cancelled') return { ...base, state: 'cancelled' as const }
          if (running || i < doneCount) return { ...base, state: 'active' as const }
        }
        if (run.status === 'cancelled' && i > revealed) return { ...base, state: 'cancelled' as const }
        return { ...base, state: 'pending' as const }
      }),
    [run, revealed, doneCount, running],
  )

  const statusLabel = run.status === 'running' ? 'RUNNING' : run.status === 'complete' ? 'COMPLETE' : run.status === 'failed' ? 'FAILED' : run.status === 'cancelled' ? 'CANCELLED' : 'PENDING'

  return (
    <section aria-labelledby="pipeline-title" className="overflow-hidden rounded-panel bg-surface shadow-soft ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <h2 id="pipeline-title" className="font-mono text-sm font-semibold tracking-[0.12em] text-ink">
            ANALYSIS PIPELINE
          </h2>
          <StatusPill status={statusLabel} />
        </div>
        <div className="flex items-center gap-2">
          <span className="il-num font-mono text-xs text-ink-2" aria-live="off">
            {run.status === 'complete' && run.elapsedMs !== undefined ? `${formatMs(run.elapsedMs)} engine time` : running ? formatMs(elapsed) : ''}
          </span>
          {revealed < doneCount && (
            <Button variant="ghost" size="sm" iconLeft={<FastForward />} onClick={reveal.skip}>
              Skip
            </Button>
          )}
          {running && (
            <Button variant="secondary" size="sm" iconLeft={<Square />} onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
      <div className="px-5 py-6 sm:px-8">
        <Timeline stages={stages} label="Analysis pipeline stages" />
      </div>
    </section>
  )
}
