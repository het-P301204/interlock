/**
 * The reuse graph: which reusable definitions affect which runtime call
 * sites, and how execution reaches them.
 *
 *   task ─schedules→ program ─calls→ routine ─calls→ routine (JSR)
 *   routine ─instantiates→ instance ←defines─ module
 *   instance/routine ─writes→ protective output ←protects─ safety function
 *   routine ─writes→ alarm ←alarms─ safety function
 *   tag ─influences→ safety function            (primary inputs of the firing condition)
 *   routine/module ─implements→ safety function (declared)
 *
 * Built from the current project; routines and instances that only exist in
 * the baseline are kept and marked removed so a deletion stays visible.
 */
import type { Finding, GraphEdge, GraphEdgeType, GraphNode, GraphNodeType, NodeChange, ReuseGraph, Severity } from '../model/analysis.ts'
import { SEVERITY_ORDER } from '../model/analysis.ts'
import { instructionsOf, parseRung } from '../logic/rll.ts'
import type { DiffChange } from './diff.ts'
import { lc } from './project-index.ts'
import type { RuleContext } from './rules/types.ts'

export function buildGraph(ctx: RuleContext, changes: DiffChange[], findings: Finding[]): ReuseGraph {
  const nodes = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()
  const ci = ctx.current.index
  const bi = ctx.baseline.index

  const changedAnchors = new Map<string, NodeChange>()
  for (const c of changes) {
    if (c.category === 'documentation' || c.category === 'metadata' || c.category === 'data') continue
    if (c.semantic === 'equivalent') continue
    const mark: NodeChange = c.op === 'added' ? 'added' : c.op === 'removed' ? 'removed' : 'modified'
    for (const a of [...(c.anchors.current ?? []), ...(c.anchors.baseline ?? [])]) {
      if (!changedAnchors.has(a) || mark === 'modified') changedAnchors.set(a, changedAnchors.get(a) === 'modified' ? 'modified' : mark)
    }
    if (c.entity.routineId) {
      const k = `routine:${c.entity.routineId}`
      changedAnchors.set(k, c.entity.type === 'routine' ? mark : 'modified')
    }
  }

  const sfFor = (anchor: string) => ctx.sfIdsForAnchor(anchor)
  const findingsFor = (pred: (f: Finding) => boolean) => findings.filter(pred)
  const worst = (fs: Finding[]): Severity | undefined => {
    const reviewish = fs.filter((f) => f.disposition === 'REVIEW' || f.disposition === 'UNDECLARED')
    return reviewish.length ? SEVERITY_ORDER.find((s) => reviewish.some((f) => f.severity === s)) : undefined
  }

  const addNode = (id: string, type: GraphNodeType, label: string, opts: Partial<GraphNode> = {}) => {
    if (nodes.has(id)) return nodes.get(id)!
    const n: GraphNode = { id, type, label, change: 'none', safety: false, undeclared: false, findingIds: [], safetyFunctionIds: [], meta: {}, ...opts }
    nodes.set(id, n)
    return n
  }
  const addEdge = (source: string, target: string, type: GraphEdgeType, changed = false) => {
    if (!nodes.has(source) || !nodes.has(target)) return
    const id = `${type}:${source}->${target}`
    const existing = edges.get(id)
    if (existing) {
      existing.changed ||= changed
      return
    }
    edges.set(id, { id, source, target, type, changed, safety: false })
  }

  /* tasks and programs */
  for (const t of ctx.current.index.project.tasks) {
    addNode(`task:${lc(t.name)}`, 'task', t.name, {
      sublabel: `${t.type.toLowerCase()}${t.rate ? ` · ${t.rate} ms` : ''}${t.inhibited ? ' · inhibited' : ''}`,
      change: changedAnchors.get(`task:${lc(t.name)}`) ?? 'none',
      meta: { priority: String(t.priority ?? ''), type: t.type },
    })
  }
  for (const p of ctx.current.index.project.programs) {
    const id = `program:${lc(p.name)}`
    addNode(id, 'program', p.name, { sublabel: p.disabled ? 'disabled' : `main: ${p.mainRoutine ?? '—'}`, change: changedAnchors.get(id) ?? 'none' })
    const task = ci.programTask.get(lc(p.name))
    if (task) addEdge(`task:${lc(task)}`, id, 'schedules', changedAnchors.has(`task:${lc(task)}`))
  }

  /* routines (current, plus removed ones from the baseline) */
  const routineNode = (r: { id: string; name: string; kind: string; container: { kind: string; name: string } }, removed: boolean) => {
    const id = `routine:${r.id}`
    const executed = ctx.current.scan.executedRoutines.has(r.id)
    const n = addNode(id, 'routine', r.name, {
      sublabel: `${r.container.name} · ${r.kind}${!removed && !executed && r.container.kind === 'program' ? ' · not executed' : ''}`,
      change: removed ? 'removed' : (changedAnchors.get(id) ?? 'none'),
      meta: { container: r.container.name, kind: r.kind, executed: String(executed) },
    })
    n.safetyFunctionIds = sfFor(id)
    return n
  }
  for (const r of ci.project.routines) if (r.container.kind === 'program') routineNode(r, false)
  for (const r of bi.project.routines) if (r.container.kind === 'program' && !ci.routines.has(r.id)) routineNode(r, true)
  for (const p of ci.project.programs) {
    if (!p.mainRoutine) continue
    const main = ci.routine(p.name, p.mainRoutine)
    if (main) addEdge(`program:${lc(p.name)}`, `routine:${main.id}`, 'calls')
  }
  // JSR edges from the rung text (both projects, so a removed call is visible).
  const jsrEdges = (idx: typeof ci, side: 'baseline' | 'current') => {
    for (const r of idx.project.routines) {
      if (r.kind !== 'RLL' || r.container.kind !== 'program') continue
      for (const rung of r.rungs) {
        for (const ins of instructionsOf(parseRung(rung.text).elements)) {
          if (ins.mnemonic !== 'JSR') continue
          const target = idx.routine(r.container.name, ins.operands[0] ?? '')
          if (!target) continue
          const existsInOther = (side === 'baseline' ? ci : bi).routine(r.container.name, ins.operands[0] ?? '')
          addEdge(`routine:${r.id}`, `routine:${target.id}`, 'calls', side === 'baseline' && !hasJsr(ci, r.id, target.name) ? true : !existsInOther)
        }
      }
    }
  }
  jsrEdges(ctx.current.index, 'current')
  jsrEdges(ctx.baseline.index, 'baseline')

  /* modules and instances */
  for (const m of ctx.modules) {
    const mid = `module:${lc(m.name)}`
    addNode(mid, 'module', m.name, {
      sublabel: `rev ${m.revisionAfter ?? m.revisionBefore ?? '—'}${m.revisionBefore && m.revisionAfter && m.revisionBefore !== m.revisionAfter ? ` (was ${m.revisionBefore})` : ''} · ${m.instances.length} instance${m.instances.length === 1 ? '' : 's'}`,
      change: m.changed ? 'modified' : 'none',
      meta: { instances: String(m.instances.length) },
    })
    for (const inst of m.instances) {
      const iid = `instance:${inst.backingLoc}`
      const n = addNode(iid, 'instance', inst.backingLabel, {
        sublabel: `${inst.program}/${inst.routineId.split('/').pop()} · rung ${inst.rung}${inst.executed ? '' : ' · not executed'}`,
        change: m.changed ? 'modified' : 'none',
        meta: { module: m.name, routineId: inst.routineId, relevance: inst.executed ? (inst.safetyFunctionIds.length ? 'safety' : 'operational') : 'not-executed' },
      })
      n.safetyFunctionIds = inst.safetyFunctionIds
      addEdge(mid, iid, 'defines', m.changed)
      addEdge(`routine:${inst.routineId}`, iid, 'instantiates', changedAnchors.has(`rung:${inst.routineId}#${inst.rung}`))
    }
  }

  /* safety functions, outputs, alarms, influencing tags */
  for (const a of ctx.sf) {
    const sid = `sf:${a.sf.id}`
    const sfFindings = findingsFor((f) => f.safetyFunctionIds.includes(a.sf.id))
    addNode(sid, 'safety-function', a.sf.name, {
      sublabel: `${a.sf.id} · ${a.sf.kind.toLowerCase()} · ${a.sf.criticality.toLowerCase()}`,
      safety: true,
      safetyFunctionIds: [a.sf.id],
      findingIds: sfFindings.map((f) => f.id),
      ...(worst(sfFindings) ? { severity: worst(sfFindings)! } : {}),
      meta: { criticality: a.sf.criticality, kind: a.sf.kind },
    })
    const impl = a.sf.implementation
    if (impl.program && impl.routine) {
      const r = ci.routine(impl.program, impl.routine)
      if (r) addEdge(`routine:${r.id}`, sid, 'implements')
    }
    if (impl.module) addEdge(`module:${lc(impl.module)}`, sid, 'implements')
    if (a.protective) {
      const oid = `output:${a.protective.outC.loc}`
      addNode(oid, 'protective-output', a.protective.outC.label, {
        sublabel: a.sf.protectiveOutput?.tripState === 'ENERGIZE' ? 'energize to act' : 'de-energize to act',
        safety: true,
        safetyFunctionIds: [a.sf.id],
        change: a.protective.newWriters.length || a.protective.lostWriters.length ? 'modified' : 'none',
      })
      addEdge(sid, oid, 'protects', a.protective.raw.verdict !== 'UNCHANGED')
      for (const w of [...a.protective.writersC]) {
        const site = ctx.callSites.current.find((cs) => cs.routineId === w.routineId && cs.rung === w.rung && w.kind === 'MODULE_OUTPUT')
        const src = site ? `instance:${site.backingLoc}` : `routine:${w.routineId}`
        addEdge(src, oid, 'writes', a.protective.newWriters.includes(w))
      }
      for (const w of a.protective.lostWriters) addEdge(`routine:${w.routineId}`, oid, 'writes', true)
      for (const atomIdx of ctx.pool.atomsOf([a.protective.tripC, a.protective.tripB])) {
        const atom = ctx.pool.atoms[atomIdx]!
        if (atom.kind === 'opaque') continue
        const tid = `tag:${atom.key}`
        const isNew = !ctx.pool.atomsOf([a.protective.tripB]).includes(atomIdx)
        const isGone = !ctx.pool.atomsOf([a.protective.tripC]).includes(atomIdx)
        addNode(tid, 'tag', atom.label, { sublabel: atom.kind === 'comparison' ? 'comparison' : 'input', change: isNew ? 'added' : isGone ? 'removed' : 'none', safety: true })
        addEdge(tid, sid, 'influences', isNew || isGone)
      }
    }
    if (a.notification) {
      const aid = `alarm:${a.notification.alarmC.loc}`
      addNode(aid, 'alarm', a.notification.alarmC.label, {
        sublabel: `${a.notification.mechanismC.toLowerCase().replace('_', ' ')} · ${a.notification.status.toLowerCase()}`,
        safety: true,
        safetyFunctionIds: [a.sf.id],
        change: a.notification.status === 'INTACT' ? 'none' : 'modified',
      })
      addEdge(sid, aid, 'alarms', a.notification.status !== 'INTACT')
      const use = a.notification.useC
      if (use) addEdge(`routine:${use.routineId}`, aid, 'writes')
      for (const s of a.notification.suppressors) {
        const tid = `tag:${ctx.pool.atoms[s.atom]!.key}`
        addNode(tid, 'tag', s.label, { sublabel: 'suppressor', change: 'added', safety: true })
        addEdge(tid, aid, 'influences', true)
      }
    }
  }

  /* safety / undeclared flags, findings, edge safety */
  for (const n of nodes.values()) {
    if (n.type === 'routine') {
      const rid = n.id.slice('routine:'.length)
      if (!n.safetyFunctionIds.length) n.safetyFunctionIds = ctx.sfIdsForAnchor(`routine:${rid}`)
      n.safety = n.safetyFunctionIds.length > 0
      n.undeclared = !n.safety && !ctx.isNonSafety(rid)
      const fs = findingsFor((f) => f.location.routineId === rid || f.changeIds.some((c) => ctx.changeById.get(c)?.entity.routineId === rid))
      n.findingIds = fs.map((f) => f.id)
      const w = worst(fs)
      if (w) n.severity = w
    } else if (n.type === 'instance') {
      n.safety = n.safetyFunctionIds.length > 0
      n.undeclared = !n.safety && n.meta['relevance'] === 'operational'
    } else if (n.type === 'module') {
      const fs = findingsFor((f) => (f.module ?? '').toLowerCase() === n.label.toLowerCase())
      n.findingIds = fs.map((f) => f.id)
      const w = worst(fs)
      if (w) n.severity = w
      n.safety = [...edges.values()].some((e) => e.source === n.id && nodes.get(e.target)?.safety)
    } else if (n.type === 'program') {
      n.safety = ctx.sfIdsForAnchor(n.id).length > 0
    } else if (n.type === 'task') {
      n.safety = ctx.sfIdsForAnchor(n.id).length > 0
    }
  }
  for (const e of edges.values()) e.safety = !!(nodes.get(e.source)?.safety && nodes.get(e.target)?.safety)
  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

function hasJsr(idx: RuleContext['current']['index'], routineId: string, target: string): boolean {
  const r = idx.routines.get(routineId)
  if (!r) return false
  return r.rungs.some((rung) => instructionsOf(parseRung(rung.text).elements).some((i) => i.mnemonic === 'JSR' && lc(i.operands[0] ?? '') === lc(target)))
}
