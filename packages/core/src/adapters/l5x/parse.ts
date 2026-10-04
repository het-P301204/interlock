/**
 * Rockwell Logix Designer L5X -> ParsedProject.
 *
 * Structural only: rung text is kept exactly as exported (trimmed) and never
 * interpreted here. Unknown elements (Modules, Trends, DataLogs, ...) are
 * ignored; anything structurally wrong in the parts that ARE read becomes a
 * diagnostic. Error-severity diagnostics make the whole parse fail with a
 * ProjectParseError that carries every diagnostic, because a model with a
 * nameless program or a rung without text cannot be trusted.
 */
import { ProjectParseError } from '../types.ts'
import type { ParseOptions } from '../types.ts'
import type {
  ContainerRef,
  DataType,
  DataTypeMember,
  ModuleDefinition,
  ModuleParameter,
  ParsedProject,
  Program,
  ProjectMetadata,
  Routine,
  RoutineKind,
  Rung,
  StLine,
  Tag,
  TagScope,
  Task,
} from '../../model/project.ts'
import { displayValue, parseXml } from '../../xml/parser.ts'
import { attr, childrenNamed, firstChild, sourceOf } from '../../xml/query.ts'
import type { XmlElement } from '../../xml/types.ts'
import { clean, collect, diag, makeScope, q, readBool, readDoc, readExternalAccess, readName, readNumber, readText } from './context.ts'
import type { Ctx } from './context.ts'
import { readValue } from './values.ts'

export const L5X_FORMAT_LABEL = 'Rockwell Logix Designer export (L5X)'
export const L5X_VENDOR = 'Rockwell Automation'

const SYSTEM_PARAMETERS = new Set(['ENABLEIN', 'ENABLEOUT'])
const TAG_TYPES = new Set(['Base', 'Alias', 'Produced', 'Consumed'])
const CONTENT_ELEMENT: Record<Exclude<RoutineKind, 'UNKNOWN'>, string> = {
  RLL: 'RLLContent',
  ST: 'STContent',
  FBD: 'FBDContent',
  SFC: 'SFCContent',
}

/** Parse L5X text. Throws ProjectParseError, and nothing else. */
export function parseL5x(text: string, options?: ParseOptions): ParsedProject {
  try {
    return parseL5xInner(text, options)
  } catch (e) {
    if (e instanceof ProjectParseError) throw e
    throw new ProjectParseError('L5X_INTERNAL_ERROR', `Internal L5X adapter error: ${e instanceof Error ? e.message : String(e)}`, {
      location: '(document)',
    })
  }
}

