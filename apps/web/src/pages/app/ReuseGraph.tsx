/**
 * Reuse Graph (/app/graph): which reusable definitions affect which runtime
 * call sites, and which of those carry a declared safety function.
 *
 * The canvas (React Flow + dagre) is lazy-loaded; the List view renders the
 * same graph as an accessible tree and is the default under 768px.
 * Deep link: /app/graph?node=<id> selects and centres a node; ?view=list|graph.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowLeftToLine, ArrowRightFromLine, Crosshair, Focus, LocateFixed, Maximize, Network, Rows3, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { AnalysisResult, SafetyStatus } from '@interlock/core/types'
import { AnalysisGate } from '../../features/AnalysisGate.tsx'
import type { CanvasCommand } from '../../features/graph/GraphCanvas.tsx'
import { GraphInspector } from '../../features/graph/GraphInspector.tsx'
import { GraphList } from '../../features/graph/GraphList.tsx'
import { GraphLegend, ToolButton, ToolGroup, ToolToggle } from '../../features/graph/GraphToolbar.tsx'
import {
  DEFAULT_FILTERS,
  buildIndex,
  criticalFocus,
  filterCounts,
  neighbourSet,
  revealedTags,
  selectionHighlight,
  traceFrom,
  visibleNodes,
} from '../../features/graph/graphModel.ts'
import type { GraphFilters, Highlight } from '../../features/graph/graphModel.ts'
import { cx } from '../../lib/cx.ts'
import { plural } from '../../lib/format.ts'
import { useDocumentTitle, useMediaQuery, usePrefersReducedMotion } from '../../lib/hooks.ts'
import { PageHeader } from '../../ui/Panel.tsx'
import { Sheet } from '../../ui/Sheet.tsx'
import { LoadingState } from '../../ui/States.tsx'

const GraphCanvas = lazy(() => import('../../features/graph/GraphCanvas.tsx'))

type View = 'graph' | 'list'

function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const items: Array<{ id: View; label: string; icon: typeof Network }> = [
    { id: 'graph', label: 'Graph', icon: Network },
    { id: 'list', label: 'List view', icon: Rows3 },
  ]
  return (
    <div role="group" aria-label="View" className="inline-flex rounded-[14px] bg-paper-2 p-1 shadow-inset-line">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => onChange(id)}
          className={cx(
            'inline-flex h-9 items-center gap-2 rounded-[11px] px-3.5 text-[0.8125rem] font-semibold transition-[background-color,color,box-shadow] duration-fast',
            view === id ? 'bg-surface-raised text-ink shadow-soft' : 'text-ink-2 hover:text-ink',
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

function GraphWorkspace({ result }: { result: AnalysisResult }) {
  const [params, setParams] = useSearchParams()
  const narrow = useMediaQuery('(max-width: 767px)')
  const wide = useMediaQuery('(min-width: 1024px)')
  const reducedMotion = usePrefersReducedMotion()

  const index = useMemo(() => buildIndex(result.graph), [result.graph])
  const counts = useMemo(() => filterCounts(index), [index])
  const sfStatus = useMemo(() => new Map<string, SafetyStatus>(result.safetyFunctions.map((s) => [s.function.id, s.status])), [result.safetyFunctions])

  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [trace, setTrace] = useState<{ direction: 'downstream' | 'upstream'; key: number } | null>(null)
  const [command, setCommand] = useState<CanvasCommand | null>(null)
  const seq = useRef(0)
  const issue = useCallback((c: Omit<CanvasCommand, 'seq'>) => setCommand({ ...c, seq: ++seq.current }), [])

  const paramView = params.get('view')
  const view: View = paramView === 'list' || paramView === 'graph' ? paramView : narrow ? 'list' : 'graph'
  const rawSelected = params.get('node')
  const selectedId = rawSelected && index.nodes.has(rawSelected) ? rawSelected : null
  const selected = selectedId ? index.nodes.get(selectedId)! : null

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value === null) next.delete(key)
          else next.set(key, value)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const select = useCallback(
    (id: string | null) => {
      setTrace(null)
      setParam('node', id)
    },
    [setParam],
  )

  // Deep link: centre the requested node once the canvas is ready.
  const deepLinked = useRef(false)
  useEffect(() => {
    if (deepLinked.current) return
    deepLinked.current = true
    if (selectedId) issue({ kind: 'focus', ids: [...selectionHighlight(index, selectedId).nodes] })
  }, [selectedId, issue, index])

  const visible = useMemo(() => visibleNodes(index, filters, revealedTags(index, selectedId)), [index, filters, selectedId])

  const traceResult = useMemo(() => (trace && selectedId && visible.has(selectedId) ? { ...traceFrom(index, selectedId, trace.direction, visible), key: trace.key } : null), [trace, selectedId, index, visible])

  const highlight: Highlight | null = useMemo(() => {
    if (traceResult) return { nodes: new Set(traceResult.nodes.keys()), edges: new Set(traceResult.edges.keys()) }
    if (hoverId && visible.has(hoverId)) return neighbourSet(index, hoverId)
    if (selectedId && visible.has(selectedId)) return selectionHighlight(index, selectedId)
    if (filters.showUndeclared) return { nodes: new Set([...index.nodes.values()].filter((n) => n.undeclared).map((n) => n.id)), edges: new Set() }
    return null
  }, [traceResult, hoverId, selectedId, visible, index, filters.showUndeclared])

  const toggle = (key: 'safetyOnly' | 'changedOnly' | 'criticalOnly' | 'showUndeclared' | 'showTags') => setFilters((f) => ({ ...f, [key]: !f[key] }))

  const runTrace = (direction: 'downstream' | 'upstream') => {
    if (!selectedId) return
    if (trace?.direction === direction) {
      setTrace(null)
      return
    }
    const t = traceFrom(index, selectedId, direction, visible)
    setTrace({ direction, key: Date.now() })
    issue({ kind: 'focus', ids: [...t.nodes.keys()] })
  }

  const isolate = () => {
    if (!selectedId) return
    setTrace(null)
    setFilters((f) => ({ ...f, isolate: f.isolate === selectedId ? null : selectedId }))
  }

  const critical = useMemo(
    () =>
      criticalFocus(
        index,
        result.surface.reviewOrder.filter((r) => r.severity === 'CRITICAL').map((r) => r.findingId),
      ),
    [index, result.surface.reviewOrder],
  )

  const centerCritical = () => {
    if (!critical) return
    setFilters(DEFAULT_FILTERS)
    setTrace(null)
    setParam('node', critical.nodeId)
    issue({ kind: 'focus', ids: [critical.nodeId] })
  }

  const reset = () => {
    setFilters(DEFAULT_FILTERS)
    setTrace(null)
    setParam('node', null)
    issue({ kind: 'fit' })
  }

  const changedModules = result.modules.filter((m) => m.changed)
  const anyFilter = filters.safetyOnly || filters.changedOnly || filters.criticalOnly || filters.isolate !== null
  const isolatedNode = filters.isolate ? index.nodes.get(filters.isolate) : undefined

  const status = traceResult
    ? `Tracing ${traceResult.direction === 'downstream' ? 'impact downstream' : 'upstream'} from ${selected?.label}: ${plural(traceResult.nodes.size - 1, 'node')} reached over ${plural(traceResult.maxDepth, 'hop')}.`
    : `Showing ${visible.size} of ${index.nodes.size} nodes${anyFilter ? ' (filtered)' : ''}${selected ? ` · selected ${selected.label}` : ''}.`

  const inspectorFor = (embedded: boolean) =>
    selected ? (
    <GraphInspector
      embedded={embedded}
      node={selected}
      index={index}
      result={result}
      isolated={filters.isolate === selected.id}
      traceDirection={traceResult?.direction ?? null}
      onSelect={(id) => {
        select(id)
        if (view === 'graph') issue({ kind: 'focus', ids: [id] })
      }}
      onTrace={runTrace}
      onIsolate={isolate}
      onFocus={view === 'graph' ? () => issue({ kind: 'focus', ids: highlight ? [...highlight.nodes] : [selected.id] }) : undefined}
      onClose={() => select(null)}
    />
    ) : null
  const inspector = inspectorFor(false)

  const inspectorAside = wide && view === 'list' ? (
    <div className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto il-scroll-thin">
      {inspector ?? (
        <div className="rounded-card border border-dashed border-line-strong bg-paper-2/40 p-5">
          <p className="il-label mb-2">Inspector</p>
          <p className="text-sm leading-relaxed text-ink-2">
            Select a node to see its findings, safety functions and relationships. Click a module to light up every instance it backs; click a safety function to light up its whole protective path.
          </p>
          {critical && (
            <button type="button" onClick={centerCritical} className="mt-3 text-sm font-semibold text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
              Start at the top critical finding ({critical.findingId})
            </button>
          )}
        </div>
      )}
    </div>
  ) : null

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow={`Reuse Graph · ${plural(index.nodes.size, 'node')} · ${plural(index.edges.size, 'relationship')}`}
        title="Reuse graph"
        description={
          changedModules.length > 0 ? (
            <>
              {changedModules.map((m) => (
                <span key={m.module} className="block">
                  <span className="il-ident font-mono text-[0.9em] font-semibold text-ink">{m.module}</span>: 1 definition changed → {plural(m.totals.instances, 'downstream instantiation')} affected,{' '}
                  {m.totals.safetyRelevant} safety-relevant, {m.totals.operational} operational
                  {m.totals.notExecuted > 0 ? `, ${m.totals.notExecuted} not executed` : ''}.
                </span>
              ))}
            </>
          ) : (
            'Which reusable definitions affect which runtime call sites, and which of those carry a declared safety function. No shared module changed in this analysis.'
          )
        }
        actions={<ViewSwitch view={view} onChange={(v) => setParam('view', v)} />}
      />

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          {view === 'graph' && (
            <ToolGroup label="Viewport">
              <ToolButton label="Zoom in" icon={<ZoomIn />} onClick={() => issue({ kind: 'zoomIn' })} />
              <ToolButton label="Zoom out" icon={<ZoomOut />} onClick={() => issue({ kind: 'zoomOut' })} />
              <ToolButton icon={<Maximize />} onClick={() => issue({ kind: 'fit' })}>
                Fit
              </ToolButton>
              <ToolButton icon={<Focus />} disabled={!selected} onClick={() => selected && issue({ kind: 'focus', ids: highlight ? [...highlight.nodes] : [selected.id] })}>
                Focus
              </ToolButton>
            </ToolGroup>
          )}
          <ToolGroup label="Filters">
            <ToolToggle pressed={filters.safetyOnly} onClick={() => toggle('safetyOnly')} count={counts.safety}>
              Safety only
            </ToolToggle>
            <ToolToggle pressed={filters.changedOnly} onClick={() => toggle('changedOnly')} count={counts.changed} disabled={counts.changed === 0}>
              Changed only
            </ToolToggle>
            <ToolToggle pressed={filters.criticalOnly} onClick={() => toggle('criticalOnly')} count={counts.critical} disabled={counts.critical === 0}>
              Critical only
            </ToolToggle>
            <ToolToggle pressed={filters.showTags} onClick={() => toggle('showTags')} count={counts.tags} disabled={counts.tags === 0} hint="Changed tags and the inputs of a selected function are always shown">
              All input tags
            </ToolToggle>
            <ToolToggle pressed={filters.showUndeclared} onClick={() => toggle('showUndeclared')} count={counts.undeclared} disabled={counts.undeclared === 0}>
              Show undeclared
            </ToolToggle>
          </ToolGroup>
          <ToolGroup label="Trace" className={cx(view === 'list' && !wide && 'hidden')}>
            <ToolToggle pressed={traceResult?.direction === 'downstream'} onClick={() => runTrace('downstream')} disabled={!selected} hint={selected ? undefined : 'Select a node first'}>
              <ArrowRightFromLine aria-hidden="true" className="size-4" />
              Trace impact
            </ToolToggle>
            <ToolToggle pressed={traceResult?.direction === 'upstream'} onClick={() => runTrace('upstream')} disabled={!selected} hint={selected ? undefined : 'Select a node first'}>
              <ArrowLeftToLine aria-hidden="true" className="size-4" />
              Trace upstream
            </ToolToggle>
            <ToolToggle pressed={filters.isolate !== null} onClick={isolate} disabled={!selected && filters.isolate === null}>
              <Crosshair aria-hidden="true" className="size-4" />
              Isolate
            </ToolToggle>
          </ToolGroup>
          <ToolGroup label="Navigate">
            <ToolButton icon={<LocateFixed />} onClick={centerCritical} disabled={!critical}>
              Center on critical finding
            </ToolButton>
            <ToolButton icon={<RotateCcw />} onClick={reset}>
              Reset
            </ToolButton>
          </ToolGroup>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p aria-live="polite" className="il-ident min-w-0 font-mono text-xs text-ink-2">
            {status}
          </p>
          {isolatedNode && (
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, isolate: null }))}
              className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-ink/[0.07] px-2.5 font-mono text-[0.6875rem] text-ink ring-1 ring-inset ring-ink/10 hover:bg-ink/[0.1]"
            >
              <span className="truncate">Isolated: {isolatedNode.label}</span>
              <X aria-hidden="true" className="size-3 shrink-0" />
              <span className="sr-only">Clear isolation</span>
            </button>
          )}
        </div>
      </div>

      <div className={cx('grid min-w-0 grid-cols-1 gap-5', inspectorAside && 'grid-cols-[minmax(0,1fr)_22rem]')}>
        <div className="flex min-w-0 flex-col gap-5">
          {view === 'graph' ? (
            <div className="relative h-[clamp(480px,calc(100dvh-17rem),920px)] min-w-0 overflow-hidden rounded-panel shadow-inset-line">
              <Suspense fallback={<LoadingState variant="card" label="Loading graph canvas" className="p-6" />}>
                <GraphCanvas
                  index={index}
                  visible={visible}
                  highlight={highlight}
                  trace={traceResult}
                  selectedId={selectedId}
                  emphasizeUndeclared={filters.showUndeclared}
                  sfStatus={sfStatus}
                  reducedMotion={reducedMotion}
                  command={command}
                  relayoutFocus={selectedId && highlight ? [...highlight.nodes] : null}
                  onSelect={select}
                  onHover={setHoverId}
                  insetRight={wide && selected ? 344 : 0}
                />
              </Suspense>
              {wide && inspector && (
                <div className="il-scroll-thin absolute bottom-3 right-3 top-3 z-10 w-[21rem] overflow-y-auto rounded-card shadow-overlay">{inspector}</div>
              )}
            </div>
          ) : (
            <GraphList index={index} visible={visible} selectedId={selectedId} highlight={traceResult || (selectedId && filters.showUndeclared) ? highlight : null} sfStatus={sfStatus} onSelect={select} />
          )}
          {!wide && view === 'graph' && inspector}
          {view === 'graph' && <GraphLegend />}
        </div>
        {inspectorAside}
      </div>

      {!wide && view === 'list' && (
        <Sheet open={selected !== null} onClose={() => select(null)} side="bottom" title={selected?.label ?? ''} eyebrow="Inspector">
          {inspectorFor(true)}
        </Sheet>
      )}
    </div>
  )
}

export function ReuseGraph() {
  useDocumentTitle('Reuse graph')
  return (
    <AnalysisGate eyebrow="Reuse Graph" title="Reuse graph" description="Which reusable definitions affect which runtime call sites, and which of those carry a safety function.">
      {(result) => <GraphWorkspace result={result} />}
    </AnalysisGate>
  )
}
