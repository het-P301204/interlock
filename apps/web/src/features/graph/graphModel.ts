/**
 * Pure graph logic for the Reuse Graph page: indexing, filters, highlight
 * sets, impact traces and the list-view tree. No React, no React Flow, so the
 * list view (and phones) never load the canvas library.
 *
 * Everything here reads the engine's ReuseGraph as-is. Directions follow the
 * engine's edges:
 *   task -schedules-> program -calls-> routine -calls-> routine
 *   routine -instantiates-> instance <-defines- module
 *   routine|module -implements-> safety function -protects-> output
 *                                                -alarms-> alarm
 *   routine|instance -writes-> output|alarm        tag -influences-> safety function
 */
import type { GraphEdge, GraphEdgeType, GraphNode, GraphNodeType, NodeChange, ReuseGraph } from '@interlock/core/types'

/* ------------------------------------------------------------ vocabulary */

export const NODE_TYPE_LABEL: Record<GraphNodeType, string> = {
  task: 'Task',
  program: 'Program',
  routine: 'Routine',
  module: 'Module · AOI',
  instance: 'Instance',
  'safety-function': 'Safety function',
  'protective-output': 'Protective output',
  alarm: 'Alarm',
  tag: 'Tag',
}

export const NODE_TYPE_PLURAL: Record<GraphNodeType, string> = {
  task: 'Tasks',
  program: 'Programs',
  routine: 'Routines',
  module: 'Modules',
  instance: 'Instances',
  'safety-function': 'Safety functions',
  'protective-output': 'Protective outputs',
  alarm: 'Alarms',
  tag: 'Tags',
}

export const CHANGE_LABEL: Record<NodeChange, string> = {
  none: 'Unchanged',
  modified: 'Modified',
  added: 'Added',
  removed: 'Removed',
}

/** Edge families share a drawing style; the legend lists the types in each. */
export type EdgeFamily = 'structure' | 'reuse' | 'safety' | 'writes' | 'influence'

export const EDGE_FAMILY: Record<GraphEdgeType, EdgeFamily> = {
  schedules: 'structure',
  calls: 'structure',
  references: 'structure',
  instantiates: 'reuse',
  defines: 'reuse',
  implements: 'safety',
  protects: 'safety',
  alarms: 'safety',
  writes: 'writes',
  influences: 'influence',
}

export const EDGE_TYPE_DESCRIPTION: Record<GraphEdgeType, string> = {
  schedules: 'Task runs the program',
  calls: 'Program or routine calls a routine (JSR)',
  references: 'Logic reads a tag',
  instantiates: 'Routine contains a module call site',
  defines: 'Module definition backs the instance',
  implements: 'Routine or module implements the function',
  protects: 'Function acts on its protective output',
  alarms: 'Function raises its alarm',
  writes: 'Logic writes the output or alarm',
  influences: 'Tag is an input of the firing condition',
}

/** Order for list grouping and the legend. */
export const NODE_TYPE_ORDER: GraphNodeType[] = ['task', 'program', 'routine', 'module', 'instance', 'safety-function', 'protective-output', 'alarm', 'tag']

/* ----------------------------------------------------------------- index */

export interface GraphIndex {
  graph: ReuseGraph
  nodes: Map<string, GraphNode>
  out: Map<string, GraphEdge[]>
  in: Map<string, GraphEdge[]>
  edges: Map<string, GraphEdge>
}

export function buildIndex(graph: ReuseGraph): GraphIndex {
  const nodes = new Map<string, GraphNode>()
  const out = new Map<string, GraphEdge[]>()
  const inn = new Map<string, GraphEdge[]>()
  const edges = new Map<string, GraphEdge>()
  for (const n of graph.nodes) {
    nodes.set(n.id, n)
    out.set(n.id, [])
    inn.set(n.id, [])
  }
  for (const e of graph.edges) {
    // An edge to a node the graph does not carry cannot be drawn or traced.
    if (!nodes.has(e.source) || !nodes.has(e.target)) continue
    edges.set(e.id, e)
    out.get(e.source)!.push(e)
    inn.get(e.target)!.push(e)
  }
  return { graph, nodes, out, in: inn, edges }
}

/* --------------------------------------------------------------- filters */

