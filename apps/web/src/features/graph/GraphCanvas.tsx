/**
 * The interactive Reuse Graph canvas (@xyflow/react + dagre). Loaded lazily
 * by the Reuse Graph page, so neither library is in the main bundle and the
 * list view / phones never download them.
 *
 * The page owns all state (filters, selection, trace) and talks to the canvas
 * declaratively: props describe what is visible and highlighted, `command`
 * (with an increasing `seq`) asks for one viewport action — zoom, fit, focus.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { FitViewOptions } from '@xyflow/react'
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './graph.css'
import type { SafetyStatus } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { EdgeMarkers, edgeTypes } from './GraphEdge.tsx'
import type { IlFlowEdge } from './GraphEdge.tsx'
import { nodeTypes } from './GraphNodes.tsx'
import type { IlFlowNode } from './GraphNodes.tsx'
import { CHANGE_LABEL, NODE_TYPE_LABEL, visibleEdges } from './graphModel.ts'
import type { GraphIndex, Highlight, Trace } from './graphModel.ts'
import { layoutGraph } from './layout.ts'

type Padding = NonNullable<FitViewOptions['padding']>

export interface CanvasCommand {
  seq: number
  kind: 'zoomIn' | 'zoomOut' | 'fit' | 'focus'
  ids?: string[]
}

export interface GraphCanvasProps {
  index: GraphIndex
  visible: Set<string>
  highlight: Highlight | null
  trace: (Trace & { key: number }) | null
  selectedId: string | null
  emphasizeUndeclared: boolean
  sfStatus: Map<string, SafetyStatus>
  reducedMotion: boolean
  command: CanvasCommand | null
  /** Nodes to frame after a re-layout (e.g. a selected function whose inputs were just revealed); all nodes when null. */
  relayoutFocus: string[] | null
  /** Width (px) of a panel floating over the canvas's right edge; framing keeps clear of it. */
  insetRight: number
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

const HOP_MS = 150

