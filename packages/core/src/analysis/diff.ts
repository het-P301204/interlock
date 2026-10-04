/**
 * Structural diff between two parsed projects, plus a semantic verdict for
 * every rung change.
 *
 * The structural diff is deliberately exhaustive: every attribute INTERLOCK
 * models is compared, so "total changes" is an honest count of what moved
 * (descriptions and export bookkeeping included). The semantic verdict is
 * what reduces that count to the changes that alter behaviour: a modified
 * rung is interpreted in isolation on both sides and is `equivalent` only if
 * every location it writes has a provably equivalent condition.
 */
import type { Change, ChangeCategory, ChangeEntity, ChangeOp } from '../model/analysis.ts'
import type { ModuleDefinition, ParsedProject, Routine, Rung, SourceRef, Tag } from '../model/project.ts'
import { ExprPool } from '../logic/expr.ts'
import { compareConditions } from '../logic/truth.ts'
import { ProjectIndex, lc } from './project-index.ts'
import { SymbolicScan } from './scan.ts'

/** Change plus the anchors that place it in the projects (internal to the engine). */
export interface DiffChange extends Change {
  anchors: { baseline?: string[]; current?: string[] }
  /** Locations whose rung-local behaviour differs (logic changes only). */
  changedLocs: { baseline: string[]; current: string[] }
}

interface Draft {
  op: ChangeOp
  category: ChangeCategory
  entity: ChangeEntity
  field?: string
  summary: string
  before?: string
  after?: string
  baselineSource?: SourceRef
  currentSource?: SourceRef
  semantic?: 'equivalent' | 'different' | 'unknown'
  anchors: { baseline?: string[]; current?: string[] }
  changedLocs?: { baseline: string[]; current: string[] }
}

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, '')
const rungKey = (r: Rung) => norm(r.text).toLowerCase()

/** Longest common subsequence alignment of two key sequences. */
function align<T>(a: T[], b: T[], key: (x: T) => string): Array<[number | null, number | null]> {
  const n = a.length
  const m = b.length
  const ka = a.map(key)
  const kb = b.map(key)
  // Trim common prefix/suffix first: the common case is a handful of edits in a long routine.
  let pre = 0
  while (pre < n && pre < m && ka[pre] === kb[pre]) pre++
  let suf = 0
  while (suf < n - pre && suf < m - pre && ka[n - 1 - suf] === kb[m - 1 - suf]) suf++
  const A = ka.slice(pre, n - suf)
  const B = kb.slice(pre, m - suf)
  const out: Array<[number | null, number | null]> = []
  for (let i = 0; i < pre; i++) out.push([i, i])
  if (A.length * B.length > 4_000_000) {
    // Pathologically large middle: pair positionally rather than blow memory.
    const k = Math.max(A.length, B.length)
    for (let i = 0; i < k; i++) out.push([i < A.length ? pre + i : null, i < B.length ? pre + i : null])
  } else {
    const L: Uint32Array[] = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1))
    for (let i = A.length - 1; i >= 0; i--)
      for (let j = B.length - 1; j >= 0; j--) L[i]![j] = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!)
    let i = 0
    let j = 0
    const pendA: number[] = []
    const pendB: number[] = []
    const flush = () => {
      // Pair deletions with insertions in order: those are modifications.
      const k = Math.max(pendA.length, pendB.length)
      for (let x = 0; x < k; x++) out.push([pendA[x] !== undefined ? pre + pendA[x]! : null, pendB[x] !== undefined ? pre + pendB[x]! : null])
      pendA.length = 0
      pendB.length = 0
    }
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && A[i] === B[j]) {
        flush()
        out.push([pre + i, pre + j])
        i++
        j++
      } else if (j >= B.length || (i < A.length && L[i + 1]![j]! >= L[i]![j + 1]!)) pendA.push(i++)
      else pendB.push(j++)
    }
    flush()
  }
  for (let s = suf; s > 0; s--) out.push([n - s, m - s])
  return out
}

export interface DiffResult {
  changes: DiffChange[]
}

