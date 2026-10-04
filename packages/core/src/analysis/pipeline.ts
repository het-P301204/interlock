/**
 * The analysis pipeline. Each stage does real work and reports what it did
 * with real counts; the UI's timeline only ever shows these reports.
 *
 *   INGEST                  decode, hash and parse both files; validate the manifest
 *   NORMALIZE               index both projects; parse every rung
 *   RESOLVE_MODULES         find every module call site and resolve its definition
 *   BUILD_REUSE_GRAPH       symbolically execute one scan of each project
 *   MAP_SAFETY_FUNCTIONS    resolve every declaration in both projects
 *   COMPARE_LOGIC           structural diff + per-rung semantic equivalence
 *   TRACE_PROTECTIVE_PATHS  compare every protective firing condition
 *   ANALYZE_ALARMS          compare every notification path
 *   RANK_IMPACT             run the rules, group and rank findings
 *   GENERATE_REVIEW_SET     coverage, trust, review surface, reuse graph
 */
import type {
  AnalysisResult, Coverage, ProjectCounts, ProjectVersionSummary, ReviewSurface, SafetyFunctionResult, SafetyStatus, Side, StageId,
  StageReport, Trust, UndeclaredLogic, UnsupportedConstruct, ChangeCategory, Finding, ModuleBlastRadius, SafetyCone, WriterKind,
} from '../model/analysis.ts'
import type { ParsedProject, ParserInfo, SourceRef } from '../model/project.ts'
import type { SafetyFunction, SafetyManifest } from '../model/safety.ts'
import type { AnalyzeHooks, AnalyzeInput, FileInput, InspectResult } from '../api-types.ts'
import { ProjectParseError } from '../adapters/types.ts'
import { parseProjectText } from '../adapters/registry.ts'
import { decodeProjectBytes } from '../util/decode.ts'
import { sha256, shortHash } from '../util/sha256.ts'
import { ExprPool } from '../logic/expr.ts'
import { instructionsOf, parseRung } from '../logic/rll.ts'
import { diffProjects, type DiffChange } from './diff.ts'
import { ProjectIndex, lc } from './project-index.ts'
import { SymbolicScan } from './scan.ts'
import { analyzeSafetyFunction, isWeakening, type SfAnalysis, type SideContext } from './safety.ts'
import { RULE_INFO, runRules } from './rules/index.ts'
import type { InstanceInfo, ModuleInfo, RuleContext } from './rules/types.ts'
import { sfIdsForChange } from './rules/changes.ts'
import { buildFindings, toComparison } from './findings.ts'
import { buildGraph } from './graph.ts'
import { validateManifest } from './manifest.ts'

export const ENGINE_VERSION = '1.0.0'

export const STAGE_LABELS: Record<StageId, string> = {
  INGEST: 'Ingest',
  NORMALIZE: 'Normalize',
  RESOLVE_MODULES: 'Resolve modules',
  BUILD_REUSE_GRAPH: 'Build reuse graph',
  MAP_SAFETY_FUNCTIONS: 'Map safety functions',
  COMPARE_LOGIC: 'Compare logic',
  TRACE_PROTECTIVE_PATHS: 'Trace protective paths',
  ANALYZE_ALARMS: 'Analyze alarms',
  RANK_IMPACT: 'Rank impact',
  GENERATE_REVIEW_SET: 'Generate review set',
}

/** Error thrown by analyzeProjects when an input cannot be trusted. */
export class AnalysisInputError extends Error {
  readonly side: Side | 'manifest'
  readonly code: string
  readonly location?: string
  readonly line?: number
  readonly column?: number
  readonly issues: string[]
  constructor(side: Side | 'manifest', code: string, message: string, extra: { location?: string; line?: number; column?: number; issues?: string[] } = {}) {
    super(message)
    this.name = 'AnalysisInputError'
    this.side = side
    this.code = code
    if (extra.location !== undefined) this.location = extra.location
    if (extra.line !== undefined) this.line = extra.line
    if (extra.column !== undefined) this.column = extra.column
    this.issues = extra.issues ?? []
  }
}

/* ------------------------------------------------------------------ ingest */

export interface StaticCallSite {
  module: string
  backingLabel: string
  backingLoc: string
  routineId: string
  program: string
  rung: number
}

/** Every module call site written in program routines (executed or not). */
export function staticCallSites(index: ProjectIndex): StaticCallSite[] {
  const out: StaticCallSite[] = []
  for (const r of index.project.routines) {
    if (r.kind !== 'RLL' || r.container.kind !== 'program') continue
    for (const rung of r.rungs) {
      for (const ins of instructionsOf(parseRung(rung.text).elements)) {
        const def = index.modules.get(lc(ins.mnemonic))
        if (!def) continue
        const backing = ins.operands[0] ?? ''
        const base = backing.split('.')[0]!.replace(/^\\/, '')
        const resolved = index.resolveBase(base, r.container.name)
        const loc = resolved ? (resolved.scope === 'c' ? `c:${lc(resolved.tag.name)}` : `p:${lc(resolved.program!)}:${lc(resolved.tag.name)}`) : `c:${lc(base)}`
        out.push({ module: def.name, backingLabel: resolved?.tag.name ?? backing, backingLoc: loc, routineId: r.id, program: r.container.name, rung: rung.number })
      }
    }
  }
  return out
}

