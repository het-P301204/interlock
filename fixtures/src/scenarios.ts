/**
 * Scenario variants of the Northgate baseline. Each function clones the
 * baseline model and applies exactly the edits the scenario describes, plus
 * the export/last-modified date bump a real re-export carries. Pure.
 */
import { aoiDate, logixDate } from './dates.ts'
import { addTag, aoi, clone, deleteRung, program, routine, setRungComment, setRungText, setTagDescription, setTimerPreset, stamp, tag } from './edit.ts'
import { boolTag, buildPlant, mccCubicle, pad2, pumpCallText, pumpNo, valveCtlAoi } from './plant.ts'
import type { ControllerModel } from './types.ts'

export const ESD_RUNG = 'XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)XIO(Fire_Detected)OTE(MCC_Main_Enable);'
export const ESD_RUNG_REORDERED = 'XIO(Fire_Detected)XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)OTE(MCC_Main_Enable);'
export const PERMISSIVE_RUNG = 'XIC(MCC_Main_Enable)XIO(LSHH_101)GRT(Suction_Press_PV,12.0)OTE(Pump_Start_Permissive);'
export const COMPRESSOR_SHUTDOWN_RUNG = 'XIC(PT201_High)XIC(Safety_Enable)OTE(C201_Shutdown_Cmd);'
export const COMPRESSOR_LP_RUNG = 'LES(C201_Suction_PV,3.5)TON(C201_LP_Delay,2000,0);'
export const AOI_TRIP_RUNG = '[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ,XIC(ESD_Active) ]OTE(Trip);'

export function baseline(): ControllerModel {
  return buildPlant({ pumps: 5 })
}

/** 01: documentation, two non-safety logic edits, one equivalent reorder, one strengthening. */
export function currentNormal(base: ControllerModel = baseline()): ControllerModel {
  const m = clone(base)
  stamp(m, logixDate(2026, 9, 30, 14, 10, 52), logixDate(2026, 9, 30, 14, 12, 9))

  // Documentation: 4 rung comments, 6 tag descriptions.
  setRungComment(m, 'Safety', 'ESD', 1, 'ESD active status to every pump interlock (AOI ESD_Active input) and to SCADA point DI-ESD-01.')
  setRungComment(m, 'Safety', 'Permissives', 0, 'Pumps may start only with MCC-1 enabled, wet well below high-high, and suction header above 12 psig. 12 psig gives 4 ft NPSH margin at rated flow (calc NG-C-031).')
  setRungComment(m, 'Alarms', 'Main', 2, 'Control room horn and beacon AH-1 while MCC-1 is tripped. Silence is at the horn panel, not in logic.')
  setRungComment(m, 'Utilities', 'HVAC', 0, 'Exhaust fan EF-1 on pump room high temperature TSH-130 (set 95 degF).')
  setTagDescription(m, 'EStop_Healthy', 'E-stop loop healthy: ES-1 to ES-5 in series through safety relay SR-1 (1 = healthy). ES-5 added at the new chemical room door.')
  setTagDescription(m, 'Suction_Press_PV', 'Pump suction header pressure PT-110, 0-60 psig')
  setTagDescription(m, 'Pump_05_Motor_Temp_Hi', 'P-105 motor winding thermistor relay TSH-105 (1 = hot, trip)')
  setTagDescription(m, 'Dusk_Sensor', 'Yard photocell PE-1 on light pole LP-2 (1 = dark)')
  setTagDescription(m, 'Yard_Lights', 'Yard and gate lighting contactor LC-1')
  setTagDescription(m, 'Exhaust_Fan_Run', 'Pump room exhaust fan EF-1 run command to VFD-EF1')

  // Non-safety logic.
  setRungText(m, 'Utilities', 'Lighting', 1, 'XIC(Dusk_Sensor)OTE(Yard_Lights);', 'XIC(Dusk_Sensor)XIO(Lamp_Test)OTE(Yard_Lights);')
  setRungText(m, 'Reporting', 'Main', 0, 'XIC(Pump_01_Run_Enable)RTO(Pump_01_Hours,3600000,0);', 'XIC(Pump_01_Run_Enable)RTO(Pump_01_Hours,1800000,0);')
  // The preset in the instruction and the timer's stored PRE are the same value in Logix.
  setTimerPreset(m, 'Pump_01_Hours', 3600000, 1800000)

  // Safety logic: equivalent reorder and a strengthening.
  setRungText(m, 'Safety', 'ESD', 0, ESD_RUNG, ESD_RUNG_REORDERED)
  setRungText(m, 'Safety', 'Overflow', 0, 'XIC(LSHH_101)OTE(XV101_Close_Cmd);', '[XIC(LSHH_101) ,GRT(LT101_PV,92.0) ]OTE(XV101_Close_Cmd);')
  return m
}

