/**
 * INTERLOCK command line.
 *
 *   node apps/cli/src/main.ts inspect <file>
 *   node apps/cli/src/main.ts analyze <baseline> <current> --manifest <file> [--format ...] [--out <file>] [--fail-on <level>]
 *   node apps/cli/src/main.ts drift <label=file>... [--manifest <file>]
 *   node apps/cli/src/main.ts scenarios | scenario <id>
 *
 * Exit codes: 0 ok, 1 input / parse / usage error, 2 a REVIEW or UNDECLARED
 * finding at or above the --fail-on threshold exists.
 *
 * Runs the same deterministic engine as the web app and the API, in process.
 * Reads only the files named on the command line; writes only --out.
 */
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AnalysisInputError, ENGINE_VERSION, SEVERITY_ORDER, analyzeDriftSync, analyzeProjectsSync, inspectProjectSync, parseManifestText, toCsv, toJson, toMarkdown, toPdf,
} from '@interlock/core'
import type { AnalysisResult, DriftReport, FileInput, Finding, InspectResult, SafetyManifest, Severity } from '@interlock/core'
import { toSarif } from './sarif.ts'
import { colorEnabled, jsonSafe, pad, style, term, termDocument, truncate } from './terminal.ts'
import type { Style } from './terminal.ts'

export const CLI_VERSION = '0.1.0'
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FORMATS = ['text', 'json', 'md', 'csv', 'pdf', 'sarif'] as const
type Format = (typeof FORMATS)[number]
const FAIL_ON = ['critical', 'high', 'medium', 'low', 'none'] as const
type FailOn = (typeof FAIL_ON)[number]

/** Thrown for anything that should exit 1 with a one-line message. */
class CliError extends Error {
  readonly detail: string[]
  constructor(message: string, detail: string[] = []) {
    super(message)
    this.detail = detail
  }
}

interface Options {
  positional: string[]
  manifest?: string
  format: Format
  out?: string
  failOn: FailOn
  noColor: boolean
  help: boolean
  version: boolean
}

const HELP = `INTERLOCK ${CLI_VERSION} — PLC project changes as safety-impact evidence

Usage
  interlock inspect <file>                          parse one export and summarise it
  interlock analyze <baseline> <current> --manifest <safety.json>
                    [--format text|json|md|csv|pdf|sarif] [--out <file>]
                    [--fail-on critical|high|medium|low|none]
  interlock drift <label=file> <label=file>... [--manifest <safety.json>] [--format text|json]
  interlock scenarios                               list the built-in synthetic scenarios
  interlock scenario <id> [--format ...] [--fail-on ...]   run one (e.g. scenario 04)

Options
  -m, --manifest <file>   safety declarations (interlock.safety/v1 JSON)
  -f, --format <fmt>      output format (default text)
  -o, --out <file>        write the output to a file instead of stdout
      --fail-on <level>   exit 2 when a REVIEW or UNDECLARED finding at or above
                          this severity exists (default high; none disables)
      --no-color          plain output (NO_COLOR is honoured too)
  -h, --help              this help
  -V, --version           print the version

Exit codes
  0  no gating findings      1  input, parse or usage error      2  gating findings present

INTERLOCK reads exported project files only. It never connects to a controller.`

export function parseArgs(argv: string[]): Options {
  const o: Options = { positional: [], format: 'text', failOn: 'high', noColor: false, help: false, version: false }
  const value = (i: number, name: string): string => {
    const v = argv[i]
    if (v === undefined || (v.startsWith('-') && v !== '-')) throw new CliError(`${name} needs a value.`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]!
    let inline: string | undefined
    const eq = a.startsWith('--') ? a.indexOf('=') : -1
    if (eq > 0) {
      inline = a.slice(eq + 1)
      a = a.slice(0, eq)
    }
    const take = (name: string) => (inline !== undefined ? inline : value(++i, name))
    switch (a) {
      case '-h':
      case '--help':
        o.help = true
        break
      case '-V':
      case '--version':
        o.version = true
        break
      case '--no-color':
        o.noColor = true
        break
      case '-m':
      case '--manifest':
        o.manifest = take('--manifest')
        break
      case '-o':
      case '--out':
        o.out = take('--out')
        break
      case '-f':
      case '--format': {
        const f = take('--format').toLowerCase()
        if (!(FORMATS as readonly string[]).includes(f)) throw new CliError(`Unknown format "${term(f)}". Use one of: ${FORMATS.join(', ')}.`)
        o.format = f as Format
        break
      }
      case '--fail-on': {
        const f = take('--fail-on').toLowerCase()
        if (!(FAIL_ON as readonly string[]).includes(f)) throw new CliError(`Unknown --fail-on level "${term(f)}". Use one of: ${FAIL_ON.join(', ')}.`)
        o.failOn = f as FailOn
        break
      }
      default:
        if (a.startsWith('-') && a !== '-') throw new CliError(`Unknown option ${term(a)}. See --help.`)
        o.positional.push(a)
    }
  }
  return o
}

