/**
 * Left-to-right layered layout with dagre. Ranks follow edge direction, so
 * execution reads task → program → routine → instance (with its module
 * definition alongside the call sites), and declared safety functions sit to
 * the right of their implementation with outputs and alarms after them.
 */
import { Graph, layout } from '@dagrejs/dagre'
import type { GraphEdge, GraphNode, GraphNodeType } from '@interlock/core/types'

export const NODE_SIZE: Record<GraphNodeType, { width: number; height: number }> = {
  task: { width: 184, height: 64 },
  program: { width: 184, height: 64 },
  routine: { width: 204, height: 74 },
  module: { width: 232, height: 82 },
  instance: { width: 204, height: 74 },
  'safety-function': { width: 248, height: 84 },
  'protective-output': { width: 212, height: 74 },
  alarm: { width: 212, height: 74 },
  tag: { width: 196, height: 38 },
}

export interface Positioned {
  x: number
  y: number
  /** Column index (0 = leftmost), used to stagger entrance motion left to right. */
  rank: number
}

export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Positioned> {
  const g = new Graph()
  g.setGraph({ rankdir: 'LR', ranksep: 70, nodesep: 14, edgesep: 10, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { ...NODE_SIZE[n.type] })
  for (const e of edges) {
    // Influence edges are numerous; weight structural edges higher so the
    // execution spine stays straight and tags gather beside their functions.
    g.setEdge(e.source, e.target, { weight: e.type === 'influences' ? 1 : e.type === 'defines' || e.type === 'instantiates' ? 4 : 2, minlen: 1 })
  }
  layout(g)

  const xs = new Set<number>()
  const raw = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const p = g.node(n.id) as { x: number; y: number } | undefined
    if (!p) continue
    const size = NODE_SIZE[n.type]
    // dagre gives centres; React Flow positions the top-left corner.
    raw.set(n.id, { x: p.x - size.width / 2, y: p.y - size.height / 2 })
    xs.add(Math.round(p.x))
  }
  const columns = [...xs].sort((a, b) => a - b)
  const out = new Map<string, Positioned>()
  for (const n of nodes) {
    const p = raw.get(n.id)
    if (!p) continue
    const cx = Math.round(p.x + NODE_SIZE[n.type].width / 2)
    out.set(n.id, { x: p.x, y: p.y, rank: Math.max(0, columns.indexOf(cx)) })
  }
  return out
}
