/**
 * Inspector for the selected graph node: what it is, whether it changed,
 * which findings and safety functions it carries, its relationships (each a
 * button that moves the selection, so the graph is walkable by keyboard),
 * and its engine metadata. Every value is read from the AnalysisResult.
 */
import { Link } from 'react-router'
import { ArrowLeftToLine, ArrowRightFromLine, Crosshair, Focus, X } from 'lucide-react'
import type { AnalysisResult, GraphEdge, GraphNode } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { SeverityBadge, StatusPill } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { IconButton } from '../../ui/IconButton.tsx'
import { KeyValue } from '../../ui/Panel.tsx'
import { CHANGE_LABEL, EDGE_TYPE_DESCRIPTION, NODE_TYPE_LABEL } from './graphModel.ts'
import type { GraphIndex } from './graphModel.ts'
import { ChangeMarker, ScopeMarker, TypeIcon } from './nodeVisual.tsx'

export interface InspectorProps {
  node: GraphNode
  index: GraphIndex
  result: AnalysisResult
  isolated: boolean
  traceDirection: 'downstream' | 'upstream' | null
  onSelect: (id: string) => void
  onTrace: (dir: 'downstream' | 'upstream') => void
  onIsolate: () => void
  onFocus?: () => void
  onClose: () => void
  /** Inside a sheet that already has a title and close button: no frame, no header close. */
  embedded?: boolean
  className?: string
}

const META_LABEL: Record<string, string> = {
  instances: 'Instances',
  module: 'Module',
  routineId: 'Routine',
  relevance: 'Relevance',
  criticality: 'Criticality',
  kind: 'Kind',
  container: 'Container',
  executed: 'Executed',
  priority: 'Priority',
  type: 'Type',
}