function maxInputBytes(): number {
  const mb = Number(process.env['INTERLOCK_MAX_UPLOAD_MB'] ?? 64)
  return (Number.isFinite(mb) && mb > 0 ? mb : 64) * 1024 * 1024
}

function readInput(path: string): FileInput {
  let size: number
  try {
    const st = statSync(path)
    if (!st.isFile()) throw new CliError(`${term(path)} is not a file.`)
    size = st.size
  } catch (e) {
    if (e instanceof CliError) throw e
    throw new CliError(`Cannot read ${term(path)}: ${(e as NodeJS.ErrnoException).code ?? 'error'}.`)
  }
  if (size > maxInputBytes()) throw new CliError(`${term(path)} is larger than ${maxInputBytes() / 1024 / 1024} MB (INTERLOCK_MAX_UPLOAD_MB).`)
  return { name: basename(path), bytes: new Uint8Array(readFileSync(path)) }
}

function readManifest(path: string | undefined, required: boolean): SafetyManifest | undefined {
  if (!path) {
    if (required) throw new CliError('analyze needs --manifest <safety.json>: INTERLOCK only reasons relative to declared safety functions.')
    return undefined
  }
  let text: string
  try {
    if (statSync(path).size > 2 * 1024 * 1024) throw new CliError(`${term(path)} is larger than 2 MB.`)
    text = readFileSync(path, 'utf8')
  } catch (e) {
    if (e instanceof CliError) throw e
    throw new CliError(`Cannot read ${term(path)}: ${(e as NodeJS.ErrnoException).code ?? 'error'}.`)
  }
  const v = parseManifestText(text)
  if (!v.ok) throw new CliError(`The safety manifest ${term(path)} is not valid.`, v.issues.map(term))
  return v.manifest
}

function rank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s)
}

/** Findings that gate the build: REVIEW or UNDECLARED, severity at or above the threshold. */
export function gatingFindings(r: AnalysisResult, failOn: FailOn): Finding[] {
  if (failOn === 'none') return []
  const limit = rank(failOn.toUpperCase() as Severity)
  return r.findings.filter((f) => (f.disposition === 'REVIEW' || f.disposition === 'UNDECLARED') && rank(f.severity) <= limit)
}

/* ------------------------------------------------------------------ output */

interface Io {
  out(text: string): void
  err(text: string): void
  writeBinary(bytes: Uint8Array): void
  s: Style
  errStyle: Style
}

function sevColor(s: Style, sev: string): (x: string) => string {
  return sev === 'CRITICAL' ? (x) => s.bold(s.red(x)) : sev === 'HIGH' ? s.red : sev === 'MEDIUM' ? s.yellow : sev === 'LOW' ? s.cyan : s.dim
}

function kb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

