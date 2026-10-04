/**
 * NORTHGATE PUMP STATION: a synthetic water-utility lift station.
 *
 * Wet well T-101 is drained by pumps P-101..P-105 (each protected by an
 * AOI_PumpInterlock instance), inlet valve XV-101 closes on high-high level,
 * air compressor C-201 supplies instrument/bubbler air, and MCC-1 carries the
 * pump starters. Northgate Water Authority is fictional; every tag, drawing
 * number and value here is made up for demonstration.
 *
 * `buildPlant(n)` builds the same plant with n pumps; the baseline uses 5 and
 * the large scenario 24. Nothing in this file performs I/O.
 */
import { aoiDate, logixDate } from './dates.ts'
import type { AoiDefinition, ControllerModel, DataTypeDef, ExternalAccess, IoModule, Program, Routine, Rung, TagDef } from './types.ts'

export const CONTROLLER = 'NORTHGATE_PS'
export const VENDOR = 'Northgate Water Authority'

/* ---------------------------------------------------------------- helpers */

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Pump equipment number: 1 -> "P-101", 24 -> "P-124". */
export function pumpNo(n: number): string {
  return `P-${100 + n}`
}

/** MCC cubicle feeding pump n: MCC-1 carries pumps 1..12, MCC-2 the rest. */
export function mccCubicle(n: number): string {
  return n <= 12 ? `MCC-1 cubicle ${n}A` : `MCC-2 cubicle ${n - 12}A`
}

export function boolTag(name: string, description: string, externalAccess: ExternalAccess = 'Read Only', value: 0 | 1 = 0): TagDef {
  return { name, dataType: 'BOOL', description, externalAccess, value: { kind: 'BOOL', value } }
}

export function realTag(name: string, description: string, value: number, externalAccess: ExternalAccess = 'Read Only'): TagDef {
  return { name, dataType: 'REAL', description, externalAccess, value: { kind: 'REAL', value } }
}

export function dintTag(name: string, description: string, value: number, externalAccess: ExternalAccess = 'Read Only'): TagDef {
  return { name, dataType: 'DINT', description, externalAccess, value: { kind: 'DINT', value } }
}

export function timerTag(name: string, description: string, pre: number): TagDef {
  return { name, dataType: 'TIMER', description, externalAccess: 'Read/Write', value: { kind: 'TIMER', pre, acc: 0 } }
}

function alarmTag(name: string, description: string, message: string, severity: number): TagDef {
  return { name, dataType: 'ALARM_DIGITAL', description, externalAccess: 'Read/Write', value: { kind: 'ALARM', severity, message } }
}

function rung(text: string, comment?: string): Rung {
  return comment === undefined ? { text } : { text, comment }
}

/* -------------------------------------------------------------------- AOI */

export function pumpInterlockAoi(): AoiDefinition {
  return {
    name: 'AOI_PumpInterlock',
    revision: '3.4',
    vendor: VENDOR,
    description: 'Wet well pump protection interlock. Any trip cause drops Run_Enable to the MCC starter; Shutdown_Alarm follows the trip for HMI annunciation. Standard NWA pump block, do not edit at site level.',
    revisionNote: '3.4 adds ESD_Active input so a station ESD trips every pump through the block (MOC-2024-017).',
    createdDate: aoiDate(2019, 4, 8, 13, 20, 41, 517),
    createdBy: 'NWA\\controls',
    editedDate: aoiDate(2026, 3, 2, 10, 41, 5, 880),
    editedBy: 'NWA\\controls',
    softwareRevision: 'v35.00',
    parameters: [
      { name: 'Run_Request', usage: 'Input', dataType: 'BOOL', required: true, visible: true, description: 'Run request from lead/lag sequencer or HMI hand start', defaultValue: 0 },
      { name: 'Level_HH', usage: 'Input', dataType: 'BOOL', required: true, visible: true, description: 'Wet well level high-high (trip)', defaultValue: 0 },
      { name: 'Press_Trip', usage: 'Input', dataType: 'BOOL', required: true, visible: true, description: 'Pressure trip: discharge high or suction low, per pump (trip)', defaultValue: 0 },
      { name: 'Motor_Temp_Hi', usage: 'Input', dataType: 'BOOL', required: true, visible: true, description: 'Motor winding over-temperature relay (trip)', defaultValue: 0 },
      { name: 'ESD_Active', usage: 'Input', dataType: 'BOOL', required: true, visible: true, description: 'Station emergency shutdown active (trip)', defaultValue: 0 },
      { name: 'Run_Enable', usage: 'Output', dataType: 'BOOL', required: true, visible: true, description: 'Run enable to MCC starter. 0 = pump stopped/blocked', defaultValue: 0 },
      { name: 'Shutdown_Alarm', usage: 'Output', dataType: 'BOOL', required: false, visible: true, description: 'Protective shutdown alarm to HMI', defaultValue: 0 },
    ],
    localTags: [{ name: 'Trip', dataType: 'BOOL', description: 'Any trip cause present' }],
    routines: [
      {
        name: 'Logic',
        type: 'RLL',
        rungs: [
          rung('[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ,XIC(ESD_Active) ]OTE(Trip);', 'Any trip cause sets Trip. Non-latching: the MCC starter drops out and the sequencer must re-request once the cause clears.'),
          rung('XIC(Run_Request)XIO(Trip)OTE(Run_Enable);', 'Run enable: requested and no trip present.'),
          rung('XIC(Trip)OTE(Shutdown_Alarm);', 'Shutdown alarm follows the trip.'),
        ],
      },
    ],
  }
}