function parseL5xInner(text: string, options?: ParseOptions): ParsedProject {
  const root = parseXml(text, options?.limits)
  if (root.name !== 'RSLogix5000Content') {
    throw new ProjectParseError(
      'L5X_WRONG_ROOT',
      `The root element is <${displayValue(root.name)}>, not <RSLogix5000Content>: this is not a Rockwell Logix Designer L5X export.`,
      { location: root.location, source: sourceOf(root) },
    )
  }
  const controllers = childrenNamed(root, 'Controller')
  const controller = controllers[0]
  if (controller === undefined) {
    throw new ProjectParseError('L5X_NO_CONTROLLER', 'The L5X file has no <Controller> element, so there is no project to analyze.', {
      location: root.location,
      source: sourceOf(root),
    })
  }

  const targetType = attr(root, 'TargetType')?.trim()
  const ctx: Ctx = { diagnostics: [], partial: targetType !== undefined && targetType !== 'Controller' }

  if (controllers.length > 1) {
    diag(
      ctx,
      'error',
      'L5X_MULTIPLE_CONTROLLERS',
      `The file has ${controllers.length} <Controller> elements; an L5X export has exactly one. INTERLOCK will not guess which one is real.`,
      controllers[1],
    )
  }

  const metadata = readMetadata(ctx, root, controller, targetType)

  const dataTypes: DataType[] = []
  const modules: ModuleDefinition[] = []
  const routines: Routine[] = []
  const tags: Tag[] = []
  const programs: Program[] = []
  const tasks: Task[] = []

  const typeScope = makeScope(ctx, 'the controller (data types and Add-On Instructions share one namespace)')
  for (const el of collect(ctx, controller, 'DataTypes', ['DataType'])) {
    const dt = readDataType(ctx, el)
    if (dt === undefined) continue
    typeScope.add(dt.name, el, 'data type')
    dataTypes.push(dt)
  }

  for (const el of collect(ctx, controller, 'AddOnInstructionDefinitions', ['AddOnInstructionDefinition', 'EncodedData'])) {
    const m = readModule(ctx, el, routines)
    if (m === undefined) continue
    typeScope.add(m.name, el, 'Add-On Instruction')
    modules.push(m)
  }

  const controllerTagScope = makeScope(ctx, 'controller scope')
  for (const el of collect(ctx, controller, 'Tags', ['Tag'])) {
    const tag = readTag(ctx, el, { kind: 'controller' }, 'Data', 'Controller tag')
    if (tag === undefined) continue
    controllerTagScope.add(tag.name, el, 'tag')
    tags.push(tag)
  }

  const programScope = makeScope(ctx, 'the controller')
  const programEls: [Program, XmlElement][] = []
  const taskEls: [Task, XmlElement][] = []
  const childPrograms = new Set<string>()
  for (const el of collect(ctx, controller, 'Programs', ['Program'])) {
    const p = readProgram(ctx, el, routines, tags)
    if (p === undefined) continue
    programScope.add(p.name, el, 'program')
    programs.push(p)
    programEls.push([p, el])
    for (const child of collect(ctx, el, 'ChildPrograms', ['ChildProgram'])) {
      const n = attr(child, 'Name')
      if (n !== undefined) childPrograms.add(n.trim().toUpperCase())
    }
  }

  const taskScope = makeScope(ctx, 'the controller')
  for (const el of collect(ctx, controller, 'Tasks', ['Task'])) {
    const t = readTask(ctx, el)
    if (t === undefined) continue
    taskScope.add(t.name, el, 'task')
    tasks.push(t)
    taskEls.push([t, el])
  }

  checkSchedule(ctx, programEls, taskEls, childPrograms)

  if (ctx.partial) {
    diag(
      ctx,
      'info',
      'L5X_PARTIAL_EXPORT',
      `This is a partial export (TargetType=${q(targetType ?? '')}): only the exported component and its context are present. ` +
        'References to anything outside it cannot be resolved, and task scheduling may be missing.',
      root,
    )
  }

  const errors = ctx.diagnostics.filter((d) => d.severity === 'error')
  const first = errors[0]
  if (first !== undefined) {
    const more = errors.length > 1 ? ` (and ${errors.length - 1} more error${errors.length > 2 ? 's' : ''})` : ''
    const opts: { location?: string; source?: typeof first.source; diagnostics: typeof ctx.diagnostics } = { diagnostics: ctx.diagnostics }
    if (first.location !== undefined) opts.location = first.location
    if (first.source !== undefined) opts.source = first.source
    throw new ProjectParseError(first.code, first.message + more, opts)
  }

  return { metadata, tasks, programs, routines, modules, tags, dataTypes, diagnostics: ctx.diagnostics }
}

// ------------------------------------------------------------------ metadata