function inspectText(r: InspectResult, s: Style): string {
  const lines: string[] = []
  const f = r.file
  lines.push(`${s.bold('File')}       ${term(f.name)}  ${s.dim(`${kb(f.sizeBytes)}  sha256 ${f.sha256.slice(0, 16)}…`)}`)
  if (!r.ok) {
    const e = r.error
    const where = [e.location ? term(e.location) : '', e.line ? `line ${e.line}${e.column ? `, column ${e.column}` : ''}` : ''].filter(Boolean).join(', ')
    lines.push(`${s.bold('Result')}     ${s.red(`REJECTED ${term(e.code)}`)}${where ? s.dim(`  (${where})`) : ''}`)
    lines.push(`           ${term(e.message)}`)
    return lines.join('\n')
  }
  const m = r.summary.metadata
  const c = r.summary.counts
  lines.push(`${s.bold('Format')}     ${term(m.formatLabel)}  ${s.dim(`parser ${term(r.summary.parser.adapter)} ${term(r.summary.parser.version)}`)}`)
  lines.push(`${s.bold('Controller')} ${term(m.controllerName)}${m.processorType ? `  ${term(m.processorType)}` : ''}${m.firmwareRevision ? `  firmware ${term(m.firmwareRevision)}` : ''}`)
  if (m.softwareRevision || m.exportDate) lines.push(`${s.bold('Exported')}   ${[m.softwareRevision ? `software ${term(m.softwareRevision)}` : '', m.exportDate ? term(m.exportDate) : ''].filter(Boolean).join('  ')}`)
  lines.push(`${s.bold('Target')}     ${term(m.targetType)}${m.containsContext ? ' (partial export with context)' : ''}`)
  lines.push(`${s.bold('Contents')}   ${c.tasks} tasks, ${c.programs} programs, ${c.routines} routines, ${c.rungs} rungs, ${c.modules} modules (${c.instances} call sites), ${c.tags} tags`)
  const ready = r.summary.readiness
  lines.push(`${s.bold('Readiness')}  ${ready === 'READY' ? s.green(ready) : ready === 'BLOCKED' ? s.red(ready) : s.yellow(ready)}`)
  if (r.summary.diagnostics.length) {
    lines.push('', s.bold(`Diagnostics (${r.summary.diagnostics.length})`))
    for (const d of r.summary.diagnostics.slice(0, 50)) {
      const sev = d.severity === 'error' ? s.red : d.severity === 'warning' ? s.yellow : s.dim
      lines.push(`  ${sev(pad(d.severity.toUpperCase(), 8))} ${pad(term(d.code), 30)} ${term(d.message)}${d.location ? s.dim(`  ${term(d.location)}`) : ''}`)
    }
    if (r.summary.diagnostics.length > 50) lines.push(s.dim(`  … ${r.summary.diagnostics.length - 50} more (use --format json)`))
  }
  return lines.join('\n')
}

function analysisText(r: AnalysisResult, s: Style, failOn: FailOn): string {
  const lines: string[] = []
  const side = (label: string, x: AnalysisResult['baseline']) =>
    `${s.bold(pad(label, 10))} ${term(x.file.name)}  ${s.dim(`${term(x.metadata.controllerName)}  ${kb(x.file.sizeBytes)}  sha256 ${x.file.sha256.slice(0, 12)}…`)}`
  lines.push(s.dim(`INTERLOCK ${CLI_VERSION} · engine ${r.engineVersion} · analysis ${r.id.slice(0, 16)}`))
  lines.push(side('Baseline', r.baseline), side('Current', r.current))
  const trustColor = r.trust.status === 'VERIFIED_SCOPE' ? s.green : r.trust.status === 'PARTIAL_COVERAGE' ? s.yellow : s.red
  lines.push(`${s.bold(pad('Trust', 10))} ${trustColor(r.trust.status)}  ${term(r.trust.headline)}`)
  const pri = r.surface.priority
  lines.push(`${s.bold(pad('Priority', 10))} ${pri === 'NONE' ? s.green(pri) : sevColor(s, pri)(pri)}   coverage ${r.coverage.percent}%`)
  const cats = Object.entries(r.surface.byCategory)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ')
  lines.push(`${s.bold(pad('Changes', 10))} ${r.surface.totalChanges}${cats ? s.dim(`  (${cats})`) : ''}`)
  lines.push('')
  lines.push(s.bold(`Findings (${r.findings.length})`))
  if (!r.findings.length) lines.push(s.dim('  none'))
  const width = Math.max(40, (process.stdout.columns ?? 120) - 64)
  for (const f of r.findings) {
    const n = f.safetyFunctionIds.length
    const sfs = n ? truncate(term(f.safetyFunctionIds[0]), 8) + (n > 1 ? ` +${n - 1}` : '') : '-'
    lines.push(`  ${pad(f.id, 8)} ${sevColor(s, f.severity)(pad(f.severity, 8))} ${pad(f.disposition, 13)} ${pad(term(f.type), 30)} ${pad(sfs, 11)} ${truncate(term(f.title), width)}`)
  }
  lines.push('')
  lines.push(s.bold(`Safety functions (${r.safetyFunctions.length})`))
  for (const sf of r.safetyFunctions) {
    const st = sf.status
    const col = st === 'IMPACTED' ? s.red : st === 'STRENGTHENED' ? s.green : st === 'NOT_ANALYZED' ? s.yellow : s.dim
    lines.push(`  ${pad(term(sf.function.id), 8)} ${col(pad(st, 18))} ${truncate(term(sf.function.name), 70)}`)
  }
  if (r.undeclared.length) {
    lines.push('', s.bold(`Undeclared logic changed (${r.undeclared.length})`))
    for (const u of r.undeclared) lines.push(`  ${term(u.program ? `${u.program}/${u.routine}` : u.routine)}${u.hint ? s.dim(`  ${term(u.hint)}`) : ''}`)
  }
  lines.push('', gateLine(r, s, failOn))
  return lines.join('\n')
}