/** Valve control block that only the legacy Site C library carries. */
export function valveCtlAoi(): AoiDefinition {
  return {
    name: 'AOI_ValveCtl',
    revision: '1.0',
    vendor: VENDOR,
    description: 'Two-position valve control with travel-time fault. Legacy Riverbend library block.',
    revisionNote: '1.0 initial release.',
    createdDate: aoiDate(2021, 6, 14, 13, 2, 51, 407),
    createdBy: 'RIVERBEND-EWS\\integrator',
    editedDate: aoiDate(2021, 6, 14, 15, 30, 12, 66),
    editedBy: 'RIVERBEND-EWS\\integrator',
    softwareRevision: 'v33.01',
    parameters: [
      { name: 'Open_Cmd', usage: 'Input', dataType: 'BOOL', required: true, visible: true, description: 'Open command', defaultValue: 0 },
      { name: 'Close_Cmd', usage: 'Input', dataType: 'BOOL', required: true, visible: true, description: 'Close command (overrides open)', defaultValue: 0 },
      { name: 'ZSO', usage: 'Input', dataType: 'BOOL', required: true, visible: true, description: 'Open limit switch', defaultValue: 0 },
      { name: 'ZSC', usage: 'Input', dataType: 'BOOL', required: true, visible: true, description: 'Closed limit switch', defaultValue: 0 },
      { name: 'Open_Out', usage: 'Output', dataType: 'BOOL', required: true, visible: true, description: 'Solenoid output, 1 = open', defaultValue: 0 },
      { name: 'Fault', usage: 'Output', dataType: 'BOOL', required: false, visible: true, description: 'Valve failed to reach position in 15 s', defaultValue: 0 },
    ],
    localTags: [{ name: 'Travel_Tmr', dataType: 'TIMER', description: 'Travel time supervision' }],
    routines: [
      {
        name: 'Logic',
        type: 'RLL',
        rungs: [
          rung('XIC(Open_Cmd)XIO(Close_Cmd)OTE(Open_Out);', 'Open while commanded; close command wins.'),
          rung('[XIC(Open_Out)XIO(ZSO) ,XIO(Open_Out)XIO(ZSC) ]TON(Travel_Tmr,15000,0);', 'Time the stroke in either direction.'),
          rung('XIC(Travel_Tmr.DN)OTE(Fault);', 'Stroke not completed in time.'),
        ],
      },
    ],
  }
}

/* ------------------------------------------------------------------- pumps */

/** The pressure trip input wired to pump n's AOI. P-103 is the only pump with a suction low trip. */
export function pumpPressTag(n: number): string {
  return n === 3 ? 'Pump_03_Suction_Low' : `Pump_${pad2(n)}_Disch_Press_Hi`
}

export function pumpCallText(n: number, withEsd = true): string {
  const nn = pad2(n)
  const args = [`PUMP_${nn}_IL`, `Pump_${nn}_Run_Request`, 'LSHH_101', pumpPressTag(n), `Pump_${nn}_Motor_Temp_Hi`]
  if (withEsd) args.push('ESD_Active')
  args.push(`Pump_${nn}_Run_Enable`)
  return `AOI_PumpInterlock(${args.join(',')});`
}

