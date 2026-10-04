/**
 * Symbolic single-scan execution.
 *
 * A Logix controller scans its tasks, each task its programs in schedule
 * order, each program its main routine top to bottom, jumping into
 * subroutines (JSR) and Add-On Instructions where they are called. INTERLOCK
 * executes that scan symbolically: instead of 0/1 it carries boolean
 * expressions, so at the end of the scan every storage location holds the
 * expression that computes it from the scan's inputs.
 *
 *   OTE(X)  X := guard ? rung : X
 *   OTL(X)  X := guard & rung ? 1 : X
 *   OTU(X)  X := guard & rung ? 0 : X
 *   AOI     outputs := guard & rung ? logic(inputs) : outputs   (EnableIn false: the logic does not run)
 *   JSR     the called routine runs under guard & rung
 *   TND     later rungs of the routine run under guard & !rung
 *   JMP     rungs up to the LBL run under guard & !rung
 *   MCR     rungs in the zone see rung-in = zone condition
 *
 * A location read before anything in the scan wrote it is an atom: its value
 * at the start of the scan (an input, an HMI-written tag, or the previous
 * scan's output). Every value carries provenance anchors (rungs, routines,
 * programs, tasks, modules, instances, locations) so the dependency cone of a
 * protective output can be computed exactly from what the scan used.
 *
 * Mode 'rung' interprets a single rung in isolation, with AOI calls and JSRs
 * treated as opaque effects: that is how a modified rung is checked for
 * semantic equivalence with its predecessor.
 */
import type { Side, UnsupportedKind, WriterKind } from '../model/analysis.ts'
import type { ExternalAccess, ModuleDefinition, ModuleParameter, Routine, SourceRef, Tag } from '../model/project.ts'
import type { CompareOp, ExprPool } from '../logic/expr.ts'
import { numericLabel, rangeLabel } from '../logic/expr.ts'
import type { RllElement, RllInstruction } from '../logic/rll.ts'
import {
  BIT_INPUTS, COMPARISONS, COUNTERS, EXECUTION_CONTROL, KNOWN_INSTRUCTIONS, MOVE_LIKE, ONE_SHOTS, TIMERS,
  instructionsOf, isTagOperand, parseNumericLiteral, parseRung, splitTagRef,
} from '../logic/rll.ts'
import { isIntegerType, lc, type ProjectIndex } from './project-index.ts'

export type Anchor = string

export interface WriteEvent {
  loc: string
  label: string
  routineId: string
  rung: number
  instruction: string
  kind: WriterKind
  guard: number
  source?: SourceRef
}

export interface CallSiteExec {
  id: string
  module: string
  backingLabel: string
  backingLoc: string
  routineId: string
  program: string
  rung: number
  operands: string[]
  guard: number
  resolved: boolean
}

export interface TimerUse {
  loc: string
  label: string
  kind: string
  preset: number | null
  presetText: string
  routineId: string
  rung: number
  source?: SourceRef
}

export interface AlarmUse {
  loc: string
  label: string
  mechanism: 'ALMD' | 'ALMA'
  notifyLoc: string
  routineId: string
  rung: number
  instruction: string
  source?: SourceRef
}

export interface ScanDiagnostic {
  kind: UnsupportedKind
  detail: string
  location: string
  /** Locations the construct touches (for cone membership). */
  locs: string[]
  routineId?: string
  rung?: number
  /** Cone anchors the construct affects (e.g. "program:safety" for an SSV that can disable it). */
  anchors?: string[]
}

export interface LocMeta {
  label: string
  tag?: Tag
  externalAccess: ExternalAccess | 'n/a'
  integer: boolean
}

interface Value {
  expr: number
  prov: Set<Anchor>
}

interface ModuleBinding {
  def: ModuleDefinition
  backingLoc: string
  backingLabel: string
  params: Map<string, ModuleParameter>
  args: Map<string, string>
  locals: Set<string>
  caller: Frame
  writtenInCall: Set<string>
}

interface Frame {
  program: string
  routineId: string
  guard: number
  guardProv: Set<Anchor>
  module?: ModuleBinding
  depth: number
}

interface Resolved {
  loc: string
  label: string
  /** A literal operand (e.g. "1" bound to an AOI input). */
  literal?: number
}

const ALARM_MEMBERS_THAT_SILENCE = ['progdisable', 'progsuppress', 'operdisable', 'opersuppress', 'opershelve']
const MEMBER_DISPLAY: Record<string, string> = { en: 'EN', dn: 'DN', tt: 'TT', cu: 'CU', cd: 'CD', in: 'In', enablein: 'EnableIn', '#preset': 'PRE' }

export interface ScanOptions {
  mode: 'full' | 'rung'
  side: Side
}

export class SymbolicScan {
  readonly pool: ExprPool
  readonly index: ProjectIndex
  readonly side: Side
  readonly mode: 'full' | 'rung'

  readonly cur = new Map<string, Value>()
  readonly writes = new Map<string, WriteEvent[]>()
  readonly meta = new Map<string, LocMeta>()
  readonly executedRoutines = new Map<string, number>()
  readonly routineBlocked = new Map<string, string>()
  readonly callSites: CallSiteExec[] = []
  readonly timers = new Map<string, TimerUse[]>()
  readonly alarms = new Map<string, AlarmUse>()
  readonly diagnostics: ScanDiagnostic[] = []
  /** Locations read at least once (inputs of the scan). */
  readonly readLocs = new Set<string>()
  /** Rungs that contain execution-control instructions, as anchors. */
  readonly executionControl: Array<{ anchor: string; instruction: string; routineId: string; rung: number; target?: string }> = []

  private rungProv = new Set<Anchor>()
  private rungRef: { routineId: string; rung: number; source?: SourceRef } = { routineId: '', rung: 0 }
  private readonly rungCache = new Map<string, ReturnType<typeof parseRung>>()
  private readonly activeRoutines = new Set<string>()
  private opaqueCounter = 0
  /** End-of-scan values from the first pass, read as "previous scan" values in the second. */
  private prevScan = new Map<string, number>()

  constructor(pool: ExprPool, index: ProjectIndex, opts: ScanOptions) {
    this.pool = pool
    this.index = index
    this.side = opts.side
    this.mode = opts.mode
  }

  /* ------------------------------------------------------------ the scan */

  /**
   * Two passes. The first computes every location's end-of-scan value; the
   * second runs the scan again with those values as "previous scan" values,
   * so a location read before it is written in the scan sees what the scan
   * itself wrote last time (steady state, inputs held constant). Without it a
   * later rung that unlatches a trip input would be invisible.
   */
  runFull(): void {
    this.runPass()
    const prev = new Map<string, number>()
    for (const [loc, v] of this.cur) prev.set(loc, v.expr)
    this.cur.clear()
    this.writes.clear()
    this.executedRoutines.clear()
    this.routineBlocked.clear()
    this.callSites.length = 0
    this.timers.clear()
    this.alarms.clear()
    this.diagnostics.length = 0
    this.readLocs.clear()
    this.executionControl.length = 0
    this.prevScan = prev
    this.runPass()
  }