/** 02: maintenance mode now defeats the C-201 high pressure shutdown. */
export function currentShutdownWeakened(base: ControllerModel = baseline()): ControllerModel {
  const m = clone(base)
  stamp(m, logixDate(2026, 9, 28, 16, 44, 3), logixDate(2026, 9, 28, 16, 47, 30))
  setRungText(m, 'Compressor', 'Main', 0, COMPRESSOR_SHUTDOWN_RUNG, 'XIC(PT201_High)XIC(Safety_Enable)XIO(Maintenance_Mode)OTE(C201_Shutdown_Cmd);')
  return m
}

/** 03: an HMI-writable inhibit disables the T-101 high-high alarm. */
export function currentAlarmSuppressed(base: ControllerModel = baseline()): ControllerModel {
  const m = clone(base)
  stamp(m, logixDate(2026, 9, 21, 10, 15, 48), logixDate(2026, 9, 21, 10, 18, 2))
  addTag(m, boolTag('High_Level_Inhibit', 'Nuisance alarm inhibit (temporary)', 'Read/Write'))
  setRungText(m, 'Alarms', 'Main', 0, 'XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,0,0);', 'XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,High_Level_Inhibit,0);')
  return m
}

/** 04: AOI_PumpInterlock 3.5 adds an optional Maint_Bypass input that defeats every trip. */
export function currentAoiModified(base: ControllerModel = baseline()): ControllerModel {
  const m = clone(base)
  stamp(m, logixDate(2026, 9, 24, 9, 31, 40), logixDate(2026, 9, 24, 9, 35, 12))
  const a = aoi(m, 'AOI_PumpInterlock')
  a.revision = '3.5'
  a.revisionNote = '3.5 adds Maint_Bypass input for commissioning runs; set from the pump faceplate. 3.4 added ESD_Active (MOC-2024-017).'
  a.editedDate = aoiDate(2026, 9, 24, 9, 22, 18, 604)
  a.parameters.push({ name: 'Maint_Bypass', usage: 'Input', dataType: 'BOOL', required: false, visible: true, description: 'Maintenance bypass for commissioning runs', defaultValue: 0 })
  setRungText(m, 'AOI_PumpInterlock', 'Logic', 0, AOI_TRIP_RUNG, '[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ,XIC(ESD_Active) ]XIO(Maint_Bypass)OTE(Trip);')
  return m
}

/** 05: a commissioning routine in the non-safety Utilities program latches P-101's run enable. */
export function currentProtectiveBypass(base: ControllerModel = baseline()): ControllerModel {
  const m = clone(base)
  stamp(m, logixDate(2026, 9, 26, 15, 2, 37), logixDate(2026, 9, 26, 15, 5, 51))
  addTag(m, boolTag('Pump_01_Manual_Override', 'P-101 manual run override for drawdown test (HMI)', 'Read/Write'))
  const u = program(m, 'Utilities')
  u.routines.push({
    name: 'Commissioning',
    type: 'RLL',
    description: 'Temporary commissioning aids',
    rungs: [{ text: 'XIC(Pump_01_Manual_Override)OTL(Pump_01_Run_Enable);', comment: 'Drawdown test: hold P-101 run enable on from the HMI. Remove after SAT.' }],
  })
  routine(m, 'Utilities', 'Main').rungs.push({ text: 'JSR(Commissioning,0);', comment: 'Commissioning aids (temporary).' })
  return m
}

/** 06: changes in logic no safety function declares. */
export function currentUndeclaredChange(base: ControllerModel = baseline()): ControllerModel {
  const m = clone(base)
  stamp(m, logixDate(2026, 9, 29, 11, 26, 9), logixDate(2026, 9, 29, 11, 28, 44))
  setRungText(m, 'Auxiliary', 'SealWater', 0, 'XIC(Pump_04_Run_Enable)XIO(Seal_Water_Low)OTE(Seal_Water_Valve_Open);', 'XIC(Pump_04_Run_Enable)OTE(Seal_Water_Valve_Open);')
  addTag(m, boolTag('Sump_Pump_Fault', 'Drywell sump pump SP-1 overload relay (1 = fault)'))
  setRungText(m, 'Auxiliary', 'Sump', 0, 'XIC(Sump_Level_Hi)OTE(Sump_Pump_Run);', 'XIC(Sump_Level_Hi)XIO(Sump_Pump_Fault)OTE(Sump_Pump_Run);')
  deleteRung(m, 'PumpControl', 'PUMP_05', 1, 'XIC(PUMP_05_IL.Shutdown_Alarm)OTE(Pump_05_Shutdown_Alarm);')
  return m
}

