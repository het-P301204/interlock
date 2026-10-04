/**
 * The "ANALYSIS COMPLETE" block. Every number comes from result.surface.
 */
import type { AnalysisResult } from '@interlock/core/types'
import { ArrowRight } from 'lucide-react'
import { cx } from '../lib/cx.ts'
import { formatMs, plural } from '../lib/format.ts'
import { Glyph, SeverityBadge, StatusPill } from '../ui/Badge.tsx'
import { ButtonLink } from '../ui/Button.tsx'

export function AnalysisComplete({ result, elapsedMs, className, showLink = true }: { result: AnalysisResult; elapsedMs?: number; className?: string; showLink?: boolean }) {
  const s = result.surface
  const lines: Array<[string, number]> = [
    [`${plural(s.totalChanges, 'change')} detected`, s.totalChanges],
    [`${plural(s.meaningfulLogicChanges, 'meaningful logic change')}`, s.meaningfulLogicChanges],
    [`${s.safetyRelevant} safety-relevant`, s.safetyRelevant],
    [`${plural(s.notificationPathChanges, 'notification-path change')}`, s.notificationPathChanges],
    [`${plural(s.sharedModulesWithSafetyImpact, 'shared module')} with amplified impact`, s.sharedModulesWithSafetyImpact],
    [`${plural(s.undeclaredAffected, 'undeclared affected routine')}`, s.undeclaredAffected],
  ]
  return (
    <section aria-labelledby="complete-title" className={cx('overflow-hidden rounded-panel bg-surface shadow-lift ring-1 ring-line', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4 sm:px-8">
        <h2 id="complete-title" className="flex items-center gap-2.5 font-mono text-sm font-semibold tracking-[0.12em] text-ink">
          <span className="flex size-5 items-center justify-center rounded-full bg-ink text-paper">
            <Glyph shape="check" className="size-3" />
          </span>
          ANALYSIS COMPLETE
        </h2>
        <p className="font-mono text-xs text-ink-2">
          {elapsedMs !== undefined && <>{formatMs(elapsedMs)} · </>}engine {result.engineVersion}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-8 px-6 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <ul className="grid grid-cols-1 gap-x-10 gap-y-2.5 sm:grid-cols-2">
          {lines.map(([text, n]) => (
            <li key={text} className="flex items-baseline gap-3 border-b border-line pb-2.5">
              <span aria-hidden="true" className={cx('size-1.5 shrink-0 translate-y-[-2px] rounded-full', n > 0 ? 'bg-ink' : 'bg-ink/20')} />
              <span className={cx('text-[0.9375rem]', n > 0 ? 'font-semibold text-ink' : 'text-ink-2')}>{text}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <p className="il-label">Review priority</p>
          {s.priority === 'NONE' ? (
            <StatusPill status="NO_CHANGE" label="NONE" size="md" />
          ) : (
            <SeverityBadge severity={s.priority} solid size="md" />
          )}
          <StatusPill status={result.trust.status} />
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-line bg-paper-2/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="text-sm text-ink-2">{result.trust.headline}</p>
        {showLink && (
          <ButtonLink to="/app" variant="primary" iconRight={<ArrowRight />}>
            Open Impact Review
          </ButtonLink>
        )}
      </div>
    </section>
  )
}
