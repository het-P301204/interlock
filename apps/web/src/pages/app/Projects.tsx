/**
 * Projects — project versions inspected in this browser. Only metadata is
 * remembered (never file contents). A version can be reused in a new analysis:
 * directly while its file is still open in this session, or by choosing the
 * file again, in which case the SHA-256 is checked against the record.
 */
import { useRef } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import type { Side } from '@interlock/core/types'
import { formatBytes, formatTimestamp, shortHash } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { projectFiles, useWorkspace } from '../../state/analysis.ts'
import type { ProjectRecord } from '../../state/analysis.ts'
import { StatusPill } from '../../ui/Badge.tsx'
import { Button, ButtonLink } from '../../ui/Button.tsx'
import { DataTable } from '../../ui/DataTable.tsx'
import type { Column } from '../../ui/DataTable.tsx'
import { PageHeader } from '../../ui/Panel.tsx'
import { EmptyState, LoadingState } from '../../ui/States.tsx'
import { toast } from '../../ui/Toast.tsx'

export function Projects() {
  useDocumentTitle('Projects')
  const navigate = useNavigate()
  const projects = useWorkspace((s) => s.projects)
  const hydrated = useWorkspace((s) => s.hydrated)
  const loadSide = useWorkspace((s) => s.loadSide)
  const inputRef = useRef<HTMLInputElement>(null)
  const pending = useRef<{ side: Side; rec: ProjectRecord } | null>(null)

  const use = (rec: ProjectRecord, side: Side) => {
    const file = projectFiles.get(rec.sha256)
    if (file) {
      void loadSide(side, file)
      navigate('/app/new')
      return
    }
    pending.current = { side, rec }
    inputRef.current?.click()
  }

  const onPicked = async (file: File) => {
    const p = pending.current
    pending.current = null
    if (!p) return
    navigate('/app/new')
    await loadSide(p.side, file)
    const loaded = useWorkspace.getState()[p.side]
    if (loaded.sha256 && loaded.sha256 !== p.rec.sha256)
      toast({
        title: 'This is a different version',
        body: `${file.name} does not match the recorded SHA-256 of ${p.rec.name}. It was loaded as chosen.`,
        tone: 'error',
      })
  }

  const columns: Column<ProjectRecord>[] = [
    {
      key: 'name',
      header: 'Project file',
      primary: true,
      cell: (p) => (
        <span className="flex min-w-0 flex-col">
          <span className="il-ident font-semibold text-ink">{p.name}</span>
          <span className="il-ident font-mono text-[0.6875rem] font-normal text-ink-2">{p.formatLabel}</span>
        </span>
      ),
      sortValue: (p) => p.name.toLowerCase(),
    },
    {
      key: 'controller',
      header: 'Controller',
      cell: (p) => (
        <span className="flex flex-col">
          <span className="il-ident font-mono text-data text-ink">{p.controllerName}</span>
          <span className="font-mono text-[0.6875rem] text-ink-2">
            {[p.processorType, p.firmwareRevision && `fw ${p.firmwareRevision}`].filter(Boolean).join(' · ')}
          </span>
        </span>
      ),
      sortValue: (p) => p.controllerName,
    },
    { key: 'sha', header: 'SHA-256', cell: (p) => <span className="whitespace-nowrap" title={p.sha256}>{shortHash(p.sha256, 8, 4)}</span>, mono: true },
    { key: 'size', header: 'Size', cell: (p) => <span className="whitespace-nowrap">{formatBytes(p.sizeBytes)}</span>, sortValue: (p) => p.sizeBytes, mono: true, align: 'right' },
    { key: 'ready', header: 'Readiness', cell: (p) => <StatusPill status={p.readiness} /> },
    { key: 'when', header: 'Inspected', cell: (p) => <span className="whitespace-nowrap">{formatTimestamp(p.inspectedAt)}</span>, sortValue: (p) => p.inspectedAt, mono: true },
    {
      key: 'use',
      header: 'Reuse',
      cell: (p) => (
        <span className="flex gap-1.5 sm:flex-nowrap">
          <Button size="sm" variant="secondary" disabled={p.readiness === 'BLOCKED'} onClick={() => use(p, 'baseline')} aria-label={`Use ${p.name} as baseline`}>
            Baseline
          </Button>
          <Button size="sm" variant="secondary" disabled={p.readiness === 'BLOCKED'} onClick={() => use(p, 'current')} aria-label={`Use ${p.name} as current`}>
            Current
          </Button>
          {!projectFiles.has(p.sha256) && <span className="sr-only">You will be asked to choose the file again.</span>}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Project versions inspected in this browser, with their hashes and parser readiness. Only this metadata is kept; file contents are never stored."
        actions={
          <ButtonLink to="/app/new" variant="primary" iconRight={<ArrowRight />}>
            New analysis
          </ButtonLink>
        }
      />
      <input
        ref={inputRef}
        type="file"
        accept=".L5X,.l5x,.xml"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onPicked(f)
          e.target.value = ''
        }}
      />
      {!hydrated ? (
        <LoadingState variant="table" label="Loading project versions" />
      ) : (
        <>
          <DataTable
            caption="Project versions"
            rows={projects}
            rowKey={(p) => p.sha256}
            columns={columns}
            initialSort={{ key: 'when', dir: 'desc' }}
            empty={
              <EmptyState
                title="No project versions inspected yet."
                body="Every L5X export you load for an analysis is listed here with its SHA-256, controller and readiness."
                action={
                  <ButtonLink to="/app/new" variant="primary" iconRight={<ArrowRight />}>
                    Start Analysis
                  </ButtonLink>
                }
              />
            }
          />
          {projects.length > 0 && (
            <p className="font-mono text-xs text-ink-2">
              Files open in this session can be reused directly. For others, INTERLOCK asks you to choose the file again and checks its SHA-256 against the record.
            </p>
          )}
        </>
      )}
    </div>
  )
}
