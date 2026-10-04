/**
 * AnalysisGate — renders its children only when an analysis is loaded.
 *
 *   <AnalysisGate eyebrow="Impact Review" title="Findings" description="…">
 *     {(result) => <FindingsView result={result} />}
 *   </AnalysisGate>
 *
 * While saved results hydrate from IndexedDB it shows skeletons; with no
 * analysis it shows the spec's empty state and the page header, so every
 * route stays navigable.
 */
import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import type { AnalysisResult } from '@interlock/core/types'
import { useWorkspace } from '../state/analysis.ts'
import { ButtonLink } from '../ui/Button.tsx'
import { PageHeader } from '../ui/Panel.tsx'
import { EmptyState, LoadingState } from '../ui/States.tsx'

export function NothingAnalyzed() {
  return (
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
  )
}

export function AnalysisGate({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: ReactNode
  title: ReactNode
  description?: ReactNode
  children: (result: AnalysisResult) => ReactNode
}) {
  const result = useWorkspace((s) => s.result)
  const hydrated = useWorkspace((s) => s.hydrated)
  if (result) return <>{children(result)}</>
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      {hydrated ? <NothingAnalyzed /> : <LoadingState variant="page" label="Loading saved analysis" />}
    </div>
  )
}
