import { describe, expect, it } from 'vitest'
import { PARSER_VERSION, l5xAdapter, parseL5x } from '../../src/adapters/l5x/index.ts'
import { ProjectParseError } from '../../src/adapters/types.ts'
import type { ParsedProject, ParserDiagnostic } from '../../src/model/project.ts'
import { NORTHGATE_SAMPLE, variant } from './sample.ts'

function errorOf(fn: () => unknown): ProjectParseError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ProjectParseError) return e
    throw e
  }
  throw new Error('expected an error')
}

function codes(p: ParsedProject, severity?: ParserDiagnostic['severity']): string[] {
  return p.diagnostics.filter((d) => severity === undefined || d.severity === severity).map((d) => d.code)
}

function find<T extends { name: string }>(items: T[], name: string): T {
  const it = items.find((x) => x.name === name)
  if (it === undefined) throw new Error(`${name} not found`)
  return it
}

const project = parseL5x(NORTHGATE_SAMPLE)
const cp = (n: number): string => String.fromCodePoint(n)

describe('L5X adapter: Northgate sample', () => {
  it('reads metadata from the root and Controller', () => {
    expect(project.metadata).toEqual({
      format: 'L5X',
      formatLabel: 'Rockwell Logix Designer export (L5X)',
      vendor: 'Rockwell Automation',
      controllerName: 'NORTHGATE_PS',
      processorType: '1756-L83E',
      firmwareRevision: '35.11',
      schemaRevision: '1.0',
      softwareRevision: '35.00',
      exportDate: 'Wed Sep 30 14:12:09 2026',
      targetType: 'Controller',
      containsContext: false,
    })
  })

  it('reads tasks with type, priority, rate, watchdog and schedule order', () => {
    expect(project.tasks.map((t) => [t.name, t.type, t.priority, t.rate, t.watchdog, t.inhibited, t.disableUpdateOutputs, t.scheduledPrograms])).toEqual([
      ['MainTask', 'CONTINUOUS', 10, undefined, 500, false, false, ['Safety', 'PumpControl']],
      ['Slow_100ms', 'PERIODIC', 12, 100, 500, false, false, ['Reporting']],
    ])
  })

  it('reads programs', () => {
    expect(project.programs.map((p) => [p.name, p.mainRoutine, p.disabled, p.programClass, p.description])).toEqual([
      ['Safety', 'Main', false, 'Standard', 'Station protective functions'],
      ['PumpControl', 'Main', false, undefined, undefined],
      ['Reporting', 'Main', true, undefined, undefined],
    ])
  })

  it('gives routines stable ids and keeps rung text exactly as exported (trimmed)', () => {
    expect(project.routines.map((r) => [r.id, r.kind, r.protected])).toEqual([
      ['module:AOI_PumpInterlock/Logic', 'RLL', false],
      ['program:Safety/Main', 'RLL', false],
      ['program:Safety/ESD', 'RLL', false],
      ['program:Safety/Overflow', 'RLL', true],
      ['program:PumpControl/Main', 'RLL', false],
      ['program:PumpControl/PUMP_01', 'RLL', false],
      ['program:PumpControl/Calc', 'ST', false],
      ['program:PumpControl/Blend', 'FBD', false],
      ['program:Reporting/Main', 'RLL', false],
    ])
    const logic = project.routines[0]
    expect(logic?.container).toEqual({ kind: 'module', name: 'AOI_PumpInterlock' })
    expect(logic?.rungs.map((r) => [r.number, r.type, r.text])).toEqual([
      [0, 'N', '[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ,XIC(ESD_Active) ]OTE(Trip);'],
      [1, 'N', 'XIC(Run_Request)XIO(Trip)OTE(Run_Enable);'],
      [2, 'N', 'XIC(Trip)OTE(Shutdown_Alarm);'],
    ])
    expect(logic?.rungs[0]?.comment).toBe('Any trip cause latches the pump off')
    const pump = find(project.routines, 'PUMP_01')
    expect(pump.rungs[1]?.text).toBe('XIC(PUMP_01_IL.Shutdown_Alarm)\nOTE(Pump_01_Shutdown_Alarm);')
  })

  it('reads localized rung comments and routine descriptions', () => {
    const esd = find(project.routines, 'ESD')
    expect(esd.description).toBe('Emergency shutdown')
    expect(esd.rungs[0]?.comment).toBe('Healthy chain keeps the MCC enabled')
    expect(esd.rungs[1]?.comment).toBeUndefined()
  })

  it('keeps ST lines and parses FBD structurally', () => {
    const calc = find(project.routines, 'Calc')
    expect(calc.rungs).toEqual([])
    expect(calc.stLines.map((l) => [l.number, l.text])).toEqual([
      [0, 'Flow_Total := Flow_Total + Flow_PV;'],
      [1, 'IF Flow_Total > 1.0E6 THEN Flow_Total := 0.0; END_IF;'],
    ])
    const blend = find(project.routines, 'Blend')
    expect(blend.rungs).toEqual([])
    expect(blend.stLines).toEqual([])
    const notAnalyzed = project.diagnostics.filter((d) => d.code === 'L5X_ROUTINE_NOT_ANALYZED')
    expect(notAnalyzed.map((d) => [d.severity, d.source?.path])).toEqual([
      ['info', "/RSLogix5000Content/Controller[@Name='NORTHGATE_PS']/Programs/Program[@Name='PumpControl']/Routines/Routine[@Name='Calc']"],
      ['info', "/RSLogix5000Content/Controller[@Name='NORTHGATE_PS']/Programs/Program[@Name='PumpControl']/Routines/Routine[@Name='Blend']"],
    ])
    expect(notAnalyzed[1]?.message).toContain('FBD')
  })

  it('marks a source-protected routine and warns', () => {
    const overflow = find(project.routines, 'Overflow')
    expect(overflow.protected).toBe(true)
    expect(overflow.rungs).toEqual([])
    const d = project.diagnostics.find((x) => x.code === 'L5X_PROTECTED_CONTENT' && x.message.includes('Overflow'))
    expect(d?.severity).toBe('warning')
    expect(d?.location).toBe('Controller.Programs.Program[0].Routines.EncodedData (Program "Safety", EncodedData "Overflow")')
  })

  it('reads the AOI definition: parameters in order without EnableIn/EnableOut, locals, routines', () => {
    const aoi = find(project.modules, 'AOI_PumpInterlock')
    expect(aoi.kind).toBe('AOI')
    expect(aoi.revision).toBe('3.4')
    expect(aoi.revisionExtension).toBe('NWA')
    expect(aoi.vendor).toBe('Northgate Water Authority')
    expect(aoi.description).toBe('Pump protection interlock')
    expect(aoi.editedDate).toBe('2026-03-02T10:41:05.880Z')
    expect(aoi.protected).toBe(false)
    expect(aoi.signatureId).toBeUndefined()
    expect(aoi.parameters.map((p) => [p.name, p.usage, p.required, p.visible, p.dataType, p.externalAccess])).toEqual([
      ['Run_Request', 'Input', true, true, 'BOOL', 'Read/Write'],
      ['Level_HH', 'Input', true, true, 'BOOL', 'Read/Write'],
      ['Press_Trip', 'Input', true, true, 'BOOL', 'Read/Write'],
      ['Motor_Temp_Hi', 'Input', true, true, 'BOOL', 'Read/Write'],
      ['ESD_Active', 'Input', true, true, 'BOOL', 'Read/Write'],
      ['Run_Enable', 'Output', true, true, 'BOOL', 'Read Only'],
      ['Shutdown_Alarm', 'Output', false, true, 'BOOL', 'Read Only'],
    ])
    expect(aoi.parameters[1]?.description).toBe('Wet well level high-high')
    expect(aoi.parameters[1]?.defaultValue).toBe('0')
    expect(aoi.localTags).toEqual([
      expect.objectContaining({ name: 'Trip', scope: { kind: 'module', module: 'AOI_PumpInterlock' }, usage: 'Local', dataType: 'BOOL', externalAccess: 'None', value: '0' }),
    ])
    expect(aoi.routineIds).toEqual(['module:AOI_PumpInterlock/Logic'])
  })

  it('reads a source-protected AOI with its visible parameters and signature', () => {
    const valve = find(project.modules, 'AOI_VendorValve')
    expect(valve.protected).toBe(true)
    expect(valve.signatureId).toBe('16#5a1c_9e33')
    expect(valve.parameters.map((p) => p.name)).toEqual(['Open_Cmd', 'Is_Open'])
    expect(valve.routineIds).toEqual([])
    expect(codes(project)).toContain('L5X_PROTECTED_CONTENT')
  })

  it('reads controller tags: alias, AOI-typed, TIMER, ALARM_DIGITAL, arrays, defaults', () => {
    const t = (n: string) => find(project.tags, n)
    expect(t('Pump_01_Run_Enable')).toMatchObject({ dataType: 'BOOL', externalAccess: 'Read Only', constant: false, value: '0', description: 'Pump P-101 run enable to MCC', scope: { kind: 'controller' } })
    expect(t('LSHH_101')).toMatchObject({ dataType: 'ALIAS', aliasFor: 'Local:3:I.Data.4', externalAccess: 'Read/Write' })
    expect(t('LSHH_101').value).toBeUndefined()
    expect(t('PUMP_01_IL')).toMatchObject({ dataType: 'AOI_PumpInterlock', value: 'EnableIn=1;EnableOut=0' })
    expect(t('C201_LP_Delay').value).toBe('ACC=0;DN=0;EN=0;PRE=2000;TT=0')
    expect(t('LT101_HH_Alm')).toMatchObject({ dataType: 'ALARM_DIGITAL', value: 'Severity=900;MinDurationPRE=0;ShelveDuration=0;MaxShelveDuration=0;Condition=true;AckRequired=true;Latched=false;ProgDisable=false;OperDisable=false;ProgSuppress=false;OperSuppress=false;OperShelve=false;AM=Tank T-101 level high-high' })
    expect(t('Flow_Totals')).toMatchObject({ dimensions: '4', constant: true, value: '[0.0,0.0,0.0,0.0]', description: 'Flow totalizers & daily volumes' })
    // ExternalAccess absent -> the Logix default
    expect(t('Pump_01_Run_Request').externalAccess).toBe('Read/Write')
    expect(t('Pump_01_Run_Request').value).toBe('1')
  })

  it('reads program-scoped tags', () => {
    expect(find(project.tags, 'Pump_Count')).toMatchObject({ scope: { kind: 'program', program: 'PumpControl' }, dataType: 'DINT', value: '5', externalAccess: 'Read Only' })
  })

  it('reads data types with members', () => {
    expect(project.dataTypes).toEqual([
      expect.objectContaining({
        name: 'UDT_PumpStatus',
        family: 'NoFamily',
        members: [
          { name: 'ZZZZZZZZZZUDT_PumpS0', dataType: 'SINT', hidden: true },
          { name: 'Running', dataType: 'BIT', hidden: false },
          { name: 'Hours', dataType: 'REAL', hidden: false },
        ],
      }),
    ])
  })

  it('attaches source refs (path, line, column) to every entity', () => {
    const esd = find(project.routines, 'ESD')
    expect(esd.rungs[1]?.source).toEqual({
      path: "/RSLogix5000Content/Controller[@Name='NORTHGATE_PS']/Programs/Program[@Name='Safety']/Routines/Routine[@Name='ESD']/RLLContent/Rung[@Number='1']",
      line: NORTHGATE_SAMPLE.split('\n').findIndex((l) => l.includes('<![CDATA[XIO(MCC_Main_Enable)OTE(ESD_Active);]]>')) - 1,
      column: 1,
    })
    const all = [...project.tasks, ...project.programs, ...project.routines, ...project.modules, ...project.tags, ...project.dataTypes]
    for (const e of all) {
      expect(e.source.path.startsWith('/RSLogix5000Content/Controller')).toBe(true)
      expect(e.source.line).toBeGreaterThan(1)
    }
  })

  it('reports exactly the expected diagnostics, and nothing for ignored elements', () => {
    expect(codes(project).sort()).toEqual(
      ['L5X_PROGRAM_DISABLED', 'L5X_PROTECTED_CONTENT', 'L5X_PROTECTED_CONTENT', 'L5X_ROUTINE_NOT_ANALYZED', 'L5X_ROUTINE_NOT_ANALYZED'].sort(),
    )
  })

  it('is deterministic and JSON-serializable', () => {
    const again = parseL5x(NORTHGATE_SAMPLE)
    expect(again).toEqual(project)
    expect(JSON.parse(JSON.stringify(project))).toEqual(JSON.parse(JSON.stringify(again)))
  })

  it('exposes adapter metadata', () => {
    expect(l5xAdapter).toMatchObject({
      id: 'rockwell-l5x',
      label: 'Rockwell Logix Designer (L5X)',
      format: 'L5X',
      vendor: 'Rockwell Automation',
      status: 'SUPPORTED',
      version: PARSER_VERSION,
      extensions: ['.l5x'],
    })
    expect(l5xAdapter.parse(NORTHGATE_SAMPLE)).toEqual(project)
  })
})

