/**
 * Semantic, Propagation, Safety and Impact views of the Changes page.
 * Each is a projection of the same AnalysisResult; nothing is re-derived.
 */
import { Link } from 'react-router'
import type { AnalysisResult, Change, Finding, InstanceRelevance, SafetyStatus } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { SeverityBadge, StatusPill } from '../../ui/Badge.tsx'
import { LogicDiff } from '../../ui/LogicDiff.tsx'
import { EmptyState } from '../../ui/States.tsx'
import { rankedFindings } from '../findings/meta.ts'
import { CATEGORY_LABEL, ChangeRow, OpBadge, SemanticPill } from './ChangeRow.tsx'

function FindingChip({ f }: { f: Finding }) {
  return (
    <Link
      to={`/app/findings/${encodeURIComponent(f.id)}`}
      className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-[10px] bg-surface px-2.5 py-1.5 shadow-inset-line hover:bg-surface-raised"
    >
      <SeverityBadge severity={f.severity} />
      <span className="font-mono text-xs font-semibold text-ink">{f.id}</span>
      <span className="il-ident truncate text-xs text-ink-2">{f.title}</span>
    </Link>
  )
}

/* -------------------------------------------------------------- semantic */

export function SemanticView({ result }: { result: AnalysisResult }) {
  const logic = result.changes.filter((c) => c.category === 'logic' || c.category === 'execution')
  if (logic.length === 0)
    return <EmptyState title="No logic or execution changes." body="Every change in this analysis is to documentation, data, configuration, interface or export metadata." />
  const tally = { equivalent: 0, different: 0, unknown: 0 }
  for (const c of logic) if (c.semantic) tally[c.semantic]++
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-prose text-sm text-ink-2">
        For each changed rung, INTERLOCK decides whether every output it writes still has a provably equivalent condition.{' '}
        <span className="font-semibold text-ink">
          {tally.different} different, {tally.equivalent} equivalent, {tally.unknown} not decided.
        </span>
      </p>
      <ol className="flex flex-col gap-4">
        {logic.map((c) => (
          <li key={c.id} className="overflow-hidden rounded-panel bg-surface shadow-soft ring-1 ring-line">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-3.5">
              <span className="font-mono text-xs font-semibold text-ink">{c.id}</span>
              <OpBadge op={c.op} />
              <span className="il-ident min-w-0 flex-1 text-sm font-semibold text-ink">{c.summary}</span>
              <SemanticPill semantic={c.semantic} />
            </div>
            <div className="p-4 sm:p-5">
              {c.entity.type === 'rung' || c.field === 'text' ? (
                <LogicDiff
                  before={c.before}
                  after={c.after}
                  beforeMeta={c.baselineSource ? `line ${c.baselineSource.line}` : undefined}
                  afterMeta={c.currentSource ? `line ${c.currentSource.line}` : undefined}
                />
              ) : (
                <dl className="grid grid-cols-1 gap-2 font-mono text-data sm:grid-cols-[6rem_minmax(0,1fr)]">
                  <dt className="il-label pt-0.5">Before</dt>
                  <dd className="il-ident text-ink-2">{c.before ?? '∅'}</dd>
                  <dt className="il-label pt-0.5">After</dt>
                  <dd className="il-ident text-ink">{c.after ?? '∅'}</dd>
                </dl>
              )}
              {c.semantic === 'equivalent' && <p className="mt-3 text-sm text-ink-2">Every output written by this rung has a provably equivalent condition. The edit does not change behaviour.</p>}
              {c.semantic === 'unknown' && <p className="mt-3 text-sm text-ink-2">Equivalence could not be decided (unsupported instruction or bound exceeded). Treat as different until reviewed.</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ----------------------------------------------------------- propagation */

const RELEVANCE: Record<InstanceRelevance, { label: string; cls: string }> = {
  safety: { label: 'Safety-relevant', cls: 'bg-ink text-paper' },
  operational: { label: 'Operational', cls: 'bg-surface text-ink shadow-inset-line' },
  'not-executed': { label: 'Not executed', cls: 'border border-dashed border-line-strong text-ink-2' },
}

export function PropagationView({ result }: { result: AnalysisResult }) {
  const changed = result.modules.filter((m) => m.changed)
  const unchanged = result.modules.length - changed.length
  if (changed.length === 0)
    return (
      <EmptyState
        title="No reusable module changed in this analysis."
        body="Changes stay where they were made: no Add-On Instruction definition differs between the two exports, so nothing propagates to other call sites."
        facts={[
          ['Module definitions compared', String(result.modules.length)],
          ['Call sites resolved', `${result.coverage.moduleRelationships.covered}/${result.coverage.moduleRelationships.total}`],
        ]}
      />
    )
  return (
    <div className="flex flex-col gap-5">
      {changed.map((m) => {
        const groups: InstanceRelevance[] = ['safety', 'operational', 'not-executed']
        return (
          <section key={m.module} aria-labelledby={`mod-${m.module}`} className="overflow-hidden rounded-panel bg-surface shadow-soft ring-1 ring-line">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="il-label">Changed module</p>
                <h3 id={`mod-${m.module}`} className="il-ident font-mono text-[0.9375rem] font-semibold text-ink">
                  {m.module}
                </h3>
              </div>
              <p className="font-mono text-xs text-ink-2">
                revision {m.revisionBefore ?? '—'} → {m.revisionAfter ?? '—'} · {m.changeIds.join(', ')}
              </p>
            </header>
            <div className="grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
              <dl className="flex flex-col gap-3">
                <div className="flex items-baseline gap-3">
                  <dd className="il-num text-[2.5rem] font-extrabold leading-none tracking-[-0.04em] text-ink">{m.totals.instances}</dd>
                  <dt className="text-sm text-ink-2">instances run it</dt>
                </div>
                <div className="flex h-3 gap-1" role="img" aria-label={`${m.totals.safetyRelevant} safety-relevant, ${m.totals.operational} operational, ${m.totals.notExecuted} not executed`}>
                  {m.instances.map((i) => (
                    <span key={i.id} className={cx('flex-1 rounded-[3px]', i.relevance === 'safety' ? 'bg-ink' : i.relevance === 'operational' ? 'bg-ink/[0.15]' : 'border border-dashed border-line-strong')} />
                  ))}
                </div>
                <div className="flex flex-col gap-1 font-mono text-xs">
                  <span>
                    <span className="il-num font-semibold text-ink">{m.totals.safetyRelevant}</span> <span className="text-ink-2">safety-relevant</span>
                  </span>
                  <span>
                    <span className="il-num font-semibold text-ink">{m.totals.operational}</span> <span className="text-ink-2">operational</span>
                  </span>
                  <span>
                    <span className="il-num font-semibold text-ink">{m.totals.notExecuted}</span> <span className="text-ink-2">not executed</span>
                  </span>
                </div>
              </dl>
              <div className="flex min-w-0 flex-col gap-4">
                {groups.map((g) => {
                  const list = m.instances.filter((i) => i.relevance === g)
                  if (!list.length) return null
                  return (
                    <div key={g}>
                      <p className="il-label mb-2">{RELEVANCE[g].label}</p>
                      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {list.map((i) => (
                          <li key={i.id} className={cx('flex min-w-0 flex-col gap-0.5 rounded-input px-3.5 py-2.5', RELEVANCE[g].cls)}>
                            <span className="il-ident font-mono text-data font-semibold">{i.backingTag}</span>
                            <span className={cx('il-ident font-mono text-[0.6875rem]', g === 'safety' ? 'text-paper/75' : 'text-ink-2')}>
                              {i.routineId.replace(/^program:/, '')} · rung {i.rung}
                              {i.safetyFunctionIds.length > 0 && ` · ${i.safetyFunctionIds.join(', ')}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        )
      })}
      {unchanged > 0 && <p className="font-mono text-xs text-ink-2">{unchanged} other module definition{unchanged === 1 ? '' : 's'} unchanged.</p>}
    </div>
  )
}

/* ---------------------------------------------------------------- safety */

const STATUS_ORDER: SafetyStatus[] = ['IMPACTED', 'NOT_ANALYZED', 'STRENGTHENED', 'CHANGED_EQUIVALENT', 'NO_CHANGE']

export function SafetyView({ result }: { result: AnalysisResult }) {
  const byId = new Map(result.changes.map((c) => [c.id, c]))
  const findings = new Map(result.findings.map((f) => [f.id, f]))
  const sfs = [...result.safetyFunctions].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.function.id.localeCompare(b.function.id))
  return (
    <ol className="flex flex-col gap-3">
      {sfs.map((s) => {
        const changes = s.changeIds.map((id) => byId.get(id)).filter((c): c is Change => !!c)
        return (
          <li key={s.function.id} className={cx('overflow-hidden rounded-card bg-surface', s.status === 'IMPACTED' ? 'shadow-soft ring-1 ring-line' : 'shadow-inset-line')}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5">
              <span className="font-mono text-xs font-semibold text-ink">{s.function.id}</span>
              <span className="il-ident min-w-0 flex-1 text-[0.9375rem] font-semibold text-ink">{s.function.name}</span>
              <span className="font-mono text-[0.6875rem] text-ink-2">
                {s.function.kind} · {s.function.criticality}
              </span>
              <StatusPill status={s.status} />
            </div>
            {(changes.length > 0 || s.findingIds.length > 0) && (
              <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
                {changes.length > 0 && (
                  <div>
                    <p className="il-label mb-1.5">Changes in its dependency cone ({changes.length})</p>
                    <ul className="flex flex-col gap-1">
                      {changes.map((c) => (
                        <li key={c.id} className="il-ident text-sm text-ink">
                          <span className="font-mono text-xs font-semibold">{c.id}</span> <span className="text-ink-2">{CATEGORY_LABEL[c.category]} ·</span> {c.summary}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.findingIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {s.findingIds.map((id) => {
                      const f = findings.get(id)
                      return f ? <FindingChip key={id} f={f} /> : null
                    })}
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/* ---------------------------------------------------------------- impact */

export function ImpactView({ result }: { result: AnalysisResult }) {
  const ranked = rankedFindings(result)
  const byChange = new Map<string, Finding[]>()
  for (const f of ranked) for (const id of f.changeIds) byChange.set(id, [...(byChange.get(id) ?? []), f])
  const producing = result.changes
    .filter((c) => byChange.has(c.id))
    .sort((a, b) => (byChange.get(a.id)![0]!.rank - byChange.get(b.id)![0]!.rank) || a.id.localeCompare(b.id))
  const rest = result.changes.filter((c) => !byChange.has(c.id))
  const restByCat = new Map<string, number>()
  for (const c of rest) restByCat.set(CATEGORY_LABEL[c.category], (restByCat.get(CATEGORY_LABEL[c.category]) ?? 0) + 1)

  return (
    <div className="flex flex-col gap-5">
      {producing.length === 0 ? (
        <EmptyState title="No change produced a finding." body="Every change was documentation, metadata, data, or logic proven equivalent or outside any declared scope." />
      ) : (
        <ol className="flex flex-col gap-3">
          {producing.map((c) => (
            <li key={c.id} className="overflow-hidden rounded-card bg-surface shadow-soft ring-1 ring-line">
              <ChangeRow change={c} />
              <div className="flex flex-col gap-2 border-t border-line bg-paper-2/50 px-4 py-3 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
                <span className="il-label shrink-0 pt-2">Produced</span>
                <div className="flex min-w-0 flex-wrap gap-2">
                  {byChange.get(c.id)!.map((f) => (
                    <FindingChip key={f.id} f={f} />
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {rest.length > 0 && (
        <p className="rounded-card border border-dashed border-line-strong px-5 py-4 text-sm text-ink-2">
          <span className="font-semibold text-ink">
            {rest.length} other change{rest.length === 1 ? '' : 's'}
          </span>{' '}
          produced no finding: {[...restByCat.entries()].map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ')}. They are listed under Structural.
        </p>
      )}
      {producing.length > 0 && <p className="font-mono text-xs text-ink-2">Ordered by the rank of the most important finding each change produced.</p>}
    </div>
  )
}