function gateLine(r: AnalysisResult, s: Style, failOn: FailOn): string {
  if (failOn === 'none') return s.dim('Gate: disabled (--fail-on none)')
  const g = gatingFindings(r, failOn)
  return g.length
    ? s.bold(s.red(`Gate: FAIL — ${g.length} finding${g.length === 1 ? '' : 's'} needing review at or above ${failOn.toUpperCase()} (exit 2)`))
    : s.green(`Gate: pass — no finding needing review at or above ${failOn.toUpperCase()}`)
}

function driftText(d: DriftReport, s: Style): string {
  const lines: string[] = []
  lines.push(s.dim(`INTERLOCK ${CLI_VERSION} · engine ${d.engineVersion} · module drift across ${d.sites.length} sites`))
  for (const site of d.sites) lines.push(`  ${pad(term(site.label), 16)} ${term(site.file.name)}  ${s.dim(`${term(site.controller)}  sha256 ${site.file.sha256.slice(0, 12)}…`)}`)
  lines.push('')
  for (const m of d.modules) {
    lines.push(`${s.bold(term(m.module))}  ${m.status === 'DRIFT' ? s.red('DRIFT') : s.green('CONSISTENT')}${m.flags.length ? `  ${s.yellow(m.flags.map(term).join(', '))}` : ''}`)
    for (const v of m.variants) {
      const b = v.behavior
      const col = b === 'WEAKER' ? s.red : b === 'REFERENCE' || b === 'EQUIVALENT' ? s.green : s.yellow
      lines.push(`  ${pad(v.hash.slice(0, 10), 11)} rev ${pad(term(v.revision ?? '?'), 6)} ${col(pad(b, 12))} ${v.sites.map(term).join(', ')}`)
    }
    if (m.missingAt.length) lines.push(s.dim(`  missing at: ${m.missingAt.map(term).join(', ')}`))
    for (const n of m.notes) lines.push(s.dim(`  ${term(n)}`))
  }
  if (!d.modules.length) lines.push(s.dim('No reusable modules found.'))
  return lines.join('\n')
}

/* ---------------------------------------------------------------- commands */

function emitAnalysis(r: AnalysisResult, o: Options, io: Io, currentPath: string): number {
  const toFile = o.out !== undefined
  const plain = style(false)
  switch (o.format) {
    case 'text':
      if (toFile) writeOut(o.out!, analysisText(r, plain, o.failOn) + '\n')
      else io.out(analysisText(r, io.s, o.failOn))
      break
    case 'json':
      output(o, io, jsonSafe(toJson(r)))
      break
    case 'md':
      output(o, io, toFile ? toMarkdown(r) : termDocument(toMarkdown(r)))
      break
    case 'csv':
      output(o, io, toFile ? toCsv(r) : termDocument(toCsv(r)))
      break
    case 'sarif':
      output(o, io, jsonSafe(JSON.stringify(toSarif(r, { currentUri: sarifUri(currentPath), toolVersion: CLI_VERSION }), null, 2)))
      break
    case 'pdf':
      if (toFile) writeOut(o.out!, toPdf(r))
      else if (process.stdout.isTTY) throw new CliError('Refusing to write a PDF to the terminal. Use --out <file> or redirect stdout.')
      else io.writeBinary(toPdf(r))
      break
  }
  // Keep machine-readable stdout clean: the gate verdict goes to stderr.
  if (o.format !== 'text' || toFile) io.err(gateLine(r, io.errStyle, o.failOn))
  if (toFile) io.err(io.errStyle.dim(`Wrote ${term(o.out!)}`))
  return gatingFindings(r, o.failOn).length ? 2 : 0
}

