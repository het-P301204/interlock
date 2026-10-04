/**
 * Scan-semantics tests on minimal projects: each case changes one thing and
 * checks how the declared function's firing condition and the finding type
 * respond. These pin down the assumptions documented in docs/architecture.md.
 */
import { describe, expect, it } from 'vitest'
import { analyzeProjectsSync } from '../../src/analysis/pipeline.ts'
import type { SafetyManifest } from '../../src/model/safety.ts'
import { bytes, miniL5x, type MiniProject } from './mini-l5x.ts'

const TAGS = ['A', 'B', 'C', 'Byp', 'Out', 'Mid', 'Alarm_Out', 'Lbl_X'].map((name) => ({ name }))

const manifest = (tripState: 'ENERGIZE' | 'DE_ENERGIZE' = 'ENERGIZE', alarm?: string): SafetyManifest => ({
  schema: 'interlock.safety/v1',
  functions: [
    {
      id: 'SF-1',
      name: 'Test Shutdown',
      kind: 'SHUTDOWN',
      criticality: 'CRITICAL',
      implementation: { program: 'P', routine: 'Main' },
      protectiveOutput: { tag: 'Out', tripState },
      ...(alarm ? { alarm: { tag: alarm } } : {}),
    },
  ],
})

function run(base: MiniProject, cur: MiniProject, m: SafetyManifest = manifest()) {
  return analyzeProjectsSync({ baseline: bytes(miniL5x(base), 'b.L5X'), current: bytes(miniL5x(cur), 'c.L5X'), manifest: m, analyzedAt: '2026-10-04T00:00:00Z' })
}
const project = (main: string[], extra: Partial<MiniProject> = {}): MiniProject => ({ tags: TAGS, ...extra, routines: { Main: main, ...(extra.routines ?? {}) } })
const verdict = (r: ReturnType<typeof run>) => r.safetyFunctions[0]!.protective!.verdict
const types = (r: ReturnType<typeof run>) => r.findings.map((f) => f.type)

