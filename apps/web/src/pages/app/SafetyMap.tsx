/**
 * Safety Map (/app/safety): every declared safety function as a path
 * FUNCTION → IMPLEMENTATION → PROTECTIVE OUTPUT → ALARM → STATUS, with the
 * firing-condition comparison, notification path and dependency cone on
 * expand; plus the declarations editor (?tab=declarations).
 * Deep link: /app/safety?sf=SF-02 expands and scrolls to that function.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { AnalysisResult, SafetyManifest, SafetyStatus } from '@interlock/core/types'
import { AnalysisGate } from '../../features/AnalysisGate.tsx'
import { DeclarationsEditor } from '../../features/safety/DeclarationsEditor.tsx'
import { SafetyPathHeader, SafetyPathRow, notificationLink, verdictLink } from '../../features/safety/SafetyPathRow.tsx'
import { sameManifest } from '../../features/safety/manifestDraft.ts'
import { cx } from '../../lib/cx.ts'
import { enumLabel, plural } from '../../lib/format.ts'
import { useDocumentTitle, usePrefersReducedMotion } from '../../lib/hooks.ts'
import { useWorkspace } from '../../state/analysis.ts'
import { Metric, MetricRow } from '../../ui/Metric.tsx'
import { PageHeader } from '../../ui/Panel.tsx'
import { EmptyState } from '../../ui/States.tsx'
import { TabPanel, Tabs } from '../../ui/Tabs.tsx'

const STATUS_ORDER: SafetyStatus[] = ['IMPACTED', 'NOT_ANALYZED', 'CHANGED_EQUIVALENT', 'STRENGTHENED', 'NO_CHANGE']

type StatusFilter = 'ALL' | SafetyStatus

function MapView({ result }: { result: AnalysisResult }) {
  const [params, setParams] = useSearchParams()
  const reducedMotion = usePrefersReducedMotion()
  const deepSf = params.get('sf')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(deepSf ? [deepSf] : []))
  const [filter, setFilter] = useState<StatusFilter>('ALL')

  useEffect(() => {
    if (!deepSf) return
    setExpanded((prev) => (prev.has(deepSf) ? prev : new Set(prev).add(deepSf)))
    const t = setTimeout(() => document.getElementById(`sf-${deepSf}`)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }), 120)
    return () => clearTimeout(t)
  }, [deepSf, reducedMotion])

  const rows = useMemo(
    () =>
      result.safetyFunctions
        .map((sf, i) => ({ sf, i }))
        .sort((a, b) => STATUS_ORDER.indexOf(a.sf.status) - STATUS_ORDER.indexOf(b.sf.status) || a.i - b.i)
        .map(({ sf }) => sf),
    [result.safetyFunctions],
  )
  const counts = useMemo(() => {
    const c = new Map<SafetyStatus, number>()
    for (const sf of rows) c.set(sf.status, (c.get(sf.status) ?? 0) + 1)
    return c
  }, [rows])
  const shown = filter === 'ALL' ? rows : rows.filter((r) => r.status === filter)
  const protectiveBroken = rows.filter((r) => verdictLink(r.protective?.verdict) === 'broken').length
  const alarmBroken = rows.filter((r) => notificationLink(r.notification?.status) === 'broken' || r.notification?.status === 'DEGRADED').length

  const toggle = (id: string) => {
    const closing = expanded.has(id)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (closing && deepSf === id)
      setParams(
        (p) => {
          const n = new URLSearchParams(p)
          n.delete('sf')
          return n
        },
        { replace: true },
      )
  }

  if (rows.length === 0)
    return (
      <EmptyState
        title="No safety function is declared."
        body="Without declarations INTERLOCK cannot evaluate protective intent: every changed routine is reported as UNDECLARED. Add functions in the Declarations tab."
      />
    )

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <MetricRow>
        <Metric label="Declared functions" value={rows.length} detail={`${result.coverage.safetyFunctions.covered} of ${result.coverage.safetyFunctions.total} analyzed`} />
        <Metric label="Impacted" value={counts.get('IMPACTED') ?? 0} tone={(counts.get('IMPACTED') ?? 0) > 0 ? 'coral' : 'neutral'} detail="protection or notification changed for the worse" />
        <Metric label="Protective path weakened" value={protectiveBroken} tone={protectiveBroken > 0 ? 'coral' : 'neutral'} detail="firing condition lost cases" />
        <Metric label="Alarm path affected" value={alarmBroken} tone={alarmBroken > 0 ? 'marigold' : 'neutral'} detail="suppressed, broken or degraded" />
        <Metric label="Strengthened" value={counts.get('STRENGTHENED') ?? 0} tone={(counts.get('STRENGTHENED') ?? 0) > 0 ? 'sage' : 'neutral'} detail="protection now acts in more cases" />
      </MetricRow>

      <div className="flex min-w-0 flex-col gap-3">
        <div role="group" aria-label="Filter by status" className="flex min-w-0 flex-wrap gap-1.5">
          {(['ALL', ...STATUS_ORDER] as StatusFilter[])
            .filter((s) => s === 'ALL' || (counts.get(s) ?? 0) > 0)
            .map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
                className={cx(
                  'inline-flex h-8 items-center gap-2 rounded-full px-3 font-mono text-[0.6875rem] font-medium tracking-[0.06em] transition-colors duration-fast',
                  filter === s ? 'bg-ink text-paper' : 'bg-surface text-ink-2 shadow-inset-line hover:text-ink',
                )}
              >
                {s === 'ALL' ? 'ALL' : s === 'CHANGED_EQUIVALENT' ? 'CHANGED · EQUIVALENT' : enumLabel(s)}
                <span className={cx('il-num', filter === s ? 'text-paper/70' : 'text-ink-3')}>{s === 'ALL' ? rows.length : counts.get(s)}</span>
              </button>
            ))}
        </div>
        <p className="text-[0.8125rem] text-ink-2">Ordered for review: impacted functions first. Each connector shows the state of the link it stands for; the words beside it say the same.</p>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <SafetyPathHeader />
        {shown.map((sf, i) => (
          <SafetyPathRow key={sf.function.id} sf={sf} result={result} index={i} expanded={expanded.has(sf.function.id)} onToggle={() => toggle(sf.function.id)} reducedMotion={reducedMotion} />
        ))}
      </div>
    </div>
  )
}

function SafetyWorkspace({ result }: { result: AnalysisResult }) {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'declarations' ? 'declarations' : 'map'
  const wsManifest = useWorkspace((s) => s.manifest)
  const source = result.manifest
  const sourceName = wsManifest && sameManifest(wsManifest.manifest, source) ? wsManifest.name : 'safety-declarations.json'
  const [draftState, setDraftState] = useState<{ resultId: string; draft: SafetyManifest }>({ resultId: result.id, draft: source })
  // A new analysis result resets the draft to the declarations it used.
  const draft = draftState.resultId === result.id ? draftState.draft : source
  const dirty = !sameManifest(draft, source)

  const setTab = (t: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (t === 'map') n.delete('tab')
        else n.set('tab', t)
        return n
      },
      { replace: true },
    )

  const impacted = result.safetyFunctions.filter((s) => s.status === 'IMPACTED').length

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <PageHeader
        eyebrow={`Safety Map · ${plural(result.safetyFunctions.length, 'declared function')}`}
        title="Safety functions"
        description={
          impacted > 0
            ? `${plural(impacted, 'declared safety function')} ${impacted === 1 ? 'is' : 'are'} impacted by this change. Each path shows where protection and notification hold, weaken or break.`
            : 'Each declared function with its implementation, protective output, alarm and status, and the path between them.'
        }
      />
      <div className="flex min-w-0 flex-col gap-6">
        <Tabs
          label="Safety map views"
          className="overflow-y-hidden"
          idBase="safety"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'map', label: 'Safety map', count: result.safetyFunctions.length },
            { id: 'declarations', label: dirty ? 'Declarations · edited' : 'Declarations', count: draft.functions.length },
          ]}
        />
        <TabPanel idBase="safety" id="map" active={tab === 'map'}>
          <MapView result={result} />
        </TabPanel>
        <TabPanel idBase="safety" id="declarations" active={tab === 'declarations'}>
          <DeclarationsEditor result={result} source={source} sourceName={sourceName} draft={draft} onDraftChange={(m) => setDraftState({ resultId: result.id, draft: m })} />
        </TabPanel>
      </div>
    </div>
  )
}

export function SafetyMap() {
  useDocumentTitle('Safety map')
  return (
    <AnalysisGate eyebrow="Safety Map" title="Safety functions" description="Each declared function with its implementation, protective output, alarm and status, and the path between them.">
      {(result) => <SafetyWorkspace result={result} />}
    </AnalysisGate>
  )
}