function hashKey(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function Canvas({ index, visible, highlight, trace, selectedId, emphasizeUndeclared, sfStatus, reducedMotion, command, relayoutFocus, insetRight, onSelect, onHover }: GraphCanvasProps) {
  // A deep link arrives with a focus command: skip the initial fit-all so it does not override it.
  const initialFit = useRef(command?.kind !== 'focus')
  const pad = useCallback((px: number): Padding => ({ top: `${px}px`, bottom: `${px}px`, left: `${px}px`, right: `${px + insetRight}px` }), [insetRight])
  const padRef = useRef(pad)
  padRef.current = pad
  const relayoutFocusRef = useRef(relayoutFocus)
  relayoutFocusRef.current = relayoutFocus
  const flow = useReactFlow<IlFlowNode, IlFlowEdge>()
  const done = useRef(0)
  /** Entrance delay per node, fixed when the node first appears so later re-renders never restart its animation. */
  const enterDelays = useRef(new Map<string, number>())

  const visibleKey = useMemo(() => [...visible].sort().join('\n'), [visible])
  const layout = useMemo(() => {
    const nodes = [...visible].map((id) => index.nodes.get(id)).filter((n) => n !== undefined)
    const edges = visibleEdges(index, visible)
    const positions = layoutGraph(nodes, edges)
    // First layout staggers in left to right; later layouts slide existing
    // nodes, then bring new nodes in and redraw every edge once they arrive.
    const initial = enterDelays.current.size === 0
    const enter = enterDelays.current
    for (const [id, p] of positions) if (!enter.has(id)) enter.set(id, reducedMotion ? 0 : initial ? Math.min(p.rank * 70, 560) : 300)
    const reveal = new Map<string, number>()
    for (const e of edges) reveal.set(e.id, reducedMotion ? 0 : initial ? Math.min((positions.get(e.source)?.rank ?? 0) * 70, 560) + 260 : 460)
    return { positions, edges, reveal, version: hashKey(visibleKey) }
    // visibleKey captures `visible` by value; motion preference is read once per layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, visibleKey])

  const nodes = useMemo<IlFlowNode[]>(() => {
    const out: IlFlowNode[] = []
    for (const [id, p] of layout.positions) {
      const node = index.nodes.get(id)
      if (!node) continue
      const dim = highlight ? !highlight.nodes.has(id) : false
      const reachHop = trace?.nodes.get(id)
      const sfId = node.type === 'safety-function' ? node.safetyFunctionIds[0] : undefined
      out.push({
        id,
        type: 'il',
        position: { x: p.x, y: p.y },
        className: dim ? 'is-dim' : undefined,
        focusable: true,
        selectable: false,
        draggable: false,
        ariaLabel: `${NODE_TYPE_LABEL[node.type]} ${node.label}${node.change !== 'none' ? `, ${CHANGE_LABEL[node.change].toLowerCase()}` : ''}${node.severity ? `, ${node.severity.toLowerCase()} finding` : ''}${node.undeclared ? ', undeclared' : ''}`,
        data: {
          node,
          sfStatus: sfId ? sfStatus.get(sfId) : undefined,
          selected: id === selectedId,
          reached: reachHop !== undefined && reachHop > 0,
          reachDelay: reducedMotion ? 0 : Math.max(0, (reachHop ?? 0) - 1) * HOP_MS + 380,
          enterDelay: enterDelays.current.get(id) ?? 0,
          emphUndeclared: emphasizeUndeclared && node.undeclared,
        },
      })
    }
    return out
  }, [layout, index, highlight, trace, selectedId, emphasizeUndeclared, sfStatus, reducedMotion])

  const edges = useMemo<IlFlowEdge[]>(
    () =>
      layout.edges.map((e) => {
        const hl = highlight ? highlight.edges.has(e.id) : false
        return {
          // Re-keyed per layout so every edge redraws after nodes have moved.
          id: `${e.id}@${layout.version}`,
          source: e.source,
          target: e.target,
          type: 'il',
          focusable: false,
          selectable: false,
          data: {
            edge: e,
            dim: highlight ? !hl : false,
            hl,
            revealDelay: layout.reveal.get(e.id) ?? 0,
            hop: trace?.edges.get(e.id) ?? -1,
            traceKey: trace?.key ?? 0,
            hopMs: reducedMotion ? 0 : HOP_MS,
          },
        }
      }),
    [layout, highlight, trace, reducedMotion],
  )

  const duration = reducedMotion ? 0 : 560

  // Refit after a filter change so the new subgraph is framed.
  const lastVersion = useRef(layout.version)
  useEffect(() => {
    if (lastVersion.current === layout.version) return
    lastVersion.current = layout.version
    const focusIds = relayoutFocusRef.current?.filter((id) => layout.positions.has(id))
    const pad = padRef.current
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        void flow.fitView(focusIds && focusIds.length > 0 ? { nodes: focusIds.map((id) => ({ id })), padding: pad(56), duration, maxZoom: 1.05 } : { padding: pad(32), duration, maxZoom: 1.1 }),
      ),
    )
  }, [layout.version, layout.positions, flow, duration])

  // Run each command once, as soon as its nodes are measured (polled per
  // frame, bounded). The frame is not cancelled on re-render: a command must
  // not be lost to an unrelated update.
  useEffect(() => {
    if (!command || command.seq === done.current) return
    done.current = command.seq
    const positions = layout.positions
    const ids = (command.ids ?? []).filter((id) => positions.has(id))
    const measured = () => {
      const probe = ids.length > 0 ? ids : [...positions.keys()].slice(0, 1)
      return probe.every((id) => (flow.getInternalNode(id)?.measured.width ?? 0) > 0)
    }
    let tries = 0
    const run = () => {
      if (!measured() && tries++ < 60) {
        requestAnimationFrame(run)
        return
      }
      if (command.kind === 'zoomIn') void flow.zoomIn({ duration: reducedMotion ? 0 : 240 })
      else if (command.kind === 'zoomOut') void flow.zoomOut({ duration: reducedMotion ? 0 : 240 })
      else if (command.kind === 'fit') void flow.fitView({ padding: pad(32), duration, maxZoom: 1.1 })
      else if (ids.length > 0) void flow.fitView({ nodes: ids.map((id) => ({ id })), padding: pad(ids.length === 1 ? 160 : 56), duration, maxZoom: ids.length === 1 ? 1.15 : 1.05 })
    }
    requestAnimationFrame(run)
  }, [command, flow, duration, reducedMotion, layout.positions, pad])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      if (e.key === 'Escape') {
        onSelect(null)
        return
      }
      if ((e.key === 'Enter' || e.key === ' ') && target.classList.contains('react-flow__node')) {
        e.preventDefault()
        const id = target.getAttribute('data-id')
        if (id) onSelect(id)
      }
    },
    [onSelect],
  )

  return (
    <div className="relative size-full" onKeyDown={onKeyDown}>
      <EdgeMarkers />
      <ReactFlow<IlFlowNode, IlFlowEdge>
        className="il-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={initialFit.current}
        fitViewOptions={{ padding: 0.06, maxZoom: 1.1 }}
        minZoom={0.12}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        nodesFocusable
        zoomOnDoubleClick={false}
        onNodeClick={(_, n) => onSelect(n.id)}
        onNodeMouseEnter={(_, n) => onHover(n.id)}
        onNodeMouseLeave={() => onHover(null)}
        onPaneClick={() => onSelect(null)}
        ariaLabelConfig={{ 'node.a11yDescription.default': 'Press Enter to inspect this node. The List view shows the same graph as a tree.' }}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.1} color="rgb(var(--line-strong))" />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className={cx('pointer-events-none absolute inset-0 flex items-center justify-center p-6')}>
          <p className="max-w-sm text-center text-sm text-ink-2">No node matches these filters. Clear a filter to see more of the graph.</p>
        </div>
      )}
    </div>
  )
}

export default function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