function countsOf(project: ParsedProject, index: ProjectIndex): ProjectCounts {
  return {
    tasks: project.tasks.length,
    programs: project.programs.length,
    routines: project.routines.length,
    rungs: project.routines.reduce((n, r) => n + r.rungs.length, 0),
    modules: project.modules.length,
    instances: staticCallSites(index).length,
    tags: project.tags.length,
  }
}

function summaryOf(role: Side, file: InspectResult['file'], parser: ParserInfo, project: ParsedProject): ProjectVersionSummary {
  const index = new ProjectIndex(project)
  const hasWarnings = project.diagnostics.some((d) => d.severity === 'warning' || d.severity === 'error')
  return { role, file, parser, metadata: project.metadata, counts: countsOf(project, index), diagnostics: project.diagnostics, readiness: hasWarnings ? 'READY_WITH_WARNINGS' : 'READY' }
}

/** Decode, hash and parse one file. Never throws: failures come back as { ok: false }. */
export function inspectProjectSync(input: FileInput, role: Side): InspectResult {
  const file = { name: input.name, sizeBytes: input.bytes.length, sha256: sha256(input.bytes) }
  try {
    const text = decodeProjectBytes(input.bytes)
    const { project, adapter } = parseProjectText(input.name, text)
    return { ok: true, file, summary: summaryOf(role, file, { adapter: adapter.id, version: adapter.version }, project), project }
  } catch (e) {
    if (e instanceof ProjectParseError) {
      const err: Extract<InspectResult, { ok: false }>['error'] = { code: e.code, message: e.message, diagnostics: e.diagnostics }
      if (e.location !== undefined) err.location = e.location
      if (e.source) {
        err.line = e.source.line
        err.column = e.source.column
      }
      return { ok: false, file, error: err }
    }
    // Anything else is a defect in INTERLOCK, not in the file; report it as such.
    return { ok: false, file, error: { code: 'INTERNAL_ERROR', message: `The parser failed unexpectedly: ${(e as Error).message}. INTERLOCK did not continue because the semantic model could not be trusted.`, diagnostics: [] } }
  }
}

export async function inspectProject(input: FileInput, role: Side): Promise<InspectResult> {
  return inspectProjectSync(input, role)
}

/* ---------------------------------------------------------------- analyze */

function emptyCone(): SafetyCone {
  return { routines: [], modules: [], instances: [], tags: [], rungs: [] }
}

export async function analyzeProjects(input: AnalyzeInput, hooks: AnalyzeHooks = {}): Promise<AnalysisResult> {
  return analyzeProjectsSync(input, hooks)
}

