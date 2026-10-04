/**
 * Declarations editor model: a flat, string-only form for one safety
 * function, conversion to and from the engine's SafetyFunction, local field
 * checks, mapping of the engine's validateManifest issues back onto form
 * fields, name suggestions from the current analysis, and JSON export.
 *
 * The engine (validateManifest, in the worker) stays the authority on what is
 * valid; local checks only make the form answer faster.
 */
import type { AnalysisResult, Criticality, SafetyFunction, SafetyFunctionKind, SafetyManifest, TripState } from '@interlock/core/types'

export interface FunctionForm {
  id: string
  name: string
  description: string
  kind: SafetyFunctionKind
  criticality: Criticality
  program: string
  routine: string
  module: string
  instance: string
  outputTag: string
  tripState: TripState
  alarmTag: string
  notification: string
  enableCondition: string
  notes: string
}

export type FormField = keyof FunctionForm

export const KIND_OPTIONS: Array<{ value: SafetyFunctionKind; label: string; hint: string }> = [
  { value: 'SHUTDOWN', label: 'Shutdown', hint: 'Stops equipment when a hazardous condition occurs' },
  { value: 'TRIP', label: 'Trip', hint: 'Stops equipment on a process trip condition' },
  { value: 'INTERLOCK', label: 'Interlock', hint: 'Prevents equipment acting while another condition holds' },
  { value: 'PERMISSIVE', label: 'Permissive', hint: 'Must be satisfied before equipment may start or run' },
  { value: 'ALARM', label: 'Alarm', hint: 'Notifies an operator; no protective output of its own' },
]

export const CRITICALITY_OPTIONS: Criticality[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export function emptyForm(existingIds: string[]): FunctionForm {
  let n = existingIds.length + 1
  const taken = new Set(existingIds.map((s) => s.toLowerCase()))
  let id = `SF-${String(n).padStart(2, '0')}`
  while (taken.has(id.toLowerCase())) id = `SF-${String(++n).padStart(2, '0')}`
  return {
    id,
    name: '',
    description: '',
    kind: 'SHUTDOWN',
    criticality: 'HIGH',
    program: '',
    routine: '',
    module: '',
    instance: '',
    outputTag: '',
    tripState: 'DE_ENERGIZE',
    alarmTag: '',
    notification: '',
    enableCondition: '',
    notes: '',
  }
}

export function toForm(f: SafetyFunction): FunctionForm {
  return {
    id: f.id,
    name: f.name,
    description: f.description ?? '',
    kind: f.kind,
    criticality: f.criticality,
    program: f.implementation.program ?? '',
    routine: f.implementation.routine ?? '',
    module: f.implementation.module ?? '',
    instance: f.implementation.instance ?? '',
    outputTag: f.protectiveOutput?.tag ?? '',
    tripState: f.protectiveOutput?.tripState ?? 'DE_ENERGIZE',
    alarmTag: f.alarm?.tag ?? '',
    notification: f.alarm?.notification ?? '',
    enableCondition: f.enableCondition ?? '',
    notes: f.notes ?? '',
  }
}

const opt = (s: string) => {
  const t = s.trim()
  return t === '' ? undefined : t
}

/** Form → SafetyFunction, omitting every empty optional field (the schema is strict). */
export function fromForm(form: FunctionForm): SafetyFunction {
  const implementation: SafetyFunction['implementation'] = {}
  if (opt(form.program)) implementation.program = opt(form.program)
  if (opt(form.routine)) implementation.routine = opt(form.routine)
  if (opt(form.module)) implementation.module = opt(form.module)
  if (opt(form.instance)) implementation.instance = opt(form.instance)
  const f: SafetyFunction = { id: form.id.trim(), name: form.name.trim(), kind: form.kind, criticality: form.criticality, implementation }
  if (opt(form.description)) f.description = opt(form.description)
  if (opt(form.outputTag)) f.protectiveOutput = { tag: form.outputTag.trim(), tripState: form.tripState }
  if (opt(form.alarmTag)) {
    f.alarm = { tag: form.alarmTag.trim() }
    if (opt(form.notification)) f.alarm.notification = opt(form.notification)
  }
  if (opt(form.enableCondition)) f.enableCondition = opt(form.enableCondition)
  if (opt(form.notes)) f.notes = opt(form.notes)
  return f
}

/** Immediate checks while typing. The engine re-checks everything. */
export function localErrors(form: FunctionForm, otherIds: string[]): Partial<Record<FormField, string>> {
  const e: Partial<Record<FormField, string>> = {}
  const id = form.id.trim()
  if (!id) e.id = 'An id is required, e.g. SF-09.'
  else if (!/^[A-Za-z0-9_-]+$/.test(id)) e.id = 'Use letters, digits, "-" and "_" only.'
  else if (id.length > 32) e.id = 'At most 32 characters.'
  else if (otherIds.some((o) => o.toLowerCase() === id.toLowerCase())) e.id = `${id} is already declared.`
  if (!form.name.trim()) e.name = 'Name the function as engineers know it, e.g. "Pump P-104 High-Level Shutdown".'
  const tagRe = /^[\\A-Za-z_][A-Za-z0-9_.:[\]\\]*$/
  for (const k of ['program', 'routine', 'module', 'instance', 'outputTag', 'alarmTag'] as const) {
    const v = form[k].trim()
    if (v && !tagRe.test(v)) e[k] = 'Must be a tag or routine name as it appears in the project (no spaces).'
  }
  if (!form.outputTag.trim() && !form.alarmTag.trim()) e.outputTag = 'Declare a protective output, an alarm, or both.'
  if (form.kind === 'ALARM' && !form.alarmTag.trim()) e.alarmTag = 'An ALARM function needs an alarm tag.'
  return e
}

const ISSUE_FIELD: Array<[RegExp, FormField]> = [
  [/^\.id\b/, 'id'],
  [/^\.name\b/, 'name'],
  [/^\.description\b/, 'description'],
  [/^\.kind\b/, 'kind'],
  [/^\.criticality\b/, 'criticality'],
  [/^\.implementation\.program\b/, 'program'],
  [/^\.implementation\.routine\b/, 'routine'],
  [/^\.implementation\.module\b/, 'module'],
  [/^\.implementation\.instance\b/, 'instance'],
  [/^\.protectiveOutput/, 'outputTag'],
  [/^\.alarm\.notification\b/, 'notification'],
  [/^\.alarm/, 'alarmTag'],
  [/^\.enableCondition\b/, 'enableCondition'],
  [/^\.notes\b/, 'notes'],
]

/** Engine issues for function `index`, split into per-field messages and the rest. */
export function issuesForFunction(issues: string[], index: number): { fields: Partial<Record<FormField, string>>; other: string[] } {
  const prefix = `functions.${index}`
  const fields: Partial<Record<FormField, string>> = {}
  const other: string[] = []
  for (const issue of issues) {
    if (!issue.startsWith(prefix) || /^\d/.test(issue.slice(prefix.length))) continue
    const rest = issue.slice(prefix.length)
    const colon = rest.indexOf(':')
    const path = colon >= 0 ? rest.slice(0, colon) : rest
    const msg = colon >= 0 ? rest.slice(colon + 1).trim() : rest
    const hit = ISSUE_FIELD.find(([re]) => re.test(path))
    if (hit && !fields[hit[1]]) fields[hit[1]] = msg
    else other.push(msg)
  }
  return { fields, other }
}

/* ------------------------------------------------------------ suggestions */

export interface Suggestions {
  programs: string[]
  routines: Array<{ name: string; program?: string }>
  modules: string[]
  instances: Array<{ name: string; module?: string }>
  outputs: string[]
  tags: string[]
}

const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b))