describe('L5X adapter: structural errors', () => {
  it('rejects a wrong root and names it', () => {
    const err = errorOf(() => parseL5x('<?xml version="1.0"?><project xmlns="http://www.plcopen.org/xml/tc6_0201"/>'))
    expect(err.code).toBe('L5X_WRONG_ROOT')
    expect(err.message).toContain('<project>')
  })

  it('rejects a file with no Controller', () => {
    expect(errorOf(() => parseL5x('<RSLogix5000Content TargetType="Controller"><Other/></RSLogix5000Content>')).code).toBe('L5X_NO_CONTROLLER')
  })

  it('propagates XML errors with their codes', () => {
    expect(errorOf(() => parseL5x(variant('<Programs>', '<!DOCTYPE x><Programs>'))).code).toBe('XML_DOCTYPE_FORBIDDEN')
  })

  it.each([
    ['tag', '<Tag Name="LSHH_101" TagType="Alias"', '<Tag TagType="Alias"', 'Controller.Tags.Tag[2]'],
    ['program', '<Program Name="Reporting"', '<Program', 'Controller.Programs.Program[2]'],
    ['routine', '<Routine Name="Calc" Type="ST">', '<Routine Type="ST">', 'Controller.Programs.Program[1].Routines.Routine[2] (Program "PumpControl")'],
    ['AOI', '<AddOnInstructionDefinition Name="AOI_PumpInterlock"', '<AddOnInstructionDefinition', 'Controller.AddOnInstructionDefinitions.AddOnInstructionDefinition[0]'],
    ['task', '<Task Name="Slow_100ms"', '<Task Name=" "', 'Controller.Tasks.Task[1] (Task " ")'],
  ])('fails with L5X_MISSING_NAME for a nameless %s', (_label, find, replace, location) => {
    const err = errorOf(() => parseL5x(variant(find, replace)))
    expect(err.code).toBe('L5X_MISSING_NAME')
    expect(err.location).toBe(location)
    expect(err.source?.line).toBeGreaterThan(1)
    expect(err.diagnostics.some((d) => d.severity === 'error' && d.code === 'L5X_MISSING_NAME')).toBe(true)
  })

  it('collects every error and reports the first with a count', () => {
    const text = variant('<Program Name="Reporting"', '<Program', variant('<Tag Name="LSHH_101" TagType="Alias"', '<Tag TagType="Alias"'))
    const err = errorOf(() => parseL5x(text))
    expect(err.message).toContain('(and 1 more error)')
    expect(err.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(2)
  })

  it('fails when a rung has no Text', () => {
    const text = variant('<Text>\n<![CDATA[JSR(ESD,0);]]>\n</Text>', '')
    const err = errorOf(() => parseL5x(text))
    expect(err.code).toBe('L5X_RUNG_WITHOUT_TEXT')
    expect(err.location).toBe('Controller.Programs.Program[0].Routines.Routine[0].RLLContent.Rung[0] (Program "Safety", Routine "Main", Rung 0)')
  })

  it('fails when a rung has two Text elements', () => {
    const text = variant('<![CDATA[JSR(ESD,0);]]>\n</Text>', '<![CDATA[JSR(ESD,0);]]>\n</Text>\n<Text><![CDATA[AFI();]]></Text>')
    expect(errorOf(() => parseL5x(text)).code).toBe('L5X_AMBIGUOUS_RUNG_TEXT')
  })

  it('fails on an AOI parameter with an unknown Usage', () => {
    expect(errorOf(() => parseL5x(variant('Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">\n<Description>\n<![CDATA[Operator', 'Usage="Sideways" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">\n<Description>\n<![CDATA[Operator'))).code).toBe(
      'L5X_INVALID_PARAMETER_USAGE',
    )
  })

  it('fails on two Controller elements', () => {
    const text = variant('</Controller>', '</Controller>\n<Controller Name="SHADOW"/>')
    expect(errorOf(() => parseL5x(text)).code).toBe('L5X_MULTIPLE_CONTROLLERS')
  })

  it('never throws anything other than ProjectParseError', () => {
    for (const s of ['', 'x', '<RSLogix5000Content/>']) {
      expect(() => parseL5x(s)).toThrow(ProjectParseError)
    }
  })

  it('parses an empty controller as an empty project, with warnings', () => {
    const p = parseL5x('<RSLogix5000Content><Controller/></RSLogix5000Content>')
    expect(p.metadata.controllerName).toBe('(unnamed)')
    expect(p.programs).toEqual([])
    expect(codes(p, 'warning').sort()).toEqual(['L5X_CONTROLLER_UNNAMED', 'L5X_MISSING_TARGET_TYPE'])
  })
})

describe('L5X adapter: warnings and info', () => {
  const parse = (find: string, replace: string): ParsedProject => parseL5x(variant(find, replace))

  it('warns on duplicate names, case-insensitively, and keeps both', () => {
    const p = parse('<Tag Name="LSHH_101" TagType="Alias"', '<Tag Name="lshh_101" TagType="Base" DataType="BOOL"/>\n<Tag Name="LSHH_101" TagType="Alias"')
    const d = p.diagnostics.find((x) => x.code === 'L5X_DUPLICATE_NAME')
    expect(d?.severity).toBe('warning')
    expect(d?.message).toContain('"LSHH_101"')
    expect(p.tags.filter((t) => t.name.toUpperCase() === 'LSHH_101')).toHaveLength(2)
  })

  it('warns on duplicate routine names within one program but not across programs', () => {
    const p = parse('<Routine Name="Calc" Type="ST">', '<Routine Name="PUMP_01" Type="ST">')
    expect(codes(p)).toContain('L5X_DUPLICATE_NAME')
    expect(codes(project)).not.toContain('L5X_DUPLICATE_NAME') // "Main" exists in three programs
  })

  it('warns on invalid identifiers and names longer than 40 characters', () => {
    const bad = parse('<Tag Name="Flow_Totals"', '<Tag Name="1_Flow-Totals"')
    expect(codes(bad)).toContain('L5X_INVALID_NAME')
    const long = parse('<Tag Name="Flow_Totals"', `<Tag Name="${'A'.repeat(41)}"`)
    expect(codes(long)).toContain('L5X_NAME_TOO_LONG')
    expect(codes(parse('<Tag Name="Flow_Totals"', `<Tag Name="${'A'.repeat(40)}"`))).not.toContain('L5X_NAME_TOO_LONG')
  })

  it('strips a bidi override from a tag description and warns with the location', () => {
    const p = parse('Pump P-101 run enable to MCC', `Pump P-101 run enable ${cp(0x202e)}CCM ot`)
    expect(find(p.tags, 'Pump_01_Run_Enable').description).toBe('Pump P-101 run enable CCM ot')
    const d = p.diagnostics.find((x) => x.code === 'TEXT_INVISIBLE_CHARACTERS')
    expect(d?.severity).toBe('warning')
    expect(d?.message).toContain('1 invisible or bidirectional control character')
    expect(d?.location).toBe('Controller.Tags.Tag[0].Description (Tag "Pump_01_Run_Enable")')
  })

  it('strips invisible characters from rung text and names', () => {
    const zwsp = cp(0x200b)
    const p = parse('XIO(MCC_Main_Enable)OTE(ESD_Active);', `XIO(MCC_Main_Enable)OTE(ESD${zwsp}_Active);`)
    expect(find(p.routines, 'ESD').rungs[1]?.text).toBe('XIO(MCC_Main_Enable)OTE(ESD_Active);')
    expect(p.diagnostics.filter((d) => d.code === 'TEXT_INVISIBLE_CHARACTERS').map((d) => d.message)).toEqual([expect.stringContaining('rung text')])
    const named = parse('<Tag Name="Flow_Totals"', `<Tag Name="Flow${cp(0x2066)}_Totals"`)
    expect(named.tags.some((t) => t.name === 'Flow_Totals')).toBe(true)
    expect(codes(named)).toContain('TEXT_INVISIBLE_CHARACTERS')
  })

  it('reports a partial export with info and uses TargetName', () => {
    const p = parse('TargetName="NORTHGATE_PS" TargetType="Controller"', 'TargetName="Safety" TargetType="Program"')
    expect(p.metadata.targetType).toBe('Program')
    expect(p.metadata.controllerName).toBe('Safety')
    const d = p.diagnostics.find((x) => x.code === 'L5X_PARTIAL_EXPORT')
    expect(d?.severity).toBe('info')
  })

  it('warns on an unknown routine type and on content that does not match the type', () => {
    expect(codes(parse('<Routine Name="Blend" Type="FBD">', '<Routine Name="Blend" Type="XYZ">'))).toContain('L5X_UNSUPPORTED_ROUTINE_TYPE')
    const mismatch = parse('<Routine Name="Calc" Type="ST">', '<Routine Name="Calc" Type="RLL">')
    expect(codes(mismatch)).toContain('L5X_ROUTINE_CONTENT_MISMATCH')
    expect(find(mismatch.routines, 'Calc').rungs).toEqual([])
  })

  it('infers a missing routine type from its content and warns', () => {
    const p = parse('<Routine Name="Calc" Type="ST">', '<Routine Name="Calc">')
    expect(find(p.routines, 'Calc').kind).toBe('ST')
    expect(codes(p)).toContain('L5X_MISSING_ROUTINE_TYPE')
  })

  it('warns on unexpected elements inside RLLContent and containers instead of dropping them silently', () => {
    expect(codes(parse('<RLLContent>\n<Rung Number="0" Type="N">\n<Text>\n<![CDATA[JSR(ESD,0);]]>', '<RLLContent>\n<HiddenRung/>\n<Rung Number="0" Type="N">\n<Text>\n<![CDATA[JSR(ESD,0);]]>'))).toContain(
      'L5X_UNEXPECTED_ELEMENT',
    )
    expect(codes(parse('<Tags>\n<Tag Name="Pump_01_Run_Enable"', '<Tags>\n<Tagg/>\n<Tag Name="Pump_01_Run_Enable"'))).toContain('L5X_UNEXPECTED_ELEMENT')
  })

  it('reads every container when one is duplicated, and warns', () => {
    const p = parse('</Programs>', '</Programs>\n<Programs>\n<Program Name="Extra" MainRoutineName="Main"><Routines><Routine Name="Main" Type="RLL"><RLLContent/></Routine></Routines></Program>\n</Programs>')
    expect(p.programs.map((x) => x.name)).toContain('Extra')
    expect(codes(p)).toContain('L5X_DUPLICATE_ELEMENT')
  })

  it('maps unknown ExternalAccess to Unknown with a warning', () => {
    const p = parse('<Tag Name="Flow_Totals" TagType="Base" DataType="REAL" Dimensions="4" Constant="true">', '<Tag Name="Flow_Totals" TagType="Base" DataType="REAL" Dimensions="4" Constant="true" ExternalAccess="Write Only">')
    expect(find(p.tags, 'Flow_Totals').externalAccess).toBe('Unknown')
    expect(codes(p)).toContain('L5X_UNKNOWN_EXTERNAL_ACCESS')
  })

  it('reports scheduling problems', () => {
    const unknown = parse('<ScheduledProgram Name="Reporting"/>', '<ScheduledProgram Name="Reporting"/>\n<ScheduledProgram Name="Ghost"/>')
    expect(codes(unknown)).toContain('L5X_UNKNOWN_SCHEDULED_PROGRAM')
    const unscheduled = parse('<ScheduledProgram Name="PumpControl"/>', '')
    const d = unscheduled.diagnostics.find((x) => x.code === 'L5X_UNSCHEDULED_PROGRAM')
    expect(d?.severity).toBe('info')
    expect(d?.message).toContain('"PumpControl"')
    const twice = parse('<ScheduledProgram Name="Reporting"/>', '<ScheduledProgram Name="Reporting"/>\n<ScheduledProgram Name="Safety"/>')
    expect(codes(twice)).toContain('L5X_PROGRAM_SCHEDULED_TWICE')
  })

  it('reports an inhibited task and a missing main routine', () => {
    const inhibited = parse('Rate="100" Priority="12" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false"', 'Rate="100" Priority="12" Watchdog="500" DisableUpdateOutputs="true" InhibitTask="true"')
    const slow = find(inhibited.tasks, 'Slow_100ms')
    expect([slow.inhibited, slow.disableUpdateOutputs]).toEqual([true, true])
    expect(codes(inhibited)).toContain('L5X_TASK_INHIBITED')
    expect(codes(parse('MainRoutineName="Main" Disabled="true"', 'MainRoutineName="Nope" Disabled="true"'))).toContain('L5X_MAIN_ROUTINE_MISSING')
  })

  it('reports pending rung edits, bad rung numbers and out-of-order rungs', () => {
    expect(codes(parse('<Rung Number="1" Type="N">\n<Text>\n<![CDATA[JSR(Overflow,0);]]>', '<Rung Number="1" Type="I">\n<Text>\n<![CDATA[JSR(Overflow,0);]]>'))).toContain('L5X_PENDING_RUNG_EDIT')
    const bad = parse('<Rung Number="1" Type="N">\n<Text>\n<![CDATA[JSR(Overflow,0);]]>', '<Rung Number="one" Type="N">\n<Text>\n<![CDATA[JSR(Overflow,0);]]>')
    expect(codes(bad)).toContain('L5X_INVALID_RUNG_NUMBER')
    expect(find(bad.routines, 'Main').rungs[1]?.number).toBe(1)
    expect(codes(parse('<Rung Number="1" Type="N">\n<Text>\n<![CDATA[JSR(Overflow,0);]]>', '<Rung Number="0" Type="N">\n<Text>\n<![CDATA[JSR(Overflow,0);]]>'))).toContain('L5X_DUPLICATE_RUNG_NUMBER')
  })

  it('warns on invalid numbers and booleans', () => {
    const p = parse('Priority="12"', 'Priority="twelve"')
    expect(find(p.tasks, 'Slow_100ms').priority).toBeUndefined()
    expect(codes(p)).toContain('L5X_INVALID_NUMBER')
    expect(codes(parse('Constant="true"', 'Constant="maybe"'))).toContain('L5X_INVALID_BOOLEAN')
  })

  it('canonicalizes nested structure and array values in natural order', () => {
    const p = parse(
      '<Structure DataType="TIMER">',
      '<Structure DataType="TIMER">\n<StructureMember Name="Cfg" DataType="CFG"><DataValueMember Name="Z" DataType="DINT" Value="2"/><DataValueMember Name="A" DataType="DINT" Value="1"/></StructureMember>\n' +
        '<ArrayMember Name="Arr" DataType="DINT" Dimensions="12"><Element Index="[10]" Value="10"/><Element Index="[2]" Value="2"/></ArrayMember>',
    )
    expect(find(p.tags, 'C201_LP_Delay').value).toBe('ACC=0;Arr[2]=2;Arr[10]=10;Cfg.A=1;Cfg.Z=2;DN=0;EN=0;PRE=2000;TT=0')
  })

  it('prefers the en-US localized description, else the first', () => {
    const p = parse(
      '<Description>\n<![CDATA[Station protective functions]]>\n</Description>',
      '<Description>\n<LocalizedDescription Lang="fr-FR"><![CDATA[Fonctions de protection]]></LocalizedDescription>\n<LocalizedDescription Lang="es-ES"><![CDATA[Funciones]]></LocalizedDescription>\n</Description>',
    )
    expect(find(p.programs, 'Safety').description).toBe('Fonctions de protection')
  })

  it('does not let __proto__ attributes pollute anything', () => {
    const p = parse('<Tag Name="Flow_Totals"', '<Tag __proto__="x" constructor="y" Name="Flow_Totals"')
    expect(find(p.tags, 'Flow_Totals').dataType).toBe('REAL')
    expect(({} as Record<string, unknown>)['x']).toBeUndefined()
  })
})