export function diffProjects(baseline: ParsedProject, current: ParsedProject): DiffResult {
  const drafts: Draft[] = []
  const bi = new ProjectIndex(baseline)
  const ci = new ProjectIndex(current)
  const pool = new ExprPool()

  const push = (d: Draft) => drafts.push(d)

  /* metadata */
  const metaFields: Array<[keyof ParsedProject['metadata'], string]> = [
    ['exportDate', 'Export date'],
    ['softwareRevision', 'Software revision'],
    ['firmwareRevision', 'Controller firmware revision'],
    ['processorType', 'Processor type'],
    ['controllerName', 'Controller name'],
    ['schemaRevision', 'Schema revision'],
  ]
  for (const [field, label] of metaFields) {
    const a = baseline.metadata[field]
    const b = current.metadata[field]
    if (String(a ?? '') !== String(b ?? '')) {
      const category: ChangeCategory = field === 'firmwareRevision' || field === 'processorType' ? 'configuration' : 'metadata'
      push({
        op: 'modified',
        category,
        entity: { type: 'metadata', name: label },
        field,
        summary: `${label} changed`,
        before: String(a ?? ''),
        after: String(b ?? ''),
        anchors: {},
      })
    }
  }

  /* tasks */
  const bTasks = new Map(baseline.tasks.map((t) => [lc(t.name), t]))
  const cTasks = new Map(current.tasks.map((t) => [lc(t.name), t]))
  for (const [k, t] of bTasks)
    if (!cTasks.has(k))
      push({ op: 'removed', category: 'execution', entity: { type: 'task', name: t.name }, summary: `Task ${t.name} removed`, baselineSource: t.source, anchors: { baseline: [`task:${k}`] } })
  for (const [k, t] of cTasks) {
    const o = bTasks.get(k)
    if (!o) {
      push({ op: 'added', category: 'execution', entity: { type: 'task', name: t.name }, summary: `Task ${t.name} added`, currentSource: t.source, anchors: { current: [`task:${k}`] } })
      continue
    }
    const fields: Array<[string, string, string, ChangeCategory]> = [
      ['type', o.type, t.type, 'execution'],
      ['priority', String(o.priority ?? ''), String(t.priority ?? ''), 'execution'],
      ['rate', String(o.rate ?? ''), String(t.rate ?? ''), 'execution'],
      ['watchdog', String(o.watchdog ?? ''), String(t.watchdog ?? ''), 'configuration'],
      ['inhibited', String(o.inhibited), String(t.inhibited), 'execution'],
      ['disableUpdateOutputs', String(o.disableUpdateOutputs), String(t.disableUpdateOutputs), 'execution'],
      ['scheduledPrograms', o.scheduledPrograms.join(', '), t.scheduledPrograms.join(', '), 'execution'],
      ['description', o.description ?? '', t.description ?? '', 'documentation'],
    ]
    for (const [field, a, b, category] of fields) {
      if (a === b) continue
      const anchors = { baseline: [`task:${k}`, ...o.scheduledPrograms.map((p) => `program:${lc(p)}`)], current: [`task:${k}`, ...t.scheduledPrograms.map((p) => `program:${lc(p)}`)] }
      push({ op: 'modified', category, entity: { type: 'task', name: t.name }, field, summary: `Task ${t.name}: ${field} changed`, before: a, after: b, baselineSource: o.source, currentSource: t.source, anchors })
    }
  }

  /* programs */
  for (const p of baseline.programs)
    if (!ci.programs.has(lc(p.name)))
      push({ op: 'removed', category: 'execution', entity: { type: 'program', name: p.name }, summary: `Program ${p.name} removed`, baselineSource: p.source, anchors: { baseline: [`program:${lc(p.name)}`] } })
  for (const p of current.programs) {
    const o = bi.programs.get(lc(p.name))
    if (!o) {
      push({ op: 'added', category: 'execution', entity: { type: 'program', name: p.name }, summary: `Program ${p.name} added`, currentSource: p.source, anchors: { current: [`program:${lc(p.name)}`] } })
      continue
    }
    const fields: Array<[string, string, string, ChangeCategory]> = [
      ['disabled', String(o.disabled), String(p.disabled), 'execution'],
      ['mainRoutine', o.mainRoutine ?? '', p.mainRoutine ?? '', 'execution'],
      ['faultRoutine', o.faultRoutine ?? '', p.faultRoutine ?? '', 'execution'],
      ['description', o.description ?? '', p.description ?? '', 'documentation'],
    ]
    for (const [field, a, b, category] of fields) {
      if (a === b) continue
      const anchor = `program:${lc(p.name)}`
      push({ op: 'modified', category, entity: { type: 'program', name: p.name }, field, summary: `Program ${p.name}: ${field} changed`, before: a, after: b, baselineSource: o.source, currentSource: p.source, anchors: { baseline: [anchor], current: [anchor] } })
    }
  }

  /* routines */
  const bModules = bi.modules
  const cModules = ci.modules
  const moduleOf = (idx: ProjectIndex, r: Routine): ModuleDefinition | undefined => (r.container.kind === 'module' ? idx.modules.get(lc(r.container.name)) : undefined)
  const containerLabel = (r: Routine) => `${r.container.name}/${r.name}`
  const routineAnchors = (r: Routine) => [`routine:${r.id}`, r.container.kind === 'module' ? `module:${lc(r.container.name)}` : `program:${lc(r.container.name)}`]

  for (const r of baseline.routines) {
    if (ci.routines.has(r.id)) continue
    const locs = rungsLocs(pool, bi, r, r.rungs, moduleOf(bi, r))
    push({
      op: 'removed',
      category: 'logic',
      entity: { type: 'routine', name: r.name, container: r.container.name, routineId: r.id },
      summary: `Routine ${containerLabel(r)} removed`,
      before: r.rungs.map((x) => x.text).join('\n'),
      baselineSource: r.source,
      semantic: 'different',
      anchors: { baseline: [...routineAnchors(r), ...r.rungs.map((x) => `rung:${r.id}#${x.number}`)] },
      changedLocs: { baseline: locs, current: [] },
    })
  }
  for (const r of current.routines) {
    const o = bi.routines.get(r.id)
    if (!o) {
      const locs = rungsLocs(pool, ci, r, r.rungs, moduleOf(ci, r))
      push({
        op: 'added',
        category: 'logic',
        entity: { type: 'routine', name: r.name, container: r.container.name, routineId: r.id },
        summary: `Routine ${containerLabel(r)} added (${r.kind}, ${r.kind === 'RLL' ? `${r.rungs.length} rung${r.rungs.length === 1 ? '' : 's'}` : `${r.stLines.length} lines`})`,
        after: r.kind === 'ST' ? r.stLines.map((x) => x.text).join('\n') : r.rungs.map((x) => x.text).join('\n'),
        currentSource: r.source,
        semantic: 'different',
        anchors: { current: [...routineAnchors(r), ...r.rungs.map((x) => `rung:${r.id}#${x.number}`)] },
        changedLocs: { baseline: [], current: locs },
      })
      continue
    }
    const both = { baseline: routineAnchors(o), current: routineAnchors(r) }
    if (o.kind !== r.kind) {
      push({ op: 'modified', category: 'logic', entity: { type: 'routine', name: r.name, container: r.container.name, routineId: r.id }, field: 'type', summary: `Routine ${containerLabel(r)} changed from ${o.kind} to ${r.kind}`, before: o.kind, after: r.kind, baselineSource: o.source, currentSource: r.source, semantic: 'unknown', anchors: both })
    }
    if (o.protected !== r.protected) {
      push({ op: 'modified', category: 'logic', entity: { type: 'routine', name: r.name, container: r.container.name, routineId: r.id }, field: 'protected', summary: `Routine ${containerLabel(r)} source protection ${r.protected ? 'enabled' : 'removed'}`, before: String(o.protected), after: String(r.protected), baselineSource: o.source, currentSource: r.source, semantic: 'unknown', anchors: both })
    }
    if ((o.description ?? '') !== (r.description ?? '')) {
      push({ op: 'modified', category: 'documentation', entity: { type: 'routine', name: r.name, container: r.container.name, routineId: r.id }, field: 'description', summary: `Routine ${containerLabel(r)} description changed`, before: o.description ?? '', after: r.description ?? '', baselineSource: o.source, currentSource: r.source, anchors: both })
    }
    if (o.kind === 'ST' && r.kind === 'ST') {
      const pairs = align(o.stLines, r.stLines, (l) => norm(l.text))
      for (const [a, b] of pairs) {
        const la = a === null ? undefined : o.stLines[a]
        const lb = b === null ? undefined : r.stLines[b]
        if (la && lb && norm(la.text) === norm(lb.text)) continue
        push({
          op: !la ? 'added' : !lb ? 'removed' : 'modified',
          category: 'logic',
          entity: { type: 'routine', name: r.name, container: r.container.name, routineId: r.id },
          field: 'text',
          summary: `Structured text ${containerLabel(r)} line ${(lb ?? la)!.number} ${!la ? 'added' : !lb ? 'removed' : 'modified'}`,
          ...(la ? { before: la.text, baselineSource: la.source } : {}),
          ...(lb ? { after: lb.text, currentSource: lb.source } : {}),
          semantic: 'unknown',
          anchors: both,
        })
      }
    }
    if (o.kind !== 'RLL' || r.kind !== 'RLL') continue
    const pairs = align(o.rungs, r.rungs, rungKey)
    const mo = moduleOf(bi, o)
    const mc = moduleOf(ci, r)
    for (const [a, b] of pairs) {
      const ra = a === null ? undefined : o.rungs[a]
      const rb = b === null ? undefined : r.rungs[b]
      const where = (x: Rung) => `${containerLabel(r)} rung ${x.number}`
      const entity: ChangeEntity = { type: 'rung', name: `${r.name} rung ${(rb ?? ra)!.number}`, container: r.container.name, routineId: r.id, rung: (rb ?? ra)!.number }
      if (ra && rb && rungKey(ra) === rungKey(rb)) {
        if ((ra.comment ?? '') !== (rb.comment ?? '')) {
          push({ op: 'modified', category: 'documentation', entity, field: 'comment', summary: `Rung comment changed in ${where(rb)}`, before: ra.comment ?? '', after: rb.comment ?? '', baselineSource: ra.source, currentSource: rb.source, anchors: { baseline: [`rung:${o.id}#${ra.number}`], current: [`rung:${r.id}#${rb.number}`] } })
        }
        continue
      }
      if (ra && rb) {
        const sem = rungSemantics(pool, bi, ci, o, ra, r, rb, mo, mc)
        push({
          op: 'modified',
          category: 'logic',
          entity,
          field: 'text',
          summary: `Logic modified in ${where(rb)}`,
          before: ra.text,
          after: rb.text,
          baselineSource: ra.source,
          currentSource: rb.source,
          semantic: sem.verdict,
          anchors: { baseline: [`rung:${o.id}#${ra.number}`, `routine:${o.id}`], current: [`rung:${r.id}#${rb.number}`, `routine:${r.id}`] },
          changedLocs: sem.changedLocs,
        })
        if ((ra.comment ?? '') !== (rb.comment ?? '')) {
          push({ op: 'modified', category: 'documentation', entity, field: 'comment', summary: `Rung comment changed in ${where(rb)}`, before: ra.comment ?? '', after: rb.comment ?? '', baselineSource: ra.source, currentSource: rb.source, anchors: { baseline: [`rung:${o.id}#${ra.number}`], current: [`rung:${r.id}#${rb.number}`] } })
        }
        continue
      }
      if (rb) {
        push({
          op: 'added',
          category: 'logic',
          entity,
          field: 'text',
          summary: `Rung added in ${where(rb)}`,
          after: rb.text,
          currentSource: rb.source,
          semantic: 'different',
          anchors: { current: [`rung:${r.id}#${rb.number}`, `routine:${r.id}`] },
          changedLocs: { baseline: [], current: rungsLocs(pool, ci, r, [rb], mc) },
        })
      } else if (ra) {
        push({
          op: 'removed',
          category: 'logic',
          entity: { ...entity, name: `${o.name} rung ${ra.number}`, rung: ra.number },
          field: 'text',
          summary: `Rung removed from ${containerLabel(o)} (was rung ${ra.number})`,
          before: ra.text,
          baselineSource: ra.source,
          semantic: 'different',
          anchors: { baseline: [`rung:${o.id}#${ra.number}`, `routine:${o.id}`] },
          changedLocs: { baseline: rungsLocs(pool, bi, o, [ra], mo), current: [] },
        })
      }
    }
  }

  /* modules */
  for (const [k, m] of bModules)
    if (!cModules.has(k))
      push({ op: 'removed', category: 'interface', entity: { type: 'module', name: m.name }, summary: `Add-On Instruction ${m.name} removed`, baselineSource: m.source, anchors: { baseline: [`module:${k}`] } })
  for (const [k, m] of cModules) {
    const o = bModules.get(k)
    const anchor = `module:${k}`
    if (!o) {
      push({ op: 'added', category: 'interface', entity: { type: 'module', name: m.name }, summary: `Add-On Instruction ${m.name} added (revision ${m.revision ?? 'unspecified'})`, currentSource: m.source, anchors: { current: [anchor] } })
      continue
    }
    const both = { baseline: [anchor], current: [anchor] }
    const rev = (x: ModuleDefinition) => `${x.revision ?? ''}${x.revisionExtension ? ` ${x.revisionExtension}` : ''}`
    if (rev(o) !== rev(m))
      push({ op: 'modified', category: 'metadata', entity: { type: 'module', name: m.name }, field: 'revision', summary: `Add-On Instruction ${m.name} revision ${rev(o) || 'unspecified'} → ${rev(m) || 'unspecified'}`, before: rev(o), after: rev(m), baselineSource: o.source, currentSource: m.source, anchors: both })
    if ((o.description ?? '') !== (m.description ?? ''))
      push({ op: 'modified', category: 'documentation', entity: { type: 'module', name: m.name }, field: 'description', summary: `Add-On Instruction ${m.name} description changed`, before: o.description ?? '', after: m.description ?? '', baselineSource: o.source, currentSource: m.source, anchors: both })
    if (o.protected !== m.protected)
      push({ op: 'modified', category: 'interface', entity: { type: 'module', name: m.name }, field: 'protected', summary: `Add-On Instruction ${m.name} source protection ${m.protected ? 'enabled' : 'removed'}`, before: String(o.protected), after: String(m.protected), baselineSource: o.source, currentSource: m.source, semantic: 'unknown', anchors: both })
    const op = new Map(o.parameters.map((x) => [lc(x.name), x]))
    const cp = new Map(m.parameters.map((x) => [lc(x.name), x]))
    for (const [pk, p] of op)
      if (!cp.has(pk))
        push({ op: 'removed', category: 'interface', entity: { type: 'module-parameter', name: p.name, container: m.name }, summary: `Parameter ${m.name}.${p.name} removed`, before: paramText(p), baselineSource: p.source, anchors: both })
    for (const [pk, p] of cp) {
      const q = op.get(pk)
      if (!q) {
        push({ op: 'added', category: 'interface', entity: { type: 'module-parameter', name: p.name, container: m.name }, summary: `Parameter ${m.name}.${p.name} added (${p.usage}, ${p.dataType}${p.required ? ', required' : ''})`, after: paramText(p), currentSource: p.source, anchors: both })
        continue
      }
      if (paramText(q) !== paramText(p))
        push({ op: 'modified', category: 'interface', entity: { type: 'module-parameter', name: p.name, container: m.name }, summary: `Parameter ${m.name}.${p.name} changed`, before: paramText(q), after: paramText(p), baselineSource: q.source, currentSource: p.source, anchors: both })
      else if ((q.description ?? '') !== (p.description ?? ''))
        push({ op: 'modified', category: 'documentation', entity: { type: 'module-parameter', name: p.name, container: m.name }, field: 'description', summary: `Parameter ${m.name}.${p.name} description changed`, before: q.description ?? '', after: p.description ?? '', baselineSource: q.source, currentSource: p.source, anchors: both })
    }
    const orderA = o.parameters.filter((x) => x.required).map((x) => lc(x.name)).join(',')
    const orderB = m.parameters.filter((x) => x.required).map((x) => lc(x.name)).join(',')
    if (orderA !== orderB && [...op.keys()].every((x) => cp.has(x)) && [...cp.keys()].every((x) => op.has(x)))
      push({ op: 'modified', category: 'interface', entity: { type: 'module', name: m.name }, field: 'parameterOrder', summary: `Required parameter order of ${m.name} changed: call-site arguments now bind to different parameters`, before: orderA, after: orderB, baselineSource: o.source, currentSource: m.source, anchors: both })
    diffTags(o.localTags, m.localTags, push, m.name, anchor)
  }

  /* tags */
  diffTags(baseline.tags, current.tags, push)

  /* data types */
  const bTypes = new Map(baseline.dataTypes.map((d) => [lc(d.name), d]))
  for (const d of current.dataTypes) {
    const o = bTypes.get(lc(d.name))
    const text = (x: typeof d) => x.members.map((mm) => `${mm.name}:${mm.dataType}`).join(', ')
    if (!o) push({ op: 'added', category: 'interface', entity: { type: 'datatype', name: d.name }, summary: `Data type ${d.name} added`, after: text(d), currentSource: d.source, anchors: {} })
    else if (text(o) !== text(d)) push({ op: 'modified', category: 'interface', entity: { type: 'datatype', name: d.name }, summary: `Data type ${d.name} members changed`, before: text(o), after: text(d), baselineSource: o.source, currentSource: d.source, anchors: {} })
  }
  const cTypes = new Set(current.dataTypes.map((d) => lc(d.name)))
  for (const d of baseline.dataTypes) if (!cTypes.has(lc(d.name))) push({ op: 'removed', category: 'interface', entity: { type: 'datatype', name: d.name }, summary: `Data type ${d.name} removed`, baselineSource: d.source, anchors: {} })

  const changes: DiffChange[] = drafts.map((d, i) => {
    const c: DiffChange = {
      id: `CH-${String(i + 1).padStart(4, '0')}`,
      op: d.op,
      category: d.category,
      entity: d.entity,
      summary: d.summary,
      anchors: d.anchors,
      changedLocs: d.changedLocs ?? { baseline: [], current: [] },
    }
    if (d.field !== undefined) c.field = d.field
    if (d.before !== undefined) c.before = d.before
    if (d.after !== undefined) c.after = d.after
    if (d.baselineSource) c.baselineSource = d.baselineSource
    if (d.currentSource) c.currentSource = d.currentSource
    if (d.semantic) c.semantic = d.semantic
    return c
  })
  return { changes }
}