function readMetadata(ctx: Ctx, root: XmlElement, controller: XmlElement, targetType: string | undefined): ProjectMetadata {
  const controllerName = readText(ctx, controller, 'Name')
  const targetName = readText(ctx, root, 'TargetName')
  let name = ctx.partial ? (targetName ?? controllerName) : (controllerName ?? targetName)
  if (name === undefined) {
    diag(ctx, 'warning', 'L5X_CONTROLLER_UNNAMED', 'Neither <Controller Name> nor TargetName is present; the project is shown as "(unnamed)".', controller)
    name = '(unnamed)'
  }
  if (targetType === undefined) {
    diag(ctx, 'warning', 'L5X_MISSING_TARGET_TYPE', 'The root element has no TargetType attribute; assuming a whole-controller export.', root)
  }
  const md: ProjectMetadata = {
    format: 'L5X',
    formatLabel: L5X_FORMAT_LABEL,
    vendor: L5X_VENDOR,
    controllerName: name,
    targetType: targetType === undefined || targetType === '' ? 'Controller' : clean(ctx, targetType, root, 'TargetType attribute'),
    containsContext: readBool(ctx, root, 'ContainsContext', false),
  }
  const processorType = readText(ctx, controller, 'ProcessorType')
  if (processorType !== undefined) md.processorType = processorType
  const major = readText(ctx, controller, 'MajorRev')
  const minor = readText(ctx, controller, 'MinorRev')
  if (major !== undefined) md.firmwareRevision = minor !== undefined ? `${major}.${minor}` : major
  const schema = readText(ctx, root, 'SchemaRevision')
  if (schema !== undefined) md.schemaRevision = schema
  const software = readText(ctx, root, 'SoftwareRevision')
  if (software !== undefined) md.softwareRevision = software
  const exportDate = readText(ctx, root, 'ExportDate')
  if (exportDate !== undefined) md.exportDate = exportDate
  return md
}

// ------------------------------------------------------------------ data types

function readDataType(ctx: Ctx, el: XmlElement): DataType | undefined {
  const name = readName(ctx, el, 'Data type')
  if (name === undefined) return undefined
  const members: DataTypeMember[] = []
  const scope = makeScope(ctx, `data type ${q(name)}`)
  for (const m of collect(ctx, el, 'Members', ['Member'])) {
    const mName = readName(ctx, m, 'Data type member')
    if (mName === undefined) continue
    scope.add(mName, m, 'member')
    members.push({ name: mName, dataType: readText(ctx, m, 'DataType') ?? 'UNKNOWN', hidden: readBool(ctx, m, 'Hidden', false) })
  }
  const dt: DataType = { name, members, source: sourceOf(el) }
  const family = readText(ctx, el, 'Family')
  if (family !== undefined) dt.family = family
  return dt
}

// ------------------------------------------------------------------ tags

function readTag(
  ctx: Ctx,
  el: XmlElement,
  scope: TagScope,
  dataName: 'Data' | 'DefaultData',
  kind: string,
  usage?: Tag['usage'],
): Tag | undefined {
  const name = readName(ctx, el, kind)
  if (name === undefined) return undefined
  const tagType = readText(ctx, el, 'TagType') ?? 'Base'
  if (!TAG_TYPES.has(tagType)) {
    diag(ctx, 'warning', 'L5X_UNKNOWN_TAG_TYPE', `${kind} ${q(name)} has TagType=${q(tagType)} (expected Base, Alias, Produced or Consumed).`, el)
  }
  const aliasFor = readText(ctx, el, 'AliasFor')
  if (tagType === 'Alias' && aliasFor === undefined) {
    diag(ctx, 'warning', 'L5X_ALIAS_WITHOUT_TARGET', `Alias tag ${q(name)} has no AliasFor attribute, so what it refers to is unknown.`, el)
  }
  let dataType = readText(ctx, el, 'DataType')
  if (dataType === undefined) {
    if (tagType === 'Alias') dataType = 'ALIAS'
    else {
      diag(ctx, 'warning', 'L5X_MISSING_DATA_TYPE', `${kind} ${q(name)} has no DataType attribute.`, el)
      dataType = 'UNKNOWN'
    }
  }
  const tag: Tag = {
    name,
    scope,
    dataType,
    constant: readBool(ctx, el, 'Constant', false),
    externalAccess: readExternalAccess(ctx, el),
    source: sourceOf(el),
  }
  if (usage !== undefined) tag.usage = usage
  const description = readDoc(ctx, el, 'Description', 'description')
  if (description !== undefined) tag.description = description
  if (aliasFor !== undefined) tag.aliasFor = aliasFor
  const dims = readText(ctx, el, 'Dimensions')
  if (dims !== undefined && dims !== '0') tag.dimensions = dims
  const value = readValue(ctx, el, dataName)
  if (value !== undefined) tag.value = value
  return tag
}

// ------------------------------------------------------------------ routines