export function pumpRoutine(n: number): Routine {
  const nn = pad2(n)
  const p = pumpNo(n)
  const pressCause = n === 3 ? `suction pressure low (PSL-${100 + n})` : `discharge pressure high (PSH-${100 + n})`
  return {
    name: `PUMP_${nn}`,
    type: 'RLL',
    description: `${p} wet well pump control`,
    rungs: [
      rung(pumpCallText(n), `${p} protection interlock. Trips on LSHH-101, ${pressCause}, motor over-temperature (TSH-${100 + n}) or station ESD. Run enable hardwired to ${mccCubicle(n)}.`),
      rung(`XIC(PUMP_${nn}_IL.Shutdown_Alarm)OTE(Pump_${nn}_Shutdown_Alarm);`, `${p} protective shutdown alarm to HMI alarm summary.`),
    ],
  }
}

export function pumpTags(n: number): TagDef[] {
  const nn = pad2(n)
  const p = pumpNo(n)
  const running = n <= 2 ? 1 : 0
  const press =
    n === 3
      ? boolTag('Pump_03_Suction_Low', 'P-103 suction pressure low, PSL-103 (1 = low, trip)')
      : boolTag(`Pump_${nn}_Disch_Press_Hi`, `${p} discharge pressure high, PSH-${100 + n} (1 = high, trip)`)
  return [
    boolTag(`Pump_${nn}_Run_Request`, `${p} run request from lead/lag sequencer or HMI hand start`, 'Read/Write', running),
    press,
    boolTag(`Pump_${nn}_Motor_Temp_Hi`, `${p} motor winding over-temperature relay TSH-${100 + n} (1 = hot, trip)`),
    boolTag(`Pump_${nn}_Run_Enable`, `${p} run enable to ${mccCubicle(n)} (de-energize to stop)`, 'Read Only', running),
    boolTag(`Pump_${nn}_Shutdown_Alarm`, `${p} protective shutdown alarm to HMI`),
    { name: `PUMP_${nn}_IL`, dataType: 'AOI_PumpInterlock', description: `${p} protection interlock instance`, externalAccess: 'Read/Write', value: { kind: 'AOI' } },
  ]
}

/* -------------------------------------------------------------- programs */

function safetyProgram(): Program {
  return {
    name: 'Safety',
    description: 'Station protective functions: ESD, T-101 overflow protection, pump start permissive. Any change requires MOC and functional test per NWA-ENG-014.',
    mainRoutine: 'Main',
    tags: [],
    routines: [
      {
        name: 'Main',
        type: 'RLL',
        description: 'Protective function dispatcher',
        rungs: [
          rung('JSR(ESD,0);', 'Emergency shutdown chain.'),
          rung('JSR(Overflow,0);', 'Wet well T-101 overflow protection.'),
          rung('JSR(Permissives,0);', 'Station pump start permissive.'),
        ],
      },
      {
        name: 'ESD',
        type: 'RLL',
        description: 'Emergency shutdown (SF-01)',
        rungs: [
          rung('XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)XIO(Fire_Detected)OTE(MCC_Main_Enable);', 'MCC-1 main enable. Drops on loss of the E-stop loop (ES-1..ES-4 via SR-1), remote ESD from the gatehouse, or fire panel FACP-1 alarm. De-energize to trip.'),
          rung('XIO(MCC_Main_Enable)OTE(ESD_Active);', 'ESD active status to every pump interlock and to SCADA.'),
        ],
      },
      {
        name: 'Overflow',
        type: 'RLL',
        description: 'T-101 overflow protection (SF-05)',
        rungs: [rung('XIC(LSHH_101)OTE(XV101_Close_Cmd);', 'LSHH-101 closes inlet valve XV-101 (energize to close). Hardwired float, independent of the LT-101 transmitter.')],
      },
      {
        name: 'Permissives',
        type: 'RLL',
        description: 'Pump start permissive (SF-08)',
        rungs: [
          rung('XIC(MCC_Main_Enable)XIO(LSHH_101)GRT(Suction_Press_PV,12.0)OTE(Pump_Start_Permissive);', 'Pumps may start only with MCC-1 enabled, wet well below high-high, and suction header above 12 psig (NPSH margin).'),
        ],
      },
    ],
  }
}

