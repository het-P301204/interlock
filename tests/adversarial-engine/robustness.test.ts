/**
 * Hostile-input robustness, determinism, evidence integrity and report
 * injection. Tests named "regression (found by adversarial review)" were confirmed defects, now fixed.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeProjectsSync } from '../../packages/core/src/analysis/pipeline.ts'
import type { AnalysisResult } from '../../packages/core/src/model/analysis.ts'
import { toCsv, toMarkdown } from '../../packages/core/src/report/export.ts'
import { toPdf } from '../../packages/core/src/report/pdf.ts'
import { BASE, addControllerTags, addRoutine, addJsr, addRungAfter, analyze, boolTag, edit, setRung, summary } from './helpers.ts'

const LIGHTING_LAST = 'XIC(Dusk_Sensor)OTE(Yard_Lights);'
const OVERFLOW_RUNG = 'XIC(LSHH_101)OTE(XV101_Close_Cmd);'

describe('hostile rung shapes', () => {
  it.each([5000, 20000])('regression (found by adversarial review): %i nested branch levels in one non-safety rung must not abort the whole analysis (stack overflow)', (depth) => {
    const t = setRung(BASE, LIGHTING_LAST, `${'['.repeat(depth)}XIC(Dusk_Sensor)${']'.repeat(depth)}OTE(Yard_Lights);`)
    let r: AnalysisResult | null = null
    let err: unknown = null
    try {
      r = analyze(t)
    } catch (e) {
      err = e
    }
    expect(err === null ? null : String((err as Error).message), 'analysis aborted').toBeNull()
    expect(r!.safetyFunctions.length).toBe(8)
  })

  it('5000 identical contacts in series analyze quickly and are proved cosmetic', () => {
    const t0 = performance.now()
    const r = analyze(setRung(BASE, LIGHTING_LAST, `${'XIC(Dusk_Sensor)'.repeat(5000)}OTE(Yard_Lights);`))
    expect(performance.now() - t0).toBeLessThan(10_000)
    expect(r.trust.status).toBe('VERIFIED_SCOPE')
  })

  it('3000 distinct inhibit contacts on a protective rung → NOT_ANALYZED, PARTIAL_COVERAGE, under 10 s', () => {
    const n = Array.from({ length: 3000 }, (_, i) => `BypS${i}`)
    const t0 = performance.now()
    const r = analyze(setRung(BASE, OVERFLOW_RUNG, `XIC(LSHH_101)${n.map((x) => `XIO(${x})`).join('')}OTE(XV101_Close_Cmd);`))
    expect(performance.now() - t0).toBeLessThan(10_000)
    expect(r.safetyFunctions.find((s) => s.function.id === 'SF-05')!.status).toBe('NOT_ANALYZED')
    expect(r.trust.status).toBe('PARTIAL_COVERAGE')
  })

  it('20 000 extra rungs and 50 000 extra tags analyze in under 10 s each', () => {
    const anchor = `<![CDATA[${LIGHTING_LAST}]]>\n</Text>\n</Rung>\n`
    const extra = Array.from({ length: 20000 }, (_, i) => `<Rung Number="${i + 2}" Type="N">\n<Text>\n<![CDATA[XIC(Bulk_${i % 50})OTE(Yard_Lights);]]>\n</Text>\n</Rung>\n`).join('')
    let t0 = performance.now()
    analyze(edit(BASE, anchor, anchor + extra))
    expect(performance.now() - t0).toBeLessThan(10_000)
    t0 = performance.now()
    analyze(addControllerTags(BASE, Array.from({ length: 50000 }, (_, i) => boolTag(`Bulk_${i}`)).join('')))
    expect(performance.now() - t0).toBeLessThan(10_000)
  }, 60_000)

  it('regression (found by adversarial review): a 20-input weakening (inside the exhaustive bound) takes more than 10 s to analyze', () => {
    const n = Array.from({ length: 19 }, (_, i) => `Inh_${i}`)
    const t = addControllerTags(setRung(BASE, OVERFLOW_RUNG, `XIC(LSHH_101)${n.map((x) => `XIO(${x})`).join('')}OTE(XV101_Close_Cmd);`), n.map((x) => boolTag(x)).join(''))
    const t0 = performance.now()
    const r = analyze(t)
    const ms = performance.now() - t0
    expect(r.safetyFunctions.find((s) => s.function.id === 'SF-05')!.status).toBe('IMPACTED')
    expect(ms, `took ${ms.toFixed(0)} ms`).toBeLessThan(10_000)
  }, 120_000)

  it('recursive JSR (self and mutual) terminates', () => {
    const self = analyze(addRungAfter(BASE, 'XIO(MCC_Main_Enable)OTE(ESD_Active);', 'JSR(ESD,0);', 2))
    expect(self.coverage.unsupported.some((u) => /Recursive call/.test(u.detail))).toBe(true)
    const mutual = analyze(addRungAfter(addRungAfter(BASE, 'XIO(MCC_Main_Enable)OTE(ESD_Active);', 'JSR(Overflow,0);', 2), OVERFLOW_RUNG, 'JSR(ESD,0);', 1))
    expect(mutual.safetyFunctions.length).toBe(8)
  })

  it('prototype-named tags, routines and operands do not crash or leak', () => {
    let t = addControllerTags(BASE, ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].map((n) => boolTag(n)).join(''))
    t = addRungAfter(t, LIGHTING_LAST, 'XIC(__proto__)XIC(toString)OTE(constructor)OTE(hasOwnProperty);', 2)
    t = addRoutine(t, 'Utilities', '<Routine Name="__proto__" Type="RLL">\n<RLLContent>\n<Rung Number="0" Type="N">\n<Text>\n<![CDATA[XIC(Lamp_Test)OTE(constructor);]]>\n</Text>\n</Rung>\n</RLLContent>\n</Routine>\n')
    t = addJsr(t, 'JSR(HVAC,0);', '__proto__', 2)
    const r = analyze(t)
    expect(JSON.stringify(r)).not.toMatch(/\[object Object\]|native code/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('determinism and evidence', () => {
  const variants: Array<[string, string]> = [
    ['bypass', addRungAfter(BASE, LIGHTING_LAST, 'XIC(Lamp_Test)OTL(Pump_01_Run_Enable);', 2)],
    ['inhibit', addControllerTags(setRung(BASE, OVERFLOW_RUNG, 'XIC(LSHH_101)XIO(Ovf_Inh)OTE(XV101_Close_Cmd);'), boolTag('Ovf_Inh'))],
    ['alarm', setRung(BASE, 'XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,0,0);', 'XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,Lamp_Test,0);')],
  ]

  it.each(variants)('%s: analyzing twice gives byte-identical JSON', (_n, t) => {
    expect(JSON.stringify(analyze(t))).toBe(JSON.stringify(analyze(t)))
  })

  it.each(variants)('%s: every REVIEW finding cites a source location that exists in the file it names', (_n, t) => {
    const r = analyze(t)
    const lines = { current: t.split('\n'), baseline: BASE.split('\n') }
    for (const f of r.findings.filter((x) => x.disposition === 'REVIEW')) {
      const located = f.evidence.filter((e) => e.xmlPath && e.line)
      expect(located.length, `${f.id} ${f.type} has no evidence with xmlPath/line`).toBeGreaterThan(0)
      for (const e of located) {
        const side = e.side === 'baseline' ? 'baseline' : 'current'
        const line = lines[side][e.line! - 1] ?? ''
        const last = /\/([A-Za-z]+)(?:\[@(\w+)='([^']*)'\])?$/.exec(e.xmlPath!)!
        expect(line, `${e.id} line ${e.line} for ${e.xmlPath}`).toContain(`<${last[1]}`)
        if (last[2]) expect(line).toContain(`${last[2]}="${last[3]}"`)
      }
    }
  })

  it('golden scenarios: every REVIEW finding cites at least one located evidence item', () => {
    const root = join(import.meta.dirname, '..', '..', 'fixtures')
    const reg = JSON.parse(readFileSync(join(root, 'scenarios.json'), 'utf8')) as { scenarios: Array<{ kind: string; baseline?: string; current?: string; manifest: string }> }
    const missing: string[] = []
    for (const s of reg.scenarios.filter((x) => x.kind === 'compare')) {
      const f = (p: string) => ({ name: p, bytes: new Uint8Array(readFileSync(join(root, p))) })
      const r = analyzeProjectsSync({ baseline: f(s.baseline!), current: f(s.current!), manifest: JSON.parse(readFileSync(join(root, s.manifest), 'utf8')), analyzedAt: '2026-10-04T12:00:00.000Z' })
      for (const x of r.findings.filter((y) => y.disposition === 'REVIEW' && y.type !== 'DECLARATION_UNRESOLVED'))
        if (!x.evidence.some((e) => e.xmlPath && e.line)) missing.push(`${s.current}: ${x.id} ${x.type}`)
    }
    expect(missing).toEqual([])
  }, 60_000)
})

describe('report injection', () => {
  const RLO = String.fromCodePoint(0x202e)
  const CR = String.fromCodePoint(13)

  it('bidi override in a tag name never reaches JSON, Markdown, CSV or PDF', () => {
    const name = `Ok_${RLO}Bypass`
    const r = analyze(addRungAfter(addControllerTags(BASE, boolTag(name)), LIGHTING_LAST, `XIC(${name})OTL(Pump_01_Run_Enable);`, 2))
    const cp = (n: number) => String.fromCodePoint(n)
    const bidi = new RegExp(`[${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`)
    expect(bidi.test(JSON.stringify(r))).toBe(false)
    expect(bidi.test(toMarkdown(r))).toBe(false)
    expect(bidi.test(toCsv(r))).toBe(false)
    expect(Buffer.from(toPdf(r)).includes(Buffer.from(RLO, 'utf8'))).toBe(false)
  })

  it('a rung that starts with a spreadsheet formula is neutralised in the CSV', () => {
    const r = analyze(addRungAfter(BASE, LIGHTING_LAST, '=HYPERLINK("http://example.invalid")OTL(Pump_01_Run_Enable);', 2))
    for (const cell of toCsv(r).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) expect(cell.replace(/^"/, '')).not.toMatch(/^[=+@]/)
  })

  it('regression (found by adversarial review): a lone carriage return (&#13;) in rung text forges Markdown structure (setext heading / ordered list) in the report', () => {
    let t = addRungAfter(BASE, LIGHTING_LAST, 'OTL(Pump_01_Run_Enable)', 2)
    t = edit(t, '<![CDATA[OTL(Pump_01_Run_Enable)]]>', 'OTL(Pump_01_Run_Enable)&#13;===&#13;&#13;1. FORGED: approved by MOC-0000&#13;')
    const md = toMarkdown(analyze(t))
    expect(md.includes('FORGED')).toBe(true)
    // CommonMark treats a CR not followed by LF as a line ending: no user text may carry one into the report.
    expect(md.includes(`${CR}===`), JSON.stringify(md.slice(md.indexOf('FORGED') - 60, md.indexOf('FORGED') + 10))).toBe(false)
    expect(/\r(?!\n)/.test(md)).toBe(false)
  })
})

void summary