export interface GraphFilters {
  safetyOnly: boolean
  changedOnly: boolean
  criticalOnly: boolean
  /** Highlight (not filter) logic without declared intent. */
  showUndeclared: boolean
  /**
   * Show every input tag. Off by default: unchanged tags are numerous and
   * crowd the canvas. Changed tags, tags carrying a finding, and the inputs of
   * a selected safety function are always shown.
   */
  showTags: boolean
  /** Show only this node and its direct neighbours. */
  isolate: string | null
}

export const DEFAULT_FILTERS: GraphFilters = { safetyOnly: false, changedOnly: false, criticalOnly: false, showUndeclared: false, showTags: false, isolate: null }

/** Nodes that changed, carry a finding, or sit at either end of a changed edge. */
export function changedSet(idx: GraphIndex): Set<string> {
  const s = new Set<string>()
  for (const n of idx.nodes.values()) if (n.change !== 'none' || n.severity) s.add(n.id)
  for (const e of idx.edges.values())
    if (e.changed) {
      s.add(e.source)
      s.add(e.target)
    }
  return s
}

/** CRITICAL nodes and their direct (non-influence) neighbours, so the path stays readable. */
export function criticalSet(idx: GraphIndex): Set<string> {
  const s = new Set<string>()
  for (const n of idx.nodes.values()) {
    if (n.severity !== 'CRITICAL') continue
    s.add(n.id)
    for (const e of idx.out.get(n.id) ?? []) if (e.type !== 'influences') s.add(e.target)
    for (const e of idx.in.get(n.id) ?? []) if (e.type !== 'influences') s.add(e.source)
  }
  return s
}

export function neighbourSet(idx: GraphIndex, id: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>([id])
  const edges = new Set<string>()
  for (const e of idx.out.get(id) ?? []) {
    nodes.add(e.target)
    edges.add(e.id)
  }
  for (const e of idx.in.get(id) ?? []) {
    nodes.add(e.source)
    edges.add(e.id)
  }
  return { nodes, edges }
}

export interface FilterCounts {
  tags: number
  safety: number
  changed: number
  critical: number
  undeclared: number
}

export function filterCounts(idx: GraphIndex): FilterCounts {
  let safety = 0
  let undeclared = 0
  let critical = 0
  let tags = 0
  for (const n of idx.nodes.values()) {
    if (n.type === 'tag') tags++
    if (n.safety) safety++
    if (n.undeclared) undeclared++
    if (n.severity === 'CRITICAL') critical++
  }
  return { tags, safety, changed: changedSet(idx).size, critical, undeclared }
}

/** Input tags of a safety function, revealed when it is selected even while tags are hidden. */
export function revealedTags(idx: GraphIndex, selectedId: string | null): Set<string> {
  const out = new Set<string>()
  if (!selectedId) return out
  const n = idx.nodes.get(selectedId)
  if (!n) return out
  if (n.type === 'tag') out.add(n.id)
  if (n.type === 'safety-function') for (const e of idx.in.get(n.id) ?? []) if (e.type === 'influences') out.add(e.source)
  return out
}

export function visibleNodes(idx: GraphIndex, f: GraphFilters, reveal: Set<string> = new Set()): Set<string> {
  if (f.isolate && idx.nodes.has(f.isolate)) return neighbourSet(idx, f.isolate).nodes
  const changed = f.changedOnly ? changedSet(idx) : null
  const critical = f.criticalOnly ? criticalSet(idx) : null
  const out = new Set<string>()
  for (const n of idx.nodes.values()) {
    if (n.type === 'tag' && !f.showTags && n.change === 'none' && !n.severity && !reveal.has(n.id)) continue
    if (f.safetyOnly && !n.safety) continue
    if (changed && !changed.has(n.id)) continue
    if (critical && !critical.has(n.id)) continue
    out.add(n.id)
  }
  return out
}

export function visibleEdges(idx: GraphIndex, visible: Set<string>): GraphEdge[] {
  const out: GraphEdge[] = []
  for (const e of idx.edges.values()) if (visible.has(e.source) && visible.has(e.target)) out.push(e)
  return out
}

/* ------------------------------------------------------------- highlights */

export interface Highlight {
  nodes: Set<string>
  edges: Set<string>
}