export function analyzeProjectsSync(input: AnalyzeInput, hooks: AnalyzeHooks = {}): AnalysisResult {
  const stages: StageReport[] = []
  const stage = <T>(id: StageId, work: () => { value: T; detail: string; counts: Record<string, number> }): T => {
    hooks.onStage?.({ id, phase: 'start' })
    const { value, detail, counts } = work()
    const report: StageReport = { id, label: STAGE_LABELS[id], detail, counts }
    stages.push(report)
    hooks.onStage?.({ id, phase: 'done', report })
    return value
  }

  /* INGEST */
  const ingest = stage('INGEST', () => {
    const b = inspectProjectSync(input.baseline, 'baseline')
    if (!b.ok) throw new AnalysisInputError('baseline', b.error.code, b.error.message, pickPos(b.error))
    const c = inspectProjectSync(input.current, 'current')
    if (!c.ok) throw new AnalysisInputError('current', c.error.code, c.error.message, pickPos(c.error))
    const mv = validateManifest(input.manifest)
    if (!mv.ok) throw new AnalysisInputError('manifest', 'MANIFEST_INVALID', 'The safety declarations are not valid.', { issues: mv.issues })
    return {
      value: { b, c, manifest: mv.manifest },
      detail: `Hashed and parsed ${b.file.name} (${fmtBytes(b.file.sizeBytes)}) and ${c.file.name} (${fmtBytes(c.file.sizeBytes)}); ${mv.manifest.functions.length} safety declarations validated.`,
      counts: { bytes: b.file.sizeBytes + c.file.sizeBytes, declarations: mv.manifest.functions.length },
    }
  })
  const { b, c, manifest } = ingest

  /* NORMALIZE */
  const indexes = stage('NORMALIZE', () => {
    const bi = new ProjectIndex(b.project)
    const ci = new ProjectIndex(c.project)
    let rungs = 0
    let unparsable = 0
    for (const p of [b.project, c.project])
      for (const r of p.routines)
        for (const rung of r.rungs) {
          rungs++
          if (parseRung(rung.text).errors.length) unparsable++
        }
    return {
      value: { bi, ci },
      detail: `Normalized ${b.project.routines.length + c.project.routines.length} routines and ${rungs.toLocaleString('en-US')} rungs into the vendor-neutral model${unparsable ? `; ${unparsable} rung(s) could not be parsed` : ''}.`,
      counts: { routines: b.project.routines.length + c.project.routines.length, rungs, unparsable, tags: b.project.tags.length + c.project.tags.length },
    }
  })
  const { bi, ci } = indexes

  /* RESOLVE_MODULES */
  const sites = stage('RESOLVE_MODULES', () => {
    const sb = staticCallSites(bi)
    const sc = staticCallSites(ci)
    const defs = new Set([...sc.map((s) => s.module), ...sb.map((s) => s.module)])
    return {
      value: { sb, sc },
      detail: `Resolved ${sc.length} module call site${sc.length === 1 ? '' : 's'} in the current project (${sb.length} in the baseline) against ${ci.modules.size} Add-On Instruction definition${ci.modules.size === 1 ? '' : 's'}${defs.size ? ` (${[...defs].join(', ')})` : ''}.`,
      counts: { callSitesCurrent: sc.length, callSitesBaseline: sb.length, definitions: ci.modules.size },
    }
  })

  /* BUILD_REUSE_GRAPH (symbolic scans) */
  const pool = new ExprPool()
  const scans = stage('BUILD_REUSE_GRAPH', () => {
    const sb = new SymbolicScan(pool, bi, { mode: 'full', side: 'baseline' })
    sb.runFull()
    const sc = new SymbolicScan(pool, ci, { mode: 'full', side: 'current' })
    sc.runFull()
    return {
      value: { sb, sc },
      detail: `Executed one controller scan of each project symbolically: ${sc.executedRoutines.size} routines and ${sc.callSites.length} module instances execute in the current project; ${sc.writes.size.toLocaleString('en-US')} storage locations written.`,
      counts: { executedRoutines: sc.executedRoutines.size, executedInstances: sc.callSites.length, locations: sc.writes.size, expressionNodes: pool.nodes.length },
    }
  })
  const baselineCtx: SideContext = { side: 'baseline', index: bi, scan: scans.sb }
  const currentCtx: SideContext = { side: 'current', index: ci, scan: scans.sc }

  /* MAP_SAFETY_FUNCTIONS */
  stage('MAP_SAFETY_FUNCTIONS', () => {
    let resolved = 0
    let declared = 0
    for (const sf of manifest.functions) {
      for (const tag of [sf.protectiveOutput?.tag, sf.alarm?.tag]) {
        if (!tag) continue
        declared++
        if (scans.sc.resolveDeclared(tag, sf.implementation.program)) resolved++
      }
    }
    return {
      value: null,
      detail: `Mapped ${manifest.functions.length} declared safety functions: ${resolved} of ${declared} declared outputs and alarms resolve in the current project.`,
      counts: { functions: manifest.functions.length, declaredTargets: declared, resolvedTargets: resolved },
    }
  })

  /* COMPARE_LOGIC */
  const diff = stage('COMPARE_LOGIC', () => {
    const d = diffProjects(b.project, c.project)
    const logic = d.changes.filter((x) => x.category === 'logic')
    const eq = logic.filter((x) => x.semantic === 'equivalent').length
    return {
      value: d,
      detail: `Found ${d.changes.length.toLocaleString('en-US')} structural changes; ${logic.length} touch logic, of which ${eq} ${eq === 1 ? 'is' : 'are'} provably equivalent.`,
      counts: { changes: d.changes.length, logic: logic.length, equivalent: eq },
    }
  })

  /* TRACE_PROTECTIVE_PATHS */
  const protective = stage('TRACE_PROTECTIVE_PATHS', () => {
    const list = manifest.functions.map((sf) => analyzeSafetyFunction(pool, withoutAlarm(sf), baselineCtx, currentCtx))
    const compared = list.filter((a) => a.protective)
    const weakened = compared.filter((a) => isWeakening(a.protective!.raw.verdict)).length
    const checked = compared.reduce((n, a) => n + a.protective!.raw.checked, 0)
    return {
      value: list,
      detail: `Compared ${compared.length} protective firing conditions over ${checked.toLocaleString('en-US')} input combinations; ${weakened} weakened.`,
      counts: { compared: compared.length, weakened, assignments: checked },
    }
  })

  /* ANALYZE_ALARMS */
  const sfAnalyses = stage('ANALYZE_ALARMS', () => {
    const merged: SfAnalysis[] = manifest.functions.map((sf, i) => {
      const p = protective[i]!
      if (!sf.alarm) return { ...p, sf }
      const n = analyzeSafetyFunction(pool, withoutProtective(sf), baselineCtx, currentCtx)
      const out: SfAnalysis = {
        ...p,
        sf,
        resolution: { ...p.resolution, alarm: n.resolution.alarm, notes: [...new Set([...p.resolution.notes, ...n.resolution.notes])] },
        coneB: new Set([...p.coneB, ...n.coneB]),
        coneC: new Set([...p.coneC, ...n.coneC]),
        analyzable: p.analyzable || n.analyzable,
        notes: [...new Set([...p.notes, ...n.notes])],
      }
      if (n.notification) out.notification = n.notification
      out.resolution.notes = out.notes
      return out
    })
    const withAlarm = merged.filter((a) => a.notification)
    const broken = withAlarm.filter((a) => a.notification!.status !== 'INTACT' && a.notification!.status !== 'NOT_ANALYZED').length
    return {
      value: merged,
      detail: `Traced ${withAlarm.length} operator notification path${withAlarm.length === 1 ? '' : 's'} from condition to alarm; ${broken} changed.`,
      counts: { paths: withAlarm.length, changed: broken },
    }
  })

  /* RANK_IMPACT */
  const ctx = buildContext(pool, manifest, baselineCtx, currentCtx, diff.changes, sfAnalyses, sites.sb, sites.sc)
  const meta = { analyzedAt: input.analyzedAt, baseline: b.summary, current: c.summary }
  const findings = stage('RANK_IMPACT', () => {
    const effects = runRules(ctx)
    const fs = buildFindings(effects, ctx, meta)
    return {
      value: fs,
      detail: `Applied ${RULE_INFO.length} deterministic rules: ${effects.length} effect${effects.length === 1 ? '' : 's'} grouped into ${fs.length} finding${fs.length === 1 ? '' : 's'}, ranked by severity, criticality and reach.`,
      counts: { rules: RULE_INFO.length, effects: effects.length, findings: fs.length },
    }
  })

  /* GENERATE_REVIEW_SET */
  return stage('GENERATE_REVIEW_SET', () => {
    const safetyResults = sfAnalyses.map((a) => safetyResult(ctx, a, findings))
    const modules = blastRadii(ctx)
    const undeclared = undeclaredLogic(ctx, findings)
    const coverage = coverageOf(ctx, safetyResults)
    const surface = surfaceOf(ctx, findings, undeclared)
    const trust = trustOf(ctx, safetyResults, coverage, undeclared)
    const graph = buildGraph(ctx, diff.changes, findings)
    const result: AnalysisResult = {
      schema: 'interlock.analysis/v1',
      id: shortHash(`${b.file.sha256}|${c.file.sha256}|${JSON.stringify(manifest)}|${ENGINE_VERSION}`),
      analyzedAt: input.analyzedAt,
      engineVersion: ENGINE_VERSION,
      baseline: b.summary,
      current: c.summary,
      manifest,
      changes: diff.changes.map(({ anchors: _a, changedLocs: _l, ...rest }) => rest),
      findings,
      safetyFunctions: safetyResults,
      modules,
      graph,
      coverage,
      trust,
      surface,
      undeclared,
      stages,
      rules: RULE_INFO,
    }
    return {
      value: result,
      detail: `Review set: ${surface.reviewOrder.length} item${surface.reviewOrder.length === 1 ? '' : 's'} to review out of ${diff.changes.length.toLocaleString('en-US')} changes; coverage ${coverage.percent}%, trust ${trust.status.replace(/_/g, ' ').toLowerCase()}.`,
      counts: { reviewItems: surface.reviewOrder.length, coverage: coverage.percent, graphNodes: graph.nodes.length, graphEdges: graph.edges.length },
    }
  })
}