describe('symbolic scan semantics', () => {
  const base = project(['XIC(A)XIC(B)OTE(Out);'])

  it('reordered contacts are equivalent and cosmetic', () => {
    const r = run(base, project(['XIC(B)XIC(A)OTE(Out);']))
    expect(verdict(r)).toBe('UNCHANGED')
    expect(types(r)).toEqual(['COSMETIC_LOGIC_CHANGE'])
    expect(r.trust.status).toBe('VERIFIED_SCOPE')
  })

  it('an AFI on an energize-to-trip rung means the function can never act', () => {
    const r = run(base, project(['AFI()XIC(A)XIC(B)OTE(Out);']))
    expect(verdict(r)).toBe('NEVER_FIRES')
    expect(types(r)).toContain('PROTECTIVE_OUTPUT_BYPASSED')
  })

  it('a TND before the protective rung stops it executing when its rung is true', () => {
    const r = run(base, project(['XIC(Byp)TND();', 'XIC(A)XIC(B)OTE(Out);']))
    // While the TND is active the output keeps its previous-scan value, so the change is weakening and (from a held 1) also "gaining".
    expect(['WEAKENED', 'MIXED']).toContain(verdict(r))
    expect(types(r)).toContain('EXECUTION_CONTROL_INTRODUCED')
    expect(r.findings.some((f) => f.type === 'NEW_INHIBIT' && f.summary.includes('Byp'))).toBe(true)
  })

  it('a forward JMP over the protective rung is an inhibit', () => {
    const r = run(base, project(['XIC(Byp)JMP(Lbl_X);', 'XIC(A)XIC(B)OTE(Out);', 'LBL(Lbl_X)NOP();']))
    expect(['WEAKENED', 'MIXED']).toContain(verdict(r))
    expect(types(r)).toContain('NEW_INHIBIT')
  })

  it('an MCR zone forces rung-in false while the zone is off', () => {
    const r = run(base, project(['XIC(C)MCR();', 'XIC(A)XIC(B)OTE(Out);', 'MCR();']))
    expect(verdict(r)).toBe('WEAKENED')
    expect(types(r)).toContain('NEW_INHIBIT')
  })

  it('a disabled program or inhibited task removes the protective path', () => {
    for (const extra of [{ programDisabled: true }, { taskInhibited: true }]) {
      const r = run(base, project(['XIC(A)XIC(B)OTE(Out);'], extra))
      expect(types(r)).toContain('PROTECTIVE_PATH_REMOVED')
      expect(r.safetyFunctions[0]!.status).toBe('IMPACTED')
    }
  })

  it('a second writer later in the scan wins and is a bypass', () => {
    const r = run(base, project(['XIC(A)XIC(B)OTE(Out);', 'JSR(Other,0);'], { routines: { Other: ['XIC(Byp)OTU(Out);'] } }))
    expect(types(r)).toContain('PROTECTIVE_OUTPUT_BYPASSED')
  })

  it('a MOV of 0 into the output is a bypass too', () => {
    const r = run(base, project(['XIC(A)XIC(B)OTE(Out);', 'XIC(Byp)MOV(0,Out);']))
    expect(types(r)).toContain('PROTECTIVE_OUTPUT_BYPASSED')
  })

  it('an extra trip cause is strengthening, never weakening', () => {
    const r = run(base, project(['[XIC(A)XIC(B) ,XIC(C) ]OTE(Out);']))
    expect(verdict(r)).toBe('STRENGTHENED')
    expect(types(r)).toEqual(['PROTECTION_STRENGTHENED'])
    expect(r.surface.priority).toBe('NONE')
  })

  it('intermediate bits are expanded: weakening through Mid is found', () => {
    const b = project(['XIC(A)OTE(Mid);', 'XIC(Mid)XIC(B)OTE(Out);'])
    const c = project(['XIC(A)XIO(Byp)OTE(Mid);', 'XIC(Mid)XIC(B)OTE(Out);'])
    const r = run(b, c)
    expect(types(r)).toContain('NEW_INHIBIT')
  })

  it('a seal-in circuit compares on its previous-scan value', () => {
    const b = project(['[XIC(A) ,XIC(Out) ]XIO(B)OTE(Out);'])
    const c = project(['[XIC(A) ,XIC(Out) ]XIO(B)XIO(Byp)OTE(Out);'])
    const r = run(b, c, manifest('ENERGIZE'))
    expect(verdict(r)).toBe('WEAKENED')
  })

  it('aliases resolve to their target, and retargeting an alias is detected', () => {
    const tags = [...TAGS, { name: 'In_Alias', alias: 'A' }]
    const b = { tags, routines: { Main: ['XIC(In_Alias)OTE(Out);'] } }
    const same = { tags, routines: { Main: ['XIC(A)OTE(Out);'] } }
    expect(verdict(run(b, same))).toBe('UNCHANGED')
    const moved = { tags: [...TAGS, { name: 'In_Alias', alias: 'C' }], routines: { Main: ['XIC(In_Alias)OTE(Out);'] } }
    expect(['MIXED', 'WEAKENED']).toContain(verdict(run(b, moved)))
  })

  it('tag names are case-insensitive', () => {
    expect(verdict(run(base, project(['XIC(a)XIC(b)OTE(out);'])))).toBe('UNCHANGED')
  })

  it('AOI outputs hold when EnableIn is false: a condition in front of the call weakens the trip', () => {
    const aoi = { name: 'AOI_T', params: [{ name: 'I', usage: 'Input' as const }, { name: 'Q', usage: 'Output' as const }], rungs: ['XIC(I)OTE(Q);'] }
    const tags = [...TAGS, { name: 'Inst', type: 'AOI_T' }]
    const b = { tags, aois: [aoi], routines: { Main: ['AOI_T(Inst,A,Out);'] } }
    const c = { tags, aois: [aoi], routines: { Main: ['XIO(Byp)AOI_T(Inst,A,Out);'] } }
    const r = run(b, c)
    expect(['WEAKENED', 'MIXED']).toContain(verdict(r))
  })

  it('a change inside an AOI definition reaches every call site', () => {
    const mk = (rung: string) => ({ name: 'AOI_T', params: [{ name: 'I', usage: 'Input' as const }, { name: 'Q', usage: 'Output' as const }], rungs: [rung] })
    const tags = [...TAGS, { name: 'Inst1', type: 'AOI_T' }, { name: 'Inst2', type: 'AOI_T' }, { name: 'Out2' }]
    const main = ['AOI_T(Inst1,A,Out);', 'AOI_T(Inst2,B,Out2);']
    const r = run({ tags, aois: [mk('XIC(I)OTE(Q);')], routines: { Main: main } }, { tags, aois: [mk('XIC(I)XIO(I)OTE(Q);')], routines: { Main: main } })
    const mod = r.modules.find((m) => m.module === 'AOI_T')!
    expect(mod.changed).toBe(true)
    expect(mod.totals).toMatchObject({ instances: 2, safetyRelevant: 1, operational: 1 })
    expect(types(r)).toContain('SHARED_MODULE_PROPAGATION')
    expect(types(r)).toContain('PROTECTIVE_OUTPUT_BYPASSED')
  })

  it('setpoints on the same tag are compared as numbers', () => {
    const tags = [...TAGS, { name: 'Level', type: 'REAL' }]
    const r = run({ tags, routines: { Main: ['GRT(Level,85.0)OTE(Out);'] } }, { tags, routines: { Main: ['GRT(Level,95.0)OTE(Out);'] } })
    expect(types(r)).toContain('SETPOINT_RELAXED')
    expect(r.findings[0]!.firing!.lost!.text).toBe('Level > 85.0 AND Level <= 95.0')
    const r2 = run({ tags, routines: { Main: ['GRT(Level,85.0)OTE(Out);'] } }, { tags, routines: { Main: ['LES(85.0,Level)OTE(Out);'] } })
    // LES(85.0, Level) is normalized to the same atom as GRT(Level, 85.0).
    expect(['UNCHANGED', 'EQUIVALENT']).toContain(verdict(r2))
  })

  it('ALMD ProgDisable operand suppresses the notification path', () => {
    const tags = [...TAGS, { name: 'Alm', type: 'ALARM_DIGITAL' }]
    const m = manifest('ENERGIZE', 'Alm')
    const b = { tags, routines: { Main: ['XIC(A)OTE(Out);', 'XIC(A)ALMD(Alm,0,0,0,0);'] } }
    const c = { tags, routines: { Main: ['XIC(A)OTE(Out);', 'XIC(A)ALMD(Alm,0,0,Byp,0);'] } }
    const r = run(b, c, m)
    expect(r.safetyFunctions[0]!.notification!.status).toBe('SUPPRESSED')
    expect(r.safetyFunctions[0]!.notification!.suppressors).toEqual(['Byp'])
    const removed = run(b, { tags, routines: { Main: ['XIC(A)OTE(Out);'] } }, m)
    expect(removed.safetyFunctions[0]!.notification!.status).toBe('BROKEN')
  })

  it('a renamed protective output is never reported as unchanged', () => {
    const tags = [...TAGS, { name: 'Out_New' }]
    const r = run(base, { tags, routines: { Main: ['XIC(A)XIC(B)OTE(Out_New);'] } })
    // "Out" still exists as a tag but nothing writes it: the path to it is gone.
    expect(r.safetyFunctions[0]!.status).toBe('IMPACTED')
    const gone = run(base, { tags: TAGS.filter((t) => t.name !== 'Out').concat({ name: 'Out_New' }), routines: { Main: ['XIC(A)XIC(B)OTE(Out_New);'] } })
    expect(gone.safetyFunctions[0]!.status).toBe('NOT_ANALYZED')
    expect(gone.trust.status).toBe('PARTIAL_COVERAGE')
    expect(gone.findings.map((f) => f.type)).toContain('DECLARATION_UNRESOLVED')
  })

  it('more inputs than the bound give NOT_DECIDED, never a guess', () => {
    const names = Array.from({ length: 22 }, (_, i) => `X${i}`)
    const tags = [...TAGS, ...names.map((name) => ({ name }))]
    const rung = `${names.map((n) => `XIC(${n})`).join('')}OTE(Out);`
    const rung2 = `[${names.map((n) => `XIC(${n})`).join(' ,')} ]OTE(Out);`
    const r = run({ tags, routines: { Main: [rung] } }, { tags, routines: { Main: [rung2] } })
    expect(verdict(r)).toBe('NOT_DECIDED')
    expect(r.safetyFunctions[0]!.status).toBe('NOT_ANALYZED')
    expect(r.trust.status).toBe('PARTIAL_COVERAGE')
  })
})
