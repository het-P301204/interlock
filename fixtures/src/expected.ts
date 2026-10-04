/**
 * Hand-written oracle for every scenario. Nothing here is computed from the
 * engine: each expectation was reasoned out from the plant's logic and the
 * scan order (MainTask: Safety, PumpControl, Compressor, Alarms, Auxiliary,
 * Utilities; then Reporting in Slow_100ms). The `why` lines say why.
 *
 * Two derived facts are used throughout:
 *  - ESD_Active = NOT MCC_Main_Enable is written in Safety/ESD rung 1 before
 *    PumpControl runs, and feeds the ESD_Active input of every pump interlock.
 *    So Safety/ESD rung 0 is inside the cones of SF-01, SF-02, SF-03, SF-04,
 *    and (through XIC(MCC_Main_Enable)) SF-08.
 *  - A function's status depends on logic, execution and interface changes in
 *    its cone. Documentation (descriptions, rung comments) and stored tag
 *    values never change a status.
 */
import type { FindingType, SafetyStatus } from '../../packages/core/src/model/analysis.ts'
import type { ExpectedCompare, ExpectedDrift } from './types.ts'

const WEAKENING: FindingType[] = [
  'PROTECTIVE_PATH_REMOVED',
  'NEW_INHIBIT',
  'SHUTDOWN_WEAKENED',
  'PROTECTIVE_OUTPUT_BYPASSED',
  'ALARM_SUPPRESSED',
  'PERMISSIVE_WEAKENED',
  'INTERLOCK_WEAKENED',
  'SETPOINT_RELAXED',
  'TRIP_DELAY_INCREASED',
  'EXECUTION_CONTROL_INTRODUCED',
]

const SF_IDS = ['SF-01', 'SF-02', 'SF-03', 'SF-04', 'SF-05', 'SF-06', 'SF-07', 'SF-08'] as const

function statuses(overrides: Partial<Record<(typeof SF_IDS)[number], SafetyStatus>>): Record<string, SafetyStatus> {
  const out: Record<string, SafetyStatus> = {}
  for (const id of SF_IDS) out[id] = overrides[id] ?? 'NO_CHANGE'
  return out
}

export const EXPECTED_01: ExpectedCompare = {
  scenario: '01',
  title: 'Normal maintenance change',
  why: [
    'Safety/ESD rung 0 only reorders three series contacts (AND is commutative), so MCC_Main_Enable has the same condition: COSMETIC_LOGIC_CHANGE at LOW, naming SF-01.',
    'Safety/Overflow rung 0 adds a parallel branch GRT(LT101_PV,92.0) next to XIC(LSHH_101). XV101_Close_Cmd is ENERGIZE-to-trip, so the valve now closes in every case it closed before plus when the transmitter reads above 92 %: PROTECTION_STRENGTHENED (INFO) on SF-05, status STRENGTHENED.',
    'Utilities/Lighting rung 1 and Reporting/Main rung 0 are in programs declared non-safety and write nothing any safety function reads: two NON_SAFETY_LOGIC_CHANGE findings at INFO. The Reporting edit also moves the stored PRE of Pump_01_Hours to 1800000, because in Logix the instruction preset and the timer PRE are one value.',
    'Reporting reads Pump_01_Run_Enable but does not write it, so it is not in SF-02\'s cone.',
    'DISAGREES WITH THE BRIEF: the brief says "others NO_CHANGE", but ESD rung 0 is inside the cones of SF-02, SF-03 and SF-04 (MCC_Main_Enable -> ESD_Active -> each AOI ESD_Active input) and of SF-08 (XIC(MCC_Main_Enable) in Permissives). A change sits in their cones and their firing conditions are provably equivalent, which is exactly CHANGED_EQUIVALENT. Reporting NO_CHANGE would claim nothing in the cone changed. SF-06 and SF-07 cones do not include ESD rung 0 and stay NO_CHANGE.',
    'The 4 rung comment and 6 tag description edits are documentation only. One of them is on Pump_05_Motor_Temp_Hi, which no safety function declares: a documentation edit in undeclared scope must not produce an UNDECLARED finding.',
    'Nothing is REVIEW or UNDECLARED, so surface.priority is NONE and the worst finding of any disposition is LOW. Every changed rung is inside a declared cone or declared non-safety, so trust is VERIFIED_SCOPE.',
  ],
  findings: {
    mustInclude: [
      { type: 'COSMETIC_LOGIC_CHANGE', severity: 'LOW', safetyFunctionIds: ['SF-01'], program: 'Safety', routine: 'ESD' },
      { type: 'PROTECTION_STRENGTHENED', severity: 'INFO', safetyFunctionIds: ['SF-05'], program: 'Safety', routine: 'Overflow' },
      { type: 'NON_SAFETY_LOGIC_CHANGE', severity: 'INFO', safetyFunctionIds: [], program: 'Utilities', routine: 'Lighting' },
      { type: 'NON_SAFETY_LOGIC_CHANGE', severity: 'INFO', safetyFunctionIds: [], program: 'Reporting', routine: 'Main' },
    ],
    mustNotIncludeTypes: [...WEAKENING, 'UNDECLARED_LOGIC_CHANGED', 'SHARED_MODULE_PROPAGATION', 'MODULE_REVISION_NOT_BUMPED', 'EXTERNAL_WRITE_ACCESS_GRANTED', 'DECLARATION_UNRESOLVED'],
    maxSeverityOverall: 'LOW',
  },
  safetyStatus: statuses({ 'SF-01': 'CHANGED_EQUIVALENT', 'SF-02': 'CHANGED_EQUIVALENT', 'SF-03': 'CHANGED_EQUIVALENT', 'SF-04': 'CHANGED_EQUIVALENT', 'SF-05': 'STRENGTHENED', 'SF-08': 'CHANGED_EQUIVALENT' }),
  trust: 'VERIFIED_SCOPE',
  priority: 'NONE',
  surface: { undeclaredAffected: 0 },
  changeCounts: { logic: { min: 4, max: 4 }, documentation: { min: 10, max: 10 } },
}

