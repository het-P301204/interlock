/**
 * Findings — every finding in review order, as large ranked records.
 * Filters (drawer) and search live in the URL query string.
 */
import { useMemo } from 'react'
import type { AnalysisResult, Finding, Severity } from '@interlock/core/types'
import { SEVERITY_ORDER } from '@interlock/core/types'
import { AnalysisGate } from '../../features/AnalysisGate.tsx'
import { FindingCard } from '../../features/findings/FindingCard.tsx'
import { DISPOSITION_LABEL, FINDING_TYPE_LABEL, NOTIFICATION_LABEL, rankedFindings, sfIndex } from '../../features/findings/meta.ts'
import { cx } from '../../lib/cx.ts'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { matchesQuery, useUrlFilters } from '../../lib/useUrlFilters.ts'
import { Glyph, SEVERITY_META, glyphFill } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { FilterBar } from '../../ui/FilterBar.tsx'
import type { FilterGroup, FilterValue } from '../../ui/FilterBar.tsx'
import { PageHeader } from '../../ui/Panel.tsx'
import { SearchBar } from '../../ui/SearchBar.tsx'
import { EmptyState } from '../../ui/States.tsx'

const KEYS = ['severity', 'disposition', 'sf', 'module', 'program', 'routine', 'type', 'notification', 'confidence'] as const

function count<T extends string>(items: T[]): Map<T, number> {
  const m = new Map<T, number>()
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1)
  return m
}

function buildGroups(result: AnalysisResult): FilterGroup[] {
  const fs = result.findings
  const sfs = sfIndex(result)
  const opt = <T extends string>(values: T[], label: (v: T) => string = (v) => v) =>
    [...count(values).entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, n]) => ({ value, label: label(value), count: n }))
  const groups: FilterGroup[] = [
    {
      id: 'severity',
      label: 'Severity',
      options: SEVERITY_ORDER.filter((s) => fs.some((f) => f.severity === s)).map((s) => ({ value: s, label: s, count: fs.filter((f) => f.severity === s).length })),
    },
    { id: 'disposition', label: 'Disposition (declared / undeclared)', options: opt(fs.map((f) => f.disposition), (d) => DISPOSITION_LABEL[d]) },
    { id: 'sf', label: 'Safety function', options: opt(fs.flatMap((f) => f.safetyFunctionIds), (id) => `${id} ${sfs.get(id)?.function.name ?? ''}`.trim()) },
    { id: 'module', label: 'Module', options: opt(fs.flatMap((f) => (f.module ? [f.module] : []))) },
    { id: 'program', label: 'Program', options: opt(fs.flatMap((f) => (f.location.program ? [f.location.program] : []))) },
    { id: 'routine', label: 'Routine', options: opt(fs.flatMap((f) => (f.location.program && f.location.routine ? [`${f.location.program}/${f.location.routine}`] : []))) },
    { id: 'type', label: 'Finding type', options: opt(fs.map((f) => f.type), (t) => FINDING_TYPE_LABEL[t]) },
    { id: 'notification', label: 'Notification impact', options: opt(fs.map((f) => f.notificationImpact), (n) => NOTIFICATION_LABEL[n]) },
    { id: 'confidence', label: 'Confidence', options: opt(fs.map((f) => f.confidence)) },
  ]
  return groups.filter((g) => g.options.length > 0)
}

function passes(f: Finding, filters: FilterValue): boolean {
  const any = (key: string, values: string[]) => {
    const want = filters[key]
    return !want || want.length === 0 || values.some((v) => want.includes(v))
  }
  return (
    any('severity', [f.severity]) &&
    any('disposition', [f.disposition]) &&
    any('sf', f.safetyFunctionIds) &&
    any('module', f.module ? [f.module] : []) &&
    any('program', f.location.program ? [f.location.program] : []) &&
    any('routine', f.location.program && f.location.routine ? [`${f.location.program}/${f.location.routine}`] : []) &&
    any('type', [f.type]) &&
    any('notification', [f.notificationImpact]) &&
    any('confidence', [f.confidence])
  )
}