  private runPass(): void {
    // Continuous tasks first, then periodic tasks by priority, then event
    // tasks. A periodic task can preempt the continuous one at any point;
    // running it afterwards makes its writes the last ones, which is the
    // conservative choice for a write that could bypass a protective output.
    const kindRank = (t: { type: string }) => (t.type === 'CONTINUOUS' ? 0 : t.type === 'EVENT' ? 2 : 1)
    const tasks = [...this.index.project.tasks]
      .map((t, i) => ({ t, i }))
      .sort((a, b) => kindRank(a.t) - kindRank(b.t) || (a.t.priority ?? 100) - (b.t.priority ?? 100) || a.i - b.i)
      .map((x) => x.t)
    const blocks = this.index.executionBlocks()
    for (const task of tasks) {
      const taskGuard =
        task.type === 'EVENT'
          ? this.pool.atom({ key: `opaque:event:${lc(task.name)}`, label: `⟨event task ${task.name} triggered⟩`, kind: 'opaque' })
          : this.pool.TRUE
      for (const progName of task.scheduledPrograms) {
        const prog = this.index.programs.get(lc(progName))
        if (!prog) {
          this.diag('UNRESOLVED_REFERENCE', `Task ${task.name} schedules program ${progName}, which is not in the project.`, `Task ${task.name}`, [])
          continue
        }
        const block = blocks.get(lc(prog.name))
        if (block) {
          this.blockProgram(prog.name, block)
          continue
        }
        if (!prog.mainRoutine) {
          this.diag('UNRESOLVED_REFERENCE', `Program ${prog.name} has no main routine.`, `Program ${prog.name}`, [])
          continue
        }
        const main = this.index.routine(prog.name, prog.mainRoutine)
        if (!main) {
          this.diag('UNRESOLVED_REFERENCE', `Main routine ${prog.mainRoutine} of program ${prog.name} is not in the project.`, `Program ${prog.name}`, [])
          continue
        }
        const frame: Frame = {
          program: prog.name,
          routineId: main.id,
          guard: taskGuard,
          guardProv: new Set([`program:${lc(prog.name)}`, `task:${lc(task.name)}`]),
          depth: 0,
        }
        this.runRoutine(main, frame)
      }
    }
    for (const prog of this.index.project.programs) {
      const block = blocks.get(lc(prog.name))
      if (block) this.blockProgram(prog.name, block)
    }
    for (const r of this.index.project.routines) {
      if (r.container.kind === 'program' && !this.executedRoutines.has(r.id) && !this.routineBlocked.has(r.id)) {
        this.routineBlocked.set(r.id, 'routine is not called from any executing routine')
      }
    }
  }

  private blockProgram(program: string, reason: string) {
    for (const r of this.index.project.routines) {
      if (r.container.kind === 'program' && lc(r.container.name) === lc(program) && !this.routineBlocked.has(r.id)) {
        this.routineBlocked.set(r.id, reason)
      }
    }
  }

  /** Interpret one rung in isolation (mode 'rung'). */
  runSingleRung(routine: Routine, rungIndex: number, moduleContext?: ModuleDefinition): void {
    const program = routine.container.kind === 'program' ? routine.container.name : ''
    const frame: Frame = { program, routineId: routine.id, guard: this.pool.TRUE, guardProv: new Set(), depth: 0 }
    if (moduleContext) frame.module = this.isolatedModuleBinding(moduleContext, frame)
    const rung = routine.rungs[rungIndex]
    if (!rung) return
    this.runRungText(routine, rung.number, rung.text, rung.source, frame, this.pool.TRUE, null)
  }

  /** Interpret raw rung text in isolation (used for added/removed rungs). */
  runRungTextIsolated(routine: Routine, rungNumber: number, text: string, moduleContext?: ModuleDefinition): void {
    const program = routine.container.kind === 'program' ? routine.container.name : ''
    const frame: Frame = { program, routineId: routine.id, guard: this.pool.TRUE, guardProv: new Set(), depth: 0 }
    if (moduleContext) frame.module = this.isolatedModuleBinding(moduleContext, frame)
    this.runRungText(routine, rungNumber, text, undefined, frame, this.pool.TRUE, null)
  }

  /** Run a module's logic routine in isolation: every input is a free atom named after its parameter. */
  runModuleIsolated(def: ModuleDefinition): string {
    const frame: Frame = { program: '', routineId: `module:${def.name}`, guard: this.pool.TRUE, guardProv: new Set(), depth: 0 }
    frame.module = this.isolatedModuleBinding(def, frame)
    const routine = this.index.moduleRoutine(def)
    if (routine) this.runRoutine(routine, frame)
    return frame.module.backingLoc
  }

  private isolatedModuleBinding(def: ModuleDefinition, caller: Frame): ModuleBinding {
    const params = new Map(def.parameters.map((p) => [lc(p.name), p]))
    return {
      def,
      backingLoc: `m:${lc(def.name)}`,
      backingLabel: def.name,
      params,
      args: new Map(),
      locals: new Set(def.localTags.map((t) => lc(t.name))),
      caller,
      writtenInCall: new Set(),
    }
  }

  private runRoutine(routine: Routine, frame: Frame): void {
    const prev = this.executedRoutines.get(routine.id)
    this.executedRoutines.set(routine.id, prev === undefined ? frame.guard : this.pool.or(prev, frame.guard))
    const where = `${routine.container.name}/${routine.name}`
    if (routine.protected) {
      this.diag('PROTECTED_CONTENT', `Routine ${where} is source-protected; its logic cannot be read.`, where, [], routine.id)
      return
    }
    if (routine.kind === 'ST') {
      this.runStructuredTextLexically(routine, frame)
      return
    }
    if (routine.kind !== 'RLL') {
      this.diag('ROUTINE_TYPE', `Routine ${where} is ${routine.kind}; INTERLOCK parses it structurally but cannot analyze its logic or the tags it writes.`, where, [], routine.id)
      return
    }
    if (this.activeRoutines.has(routine.id)) {
      this.diag('EXECUTION_CONTROL', `Recursive call into ${where} is not modeled; results for this routine are incomplete.`, where, [], this.rungRef.routineId || routine.id, this.rungRef.rung)
      return
    }
    this.activeRoutines.add(routine.id)
    const labelsAhead = new Map<string, number>()
    routine.rungs.forEach((r, i) => {
      for (const m of r.text.matchAll(/\bLBL\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/gi)) labelsAhead.set(lc(m[1]!), i)
    })
    const pendingJumps: Array<{ label: string; cond: number; prov: Set<Anchor> }> = []
    let tnd = this.pool.FALSE
    const tndProv = new Set<Anchor>()
    let mcrZone: number | null = null
    routine.rungs.forEach((rung, i) => {
      const labels = [...rung.text.matchAll(/\bLBL\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/gi)].map((m) => lc(m[1]!))
      for (let k = pendingJumps.length - 1; k >= 0; k--) if (labels.includes(pendingJumps[k]!.label)) pendingJumps.splice(k, 1)
      const jumpCond = pendingJumps.length ? this.pool.or(...pendingJumps.map((j) => j.cond)) : this.pool.FALSE
      const guard = this.pool.and(frame.guard, this.pool.not(jumpCond), this.pool.not(tnd))
      const guardProv = new Set(frame.guardProv)
      for (const j of pendingJumps) for (const a of j.prov) guardProv.add(a)
      for (const a of tndProv) guardProv.add(a)
      const rungFrame: Frame = { ...frame, guard, guardProv }
      const control = this.runRungText(routine, rung.number, rung.text, rung.source, rungFrame, mcrZone ?? this.pool.TRUE, {
        onJump: (label, cond) => {
          const ahead = labelsAhead.get(lc(label))
          if (ahead !== undefined && ahead > i) pendingJumps.push({ label: lc(label), cond, prov: new Set(this.rungProv) })
          else
            this.diag('EXECUTION_CONTROL', `Backward or unresolved jump JMP(${label}) in ${where} rung ${rung.number} is not modeled; later results for this routine are approximate.`, `${where} rung ${rung.number}`, [], routine.id, rung.number)
        },
        onTnd: (cond) => {
          tnd = this.pool.or(tnd, cond)
          for (const a of this.rungProv) tndProv.add(a)
          tndProv.add(`rung:${routine.id}#${rung.number}`)
        },
        onMcr: (cond, unconditional) => {
          mcrZone = unconditional ? null : cond
        },
      })
      void control
    })
    this.activeRoutines.delete(routine.id)
  }