export const EXPECTED_02: ExpectedCompare = {
  scenario: '02',
  title: 'Compressor shutdown weakened by maintenance mode',
  why: [
    'C201_Shutdown_Cmd is ENERGIZE-to-trip. Before: fires when PT201_High AND Safety_Enable. After: PT201_High AND Safety_Enable AND NOT Maintenance_Mode. Witness: PT201_High=1, Safety_Enable=1, Maintenance_Mode=1 fired before and does not fire now.',
    'Maintenance_Mode is a new atom that only removes firing cases, it is ExternalAccess Read/Write and no logic writes it (Utilities only reads it for a lamp): an HMI or OPC client can defeat the shutdown. NEW_INHIBIT, CRITICAL because SF-06 is CRITICAL.',
    'Compressor runs before Alarms in MainTask, so C201_Shutdown_Alm\'s rung-in XIC(C201_Shutdown_Cmd) sees this scan\'s value: the alarm loses exactly the same cases. ALARM_SUPPRESSED on SF-06 with suppressor Maintenance_Mode, at least HIGH: in exactly the cases where the shutdown no longer acts, the control room is not told either.',
    'No other function reads C201_Shutdown_Cmd or Maintenance_Mode, so only SF-06 is IMPACTED. The changed rung is inside SF-06\'s cone, so no UNDECLARED finding and trust stays VERIFIED_SCOPE.',
  ],
  findings: {
    mustInclude: [
      { type: 'NEW_INHIBIT', severity: 'CRITICAL', safetyFunctionIds: ['SF-06'], program: 'Compressor', routine: 'Main', inhibitLabels: ['Maintenance_Mode'] },
      { type: 'ALARM_SUPPRESSED', minSeverity: 'HIGH', safetyFunctionIds: ['SF-06'], suppressorLabels: ['Maintenance_Mode'] },
    ],
    mustNotIncludeTypes: ['PROTECTION_STRENGTHENED', 'COSMETIC_LOGIC_CHANGE', 'UNDECLARED_LOGIC_CHANGED', 'NON_SAFETY_LOGIC_CHANGE', 'SHARED_MODULE_PROPAGATION', 'PROTECTIVE_PATH_REMOVED', 'PROTECTIVE_OUTPUT_BYPASSED', 'EXTERNAL_WRITE_ACCESS_GRANTED'],
  },
  safetyStatus: statuses({ 'SF-06': 'IMPACTED' }),
  trust: 'VERIFIED_SCOPE',
  priority: 'CRITICAL',
  surface: { undeclaredAffected: 0 },
  changeCounts: { logic: { min: 1, max: 1 } },
}