function pickPos(e: { location?: string; line?: number; column?: number }) {
  const out: { location?: string; line?: number; column?: number } = {}
  if (e.location !== undefined) out.location = e.location
  if (e.line !== undefined) out.line = e.line
  if (e.column !== undefined) out.column = e.column
  return out
}

function fmtBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

function withoutAlarm(sf: SafetyFunction): SafetyFunction {
  const { alarm: _a, ...rest } = sf
  return rest
}

function withoutProtective(sf: SafetyFunction): SafetyFunction {
  const { protectiveOutput: _p, ...rest } = sf
  return rest
}

/* ---------------------------------------------------------------- context */

function buildContext(
  pool: ExprPool,
  manifest: SafetyManifest,
  baseline: SideContext,
  current: SideContext,
  changes: DiffChange[],
  sf: SfAnalysis[],
  sitesB: StaticCallSite[],
  sitesC: StaticCallSite[],
): RuleContext {
  const sfById = new Map(sf.map((a) => [a.sf.id, a]))
  const changeById = new Map(changes.map((c) => [c.id, c]))
  const nonSafetyPrograms = new Set((manifest.nonSafetyScope?.programs ?? []).map(lc))
  const nonSafetyRoutines = new Set((manifest.nonSafetyScope?.routines ?? []).map(lc))
  const ctx: RuleContext = {
    pool,
    manifest,
    baseline,
    current,
    changes,
    changeById,
    sf,
    sfById,
    sfChanges: new Map(),
    modules: [],
    isNonSafety(routineId) {
      const m = /^program:([^/]+)\/(.+)$/.exec(routineId)
      if (!m) return false
      return nonSafetyPrograms.has(lc(m[1]!)) || nonSafetyRoutines.has(lc(`${m[1]}/${m[2]}`))
    },
    sfIdsForAnchor(anchor, side) {
      return sf.filter((a) => (side !== 'current' && a.coneB.has(anchor)) || (side !== 'baseline' && a.coneC.has(anchor))).map((a) => a.sf.id)
    },
    sfIdsForLoc(loc) {
      return sf.filter((a) => a.coneB.has(`loc:${loc}`) || a.coneC.has(`loc:${loc}`)).map((a) => a.sf.id)
    },
    callSites: { baseline: baseline.scan.callSites, current: current.scan.callSites },
    indexOf: (side) => (side === 'baseline' ? baseline.index : current.index),
  }
  for (const a of sf) ctx.sfChanges.set(a.sf.id, [])
  for (const c of changes) for (const id of sfIdsForChange(ctx, c)) ctx.sfChanges.get(id)!.push(c.id)

  /* modules */
  const names = new Map<string, string>()
  for (const m of [...baseline.index.project.modules, ...current.index.project.modules]) names.set(lc(m.name), m.name)
  for (const [key, name] of names) {
    const defChanges = changes.filter(
      (c) =>
        (c.entity.routineId?.startsWith(`module:`) && lc(c.entity.routineId.split('/')[0]!.slice(7)) === key && c.category === 'logic' && c.semantic !== 'equivalent') ||
        (c.entity.type === 'module-parameter' && lc(c.entity.container ?? '') === key && c.category === 'interface') ||
        (c.entity.type === 'module' && lc(c.entity.name) === key && c.category === 'interface' && c.op === 'modified'),
    )
    const revChanges = changes.filter((c) => c.entity.type === 'module' && lc(c.entity.name) === key && c.field === 'revision')
    const instances: InstanceInfo[] = sitesC
      .filter((s) => lc(s.module) === key)
      .map((s) => {
        const guard = current.scan.executedRoutines.get(s.routineId)
        const executed = guard !== undefined && guard !== pool.FALSE
        return {
          id: `${s.routineId}#${s.rung}#${lc(s.backingLabel)}`,
          module: name,
          backingLabel: s.backingLabel,
          backingLoc: s.backingLoc,
          routineId: s.routineId,
          program: s.program,
          rung: s.rung,
          executed,
          safetyFunctionIds: ctx.sfIdsForAnchor(`instance:${s.backingLoc}`),
        }
      })
    if (instances.length === 0 && !sitesB.some((s) => lc(s.module) === key) && defChanges.length === 0) {
      ctx.modules.push({ name, changed: false, changeIds: [], revisionChangeIds: [], instances: [] })
      continue
    }
    const info: ModuleInfo = { name, changed: defChanges.length > 0, changeIds: defChanges.map((c) => c.id), revisionChangeIds: revChanges.map((c) => c.id), instances }
    const rb = baseline.index.modules.get(key)?.revision
    const rc = current.index.modules.get(key)?.revision
    if (rb !== undefined) info.revisionBefore = rb
    if (rc !== undefined) info.revisionAfter = rc
    ctx.modules.push(info)
  }
  return ctx
}

