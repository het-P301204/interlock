/**
 * Golden tests: the engine's results on every synthetic scenario, checked
 * against hand-written expectations in fixtures/expected/*.json. Those
 * expectations were written from the logic, not generated from the engine,
 * so a disagreement means one of them is wrong and must be investigated.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeProjectsSync } from '../../packages/core/src/analysis/pipeline.ts'
import { analyzeDriftSync } from '../../packages/core/src/analysis/drift.ts'
import type { AnalysisResult, Finding, Severity } from '../../packages/core/src/model/analysis.ts'

const root = join(import.meta.dirname, '..', '..', 'fixtures')
const read = (p: string) => readFileSync(join(root, p))
const registry = JSON.parse(read('scenarios.json').toString('utf8')) as {
  scenarios: Array<{ id: string; title: string; kind: 'compare' | 'drift'; baseline?: string; current?: string; sites?: Array<{ label: string; file: string }>; manifest: string; expected: string }>
}
const RANK: Record<Severity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }
const file = (p: string) => ({ name: p.split('/').pop()!, bytes: new Uint8Array(read(p)) })

interface ExpectedFinding {
  type: string | string[]
  severity?: Severity
  minSeverity?: Severity
  safetyFunctionIds: string[]
  module?: string
  program?: string
  routine?: string
  inhibitLabels?: string[]
  suppressorLabels?: string[]
  causeLabels?: string[]
}

function text(f: Finding): string {
  return [f.title, f.summary, ...f.explanation, ...f.impact].join('\n')
}

function matches(f: Finding, e: ExpectedFinding): boolean {
  const types = Array.isArray(e.type) ? e.type : [e.type]
  if (!types.includes(f.type)) return false
  if (e.severity && f.severity !== e.severity) return false
  if (e.minSeverity && RANK[f.severity] < RANK[e.minSeverity]) return false
  if (e.module && (f.module ?? '').toLowerCase() !== e.module.toLowerCase()) return false
  if (e.program && f.location.program !== e.program) return false
  if (e.routine && f.location.routine !== e.routine) return false
  for (const l of [...(e.inhibitLabels ?? []), ...(e.suppressorLabels ?? []), ...(e.causeLabels ?? [])]) if (!text(f).includes(l)) return false
  return true
}

const results = new Map<string, AnalysisResult>()

for (const s of registry.scenarios.filter((x) => x.kind === 'compare')) {
  describe(`scenario ${s.id}: ${s.title}`, () => {
    const expected = JSON.parse(read(s.expected).toString('utf8'))
    const run = () => {
      let r = results.get(s.id)
      if (!r) {
        r = analyzeProjectsSync({ baseline: file(s.baseline!), current: file(s.current!), manifest: JSON.parse(read(s.manifest).toString('utf8')), analyzedAt: '2026-10-04T12:00:00.000Z' })
        results.set(s.id, r)
      }
      return r
    }

    it('reports every expected finding', () => {
      const r = run()
      for (const e of expected.findings.mustInclude as ExpectedFinding[]) {
        const candidates = r.findings.filter((f) => matches(f, e))
        const covered = new Set(candidates.flatMap((f) => f.safetyFunctionIds))
        const missing = e.safetyFunctionIds.filter((id) => !covered.has(id))
        expect(candidates.length, `no finding matches ${JSON.stringify(e)}; got ${r.findings.map((f) => `${f.type}/${f.severity}[${f.safetyFunctionIds}]`).join(', ')}`).toBeGreaterThan(0)
        expect(missing, `expected ${JSON.stringify(e)} to cover ${e.safetyFunctionIds}`).toEqual([])
      }
    })

    it('does not report forbidden finding types', () => {
      const types = new Set(run().findings.map((f) => f.type))
      for (const t of expected.findings.mustNotIncludeTypes ?? []) expect(types.has(t), `unexpected ${t}`).toBe(false)
    })

    it('respects severity ceilings', () => {
      const r = run()
      const review = r.findings.filter((f) => f.disposition === 'REVIEW' || f.disposition === 'UNDECLARED')
      if (expected.findings.maxSeverity) for (const f of review) expect(RANK[f.severity], `${f.id} ${f.type}`).toBeLessThanOrEqual(RANK[expected.findings.maxSeverity as Severity])
      if (expected.findings.maxSeverityOverall) for (const f of r.findings) expect(RANK[f.severity], `${f.id} ${f.type}`).toBeLessThanOrEqual(RANK[expected.findings.maxSeverityOverall as Severity])
    })

    it('assigns the expected status to every safety function', () => {
      const r = run()
      const got = Object.fromEntries(r.safetyFunctions.map((x) => [x.function.id, x.status]))
      expect(got).toEqual(expected.safetyStatus)
    })

    it('reports trust, priority, surface and blast radius as expected', () => {
      const r = run()
      if (expected.trust) expect(r.trust.status).toBe(expected.trust)
      if (expected.priority) expect(r.surface.priority).toBe(expected.priority)
      if (expected.surface?.undeclaredAffected !== undefined) expect(r.surface.undeclaredAffected).toBe(expected.surface.undeclaredAffected)
      if (expected.surface?.blastRadius !== undefined) expect(r.surface.blastRadius).toBe(expected.surface.blastRadius)
      for (const [mod, br] of Object.entries((expected.blastRadius ?? {}) as Record<string, { instances: number; safetyRelevant: number; operational: number; notExecuted?: number }>)) {
        const m = r.modules.find((x) => x.module === mod)!
        expect(m.totals.instances).toBe(br.instances)
        expect(m.totals.safetyRelevant).toBe(br.safetyRelevant)
        expect(m.totals.operational).toBe(br.operational)
        if (br.notExecuted !== undefined) expect(m.totals.notExecuted).toBe(br.notExecuted)
      }
      for (const [cat, range] of Object.entries((expected.changeCounts ?? {}) as Record<string, { min: number; max: number }>)) {
        const n = r.changes.filter((c) => c.category === cat).length
        expect(n, cat).toBeGreaterThanOrEqual(range.min)
        expect(n, cat).toBeLessThanOrEqual(range.max)
      }
    })

    it('is deterministic: same inputs, same result', () => {
      const r = run()
      const again = analyzeProjectsSync({ baseline: file(s.baseline!), current: file(s.current!), manifest: JSON.parse(read(s.manifest).toString('utf8')), analyzedAt: '2026-10-04T12:00:00.000Z' })
      expect(JSON.stringify(again)).toBe(JSON.stringify(r))
    })

    it('backs every finding with evidence', () => {
      for (const f of run().findings) {
        expect(f.evidence.length, f.id).toBeGreaterThan(0)
        for (const e of f.evidence) expect(e.findingId).toBe(f.id)
      }
    })
  })
}

for (const s of registry.scenarios.filter((x) => x.kind === 'drift')) {
  describe(`scenario ${s.id}: ${s.title}`, () => {
    it('matches the expected drift', () => {
      const expected = JSON.parse(read(s.expected).toString('utf8'))
      const r = analyzeDriftSync({
        sites: s.sites!.map((x) => ({ label: x.label, ...file(x.file) })),
        analyzedAt: '2026-10-04T12:00:00.000Z',
        manifest: JSON.parse(read(s.manifest).toString('utf8')),
      })
      for (const [name, e] of Object.entries(expected.drift as Record<string, { status?: string; reference?: string; flags?: string[]; variants?: Record<string, string>; missingAt?: string[] }>)) {
        const m = r.modules.find((x) => x.module === name)!
        expect(m, name).toBeDefined()
        if (e.status) expect(m.status).toBe(e.status)
        if (e.reference) expect(m.reference).toBe(e.reference)
        for (const flag of e.flags ?? []) expect(m.flags).toContain(flag)
        for (const [site, behavior] of Object.entries(e.variants ?? {})) expect(m.variants.find((v) => v.sites.includes(site))?.behavior, site).toBe(behavior)
        if (e.missingAt) expect([...m.missingAt].sort()).toEqual([...e.missingAt].sort())
      }
    })
  })
}
