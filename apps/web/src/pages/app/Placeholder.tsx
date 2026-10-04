/**
 * Placeholder for workspace pages whose result views arrive with the engine
 * integration. Without an analysis they show the spec's empty state; with one
 * they say plainly that this view is not part of this build.
 */
import { ArrowRight } from 'lucide-react'
import { useParams } from 'react-router'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { useWorkspace } from '../../state/analysis.ts'
import { Badge } from '../../ui/Badge.tsx'
import { ButtonLink } from '../../ui/Button.tsx'
import { Breadcrumbs } from '../../ui/Breadcrumbs.tsx'
import { PageHeader } from '../../ui/Panel.tsx'
import { EmptyState, LoadingState } from '../../ui/States.tsx'

export type PageKey = 'projects' | 'safety' | 'graph' | 'findings' | 'finding' | 'changes' | 'drift' | 'reports'

const PAGES: Record<PageKey, { eyebrow: string; title: string; description: string }> = {
  projects: { eyebrow: 'Workspace', title: 'Projects', description: 'Project versions you have loaded in this browser, with their hashes and parser readiness.' },
  safety: {
    eyebrow: 'Safety Map',
    title: 'Safety functions',
    description: 'Each declared function with its implementation, protective output, alarm and status, and the path between them.',
  },
  graph: {
    eyebrow: 'Reuse Graph',
    title: 'Reuse graph',
    description: 'Which reusable definitions affect which runtime call sites, and which of those carry a safety function.',
  },
  findings: { eyebrow: 'Impact Review', title: 'Findings', description: 'Every finding, ranked by safety impact, with its evidence.' },
  finding: { eyebrow: 'Finding', title: 'Finding detail', description: 'What changed, what it means, where it propagates, which safety function it affects, and what to review.' },
  changes: {
    eyebrow: 'Changes',
    title: 'All changes',
    description: 'The complete structural diff between the two versions, including documentation and metadata edits.',
  },
  drift: { eyebrow: 'Drift', title: 'Cross-project module drift', description: 'The same module name across several site exports: same definition, same behaviour, or not.' },
  reports: {
    eyebrow: 'Reports',
    title: 'Reports',
    description: 'Deterministic PDF, JSON and CSV exports of the analysis, with parser and analysis metadata.',
  },
}

export function Placeholder({ page }: { page: PageKey }) {
  const meta = PAGES[page]
  const { id } = useParams()
  const result = useWorkspace((s) => s.result)
  const hydrated = useWorkspace((s) => s.hydrated)
  useDocumentTitle(page === 'finding' && id ? id : meta.title)

  return (
    <div className="flex flex-col gap-8">
      {page === 'finding' && (
        <Breadcrumbs
          items={[
            { label: 'Findings', to: '/app/findings' },
            { label: id ?? 'Finding' },
          ]}
        />
      )}
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {meta.eyebrow}
            {page === 'drift' && <Badge tone="iris">Experimental</Badge>}
          </span>
        }
        title={page === 'finding' && id ? id : meta.title}
        description={meta.description}
      />
      {!hydrated ? (
        <LoadingState variant="card" label="Loading saved analysis" />
      ) : !result ? (
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
      ) : (
        <EmptyState
          eyebrow="Not in this build"
          title="This view is not available yet."
          body="An analysis is loaded. Its summary, review order and coverage are on the Overview."
          action={
            <ButtonLink to="/app" variant="primary" iconRight={<ArrowRight />}>
              Open Overview
            </ButtonLink>
          }
        />
      )}
    </div>
  )
}
