/**
 * Adversarial probes INTERLOCK handles correctly today. Kept as regression
 * tests: each builds a hostile current-project variant of baseline-safe.L5X
 * and asserts what a correct analyzer must report.
 */
import { describe, expect, it } from 'vitest'
import {
  BASE, MANIFEST, REASSURING, addControllerTags, addJsr, addRoutine, addRungAfter, analyze, boolTag, edit, reviewFindings, setRung, sf, summary,
} from './helpers.ts'

const OVERFLOW_RUNG = 'XIC(LSHH_101)OTE(XV101_Close_Cmd);'
const PERMISSIVE_RUNG = 'XIC(MCC_Main_Enable)XIO(LSHH_101)GRT(Suction_Press_PV,12.0)OTE(Pump_Start_Permissive);'
const LIGHTING_LAST = 'XIC(Dusk_Sensor)OTE(Yard_Lights);'

function expectFlagged(r: ReturnType<typeof analyze>, id: string) {
  const s = sf(r, id)
  expect(REASSURING, `${id} reported ${s.status}\n${summary(r)}`).not.toContain(s.status)
  expect(reviewFindings(r, id).length, summary(r)).toBeGreaterThan(0)
}

describe('identity', () => {
  it('baseline against itself: every function NO_CHANGE, no findings, VERIFIED_SCOPE', () => {
    const r = analyze(BASE)
    expect(r.findings).toEqual([])
    expect(r.trust.status).toBe('VERIFIED_SCOPE')
    expect(r.safetyFunctions.every((s) => s.status === 'NO_CHANGE')).toBe(true)
  })
  it('tag-name case changes are not changes', () => {
    const r = analyze(setRung(BASE, OVERFLOW_RUNG, 'xic(lshh_101)ote(xv101_close_cmd);'))
    expect(r.findings).toEqual([])
    expect(sf(r, 'SF-05').status).toBe('NO_CHANGE')
  })
})

describe('second writers of a protective output', () => {
  it.each([
    ['MOV(1,...)', 'MOV(1,Pump_01_Run_Enable);'],
    ['COP', 'COP(Lamp_Test,Pump_01_Run_Enable,1);'],
    ['CPS', 'CPS(Lamp_Test,Pump_01_Run_Enable,1);'],
    ['unknown AOI', 'AOI_Mystery(Lamp_Test,Pump_01_Run_Enable);'],
  ])('%s after the protective logic → PROTECTIVE_OUTPUT_BYPASSED', (_n, rung) => {
    const r = analyze(addRungAfter(BASE, LIGHTING_LAST, rung, 2))
    expect(r.findings.some((f) => f.type === 'PROTECTIVE_OUTPUT_BYPASSED' && f.safetyFunctionIds.includes('SF-02')), summary(r)).toBe(true)
  })
  it('OTL/OTU pair on an ENERGIZE output → bypass', () => {
    expectFlagged(analyze(addRungAfter(BASE, LIGHTING_LAST, 'XIC(Lamp_Test)OTL(XV101_Close_Cmd)OTU(XV101_Close_Cmd);', 2)), 'SF-05')
  })
  it('write through an alias of the protective output → bypass', () => {
    const t = addRungAfter(edit(BASE, '</Tags>\n<Programs>', '<Tag Name="Run1" TagType="Alias" Radix="Decimal" AliasFor="Pump_01_Run_Enable" ExternalAccess="Read/Write"/>\n</Tags>\n<Programs>'), LIGHTING_LAST, 'OTL(Run1);', 2)
    expectFlagged(analyze(t), 'SF-02')
  })
  it('ST assignment to the protective output → bypass, and ST is not verified scope', () => {
    let t = addRoutine(BASE, 'Utilities', '<Routine Name="Calc" Type="ST">\n<STContent>\n<Line Number="0">\n<![CDATA[Pump_01_Run_Enable := 1;]]>\n</Line>\n</STContent>\n</Routine>\n')
    t = addJsr(t, 'JSR(HVAC,0);', 'Calc', 2)
    const r = analyze(t)
    expectFlagged(r, 'SF-02')
    expect(r.trust.status).not.toBe('VERIFIED_SCOPE')
  })
  it('an executing FBD routine is never VERIFIED_SCOPE', () => {
    let t = addRoutine(BASE, 'Utilities', '<Routine Name="Blk" Type="FBD">\n<FBDContent SheetSize="Letter" SheetOrientation="Landscape">\n<Sheet Number="1">\n<OVariable ID="2" X="200" Y="100" Operand="Pump_01_Run_Enable"/>\n</Sheet>\n</FBDContent>\n</Routine>\n')
    t = addJsr(t, 'JSR(HVAC,0);', 'Blk', 2)
    expect(analyze(t).trust.status).toBe('PARTIAL_COVERAGE')
  })
  it('writing the AOI backing member after the call has no effect on the output and is not reported as a weakening', () => {
    const r = analyze(addRungAfter(BASE, 'XIC(PUMP_01_IL.Shutdown_Alarm)OTE(Pump_01_Shutdown_Alarm);', 'OTU(PUMP_01_IL.Shutdown_Alarm);', 2))
    expect(['NO_CHANGE', 'CHANGED_EQUIVALENT']).toContain(sf(r, 'SF-02').status)
  })
})