/* ------------------------------------------------------- result sections */

function coneOf(ctx: RuleContext, a: SfAnalysis): SafetyCone {
  const cone = emptyCone()
  const all = new Set([...a.coneC, ...a.coneB])
  const tags = new Set<string>()
  for (const x of all) {
    if (x.startsWith('routine:')) cone.routines.push(x.slice(8))
    else if (x.startsWith('module:')) cone.modules.push(ctx.current.index.modules.get(x.slice(7))?.name ?? x.slice(7))
    else if (x.startsWith('instance:')) {
      const loc = x.slice(9)
      cone.instances.push(ctx.current.scan.meta.get(loc)?.label ?? ctx.baseline.scan.meta.get(loc)?.label ?? loc)
    } else if (x.startsWith('rung:')) cone.rungs.push(x.slice(5))
    else if (x.startsWith('loc:')) {
      const loc = x.slice(4)
      if (loc.includes('#') || loc.startsWith('m:')) continue
      const label = ctx.current.scan.meta.get(loc)?.label ?? ctx.baseline.scan.meta.get(loc)?.label
      if (label) tags.add(label)
    }
  }
  cone.tags = [...tags].sort((x, y) => x.localeCompare(y))
  cone.routines = [...new Set(cone.routines)].sort()
  cone.modules = [...new Set(cone.modules)].sort()
  cone.instances = [...new Set(cone.instances)].sort()
  cone.rungs = [...new Set(cone.rungs)].sort()
  return cone
}

