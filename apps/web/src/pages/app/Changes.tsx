/**
 * Changes — the diff experience as a progression:
 *   WHAT CHANGED → WHAT DOES IT MEAN → WHERE DOES IT PROPAGATE →
 *   WHAT SAFETY FUNCTION IS AFFECTED → WHAT SHOULD I REVIEW
 * Each step is a tab (Structural, Semantic, Propagation, Safety, Impact); the
 * view, category filter and search are kept in the URL.
 */
import { useMemo } from 'react'
import type { AnalysisResult } from '@interlock/core/types'
import { AnalysisGate } from '../../features/AnalysisGate.tsx'
import { StructuralView } from '../../features/changes/StructuralView.tsx'
import { ImpactView, PropagationView, SafetyView, SemanticView } from '../../features/changes/Views.tsx'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { useUrlFilters } from '../../lib/useUrlFilters.ts'
import { PageHeader } from '../../ui/Panel.tsx'
import { TabPanel, Tabs } from '../../ui/Tabs.tsx'
import type { TabItem } from '../../ui/Tabs.tsx'

const VIEWS = ['structural', 'semantic', 'propagation', 'safety', 'impact'] as const
type View = (typeof VIEWS)[number]

function ChangesView({ result }: { result: AnalysisResult }) {
  const { filters, setFilters, query, setQuery, params, setParams } = useUrlFilters(['cat'])
  const raw = params.get('view')
  const view: View = (VIEWS as readonly string[]).includes(raw ?? '') ? (raw as View) : 'structural'
  const setView = (v: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('view', v)
        return p
      },
      { replace: true },
    )

  const items: TabItem[] = useMemo(() => {
    const logic = result.changes.filter((c) => c.category === 'logic' || c.category === 'execution').length
    const changedModules = result.modules.filter((m) => m.changed).length
    const impacted = result.safetyFunctions.filter((s) => s.status !== 'NO_CHANGE').length
    const producing = new Set(result.findings.flatMap((f) => f.changeIds)).size
    return [
      { id: 'structural', caption: 'What changed', label: 'Structural', count: result.changes.length },
      { id: 'semantic', caption: 'What does it mean', label: 'Semantic', count: logic },
      { id: 'propagation', caption: 'Where does it propagate', label: 'Propagation', count: changedModules },
      { id: 'safety', caption: 'Which safety function', label: 'Safety', count: impacted },
      { id: 'impact', caption: 'What should I review', label: 'Impact', count: producing },
    ]
  }, [result])

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Changes"
        title="From diff to review"
        description={`${result.changes.length} changes between ${result.baseline.file.name} and ${result.current.file.name}, ${result.surface.meaningfulLogicChanges} of them meaningful logic changes. Read left to right: what changed, what it means, where it propagates, which safety function it reaches, and what to review.`}
      />
      <Tabs label="Change views" idBase="changes" items={items} value={view} onChange={setView} variant="steps" />
      <TabPanel idBase="changes" id="structural" active={view === 'structural'}>
        <StructuralView result={result} categories={filters.cat ?? []} onCategories={(cat) => setFilters({ cat })} query={query} onQuery={setQuery} />
      </TabPanel>
      <TabPanel idBase="changes" id="semantic" active={view === 'semantic'}>
        <SemanticView result={result} />
      </TabPanel>
      <TabPanel idBase="changes" id="propagation" active={view === 'propagation'}>
        <PropagationView result={result} />
      </TabPanel>
      <TabPanel idBase="changes" id="safety" active={view === 'safety'}>
        <SafetyView result={result} />
      </TabPanel>
      <TabPanel idBase="changes" id="impact" active={view === 'impact'}>
        <ImpactView result={result} />
      </TabPanel>
    </div>
  )
}

export function Changes() {
  useDocumentTitle('Changes')
  return (
    <AnalysisGate eyebrow="Changes" title="All changes" description="The complete diff between the two versions, from structure to review.">
      {(result) => <ChangesView result={result} />}
    </AnalysisGate>
  )
}
