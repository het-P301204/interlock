/**
 * Shared helpers for the adversarial engine probes. Every probe builds a
 * current-project variant of baseline-safe.L5X by exact string edits, runs the
 * full pipeline and inspects what INTERLOCK concluded.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeProjectsSync } from '../../packages/core/src/analysis/pipeline.ts'
import type { AnalysisResult, Finding, SafetyFunctionResult } from '../../packages/core/src/model/analysis.ts'
import type { SafetyManifest } from '../../packages/core/src/model/safety.ts'

const root = join(import.meta.dirname, '..', '..', 'fixtures')
export const BASE = readFileSync(join(root, 'l5x', 'baseline-safe.L5X'), 'utf8')
export const MANIFEST = JSON.parse(readFileSync(join(root, 'manifests', 'northgate.safety.json'), 'utf8')) as SafetyManifest

/** Replace exactly one occurrence; fail loudly when the anchor is missing (a probe that edits nothing proves nothing). */
export function edit(text: string, from: string, to: string): string {
  const i = text.indexOf(from)
  if (i < 0) throw new Error(`edit anchor not found: ${from.slice(0, 120)}`)
  return text.slice(0, i) + to + text.slice(i + from.length)
}

export function rungXml(n: number, text: string): string {
  return `<Rung Number="${n}" Type="N">\n<Text>\n<![CDATA[${text}]]>\n</Text>\n</Rung>\n`
}

/** Insert a rung right after the rung whose text is `afterText`. */
export function addRungAfter(text: string, afterText: string, newText: string, number: number): string {
  const anchor = `<![CDATA[${afterText}]]>\n</Text>\n</Rung>\n`
  return edit(text, anchor, anchor + rungXml(number, newText))
}


/** Replace a rung's text. */
export function setRung(text: string, oldText: string, newText: string): string {
  return edit(text, `<![CDATA[${oldText}]]>`, `<![CDATA[${newText}]]>`)
}

export function boolTag(name: string, access = 'Read/Write', description = 'probe tag'): string {
  return `<Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false" ExternalAccess="${access}">\n<Description>\n<![CDATA[${description}]]>\n</Description>\n<Data Format="L5K">\n<![CDATA[0]]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>\n</Data>\n</Tag>\n`
}

/** Add controller-scoped tags (inserted at the end of the controller <Tags>). */
export function addControllerTags(text: string, xml: string): string {
  return edit(text, '</Tags>\n<Programs>', `${xml}</Tags>\n<Programs>`)
}

/** Add a routine to a program (after its existing routines). */
export function addRoutine(text: string, program: string, routineXml: string): string {
  const start = text.indexOf(`<Program Name="${program}"`)
  if (start < 0) throw new Error(`program ${program} not found`)
  const end = text.indexOf('</Routines>', start)
  return text.slice(0, end) + routineXml + text.slice(end)
}

export function rllRoutine(name: string, rungs: string[]): string {
  return `<Routine Name="${name}" Type="RLL">\n<RLLContent>\n${rungs.map((r, i) => rungXml(i, r)).join('')}</RLLContent>\n</Routine>\n`
}

/** Append a JSR rung to a program's Main routine (after the given last rung text). */
export function addJsr(text: string, afterText: string, routine: string, number: number): string {
  return addRungAfter(text, afterText, `JSR(${routine},0);`, number)
}

const file = (name: string, text: string) => ({ name, bytes: new TextEncoder().encode(text) })

export function analyze(current: string, opts: { baseline?: string; manifest?: SafetyManifest } = {}): AnalysisResult {
  return analyzeProjectsSync({
    baseline: file('baseline.L5X', opts.baseline ?? BASE),
    current: file('current.L5X', current),
    manifest: opts.manifest ?? MANIFEST,
    analyzedAt: '2026-10-04T12:00:00.000Z',
  })
}

export function sf(r: AnalysisResult, id: string): SafetyFunctionResult {
  const x = r.safetyFunctions.find((s) => s.function.id === id)
  if (!x) throw new Error(`no safety function ${id}`)
  return x
}

/** Findings a reviewer must act on for a safety function. */
export function reviewFindings(r: AnalysisResult, id: string): Finding[] {
  return r.findings.filter((f) => f.safetyFunctionIds.includes(id) && f.disposition === 'REVIEW')
}

/** Statuses that tell a reviewer "nothing got weaker here". */
export const REASSURING = ['NO_CHANGE', 'CHANGED_EQUIVALENT', 'STRENGTHENED']

/** Compact summary for failure messages. */
export function summary(r: AnalysisResult): string {
  return JSON.stringify(
    {
      trust: r.trust.status,
      sf: r.safetyFunctions.map((s) => `${s.function.id}:${s.status}${s.notification ? `/${s.notification.status}` : ''}`),
      findings: r.findings.map((f) => `${f.type}:${f.severity}:${f.disposition}:[${f.safetyFunctionIds.join(',')}]`),
    },
    null,
    1,
  )
}