function safetyResult(ctx: RuleContext, a: SfAnalysis, findings: Finding[]): SafetyFunctionResult {
  const mine = findings.filter((f) => f.safetyFunctionIds.includes(a.sf.id))
  const unresolved = a.resolution.protectiveOutput === 'UNRESOLVED' || a.resolution.alarm === 'UNRESOLVED'
  const weakened =
    (a.protective && isWeakening(a.protective.raw.verdict)) ||
    (a.notification && ['SUPPRESSED', 'DEGRADED', 'BROKEN'].includes(a.notification.status)) ||
    mine.some((f) => f.type === 'TRIP_DELAY_INCREASED' || f.type === 'EXECUTION_CONTROL_INTRODUCED' || f.type === 'EXTERNAL_WRITE_ACCESS_GRANTED')
  const strengthened = a.protective && (a.protective.raw.verdict === 'STRENGTHENED' || a.protective.raw.verdict === 'ALWAYS_FIRES')
  const meaningful = (ctx.sfChanges.get(a.sf.id) ?? []).filter((id) => ['logic', 'execution', 'interface', 'configuration'].includes(ctx.changeById.get(id)!.category))
  let status: SafetyStatus
  if (!a.analyzable || unresolved) status = 'NOT_ANALYZED'
  else if (weakened) status = 'IMPACTED'
  else if (strengthened) status = 'STRENGTHENED'
  else if (meaningful.length > 0 || (a.protective && a.protective.raw.verdict === 'EQUIVALENT')) status = 'CHANGED_EQUIVALENT'
  else status = 'NO_CHANGE'
  const opaque = (raw?: { atoms: number[] } | null) => !!raw && raw.atoms.some((i) => ctx.pool.atoms[i]!.kind === 'opaque')
  const confidence = status === 'NOT_ANALYZED' ? 'LOW' : opaque(a.protective?.raw) || opaque(a.notification?.raw) ? 'MEDIUM' : 'HIGH'
  const out: SafetyFunctionResult = {
    function: a.sf,
    status,
    resolution: a.resolution,
    cone: coneOf(ctx, a),
    changeIds: ctx.sfChanges.get(a.sf.id) ?? [],
    findingIds: mine.map((f) => f.id),
    confidence,
  }
  if (a.protective) {
    const p = a.protective
    out.protective = {
      ...toComparison(ctx, p.raw)!,
      outputTag: p.outC.label,
      tripState: a.sf.protectiveOutput!.tripState,
      writersBefore: p.writersB.map(writerRef),
      writersAfter: p.writersC.map(writerRef),
    }
    const bAtoms = new Set(ctx.pool.atomsOf([p.tripB]).map((i) => ctx.pool.atoms[i]!.key))
    const cAtoms = new Set(ctx.pool.atomsOf([p.tripC]).map((i) => ctx.pool.atoms[i]!.key))
    for (const at of out.protective.atoms) {
      at.inBaseline = bAtoms.has(at.id)
      at.inCurrent = cAtoms.has(at.id)
    }
  }
  if (a.notification) {
    const n = a.notification
    out.notification = {
      alarmTag: n.alarmC.label,
      mechanism: n.mechanismC === 'BOOL_TAG' ? 'BOOL_TAG' : n.mechanismC === 'NOT_EXECUTED' ? 'UNRESOLVED' : 'ALMD',
      stages: n.stages,
      status: n.status,
      suppressors: n.suppressors.map((s) => s.label),
    }
    if (a.sf.alarm?.notification) out.notification.declaredNotification = a.sf.alarm.notification
    if (n.raw) out.notification.comparison = toComparison(ctx, n.raw)!
  }
  return out
}

function writerRef(w: { routineId: string; rung: number; instruction: string; kind: WriterKind; source?: SourceRef }) {
  return w.source ? { routineId: w.routineId, rung: w.rung, instruction: w.instruction, kind: w.kind, source: w.source } : { routineId: w.routineId, rung: w.rung, instruction: w.instruction, kind: w.kind }
}