describe('disabling execution', () => {
  it.each([
    ['program Disabled', (t: string) => edit(t, '<Program Name="Safety" TestEdits="false" MainRoutineName="Main" Disabled="false"', '<Program Name="Safety" TestEdits="false" MainRoutineName="Main" Disabled="true"')],
    ['task inhibited', (t: string) => edit(t, 'Type="CONTINUOUS" Priority="10" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false"', 'Type="CONTINUOUS" Priority="10" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="true"')],
    ['program unscheduled', (t: string) => edit(t, '<ScheduledProgram Name="Safety"/>\n', '')],
    ['main routine renamed', (t: string) => edit(t, '<Program Name="Safety" TestEdits="false" MainRoutineName="Main"', '<Program Name="Safety" TestEdits="false" MainRoutineName="Main2"')],
    ['AFI in the protective rung', (t: string) => setRung(t, OVERFLOW_RUNG, `AFI()${OVERFLOW_RUNG}`)],
    ['TND before the JSR', (t: string) => setRung(t, 'JSR(ESD,0);', 'JSR(ESD,0)TND();')],
    ['conditional JSR', (t: string) => addControllerTags(setRung(t, 'JSR(Overflow,0);', 'XIC(Ovf_Enable)JSR(Overflow,0);'), boolTag('Ovf_Enable'))],
    ['forward JMP over the JSR', (t: string) => setRung(setRung(t, 'JSR(Overflow,0);', 'XIC(Lamp_Test)JMP(Skip)JSR(Overflow,0);'), 'JSR(Permissives,0);', 'LBL(Skip)JSR(Permissives,0);')],
    ['ONS one-shot in the protective rung', (t: string) => addControllerTags(setRung(t, OVERFLOW_RUNG, 'XIC(LSHH_101)ONS(Ovf_Storage)OTE(XV101_Close_Cmd);'), boolTag('Ovf_Storage'))],
  ])('%s → SF-05 flagged', (_n, mutate) => {
    expectFlagged(analyze(mutate(BASE)), 'SF-05')
  })
  it('MCR zone around the protective rung → SF-05 flagged', () => {
    let t = setRung(BASE, OVERFLOW_RUNG, 'XIC(Mcr_En)MCR();')
    t = addRungAfter(t, 'XIC(Mcr_En)MCR();', OVERFLOW_RUNG, 1)
    t = addRungAfter(t, OVERFLOW_RUNG, 'MCR();', 2)
    expectFlagged(analyze(addControllerTags(t, boolTag('Mcr_En'))), 'SF-05')
  })
})

describe('alias and scope tricks', () => {
  it('alias retarget of LSHH_101 → SF-05 flagged', () => {
    expectFlagged(analyze(edit(BASE, 'AliasFor="Local:3:I.Data.4"', 'AliasFor="Local:3:I.Data.5"')), 'SF-05')
  })
  it('program-scoped tag shadowing a trip INPUT → SF-05 flagged', () => {
    expectFlagged(analyze(BASE.replace(/(<Program Name="Safety"[\s\S]*?)<Tags\/>/, `$1<Tags>\n${boolTag('LSHH_101', 'Read Only')}</Tags>`)), 'SF-05')
  })
  it('protective output renamed → DECLARATION_UNRESOLVED and NOT_ANALYZED, never NO_CHANGE', () => {
    const r = analyze(BASE.replaceAll('XV101_Close_Cmd', 'XV101_Close_Command'))
    expect(sf(r, 'SF-05').status).toBe('NOT_ANALYZED')
    expect(r.findings.some((f) => f.type === 'DECLARATION_UNRESOLVED' && f.safetyFunctionIds.includes('SF-05'))).toBe(true)
    expect(r.trust.status).toBe('PARTIAL_COVERAGE')
  })
  it('a manifest referencing a program-scoped tag resolves and detects its weakening', () => {
    const m = JSON.parse(JSON.stringify(MANIFEST)) as typeof MANIFEST
    m.functions.push({ id: 'SF-09', name: 'Lamp test permissive', kind: 'PERMISSIVE', criticality: 'HIGH', implementation: { program: 'Utilities', routine: 'Lighting' }, protectiveOutput: { tag: 'Lamp_Test', tripState: 'ENERGIZE' } } as (typeof m.functions)[number])
    const b = setRung(BASE, 'XIC(Maintenance_Mode)OTE(Panel_Light_Maint);', 'XIC(Maintenance_Mode)OTE(Panel_Light_Maint)OTE(Lamp_Test);')
    const c = setRung(BASE, 'XIC(Maintenance_Mode)OTE(Panel_Light_Maint);', 'XIC(Maintenance_Mode)OTE(Panel_Light_Maint)XIO(Dusk_Sensor)OTE(Lamp_Test);')
    const r = analyze(c, { baseline: b, manifest: m })
    expect(sf(r, 'SF-09').resolution.protectiveOutput).toBe('RESOLVED')
    expectFlagged(r, 'SF-09')
  })
})