/** Names that exist in the analyzed project, from the reuse graph's node labels. */
export function suggestionsFrom(result: AnalysisResult | null): Suggestions {
  if (!result) return { programs: [], routines: [], modules: [], instances: [], outputs: [], tags: [] }
  const nodes = result.graph.nodes
  const routines = new Map<string, { name: string; program?: string }>()
  for (const n of nodes) if (n.type === 'routine' && !n.id.startsWith('routine:module:')) routines.set(`${n.meta.container ?? ''}/${n.label}`, { name: n.label, program: n.meta.container })
  const instances = new Map<string, { name: string; module?: string }>()
  for (const n of nodes) if (n.type === 'instance') instances.set(n.label, { name: n.label, module: n.meta.module })
  return {
    programs: uniq(nodes.filter((n) => n.type === 'program').map((n) => n.label)),
    routines: [...routines.values()].sort((a, b) => a.name.localeCompare(b.name)),
    modules: uniq(nodes.filter((n) => n.type === 'module').map((n) => n.label)),
    instances: [...instances.values()].sort((a, b) => a.name.localeCompare(b.name)),
    outputs: uniq(nodes.filter((n) => n.type === 'protective-output' || n.type === 'alarm').map((n) => n.label)),
    tags: uniq(nodes.filter((n) => n.type === 'tag' || n.type === 'protective-output' || n.type === 'alarm').map((n) => n.label)),
  }
}

/** Name checks against the analyzed project. Warnings only: the engine reports unresolved declarations itself. */
export function projectWarnings(form: FunctionForm, s: Suggestions, hasProject: boolean): Partial<Record<FormField, string>> {
  if (!hasProject) return {}
  const w: Partial<Record<FormField, string>> = {}
  const has = (list: string[], v: string) => list.some((x) => x.toLowerCase() === v.toLowerCase())
  const miss = 'Not found in the analyzed project. The engine will report this declaration as UNRESOLVED.'
  if (form.program.trim() && !has(s.programs, form.program.trim())) w.program = miss
  if (form.routine.trim() && !s.routines.some((r) => r.name.toLowerCase() === form.routine.trim().toLowerCase())) w.routine = miss
  if (form.module.trim() && !has(s.modules, form.module.trim())) w.module = miss
  if (form.instance.trim() && !s.instances.some((r) => r.name.toLowerCase() === form.instance.trim().toLowerCase())) w.instance = miss
  return w
}

/* ---------------------------------------------------------------- export */

export function manifestJson(m: SafetyManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`
}

export function downloadManifest(m: SafetyManifest, fileName = 'safety-declarations.json'): void {
  const blob = new Blob([manifestJson(m)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** JSON with object keys sorted, so two manifests that differ only in key order compare equal. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b))) : val,
  )
}

export function sameManifest(a: SafetyManifest, b: SafetyManifest): boolean {
  return canonical(a) === canonical(b)
}

export function sameFunction(a: SafetyFunction, b: SafetyFunction): boolean {
  return canonical(a) === canonical(b)
}