function pumpControlProgram(pumps: number): Program {
  const jsr: Rung[] = []
  const routines: Routine[] = []
  for (let n = 1; n <= pumps; n++) {
    jsr.push(rung(`JSR(PUMP_${pad2(n)},0);`, `${pumpNo(n)} interlock and control.`))
    routines.push(pumpRoutine(n))
  }
  return {
    name: 'PumpControl',
    description: `Wet well pumps ${pumpNo(1)} to ${pumpNo(pumps)}: one AOI_PumpInterlock instance per pump, run enable to the MCC.`,
    mainRoutine: 'Main',
    tags: [],
    routines: [{ name: 'Main', type: 'RLL', description: 'Pump routine dispatcher', rungs: jsr }, ...routines],
  }
}

function compressorProgram(): Program {
  return {
    name: 'Compressor',
    description: 'Air compressor C-201 (bubbler and instrument air): high pressure shutdown, low suction trip.',
    mainRoutine: 'Main',
    tags: [],
    routines: [
      {
        name: 'Main',
        type: 'RLL',
        description: 'C-201 control and protection (SF-06)',
        rungs: [
          rung('XIC(PT201_High)XIC(Safety_Enable)OTE(C201_Shutdown_Cmd);', 'C-201 high pressure shutdown. PSH-201 trips the compressor while station safety functions are armed.'),
          rung('XIC(C201_Run_Cmd)XIO(C201_Shutdown_Cmd)OTE(C201_Motor_Run);', 'C-201 motor run: operator run command, blocked while the shutdown is active.'),
          rung('LES(C201_Suction_PV,3.5)TON(C201_LP_Delay,2000,0);', 'Low suction pressure: 2 s filter on PT-201S below 3.5 psig.'),
          rung('XIC(C201_LP_Delay.DN)OTE(C201_Low_Press_Trip);', 'C-201 low suction trip after delay.'),
        ],
      },
    ],
  }
}

function alarmsProgram(): Program {
  return {
    name: 'Alarms',
    description: 'Annunciation to the HMI alarm summary and the control room horn.',
    mainRoutine: 'Main',
    tags: [],
    routines: [
      {
        name: 'Main',
        type: 'RLL',
        description: 'Station alarms (SF-07)',
        rungs: [
          rung('XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,0,0);', 'T-101 high-high level alarm from LSHH-101 to HMI alarm summary, severity 900 (urgent).'),
          rung('XIC(C201_Shutdown_Cmd)ALMD(C201_Shutdown_Alm,0,0,0,0);', 'C-201 high pressure shutdown alarm.'),
          rung('XIO(MCC_Main_Enable)OTE(ESD_Trip_Horn);', 'Control room horn and beacon AH-1 while MCC-1 is tripped.'),
        ],
      },
    ],
  }
}

function auxiliaryProgram(): Program {
  return {
    name: 'Auxiliary',
    description: 'Station auxiliaries: P-104 seal water, drywell sump.',
    mainRoutine: 'Main',
    tags: [],
    routines: [
      {
        name: 'Main',
        type: 'RLL',
        description: 'Auxiliaries dispatcher',
        rungs: [rung('JSR(SealWater,0);', 'P-104 seal water.'), rung('JSR(Sump,0);', 'Drywell sump.')],
      },
      {
        name: 'SealWater',
        type: 'RLL',
        description: 'P-104 seal water supply',
        rungs: [rung('XIC(Pump_04_Run_Enable)XIO(Seal_Water_Low)OTE(Seal_Water_Valve_Open);', 'Seal water solenoid SV-104 opens while P-104 runs. Held closed on seal water tank low level (LSL-104) so the booster does not run dry.')],
      },
      {
        name: 'Sump',
        type: 'RLL',
        description: 'Drywell sump pump SP-1',
        rungs: [rung('XIC(Sump_Level_Hi)OTE(Sump_Pump_Run);', 'Drywell sump pump SP-1 runs on sump high level LSH-120.')],
      },
    ],
  }
}