/** 09: a trip cause removed from the ESD and a pump routine no longer called. */
export function currentPathRemoved(base: ControllerModel = baseline()): ControllerModel {
  const m = clone(base)
  stamp(m, logixDate(2026, 10, 2, 8, 12, 30), logixDate(2026, 10, 2, 8, 14, 5))
  setRungText(m, 'Safety', 'ESD', 0, ESD_RUNG, 'XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)OTE(MCC_Main_Enable);')
  deleteRung(m, 'PumpControl', 'Main', 2, 'JSR(PUMP_03,0);')
  return m
}

/* ----------------------------------------------------------------- drift */

export function siteA(base: ControllerModel = baseline()): ControllerModel {
  const m = clone(base)
  stamp(m, base.lastModifiedDate, logixDate(2026, 9, 15, 9, 4, 22))
  return m
}

/** Site B: AOI edited in place at site, revision left at 3.4, motor over-temperature trip lost. */
export function siteB(base: ControllerModel = baseline()): ControllerModel {
  const m = clone(base)
  m.name = 'EASTFIELD_PS'
  m.description = 'Eastfield Pump Station PLC-1, wet well lift station. SYNTHETIC DEMONSTRATION PROJECT: fictional utility, no real site or equipment.'
  m.ethernetAddress = '192.168.20.10'
  m.projectCreationDate = logixDate(2024, 5, 20, 13, 47, 2)
  stamp(m, logixDate(2026, 8, 11, 17, 20, 45), logixDate(2026, 9, 15, 9, 31, 8))
  const a = aoi(m, 'AOI_PumpInterlock')
  a.editedDate = aoiDate(2025, 11, 18, 22, 7, 39, 211)
  a.editedBy = 'EASTFIELD-EWS\\integrator'
  setRungText(m, 'AOI_PumpInterlock', 'Logic', 0, AOI_TRIP_RUNG, '[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(ESD_Active) ]OTE(Trip);')
  return m
}

/** Site C: legacy v33 project, AOI 3.1 without ESD_Active, plus a valve block only this site has. */
export function siteC(base: ControllerModel = baseline()): ControllerModel {
  const m = clone(base)
  m.name = 'RIVERBEND_PS'
  m.description = 'Riverbend Pump Station PLC-1, wet well lift station. SYNTHETIC DEMONSTRATION PROJECT: fictional utility, no real site or equipment.'
  m.ethernetAddress = '192.168.30.10'
  m.majorRev = 33
  m.minorRev = 11
  m.softwareRevision = '33.01'
  m.localizedDocumentation = true
  m.projectCreationDate = logixDate(2021, 6, 9, 10, 18, 55)
  stamp(m, logixDate(2025, 4, 3, 14, 52, 16), logixDate(2026, 9, 16, 13, 3, 47))
  const a = aoi(m, 'AOI_PumpInterlock')
  a.revision = '3.1'
  a.revisionNote = '3.1 adds Motor_Temp_Hi input (thermistor relays fitted on all pumps).'
  a.editedDate = aoiDate(2021, 9, 7, 8, 55, 12, 340)
  a.softwareRevision = 'v33.01'
  a.description = 'Wet well pump protection interlock. Any trip cause drops Run_Enable to the MCC starter; Shutdown_Alarm follows the trip for HMI annunciation.'
  a.parameters = a.parameters.filter((p) => p.name !== 'ESD_Active')
  setRungText(m, 'AOI_PumpInterlock', 'Logic', 0, AOI_TRIP_RUNG, '[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ]OTE(Trip);')
  for (let n = 1; n <= 5; n++) {
    const nn = pad2(n)
    const pressCause = n === 3 ? 'suction pressure low' : 'discharge pressure high'
    const r = routine(m, 'PumpControl', `PUMP_${nn}`)
    setRungText(m, 'PumpControl', `PUMP_${nn}`, 0, pumpCallText(n, true), pumpCallText(n, false))
    const first = r.rungs[0]
    if (first !== undefined) first.comment = `${pumpNo(n)} protection interlock. Trips on LSHH-101, ${pressCause} or motor over-temperature. Run enable to ${mccCubicle(n)}.`
  }
  m.aois.push(valveCtlAoi())
  tag(m, 'ESD_Active').description = 'Station ESD active, to SCADA'
  return m
}
