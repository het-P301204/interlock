/**
 * A realistic Northgate Pump Station L5X subset (synthetic), shaped like a
 * Logix Designer v35 export: an AOI with parameters and a protected sibling,
 * programs with RLL/ST/FBD routines, a protected routine, alias/AOI-typed/
 * TIMER/ALARM_DIGITAL tags, two tasks and localized descriptions.
 */
export const NORTHGATE_SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.00" TargetName="NORTHGATE_PS" TargetType="Controller" ContainsContext="false" ExportDate="Wed Sep 30 14:12:09 2026" ExportOptions="NoRawData L5KData DecoratedData ForceProtectedEncoding AllProjDocTrans">
<Controller Use="Target" Name="NORTHGATE_PS" ProcessorType="1756-L83E" MajorRev="35" MinorRev="11" TimeSlice="20" ShareUnusedTimeSlice="1" ProjectCreationDate="Mon Feb 12 09:02:11 2024" LastModifiedDate="Wed Sep 30 14:10:52 2026">
<Description>
<LocalizedDescription Lang="de-DE">
<![CDATA[Pumpstation Steuerung]]>
</LocalizedDescription>
<LocalizedDescription Lang="en-US">
<![CDATA[Northgate pump station controller]]>
</LocalizedDescription>
</Description>
<RedundancyInfo Enabled="false" KeepTestEditsOnSwitchOver="false"/>
<Security Code="0" ChangesToDetect="16#ffff_ffff_ffff_ffff"/>
<SafetyInfo/>
<DataTypes>
<DataType Name="UDT_PumpStatus" Family="NoFamily" Class="User">
<Members>
<Member Name="ZZZZZZZZZZUDT_PumpS0" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="Running" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZUDT_PumpS0" BitNumber="0" ExternalAccess="Read/Write"/>
<Member Name="Hours" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read Only"/>
</Members>
</DataType>
</DataTypes>
<Modules>
<Module Name="Local" CatalogNumber="1756-L83E" Vendor="1" ProductType="14" ProductCode="166" Major="35" Minor="11" ParentModule="Local" ParentModPortId="1" Inhibited="false" MajorFault="true"/>
</Modules>
<AddOnInstructionDefinitions>
<AddOnInstructionDefinition Name="AOI_PumpInterlock" Revision="3.4" RevisionExtension="NWA" Vendor="Northgate Water Authority" ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" CreatedDate="2024-02-11T09:12:44.123Z" CreatedBy="NWA\\controls" EditedDate="2026-03-02T10:41:05.880Z" EditedBy="NWA\\controls" SoftwareRevision="v35.00">
<Description>
<![CDATA[Pump protection interlock]]>
</Description>
<RevisionNote>
<![CDATA[3.4 adds ESD_Active input]]>
</RevisionNote>
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>
<![CDATA[Enable Input - System Defined Parameter]]>
</Description>
</Parameter>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>
<![CDATA[Enable Output - System Defined Parameter]]>
</Description>
</Parameter>
<Parameter Name="Run_Request" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">
<Description>
<![CDATA[Operator run request]]>
</Description>
<DefaultData Format="L5K">
<![CDATA[0]]>
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>
</DefaultData>
</Parameter>
<Parameter Name="Level_HH" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">
<Description>
<![CDATA[Wet well level high-high]]>
</Description>
<DefaultData Format="L5K">
<![CDATA[0]]>
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>
</DefaultData>
</Parameter>
<Parameter Name="Press_Trip" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write"/>
<Parameter Name="Motor_Temp_Hi" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write"/>
<Parameter Name="ESD_Active" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write"/>
<Parameter Name="Run_Enable" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read Only"/>
<Parameter Name="Shutdown_Alarm" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="Read Only"/>
</Parameters>
<LocalTags>
<LocalTag Name="Trip" DataType="BOOL" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K">
<![CDATA[0]]>
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>
</DefaultData>
</LocalTag>
</LocalTags>
<Routines>
<Routine Name="Logic" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N">
<Comment>
<![CDATA[Any trip cause latches the pump off]]>
</Comment>
<Text>
<![CDATA[[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ,XIC(ESD_Active) ]OTE(Trip);]]>
</Text>
</Rung>
<Rung Number="1" Type="N">
<Text>
<![CDATA[XIC(Run_Request)XIO(Trip)OTE(Run_Enable);]]>
</Text>
</Rung>
<Rung Number="2" Type="N">
<Text>
<![CDATA[XIC(Trip)OTE(Shutdown_Alarm);]]>
</Text>
</Rung>
</RLLContent>
</Routine>
</Routines>
</AddOnInstructionDefinition>
<EncodedData EncodedType="AddOnInstructionDefinition" Name="AOI_VendorValve" Revision="2.1" Vendor="Acme Valves" EditedDate="2025-01-10T08:00:00.000Z" SignatureID="16#5a1c_9e33" EncryptionConfig="3">
<Description>
<![CDATA[Vendor valve block (source protected)]]>
</Description>
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Required="false" Visible="false" ExternalAccess="Read Only"/>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Required="false" Visible="false" ExternalAccess="Read Only"/>
<Parameter Name="Open_Cmd" TagType="Base" DataType="BOOL" Usage="Input" Required="true" Visible="true" ExternalAccess="Read/Write"/>
<Parameter Name="Is_Open" TagType="Base" DataType="BOOL" Usage="Output" Required="false" Visible="true" ExternalAccess="Read Only"/>
</Parameters>
<![CDATA[UEsDBBQAAAAIAHN0bGVkLnhtbFBLAQIUABQAAAAIAA==]]>
</EncodedData>
</AddOnInstructionDefinitions>
<Tags>
<Tag Name="Pump_01_Run_Enable" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false" ExternalAccess="Read Only">
<Description>
<![CDATA[Pump P-101 run enable to MCC]]>
</Description>
<Data Format="L5K">
<![CDATA[0]]>
</Data>
<Data Format="Decorated">
<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>
</Data>
</Tag>
<Tag Name="Pump_01_Run_Request" TagType="Base" DataType="BOOL" Radix="Decimal">
<Description>
<![CDATA[HMI run request, pump P-101]]>
</Description>
<Data Format="L5K">
<![CDATA[1]]>
</Data>
</Tag>
<Tag Name="LSHH_101" TagType="Alias" Radix="Decimal" AliasFor="Local:3:I.Data.4" ExternalAccess="Read/Write">
<Description>
<![CDATA[Tank T-101 level switch high-high]]>
</Description>
</Tag>
<Tag Name="PUMP_01_IL" TagType="Base" DataType="AOI_PumpInterlock" Constant="false" ExternalAccess="Read/Write">
<Description>
<![CDATA[Interlock instance, pump P-101]]>
</Description>
<Data Format="L5K">
<![CDATA[[1,0]]]>
</Data>
<Data Format="Decorated">
<Structure DataType="AOI_PumpInterlock">
<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>
<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>
</Structure>
</Data>
</Tag>
<Tag Name="C201_LP_Delay" TagType="Base" DataType="TIMER" Constant="false" ExternalAccess="Read/Write">
<Description>
<![CDATA[Compressor C-201 low pressure delay]]>
</Description>
<Data Format="L5K">
<![CDATA[[0,2000,0]]]>
</Data>
<Data Format="Decorated">
<Structure DataType="TIMER">
<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="2000"/>
<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="TT" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
</Structure>
</Data>
</Tag>
<Tag Name="LT101_HH_Alm" TagType="Base" DataType="ALARM_DIGITAL" ExternalAccess="Read/Write">
<Description>
<![CDATA[Tank T-101 high-high level alarm]]>
</Description>
<Data Format="Alarm">
<AlarmDigitalParameters Severity="900" MinDurationPRE="0" ShelveDuration="0" MaxShelveDuration="0" ProgTime="DT#1970-01-01-00:00:00.000_000Z" EnableIn="false" In="false" InFault="false" Condition="true" AckRequired="true" Latched="false" ProgAck="false" OperAck="false" ProgReset="false" OperReset="false" ProgSuppress="false" OperSuppress="false" ProgUnsuppress="false" OperUnsuppress="false" OperShelve="false" ProgUnshelve="false" OperUnshelve="false" ProgDisable="false" OperDisable="false" ProgEnable="false" OperEnable="false" AlarmCountReset="false" UseProgTime="false"/>
<AlarmConfig>
<Messages>
<Message Type="AM">
<Text Lang="en-US">
<![CDATA[Tank T-101 level high-high]]>
</Text>
</Message>
</Messages>
</AlarmConfig>
</Data>
</Tag>
<Tag Name="Flow_Totals" TagType="Base" DataType="REAL" Dimensions="4" Constant="true">
<Description>
<![CDATA[Flow totalizers & daily volumes]]>
</Description>
<Data Format="L5K">
<![CDATA[[0.0,0.0,0.0,0.0]]]>
</Data>
</Tag>
</Tags>
<Programs>
<Program Name="Safety" TestEdits="false" MainRoutineName="Main" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>
<![CDATA[Station protective functions]]>
</Description>
<Tags/>
<Routines>
<Routine Name="Main" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N">
<Text>
<![CDATA[JSR(ESD,0);]]>
</Text>
</Rung>
<Rung Number="1" Type="N">
<Text>
<![CDATA[JSR(Overflow,0);]]>
</Text>
</Rung>
</RLLContent>
</Routine>
<Routine Name="ESD" Type="RLL">
<Description>
<![CDATA[Emergency shutdown]]>
</Description>
<RLLContent>
<Rung Number="0" Type="N">
<Comment>
<LocalizedComment Lang="en-US">
<![CDATA[Healthy chain keeps the MCC enabled]]>
</LocalizedComment>
</Comment>
<Text>
<![CDATA[XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)XIO(Fire_Detected)OTE(MCC_Main_Enable);]]>
</Text>
</Rung>
<Rung Number="1" Type="N">
<Text>
<![CDATA[XIO(MCC_Main_Enable)OTE(ESD_Active);]]>
</Text>
</Rung>
</RLLContent>
</Routine>
<EncodedData EncodedType="Routine" Name="Overflow" Type="RLL" EncryptionConfig="3">
<![CDATA[AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=]]>
</EncodedData>
</Routines>
</Program>
<Program Name="PumpControl" TestEdits="false" MainRoutineName="Main" Disabled="false" UseAsFolder="false">
<Tags>
<Tag Name="Pump_Count" TagType="Base" DataType="DINT" Radix="Decimal" ExternalAccess="Read Only">
<Data Format="Decorated">
<DataValue DataType="DINT" Radix="Decimal" Value="5"/>
</Data>
</Tag>
</Tags>
<Routines>
<Routine Name="Main" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N">
<Text>
<![CDATA[JSR(PUMP_01,0);]]>
</Text>
</Rung>
</RLLContent>
</Routine>
<Routine Name="PUMP_01" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N">
<Text>
<![CDATA[AOI_PumpInterlock(PUMP_01_IL,Pump_01_Run_Request,LSHH_101,Pump_01_Disch_Press_Hi,Pump_01_Motor_Temp_Hi,ESD_Active,Pump_01_Run_Enable);]]>
</Text>
</Rung>
<Rung Number="1" Type="N">
<Text>
<![CDATA[XIC(PUMP_01_IL.Shutdown_Alarm)
OTE(Pump_01_Shutdown_Alarm);]]>
</Text>
</Rung>
</RLLContent>
</Routine>
<Routine Name="Calc" Type="ST">
<STContent>
<Line Number="0">
<![CDATA[Flow_Total := Flow_Total + Flow_PV;]]>
</Line>
<Line Number="1">
<![CDATA[IF Flow_Total > 1.0E6 THEN Flow_Total := 0.0; END_IF;]]>
</Line>
</STContent>
</Routine>
<Routine Name="Blend" Type="FBD">
<FBDContent SheetSize="Letter - 8.5 x 11 in" SheetOrientation="Landscape">
<Sheet Number="1"/>
</FBDContent>
</Routine>
</Routines>
</Program>
<Program Name="Reporting" TestEdits="false" MainRoutineName="Main" Disabled="true" UseAsFolder="false">
<Routines>
<Routine Name="Main" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N">
<Text>
<![CDATA[XIC(Pump_01_Run_Enable)RTO(Pump_01_Hours,3600000,0);]]>
</Text>
</Rung>
</RLLContent>
</Routine>
</Routines>
</Program>
</Programs>
<Tasks>
<Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false">
<ScheduledPrograms>
<ScheduledProgram Name="Safety"/>
<ScheduledProgram Name="PumpControl"/>
</ScheduledPrograms>
</Task>
<Task Name="Slow_100ms" Type="PERIODIC" Rate="100" Priority="12" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false">
<ScheduledPrograms>
<ScheduledProgram Name="Reporting"/>
</ScheduledPrograms>
</Task>
</Tasks>
<CST MasterID="0"/>
<WallClockTime LocalTimeAdjustment="0" TimeZone="0"/>
<Trends/>
<DataLogs/>
<TimeSynchronize Priority1="128" Priority2="128" PTPEnable="false"/>
<EthernetPorts/>
</Controller>
</RSLogix5000Content>
`

/** Replace the first occurrence of `find` in the sample (throws if absent, so tests fail loudly). */
export function variant(find: string, replace: string, base: string = NORTHGATE_SAMPLE): string {
  const at = base.indexOf(find)
  if (at === -1) throw new Error(`variant: ${JSON.stringify(find)} not found`)
  return base.slice(0, at) + replace + base.slice(at + find.length)
}

/**
 * Generate a large, valid L5X: `tagCount` controller tags and one program
 * with `routineCount` routines of `rungsPerRoutine` rungs each.
 */
export function generateLargeL5x(tagCount: number, routineCount: number, rungsPerRoutine: number): string {
  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n')
  parts.push('<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.00" TargetName="BIG" TargetType="Controller" ContainsContext="false" ExportDate="Wed Sep 30 14:12:09 2026">\n')
  parts.push('<Controller Use="Target" Name="BIG" ProcessorType="1756-L83E" MajorRev="35" MinorRev="11">\n<Tags>\n')
  for (let i = 0; i < tagCount; i++) {
    parts.push(
      `<Tag Name="Point_${i}" TagType="Base" DataType="REAL" Radix="Float" Constant="false" ExternalAccess="Read Only">\n` +
        `<Description>\n<![CDATA[Analog point ${i} &amp; flow/level measurement for station area ${i % 97}]]>\n</Description>\n` +
        `<Data Format="L5K">\n<![CDATA[${i}.5]]>\n</Data>\n` +
        `<Data Format="Decorated">\n<DataValue DataType="REAL" Radix="Float" Value="${i}.5"/>\n</Data>\n</Tag>\n`,
    )
  }
  parts.push('</Tags>\n<Programs>\n<Program Name="Bulk" MainRoutineName="R0" Disabled="false">\n<Routines>\n')
  for (let r = 0; r < routineCount; r++) {
    parts.push(`<Routine Name="R${r}" Type="RLL">\n<RLLContent>\n`)
    for (let k = 0; k < rungsPerRoutine; k++) {
      parts.push(
        `<Rung Number="${k}" Type="N">\n<Comment>\n<![CDATA[Rung ${k} of routine ${r}]]>\n</Comment>\n` +
          `<Text>\n<![CDATA[XIC(Point_${k}_Ok)[XIO(Trip_${r}) ,XIC(Bypass_${k}) ]OTE(Out_${r}_${k});]]>\n</Text>\n</Rung>\n`,
      )
    }
    parts.push('</RLLContent>\n</Routine>\n')
  }
  parts.push('</Routines>\n</Program>\n</Programs>\n<Tasks>\n<Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500">\n')
  parts.push('<ScheduledPrograms>\n<ScheduledProgram Name="Bulk"/>\n</ScheduledPrograms>\n</Task>\n</Tasks>\n</Controller>\n</RSLogix5000Content>\n')
  return parts.join('')
}