function Relations({ title, edges, side, index, onSelect }: { title: string; edges: GraphEdge[]; side: 'source' | 'target'; index: GraphIndex; onSelect: (id: string) => void }) {
  if (edges.length === 0) return null
  return (
    <div className="min-w-0">
      <p className="il-label mb-1.5">
        {title} <span className="il-num text-ink-3">({edges.length})</span>
      </p>
      <ul className="flex flex-col">
        {edges.slice(0, 40).map((e) => {
          const other = index.nodes.get(e[side])
          if (!other) return null
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onSelect(other.id)}
                title={EDGE_TYPE_DESCRIPTION[e.type]}
                className="group flex w-full min-w-0 items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-ink/[0.05]"
              >
                <TypeIcon type={other.type} className="text-ink-3 group-hover:text-ink" />
                <span className="il-ident min-w-0 flex-1 truncate font-mono text-xs text-ink">{other.label}</span>
                <span className={cx('shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.06em]', e.changed ? 'font-semibold text-marigold-ink' : 'text-ink-3')}>
                  {e.changed && <span aria-hidden="true">Δ </span>}
                  {e.type}
                  {e.changed && <span className="sr-only"> (changed)</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {edges.length > 40 && <p className="mt-1 px-2 font-mono text-[0.6875rem] text-ink-2">+{edges.length - 40} more</p>}
    </div>
  )
}

export function GraphInspector({ node, index, result, isolated, traceDirection, onSelect, onTrace, onIsolate, onFocus, onClose, embedded = false, className }: InspectorProps) {
  const findings = node.findingIds.map((id) => result.findings.find((f) => f.id === id)).filter((f) => f !== undefined)
  const sfs = node.safetyFunctionIds.map((id) => result.safetyFunctions.find((s) => s.function.id === id)).filter((s) => s !== undefined)
  const incoming = index.in.get(node.id) ?? []
  const outgoing = index.out.get(node.id) ?? []
  const meta = Object.entries(node.meta).filter(([, v]) => v !== '')

  return (
    <aside aria-label={`Inspector: ${node.label}`} className={cx('flex min-w-0 flex-col gap-5', !embedded && 'rounded-card bg-surface p-5 shadow-inset-line', className)}>
      <header className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="il-label flex items-center gap-1.5">
            <TypeIcon type={node.type} />
            {NODE_TYPE_LABEL[node.type]}
          </p>
          {!embedded && <h2 className="il-ident mt-1.5 font-mono text-[1.0625rem] font-semibold leading-snug text-ink">{node.label}</h2>}
          {node.sublabel && <p className="il-ident mt-0.5 font-mono text-xs text-ink-2">{node.sublabel}</p>}
        </div>
        {!embedded && (
          <IconButton label="Close inspector" size="sm" onClick={onClose} tooltip={false} className="-mr-1.5 -mt-1">
            <X />
          </IconButton>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        {node.change !== 'none' ? <ChangeMarker change={node.change} /> : node.type !== 'safety-function' && <span className="font-mono text-[0.6875rem] text-ink-2">{CHANGE_LABEL.none}</span>}
        {node.severity && <SeverityBadge severity={node.severity} />}
        <ScopeMarker node={node} />
      </div>

      {node.undeclared && (
        <p className="rounded-input border border-dashed border-line-strong px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">UNDECLARED</span> — No safety intent has been declared for this logic. INTERLOCK therefore cannot conclude that it is safe.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant={traceDirection === 'downstream' ? 'primary' : 'secondary'} aria-pressed={traceDirection === 'downstream'} iconLeft={<ArrowRightFromLine />} onClick={() => onTrace('downstream')}>
          Trace impact
        </Button>
        <Button size="sm" variant={traceDirection === 'upstream' ? 'primary' : 'secondary'} aria-pressed={traceDirection === 'upstream'} iconLeft={<ArrowLeftToLine />} onClick={() => onTrace('upstream')}>
          Trace upstream
        </Button>
        <Button size="sm" variant={isolated ? 'primary' : 'secondary'} aria-pressed={isolated} iconLeft={<Crosshair />} onClick={onIsolate}>
          {isolated ? 'Isolated' : 'Isolate'}
        </Button>
        {onFocus && (
          <Button size="sm" variant="secondary" iconLeft={<Focus />} onClick={onFocus}>
            Focus
          </Button>
        )}
      </div>

      {sfs.length > 0 && (
        <div className="min-w-0">
          <p className="il-label mb-2">Safety functions</p>
          <ul className="flex flex-col gap-2">
            {sfs.map((s) => (
              <li key={s.function.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <Link to={`/app/safety?sf=${encodeURIComponent(s.function.id)}`} className="il-ident min-w-0 text-sm font-semibold text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
                  <span className="font-mono text-xs font-medium text-ink-2">{s.function.id}</span> {s.function.name}
                </Link>
                <StatusPill status={s.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-w-0">
        <p className="il-label mb-2">Findings</p>
        {findings.length === 0 ? (
          <p className="text-[0.8125rem] text-ink-2">No finding is attached to this node.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-input bg-paper-2/50 shadow-inset-line">
            {findings.map((f) => (
              <li key={f.id}>
                <Link to={`/app/findings/${encodeURIComponent(f.id)}`} className="flex min-w-0 flex-col gap-1 px-3.5 py-2.5 hover:bg-paper-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-ink">{f.id}</span>
                    <SeverityBadge severity={f.severity} />
                  </span>
                  <span className="il-ident text-[0.8125rem] leading-snug text-ink">{f.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Relations title="Incoming" edges={incoming} side="source" index={index} onSelect={onSelect} />
      <Relations title="Outgoing" edges={outgoing} side="target" index={index} onSelect={onSelect} />

      {meta.length > 0 && (
        <div className="min-w-0 border-t border-line pt-4">
          <p className="il-label mb-2">Engine metadata</p>
          <KeyValue items={meta.map(([k, v]) => [META_LABEL[k] ?? k, v])} />
        </div>
      )}
      <p className="il-ident font-mono text-[0.625rem] text-ink-3">{node.id}</p>
    </aside>
  )
}