function utilitiesProgram(): Program {
  return {
    name: 'Utilities',
    description: 'Building services: lighting and HVAC. Declared non-safety.',
    mainRoutine: 'Main',
    tags: [{ name: 'Lamp_Test', dataType: 'BOOL', description: 'Control panel CP-1 lamp test pushbutton', externalAccess: 'Read/Write', value: { kind: 'BOOL', value: 0 } }],
    routines: [
      {
        name: 'Main',
        type: 'RLL',
        description: 'Building services dispatcher',
        rungs: [rung('JSR(Lighting,0);', 'Panel and yard lighting.'), rung('JSR(HVAC,0);', 'Pump room ventilation.')],
      },
      {
        name: 'Lighting',
        type: 'RLL',
        description: 'Panel and yard lighting',
        rungs: [rung('XIC(Maintenance_Mode)OTE(Panel_Light_Maint);', 'Maintenance mode lamp on CP-1.'), rung('XIC(Dusk_Sensor)OTE(Yard_Lights);', 'Yard lights on photocell PE-1.')],
      },
      {
        name: 'HVAC',
        type: 'RLL',
        description: 'Pump room ventilation',
        rungs: [rung('XIC(Building_Temp_Hi)OTE(Exhaust_Fan_Run);', 'Exhaust fan EF-1 on pump room high temperature.')],
      },
    ],
  }
}

function reportingProgram(): Program {
  return {
    name: 'Reporting',
    description: 'Run hours for the SCADA historian. Declared non-safety.',
    mainRoutine: 'Main',
    tags: [],
    routines: [
      {
        name: 'Main',
        type: 'RLL',
        description: 'Run-hour accumulation',
        rungs: [
          rung('XIC(Pump_01_Run_Enable)RTO(Pump_01_Hours,3600000,0);', 'P-101 run hours (RTO, 1 h base, rolled over by historian).'),
          rung('XIC(Pump_02_Run_Enable)RTO(Pump_02_Hours,3600000,0);', 'P-102 run hours (RTO, 1 h base, rolled over by historian).'),
        ],
      },
    ],
  }
}

/* ------------------------------------------------------------------ tags */

function stationTags(pumps: number): TagDef[] {
  const tags: TagDef[] = [
    boolTag('EStop_Healthy', 'E-stop loop healthy: ES-1 to ES-4 in series through safety relay SR-1 (1 = healthy)', 'Read Only', 1),
    boolTag('ESD_Remote_Cmd', 'Remote ESD pushbutton at gatehouse, hardwired (1 = ESD demanded)'),
    boolTag('Fire_Detected', 'Fire alarm panel FACP-1 general alarm relay (1 = fire)'),
    { name: 'LSHH_101', dataType: 'BOOL', aliasFor: 'Local:3:I.Data.4', description: 'T-101 wet well level high-high float LSHH-101 (1 = high-high)', externalAccess: 'Read Only' },
    realTag('LT101_PV', 'T-101 wet well level LT-101 (% of span)', 41.7),
    realTag('Suction_Press_PV', 'Pump suction header pressure PT-110 (psig)', 18.4),
    boolTag('MCC_Main_Enable', 'MCC-1 main enable (de-energize to trip every pump starter)', 'Read Only', 1),
    boolTag('ESD_Active', 'Station ESD active, to pump interlocks and SCADA'),
    boolTag('XV101_Close_Cmd', 'XV-101 wet well inlet valve close command (energize to close)'),
    boolTag('Pump_Start_Permissive', 'Station pump start permissive to lead/lag sequencer', 'Read Only', 1),
    boolTag('Maintenance_Mode', 'Station maintenance mode selected at HMI', 'Read/Write'),
    boolTag('Safety_Enable', 'Station safety functions armed (HMI, supervisor level)', 'Read/Write', 1),
  ]
  for (let n = 1; n <= pumps; n++) tags.push(...pumpTags(n))
  tags.push(
    boolTag('PT201_High', 'C-201 receiver pressure high PSH-201, set 125 psig (1 = high)'),
    boolTag('C201_Run_Cmd', 'C-201 run command from HMI', 'Read/Write', 1),
    realTag('C201_Suction_PV', 'C-201 suction pressure PT-201S (psig)', 5.2),
    boolTag('C201_Shutdown_Cmd', 'C-201 high pressure shutdown command (energize to trip)'),
    boolTag('C201_Motor_Run', 'C-201 motor run output to starter M-201', 'Read Only', 1),
    timerTag('C201_LP_Delay', 'C-201 low suction pressure trip delay', 2000),
    boolTag('C201_Low_Press_Trip', 'C-201 low suction pressure trip'),
    alarmTag('LT101_HH_Alm', 'T-101 high-high level alarm (HMI alarm summary)', 'Tank T-101 level high-high', 900),
    alarmTag('C201_Shutdown_Alm', 'C-201 high pressure shutdown alarm (HMI alarm summary)', 'Compressor C-201 high pressure shutdown', 800),
    boolTag('ESD_Trip_Horn', 'Control room ESD horn and beacon AH-1'),
    boolTag('Seal_Water_Low', 'Seal water tank low level LSL-104 (1 = low)'),
    boolTag('Seal_Water_Valve_Open', 'Seal water solenoid SV-104 open command (P-104)'),
    boolTag('Sump_Level_Hi', 'Drywell sump high level LSH-120'),
    boolTag('Sump_Pump_Run', 'Drywell sump pump SP-1 run'),
    boolTag('Dusk_Sensor', 'Yard photocell PE-1 (1 = dark)'),
    boolTag('Building_Temp_Hi', 'Pump room temperature high TSH-130'),
    boolTag('Panel_Light_Maint', 'Maintenance mode lamp on control panel CP-1'),
    boolTag('Yard_Lights', 'Yard lighting contactor LC-1'),
    boolTag('Exhaust_Fan_Run', 'Pump room exhaust fan EF-1 run'),
    timerTag('Pump_01_Hours', 'P-101 run-hour accumulator (RTO, 1 h base)', 3600000),
    timerTag('Pump_02_Hours', 'P-102 run-hour accumulator (RTO, 1 h base)', 3600000),
  )
  return tags
}