function paramText(p: { usage: string; dataType: string; required: boolean; visible: boolean; externalAccess: string; defaultValue?: string }): string {
  return `${p.usage} ${p.dataType}${p.required ? ' required' : ''}${p.visible ? ' visible' : ''} access=${p.externalAccess}${p.defaultValue !== undefined ? ` default=${p.defaultValue}` : ''}`
}

function tagKey(t: Tag): string {
  const scope = t.scope.kind === 'controller' ? 'c' : t.scope.kind === 'program' ? `p:${lc(t.scope.program)}` : `m:${lc(t.scope.module)}`
  return `${scope}:${lc(t.name)}`
}

function tagLabel(t: Tag): string {
  return t.scope.kind === 'program' ? `\\${t.scope.program}.${t.name}` : t.scope.kind === 'module' ? `${t.scope.module}.${t.name}` : t.name
}

function diffTags(a: Tag[], b: Tag[], push: (d: Draft) => void, module?: string, moduleAnchor?: string) {
  const am = new Map(a.map((t) => [tagKey(t), t]))
  const bm = new Map(b.map((t) => [tagKey(t), t]))
  const anchorsOf = (t: Tag) => (moduleAnchor ? [moduleAnchor] : [`loc:${tagKey(t)}`])
  const entity = (t: Tag): ChangeEntity => (module ? { type: 'tag', name: t.name, container: module } : t.scope.kind === 'program' ? { type: 'tag', name: t.name, container: t.scope.program } : { type: 'tag', name: t.name })
  for (const [k, t] of am)
    if (!bm.has(k)) push({ op: 'removed', category: 'configuration', entity: entity(t), summary: `Tag ${tagLabel(t)} removed`, before: `${t.dataType}${t.aliasFor ? ` alias for ${t.aliasFor}` : ''}`, baselineSource: t.source, anchors: { baseline: anchorsOf(t) } })
  for (const [k, t] of bm) {
    const o = am.get(k)
    if (!o) {
      push({ op: 'added', category: 'configuration', entity: entity(t), summary: `Tag ${tagLabel(t)} added (${t.dataType}${t.aliasFor ? `, alias for ${t.aliasFor}` : ''}, external access ${t.externalAccess})`, after: `${t.dataType}${t.aliasFor ? ` alias for ${t.aliasFor}` : ''}`, currentSource: t.source, anchors: { current: anchorsOf(t) } })
      continue
    }
    const fields: Array<[string, string, string, ChangeCategory, string]> = [
      ['dataType', o.dataType, t.dataType, 'configuration', 'data type'],
      ['aliasFor', o.aliasFor ?? '', t.aliasFor ?? '', 'configuration', 'alias target'],
      ['externalAccess', o.externalAccess, t.externalAccess, 'configuration', 'external access'],
      ['constant', String(o.constant), String(t.constant), 'configuration', 'constant flag'],
      ['dimensions', o.dimensions ?? '', t.dimensions ?? '', 'configuration', 'dimensions'],
      ['description', o.description ?? '', t.description ?? '', 'documentation', 'description'],
      ['value', o.value ?? '', t.value ?? '', 'data', 'stored value'],
    ]
    for (const [field, x, y, category, label] of fields) {
      if (x === y) continue
      push({ op: 'modified', category, entity: entity(t), field, summary: `Tag ${tagLabel(t)}: ${label} changed`, before: x, after: y, baselineSource: o.source, currentSource: t.source, anchors: { baseline: anchorsOf(o), current: anchorsOf(t) } })
    }
  }
}

