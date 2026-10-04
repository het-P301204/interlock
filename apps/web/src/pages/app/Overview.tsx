/**
 * Overview (dashboard). Phase 1: the empty state, or — when a real analysis
 * is loaded — its completion summary, the five headline metrics, the review
 * order and coverage. Every value is read from the AnalysisResult.
 */
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { AnalysisComplete } from '../../features/AnalysisComplete.tsx'
import { formatTimestamp, plural } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { useWorkspace } from '../../state/analysis.ts'
import { SeverityBadge } from '../../ui/Badge.tsx'
import { ButtonLink } from '../../ui/Button.tsx'
import { Metric, MetricRow } from '../../ui/Metric.tsx'
import { PageHeader, Panel, Section } from '../../ui/Panel.tsx'
import { EmptyState, LoadingState } from '../../ui/States.tsx'

export function Overview() {
  useDocumentTitle('Overview')
  const result = useWorkspace((s) => s.result)
  const hydrated = useWorkspace((s) => s.hydrated)

  if (!hydrated) return <LoadingState variant="page" label="Loading saved analysis" />

  if (!result) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Overview" title="Impact Review" description="What changed, what matters, what is affected, and what to review first." />
        <EmptyState
          title="Nothing analyzed yet."
          body="Import a known-good PLC project and a current export to reveal changes that matter."
          action={
            <ButtonLink to="/app/new" variant="primary" iconRight={<ArrowRight />}>
              Start Analysis
            </ButtonLink>
          }
          secondary={
            <ButtonLink to="/app/demo" variant="secondary">
              Explore Demo
            </ButtonLink>
          }
        />
      </div>
    )
  }

  const s = result.surface
  const cov = result.coverage
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow={`Overview · analyzed ${formatTimestamp(result.analyzedAt)}`}
        title="Impact Review"
        description={
          <>
            <span className="il-ident font-mono text-[0.9em] text-ink">{result.baseline.file.name}</span> compared with{' '}
            <span className="il-ident font-mono text-[0.9em] text-ink">{result.current.file.name}</span>
          </>
        }
        actions={
          <ButtonLink to="/app/new" variant="secondary">
            New analysis
          </ButtonLink>
        }
      />

      <MetricRow>
        <Metric label="Total changes" value={s.totalChanges} detail={plural(s.meaningfulLogicChanges, 'meaningful logic change')} />
        <Metric label="Safety relevant" value={s.safetyRelevant} tone={s.safetyRelevant > 0 ? 'coral' : 'neutral'} detail="inside a declared function" />
        <Metric label="Alarm impact" value={s.notificationPathChanges} tone={s.notificationPathChanges > 0 ? 'coral' : 'neutral'} detail={s.notificationPathChanges === 1 ? 'notification-path change' : 'notification-path changes'} />
        <Metric label="Blast radius" value={s.blastRadius} tone={s.sharedModulesWithSafetyImpact > 0 ? 'marigold' : 'neutral'} detail="largest call-site count of a changed module" />
        <Metric label="Undeclared" value={s.undeclaredAffected} tone={s.undeclaredAffected > 0 ? 'iris' : 'neutral'} detail="affected routines without declared intent" />
      </MetricRow>

      <AnalysisComplete result={result} showLink={false} />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section title="Review priority" description="Recommended order, most safety-critical first.">
          {s.reviewOrder.length === 0 ? (
            <EmptyState
              title="No safety-impacting changes identified within the declared analysis scope."
              facts={[
                ['Safety functions analyzed', `${cov.safetyFunctions.covered}/${cov.safetyFunctions.total}`],
                ['Declared routines covered', `${cov.declaredRoutines.covered}/${cov.declaredRoutines.total}`],
                ['Undeclared routines touched', String(s.undeclaredAffected)],
              ]}
            />
          ) : (
            <ol className="flex flex-col overflow-hidden rounded-card bg-surface shadow-inset-line">
              {s.reviewOrder.map((item) => (
                <li key={item.findingId} className="border-b border-line last:border-0">
                  <Link to={`/app/findings/${encodeURIComponent(item.findingId)}`} className="flex min-w-0 items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-2/70">
                    <span className="il-num w-6 shrink-0 font-mono text-sm font-semibold text-ink-2">{String(item.rank).padStart(2, '0')}</span>
                    <span className="min-w-0 flex-1">
                      <span className="il-ident block text-[0.9375rem] font-semibold text-ink">{item.title}</span>
                      <span className="il-ident block font-mono text-xs text-ink-2">
                        {item.findingId}
                        {item.safetyFunction ? ` · ${item.safetyFunction}` : ''}
                      </span>
                    </span>
                    <SeverityBadge severity={item.severity} />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Section>
        <Section title="Coverage" description={result.trust.headline}>
          <Panel>
            <ul className="flex flex-col gap-4">
              {(
                [
                  ['Safety functions', cov.safetyFunctions],
                  ['Declared routines', cov.declaredRoutines],
                  ['Module relationships', cov.moduleRelationships],
                  ['Notification paths', cov.notificationPaths],
                ] as const
              ).map(([label, r]) => (
                <li key={label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink">{label}</span>
                    <span className="il-num font-mono text-data text-ink">
                      {r.covered}/{r.total}
                    </span>
                  </div>
                  <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.08]">
                    <div className={r.total > 0 && r.covered === r.total ? 'h-full bg-ink' : 'h-full bg-marigold'} style={{ width: `${r.total ? (r.covered / r.total) * 100 : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4">
              <span className="il-label">Coverage</span>
              <span className="il-num text-[1.75rem] font-extrabold leading-none tracking-[-0.03em] text-ink">{cov.percent}%</span>
            </div>
            {result.trust.reasons.length > 0 && (
              <ul className="mt-4 flex list-disc flex-col gap-1 pl-5 text-[0.8125rem] text-ink-2">
                {result.trust.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </Panel>
        </Section>
      </div>
    </div>
  )
}
