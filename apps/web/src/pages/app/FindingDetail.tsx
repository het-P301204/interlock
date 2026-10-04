/**
 * Finding detail — the strongest page. Order follows the review flow:
 * header and key facts → firing condition (before/after, witness) → the rung
 * text itself → semantic explanation → impact chain → notification analysis →
 * evidence ledger → recommended review, with prev/next by rank.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { AnalysisResult, EvidenceItem, Finding } from '@interlock/core/types'
import { AnalysisGate } from '../../features/AnalysisGate.tsx'
import { EvidenceLedger } from '../../features/evidence/Evidence.tsx'
import { FiringSection } from '../../features/findings/Firing.tsx'
import { ImpactChain } from '../../features/findings/ImpactChain.tsx'
import { DISPOSITION_LABEL, FINDING_TYPE_LABEL, NOTIFICATION_LABEL, NOTIFICATION_TONE, UNDECLARED_COPY, locationLabel, rankedFindings, sfIndex } from '../../features/findings/meta.ts'
import { NotificationPath } from '../../features/paths/NotificationPath.tsx'
import { cx } from '../../lib/cx.ts'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { Badge, SeverityBadge, StatusPill } from '../../ui/Badge.tsx'
import { ButtonLink } from '../../ui/Button.tsx'
import { Breadcrumbs } from '../../ui/Breadcrumbs.tsx'
import { LogicDiff } from '../../ui/LogicDiff.tsx'
import { EmptyState } from '../../ui/States.tsx'

function DetailSection({ id, step, title, description, children }: { id: string; step?: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-line pt-8">
      <div className="mb-5 grid grid-cols-1 gap-1">
        {step && <p className="il-label">{step}</p>}
        <h2 id={`${id}-h`} className="text-title-2 text-ink">
          {title}
        </h2>
        {description && <p className="max-w-prose text-sm text-ink-2">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5 bg-surface px-4 py-3.5', wide && 'col-span-2')}>
      <dt className="il-label">{label}</dt>
      <dd className="il-ident min-w-0 text-sm text-ink">{children}</dd>
    </div>
  )
}

function rungEvidence(f: Finding): EvidenceItem[] {
  return f.evidence.filter((e) => (e.kind === 'rung' || e.kind === 'module-rung') && (e.original !== undefined || e.modified !== undefined))
}

function DetailView({ result, id }: { result: AnalysisResult; id: string }) {
  const ranked = useMemo(() => rankedFindings(result), [result])
  const sfs = useMemo(() => sfIndex(result), [result])
  const idx = ranked.findIndex((f) => f.id === id)
  const f = ranked[idx]
  useDocumentTitle(f ? `${f.id} ${f.title}` : 'Finding not found')

  if (!f) {
    return (
      <div className="flex flex-col gap-8">
        <Breadcrumbs items={[{ label: 'Findings', to: '/app/findings' }, { label: id }]} />
        <EmptyState
          eyebrow="Not in this analysis"
          title={`There is no finding ${id} in the loaded analysis.`}
          body="Finding ids are numbered per analysis in review order. Open the list to see the findings this analysis produced."
          action={
            <ButtonLink to="/app/findings" variant="primary">
              Open Findings
            </ButtonLink>
          }
        />
      </div>
    )
  }

  const prev = ranked[idx - 1]
  const next = ranked[idx + 1]
  const fns = f.safetyFunctionIds.map((s) => sfs.get(s)).filter((x): x is NonNullable<typeof x> => !!x)
  const rungs = rungEvidence(f)
  // Paths this finding changes; for findings without notification impact, show each alarm's state and
  // point to the finding that does report a change on it, so the page never contradicts itself.
  const notifPaths = f.notificationImpact !== 'NONE' ? fns.filter((s) => s.notification && s.notification.status !== 'INTACT') : []
  const otherPaths = fns.filter((s) => s.notification && !notifPaths.includes(s))
  const reportedBy = (sfId: string) => result.findings.find((x) => x.id !== f.id && x.notificationImpact !== 'NONE' && x.safetyFunctionIds.includes(sfId))
  const where = locationLabel(f)

  return (
    <article className="mx-auto flex max-w-[68rem] flex-col gap-8" aria-labelledby="finding-title">
      <Breadcrumbs items={[{ label: 'Findings', to: '/app/findings' }, { label: f.id }]} />

      {/* Header */}
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <SeverityBadge severity={f.severity} solid size="md" />
          <span className="font-mono text-sm font-semibold text-ink">{f.id}</span>
          <span aria-hidden="true" className="text-ink-3">
            /
          </span>
          <span className="font-mono text-xs text-ink-2">
            rank {f.rank} of {ranked.length}
          </span>
          <StatusPill status={f.disposition} label={DISPOSITION_LABEL[f.disposition].toUpperCase()} className="ml-auto" />
        </div>
        <h1 id="finding-title" className="il-ident text-title-1 text-ink [text-wrap:balance]">
          {f.title}
        </h1>
        <p className="il-ident max-w-prose text-lede text-ink-2">{f.summary}</p>
        {f.disposition === 'UNDECLARED' && (
          <p className="rounded-card border border-dashed border-line-strong bg-paper-2/60 px-5 py-4 text-[0.9375rem] font-medium text-ink">{UNDECLARED_COPY}</p>
        )}

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card bg-line shadow-inset-line lg:grid-cols-4">
          <Fact label={fns.length === 1 ? 'Safety function' : 'Safety functions'} wide>
            {fns.length === 0 ? (
              <span className="text-ink-2">None declared</span>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {fns.map((s) => (
                  <li key={s.function.id}>
                    <Link to={`/app/safety#${encodeURIComponent(s.function.id)}`} className="underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
                      <span className="font-mono text-xs font-semibold">{s.function.id}</span> {s.function.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Fact>
          <Fact label="Affected module">{f.module ? <span className="font-mono text-data">{f.module}</span> : <span className="text-ink-2">—</span>}</Fact>
          <Fact label="Location">{where ? <span className="font-mono text-data">{where}</span> : <span className="text-ink-2">—</span>}</Fact>
          <Fact label="Blast radius">
            {f.blastRadius ? (
              <span className="il-num">
                <span className="font-semibold">{f.blastRadius.instances}</span> instances · {f.blastRadius.operational} operational
              </span>
            ) : (
              <span className="text-ink-2">No shared module</span>
            )}
          </Fact>
          <Fact label="Safety-relevant sites">
            <span className="il-num font-semibold">{f.blastRadius ? f.blastRadius.safetyRelevant : fns.length}</span>
          </Fact>
          <Fact label="Notification impact">
            {f.notificationImpact === 'NONE' ? <span className="text-ink-2">None</span> : <Badge tone={NOTIFICATION_TONE[f.notificationImpact]}>{NOTIFICATION_LABEL[f.notificationImpact]}</Badge>}
          </Fact>
          <Fact label="Confidence">
            <span className="font-mono text-xs font-semibold">{f.confidence}</span>
          </Fact>
          <Fact label="Rule" wide>
            <span className="font-mono text-xs font-semibold">{f.ruleId}</span> {f.ruleTitle}
            {FINDING_TYPE_LABEL[f.type] !== f.ruleTitle && <span className="block text-xs text-ink-2">{FINDING_TYPE_LABEL[f.type]}</span>}
          </Fact>
          <Fact label="Changes" wide>
            <span className="font-mono text-data">{f.changeIds.join(', ') || '—'}</span>
            {f.changeIds.length > 0 && (
              <Link to="/app/changes?view=impact" className="ml-2 text-xs font-semibold underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
                See in Changes
              </Link>
            )}
          </Fact>
        </dl>
      </header>

      {f.firing && (
        <DetailSection
          id="firing"
          step="What does it mean"
          title="Firing condition, before and after"
          description="Derived from a symbolic scan of both versions. Terms that entered the condition are highlighted; terms that left it are struck through."
        >
          <FiringSection finding={f} firing={f.firing} />
        </DetailSection>
      )}

      {rungs.length > 0 && (
        <DetailSection id="logic" step="What changed" title="Logic as exported" description="The rung text exactly as it appears in each file.">
          <div className="flex flex-col gap-4">
            {rungs.map((e) => (
              <div key={e.id} className="flex flex-col gap-2">
                <p className="il-ident font-mono text-xs text-ink-2">
                  {e.id} · {e.title}
                </p>
                <LogicDiff
                  before={e.original}
                  after={e.modified}
                  beforeMeta={e.side === 'current' ? undefined : [e.program, e.routine, e.module].filter(Boolean).join(' / ') || undefined}
                  afterMeta={e.line !== undefined && e.sourceFile ? `${e.sourceFile} · line ${e.line}` : e.sourceFile}
                />
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      <DetailSection id="explanation" step="What it means" title="Explanation">
        <div className="il-ident flex max-w-prose flex-col gap-3 text-[0.9375rem] leading-relaxed text-ink">
          {f.explanation.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {f.impact.length > 0 && (
          <ul className="mt-5 flex max-w-prose flex-col gap-1.5 border-l-2 border-ink pl-4 text-sm text-ink">
            {f.impact.map((p, i) => (
              <li key={i} className="il-ident">
                {p}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection id="impact" step="Where it propagates" title="Impact chain">
        <ImpactChain finding={f} result={result} />
      </DetailSection>

      <DetailSection
        id="notification"
        step="Who is told"
        title="Notification analysis"
        description={f.notificationImpact === 'NONE' ? 'This finding does not change how an operator is notified.' : NOTIFICATION_LABEL[f.notificationImpact] + '.'}
      >
        {notifPaths.length > 0 ? (
          <div className="flex flex-col gap-4">
            {notifPaths.map((s) => (
              <div key={s.function.id} className="rounded-panel bg-surface p-5 shadow-soft ring-1 ring-line sm:p-6">
                <p className="il-ident mb-4 text-sm font-semibold text-ink">
                  <span className="font-mono text-xs">{s.function.id}</span> {s.function.name}
                </p>
                <NotificationPath path={s.notification!} />
              </div>
            ))}
          </div>
        ) : otherPaths.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {otherPaths.map((s) => {
              const other = s.notification!.status !== 'INTACT' ? reportedBy(s.function.id) : undefined
              return (
                <li key={s.function.id} className="flex min-w-0 flex-col gap-3 rounded-card bg-surface px-4 py-3 shadow-inset-line sm:flex-row sm:items-center sm:justify-between">
                  <span className="il-ident min-w-0 text-sm text-ink">
                    <span className="font-mono text-xs font-semibold">{s.function.id}</span> <span className="font-mono text-data">{s.notification!.alarmTag}</span>
                    {other ? (
                      <span className="block text-xs text-ink-2">
                        Path {s.notification!.status.toLowerCase()} by a related change, reported in{' '}
                        <Link to={`/app/findings/${encodeURIComponent(other.id)}`} className="font-semibold text-ink underline underline-offset-4">
                          {other.id}
                        </Link>
                        .
                      </span>
                    ) : (
                      <span className="block text-xs text-ink-2">Path {s.notification!.status.toLowerCase().replace(/_/g, ' ')}.</span>
                    )}
                  </span>
                  <NotificationPath path={s.notification!} compact className="sm:w-80" />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">No declared alarm is associated with the affected logic.</p>
        )}
      </DetailSection>

      <DetailSection id="evidence" step="Evidence" title="Evidence ledger" description={`${f.evidence.length} item${f.evidence.length === 1 ? '' : 's'}. Each cites the file, its SHA-256, the XML location and the rule that fired.`}>
        <EvidenceLedger items={f.evidence} />
      </DetailSection>

      <DetailSection id="review" step="What to review" title="Recommended review">
        <ol className="flex max-w-prose flex-col gap-3">
          {f.recommendation.map((r, i) => (
            <li key={i} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 text-[0.9375rem] leading-relaxed text-ink">
              <span className="il-num pt-0.5 font-mono text-xs font-semibold text-ink-2">{String(i + 1).padStart(2, '0')}</span>
              <span className="il-ident">{r}</span>
            </li>
          ))}
        </ol>
      </DetailSection>

      <nav aria-label="Other findings" className="grid grid-cols-1 gap-3 border-t border-line pt-6 sm:grid-cols-2">
        {prev ? (
          <Link to={`/app/findings/${encodeURIComponent(prev.id)}`} className="group flex min-w-0 flex-col gap-1 rounded-card bg-surface px-5 py-4 shadow-inset-line hover:bg-surface-raised">
            <span className="flex items-center gap-1.5 font-mono text-xs text-ink-2">
              <ArrowLeft aria-hidden="true" className="size-3.5" /> Previous · rank {prev.rank}
            </span>
            <span className="il-ident text-sm font-semibold text-ink">
              {prev.id} {prev.title}
            </span>
          </Link>
        ) : (
          <span className="hidden sm:block" />
        )}
        {next && (
          <Link to={`/app/findings/${encodeURIComponent(next.id)}`} className="group flex min-w-0 flex-col items-end gap-1 rounded-card bg-surface px-5 py-4 text-right shadow-inset-line hover:bg-surface-raised">
            <span className="flex items-center gap-1.5 font-mono text-xs text-ink-2">
              Next · rank {next.rank} <ArrowRight aria-hidden="true" className="size-3.5" />
            </span>
            <span className="il-ident text-sm font-semibold text-ink">
              {next.id} {next.title}
            </span>
          </Link>
        )}
      </nav>
    </article>
  )
}

export function FindingDetail() {
  const { id = '' } = useParams()
  return (
    <AnalysisGate eyebrow="Finding" title={id || 'Finding'}>
      {(result) => <DetailView key={id} result={result} id={id} />}
    </AnalysisGate>
  )
}