function output(o: Options, io: Io, text: string): void {
  if (o.out !== undefined) writeOut(o.out, text.endsWith('\n') ? text : text + '\n')
  else io.out(text.replace(/\n$/, ''))
}

function writeOut(path: string, data: string | Uint8Array): void {
  try {
    writeFileSync(path, data)
  } catch (e) {
    throw new CliError(`Cannot write ${term(path)}: ${(e as NodeJS.ErrnoException).code ?? 'error'}.`)
  }
}

/** Repository-relative forward-slash URI when the file is under the working directory, else a file: URI. */
export function sarifUri(path: string): string {
  const abs = resolve(path)
  const rel = relative(process.cwd(), abs)
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(/[\\/]/).map(encodeURIComponent).join('/')
  return new URL(`file:///${abs.replace(/\\/g, '/').replace(/^\//, '')}`).href
}

function analyze(baselinePath: string, currentPath: string, manifest: SafetyManifest, o: Options, io: Io): number {
  const baseline = readInput(baselinePath)
  const current = readInput(currentPath)
  let r: AnalysisResult
  try {
    r = analyzeProjectsSync({ baseline, current, manifest, analyzedAt: new Date().toISOString() })
  } catch (e) {
    if (e instanceof AnalysisInputError) {
      const file = e.side === 'baseline' ? baseline.name : e.side === 'current' ? current.name : 'manifest'
      const where = [e.location ? term(e.location) : '', e.line ? `line ${e.line}${e.column ? `, column ${e.column}` : ''}` : ''].filter(Boolean).join(', ')
      throw new CliError(`${e.side} ${term(file)} rejected: ${term(e.code)}${where ? ` (${where})` : ''}: ${term(e.message)}`, e.issues.map(term))
    }
    throw e
  }
  return emitAnalysis(r, o, io, currentPath)
}

function inspect(path: string, o: Options, io: Io): number {
  const r = inspectProjectSync(readInput(path), 'current')
  if (o.format === 'json') output(o, io, jsonSafe(JSON.stringify(r.ok ? { ok: true, file: r.file, summary: r.summary } : { ok: false, file: r.file, error: r.error }, null, 2)))
  else if (o.format === 'text') {
    if (o.out !== undefined) writeOut(o.out, inspectText(r, style(false)) + '\n')
    else io.out(inspectText(r, io.s))
  } else throw new CliError('inspect supports --format text or json.')
  return r.ok ? 0 : 1
}

function drift(specs: string[], o: Options, io: Io): number {
  if (specs.length < 2) throw new CliError('drift needs at least two sites: interlock drift A=site-a.L5X B=site-b.L5X')
  const labels = new Set<string>()
  const sites = specs.map((spec) => {
    const eq = spec.indexOf('=')
    const label = eq > 0 ? spec.slice(0, eq) : basename(spec).replace(/\.[^.]*$/, '')
    const path = eq > 0 ? spec.slice(eq + 1) : spec
    if (!label || label.length > 64) throw new CliError(`Invalid site label in "${term(spec)}".`)
    if (labels.has(label.toLowerCase())) throw new CliError(`Site label "${term(label)}" is used twice.`)
    labels.add(label.toLowerCase())
    return { label, ...readInput(path) }
  })
  const manifest = readManifest(o.manifest, false)
  let d: DriftReport
  try {
    d = analyzeDriftSync(manifest ? { sites, analyzedAt: new Date().toISOString(), manifest } : { sites, analyzedAt: new Date().toISOString() })
  } catch (e) {
    if (e instanceof AnalysisInputError) throw new CliError(`${term(e.side)} rejected: ${term(e.code)}: ${term(e.message)}`, e.issues.map(term))
    throw e
  }
  if (o.format === 'json') output(o, io, jsonSafe(JSON.stringify(d, null, 2)))
  else if (o.format === 'text') {
    if (o.out !== undefined) writeOut(o.out, driftText(d, style(false)) + '\n')
    else io.out(driftText(d, io.s))
  } else throw new CliError('drift supports --format text or json.')
  return 0
}

interface ScenarioEntry {
  id: string
  slug: string
  title: string
  summary: string
  kind: 'compare' | 'drift'
  baseline?: string
  current?: string
  manifest: string
  sites?: { label: string; file: string }[]
}

