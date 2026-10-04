/**
 * Adversarial probes: changes that weaken a declared safety function (or
 * silence its alarm) and what a correct analyzer must report for them.
 *
 * Tests named "regression (found by adversarial review)" each reproduce a
 * false negative (or a trust status that claimed more than the analysis saw)
 * that an independent review found in the first engine build. All are fixed;
 * the tests keep them fixed.
 */
import { describe, expect, it } from 'vitest'
import {
  BASE, REASSURING, addControllerTags, addJsr, addRoutine, addRungAfter, analyze, boolTag, edit, reviewFindings, rllRoutine, setRung, sf, summary,
} from './helpers.ts'

const ESD_RUNG = 'XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)XIO(Fire_Detected)OTE(MCC_Main_Enable);'
const OVERFLOW_RUNG = 'XIC(LSHH_101)OTE(XV101_Close_Cmd);'
const LIGHTING_LAST = 'XIC(Dusk_Sensor)OTE(Yard_Lights);'
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`)

/** A weakened function must be flagged: not a reassuring status, and at least one finding a reviewer must act on. */
function expectFlagged(r: ReturnType<typeof analyze>, id: string) {
  const s = sf(r, id)
  expect(REASSURING, `${id} reported ${s.status}\n${summary(r)}`).not.toContain(s.status)
  expect(reviewFindings(r, id).length, `no REVIEW finding for ${id}\n${summary(r)}`).toBeGreaterThan(0)
}

describe('writes that persist into the next scan', () => {
  it('regression (found by adversarial review): a later rung that unlatches a trip input (OTU(Fire_Detected) in declared non-safety logic) is reported as CHANGED_EQUIVALENT', () => {
    // ESD reads Fire_Detected at the top of the scan; Utilities now forces it to 0 at the
    // end of every scan, so the value ESD reads is always 0 and the fire trip can never act.
    const r = analyze(addRungAfter(BASE, LIGHTING_LAST, 'OTU(Fire_Detected);', 2))
    expectFlagged(r, 'SF-01')
  })

  it('regression (found by adversarial review): MOV of a constant into a compared analog input before the permissive is reported as CHANGED_EQUIVALENT', () => {
    // GRT(Suction_Press_PV,12.0) now always reads 100.0 in this scan: the low-suction block is gone.
    const r = analyze(setRung(BASE, 'JSR(Overflow,0);', 'MOV(100.0,Suction_Press_PV)JSR(Overflow,0);'))
    expectFlagged(r, 'SF-08')
  })

  it('regression (found by adversarial review): MOV into a compared analog input from declared non-safety logic is reported as NO_CHANGE with only an INFO finding', () => {
    const r = analyze(addRungAfter(BASE, LIGHTING_LAST, 'MOV(100.0,Suction_Press_PV);', 2))
    expectFlagged(r, 'SF-08')
  })
})

describe('scope shadowing', () => {
  it('regression (found by adversarial review): a program-scoped tag that shadows the protective output (AOI output arg) yields NO_CHANGE and zero findings', () => {
    // PumpControl gains a program tag Pump_01_Run_Enable: the AOI now writes the program tag and the
    // controller tag that drives the MCC starter is written by nothing.
    const r = analyze(BASE.replace(/(<Program Name="PumpControl"[\s\S]*?)<Tags\/>/, `$1<Tags>\n${boolTag('Pump_01_Run_Enable', 'Read Only')}</Tags>`))
    expectFlagged(r, 'SF-02')
  })

  it('regression (found by adversarial review): a program-scoped tag that shadows the protective output (direct OTE) yields NO_CHANGE and VERIFIED_SCOPE', () => {
    const r = analyze(BASE.replace(/(<Program Name="Safety"[\s\S]*?)<Tags\/>/, `$1<Tags>\n${boolTag('XV101_Close_Cmd', 'Read Only')}</Tags>`))
    expectFlagged(r, 'SF-05')
    expect(r.trust.status).not.toBe('VERIFIED_SCOPE')
  })
})

describe('the exhaustive bound must never become a pass', () => {
  it('regression (found by adversarial review): a 22-contact OTL bypass of a CRITICAL protective output with an alarm is CHANGED_EQUIVALENT, zero findings, VERIFIED_SCOPE', () => {
    const names = many('Byp_', 22)
    let t = addControllerTags(BASE, names.map((n) => boolTag(n)).join(''))
    t = addRungAfter(t, 'XIC(PUMP_01_IL.Shutdown_Alarm)OTE(Pump_01_Shutdown_Alarm);', `[${names.map((n) => `XIC(${n})`).join(' ,')} ]OTL(Pump_01_Run_Enable);`, 2)
    const r = analyze(t)
    // 28 inputs exceed the 2^20 bound, so the comparison is NOT_DECIDED. That must surface as
    // NOT_ANALYZED / partial coverage, never as an equivalent change in verified scope.
    expect(sf(r, 'SF-02').status, summary(r)).not.toBe('CHANGED_EQUIVALENT')
    expect(sf(r, 'SF-02').status).not.toBe('NO_CHANGE')
    expect(r.trust.status).not.toBe('VERIFIED_SCOPE')
    expect(r.findings.some((f) => f.safetyFunctionIds.includes('SF-02') && f.disposition === 'REVIEW')).toBe(true)
  })

  it('regression (found by adversarial review): an undecidable (23-input) alarm suppression is CHANGED_EQUIVALENT with VERIFIED_SCOPE because the protective path was decided', () => {
    const n = many('Hush_', 22)
    const r = analyze(addControllerTags(setRung(BASE, 'XIO(MCC_Main_Enable)OTE(ESD_Trip_Horn);', `XIO(MCC_Main_Enable)${n.map((x) => `XIO(${x})`).join('')}OTE(ESD_Trip_Horn);`), n.map((x) => boolTag(x)).join('')))
    expect(sf(r, 'SF-01').notification?.status).toBe('NOT_ANALYZED')
    expect(r.trust.status, summary(r)).not.toBe('VERIFIED_SCOPE')
    expect(['NO_CHANGE', 'CHANGED_EQUIVALENT']).not.toContain(sf(r, 'SF-01').status)
  })
})

describe('instructions that disable execution at runtime', () => {
  it('regression (found by adversarial review): SSV(Program,Safety,DisableFlag,...) in declared non-safety logic is an INFO change in VERIFIED_SCOPE', () => {
    const r = analyze(addRungAfter(BASE, LIGHTING_LAST, 'SSV(Program,Safety,DisableFlag,Lamp_Test);', 2))
    expect(r.trust.status, summary(r)).not.toBe('VERIFIED_SCOPE')
    expect(r.findings.some((f) => f.disposition === 'REVIEW' && f.safetyFunctionIds.some((id) => ['SF-01', 'SF-05', 'SF-08'].includes(id)))).toBe(true)
  })

  it('regression (found by adversarial review): SSV(Task,MainTask,InhibitTask,...) in declared non-safety logic is an INFO change in VERIFIED_SCOPE', () => {
    const r = analyze(addRungAfter(BASE, LIGHTING_LAST, 'SSV(Task,MainTask,InhibitTask,Lamp_Test);', 2))
    expect(r.trust.status, summary(r)).not.toBe('VERIFIED_SCOPE')
    expect(r.findings.some((f) => f.disposition === 'REVIEW')).toBe(true)
  })

  it('regression (found by adversarial review): a conditional RET() ahead of the protective rung (it never runs while the condition is true) is NO_CHANGE for SF-05', () => {
    let t = setRung(BASE, OVERFLOW_RUNG, 'XIC(Ovf_Skip)RET();')
    t = addRungAfter(t, 'XIC(Ovf_Skip)RET();', OVERFLOW_RUNG, 1)
    const r = analyze(addControllerTags(t, boolTag('Ovf_Skip')))
    expectFlagged(r, 'SF-05')
  })

  it('regression (found by adversarial review): JSR/SBR parameter passing that overwrites a trip input (SBR(Fire_Detected)) is CHANGED_EQUIVALENT with a "proved equivalent" cosmetic finding', () => {
    let t = setRung(BASE, 'JSR(ESD,0);', 'JSR(ESD,1,Lamp_Test);')
    t = setRung(t, ESD_RUNG, 'SBR(Fire_Detected);')
    t = addRungAfter(t, 'SBR(Fire_Detected);', ESD_RUNG, 1)
    const r = analyze(t)
    // Fire_Detected now equals Lamp_Test inside ESD: the fire trip only acts during a lamp test.
    expect(sf(r, 'SF-01').status, summary(r)).not.toBe('CHANGED_EQUIVALENT')
    expect(r.findings.some((f) => f.type === 'COSMETIC_LOGIC_CHANGE' && f.safetyFunctionIds.includes('SF-01'))).toBe(false)
  })
})

describe('task model', () => {
  it('regression (found by adversarial review): moving the Safety program into an EVENT task (runs only when triggered) is CHANGED_EQUIVALENT, zero findings, VERIFIED_SCOPE', () => {
    let t = edit(BASE, '<ScheduledProgram Name="Safety"/>\n', '')
    t = edit(t, '</Tasks>', '<Task Name="Evt" Type="EVENT" Priority="5" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false">\n<EventInfo EventTrigger="EVENT Instruction Only" EnableTimeout="false"/>\n<ScheduledPrograms>\n<ScheduledProgram Name="Safety"/>\n</ScheduledPrograms>\n</Task>\n</Tasks>')
    const r = analyze(t)
    expectFlagged(r, 'SF-05')
    expect(r.trust.status).not.toBe('VERIFIED_SCOPE')
  })

  it('regression (found by adversarial review): a new 10 ms periodic task that latches a protective output (it preempts the continuous task) yields zero findings and VERIFIED_SCOPE', () => {
    let t = edit(BASE, '</Programs>', `<Program Name="Fast" TestEdits="false" MainRoutineName="Main" Disabled="false" UseAsFolder="false">\n<Tags/>\n<Routines>\n${rllRoutine('Main', ['OTL(Pump_01_Run_Enable);'])}</Routines>\n</Program>\n</Programs>`)
    t = edit(t, '</Tasks>', '<Task Name="Fast_10ms" Type="PERIODIC" Rate="10" Priority="1" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false">\n<ScheduledPrograms>\n<ScheduledProgram Name="Fast"/>\n</ScheduledPrograms>\n</Task>\n</Tasks>')
    const r = analyze(t)
    expect(r.findings.length, summary(r)).toBeGreaterThan(0)
    expectFlagged(r, 'SF-02')
  })

  it('regression (found by adversarial review): a new rung that writes a protective output earlier in the scan is attributed to no finding and no safety function', () => {
    const r = analyze(addRungAfter(BASE, 'JSR(Permissives,0);', 'OTL(Pump_01_Run_Enable);', 3))
    const logic = r.changes.filter((c) => c.category === 'logic').map((c) => c.id)
    expect(logic.length).toBe(1)
    const explained = new Set([...r.findings.flatMap((f) => f.changeIds), ...r.safetyFunctions.flatMap((s) => s.changeIds)])
    expect(logic.filter((id) => !explained.has(id)), summary(r)).toEqual([])
  })

  it('regression (found by adversarial review): moving the overflow protection from the continuous task to a 60 s periodic task is CHANGED_EQUIVALENT with no delay finding', () => {
    let t = edit(BASE, '<ScheduledProgram Name="Safety"/>\n', '')
    t = edit(t, '</Tasks>', '<Task Name="VerySlow" Type="PERIODIC" Rate="60000" Priority="15" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false">\n<ScheduledPrograms>\n<ScheduledProgram Name="Safety"/>\n</ScheduledPrograms>\n</Task>\n</Tasks>')
    const r = analyze(t)
    expectFlagged(r, 'SF-05')
  })
})

describe('structured text', () => {
  it('regression (found by adversarial review): an ST routine in non-safety scope that overwrites a protective output with COP(...) is NO_CHANGE with INFO findings only', () => {
    let t = addRoutine(BASE, 'Utilities', '<Routine Name="Calc" Type="ST">\n<STContent>\n<Line Number="0">\n<![CDATA[COP(Lamp_Test, Pump_01_Run_Enable, 1);]]>\n</Line>\n</STContent>\n</Routine>\n')
    t = addJsr(t, 'JSR(HVAC,0);', 'Calc', 2)
    const r = analyze(t)
    expect(sf(r, 'SF-02').status, summary(r)).not.toBe('NO_CHANGE')
    expect(r.findings.some((f) => f.disposition === 'REVIEW' || f.disposition === 'UNDECLARED')).toBe(true)
  })
})

describe('alarms', () => {
  it('regression (found by adversarial review): logic setting LT101_HH_Alm.OperDisable (the operator disable command) from non-safety logic is INFO in VERIFIED_SCOPE', () => {
    const r = analyze(addRungAfter(BASE, LIGHTING_LAST, 'XIC(Lamp_Test)OTL(LT101_HH_Alm.OperDisable);', 2))
    expect(sf(r, 'SF-07').status, summary(r)).not.toBe('NO_CHANGE')
    expect(reviewFindings(r, 'SF-07').length).toBeGreaterThan(0)
  })

  it('regression (found by adversarial review): setting OperDisable even BEFORE the ALMD (where member writes are modeled) is not treated as silencing', () => {
    const r = analyze(addRungAfter(BASE, 'JSR(Permissives,0);', 'OTL(LT101_HH_Alm.OperDisable);', 3))
    expect(sf(r, 'SF-07').notification?.status, summary(r)).not.toBe('INTACT')
  })

  it('regression (found by adversarial review): ALMD Condition flipped to false in the alarm tag configuration (alarm now active when the level is NOT high) is NO_CHANGE with zero findings', () => {
    const r = analyze(edit(BASE, 'Severity="900" MinDurationPRE="0" ShelveDuration="0" MaxShelveDuration="0" ProgTime="DT#1970-01-01-00:00:00.000_000Z" EnableIn="false" In="false" InFault="false" Condition="true"', 'Severity="900" MinDurationPRE="0" ShelveDuration="0" MaxShelveDuration="0" ProgTime="DT#1970-01-01-00:00:00.000_000Z" EnableIn="false" In="false" InFault="false" Condition="false"'))
    expectFlagged(r, 'SF-07')
  })

  it('regression (found by adversarial review): ALMD MinDurationPRE raised from 0 to 3 600 000 ms (alarm delayed by an hour) is NO_CHANGE with zero findings', () => {
    const r = analyze(edit(BASE, 'Severity="900" MinDurationPRE="0"', 'Severity="900" MinDurationPRE="3600000"'))
    expectFlagged(r, 'SF-07')
  })

  it('regression (found by adversarial review): replacing the ALMD alarm with a plain BOOL (no alarm instruction any more) reports the notification path INTACT', () => {
    const t = setRung(
      edit(BASE, '<Tag Name="LT101_HH_Alm" TagType="Base" DataType="ALARM_DIGITAL" ExternalAccess="Read/Write">', '<Tag Name="LT101_HH_Alm" TagType="Base" DataType="BOOL" ExternalAccess="Read/Write">'),
      'XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,0,0);',
      'XIC(LSHH_101)OTE(LT101_HH_Alm);',
    )
    const r = analyze(t)
    expect(sf(r, 'SF-07').notification?.status, summary(r)).not.toBe('INTACT')
  })
})

describe('configuration rules', () => {
  it('regression (found by adversarial review): ExternalWriteAccessRule never fires: Fire_Detected (an SF-01 trip input) becoming Read/Write yields zero findings', () => {
    const r = analyze(edit(BASE, '<Tag Name="Fire_Detected" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false" ExternalAccess="Read Only">', '<Tag Name="Fire_Detected" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false" ExternalAccess="Read/Write">'))
    expect(r.changes.some((c) => c.field === 'externalAccess' && c.entity.name === 'Fire_Detected')).toBe(true)
    expect(r.findings.map((f) => f.type), summary(r)).toContain('EXTERNAL_WRITE_ACCESS_GRANTED')
  })
})

describe('timers', () => {
  const timerTag = (pre: number) =>
    `<Tag Name="XV101_Dly" TagType="Base" DataType="TIMER" Constant="false" ExternalAccess="Read Only">\n<Data Format="L5K">\n<![CDATA[[0,${pre},0]]]>\n</Data>\n<Data Format="Decorated">\n<Structure DataType="TIMER">\n<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="${pre}"/>\n<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="EN" DataType="BOOL" Value="0"/>\n<DataValueMember Name="TT" DataType="BOOL" Value="0"/>\n<DataValueMember Name="DN" DataType="BOOL" Value="0"/>\n</Structure>\n</Data>\n</Tag>\n`
  /** SF-05 with an on-delay: LSHH_101 → TON → XV101_Close_Cmd. */
  const withTimer = (pre: number, presetOperand: string, accOperand: string) => {
    const ton = `XIC(LSHH_101)TON(XV101_Dly,${presetOperand},${accOperand});`
    let t = setRung(BASE, OVERFLOW_RUNG, ton)
    t = addRungAfter(t, ton, 'XIC(XV101_Dly.DN)OTE(XV101_Close_Cmd);', 1)
    return addControllerTags(t, timerTag(pre))
  }

  it('regression: a literal TON preset raised 2000 → 600000 in the protective path is TRIP_DELAY_INCREASED', () => {
    const r = analyze(withTimer(600000, '600000', '0'), { baseline: withTimer(2000, '2000', '0') })
    expect(r.findings.some((f) => f.type === 'TRIP_DELAY_INCREASED' && f.safetyFunctionIds.includes('SF-05'))).toBe(true)
  })

  it('regression (found by adversarial review): the same preset increase written the way exports carry it (TON(T,?,?) with PRE in the tag data) is NO_CHANGE, zero findings', () => {
    const r = analyze(withTimer(600000, '?', '?'), { baseline: withTimer(2000, '?', '?') })
    expect(r.findings.some((f) => f.type === 'TRIP_DELAY_INCREASED' && f.safetyFunctionIds.includes('SF-05')), summary(r)).toBe(true)
  })

  it('regression (found by adversarial review): MOV(600000,XV101_Dly.PRE) earlier in the scan (preset overridden by logic) is NO_CHANGE for SF-05', () => {
    const base = withTimer(2000, '2000', '0')
    const r = analyze(setRung(base, 'JSR(ESD,0);', 'MOV(600000,XV101_Dly.PRE)JSR(ESD,0);'), { baseline: base })
    expectFlagged(r, 'SF-05')
  })
})

describe('recursion inside declared safety logic', () => {
  it('regression (found by adversarial review): an unconditional recursive JSR(ESD) inside the declared ESD routine (not modeled) leaves SF-01 NO_CHANGE and trust not partial', () => {
    const r = analyze(addRungAfter(BASE, 'XIO(MCC_Main_Enable)OTE(ESD_Active);', 'JSR(ESD,0);', 2))
    expect(r.coverage.unsupported.some((u) => /Recursive call/.test(u.detail))).toBe(true)
    expect(r.trust.status, summary(r)).toBe('PARTIAL_COVERAGE')
    expect(sf(r, 'SF-01').status).not.toBe('NO_CHANGE')
  })
})