function blastRadii(ctx: RuleContext): ModuleBlastRadius[] {
  return ctx.modules
    .filter((m) => m.instances.length > 0 || m.changed)
    .map((m) => {
      const instances = m.instances.map((i) => ({
        id: i.id,
        backingTag: i.backingLabel,
        routineId: i.routineId,
        program: i.program,
        rung: i.rung,
        safetyFunctionIds: i.safetyFunctionIds,
        relevance: (!i.executed ? 'not-executed' : i.safetyFunctionIds.length ? 'safety' : 'operational') as 'safety' | 'operational' | 'not-executed',
      }))
      const r: ModuleBlastRadius = {
        module: m.name,
        changed: m.changed,
        changeIds: [...m.changeIds, ...m.revisionChangeIds],
        instances,
        totals: {
          instances: instances.length,
          safetyRelevant: instances.filter((i) => i.relevance === 'safety').length,
          operational: instances.filter((i) => i.relevance === 'operational').length,
          notExecuted: instances.filter((i) => i.relevance === 'not-executed').length,
        },
      }
      if (m.revisionBefore !== undefined) r.revisionBefore = m.revisionBefore
      if (m.revisionAfter !== undefined) r.revisionAfter = m.revisionAfter
      return r
    })
}

function undeclaredLogic(ctx: RuleContext, findings: Finding[]): UndeclaredLogic[] {
  const out = new Map<string, UndeclaredLogic>()
  for (const f of findings) {
    if (f.type !== 'UNDECLARED_LOGIC_CHANGED' || !f.location.routineId) continue
    const rid = f.location.routineId
    const r = ctx.current.index.routines.get(rid) ?? ctx.baseline.index.routines.get(rid)
    const u: UndeclaredLogic = { routineId: rid, routine: r?.name ?? rid, changeIds: f.changeIds }
    if (r?.container.kind === 'program') u.program = r.container.name
    const hint = f.explanation.find((x) => x.startsWith('Tag names suggest'))
    if (hint) u.hint = hint
    out.set(rid, u)
  }
  for (const m of ctx.modules) {
    if (!m.changed) continue
    for (const i of m.instances) {
      if (!i.executed || i.safetyFunctionIds.length || out.has(i.routineId) || ctx.isNonSafety(i.routineId)) continue
      const r = ctx.current.index.routines.get(i.routineId)
      const u: UndeclaredLogic = { routineId: i.routineId, routine: r?.name ?? i.routineId, changeIds: m.changeIds, hint: `Runs ${m.name} through ${i.backingLabel}; the module definition changed.` }
      if (r?.container.kind === 'program') u.program = r.container.name
      out.set(i.routineId, u)
    }
  }
  return [...out.values()].sort((a, b) => a.routineId.localeCompare(b.routineId))
}

function coverageOf(ctx: RuleContext, results: SafetyFunctionResult[]): Coverage {
  const declaredRoutines = new Map<string, boolean>()
  for (const sf of ctx.manifest.functions) {
    const impl = sf.implementation
    if (!impl.program || !impl.routine) continue
    const r = ctx.current.index.routine(impl.program, impl.routine)
    const ok = !!r && r.kind === 'RLL' && !r.protected && ctx.current.scan.executedRoutines.has(r.id)
    declaredRoutines.set(lc(`${impl.program}/${impl.routine}`), ok)
  }
  const sites = staticCallSites(ctx.current.index)
  const resolvedSites = sites.filter((s) => !ctx.current.index.modules.get(lc(s.module))?.protected).length
  const alarms = results.filter((r) => r.function.alarm)
  const unsupported: UnsupportedConstruct[] = []
  const seen = new Set<string>()
  for (const side of [ctx.baseline, ctx.current]) {
    for (const d of side.scan.diagnostics) {
      const key = `${side.side}|${d.kind}|${d.location}|${d.detail}`
      if (seen.has(key)) continue
      seen.add(key)
      const cones = ctx.sf.map((a) => (side.side === 'baseline' ? a.coneB : a.coneC))
      const inSafetyCone = cones.some((cone) => d.locs.some((l) => cone.has(`loc:${l}`)) || (d.routineId !== undefined && d.rung !== undefined && cone.has(`rung:${d.routineId}#${d.rung}`)))
      const changed = d.routineId !== undefined && ctx.changes.some((c) => c.entity.routineId === d.routineId && (c.category === 'logic' || c.category === 'execution'))
      unsupported.push({ kind: d.kind, detail: d.detail, location: d.location, side: side.side, inSafetyCone, changed })
    }
  }
  const ratio = (covered: number, total: number) => ({ covered, total })
  const cov: Coverage = {
    safetyFunctions: ratio(results.filter((r) => r.status !== 'NOT_ANALYZED').length, results.length),
    declaredRoutines: ratio([...declaredRoutines.values()].filter(Boolean).length, declaredRoutines.size),
    moduleRelationships: ratio(resolvedSites, sites.length),
    notificationPaths: ratio(alarms.filter((r) => r.notification && r.notification.status !== 'NOT_ANALYZED').length, alarms.length),
    unsupported,
    percent: 0,
  }
  const parts = [cov.safetyFunctions, cov.declaredRoutines, cov.moduleRelationships, cov.notificationPaths].filter((x) => x.total > 0)
  cov.percent = parts.length ? Math.floor((parts.reduce((s, x) => s + x.covered / x.total, 0) / parts.length) * 100) : 0
  return cov
}