export const EXPECTED_03: ExpectedCompare = {
  scenario: '03',
  title: 'High-high level alarm suppressed',
  why: [
    'The ALMD operands are AlarmTag, ProgAck, ProgReset, ProgDisable, ProgEnable. High_Level_Inhibit now sits in the ProgDisable position, so while it is set the T-101 high-high alarm is disabled even though LSHH-101 is made.',
    'High_Level_Inhibit is a new controller tag, ExternalAccess Read/Write, written by no logic: an HMI or OPC client sets it. ALARM_SUPPRESSED, CRITICAL, on SF-07 with suppressor High_Level_Inhibit.',
    'SF-07 is an ALARM function with no protective output, so this is not a NEW_INHIBIT on a protective output.',
    'SF-05 also uses LSHH_101 but its rung (Safety/Overflow) is untouched and nothing it reads changed: XV-101 still closes. SF-05 NO_CHANGE is the point of the scenario: the protection works, the operator is not told.',
  ],
  findings: {
    mustInclude: [{ type: 'ALARM_SUPPRESSED', severity: 'CRITICAL', safetyFunctionIds: ['SF-07'], program: 'Alarms', routine: 'Main', suppressorLabels: ['High_Level_Inhibit'] }],
    mustNotIncludeTypes: ['NEW_INHIBIT', 'PROTECTIVE_PATH_REMOVED', 'SHUTDOWN_WEAKENED', 'PROTECTIVE_OUTPUT_BYPASSED', 'UNDECLARED_LOGIC_CHANGED', 'NON_SAFETY_LOGIC_CHANGE', 'COSMETIC_LOGIC_CHANGE', 'PROTECTION_STRENGTHENED', 'SHARED_MODULE_PROPAGATION'],
  },
  safetyStatus: statuses({ 'SF-07': 'IMPACTED' }),
  trust: 'VERIFIED_SCOPE',
  priority: 'CRITICAL',
  surface: { undeclaredAffected: 0 },
  changeCounts: { logic: { min: 1, max: 1 } },
}

export const EXPECTED_04: ExpectedCompare = {
  scenario: '04',
  title: 'Shared pump interlock AOI modified',
  why: [
    'AOI_PumpInterlock Logic rung 0 becomes [...]XIO(Maint_Bypass)OTE(Trip): with Maint_Bypass set, Trip is false whatever the trip causes say, so Run_Enable = Run_Request and every protective input is defeated.',
    'Maint_Bypass is Required=false, so no call site passes it: it lives in each backing tag (PUMP_0n_IL.Maint_Bypass), the instance tags are Read/Write, and no logic writes it. It is an externally writable inhibit in every instance.',
    'The block has 5 call sites. PUMP_01..03 implement SF-02, SF-03 and SF-04 (safety-relevant); PUMP_04 and PUMP_05 are operational. SHARED_MODULE_PROPAGATION with blast radius 5 / 3 / 2.',
    'NEW_INHIBIT, CRITICAL, module AOI_PumpInterlock, covering SF-02, SF-03 and SF-04 (one module-level finding or one per function both satisfy the oracle).',
    'SF-02 declares Pump_01_Shutdown_Alarm, which follows PUMP_01_IL.Shutdown_Alarm = Trip: the bypass also silences that alarm, so ALARM_SUPPRESSED on SF-02. SF-03 and SF-04 declare no alarm.',
    'The revision was bumped 3.4 -> 3.5, so MODULE_REVISION_NOT_BUMPED must not appear. SF-01, SF-05..SF-08 read nothing the block writes and stay NO_CHANGE.',
  ],
  findings: {
    mustInclude: [
      { type: 'SHARED_MODULE_PROPAGATION', safetyFunctionIds: ['SF-02', 'SF-03', 'SF-04'], module: 'AOI_PumpInterlock' },
      { type: 'NEW_INHIBIT', severity: 'CRITICAL', safetyFunctionIds: ['SF-02', 'SF-03', 'SF-04'], module: 'AOI_PumpInterlock', inhibitLabels: ['Maint_Bypass'] },
      { type: 'ALARM_SUPPRESSED', safetyFunctionIds: ['SF-02'], suppressorLabels: ['Maint_Bypass'] },
    ],
    mustNotIncludeTypes: ['MODULE_REVISION_NOT_BUMPED', 'PROTECTION_STRENGTHENED', 'COSMETIC_LOGIC_CHANGE', 'NON_SAFETY_LOGIC_CHANGE', 'PROTECTIVE_OUTPUT_BYPASSED', 'PROTECTIVE_PATH_REMOVED'],
  },
  safetyStatus: statuses({ 'SF-02': 'IMPACTED', 'SF-03': 'IMPACTED', 'SF-04': 'IMPACTED' }),
  priority: 'CRITICAL',
  surface: { blastRadius: 5 },
  blastRadius: { AOI_PumpInterlock: { instances: 5, safetyRelevant: 3, operational: 2, notExecuted: 0 } },
}