/**
 * What a click on a node highlights:
 *   module           its instances (defines), what they write, the functions it implements and their outputs/alarms
 *   safety function  its implementation, the instances bound to it, the writers of its output and alarm,
 *                    the output and alarm themselves, and every tag that influences it
 *   anything else    the node and its direct neighbours
 */
export function selectionHighlight(idx: GraphIndex, id: string): Highlight {
  const node = idx.nodes.get(id)
  if (!node) return { nodes: new Set(), edges: new Set() }
  const nodes = new Set<string>([id])
  const edges = new Set<string>()
  const take = (e: GraphEdge) => {
    edges.add(e.id)
    nodes.add(e.source)
    nodes.add(e.target)
  }

  if (node.type === 'module') {
    for (const e of idx.out.get(id) ?? []) {
      take(e)
      if (e.type === 'defines') for (const w of idx.out.get(e.target) ?? []) if (w.type === 'writes') take(w)
      if (e.type === 'implements') for (const p of idx.out.get(e.target) ?? []) if (p.type === 'protects' || p.type === 'alarms') take(p)
    }
    return { nodes, edges }
  }

  if (node.type === 'safety-function') {
    const sfId = node.safetyFunctionIds[0] ?? id.replace(/^sf:/, '')
    for (const e of idx.in.get(id) ?? []) take(e) // implements, influences
    for (const e of idx.out.get(id) ?? []) {
      take(e) // protects, alarms
      for (const w of idx.in.get(e.target) ?? []) if (w.type === 'writes') take(w)
    }
    // Module instances bound to this function, with their definition and call site.
    for (const n of idx.nodes.values()) {
      if (n.type !== 'instance' || !n.safetyFunctionIds.includes(sfId)) continue
      nodes.add(n.id)
      for (const e of idx.in.get(n.id) ?? []) if (e.type === 'defines' || e.type === 'instantiates') take(e)
      for (const e of idx.out.get(n.id) ?? []) if (e.type === 'writes' && nodes.has(e.target)) take(e)
    }
    return { nodes, edges }
  }

  return neighbourSet(idx, id)
}

export interface Trace {
  direction: 'downstream' | 'upstream'
  origin: string
  /** Hop count from the origin. */
  nodes: Map<string, number>
  /** Hop count at which the edge was traversed (1 = first hop). */
  edges: Map<string, number>
  maxDepth: number
}

/** Breadth-first trace along edge direction (downstream) or against it (upstream), within the visible subgraph. */
export function traceFrom(idx: GraphIndex, origin: string, direction: Trace['direction'], visible?: Set<string>): Trace {
  const nodes = new Map<string, number>([[origin, 0]])
  const edges = new Map<string, number>()
  let frontier = [origin]
  let depth = 0
  while (frontier.length > 0) {
    depth++
    const next: string[] = []
    for (const id of frontier) {
      const list = direction === 'downstream' ? idx.out.get(id) : idx.in.get(id)
      for (const e of list ?? []) {
        const other = direction === 'downstream' ? e.target : e.source
        if (visible && !visible.has(other)) continue
        if (!edges.has(e.id)) edges.set(e.id, depth)
        if (!nodes.has(other)) {
          nodes.set(other, depth)
          next.push(other)
        }
      }
    }
    frontier = next
  }
  let maxDepth = 0
  for (const d of nodes.values()) maxDepth = Math.max(maxDepth, d)
  return { direction, origin, nodes, edges, maxDepth }
}

/* ------------------------------------------------------------- critical */

/**
 * The graph node that best represents the top-ranked CRITICAL finding: the
 * node carrying that finding id, preferring the definition or routine that
 * changed over the functions it reaches.
 */
export function criticalFocus(idx: GraphIndex, findingIds: string[]): { nodeId: string; findingId: string } | null {
  const pref: GraphNodeType[] = ['module', 'routine', 'instance', 'safety-function', 'protective-output', 'alarm', 'program', 'task', 'tag']
  for (const fid of findingIds) {
    const carriers = [...idx.nodes.values()].filter((n) => n.findingIds.includes(fid))
    if (carriers.length === 0) continue
    carriers.sort((a, b) => {
      const ca = a.change !== 'none' ? 0 : 1
      const cb = b.change !== 'none' ? 0 : 1
      if (ca !== cb) return ca - cb
      return pref.indexOf(a.type) - pref.indexOf(b.type)
    })
    return { nodeId: carriers[0]!.id, findingId: fid }
  }
  return null
}

