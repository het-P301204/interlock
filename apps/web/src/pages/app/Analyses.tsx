/** Analyses saved in this browser (IndexedDB history). */
import { useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { formatTimestamp } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { useWorkspace } from '../../state/analysis.ts'
import type { HistoryEntry } from '../../state/analysis.ts'
import { SeverityBadge, StatusPill } from '../../ui/Badge.tsx'
import { ButtonLink } from '../../ui/Button.tsx'
import { DataTable } from '../../ui/DataTable.tsx'
import type { Column } from '../../ui/DataTable.tsx'
import { PageHeader } from '../../ui/Panel.tsx'
import { EmptyState, LoadingState } from '../../ui/States.tsx'
import { toast } from '../../ui/Toast.tsx'
import { SEVERITY_ORDER } from '@interlock/core/types'

const priorityRank = (p: HistoryEntry['priority']) => (p === 'NONE' ? SEVERITY_ORDER.length : SEVERITY_ORDER.indexOf(p))

export function Analyses() {
  useDocumentTitle('Analyses')
  const navigate = useNavigate()
  const history = useWorkspace((s) => s.history)
  const hydrated = useWorkspace((s) => s.hydrated)
  const openResult = useWorkspace((s) => s.openResult)

  const columns: Column<HistoryEntry>[] = [
    {
      key: 'versions',
      header: 'Versions',
      primary: true,
      cell: (h) => (
        <span className="font-mono text-data">
          {h.baselineName} <span className="text-ink-3">→</span> {h.currentName}
        </span>
      ),
      sortValue: (h) => h.currentName,
    },
    { key: 'when', header: 'Analyzed', cell: (h) => formatTimestamp(h.analyzedAt), sortValue: (h) => h.analyzedAt, mono: true },
    { key: 'priority', header: 'Priority', cell: (h) => (h.priority === 'NONE' ? <StatusPill status="NO_CHANGE" label="NONE" /> : <SeverityBadge severity={h.priority} />), sortValue: (h) => priorityRank(h.priority) },
    { key: 'findings', header: 'Findings', cell: (h) => h.findings, sortValue: (h) => h.findings, align: 'right', mono: true },
    { key: 'changes', header: 'Changes', cell: (h) => h.totalChanges, sortValue: (h) => h.totalChanges, align: 'right', mono: true },
    { key: 'trust', header: 'Trust', cell: (h) => <StatusPill status={h.trust} /> },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Analyses"
        title="Saved in this browser"
        description="Results are kept in this browser’s IndexedDB. Project files themselves are never stored."
        actions={
          <ButtonLink to="/app/new" variant="primary" iconRight={<ArrowRight />}>
            New analysis
          </ButtonLink>
        }
      />
      {!hydrated ? (
        <LoadingState variant="table" label="Loading saved analyses" />
      ) : (
        <DataTable
          caption="Saved analyses"
          rows={history}
          rowKey={(h) => h.id}
          rowLabel={(h) => `Open analysis of ${h.baselineName} and ${h.currentName}`}
          initialSort={{ key: 'when', dir: 'desc' }}
          columns={columns}
          onRowClick={async (h) => {
            if (await openResult(h.id)) navigate('/app')
            else toast({ title: 'This analysis is no longer stored', body: 'Browser storage was cleared or is unavailable. Run the analysis again.', tone: 'error' })
          }}
          empty={
            <EmptyState
              title="Nothing analyzed yet."
              body="Import a known-good PLC project and a current export to reveal changes that matter."
              action={
                <ButtonLink to="/app/new" variant="primary" iconRight={<ArrowRight />}>
                  Start Analysis
                </ButtonLink>
              }
            />
          }
        />
      )}
    </div>
  )
}