export const EXPECTED_05: ExpectedCompare = {
  scenario: '05',
  title: 'Protective output bypassed from non-safety code',
  why: [
    'Utilities runs after PumpControl in MainTask. Each scan the AOI writes Pump_01_Run_Enable from its trip logic, then Utilities/Commissioning OTLs it back to 1 whenever Pump_01_Manual_Override is set. The final value is Override OR (Run_Request AND NOT Trip): with the override set, SF-02 can never de-energize P-101.',
    'Pump_01_Manual_Override is a new Read/Write tag written by no logic. PROTECTIVE_OUTPUT_BYPASSED, CRITICAL, on SF-02, located in Utilities/Commissioning, naming the override tag.',
    'The writer sits in a program declared non-safety, which is the reason the declaration cannot be trusted at face value; it must not be reported only as an INFO non-safety change.',
    'Pump_01_Shutdown_Alarm still follows the AOI\'s Trip, so the operator is still told about the trip the pump ignores: no ALARM_SUPPRESSED.',
    'Only SF-02 is IMPACTED; no other function reads Pump_01_Run_Enable.',
  ],
  findings: {
    mustInclude: [{ type: 'PROTECTIVE_OUTPUT_BYPASSED', severity: 'CRITICAL', safetyFunctionIds: ['SF-02'], program: 'Utilities', routine: 'Commissioning', causeLabels: ['Pump_01_Manual_Override'] }],
    mustNotIncludeTypes: ['ALARM_SUPPRESSED', 'PROTECTION_STRENGTHENED', 'COSMETIC_LOGIC_CHANGE', 'SHARED_MODULE_PROPAGATION', 'PROTECTIVE_PATH_REMOVED', 'MODULE_REVISION_NOT_BUMPED'],
  },
  safetyStatus: statuses({ 'SF-02': 'IMPACTED' }),
  priority: 'CRITICAL',
}

export const EXPECTED_06: ExpectedCompare = {
  scenario: '06',
  title: 'Undeclared logic changed',
  why: [
    'Auxiliary is neither declared safety nor declared non-safety. SealWater loses XIO(Seal_Water_Low): SV-104 now opens with the seal water tank empty. Sump gains XIO(Sump_Pump_Fault). Both are outside every declared cone.',
    'PumpControl/PUMP_05 rung 1 (Pump_05_Shutdown_Alarm) is deleted. PUMP_05 is in a program that implements safety functions, but no declared function covers P-105, so this is undeclared too.',
    'INTERLOCK must not call any of these safe: three UNDECLARED_LOGIC_CHANGED findings (one per routine), undeclaredAffected = 3, trust REVIEW_REQUIRED.',
    'No declared function\'s cone contains these rungs (SealWater reads Pump_04_Run_Enable but SF-02..SF-04 cover P-101..P-103), so every function is NO_CHANGE and no weakening type may appear.',
  ],
  findings: {
    mustInclude: [
      { type: 'UNDECLARED_LOGIC_CHANGED', safetyFunctionIds: [], program: 'Auxiliary', routine: 'SealWater' },
      { type: 'UNDECLARED_LOGIC_CHANGED', safetyFunctionIds: [], program: 'Auxiliary', routine: 'Sump' },
      { type: 'UNDECLARED_LOGIC_CHANGED', safetyFunctionIds: [], program: 'PumpControl', routine: 'PUMP_05' },
    ],
    mustNotIncludeTypes: [...WEAKENING, 'PROTECTION_STRENGTHENED', 'COSMETIC_LOGIC_CHANGE', 'SHARED_MODULE_PROPAGATION', 'NON_SAFETY_LOGIC_CHANGE'],
  },
  safetyStatus: statuses({}),
  trust: 'REVIEW_REQUIRED',
  surface: { undeclaredAffected: 3 },
  changeCounts: { logic: { min: 3, max: 3 } },
}