/* ------------------------------------------------------------- list tree */

export interface TreeItem {
  key: string
  nodeId: string
  /** How this row relates to its parent, e.g. "calls", "implemented by". */
  relation?: string
  depth: number
  children: TreeItem[]
}

export interface TreeGroup {
  id: string
  label: string
  description: string
  items: TreeItem[]
}

const CHILD_EDGES: Partial<Record<GraphNodeType, Array<{ type: GraphEdgeType; dir: 'out' | 'in'; relation: string }>>> = {
  task: [{ type: 'schedules', dir: 'out', relation: 'schedules' }],
  program: [{ type: 'calls', dir: 'out', relation: 'main routine' }],
  routine: [
    { type: 'calls', dir: 'out', relation: 'calls' },
    { type: 'instantiates', dir: 'out', relation: 'call site' },
    { type: 'writes', dir: 'out', relation: 'writes' },
  ],
  module: [{ type: 'defines', dir: 'out', relation: 'instance' }],
  instance: [{ type: 'writes', dir: 'out', relation: 'writes' }],
  'safety-function': [
    { type: 'implements', dir: 'in', relation: 'implemented by' },
    { type: 'protects', dir: 'out', relation: 'protective output' },
    { type: 'alarms', dir: 'out', relation: 'alarm' },
    { type: 'influences', dir: 'in', relation: 'input' },
  ],
}

function expand(idx: GraphIndex, visible: Set<string>, nodeId: string, key: string, depth: number, path: Set<string>, seen: Set<string>, rootType: GraphNodeType): TreeItem[] {
  const node = idx.nodes.get(nodeId)
  if (!node) return []
  const rules = CHILD_EDGES[node.type] ?? []
  const items: TreeItem[] = []
  for (const r of rules) {
    // Inside the safety-function group, implementation routines are leaves (their call tree is in Execution).
    if (rootType === 'safety-function' && depth > 1) break
    const list = r.dir === 'out' ? idx.out.get(nodeId) : idx.in.get(nodeId)
    for (const e of list ?? []) {
      if (e.type !== r.type) continue
      const child = r.dir === 'out' ? e.target : e.source
      if (!visible.has(child) || path.has(child)) continue
      seen.add(child)
      const childKey = `${key}>${child}`
      const nextPath = new Set(path).add(child)
      items.push({
        key: childKey,
        nodeId: child,
        relation: r.relation,
        depth,
        children: rootType === 'safety-function' ? [] : expand(idx, visible, child, childKey, depth + 1, nextPath, seen, rootType),
      })
    }
  }
  return items
}

/** The same graph as an indented tree: execution, reusable modules, safety functions, then anything left over. */
export function buildTree(idx: GraphIndex, visible: Set<string>): TreeGroup[] {
  const seen = new Set<string>()
  const roots = (type: GraphNodeType) => [...idx.nodes.values()].filter((n) => n.type === type && visible.has(n.id))
  const group = (type: GraphNodeType, gid: string): TreeItem[] =>
    roots(type).map((n) => {
      seen.add(n.id)
      return { key: `${gid}:${n.id}`, nodeId: n.id, depth: 0, children: expand(idx, visible, n.id, `${gid}:${n.id}`, 1, new Set([n.id]), seen, type) }
    })

  const groups: TreeGroup[] = [
    { id: 'execution', label: 'Execution', description: 'Task → program → routine → call sites and written outputs', items: group('task', 'execution') },
    { id: 'modules', label: 'Reusable modules', description: 'Module definition → every instance it backs', items: group('module', 'modules') },
    {
      id: 'functions',
      label: 'Safety functions',
      description: 'Declared function → implementation, protective output, alarm and input tags',
      items: group('safety-function', 'functions'),
    },
  ]
  const rest = [...idx.nodes.values()].filter((n) => visible.has(n.id) && !seen.has(n.id))
  if (rest.length > 0)
    groups.push({
      id: 'other',
      label: 'Not reached from a task, module or function',
      description: 'Shown so nothing in the graph is hidden by the tree layout',
      items: rest.map((n) => ({ key: `other:${n.id}`, nodeId: n.id, depth: 0, children: [] })),
    })
  return groups.filter((g) => g.items.length > 0)
}