function dataTypes(): DataTypeDef[] {
  return [
    {
      name: 'UDT_PumpStatus',
      description: 'Pump status block for SCADA polling (reserved, not yet mapped)',
      members: [
        { name: 'Running', dataType: 'BOOL', description: 'Run feedback from starter auxiliary contact' },
        { name: 'Faulted', dataType: 'BOOL', description: 'Any protective trip' },
        { name: 'In_Auto', dataType: 'BOOL', description: 'HOA switch in AUTO' },
        { name: 'Run_Hours', dataType: 'REAL', description: 'Accumulated run hours' },
        { name: 'Starts', dataType: 'DINT', description: 'Starts since midnight' },
      ],
    },
  ]
}

function ioModules(): IoModule[] {
  return [
    { name: 'DI_Slot3', catalogNumber: '1756-IB16/A', productType: 7, productCode: 10, major: 3, minor: 1, slot: 3, description: 'Station discrete inputs: wet well floats, pressure switches, fire panel relay' },
    { name: 'AI_Slot5', catalogNumber: '1756-IF8/A', productType: 10, productCode: 9, major: 1, minor: 3, slot: 5, description: 'Analog inputs: LT-101, PT-110, PT-201S' },
    { name: 'DO_Slot7', catalogNumber: '1756-OB16E/A', productType: 7, productCode: 20, major: 3, minor: 1, slot: 7, description: 'Discrete outputs: MCC run enables, XV-101, SV-104, horn' },
  ]
}

/* ------------------------------------------------------------ the plant */

export interface PlantOptions {
  pumps: number
}

export function buildPlant(options: PlantOptions = { pumps: 5 }): ControllerModel {
  const pumps = options.pumps
  return {
    name: CONTROLLER,
    description: 'Northgate Pump Station PLC-1, wet well lift station. SYNTHETIC DEMONSTRATION PROJECT: fictional utility, no real site or equipment.',
    processorType: '1756-L83E',
    majorRev: 35,
    minorRev: 11,
    softwareRevision: '35.00',
    projectCreationDate: logixDate(2024, 2, 12, 9, 2, 11),
    lastModifiedDate: logixDate(2026, 3, 2, 11, 3, 27),
    exportDate: logixDate(2026, 3, 9, 8, 41, 17),
    ethernetAddress: '192.168.10.10',
    dataTypes: dataTypes(),
    modules: ioModules(),
    aois: [pumpInterlockAoi()],
    tags: stationTags(pumps),
    programs: [safetyProgram(), pumpControlProgram(pumps), compressorProgram(), alarmsProgram(), auxiliaryProgram(), utilitiesProgram(), reportingProgram()],
    tasks: [
      {
        name: 'MainTask',
        type: 'CONTINUOUS',
        priority: 10,
        watchdog: 500,
        description: 'Continuous scan: protective functions first, then pumps, compressor, alarms and station services.',
        programs: ['Safety', 'PumpControl', 'Compressor', 'Alarms', 'Auxiliary', 'Utilities'],
      },
      { name: 'Slow_100ms', type: 'PERIODIC', rate: 100, priority: 12, watchdog: 500, description: '100 ms periodic: run hours and totals for the SCADA historian.', programs: ['Reporting'] },
    ],
  }
}