function loadScenarios(): ScenarioEntry[] {
  try {
    return (JSON.parse(readFileSync(resolve(REPO_ROOT, 'fixtures', 'scenarios.json'), 'utf8')) as { scenarios: ScenarioEntry[] }).scenarios
  } catch {
    throw new CliError('The built-in scenarios (fixtures/scenarios.json) are not available in this installation.')
  }
}

function scenarios(o: Options, io: Io): number {
  const list = loadScenarios()
  if (o.format === 'json') {
    output(o, io, JSON.stringify(list.map(({ id, slug, title, summary, kind }) => ({ id, slug, title, summary, kind })), null, 2))
    return 0
  }
  io.out(io.s.bold('Built-in synthetic scenarios (Northgate Pump Station)'))
  for (const sc of list) io.out(`  ${io.s.bold(sc.id)}  ${pad(sc.kind, 8)} ${sc.title}`)
  io.out(io.s.dim('\nRun one with: interlock scenario <id>   (e.g. interlock scenario 04 --format sarif)'))
  return 0
}

function scenario(id: string | undefined, o: Options, io: Io): number {
  if (!id) return scenarios(o, io)
  const list = loadScenarios()
  const sc = list.find((x) => x.id === id || x.id === id.padStart(2, '0') || x.slug === id)
  if (!sc) throw new CliError(`No scenario "${term(id)}". Known: ${list.map((x) => x.id).join(', ')}.`)
  const fx = (p: string) => resolve(REPO_ROOT, 'fixtures', p)
  const manifest = readManifest(fx(sc.manifest), true)!
  if (sc.kind === 'drift') return drift((sc.sites ?? []).map((s) => `${s.label}=${fx(s.file)}`), { ...o, manifest: fx(sc.manifest) }, io)
  if (!o.out && o.format === 'text') io.out(io.s.dim(`Scenario ${sc.id} — ${sc.title}\n`))
  return analyze(fx(sc.baseline!), fx(sc.current!), manifest, o, io)
}

export function run(argv: string[], io: Io): number {
  const o = parseArgs(argv)
  if (o.version) {
    io.out(`interlock ${CLI_VERSION} (engine ${ENGINE_VERSION})`)
    return 0
  }
  const [cmd, ...rest] = o.positional
  if (o.help || !cmd || cmd === 'help') {
    io.out(HELP)
    return cmd || o.help ? 0 : 1
  }
  switch (cmd) {
    case 'inspect':
      if (rest.length !== 1) throw new CliError('Usage: interlock inspect <file>')
      return inspect(rest[0]!, o, io)
    case 'analyze': {
      if (rest.length !== 2) throw new CliError('Usage: interlock analyze <baseline> <current> --manifest <safety.json>')
      const manifest = readManifest(o.manifest, true)!
      return analyze(rest[0]!, rest[1]!, manifest, o, io)
    }
    case 'drift':
      return drift(rest, o, io)
    case 'scenarios':
      return rest.length ? scenario(rest[0], o, io) : scenarios(o, io)
    case 'scenario':
      return scenario(rest[0], o, io)
    default:
      throw new CliError(`Unknown command "${term(cmd)}". See --help.`)
  }
}

function main(): void {
  const noColorFlag = process.argv.includes('--no-color')
  const s = style(colorEnabled(process.stdout, process.env, noColorFlag))
  const errStyle = style(colorEnabled(process.stderr, process.env, noColorFlag))
  const io: Io = {
    out: (t) => process.stdout.write(t + '\n'),
    err: (t) => process.stderr.write(t + '\n'),
    writeBinary: (b) => process.stdout.write(b),
    s,
    errStyle,
  }
  let code: number
  try {
    code = run(process.argv.slice(2), io)
  } catch (e) {
    if (e instanceof CliError) {
      io.err(`${errStyle.red('error:')} ${e.message}`)
      for (const d of e.detail.slice(0, 20)) io.err(`  - ${d}`)
      code = 1
    } else {
      io.err(`${errStyle.red('internal error:')} ${term(e instanceof Error ? e.message : String(e))}`)
      code = 1
    }
  }
  process.exitCode = code
}


// Run only as the entry point (also through a symlinked npm bin), not when imported.
const entry = process.argv[1]
if (entry && realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url))) main()