export const EXPECTED_07: ExpectedDrift = {
  scenario: '07',
  title: 'AOI drift across three sites',
  why: [
    'Site A carries AOI_PumpInterlock 3.4 exactly as the approved baseline and is the reference.',
    'Site B still says Revision 3.4 but rung 0 lost XIC(Motor_Temp_Hi): same name and revision, different body (REVISION_NOT_BUMPED). Its Trip, and so Run_Enable\'s trip and Shutdown_Alarm, fire in fewer cases: Motor_Temp_Hi=1 with every other cause clear trips at A and not at B. WEAKER.',
    'Site C carries 3.1, which predates the ESD_Active input (OLDER_REVISION). With ESD_Active=1 and every other cause clear, A trips and C does not. WEAKER.',
    'Both differences remove trip cases from an output a safety function depends on, so SAFETY_BEHAVIOR_DIFFERS. SAME_NAME_DIFFERENT_DEFINITION is also true and may appear; it is not required.',
    'AOI_ValveCtl exists only in Site C\'s library (defined, not called): missingAt Site A and Site B.',
    'Site C is exported with documentation languages enabled (LocalizedDescription / LocalizedComment); that is a parser variant, not a drift.',
  ],
  drift: {
    AOI_PumpInterlock: {
      status: 'DRIFT',
      reference: 'Site A',
      flags: ['REVISION_NOT_BUMPED', 'OLDER_REVISION', 'SAFETY_BEHAVIOR_DIFFERS'],
      flagSites: { REVISION_NOT_BUMPED: ['Site B'], OLDER_REVISION: ['Site C'] },
      variants: { 'Site A': 'REFERENCE', 'Site B': 'WEAKER', 'Site C': 'WEAKER' },
      revisions: { 'Site A': '3.4', 'Site B': '3.4', 'Site C': '3.1' },
    },
    AOI_ValveCtl: { flags: ['MISSING_AT_SITE'], missingAt: ['Site A', 'Site B'] },
  },
}

export const EXPECTED_08: ExpectedCompare = {
  scenario: '08',
  title: 'Large noisy export with three logic changes',
  why: [
    'Of roughly 425 changes, 400 are documentation (340 tag descriptions, 60 rung comments), 20 are drifted process values, 1 is the C201_LP_Delay PRE that moves with its TON preset, and 2 are export dates. Exactly three rungs change.',
    'Safety/Permissives GRT(Suction_Press_PV,12.0) -> 8.0: the permissive (DE_ENERGIZE) used to drop for suction pressure in (8, 12] psig and no longer does. SETPOINT_RELAXED at HIGH on SF-08 (a HIGH function).',
    'Compressor/Main rung 2 TON preset 2000 -> 10000 delays C201_Low_Press_Trip from 2 s to 10 s. No declared function\'s cone contains it (SF-06 depends only on rung 0), so UNDECLARED_LOGIC_CHANGED; the tag name contains "Trip", which a name hint should surface.',
    'Safety/ESD rung 0 is the same commutative reorder as scenario 01: COSMETIC_LOGIC_CHANGE naming SF-01, and SF-01..SF-04 are CHANGED_EQUIVALENT for the cone reason explained in scenario 01. SF-08 also contains the reorder but its setpoint was relaxed, so IMPACTED.',
    'Documentation edits land in every cone, including SF-05, SF-06 and SF-07; they never change a status, so those stay NO_CHANGE.',
    'One undeclared routine changed, so trust is REVIEW_REQUIRED and undeclaredAffected = 1. The worst REVIEW finding is the HIGH setpoint relaxation.',
  ],
  findings: {
    mustInclude: [
      { type: 'SETPOINT_RELAXED', severity: 'HIGH', safetyFunctionIds: ['SF-08'], program: 'Safety', routine: 'Permissives' },
      { type: 'UNDECLARED_LOGIC_CHANGED', safetyFunctionIds: [], program: 'Compressor', routine: 'Main' },
      { type: 'COSMETIC_LOGIC_CHANGE', safetyFunctionIds: ['SF-01'], program: 'Safety', routine: 'ESD' },
    ],
    mustNotIncludeTypes: ['NEW_INHIBIT', 'PROTECTIVE_PATH_REMOVED', 'SHUTDOWN_WEAKENED', 'PROTECTIVE_OUTPUT_BYPASSED', 'ALARM_SUPPRESSED', 'SHARED_MODULE_PROPAGATION', 'MODULE_REVISION_NOT_BUMPED', 'NON_SAFETY_LOGIC_CHANGE', 'EXECUTION_CONTROL_INTRODUCED', 'PROTECTION_STRENGTHENED'],
    maxSeverity: 'HIGH',
  },
  safetyStatus: statuses({ 'SF-01': 'CHANGED_EQUIVALENT', 'SF-02': 'CHANGED_EQUIVALENT', 'SF-03': 'CHANGED_EQUIVALENT', 'SF-04': 'CHANGED_EQUIVALENT', 'SF-08': 'IMPACTED' }),
  trust: 'REVIEW_REQUIRED',
  priority: 'HIGH',
  surface: { undeclaredAffected: 1 },
  changeCounts: { logic: { min: 3, max: 3 }, documentation: { min: 380, max: 480 }, data: { min: 20, max: 22 } },
}

