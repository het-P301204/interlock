/**
 * Serializes a ControllerModel into L5X text laid out the way Logix Designer
 * v35 writes a full controller export: XML declaration with standalone="yes",
 * one element per line with no indentation, every description, comment, rung
 * text and L5K data block in its own CDATA section on its own line, L5K and
 * Decorated data side by side, AlarmDigitalParameters for ALARM_DIGITAL tags
 * and EnableIn/EnableOut first in every AOI parameter list. Line endings are LF.
 *
 * Pure: no I/O, no clock, no randomness. Same model in, same bytes out.
 */
import type { AoiDefinition, AoiLocalTag, AoiParameter, ControllerModel, DataTypeDef, IoModule, Program, Routine, Rung, TagDef, Task } from './types.ts'

type Attrs = [string, string | number | boolean][]

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function attrs(list: Attrs): string {
  return list.map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`).join('')
}

function cdata(text: string): string {
  if (text.includes(']]>')) throw new Error(`CDATA content may not contain "]]>": ${text}`)
  return `<![CDATA[${text}]]>`
}

/** L5K REAL format, e.g. 18.4 -> "1.84000000e+001". */
export function l5kReal(value: number): string {
  const [mantissa, exponent] = value.toExponential(8).split('e')
  const exp = Number(exponent)
  const sign = exp < 0 ? '-' : '+'
  return `${mantissa}e${sign}${String(Math.abs(exp)).padStart(3, '0')}`
}

/** Decorated REAL format: "12.0", "18.4". */
export function decoratedReal(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value)
}

class Lines {
  readonly out: string[] = []
  readonly localized: boolean

  constructor(localized: boolean) {
    this.localized = localized
  }

  push(...lines: string[]): void {
    for (const l of lines) this.out.push(l)
  }

  description(text: string | undefined): void {
    if (text === undefined || text === '') return
    if (this.localized) this.push('<Description>', '<LocalizedDescription Lang="en-US">', cdata(text), '</LocalizedDescription>', '</Description>')
    else this.push('<Description>', cdata(text), '</Description>')
  }

  comment(text: string | undefined): void {
    if (text === undefined || text === '') return
    if (this.localized) this.push('<Comment>', '<LocalizedComment Lang="en-US">', cdata(text), '</LocalizedComment>', '</Comment>')
    else this.push('<Comment>', cdata(text), '</Comment>')
  }
}

/* ------------------------------------------------------------------ data */

function timerData(l: Lines, element: 'Data' | 'DefaultData', pre: number, acc: number): void {
  l.push(
    `<${element} Format="L5K">`,
    cdata(`[0,${pre},${acc}]`),
    `</${element}>`,
    `<${element} Format="Decorated">`,
    '<Structure DataType="TIMER">',
    `<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="${pre}"/>`,
    `<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="${acc}"/>`,
    '<DataValueMember Name="EN" DataType="BOOL" Value="0"/>',
    '<DataValueMember Name="TT" DataType="BOOL" Value="0"/>',
    '<DataValueMember Name="DN" DataType="BOOL" Value="0"/>',
    '</Structure>',
    `</${element}>`,
  )
}

function atomicData(l: Lines, element: 'Data' | 'DefaultData', dataType: 'BOOL' | 'DINT' | 'REAL', value: number): void {
  const l5k = dataType === 'REAL' ? l5kReal(value) : String(value)
  const decorated = dataType === 'REAL' ? decoratedReal(value) : String(value)
  const radix = dataType === 'REAL' ? 'Float' : 'Decimal'
  l.push(
    `<${element} Format="L5K">`,
    cdata(l5k),
    `</${element}>`,
    `<${element} Format="Decorated">`,
    `<DataValue${attrs([['DataType', dataType], ['Radix', radix], ['Value', decorated]])}/>`,
    `</${element}>`,
  )
}

function aoiInstanceData(l: Lines, aoi: AoiDefinition): void {
  l.push('<Data Format="L5K">', cdata('[1,0]'), '</Data>', '<Data Format="Decorated">', `<Structure DataType="${escapeAttr(aoi.name)}">`)
  l.push('<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>', '<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>')
  for (const p of aoi.parameters) l.push(`<DataValueMember${attrs([['Name', p.name], ['DataType', p.dataType], ['Value', p.defaultValue]])}/>`)
  l.push('</Structure>', '</Data>')
}

function alarmData(l: Lines, severity: number, message: string): void {
  l.push(
    '<Data Format="Alarm">',
    `<AlarmDigitalParameters Severity="${severity}" MinDurationPRE="0" ShelveDuration="0" MaxShelveDuration="0" ProgTime="DT#1970-01-01-00:00:00.000_000Z" EnableIn="false" In="false" InFault="false" Condition="true" AckRequired="true" Latched="false" ProgAck="false" OperAck="false" ProgReset="false" OperReset="false" ProgSuppress="false" OperSuppress="false" ProgUnsuppress="false" OperUnsuppress="false" OperShelve="false" ProgUnshelve="false" OperUnshelve="false" ProgDisable="false" OperDisable="false" ProgEnable="false" OperEnable="false" AlarmCountReset="false" UseProgTime="false"/>`,
    '<AlarmConfig>',
    '<Messages>',
    '<Message Type="AM">',
    `<Text Lang="en-US">${cdata(message)}</Text>`,
    '</Message>',
    '</Messages>',
    '</AlarmConfig>',
    '</Data>',
  )
}

/* ------------------------------------------------------------------ tags */

function writeTag(l: Lines, tag: TagDef, aois: Map<string, AoiDefinition>): void {
  if (tag.aliasFor !== undefined) {
    l.push(`<Tag${attrs([['Name', tag.name], ['TagType', 'Alias'], ['Radix', 'Decimal'], ['AliasFor', tag.aliasFor], ['ExternalAccess', tag.externalAccess]])}>`)
    l.description(tag.description)
    l.push('</Tag>')
    return
  }
  const v = tag.value
  if (v?.kind === 'ALARM') {
    l.push(`<Tag${attrs([['Name', tag.name], ['TagType', 'Base'], ['DataType', 'ALARM_DIGITAL'], ['ExternalAccess', tag.externalAccess]])}>`)
    l.description(tag.description)
    alarmData(l, v.severity, v.message)
    l.push('</Tag>')
    return
  }
  const atomic = tag.dataType === 'BOOL' || tag.dataType === 'DINT' || tag.dataType === 'REAL'
  const a: Attrs = [['Name', tag.name], ['TagType', 'Base'], ['DataType', tag.dataType]]
  if (atomic) a.push(['Radix', tag.dataType === 'REAL' ? 'Float' : 'Decimal'])
  a.push(['Constant', tag.constant === true], ['ExternalAccess', tag.externalAccess])
  l.push(`<Tag${attrs(a)}>`)
  l.description(tag.description)
  if (v === undefined) {
    if (atomic) atomicData(l, 'Data', tag.dataType as 'BOOL' | 'DINT' | 'REAL', 0)
  } else if (v.kind === 'BOOL' || v.kind === 'DINT' || v.kind === 'REAL') {
    atomicData(l, 'Data', v.kind, v.value)
  } else if (v.kind === 'TIMER') {
    timerData(l, 'Data', v.pre, v.acc)
  } else if (v.kind === 'AOI') {
    const aoi = aois.get(tag.dataType)
    if (aoi === undefined) throw new Error(`Tag ${tag.name}: no AOI definition ${tag.dataType}`)
    aoiInstanceData(l, aoi)
  }
  l.push('</Tag>')
}

/* -------------------------------------------------------------- routines */

function writeRung(l: Lines, rung: Rung, n: number): void {
  l.push(`<Rung Number="${n}" Type="N">`)
  l.comment(rung.comment)
  l.push('<Text>', cdata(rung.text), '</Text>', '</Rung>')
}

function writeRoutine(l: Lines, r: Routine): void {
  l.push(`<Routine${attrs([['Name', r.name], ['Type', r.type]])}>`)
  l.description(r.description)
  l.push('<RLLContent>')
  r.rungs.forEach((rung, i) => writeRung(l, rung, i))
  l.push('</RLLContent>', '</Routine>')
}

/* ------------------------------------------------------------------- AOI */

function writeParameter(l: Lines, p: AoiParameter): void {
  const access = p.usage === 'Output' ? 'Read Only' : 'Read/Write'
  l.push(`<Parameter${attrs([['Name', p.name], ['TagType', 'Base'], ['DataType', p.dataType], ['Usage', p.usage], ['Radix', 'Decimal'], ['Required', p.required], ['Visible', p.visible], ['ExternalAccess', access]])}>`)
  l.description(p.description)
  atomicData(l, 'DefaultData', p.dataType, p.defaultValue)
  l.push('</Parameter>')
}

function writeLocalTag(l: Lines, t: AoiLocalTag): void {
  if (t.dataType === 'TIMER') {
    l.push(`<LocalTag${attrs([['Name', t.name], ['DataType', 'TIMER'], ['ExternalAccess', 'None']])}>`)
    l.description(t.description)
    timerData(l, 'DefaultData', 0, 0)
  } else {
    l.push(`<LocalTag${attrs([['Name', t.name], ['DataType', 'BOOL'], ['Radix', 'Decimal'], ['ExternalAccess', 'None']])}>`)
    l.description(t.description)
    atomicData(l, 'DefaultData', 'BOOL', 0)
  }
  l.push('</LocalTag>')
}

function writeAoi(l: Lines, aoi: AoiDefinition): void {
  l.push(
    `<AddOnInstructionDefinition${attrs([
      ['Name', aoi.name],
      ['Revision', aoi.revision],
      ['ExecutePrescan', false],
      ['ExecutePostscan', false],
      ['ExecuteEnableInFalse', false],
      ['CreatedDate', aoi.createdDate],
      ['CreatedBy', aoi.createdBy],
      ['EditedDate', aoi.editedDate],
      ['EditedBy', aoi.editedBy],
      ['SoftwareRevision', aoi.softwareRevision],
      ['Vendor', aoi.vendor],
    ])}>`,
  )
  l.description(aoi.description)
  l.push('<RevisionNote>', cdata(aoi.revisionNote), '</RevisionNote>')
  l.push('<Parameters>')
  l.push('<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">')
  l.description('Enable Input - System Defined Parameter')
  l.push('</Parameter>')
  l.push('<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">')
  l.description('Enable Output - System Defined Parameter')
  l.push('</Parameter>')
  for (const p of aoi.parameters) writeParameter(l, p)
  l.push('</Parameters>')
  if (aoi.localTags.length === 0) l.push('<LocalTags/>')
  else {
    l.push('<LocalTags>')
    for (const t of aoi.localTags) writeLocalTag(l, t)
    l.push('</LocalTags>')
  }
  l.push('<Routines>')
  for (const r of aoi.routines) writeRoutine(l, r)
  l.push('</Routines>', '</AddOnInstructionDefinition>')
}

/* ------------------------------------------------------- types / modules */

function writeDataType(l: Lines, dt: DataTypeDef): void {
  l.push(`<DataType${attrs([['Name', dt.name], ['Family', 'NoFamily'], ['Class', 'User']])}>`)
  l.description(dt.description)
  l.push('<Members>')
  // Logix packs BOOL members into hidden SINT host members of 8 bits each.
  let bit = 0
  let host = -1
  for (const m of dt.members) {
    if (m.dataType === 'BOOL') {
      if (bit % 8 === 0) {
        host += 1
        l.push(`<Member${attrs([['Name', hostName(dt.name, host)], ['DataType', 'SINT'], ['Dimension', 0], ['Radix', 'Decimal'], ['Hidden', true], ['ExternalAccess', 'Read/Write']])}/>`)
      }
      l.push(
        `<Member${attrs([['Name', m.name], ['DataType', 'BIT'], ['Dimension', 0], ['Radix', 'Decimal'], ['Hidden', false], ['Target', hostName(dt.name, host)], ['BitNumber', bit % 8], ['ExternalAccess', 'Read/Write']])}>`,
      )
      bit += 1
    } else {
      bit = 0
      l.push(`<Member${attrs([['Name', m.name], ['DataType', m.dataType], ['Dimension', 0], ['Radix', m.dataType === 'REAL' ? 'Float' : 'Decimal'], ['Hidden', false], ['ExternalAccess', 'Read/Write']])}>`)
    }
    l.description(m.description)
    l.push('</Member>')
  }
  l.push('</Members>', '</DataType>')
}

function hostName(typeName: string, index: number): string {
  return `ZZZZZZZZZZ${typeName.slice(0, 10)}${index}`
}

function writeLocalModule(l: Lines, c: ControllerModel): void {
  l.push(
    `<Module${attrs([['Name', 'Local'], ['CatalogNumber', c.processorType], ['Vendor', 1], ['ProductType', 14], ['ProductCode', 166], ['Major', c.majorRev], ['Minor', c.minorRev], ['ParentModule', 'Local'], ['ParentModPortId', 1], ['Inhibited', false], ['MajorFault', true]])}>`,
    '<EKey State="Disabled"/>',
    '<Ports>',
    '<Port Id="1" Address="0" Type="ICP" Upstream="false">',
    '<Bus Size="10"/>',
    '</Port>',
    `<Port${attrs([['Id', 2], ['Address', c.ethernetAddress], ['Type', 'Ethernet'], ['Upstream', false]])}>`,
    '<Bus/>',
    '</Port>',
    '</Ports>',
    '</Module>',
  )
}

function writeIoModule(l: Lines, m: IoModule): void {
  l.push(
    `<Module${attrs([['Name', m.name], ['CatalogNumber', m.catalogNumber], ['Vendor', 1], ['ProductType', m.productType], ['ProductCode', m.productCode], ['Major', m.major], ['Minor', m.minor], ['ParentModule', 'Local'], ['ParentModPortId', 1], ['Inhibited', false], ['MajorFault', false]])}>`,
  )
  l.description(m.description)
  l.push('<EKey State="CompatibleModule"/>', '<Ports>', `<Port Id="1" Address="${m.slot}" Type="ICP" Upstream="true"/>`, '</Ports>', '</Module>')
}

/* ------------------------------------------------------ programs / tasks */

function writeProgram(l: Lines, p: Program, aois: Map<string, AoiDefinition>): void {
  l.push(`<Program${attrs([['Name', p.name], ['TestEdits', false], ['MainRoutineName', p.mainRoutine], ['Disabled', false], ['UseAsFolder', false]])}>`)
  l.description(p.description)
  if (p.tags.length === 0) l.push('<Tags/>')
  else {
    l.push('<Tags>')
    for (const t of p.tags) writeTag(l, t, aois)
    l.push('</Tags>')
  }
  l.push('<Routines>')
  for (const r of p.routines) writeRoutine(l, r)
  l.push('</Routines>', '</Program>')
}

function writeTask(l: Lines, t: Task): void {
  const a: Attrs = [['Name', t.name], ['Type', t.type]]
  if (t.rate !== undefined) a.push(['Rate', t.rate])
  a.push(['Priority', t.priority], ['Watchdog', t.watchdog], ['DisableUpdateOutputs', false], ['InhibitTask', false])
  l.push(`<Task${attrs(a)}>`)
  l.description(t.description)
  l.push('<ScheduledPrograms>')
  for (const p of t.programs) l.push(`<ScheduledProgram Name="${escapeAttr(p)}"/>`)
  l.push('</ScheduledPrograms>', '</Task>')
}

/* ------------------------------------------------------------ controller */

export function writeL5X(c: ControllerModel): string {
  const l = new Lines(c.localizedDocumentation === true)
  const aois = new Map(c.aois.map((a) => [a.name, a]))
  l.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  l.push(
    `<RSLogix5000Content${attrs([
      ['SchemaRevision', '1.0'],
      ['SoftwareRevision', c.softwareRevision],
      ['TargetName', c.name],
      ['TargetType', 'Controller'],
      ['ContainsContext', false],
      ['ExportDate', c.exportDate],
      ['ExportOptions', 'NoRawData L5KData DecoratedData ForceProtectedEncoding AllProjDocTrans'],
    ])}>`,
  )
  l.push(
    `<Controller${attrs([
      ['Use', 'Target'],
      ['Name', c.name],
      ['ProcessorType', c.processorType],
      ['MajorRev', c.majorRev],
      ['MinorRev', c.minorRev],
      ['TimeSlice', 20],
      ['ShareUnusedTimeSlice', 1],
      ['ProjectCreationDate', c.projectCreationDate],
      ['LastModifiedDate', c.lastModifiedDate],
      ['SFCExecutionControl', 'CurrentActive'],
      ['SFCRestartPosition', 'MostRecent'],
      ['SFCLastScan', 'DontScan'],
      ['ProjectSN', '16#0000_0000'],
      ['MatchProjectToController', false],
      ['CanUseRPIFromProducer', false],
      ['InhibitAutomaticFirmwareUpdate', 0],
      ['PassThroughConfiguration', 'EnabledWithAppend'],
      ['DownloadProjectDocumentationAndExtendedProperties', true],
      ['DownloadProjectCustomProperties', true],
      ['ReportMinorOverflow', false],
    ])}>`,
  )
  l.description(c.description)
  l.push('<RedundancyInfo Enabled="false" KeepTestEditsOnSwitchOver="false"/>', '<Security Code="0" ChangesToDetect="16#ffff_ffff_ffff_ffff"/>', '<SafetyInfo/>')

  l.push('<DataTypes>')
  for (const dt of c.dataTypes) writeDataType(l, dt)
  l.push('</DataTypes>')

  l.push('<Modules>')
  writeLocalModule(l, c)
  for (const m of c.modules) writeIoModule(l, m)
  l.push('</Modules>')

  l.push('<AddOnInstructionDefinitions>')
  for (const a of c.aois) writeAoi(l, a)
  l.push('</AddOnInstructionDefinitions>')

  l.push('<Tags>')
  for (const t of c.tags) writeTag(l, t, aois)
  l.push('</Tags>')

  l.push('<Programs>')
  for (const p of c.programs) writeProgram(l, p, aois)
  l.push('</Programs>')

  l.push('<Tasks>')
  for (const t of c.tasks) writeTask(l, t)
  l.push('</Tasks>')

  l.push(
    '<CST MasterID="0"/>',
    '<WallClockTime LocalTimeAdjustment="0" TimeZone="0"/>',
    '<Trends/>',
    '<DataLogs/>',
    '<TimeSynchronize Priority1="128" Priority2="128" PTPEnable="false"/>',
    '<EthernetPorts>',
    '<EthernetPort Port="1" Label="1" PortEnabled="true"/>',
    '</EthernetPorts>',
    '</Controller>',
    '</RSLogix5000Content>',
  )
  return l.out.join('\n') + '\n'
}
