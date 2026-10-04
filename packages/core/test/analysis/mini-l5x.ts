/**
 * A tiny L5X builder for unit tests: one controller, one continuous task,
 * one program "P" whose Main routine JSRs nothing unless told to. Enough to
 * exercise scan semantics without the full fixture plant.
 */
export interface MiniTag {
  name: string
  type?: string
  alias?: string
  access?: 'Read/Write' | 'Read Only' | 'None'
}

export interface MiniAoi {
  name: string
  params: Array<{ name: string; usage: 'Input' | 'Output'; required?: boolean }>
  locals?: string[]
  rungs: string[]
}

export interface MiniProject {
  tags: MiniTag[]
  routines: Record<string, string[]>
  aois?: MiniAoi[]
  programDisabled?: boolean
  taskInhibited?: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export function miniL5x(p: MiniProject): string {
  const aois = (p.aois ?? [])
    .map(
      (a) => `<AddOnInstructionDefinition Name="${a.name}" Revision="1.0">
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Required="false" Visible="false" ExternalAccess="Read Only"/>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Required="false" Visible="false" ExternalAccess="Read Only"/>
${a.params.map((x) => `<Parameter Name="${x.name}" TagType="Base" DataType="BOOL" Usage="${x.usage}" Required="${x.required === false ? 'false' : 'true'}" Visible="true" ExternalAccess="Read/Write"/>`).join('\n')}
</Parameters>
<LocalTags>${(a.locals ?? []).map((l) => `<LocalTag Name="${l}" DataType="BOOL" ExternalAccess="None"/>`).join('')}</LocalTags>
<Routines><Routine Name="Logic" Type="RLL"><RLLContent>
${a.rungs.map((r, i) => `<Rung Number="${i}" Type="N"><Text><![CDATA[${r}]]></Text></Rung>`).join('\n')}
</RLLContent></Routine></Routines>
</AddOnInstructionDefinition>`,
    )
    .join('\n')
  const tags = p.tags
    .map((t) =>
      t.alias
        ? `<Tag Name="${t.name}" TagType="Alias" AliasFor="${esc(t.alias)}" ExternalAccess="${t.access ?? 'Read/Write'}"/>`
        : `<Tag Name="${t.name}" TagType="Base" DataType="${t.type ?? 'BOOL'}" Constant="false" ExternalAccess="${t.access ?? 'Read/Write'}"/>`,
    )
    .join('\n')
  const routines = Object.entries(p.routines)
    .map(
      ([name, rungs]) => `<Routine Name="${name}" Type="RLL"><RLLContent>
${rungs.map((r, i) => `<Rung Number="${i}" Type="N"><Text><![CDATA[${r}]]></Text></Rung>`).join('\n')}
</RLLContent></Routine>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.00" TargetName="T" TargetType="Controller" ContainsContext="false" ExportDate="Sun Oct 04 10:00:00 2026">
<Controller Use="Target" Name="T" ProcessorType="1756-L83E" MajorRev="35" MinorRev="11">
<DataTypes/>
<AddOnInstructionDefinitions>${aois}</AddOnInstructionDefinitions>
<Tags>
${tags}
</Tags>
<Programs>
<Program Name="P" MainRoutineName="Main" Disabled="${p.programDisabled ? 'true' : 'false'}">
<Tags/>
<Routines>
${routines}
</Routines>
</Program>
</Programs>
<Tasks>
<Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="${p.taskInhibited ? 'true' : 'false'}">
<ScheduledPrograms><ScheduledProgram Name="P"/></ScheduledPrograms>
</Task>
</Tasks>
</Controller>
</RSLogix5000Content>
`
}

export const bytes = (s: string, name = 'p.L5X') => ({ name, bytes: new TextEncoder().encode(s) })