function surfaceOf(ctx: RuleContext, findings: Finding[], undeclared: UndeclaredLogic[]): ReviewSurface {
  const meaningful = ctx.changes.filter(
    (c) => (['logic', 'execution', 'interface'].includes(c.category) && c.semantic !== 'equivalent') || c.category === 'configuration',
  )
  const byCategory = { logic: 0, execution: 0, interface: 0, configuration: 0, data: 0, documentation: 0, metadata: 0 } as Record<ChangeCategory, number>
  for (const c of ctx.changes) byCategory[c.category]++
  const review = findings.filter((f) => f.disposition === 'REVIEW' || f.disposition === 'UNDECLARED')
  const changedModules = ctx.modules.filter((m) => m.changed)
  return {
    totalChanges: ctx.changes.length,
    meaningfulLogicChanges: meaningful.length,
    safetyRelevant: meaningful.filter((c) => sfIdsForChange(ctx, c).length > 0).length,
    notificationPathChanges: ctx.sf.filter((a) => a.notification && ['SUPPRESSED', 'DEGRADED', 'BROKEN'].includes(a.notification.status)).length,
    sharedModulesWithSafetyImpact: changedModules.filter((m) => m.instances.some((i) => i.executed && i.safetyFunctionIds.length)).length,
    blastRadius: Math.max(0, ...changedModules.map((m) => m.instances.length)),
    undeclaredAffected: undeclared.length,
    reviewOrder: review.map((f) => {
      const item: ReviewSurface['reviewOrder'][number] = { rank: f.rank, findingId: f.id, title: f.title, severity: f.severity }
      const sfId = f.safetyFunctionIds[0]
      if (sfId) item.safetyFunction = ctx.sfById.get(sfId)?.sf.name ?? sfId
      return item
    }),
    priority: review.length ? (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const).find((s) => review.some((f) => f.severity === s))! : 'NONE',
    byCategory,
  }
}

function trustOf(ctx: RuleContext, results: SafetyFunctionResult[], coverage: Coverage, undeclared: UndeclaredLogic[]): Trust {
  const reasons: string[] = []
  const notAnalyzed = results.filter((r) => r.status === 'NOT_ANALYZED')
  for (const r of notAnalyzed) reasons.push(`${r.function.name} could not be analyzed${r.resolution.notes[0] ? `: ${r.resolution.notes[0]}` : '.'}`)
  const coneGaps = coverage.unsupported.filter((u) => u.inSafetyCone)
  for (const u of coneGaps.slice(0, 5)) reasons.push(`Unsupported construct in safety logic (${u.side}): ${u.detail}`)
  const opaqueRoutines = coverage.unsupported.filter((u) => u.side === 'current' && (u.kind === 'PROTECTED_CONTENT' || (u.kind === 'ROUTINE_TYPE' && !/structured text/i.test(u.detail))))
  for (const u of opaqueRoutines.slice(0, 3)) reasons.push(`Executing logic INTERLOCK cannot read: ${u.detail}`)
  const partial = notAnalyzed.length > 0 || coneGaps.length > 0 || opaqueRoutines.length > 0
  if (undeclared.length) reasons.push(`${undeclared.length} undeclared routine${undeclared.length === 1 ? '' : 's'} affected: ${undeclared.map((u) => `${u.program ? `${u.program}/` : ''}${u.routine}`).join(', ')}.`)
  const changedUnsupported = coverage.unsupported.filter((u) => u.changed && !u.inSafetyCone)
  for (const u of changedUnsupported.slice(0, 3)) reasons.push(`Changed logic contains an unsupported construct: ${u.detail}`)
  const review = undeclared.length > 0 || changedUnsupported.length > 0
  void ctx
  if (partial)
    return { status: 'PARTIAL_COVERAGE', headline: 'Some declared safety logic could not be fully analyzed. Findings are incomplete for that part of the scope.', reasons }
  if (review)
    return { status: 'REVIEW_REQUIRED', headline: 'Every declared safety function was analyzed, but undeclared logic changed. INTERLOCK cannot conclude that it is safe.', reasons }
  return {
    status: 'VERIFIED_SCOPE',
    headline: 'All declared safety functions were successfully analyzed. No undeclared logic changed.',
    reasons: [`${results.length} of ${results.length} declared safety functions analyzed exhaustively.`, 'This verifies the declared scope only. It is not a statement that the project is secure.'],
  }
}