export const EXPECTED_09: ExpectedCompare = {
  scenario: '09',
  title: 'Protective paths removed',
  why: [
    'Safety/ESD rung 0 loses XIO(Fire_Detected): a fire panel alarm no longer drops MCC_Main_Enable. Fire_Detected disappears from SF-01\'s firing condition: PROTECTIVE_PATH_REMOVED, CRITICAL, naming Fire_Detected.',
    'JSR(PUMP_03,0) is deleted from PumpControl/Main, so PUMP_03 and the PUMP_03_IL call never execute. Pump_03_Run_Enable is no longer written and holds its last value: SF-04 cannot trip at all. PROTECTIVE_PATH_REMOVED on SF-04, at least HIGH (SF-04 is HIGH).',
    'BEYOND THE BRIEF: the ESD change propagates. ESD_Active = NOT MCC_Main_Enable feeds every pump interlock, so P-101 and P-102 no longer trip on fire (SF-02, SF-03), and Pump_Start_Permissive reads MCC_Main_Enable, so pumps may start during a fire (SF-08). Each loses the Fire_Detected case: a weakening finding of a path-removed or weakened type must name SF-02, SF-03 and SF-08, and all three are IMPACTED.',
    'SF-01\'s alarm ESD_Trip_Horn = NOT MCC_Main_Enable also no longer sounds on fire. The oracle does not require a separate alarm finding for it because the root-cause finding above already covers the same cause.',
    'SF-05, SF-06 and SF-07 read nothing that changed and stay NO_CHANGE. No atom was added, so NEW_INHIBIT must not appear.',
  ],
  findings: {
    mustInclude: [
      { type: 'PROTECTIVE_PATH_REMOVED', severity: 'CRITICAL', safetyFunctionIds: ['SF-01'], program: 'Safety', routine: 'ESD', causeLabels: ['Fire_Detected'] },
      { type: 'PROTECTIVE_PATH_REMOVED', minSeverity: 'HIGH', safetyFunctionIds: ['SF-04'] },
      { type: ['PROTECTIVE_PATH_REMOVED', 'SHUTDOWN_WEAKENED', 'INTERLOCK_WEAKENED', 'PERMISSIVE_WEAKENED'], safetyFunctionIds: ['SF-02', 'SF-03', 'SF-08'] },
    ],
    mustNotIncludeTypes: ['NEW_INHIBIT', 'PROTECTION_STRENGTHENED', 'COSMETIC_LOGIC_CHANGE', 'NON_SAFETY_LOGIC_CHANGE', 'SHARED_MODULE_PROPAGATION', 'MODULE_REVISION_NOT_BUMPED'],
  },
  safetyStatus: statuses({ 'SF-01': 'IMPACTED', 'SF-02': 'IMPACTED', 'SF-03': 'IMPACTED', 'SF-04': 'IMPACTED', 'SF-08': 'IMPACTED' }),
  priority: 'CRITICAL',
}