  /**
   * Structured text is not analyzed semantically. Every assignment target is
   * treated as an opaque write, so an ST routine that writes a protective
   * output still shows up as a writer of that output.
   */
  private runStructuredTextLexically(routine: Routine, frame: Frame): void {
    const where = `${routine.container.name}/${routine.name}`
    const targets: string[] = []
    for (const line of routine.stLines) {
      const code = line.text.replace(/\(\*[\s\S]*?\*\)/g, '').replace(/\/\/.*$/, '')
      const refs = [
        ...[...code.matchAll(/([A-Za-z_\\][A-Za-z0-9_.:[\]\\]*)\s*:=/g)].map((m) => m[1]!),
        // COP/CPS/MOV(src, dest, ...) write their second argument.
        ...[...code.matchAll(/\b(?:COP|CPS|MOV)\s*\(\s*[^,()]+,\s*([A-Za-z_\\][A-Za-z0-9_.:[\]\\]*)/gi)].map((m) => m[1]!),
      ]
      for (const ref of refs) {
        this.rungRef = { routineId: routine.id, rung: line.number, source: line.source }
        this.rungProv = new Set([`routine:${routine.id}`])
        const r = this.resolve(ref, frame)
        if (!r || r.literal !== undefined) continue
        targets.push(r.loc)
        this.writeValue(r, frame, this.pool.TRUE, 'OPAQUE', `${ref} := …`, 'OTHER', `st:${r.loc}:${routine.id}#${line.number}`)
      }
    }
    this.diag(
      'ROUTINE_TYPE',
      `Routine ${where} is structured text; INTERLOCK records its ${targets.length} assignment target(s) as unanalyzed writes but does not analyze the logic.`,
      where,
      targets,
      routine.id,
    )
  }

  /* -------------------------------------------------------- rung machine */

  private runRungText(
    routine: Routine,
    rungNumber: number,
    text: string,
    source: SourceRef | undefined,
    frame: Frame,
    rcIn: number,
    control: { onJump(label: string, cond: number): void; onTnd(cond: number): void; onMcr(cond: number, unconditional: boolean): void } | null,
  ): void {
    let parsed = this.rungCache.get(text)
    if (!parsed) {
      parsed = parseRung(text)
      this.rungCache.set(text, parsed)
    }
    const savedProv = this.rungProv
    const savedRef = this.rungRef
    this.rungProv = new Set()
    this.rungRef = source ? { routineId: routine.id, rung: rungNumber, source } : { routineId: routine.id, rung: rungNumber }
    const where = `${routine.container.name}/${routine.name} rung ${rungNumber}`
    if (parsed.errors.length) {
      const locs = this.locsOfText(text, frame)
      this.diag('INSTRUCTION', `Rung could not be parsed (${parsed.errors[0]}); its effects are unknown.`, where, locs, routine.id, rungNumber)
      // Every tag the rung mentions might be written: record opaque writes so a
      // broken rung touching a protective output is never invisible.
      for (const loc of locs) this.writeLocOpaque(loc, frame, `unparsed:${routine.id}#${rungNumber}`, text.slice(0, 80))
      this.rungProv = savedProv
      this.rungRef = savedRef
      return
    }
    const onlyMcr = parsed.elements.length === 1 && parsed.elements[0]!.kind === 'ins' && parsed.elements[0]!.mnemonic === 'MCR'
    this.execSequence(parsed.elements, rcIn, frame, (ins, rc) => {
      const anchor = `rung:${routine.id}#${rungNumber}`
      if (EXECUTION_CONTROL.has(ins.mnemonic) && ins.mnemonic !== 'LBL' && ins.mnemonic !== 'SBR' && !(ins.mnemonic === 'RET' && rc === this.pool.TRUE)) {
        this.executionControl.push({ anchor, instruction: `${ins.mnemonic}(${ins.operands.join(',')})`, routineId: routine.id, rung: rungNumber })
      }
      if (!control) return
      if (ins.mnemonic === 'JMP') control.onJump(ins.operands[0] ?? '', this.pool.and(frame.guard, rc))
      else if (ins.mnemonic === 'TND' || ins.mnemonic === 'RET') control.onTnd(this.pool.and(frame.guard, rc))
      else if (ins.mnemonic === 'MCR') control.onMcr(rc, onlyMcr)
    })
    this.rungProv = savedProv
    this.rungRef = savedRef
  }

  private execSequence(els: RllElement[], rcIn: number, frame: Frame, onControl: (ins: RllInstruction, rc: number) => void): number {
    let rc = rcIn
    for (const el of els) {
      if (el.kind === 'ins') rc = this.execInstruction(el, rc, frame, onControl)
      else {
        const start = rc
        const outs = el.legs.map((leg) => this.execSequence(leg, start, frame, onControl))
        rc = outs.length ? this.pool.or(...outs) : start
      }
    }
    return rc
  }

  private insText(ins: RllInstruction): string {
    return `${ins.mnemonic}(${ins.operands.join(',')})`
  }

  private execInstruction(ins: RllInstruction, rc: number, frame: Frame, onControl: (ins: RllInstruction, rc: number) => void): number {
    const p = this.pool
    const m = ins.mnemonic
    const op = (i: number) => ins.operands[i] ?? ''
    if (BIT_INPUTS.has(m)) {
      const v = this.readBit(op(0), frame)
      return p.and(rc, m === 'XIC' ? v : p.not(v))
    }
    if (COMPARISONS.has(m)) return p.and(rc, this.comparison(ins, frame))
    if (m === 'MEQ' || m === 'CMP') return p.and(rc, this.opaqueAtom(`cond:${this.canonicalInstruction(ins, frame)}`, this.insText(ins)))
    if (m === 'AFI') return p.FALSE
    if (m === 'NOP') return rc
    if (m === 'OTE' || m === 'OTL' || m === 'OTU') {
      const r = this.resolve(op(0), frame)
      if (r && r.literal === undefined) this.writeValue(r, frame, rc, m, this.insText(ins), m)
      return rc
    }
    if (ONE_SHOTS.has(m)) {
      const storage = this.resolve(op(0), frame)
      if (!storage || storage.literal !== undefined) return rc
      const prev = this.readResolved(storage)
      if (m === 'ONS') {
        const out = p.and(rc, p.not(prev))
        this.writeValue(storage, frame, rc, 'OTE', this.insText(ins), 'OTE')
        return out
      }
      const outRef = this.resolve(op(1), frame)
      const pulse = m === 'OSR' ? p.and(rc, p.not(prev)) : p.and(p.not(rc), prev)
      if (outRef && outRef.literal === undefined) this.writeValue(outRef, frame, pulse, 'OTE', this.insText(ins), 'OTE')
      this.writeValue(storage, frame, rc, 'OTE', this.insText(ins), 'OTE')
      return rc
    }
    if (TIMERS.has(m)) {
      this.timer(ins, rc, frame)
      return rc
    }
    if (COUNTERS.has(m)) {
      const c = this.resolve(op(0), frame)
      if (c && c.literal === undefined) {
        this.writeValue(this.member(c, m === 'CTU' ? 'cu' : 'cd'), frame, rc, 'OTE', this.insText(ins), 'OTHER')
        this.writeValue(this.member(c, 'dn'), frame, rc, 'OPAQUE', this.insText(ins), 'OTHER', `ctr:${c.loc}`)
      }
      return rc
    }
    if (m === 'RES') {
      const t = this.resolve(op(0), frame)
      if (t && t.literal === undefined) for (const mem of ['dn', 'tt', 'en']) this.writeValue(this.member(t, mem), frame, rc, 'OTU', this.insText(ins), 'OTHER')
      return rc
    }
    if (m in MOVE_LIKE) {
      this.moveLike(ins, rc, frame)
      return rc
    }
    if (m === 'JSR') {
      this.jsr(ins, rc, frame)
      return rc
    }
    if (m === 'ALMD' || m === 'ALMA') {
      this.alarm(ins, rc, frame)
      return rc
    }
    if (EXECUTION_CONTROL.has(m)) {
      onControl(ins, rc)
      return rc
    }
    if (m === 'SSV') {
      const cls = lc(op(0))
      const attr = lc(op(2))
      if ((cls === 'program' || cls === 'task' || cls === 'routine') && /disable|inhibit/.test(attr)) {
        const target = `${cls === 'routine' ? 'routine' : cls}:${lc(op(1))}`
        this.executionControl.push({ anchor: `rung:${this.rungRef.routineId}#${this.rungRef.rung}`, instruction: this.insText(ins), routineId: this.rungRef.routineId, rung: this.rungRef.rung, target })
        this.diag('EXECUTION_CONTROL', `${this.insText(ins)} can disable ${cls} ${op(1)} at runtime; INTERLOCK does not model runtime attribute changes.`, this.rungWhere(), [], this.rungRef.routineId, this.rungRef.rung, [target])
      }
      return rc
    }
    const def = this.index.modules.get(lc(m))
    if (def) {
      this.callModule(ins, def, rc, frame)
      return rc
    }
    // Unknown instruction: never pretend to understand it.
    const locs = ins.operands.flatMap((o) => {
      const r = isTagOperand(o) ? this.resolve(o, frame) : null
      return r && r.literal === undefined ? [r.loc] : []
    })
    const where = `${this.rungWhere()}`
    this.diag('INSTRUCTION', `Instruction ${m} is not modeled; it is treated as an unknown condition and its writes are unknown.`, where, locs, this.rungRef.routineId, this.rungRef.rung)
    if (!KNOWN_INSTRUCTIONS.has(m)) {
      for (const loc of locs) this.writeLocOpaque(loc, frame, `unknown:${m}:${loc}`, this.insText(ins), rc)
    }
    return p.and(rc, this.opaqueAtom(`ins:${this.canonicalInstruction(ins, frame)}`, this.insText(ins)))
  }

  private rungWhere(): string {
    const r = this.index.routines.get(this.rungRef.routineId)
    return r ? `${r.container.name}/${r.name} rung ${this.rungRef.rung}` : `rung ${this.rungRef.rung}`
  }

  /** Instruction text with operands resolved to canonical locations (case/alias-insensitive). */
  private canonicalInstruction(ins: RllInstruction, frame: Frame): string {
    const ops = ins.operands.map((o) => {
      if (!isTagOperand(o)) return o.trim()
      const r = this.resolveQuiet(o, frame)
      return r ? (r.literal !== undefined ? String(r.literal) : r.loc) : lc(o)
    })
    return `${ins.mnemonic}(${ops.join(',')})`
  }

  /* -------------------------------------------------------- instructions */

  private comparison(ins: RllInstruction, frame: Frame): number {
    const p = this.pool
    const m = ins.mnemonic
    if (m === 'LIM') {
      const lo = this.numericOperand(ins.operands[0] ?? '', frame)
      const test = this.numericOperand(ins.operands[1] ?? '', frame)
      const hi = this.numericOperand(ins.operands[2] ?? '', frame)
      if (lo && hi && test && 'value' in lo && 'value' in hi && 'subject' in test) {
        return p.atom({
          key: `rng:${test.subject}:${lo.value}:${hi.value}`,
          label: rangeLabel({ subject: test.subject, subjectLabel: test.label, low: lo.value, high: hi.value, integer: test.integer }),
          kind: 'comparison',
          tag: test.label,
          range: { subject: test.subject, subjectLabel: test.label, low: lo.value, high: hi.value, integer: test.integer },
        })
      }
      if (lo && hi && test && 'value' in lo && 'value' in hi && 'value' in test) {
        const { value: l } = lo
        const { value: h } = hi
        const { value: x } = test
        return p.const(l <= h ? x >= l && x <= h : x >= l || x <= h)
      }
      return this.opaqueAtom(`cmp:${this.canonicalInstruction(ins, frame)}`, this.insText(ins))
    }
    const ops: Record<string, CompareOp> = { EQU: 'EQ', NEQ: 'NE', GRT: 'GT', GEQ: 'GE', LES: 'LT', LEQ: 'LE' }
    const flip: Record<CompareOp, CompareOp> = { GT: 'LT', GE: 'LE', LT: 'GT', LE: 'GE', EQ: 'EQ', NE: 'NE' }
    let cop = ops[m]!
    let a = this.numericOperand(ins.operands[0] ?? '', frame)
    let b = this.numericOperand(ins.operands[1] ?? '', frame)
    if (!a || !b) return this.opaqueAtom(`cmp:${this.canonicalInstruction(ins, frame)}`, this.insText(ins))
    if ('value' in a && 'value' in b) {
      const x = a.value
      const y = b.value
      const r = { EQ: x === y, NE: x !== y, GT: x > y, GE: x >= y, LT: x < y, LE: x <= y }[cop]
      return p.const(r)
    }
    if ('value' in a && 'subject' in b) {
      ;[a, b] = [b, a]
      cop = flip[cop]
    }
    if ('subject' in a && 'value' in b) {
      const test = { subject: a.subject, subjectLabel: a.label, op: cop, value: b.value, integer: a.integer }
      return p.atom({ key: `cmp:${a.subject}:${cop}:${b.value}`, label: numericLabel(test), kind: 'comparison', tag: a.label, numeric: test })
    }
    if ('subject' in a && 'subject' in b) {
      const sym: Record<CompareOp, string> = { GT: '>', GE: '>=', LT: '<', LE: '<=', EQ: '=', NE: '<>' }
      return p.atom({ key: `cmp2:${cop}:${a.subject}:${b.subject}`, label: `${a.label} ${sym[cop]} ${b.label}`, kind: 'comparison', tag: a.label })
    }
    return this.opaqueAtom(`cmp:${this.canonicalInstruction(ins, frame)}`, this.insText(ins))
  }

  private numericOperand(o: string, frame: Frame): { value: number } | { subject: string; label: string; integer: boolean } | null {
    const lit = parseNumericLiteral(o)
    if (lit !== null) return { value: lit }
    if (!isTagOperand(o)) return null
    const r = this.resolve(o, frame)
    if (!r) return null
    if (r.literal !== undefined) return { value: r.literal }
    this.noteRead(r.loc)
    const cur = this.cur.get(r.loc)
    if (cur) for (const a of cur.prov) this.rungProv.add(a)
    this.rungProv.add(`loc:${r.loc}`)
    const meta = this.meta.get(r.loc)
    // A value logic writes (MOV, CPT, ...) is not the raw input: the subject
    // carries the expression that produced it, so a changed or new write is
    // a different subject and can never compare as "equivalent".
    const written = cur?.expr ?? this.prevScan.get(r.loc)
    if (!cur) this.rungProv.add(`prev:${r.loc}`)
    const subject = written === undefined ? `num:${r.loc}` : `num:${r.loc}@${written}`
    const label = written === undefined ? r.label : `${r.label} (as written by logic)`
    return { subject, label, integer: meta?.integer ?? false }
  }

  private timer(ins: RllInstruction, rc: number, frame: Frame): void {
    const t = this.resolve(ins.operands[0] ?? '', frame)
    if (!t || t.literal !== undefined) return
    const presetText = ins.operands[1] ?? ''
    const preset = parseNumericLiteral(presetText)
    const use: TimerUse = { loc: t.loc, label: t.label, kind: ins.mnemonic, preset, presetText, routineId: this.rungRef.routineId, rung: this.rungRef.rung }
    if (this.rungRef.source) use.source = this.rungRef.source
    const list = this.timers.get(t.loc)
    if (list) list.push(use)
    else this.timers.set(t.loc, [use])
    const text = this.insText(ins)
    this.writeValue(this.member(t, 'en'), frame, rc, 'OTE', text, 'TIMER')
    if (ins.mnemonic === 'RTO') {
      this.writeValue(this.member(t, 'dn'), frame, rc, 'OPAQUE', text, 'TIMER', `rto:${t.loc}`)
    } else {
      // Steady state: a TON's done bit follows its input once the preset
      // elapses; a TOF's done bit follows its input until the preset elapses
      // after it drops. Timing is reported separately (preset comparison).
      this.writeValue(this.member(t, 'dn'), frame, rc, 'OTE', text, 'TIMER')
    }
    if (this.mode === 'rung') {
      // In isolation a preset change must make the rung "different".
      const pre = this.member(t, '#preset')
      this.writeValue(pre, frame, this.pool.TRUE, 'OPAQUE', text, 'TIMER', `preset:${t.loc}:${presetText.trim()}`)
    }
  }

  private moveLike(ins: RllInstruction, rc: number, frame: Frame): void {
    const destIndex = MOVE_LIKE[ins.mnemonic]!
    const text = this.insText(ins)
    if (destIndex < 0) {
      const locs = ins.operands.flatMap((o) => {
        const r = isTagOperand(o) ? this.resolve(o, frame) : null
        return r && r.literal === undefined ? [r.loc] : []
      })
      this.diag('INSTRUCTION', `${ins.mnemonic} writes are not modeled.`, this.rungWhere(), locs, this.rungRef.routineId, this.rungRef.rung)
      return
    }
    const destOp = ins.operands[destIndex]
    if (!destOp || !isTagOperand(destOp)) return
    const dest = this.resolve(destOp, frame)
    if (!dest || dest.literal !== undefined) return
    if (ins.mnemonic === 'CLR') {
      this.writeValue(dest, frame, rc, 'SETFALSE', text, 'MOVE')
      return
    }
    if (ins.mnemonic === 'MOV') {
      const src = parseNumericLiteral(ins.operands[0] ?? '')
      if (src === 0) return this.writeValue(dest, frame, rc, 'SETFALSE', text, 'MOVE')
      if (src === 1) return this.writeValue(dest, frame, rc, 'SETTRUE', text, 'MOVE')
    }
    this.writeValue(dest, frame, rc, 'OPAQUE', text, 'MOVE', `mov:${dest.loc}:${this.canonicalInstruction(ins, frame)}`)
    // A whole-word write changes every bit/member below it.
    const prefix = `${dest.loc}.`
    for (const loc of [...this.cur.keys()]) {
      if (loc.startsWith(prefix)) this.writeLocOpaque(loc, frame, `mov:${loc}:${this.canonicalInstruction(ins, frame)}`, text, rc)
    }
  }

  private jsr(ins: RllInstruction, rc: number, frame: Frame): void {
    const name = ins.operands[0] ?? ''
    const text = this.insText(ins)
    if (this.mode === 'rung' || frame.module) {
      const pseudo: Resolved = { loc: `#jsr:${lc(frame.program)}/${lc(name)}`, label: `JSR ${name}` }
      const value = ins.operands.length > 2 ? this.pool.and(rc, this.opaqueAtom(`jsr:${this.canonicalInstruction(ins, frame)}`, text)) : rc
      this.writeValue(pseudo, frame, value, 'OTE', text, 'OTHER')
      return
    }
    const target = this.index.routine(frame.program, name)
    if (!target) {
      this.diag('UNRESOLVED_REFERENCE', `JSR target ${name} is not a routine of program ${frame.program}.`, this.rungWhere(), [], this.rungRef.routineId, this.rungRef.rung)
      return
    }
    const guardProv = new Set([...frame.guardProv, ...this.rungProv, `rung:${this.rungRef.routineId}#${this.rungRef.rung}`, `routine:${this.rungRef.routineId}`])
    const child: Frame = { program: frame.program, routineId: target.id, guard: this.pool.and(frame.guard, rc), guardProv, depth: frame.depth + 1 }
    // Input parameters: JSR(Routine, n, in1, ...) copies each input into the
    // matching SBR(p1, ...) operand of the subroutine's first rung.
    const inputs = ins.operands.slice(2)
    if (inputs.length) {
      const first = target.rungs[0]
      const sbr = first ? instructionsOf(parseRung(first.text).elements).find((x) => x.mnemonic === 'SBR') : undefined
      if (!sbr) {
        this.diag('INSTRUCTION', `JSR(${name}) passes ${inputs.length} parameter(s) but ${target.name} has no SBR in its first rung.`, this.rungWhere(), [], this.rungRef.routineId, this.rungRef.rung)
      } else {
        inputs.forEach((arg, i) => {
          const param = sbr.operands[i]
          if (!param || !isTagOperand(param)) return
          const dest = this.resolve(param, child)
          if (!dest || dest.literal !== undefined) return
          const meta = this.meta.get(dest.loc)
          const value = meta?.integer === false || !isTagOperand(arg) ? this.bitOperandValue(arg, frame) : this.readBit(arg, frame)
          this.writeValue(dest, frame, value, 'COPY', text, 'OTHER')
        })
      }
    }
    const saved = { prov: this.rungProv, ref: this.rungRef }
    this.runRoutine(target, child)
    this.rungProv = saved.prov
    this.rungRef = saved.ref
  }

  private alarm(ins: RllInstruction, rc: number, frame: Frame): void {
    const a = this.resolve(ins.operands[0] ?? '', frame)
    if (!a || a.literal !== undefined) return
    const text = this.insText(ins)
    const notifyLoc = `${a.loc}#notify`
    const use: AlarmUse = { loc: a.loc, label: a.label, mechanism: ins.mnemonic as 'ALMD' | 'ALMA', notifyLoc, routineId: this.rungRef.routineId, rung: this.rungRef.rung, instruction: text }
    if (this.rungRef.source) use.source = this.rungRef.source
    this.alarms.set(a.loc, use)
    const p = this.pool
    if (ins.mnemonic === 'ALMA') {
      this.writeValue({ loc: notifyLoc, label: `${a.label} notification` }, frame, p.TRUE, 'OPAQUE', text, 'ALARM', `alma:${a.loc}`)
      return
    }
    // ALMD(Alarm, ProgAck, ProgReset, ProgDisable, ProgEnable): the rung is the
    // alarm input; ProgDisable (operand 4) disables it. Logic writes to the
    // ProgDisable/ProgSuppress members silence it too. Operator shelving and
    // suppression from the HMI are operator actions and are not modeled.
    this.writeValue(this.member(a, 'in'), frame, rc, 'OTE', text, 'ALARM')
    let silence = this.bitOperandValue(ins.operands[3] ?? '0', frame)
    for (const mem of ALARM_MEMBERS_THAT_SILENCE) {
      const ml = `${a.loc}.${mem}`
      const v = this.cur.get(ml)
      if (v) {
        silence = p.or(silence, v.expr)
        for (const x of v.prov) this.rungProv.add(x)
        continue
      }
      // Written later in the scan: the alarm sees last scan's value.
      const prev = this.prevScan.get(ml)
      if (prev !== undefined) {
        silence = p.or(silence, prev)
        this.rungProv.add(`loc:${ml}`)
        this.rungProv.add(`prev:${ml}`)
      }
    }
    this.writeValue({ loc: notifyLoc, label: `${a.label} notification` }, frame, p.and(rc, p.not(silence)), 'OTE', text, 'ALARM')
  }

  /** A bit operand that may be a literal (ALMD/AOI arguments). */
  private bitOperandValue(o: string, frame: Frame): number {
    const lit = parseNumericLiteral(o)
    if (lit !== null) return this.pool.const(lit !== 0)
    if (!isTagOperand(o)) return this.pool.FALSE
    return this.readBit(o, frame)
  }

  private callModule(ins: RllInstruction, def: ModuleDefinition, rc: number, frame: Frame): void {
    const p = this.pool
    const text = this.insText(ins)
    const backingRef = ins.operands[0] ?? ''
    const backing = this.resolve(backingRef, frame)
    if (!backing || backing.literal !== undefined) {
      this.diag('UNRESOLVED_REFERENCE', `${def.name} call has no resolvable backing tag (${backingRef}).`, this.rungWhere(), [], this.rungRef.routineId, this.rungRef.rung)
      return
    }
    const required = def.parameters.filter((x) => x.required)
    const args = ins.operands.slice(1)
    if (args.length !== required.length) {
      this.diag(
        'UNRESOLVED_REFERENCE',
        `${def.name}(${backingRef}) passes ${args.length} argument(s); the definition has ${required.length} required parameter(s). Arguments are bound by position.`,
        this.rungWhere(),
        [backing.loc],
        this.rungRef.routineId,
        this.rungRef.rung,
      )
    }
    const program = frame.program
    const site: CallSiteExec = {
      id: `${this.rungRef.routineId}#${this.rungRef.rung}#${lc(backing.label)}`,
      module: def.name,
      backingLabel: backing.label,
      backingLoc: backing.loc,
      routineId: this.rungRef.routineId,
      program,
      rung: this.rungRef.rung,
      operands: ins.operands,
      guard: frame.guard,
      resolved: true,
    }
    if (!frame.module) this.callSites.push(site)

    if (this.mode === 'rung' || def.protected || frame.depth > 8) {
      if (def.protected)
        this.diag('PROTECTED_CONTENT', `Add-On Instruction ${def.name} is source-protected; outputs of ${backing.label} are unknown.`, this.rungWhere(), [backing.loc], this.rungRef.routineId, this.rungRef.rung)
      // Opaque call: EnableIn follows the rung; every output depends on the exact argument list.
      const sig = `${lc(def.name)}(${ins.operands.map((o) => (isTagOperand(o) ? this.resolveQuiet(o, frame)?.loc ?? lc(o) : o.trim())).join(',')})`
      this.writeValue(this.member(backing, 'enablein'), frame, rc, 'OTE', text, 'MODULE_OUTPUT')
      def.parameters.forEach((param) => {
        if (param.usage === 'Input') return
        const target = this.member(backing, lc(param.name))
        this.writeValue(target, frame, rc, 'OPAQUE', text, 'MODULE_OUTPUT', `call:${sig}:${lc(param.name)}`)
        const ri = required.indexOf(param)
        const argOp = ri >= 0 ? args[ri] : undefined
        if (argOp && isTagOperand(argOp)) {
          const argRef = this.resolve(argOp, frame)
          if (argRef && argRef.literal === undefined) this.writeValue(argRef, frame, rc, 'OPAQUE', text, 'MODULE_OUTPUT', `call:${sig}:${lc(param.name)}`)
        }
      })
      return
    }

    const binding: ModuleBinding = {
      def,
      backingLoc: backing.loc,
      backingLabel: backing.label,
      params: new Map(def.parameters.map((x) => [lc(x.name), x])),
      args: new Map(required.map((x, i) => [lc(x.name), args[i] ?? ''])),
      locals: new Set(def.localTags.map((t) => lc(t.name))),
      caller: frame,
      writtenInCall: new Set(),
    }
    // Record the backing members' metadata so atoms on them carry the parameter's external access.
    for (const param of def.parameters) {
      const loc = `${backing.loc}.${lc(param.name)}`
      if (!this.meta.has(loc)) {
        const backingMeta = this.meta.get(backing.loc)
        this.meta.set(loc, {
          label: `${backing.label}.${param.name}`,
          externalAccess: weakestAccess(backingMeta?.externalAccess ?? 'Unknown', param.externalAccess),
          integer: isIntegerType(param.dataType),
          ...(backingMeta?.tag ? { tag: backingMeta.tag } : {}),
        })
      }
    }
    this.writeValue(this.member(backing, 'enablein'), frame, rc, 'OTE', text, 'MODULE_OUTPUT')
    const routine = this.index.moduleRoutine(def)
    const callAnchor = `rung:${this.rungRef.routineId}#${this.rungRef.rung}`
    const guardProv = new Set([...frame.guardProv, ...this.rungProv, callAnchor, `routine:${this.rungRef.routineId}`, `module:${lc(def.name)}`, `instance:${backing.loc}`])
    const child: Frame = { program, routineId: routine?.id ?? `module:${def.name}/Logic`, guard: p.and(frame.guard, rc), guardProv, module: binding, depth: frame.depth + 1 }
    const saved = { prov: this.rungProv, ref: this.rungRef }
    if (routine) this.runRoutine(routine, child)
    else this.diag('UNRESOLVED_REFERENCE', `Add-On Instruction ${def.name} has no logic routine.`, def.name, [backing.loc])
    this.rungProv = saved.prov
    this.rungRef = saved.ref
    // Copy required outputs out to their argument tags.
    required.forEach((param, i) => {
      if (param.usage !== 'Output') return
      const argOp = args[i]
      if (!argOp || !isTagOperand(argOp)) return
      const argRef = this.resolve(argOp, frame)
      if (!argRef || argRef.literal !== undefined) return
      const member = this.member(backing, lc(param.name))
      const value = this.readResolved(member)
      this.writeValue(argRef, frame, value, 'COPY', text, 'MODULE_OUTPUT')
    })
  }

  /* --------------------------------------------------------- read/write */

  private member(r: Resolved, member: string): Resolved {
    const display = MEMBER_DISPLAY[lc(member)] ?? member
    return { loc: `${r.loc}.${lc(member)}`, label: `${r.label}.${display}` }
  }

  private noteRead(loc: string) {
    this.readLocs.add(loc)
  }

  readBit(ref: string, frame: Frame): number {
    const r = this.resolve(ref, frame)
    if (!r) return this.opaqueAtom(`unresolved:${lc(ref)}`, ref)
    if (r.literal !== undefined) return this.pool.const(r.literal !== 0)
    return this.readResolved(r)
  }

  private readResolved(r: Resolved): number {
    this.noteRead(r.loc)
    const cur = this.cur.get(r.loc)
    if (cur) {
      for (const a of cur.prov) this.rungProv.add(a)
      this.rungProv.add(`loc:${r.loc}`)
      return cur.expr
    }
    this.rungProv.add(`loc:${r.loc}`)
    this.rungProv.add(`prev:${r.loc}`)
    const prev = this.prevScan.get(r.loc)
    return prev ?? this.atomForLoc(r)
  }

  atomForLoc(r: { loc: string; label: string }): number {
    const meta = this.meta.get(r.loc)
    const label = meta?.label ?? r.label
    return this.pool.atom({
      key: `tag:${r.loc}`,
      label,
      kind: r.loc.includes('.') || r.loc.includes('#') ? 'member' : 'tag',
      tag: meta?.tag?.name ?? label.split('.')[0]!,
    })
  }

  private opaqueAtom(key: string, label: string): number {
    return this.pool.atom({ key: `opaque:${key}`, label: `⟨${label}⟩`, kind: 'opaque' })
  }

  private writeValue(
    r: Resolved,
    frame: Frame,
    rc: number,
    mode: 'OTE' | 'OTL' | 'OTU' | 'SETTRUE' | 'SETFALSE' | 'OPAQUE' | 'COPY',
    instruction: string,
    kind: WriterKind,
    opaqueKey?: string,
  ): void {
    const p = this.pool
    const g = frame.guard
    const old = this.cur.get(r.loc)
    const oldExpr = old ? old.expr : this.atomForLoc(r)
    let expr: number
    let keepsOld = true
    switch (mode) {
      case 'OTE':
      case 'COPY':
        expr = p.ite(g, rc, oldExpr)
        keepsOld = g !== p.TRUE
        break
      case 'OTL':
      case 'SETTRUE':
        expr = p.ite(p.and(g, rc), p.TRUE, oldExpr)
        break
      case 'OTU':
      case 'SETFALSE':
        expr = p.ite(p.and(g, rc), p.FALSE, oldExpr)
        break
      case 'OPAQUE':
        expr = p.ite(p.and(g, rc), this.opaqueAtom(opaqueKey ?? `w${this.opaqueCounter++}`, instruction), oldExpr)
        break
    }
    const prov = new Set<Anchor>(this.rungProv)
    for (const a of frame.guardProv) prov.add(a)
    const rungAnchor = `rung:${this.rungRef.routineId}#${this.rungRef.rung}`
    prov.add(rungAnchor)
    prov.add(`routine:${this.rungRef.routineId}`)
    if (keepsOld) {
      if (old) for (const a of old.prov) prov.add(a)
      else {
        prov.add(`loc:${r.loc}`)
        prov.add(`prev:${r.loc}`)
      }
    }
    this.cur.set(r.loc, { expr, prov })
    if (frame.module) frame.module.writtenInCall.add(r.loc)
    const ev: WriteEvent = { loc: r.loc, label: this.meta.get(r.loc)?.label ?? r.label, routineId: this.rungRef.routineId, rung: this.rungRef.rung, instruction, kind, guard: g }
    if (this.rungRef.source) ev.source = this.rungRef.source
    const list = this.writes.get(r.loc)
    if (list) list.push(ev)
    else this.writes.set(r.loc, [ev])
  }

  private writeLocOpaque(loc: string, frame: Frame, key: string, instruction: string, rc?: number) {
    this.writeValue({ loc, label: this.meta.get(loc)?.label ?? loc }, frame, rc ?? this.pool.TRUE, 'OPAQUE', instruction, 'OTHER', key)
  }

  /* --------------------------------------------------------- resolution */

  private resolveQuiet(ref: string, frame: Frame): Resolved | null {
    return this.resolveInner(ref, frame, 0)
  }

  resolve(ref: string, frame: Frame): Resolved | null {
    const r = this.resolveInner(ref, frame, 0)
    if (!r && isTagOperand(ref)) {
      this.diag('UNRESOLVED_REFERENCE', `Tag ${ref} is not defined in scope.`, this.rungWhere(), [], this.rungRef.routineId, this.rungRef.rung)
    }
    return r
  }

  private resolveInner(ref: string, frame: Frame, depth: number): Resolved | null {
    const trimmed = ref.trim()
    const lit = parseNumericLiteral(trimmed)
    if (lit !== null) return { loc: `#lit:${lit}`, label: trimmed, literal: lit }
    if (!isTagOperand(trimmed) || depth > 8) return null
    const { base, member, program } = splitTagRef(trimmed)
    const memberLc = lc(member)
    const withMember = (r: Resolved, extraLabel?: string): Resolved =>
      member ? { loc: `${r.loc}${memberLc.startsWith('[') ? '' : '.'}${memberLc}`, label: `${extraLabel ?? r.label}${member.startsWith('[') ? '' : '.'}${member}` } : r

    if (frame.module && !program) {
      const b = frame.module
      const key = lc(base)
      const param = b.params.get(key)
      if (param) {
        if (param.usage === 'InOut' || (param.usage === 'Input' && param.required && !member && !b.writtenInCall.has(`${b.backingLoc}.${key}`))) {
          const arg = b.args.get(key)
          if (arg !== undefined && arg !== '') {
            const r = this.resolveInner(arg, b.caller, depth + 1)
            if (r) return member && r.literal === undefined ? withMember(r) : r
          }
          if (this.mode === 'rung') return withMember({ loc: `${b.backingLoc}.${key}`, label: `${b.backingLabel}.${param.name}` })
        }
        return withMember({ loc: `${b.backingLoc}.${key}`, label: `${b.backingLabel}.${param.name}` })
      }
      if (key === 'enablein' || key === 'enableout') return withMember({ loc: `${b.backingLoc}.${key}`, label: `${b.backingLabel}.${base}` })
      if (b.locals.has(key)) {
        const local = b.def.localTags.find((t) => lc(t.name) === key)!
        const loc = `${b.backingLoc}.${key}`
        if (!this.meta.has(loc)) this.meta.set(loc, { label: `${b.backingLabel}.${local.name}`, externalAccess: 'None', integer: isIntegerType(local.dataType) })
        return withMember({ loc, label: `${b.backingLabel}.${local.name}` })
      }
      return null
    }

    const resolved = this.index.resolveBase(base, program ?? frame.program)
    if (!resolved) {
      // I/O module tags (Local:3:I) and other module-defined data are not in <Tags>.
      if (base.includes(':')) {
        const loc = `c:${lc(base)}`
        if (!this.meta.has(loc)) this.meta.set(loc, { label: base, externalAccess: 'n/a', integer: false })
        return withMember({ loc, label: base })
      }
      return null
    }
    const { tag } = resolved
    if (tag.aliasFor && depth < 8) {
      const target = this.resolveInner(tag.aliasFor, { ...frame, module: undefined, program: resolved.program ?? frame.program } as Frame, depth + 1)
      if (target && target.literal === undefined) {
        const r = withMember({ loc: target.loc, label: tag.name })
        if (!this.meta.has(r.loc) || this.meta.get(r.loc)!.label === target.label)
          this.meta.set(r.loc, { label: r.label, tag, externalAccess: tag.externalAccess, integer: isIntegerType(tag.dataType) })
        return r
      }
    }
    const loc = resolved.scope === 'c' ? `c:${lc(tag.name)}` : `p:${lc(resolved.program!)}:${lc(tag.name)}`
    if (!this.meta.has(loc)) this.meta.set(loc, { label: tag.name, tag, externalAccess: tag.externalAccess, integer: isIntegerType(tag.dataType) })
    const r = withMember({ loc, label: tag.name })
    if (member && !this.meta.has(r.loc)) {
      const memberInteger = /^(pre|acc)$/i.test(member) || isIntegerType(this.memberType(tag, member))
      this.meta.set(r.loc, { label: r.label, tag, externalAccess: tag.externalAccess, integer: memberInteger })
    }
    return r
  }

  private memberType(tag: Tag, member: string): string | undefined {
    const first = member.split('.')[0]!.replace(/\[.*$/, '')
    const mod = this.index.modules.get(lc(tag.dataType))
    if (mod) return mod.parameters.find((p) => lc(p.name) === lc(first))?.dataType ?? mod.localTags.find((t) => lc(t.name) === lc(first))?.dataType
    const dt = this.index.project.dataTypes.find((d) => lc(d.name) === lc(tag.dataType))
    return dt?.members.find((m) => lc(m.name) === lc(first))?.dataType
  }

  /** Resolve a declaration's tag reference ("Tag", "\\Program.Tag", "Backing.Member"). */
  resolveDeclared(ref: string, program?: string): Resolved | null {
    const frame: Frame = { program: program ?? '', routineId: '', guard: this.pool.TRUE, guardProv: new Set(), depth: 0 }
    const direct = this.resolveInner(ref, frame, 0)
    if (direct) return direct
    if (!program) {
      for (const p of this.index.project.programs) {
        const r = this.resolveInner(ref, { ...frame, program: p.name }, 0)
        if (r) return r
      }
    }
    return null
  }

  private locsOfText(text: string, frame: Frame): string[] {
    const out = new Set<string>()
    for (const m of text.matchAll(/[A-Za-z_\\][A-Za-z0-9_.:\\[\]]*/g)) {
      const tok = m[0]
      const r = this.resolveQuiet(tok, frame)
      if (r && r.literal === undefined) out.add(r.loc)
    }
    return [...out]
  }

  private diag(kind: UnsupportedKind, detail: string, location: string, locs: string[], routineId?: string, rung?: number, anchors?: string[]) {
    const d: ScanDiagnostic = { kind, detail, location, locs }
    if (anchors) d.anchors = anchors
    if (routineId !== undefined) d.routineId = routineId
    if (rung !== undefined) d.rung = rung
    this.diagnostics.push(d)
  }

  /* --------------------------------------------------------- queries */

  /** End-of-scan value of a location (its start value when nothing wrote it). */
  valueOf(r: { loc: string; label: string }): number {
    return this.cur.get(r.loc)?.expr ?? this.atomForLoc(r)
  }

  /** Writes of a location that can execute (guard not constant false). */
  executedWrites(loc: string): WriteEvent[] {
    return (this.writes.get(loc) ?? []).filter((w) => w.guard !== this.pool.FALSE)
  }

  /**
   * Dependency cone of a location: every anchor its end-of-scan value used,
   * closed over "previous scan" reads of locations the scan also writes.
   */
  cone(loc: string): Set<Anchor> {
    const out = new Set<Anchor>([`loc:${loc}`])
    const queue: string[] = [loc]
    const seen = new Set<string>()
    while (queue.length) {
      const l = queue.pop()!
      if (seen.has(l)) continue
      seen.add(l)
      const v = this.cur.get(l)
      if (!v) continue
      for (const a of v.prov) {
        out.add(a)
        if (a.startsWith('prev:')) {
          const pl = a.slice(5)
          if (!seen.has(pl)) queue.push(pl)
        }
      }
    }
    return out
  }

  /** Every instruction mnemonic used in executed RLL (for coverage). */
  static instructionsOfRung(text: string): string[] {
    const r = parseRung(text)
    return instructionsOf(r.elements).map((i) => i.mnemonic)
  }
}

const ACCESS_RANK: Record<string, number> = { None: 0, 'Read Only': 1, 'Read/Write': 2, Unknown: 2, 'n/a': 0 }

function weakestAccess(a: ExternalAccess | 'n/a', b: ExternalAccess | 'n/a'): ExternalAccess | 'n/a' {
  return (ACCESS_RANK[a] ?? 2) <= (ACCESS_RANK[b] ?? 2) ? a : b
}