function FindingsView({ result }: { result: AnalysisResult }) {
  const { filters, setFilters, query, setQuery } = useUrlFilters(KEYS)
  const groups = useMemo(() => buildGroups(result), [result])
  const sfs = useMemo(() => sfIndex(result), [result])
  const all = useMemo(() => rankedFindings(result), [result])
  const shown = all.filter(
    (f) => passes(f, filters) && matchesQuery(query, f.id, f.title, f.summary, f.module, f.location.program, f.location.routine, f.location.tag, f.type, ...f.safetyFunctionIds),
  )
  const bySeverity = count(all.map((f) => f.severity))
  const severityFilter = filters.severity ?? []
  const toggleSeverity = (s: Severity) =>
    setFilters({ ...filters, severity: severityFilter.includes(s) ? severityFilter.filter((x) => x !== s) : [...severityFilter, s] })

  const cov = result.coverage

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Impact Review"
        title="Findings"
        description={`${all.length} finding${all.length === 1 ? '' : 's'} in review order, most safety-critical first. Each one links to the evidence it came from.`}
      />

      {all.length === 0 ? (
        <EmptyState
          title="No safety-impacting changes identified within the declared analysis scope."
          facts={[
            ['Safety functions analyzed', `${cov.safetyFunctions.covered}/${cov.safetyFunctions.total}`],
            ['Declared routines covered', cov.declaredRoutines.total ? `${Math.floor((cov.declaredRoutines.covered / cov.declaredRoutines.total) * 100)}%` : 'n/a'],
            ['Undeclared routines touched', String(result.surface.undeclaredAffected)],
          ]}
        />
      ) : (
        <>
          <div role="group" aria-label="Filter by severity" className="flex flex-wrap gap-2">
            {SEVERITY_ORDER.map((s) => {
              const n = bySeverity.get(s) ?? 0
              const on = severityFilter.includes(s)
              const meta = SEVERITY_META[s]
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  disabled={n === 0}
                  onClick={() => toggleSeverity(s)}
                  className={cx(
                    'inline-flex h-10 items-center gap-2.5 rounded-control px-3.5 text-sm transition-colors duration-fast disabled:cursor-default disabled:opacity-40',
                    on ? 'bg-ink text-paper' : 'bg-surface text-ink shadow-inset-line hover:bg-surface-raised',
                  )}
                >
                  <Glyph shape={meta.shape} className={on ? 'fill-current text-paper' : meta.tone === 'outline' ? 'fill-ink' : glyphFill[meta.tone]} />
                  <span className="font-mono text-xs font-semibold tracking-[0.06em]">{s}</span>
                  <span className="il-num font-semibold">{n}</span>
                </button>
              )
            })}
          </div>

          <FilterBar
            groups={groups}
            value={filters}
            onChange={setFilters}
            search={<SearchBar label="Search findings" value={query} onChange={setQuery} placeholder="IL-0001, module, routine, tag, SF-02…" />}
            resultLabel={`${shown.length} of ${all.length} shown`}
          />

          {shown.length === 0 ? (
            <EmptyState
              eyebrow="Filtered"
              title="No findings match these filters."
              body="Every finding is still in the analysis; the current filters hide them."
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setFilters({})
                    setQuery('')
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ol className="flex flex-col gap-4" aria-label="Findings in review order">
              {shown.map((f) => (
                <li key={f.id}>
                  <FindingCard finding={f} sfs={sfs} />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

export function Findings() {
  useDocumentTitle('Findings')
  return (
    <AnalysisGate eyebrow="Impact Review" title="Findings" description="Every finding, ranked by safety impact, with its evidence.">
      {(result) => <FindingsView result={result} />}
    </AnalysisGate>
  )
}