/** Locations written by the given rungs, interpreted in isolation. */
function rungsLocs(pool: ExprPool, idx: ProjectIndex, routine: Routine, rungs: Rung[], module?: ModuleDefinition): string[] {
  if (routine.kind !== 'RLL') return []
  const s = new SymbolicScan(pool, idx, { mode: 'rung', side: 'current' })
  for (const r of rungs) s.runRungTextIsolated(routine, r.number, r.text, module)
  return [...s.cur.keys()]
}

/**
 * Interpret the old and new rung in isolation (each in its own project's
 * context) and compare every written location. Equivalent only if every
 * location's condition is equivalent; unknown when a comparison is undecided
 * or the rung contains constructs that are not modeled.
 */
function rungSemantics(
  pool: ExprPool,
  bi: ProjectIndex,
  ci: ProjectIndex,
  ro: Routine,
  ra: Rung,
  rc: Routine,
  rb: Rung,
  mo?: ModuleDefinition,
  mc?: ModuleDefinition,
): { verdict: 'equivalent' | 'different' | 'unknown'; changedLocs: { baseline: string[]; current: string[] } } {
  const a = new SymbolicScan(pool, bi, { mode: 'rung', side: 'baseline' })
  const b = new SymbolicScan(pool, ci, { mode: 'rung', side: 'current' })
  a.runRungTextIsolated(ro, ra.number, ra.text, mo)
  b.runRungTextIsolated(rc, rb.number, rb.text, mc)
  if (a.diagnostics.some((d) => d.kind === 'INSTRUCTION') || b.diagnostics.some((d) => d.kind === 'INSTRUCTION')) {
    return { verdict: 'unknown', changedLocs: { baseline: [...a.cur.keys()], current: [...b.cur.keys()] } }
  }
  const locs = new Set([...a.cur.keys(), ...b.cur.keys()])
  const changed: string[] = []
  let unknown = false
  for (const loc of locs) {
    const va = a.cur.get(loc)?.expr ?? a.atomForLoc({ loc, label: loc })
    const vb = b.cur.get(loc)?.expr ?? b.atomForLoc({ loc, label: loc })
    if (va === vb) continue
    const cmp = compareConditions(pool, va, vb)
    if (cmp.verdict === 'EQUIVALENT' || cmp.verdict === 'UNCHANGED') continue
    if (cmp.verdict === 'NOT_DECIDED') unknown = true
    changed.push(loc)
  }
  const ctrlA = a.executionControl.map((x) => x.instruction).join('|')
  const ctrlB = b.executionControl.map((x) => x.instruction).join('|')
  if (ctrlA !== ctrlB) changed.push('#execution-control')
  const verdict = changed.length === 0 ? 'equivalent' : unknown ? 'unknown' : 'different'
  return { verdict, changedLocs: { baseline: changed.filter((l) => a.cur.has(l)), current: changed.filter((l) => b.cur.has(l) || !a.cur.has(l)) } }
}