function routineKind(type: string | undefined): RoutineKind {
  switch (type) {
    case 'RLL':
    case 'ST':
    case 'FBD':
    case 'SFC':
      return type
    default:
      return 'UNKNOWN'
  }
}

function isRungNumber(s: string): boolean {
  if (s.length === 0 || s.length > 9) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** Strip leading/trailing line breaks without a regex. */
function trimLineBreaks(s: string): string {
  let a = 0
  let b = s.length
  while (a < b && s.charCodeAt(a) === 10) a++
  while (b > a && s.charCodeAt(b - 1) === 10) b--
  return s.slice(a, b)
}

function readRungs(ctx: Ctx, content: XmlElement, routineLabel: string, out: Rung[]): void {
  let prev = -1
  const numbers = new Set<number>()
  for (const r of content.children) {
    if (r.name !== 'Rung') {
      diag(
        ctx,
        'warning',
        'L5X_UNEXPECTED_ELEMENT',
        `Unexpected <${displayValue(r.name)}> inside <RLLContent> of ${routineLabel}; only <Rung> carries ladder logic. It was ignored.`,
        r,
      )
      continue
    }
    const position = out.length
    const rawNumber = attr(r, 'Number')?.trim()
    let number: number
    if (rawNumber !== undefined && isRungNumber(rawNumber)) {
      number = Number(rawNumber)
    } else {
      diag(
        ctx,
        'warning',
        'L5X_INVALID_RUNG_NUMBER',
        `Rung ${position} of ${routineLabel} has ${rawNumber === undefined ? 'no Number attribute' : `Number=${q(rawNumber)}`}; its position (${position}) is used instead.`,
        r,
      )
      number = position
    }
    if (numbers.has(number)) {
      diag(ctx, 'warning', 'L5X_DUPLICATE_RUNG_NUMBER', `Rung number ${number} appears more than once in ${routineLabel}; rungs are kept in file order.`, r)
    } else if (number < prev) {
      diag(ctx, 'warning', 'L5X_RUNG_ORDER', `Rung ${number} follows rung ${prev} in ${routineLabel}; rungs are kept in file order.`, r)
    }
    numbers.add(number)
    prev = Math.max(prev, number)

    const texts = childrenNamed(r, 'Text')
    const textEl = texts[0]
    if (textEl === undefined) {
      diag(ctx, 'error', 'L5X_RUNG_WITHOUT_TEXT', `Rung ${number} of ${routineLabel} has no <Text> element, so its logic is unknown.`, r)
      continue
    }
    if (texts.length > 1) {
      diag(ctx, 'error', 'L5X_AMBIGUOUS_RUNG_TEXT', `Rung ${number} of ${routineLabel} has ${texts.length} <Text> elements; which one executes is ambiguous.`, texts[1])
    }
    const rung: Rung = { number, text: clean(ctx, textEl.text, textEl, 'rung text').trim(), source: sourceOf(r) }
    const comment = readDoc(ctx, r, 'Comment', 'rung comment')
    if (comment !== undefined) rung.comment = comment
    const type = readText(ctx, r, 'Type')
    if (type !== undefined) {
      rung.type = type
      if (type !== 'N') {
        diag(
          ctx,
          'info',
          'L5X_PENDING_RUNG_EDIT',
          `Rung ${number} of ${routineLabel} has Type=${q(type)} (a pending or test edit, not a normal rung); it was kept as exported.`,
          r,
        )
      }
    }
    out.push(rung)
  }
}

function readStLines(ctx: Ctx, content: XmlElement, routineLabel: string, out: StLine[]): void {
  for (const l of content.children) {
    if (l.name !== 'Line') {
      diag(ctx, 'warning', 'L5X_UNEXPECTED_ELEMENT', `Unexpected <${displayValue(l.name)}> inside <STContent> of ${routineLabel}; it was ignored.`, l)
      continue
    }
    const raw = attr(l, 'Number')?.trim()
    let number = out.length
    if (raw !== undefined && isRungNumber(raw)) number = Number(raw)
    else {
      diag(ctx, 'warning', 'L5X_INVALID_LINE_NUMBER', `A structured-text line of ${routineLabel} has no valid Number; its position (${number}) is used.`, l)
    }
    out.push({ number, text: trimLineBreaks(clean(ctx, l.text, l, 'structured text')).trimEnd(), source: sourceOf(l) })
  }
}

function readRoutine(ctx: Ctx, el: XmlElement, container: ContainerRef, scope: ReturnType<typeof makeScope>): Routine | undefined {
  const encodedElement = el.name === 'EncodedData'
  if (encodedElement) {
    const encodedType = attr(el, 'EncodedType')
    if (encodedType !== undefined && encodedType !== 'Routine') {
      diag(
        ctx,
        'warning',
        'L5X_UNEXPECTED_ELEMENT',
        `<EncodedData EncodedType=${q(encodedType)}> found among routines; it was treated as a protected routine.`,
        el,
      )
    }
  }
  const name = readName(ctx, el, 'Routine')
  if (name === undefined) return undefined
  scope.add(name, el, 'routine')
  const label = `${container.kind === 'program' ? 'program' : 'Add-On Instruction'} ${q(container.name)} / routine ${q(name)}`

  const typeAttr = readText(ctx, el, 'Type')
  let kind = routineKind(typeAttr)
  if (typeAttr === undefined) {
    const inferred = (Object.keys(CONTENT_ELEMENT) as Exclude<RoutineKind, 'UNKNOWN'>[]).find((k) => firstChild(el, CONTENT_ELEMENT[k]) !== undefined)
    if (inferred !== undefined) kind = inferred
    diag(
      ctx,
      'warning',
      'L5X_MISSING_ROUTINE_TYPE',
      `Routine ${label} has no Type attribute${inferred !== undefined ? `; ${inferred} was inferred from its content` : ''}.`,
      el,
    )
  } else if (kind === 'UNKNOWN') {
    diag(ctx, 'warning', 'L5X_UNSUPPORTED_ROUTINE_TYPE', `Routine ${label} has Type=${q(typeAttr)}, which INTERLOCK does not recognize; its content was not read.`, el)
  }

  const routine: Routine = {
    id: `${container.kind}:${container.name}/${name}`,
    name,
    container,
    kind,
    rungs: [],
    stLines: [],
    protected: encodedElement || firstChild(el, 'EncodedData') !== undefined,
    source: sourceOf(el),
  }
  const description = readDoc(ctx, el, 'Description', 'description')
  if (description !== undefined) routine.description = description

  if (routine.protected) {
    diag(
      ctx,
      'warning',
      'L5X_PROTECTED_CONTENT',
      `Routine ${label} is source-protected: its logic is encoded and cannot be read, so changes inside it cannot be analyzed.`,
      el,
    )
    return routine
  }

  for (const c of el.children) {
    if (!c.name.endsWith('Content')) continue
    if (kind !== 'UNKNOWN' && c.name === CONTENT_ELEMENT[kind]) continue
    diag(
      ctx,
      'warning',
      'L5X_ROUTINE_CONTENT_MISMATCH',
      `Routine ${label} is Type=${q(typeAttr ?? kind)} but contains <${displayValue(c.name)}>; that content was not read.`,
      c,
    )
  }

  if (kind === 'RLL' || kind === 'ST') {
    const contents = childrenNamed(el, CONTENT_ELEMENT[kind])
    if (contents.length > 1) {
      diag(ctx, 'warning', 'L5X_DUPLICATE_ELEMENT', `Routine ${label} has ${contents.length} <${CONTENT_ELEMENT[kind]}> elements; all were read in order.`, contents[1])
    }
    for (const content of contents) {
      if (kind === 'RLL') readRungs(ctx, content, label, routine.rungs)
      else readStLines(ctx, content, label, routine.stLines)
    }
  }
  if (kind === 'ST' || kind === 'FBD' || kind === 'SFC') {
    diag(
      ctx,
      'info',
      'L5X_ROUTINE_NOT_ANALYZED',
      `Routine ${label} is ${kind}; it is parsed structurally only (${kind === 'ST' ? 'lines are kept for display and diff' : 'its diagram is not read'}). ` +
        'Firing-condition analysis covers ladder (RLL) logic.',
      el,
    )
  }
  return routine
}

function readRoutines(ctx: Ctx, parent: XmlElement, container: ContainerRef, routines: Routine[]): string[] {
  const ids: string[] = []
  const scope = makeScope(ctx, container.kind === 'program' ? `program ${q(container.name)}` : `Add-On Instruction ${q(container.name)}`)
  for (const el of collect(ctx, parent, 'Routines', ['Routine', 'EncodedData'])) {
    const r = readRoutine(ctx, el, container, scope)
    if (r === undefined) continue
    routines.push(r)
    ids.push(r.id)
  }
  return ids
}

// ------------------------------------------------------------------ programs

function readProgram(ctx: Ctx, el: XmlElement, routines: Routine[], tags: Tag[]): Program | undefined {
  const name = readName(ctx, el, 'Program')
  if (name === undefined) return undefined
  const program: Program = { name, disabled: readBool(ctx, el, 'Disabled', false), source: sourceOf(el) }
  const main = readText(ctx, el, 'MainRoutineName')
  if (main !== undefined) program.mainRoutine = main
  const fault = readText(ctx, el, 'FaultRoutineName')
  if (fault !== undefined) program.faultRoutine = fault
  const cls = readText(ctx, el, 'Class')
  if (cls !== undefined) program.programClass = cls
  const description = readDoc(ctx, el, 'Description', 'description')
  if (description !== undefined) program.description = description

  const tagScope = makeScope(ctx, `program ${q(name)}`)
  for (const t of collect(ctx, el, 'Tags', ['Tag'])) {
    const tag = readTag(ctx, t, { kind: 'program', program: name }, 'Data', 'Program tag')
    if (tag === undefined) continue
    tagScope.add(tag.name, t, 'tag')
    tags.push(tag)
  }

  const before = routines.length
  readRoutines(ctx, el, { kind: 'program', name }, routines)
  const own = routines.slice(before)
  const hasRoutine = (r: string): boolean => own.some((x) => x.name.toUpperCase() === r.toUpperCase())
  if (!ctx.partial) {
    if (main !== undefined && !hasRoutine(main)) {
      diag(ctx, 'warning', 'L5X_MAIN_ROUTINE_MISSING', `Program ${q(name)} names main routine ${q(main)}, but no routine with that name exists in it; nothing in it executes.`, el)
    }
    if (fault !== undefined && !hasRoutine(fault)) {
      diag(ctx, 'warning', 'L5X_FAULT_ROUTINE_MISSING', `Program ${q(name)} names fault routine ${q(fault)}, but no routine with that name exists in it.`, el)
    }
  }
  if (program.disabled) {
    diag(ctx, 'info', 'L5X_PROGRAM_DISABLED', `Program ${q(name)} is disabled (Disabled=true): none of its routines executes.`, el)
  }
  if (main === undefined && own.length > 0 && !ctx.partial) {
    diag(ctx, 'info', 'L5X_NO_MAIN_ROUTINE', `Program ${q(name)} has no MainRoutineName; none of its routines executes.`, el)
  }
  return program
}

// ------------------------------------------------------------------ tasks

function readTask(ctx: Ctx, el: XmlElement): Task | undefined {
  const name = readName(ctx, el, 'Task')
  if (name === undefined) return undefined
  const rawType = readText(ctx, el, 'Type')
  let type: Task['type'] = 'UNKNOWN'
  if (rawType === 'CONTINUOUS' || rawType === 'PERIODIC' || rawType === 'EVENT') type = rawType
  else {
    diag(
      ctx,
      'warning',
      'L5X_UNKNOWN_TASK_TYPE',
      `Task ${q(name)} has ${rawType === undefined ? 'no Type attribute' : `Type=${q(rawType)}`} (expected CONTINUOUS, PERIODIC or EVENT).`,
      el,
    )
  }
  const task: Task = {
    name,
    type,
    inhibited: readBool(ctx, el, 'InhibitTask', false),
    disableUpdateOutputs: readBool(ctx, el, 'DisableUpdateOutputs', false),
    scheduledPrograms: [],
    source: sourceOf(el),
  }
  const priority = readNumber(ctx, el, 'Priority')
  if (priority !== undefined) task.priority = priority
  const rate = readNumber(ctx, el, 'Rate')
  if (rate !== undefined) task.rate = rate
  const watchdog = readNumber(ctx, el, 'Watchdog')
  if (watchdog !== undefined) task.watchdog = watchdog
  const description = readDoc(ctx, el, 'Description', 'description')
  if (description !== undefined) task.description = description
  for (const sp of collect(ctx, el, 'ScheduledPrograms', ['ScheduledProgram'])) {
    const p = readName(ctx, sp, 'Scheduled program')
    if (p !== undefined) task.scheduledPrograms.push(p)
  }
  if (task.inhibited) {
    diag(ctx, 'info', 'L5X_TASK_INHIBITED', `Task ${q(name)} is inhibited (InhibitTask=true): none of its programs executes.`, el)
  }
  return task
}

function checkSchedule(ctx: Ctx, programs: [Program, XmlElement][], tasks: [Task, XmlElement][], childPrograms: Set<string>): void {
  if (ctx.partial) return
  const known = new Set<string>()
  for (const [p] of programs) known.add(p.name.toUpperCase())
  const scheduledIn = new Map<string, string>()
  for (const [t, el] of tasks) {
    for (const p of t.scheduledPrograms) {
      const key = p.toUpperCase()
      if (!known.has(key)) {
        diag(ctx, 'warning', 'L5X_UNKNOWN_SCHEDULED_PROGRAM', `Task ${q(t.name)} schedules program ${q(p)}, which does not exist in the export.`, el)
      }
      const prev = scheduledIn.get(key)
      if (prev !== undefined) {
        diag(
          ctx,
          'warning',
          'L5X_PROGRAM_SCHEDULED_TWICE',
          `Program ${q(p)} is scheduled in task ${q(prev)} and again in task ${q(t.name)}; Logix allows one task per program.`,
          el,
        )
      } else scheduledIn.set(key, t.name)
    }
  }
  for (const [p, el] of programs) {
    const key = p.name.toUpperCase()
    if (!scheduledIn.has(key) && !childPrograms.has(key)) {
      diag(ctx, 'info', 'L5X_UNSCHEDULED_PROGRAM', `Program ${q(p.name)} is not scheduled in any task, so it does not execute.`, el)
    }
  }
}

// ------------------------------------------------------------------ Add-On Instructions

function readSignatureId(el: XmlElement): string | undefined {
  const direct = attr(el, 'SignatureID')
  if (direct !== undefined && direct.trim() !== '') return direct.trim()
  const sig = firstChild(el, 'Signature')
  if (sig !== undefined) {
    const v = attr(sig, 'SignatureID') ?? attr(sig, 'ID') ?? (sig.text.trim() || undefined)
    if (v !== undefined) return v.trim()
  }
  const history = firstChild(el, 'SignatureHistory')
  if (history !== undefined) {
    const entries = history.children.filter((c) => attr(c, 'SignatureID') !== undefined)
    const last = entries[entries.length - 1]
    if (last !== undefined) return attr(last, 'SignatureID')?.trim()
  }
  return undefined
}

function readParameter(ctx: Ctx, el: XmlElement, moduleName: string): ModuleParameter | undefined {
  const name = readName(ctx, el, 'Add-On Instruction parameter')
  if (name === undefined) return undefined
  if (SYSTEM_PARAMETERS.has(name.toUpperCase())) return undefined
  const rawUsage = readText(ctx, el, 'Usage')
  if (rawUsage !== 'Input' && rawUsage !== 'Output' && rawUsage !== 'InOut') {
    diag(
      ctx,
      'error',
      'L5X_INVALID_PARAMETER_USAGE',
      `Parameter ${q(name)} of Add-On Instruction ${q(moduleName)} has ${rawUsage === undefined ? 'no Usage attribute' : `Usage=${q(rawUsage)}`} ` +
        '(expected Input, Output or InOut), so its data flow is unknown.',
      el,
    )
    return undefined
  }
  const required = readBool(ctx, el, 'Required', false)
  let dataType = readText(ctx, el, 'DataType')
  if (dataType === undefined) {
    diag(ctx, 'warning', 'L5X_MISSING_DATA_TYPE', `Parameter ${q(name)} of Add-On Instruction ${q(moduleName)} has no DataType attribute.`, el)
    dataType = 'UNKNOWN'
  }
  const p: ModuleParameter = {
    name,
    dataType,
    usage: rawUsage,
    required,
    visible: readBool(ctx, el, 'Visible', required),
    externalAccess: readExternalAccess(ctx, el),
    source: sourceOf(el),
  }
  const description = readDoc(ctx, el, 'Description', 'description')
  if (description !== undefined) p.description = description
  const def = readValue(ctx, el, 'DefaultData')
  if (def !== undefined) p.defaultValue = def
  return p
}

function readModule(ctx: Ctx, el: XmlElement, routines: Routine[]): ModuleDefinition | undefined {
  const encodedElement = el.name === 'EncodedData'
  if (encodedElement) {
    const encodedType = attr(el, 'EncodedType')
    if (encodedType !== undefined && encodedType !== 'AddOnInstructionDefinition') {
      diag(
        ctx,
        'warning',
        'L5X_UNEXPECTED_ELEMENT',
        `<EncodedData EncodedType=${q(encodedType)}> found among Add-On Instruction definitions; it was treated as a protected Add-On Instruction.`,
        el,
      )
    }
  }
  const name = readName(ctx, el, 'Add-On Instruction')
  if (name === undefined) return undefined
  const isProtected = encodedElement || firstChild(el, 'EncodedData') !== undefined

  const parameters: ModuleParameter[] = []
  const memberScope = makeScope(ctx, `Add-On Instruction ${q(name)} (parameters and local tags share one namespace)`)
  for (const p of collect(ctx, el, 'Parameters', ['Parameter'])) {
    const param = readParameter(ctx, p, name)
    if (param === undefined) continue
    memberScope.add(param.name, p, 'parameter')
    parameters.push(param)
  }
  const localTags: Tag[] = []
  for (const lt of collect(ctx, el, 'LocalTags', ['LocalTag'])) {
    const tag = readTag(ctx, lt, { kind: 'module', module: name }, 'DefaultData', 'Add-On Instruction local tag', 'Local')
    if (tag === undefined) continue
    memberScope.add(tag.name, lt, 'local tag')
    localTags.push(tag)
  }
  const routineIds = readRoutines(ctx, el, { kind: 'module', name }, routines)

  const m: ModuleDefinition = {
    name,
    kind: 'AOI',
    parameters,
    localTags,
    routineIds,
    protected: isProtected,
    source: sourceOf(el),
  }
  const revision = readText(ctx, el, 'Revision')
  if (revision !== undefined) m.revision = revision
  const ext = readText(ctx, el, 'RevisionExtension')
  if (ext !== undefined) m.revisionExtension = ext
  const vendor = readText(ctx, el, 'Vendor')
  if (vendor !== undefined) m.vendor = vendor
  const description = readDoc(ctx, el, 'Description', 'description')
  if (description !== undefined) m.description = description
  const edited = readText(ctx, el, 'EditedDate')
  if (edited !== undefined) m.editedDate = edited
  const sig = readSignatureId(el)
  if (sig !== undefined) m.signatureId = clean(ctx, sig, el, 'signature')

  if (isProtected) {
    diag(
      ctx,
      'warning',
      'L5X_PROTECTED_CONTENT',
      `Add-On Instruction ${q(name)} is source-protected: its parameters are visible but its logic is encoded, so changes inside it cannot be analyzed.`,
      el,
    )
  } else if (routineIds.length === 0) {
    diag(ctx, 'warning', 'L5X_AOI_WITHOUT_LOGIC', `Add-On Instruction ${q(name)} has no routines in the export, so its behavior is unknown.`, el)
  }
  return m
}
