/**
 * Case-insensitive lookup tables over a ParsedProject. Logix identifiers are
 * case-insensitive (`pump_01` and `Pump_01` are the same tag), so every index
 * is keyed by the lower-cased name while keeping the declared spelling for
 * display.
 */
import type { ModuleDefinition, ParsedProject, Program, Routine, Tag, Task } from '../model/project.ts'

export const lc = (s: string) => s.toLowerCase()

export interface ResolvedTag {
  tag: Tag
  scope: 'c' | 'p'
  program?: string
}

const INTEGER_TYPES = new Set(['SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT', 'BOOL'])

export function isIntegerType(dataType: string | undefined): boolean {
  return dataType !== undefined && INTEGER_TYPES.has(dataType.toUpperCase())
}

export class ProjectIndex {
  readonly project: ParsedProject
  readonly routines = new Map<string, Routine>()
  /** program (lc) → routine name (lc) → routine */
  readonly programRoutines = new Map<string, Map<string, Routine>>()
  readonly programs = new Map<string, Program>()
  readonly modules = new Map<string, ModuleDefinition>()
  readonly tasks = new Map<string, Task>()
  readonly controllerTags = new Map<string, Tag>()
  readonly programTags = new Map<string, Map<string, Tag>>()
  /** routine id → program name (declared spelling) for program routines */
  readonly routineProgram = new Map<string, string>()
  /** program (lc) → task name */
  readonly programTask = new Map<string, string>()

  constructor(project: ParsedProject) {
    this.project = project
    for (const r of project.routines) {
      this.routines.set(r.id, r)
      if (r.container.kind === 'program') {
        const key = lc(r.container.name)
        let m = this.programRoutines.get(key)
        if (!m) this.programRoutines.set(key, (m = new Map()))
        m.set(lc(r.name), r)
        this.routineProgram.set(r.id, r.container.name)
      }
    }
    for (const p of project.programs) this.programs.set(lc(p.name), p)
    for (const m of project.modules) this.modules.set(lc(m.name), m)
    for (const t of project.tasks) {
      this.tasks.set(lc(t.name), t)
      for (const p of t.scheduledPrograms) if (!this.programTask.has(lc(p))) this.programTask.set(lc(p), t.name)
    }
    for (const t of project.tags) {
      if (t.scope.kind === 'controller') this.controllerTags.set(lc(t.name), t)
      else if (t.scope.kind === 'program') {
        const key = lc(t.scope.program)
        let m = this.programTags.get(key)
        if (!m) this.programTags.set(key, (m = new Map()))
        m.set(lc(t.name), t)
      }
    }
  }

  routine(program: string, name: string): Routine | undefined {
    return this.programRoutines.get(lc(program))?.get(lc(name))
  }

  moduleRoutine(module: ModuleDefinition): Routine | undefined {
    const routines = module.routineIds.map((id) => this.routines.get(id)).filter((r): r is Routine => r !== undefined)
    return routines.find((r) => lc(r.name) === 'logic') ?? routines[0]
  }

  /** Resolve a base tag name in a program context: program scope first, then controller scope. */
  resolveBase(base: string, program?: string): ResolvedTag | null {
    const key = lc(base)
    if (program) {
      const t = this.programTags.get(lc(program))?.get(key)
      if (t) return { tag: t, scope: 'p', program: t.scope.kind === 'program' ? t.scope.program : program }
    }
    const t = this.controllerTags.get(key)
    return t ? { tag: t, scope: 'c' } : null
  }

  /** Programs that never execute and why. */
  executionBlocks(): Map<string, string> {
    const out = new Map<string, string>()
    const scheduled = new Set<string>()
    for (const t of this.project.tasks) {
      for (const p of t.scheduledPrograms) {
        scheduled.add(lc(p))
        if (t.inhibited) out.set(lc(p), `task ${t.name} is inhibited`)
      }
    }
    for (const p of this.project.programs) {
      if (!scheduled.has(lc(p.name))) out.set(lc(p.name), 'program is not scheduled in any task')
      else if (p.disabled) out.set(lc(p.name), 'program is disabled')
    }
    return out
  }
}