describe('comparisons and setpoints', () => {
  it('GRT → GEQ at the same constant → SETPOINT_RELAXED', () => {
    const r = analyze(setRung(BASE, PERMISSIVE_RUNG, PERMISSIVE_RUNG.replace('GRT(', 'GEQ(')))
    expect(r.findings.some((f) => f.type === 'SETPOINT_RELAXED' && f.safetyFunctionIds.includes('SF-08'))).toBe(true)
  })
  it('swapped operands with the flipped relation is proved equivalent', () => {
    const r = analyze(setRung(BASE, PERMISSIVE_RUNG, PERMISSIVE_RUNG.replace('GRT(Suction_Press_PV,12.0)', 'LES(12.0,Suction_Press_PV)')))
    expect(sf(r, 'SF-08').status).toBe('CHANGED_EQUIVALENT')
    expect(r.findings.every((f) => f.disposition !== 'REVIEW')).toBe(true)
  })
  it('literal replaced by a tag → flagged', () => {
    expectFlagged(analyze(setRung(BASE, PERMISSIVE_RUNG, PERMISSIVE_RUNG.replace('12.0)', 'LT101_PV)'))), 'SF-08')
  })
  it('GRT replaced by a LIM range → flagged', () => {
    expectFlagged(analyze(setRung(BASE, PERMISSIVE_RUNG, PERMISSIVE_RUNG.replace('GRT(Suction_Press_PV,12.0)', 'LIM(5.0,Suction_Press_PV,1000.0)'))), 'SF-08')
  })
})

describe('alarm tricks', () => {
  it('ALMD ProgDisable operand set to 1 → ALARM_SUPPRESSED', () => {
    const r = analyze(setRung(BASE, 'XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,0,0);', 'XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,1,0);'))
    expect(r.findings.some((f) => f.type === 'ALARM_SUPPRESSED' && f.safetyFunctionIds.includes('SF-07'))).toBe(true)
  })
  it('ALMD rung removed → notification BROKEN', () => {
    const r = analyze(setRung(BASE, 'XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,0,0);', 'NOP();'))
    expect(sf(r, 'SF-07').notification?.status).toBe('BROKEN')
  })
})

describe('bounded analysis', () => {
  it('31 inputs on a protective-only function → NOT_ANALYZED with PARTIAL_COVERAGE, never a verdict', () => {
    const n = Array.from({ length: 30 }, (_, i) => `Wide_${i}`)
    const r = analyze(addControllerTags(setRung(BASE, OVERFLOW_RUNG, `XIC(LSHH_101)${n.map((x) => `XIO(${x})`).join('')}OTE(XV101_Close_Cmd);`), n.map((x) => boolTag(x)).join('')))
    expect(sf(r, 'SF-05').status).toBe('NOT_ANALYZED')
    expect(r.trust.status).toBe('PARTIAL_COVERAGE')
  })
  it('unbalanced parenthesis / bracket in the protective rung → flagged and PARTIAL_COVERAGE', () => {
    for (const bad of ['XIC(LSHH_101)OTE(XV101_Close_Cmd;', '[XIC(LSHH_101) ,XIC(Lamp_Test) OTE(XV101_Close_Cmd);']) {
      const r = analyze(setRung(BASE, OVERFLOW_RUNG, bad))
      expectFlagged(r, 'SF-05')
      expect(r.trust.status).toBe('PARTIAL_COVERAGE')
    }
  })
  it('an AOI whose logic calls itself does not hang and the change is flagged', () => {
    const r = analyze(addRungAfter(BASE, 'XIC(Trip)OTE(Shutdown_Alarm);', 'AOI_PumpInterlock(Trip,Run_Request,Level_HH,Press_Trip,Motor_Temp_Hi,ESD_Active,Run_Enable);', 3))
    expect(reviewFindings(r, 'SF-02').length).toBeGreaterThan(0)
  })
})

