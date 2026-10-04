# INTERLOCK fixtures: Northgate Pump Station

> **Synthetic.** Northgate Water Authority, its stations (Northgate, Eastfield, Riverbend), tag names, drawing numbers and values are invented for demonstration. No file here was exported from a real controller or describes a real site.

This directory is **generated**. Edit `fixtures/src/*.ts`, then run `npm run fixtures` (write) or `npm run fixtures:check` (CI: exit 1 if anything on disk differs). Do not hand-edit the outputs.

| Path | What |
|---|---|
| `l5x/` | L5X exports laid out like Logix Designer v35 full-controller exports |
| `manifests/` | Engineer-declared safety functions (`interlock.safety/v1`) |
| `expected/` | Hand-written expected findings per scenario: the engine's test oracle, with a `why` line per expectation |
| `scenarios.json` | Scenario registry (`interlock.scenarios/v1`) read by the UI, API, CLI and tests |
| `src/` | Plant model, L5X writer, scenario mutations, large-plant generator (seeded PRNG) |

## The plant

Northgate is a wastewater lift station run by a water utility. Inflow arrives through inlet valve XV-101 into wet well T-101 (level transmitter LT-101, high-high float LSHH-101). Five wet well pumps P-101..P-105 lift it to the force main; each pump's run enable goes to a starter in MCC-1 and passes through one instance of the standard NWA block `AOI_PumpInterlock`. Air compressor C-201 supplies bubbler and instrument air and has its own high pressure shutdown (PSH-201). A gatehouse ESD pushbutton, the E-stop loop and the fire panel FACP-1 drop MCC-1 through the ESD routine.

Controller `NORTHGATE_PS`, 1756-L83E, firmware 35.11, exported by Logix Designer 35.00.

### Scan order

| Task | Type | Programs in order |
|---|---|---|
| `MainTask` | CONTINUOUS, priority 10 | Safety, PumpControl, Compressor, Alarms, Auxiliary, Utilities |
| `Slow_100ms` | PERIODIC 100 ms, priority 12 | Reporting |

### Safety functions (`manifests/northgate.safety.json`)

| Id | Function | Kind | Criticality | Implemented in | Protective output | Alarm |
|---|---|---|---|---|---|---|
| SF-01 | Emergency Shutdown | SHUTDOWN | CRITICAL | Safety/ESD | `MCC_Main_Enable` DE_ENERGIZE | `ESD_Trip_Horn` |
| SF-02 | Pump P-101 High-Level Shutdown | SHUTDOWN | CRITICAL | PumpControl/PUMP_01 (PUMP_01_IL) | `Pump_01_Run_Enable` DE_ENERGIZE | `Pump_01_Shutdown_Alarm` |
| SF-03 | Pump P-102 Motor Overtemperature Interlock | INTERLOCK | HIGH | PumpControl/PUMP_02 (PUMP_02_IL) | `Pump_02_Run_Enable` DE_ENERGIZE | - |
| SF-04 | Pump P-103 Low-Pressure Trip | TRIP | HIGH | PumpControl/PUMP_03 (PUMP_03_IL) | `Pump_03_Run_Enable` DE_ENERGIZE | - |
| SF-05 | Tank T-101 Overflow Protection | SHUTDOWN | CRITICAL | Safety/Overflow | `XV101_Close_Cmd` ENERGIZE | - |
| SF-06 | Compressor C-201 High-Pressure Shutdown | SHUTDOWN | CRITICAL | Compressor/Main | `C201_Shutdown_Cmd` ENERGIZE | `C201_Shutdown_Alm` |
| SF-07 | Tank T-101 High-High Level Alarm | ALARM | CRITICAL | Alarms/Main | - | `LT101_HH_Alm` |
| SF-08 | Pump Start Permissive | PERMISSIVE | HIGH | Safety/Permissives | `Pump_Start_Permissive` DE_ENERGIZE | - |

Declared non-safety: Utilities, Reporting. `Auxiliary` is declared neither way, so changes there are UNDECLARED.

### Routines

#### Safety

Station protective functions: ESD, T-101 overflow protection, pump start permissive. Any change requires MOC and functional test per NWA-ENG-014.

| Routine | Rung | Text | Comment |
|---|---|---|---|
| Main | 0 | `JSR(ESD,0);` | Emergency shutdown chain. |
| Main | 1 | `JSR(Overflow,0);` | Wet well T-101 overflow protection. |
| Main | 2 | `JSR(Permissives,0);` | Station pump start permissive. |
| ESD | 0 | `XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)XIO(Fire_Detected)OTE(MCC_Main_Enable);` | MCC-1 main enable. Drops on loss of the E-stop loop (ES-1..ES-4 via SR-1), remote ESD from the gatehouse, or fire panel FACP-1 alarm. De-energize to trip. |
| ESD | 1 | `XIO(MCC_Main_Enable)OTE(ESD_Active);` | ESD active status to every pump interlock and to SCADA. |
| Overflow | 0 | `XIC(LSHH_101)OTE(XV101_Close_Cmd);` | LSHH-101 closes inlet valve XV-101 (energize to close). Hardwired float, independent of the LT-101 transmitter. |
| Permissives | 0 | `XIC(MCC_Main_Enable)XIO(LSHH_101)GRT(Suction_Press_PV,12.0)OTE(Pump_Start_Permissive);` | Pumps may start only with MCC-1 enabled, wet well below high-high, and suction header above 12 psig (NPSH margin). |

#### PumpControl

Wet well pumps P-101 to P-105: one AOI_PumpInterlock instance per pump, run enable to the MCC.

| Routine | Rung | Text | Comment |
|---|---|---|---|
| Main | 0 | `JSR(PUMP_01,0);` | P-101 interlock and control. |
| Main | 1 | `JSR(PUMP_02,0);` | P-102 interlock and control. |
| Main | 2 | `JSR(PUMP_03,0);` | P-103 interlock and control. |
| Main | 3 | `JSR(PUMP_04,0);` | P-104 interlock and control. |
| Main | 4 | `JSR(PUMP_05,0);` | P-105 interlock and control. |
| PUMP_01 | 0 | `AOI_PumpInterlock(PUMP_01_IL,Pump_01_Run_Request,LSHH_101,Pump_01_Disch_Press_Hi,Pump_01_Motor_Temp_Hi,ESD_Active,Pump_01_Run_Enable);` | P-101 protection interlock. Trips on LSHH-101, discharge pressure high (PSH-101), motor over-temperature (TSH-101) or station ESD. Run enable hardwired to MCC-1 cubicle 1A. |
| PUMP_01 | 1 | `XIC(PUMP_01_IL.Shutdown_Alarm)OTE(Pump_01_Shutdown_Alarm);` | P-101 protective shutdown alarm to HMI alarm summary. |
| PUMP_02 | 0 | `AOI_PumpInterlock(PUMP_02_IL,Pump_02_Run_Request,LSHH_101,Pump_02_Disch_Press_Hi,Pump_02_Motor_Temp_Hi,ESD_Active,Pump_02_Run_Enable);` | P-102 protection interlock. Trips on LSHH-101, discharge pressure high (PSH-102), motor over-temperature (TSH-102) or station ESD. Run enable hardwired to MCC-1 cubicle 2A. |
| PUMP_02 | 1 | `XIC(PUMP_02_IL.Shutdown_Alarm)OTE(Pump_02_Shutdown_Alarm);` | P-102 protective shutdown alarm to HMI alarm summary. |
| PUMP_03 | 0 | `AOI_PumpInterlock(PUMP_03_IL,Pump_03_Run_Request,LSHH_101,Pump_03_Suction_Low,Pump_03_Motor_Temp_Hi,ESD_Active,Pump_03_Run_Enable);` | P-103 protection interlock. Trips on LSHH-101, suction pressure low (PSL-103), motor over-temperature (TSH-103) or station ESD. Run enable hardwired to MCC-1 cubicle 3A. |
| PUMP_03 | 1 | `XIC(PUMP_03_IL.Shutdown_Alarm)OTE(Pump_03_Shutdown_Alarm);` | P-103 protective shutdown alarm to HMI alarm summary. |
| PUMP_04 | 0 | `AOI_PumpInterlock(PUMP_04_IL,Pump_04_Run_Request,LSHH_101,Pump_04_Disch_Press_Hi,Pump_04_Motor_Temp_Hi,ESD_Active,Pump_04_Run_Enable);` | P-104 protection interlock. Trips on LSHH-101, discharge pressure high (PSH-104), motor over-temperature (TSH-104) or station ESD. Run enable hardwired to MCC-1 cubicle 4A. |
| PUMP_04 | 1 | `XIC(PUMP_04_IL.Shutdown_Alarm)OTE(Pump_04_Shutdown_Alarm);` | P-104 protective shutdown alarm to HMI alarm summary. |
| PUMP_05 | 0 | `AOI_PumpInterlock(PUMP_05_IL,Pump_05_Run_Request,LSHH_101,Pump_05_Disch_Press_Hi,Pump_05_Motor_Temp_Hi,ESD_Active,Pump_05_Run_Enable);` | P-105 protection interlock. Trips on LSHH-101, discharge pressure high (PSH-105), motor over-temperature (TSH-105) or station ESD. Run enable hardwired to MCC-1 cubicle 5A. |
| PUMP_05 | 1 | `XIC(PUMP_05_IL.Shutdown_Alarm)OTE(Pump_05_Shutdown_Alarm);` | P-105 protective shutdown alarm to HMI alarm summary. |

#### Compressor

Air compressor C-201 (bubbler and instrument air): high pressure shutdown, low suction trip.

| Routine | Rung | Text | Comment |
|---|---|---|---|
| Main | 0 | `XIC(PT201_High)XIC(Safety_Enable)OTE(C201_Shutdown_Cmd);` | C-201 high pressure shutdown. PSH-201 trips the compressor while station safety functions are armed. |
| Main | 1 | `XIC(C201_Run_Cmd)XIO(C201_Shutdown_Cmd)OTE(C201_Motor_Run);` | C-201 motor run: operator run command, blocked while the shutdown is active. |
| Main | 2 | `LES(C201_Suction_PV,3.5)TON(C201_LP_Delay,2000,0);` | Low suction pressure: 2 s filter on PT-201S below 3.5 psig. |
| Main | 3 | `XIC(C201_LP_Delay.DN)OTE(C201_Low_Press_Trip);` | C-201 low suction trip after delay. |

#### Alarms

Annunciation to the HMI alarm summary and the control room horn.

| Routine | Rung | Text | Comment |
|---|---|---|---|
| Main | 0 | `XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,0,0);` | T-101 high-high level alarm from LSHH-101 to HMI alarm summary, severity 900 (urgent). |
| Main | 1 | `XIC(C201_Shutdown_Cmd)ALMD(C201_Shutdown_Alm,0,0,0,0);` | C-201 high pressure shutdown alarm. |
| Main | 2 | `XIO(MCC_Main_Enable)OTE(ESD_Trip_Horn);` | Control room horn and beacon AH-1 while MCC-1 is tripped. |

#### Auxiliary

Station auxiliaries: P-104 seal water, drywell sump.

| Routine | Rung | Text | Comment |
|---|---|---|---|
| Main | 0 | `JSR(SealWater,0);` | P-104 seal water. |
| Main | 1 | `JSR(Sump,0);` | Drywell sump. |
| SealWater | 0 | `XIC(Pump_04_Run_Enable)XIO(Seal_Water_Low)OTE(Seal_Water_Valve_Open);` | Seal water solenoid SV-104 opens while P-104 runs. Held closed on seal water tank low level (LSL-104) so the booster does not run dry. |
| Sump | 0 | `XIC(Sump_Level_Hi)OTE(Sump_Pump_Run);` | Drywell sump pump SP-1 runs on sump high level LSH-120. |

#### Utilities

Building services: lighting and HVAC. Declared non-safety.

| Routine | Rung | Text | Comment |
|---|---|---|---|
| Main | 0 | `JSR(Lighting,0);` | Panel and yard lighting. |
| Main | 1 | `JSR(HVAC,0);` | Pump room ventilation. |
| Lighting | 0 | `XIC(Maintenance_Mode)OTE(Panel_Light_Maint);` | Maintenance mode lamp on CP-1. |
| Lighting | 1 | `XIC(Dusk_Sensor)OTE(Yard_Lights);` | Yard lights on photocell PE-1. |
| HVAC | 0 | `XIC(Building_Temp_Hi)OTE(Exhaust_Fan_Run);` | Exhaust fan EF-1 on pump room high temperature. |

#### Reporting

Run hours for the SCADA historian. Declared non-safety.

| Routine | Rung | Text | Comment |
|---|---|---|---|
| Main | 0 | `XIC(Pump_01_Run_Enable)RTO(Pump_01_Hours,3600000,0);` | P-101 run hours (RTO, 1 h base, rolled over by historian). |
| Main | 1 | `XIC(Pump_02_Run_Enable)RTO(Pump_02_Hours,3600000,0);` | P-102 run hours (RTO, 1 h base, rolled over by historian). |

### AOI_PumpInterlock 3.4

Wet well pump protection interlock. Any trip cause drops Run_Enable to the MCC starter; Shutdown_Alarm follows the trip for HMI annunciation. Standard NWA pump block, do not edit at site level.

| Parameter | Usage | Required | Description |
|---|---|---|---|
| `Run_Request` | Input | yes | Run request from lead/lag sequencer or HMI hand start |
| `Level_HH` | Input | yes | Wet well level high-high (trip) |
| `Press_Trip` | Input | yes | Pressure trip: discharge high or suction low, per pump (trip) |
| `Motor_Temp_Hi` | Input | yes | Motor winding over-temperature relay (trip) |
| `ESD_Active` | Input | yes | Station emergency shutdown active (trip) |
| `Run_Enable` | Output | yes | Run enable to MCC starter. 0 = pump stopped/blocked |
| `Shutdown_Alarm` | Output | no | Protective shutdown alarm to HMI |

| Rung | Text |
|---|---|
| 0 | `[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ,XIC(ESD_Active) ]OTE(Trip);` |
| 1 | `XIC(Run_Request)XIO(Trip)OTE(Run_Enable);` |
| 2 | `XIC(Trip)OTE(Shutdown_Alarm);` |

An AOI call passes the backing tag, then the required parameters in declaration order: `AOI_PumpInterlock(PUMP_01_IL,Pump_01_Run_Request,LSHH_101,Pump_01_Disch_Press_Hi,Pump_01_Motor_Temp_Hi,ESD_Active,Pump_01_Run_Enable);`. Shutdown_Alarm is optional and read as `PUMP_01_IL.Shutdown_Alarm`.

### Controller tags

| Tag | Type | External access | Description |
|---|---|---|---|
| `EStop_Healthy` | BOOL | Read Only | E-stop loop healthy: ES-1 to ES-4 in series through safety relay SR-1 (1 = healthy) |
| `ESD_Remote_Cmd` | BOOL | Read Only | Remote ESD pushbutton at gatehouse, hardwired (1 = ESD demanded) |
| `Fire_Detected` | BOOL | Read Only | Fire alarm panel FACP-1 general alarm relay (1 = fire) |
| `LSHH_101` | alias -> Local:3:I.Data.4 | Read Only | T-101 wet well level high-high float LSHH-101 (1 = high-high) |
| `LT101_PV` | REAL | Read Only | T-101 wet well level LT-101 (% of span) |
| `Suction_Press_PV` | REAL | Read Only | Pump suction header pressure PT-110 (psig) |
| `MCC_Main_Enable` | BOOL | Read Only | MCC-1 main enable (de-energize to trip every pump starter) |
| `ESD_Active` | BOOL | Read Only | Station ESD active, to pump interlocks and SCADA |
| `XV101_Close_Cmd` | BOOL | Read Only | XV-101 wet well inlet valve close command (energize to close) |
| `Pump_Start_Permissive` | BOOL | Read Only | Station pump start permissive to lead/lag sequencer |
| `Maintenance_Mode` | BOOL | Read/Write | Station maintenance mode selected at HMI |
| `Safety_Enable` | BOOL | Read/Write | Station safety functions armed (HMI, supervisor level) |
| `Pump_01_Run_Request` | BOOL | Read/Write | P-101 run request from lead/lag sequencer or HMI hand start |
| `Pump_01_Disch_Press_Hi` | BOOL | Read Only | P-101 discharge pressure high, PSH-101 (1 = high, trip) |
| `Pump_01_Motor_Temp_Hi` | BOOL | Read Only | P-101 motor winding over-temperature relay TSH-101 (1 = hot, trip) |
| `Pump_01_Run_Enable` | BOOL | Read Only | P-101 run enable to MCC-1 cubicle 1A (de-energize to stop) |
| `Pump_01_Shutdown_Alarm` | BOOL | Read Only | P-101 protective shutdown alarm to HMI |
| `PUMP_01_IL` | AOI_PumpInterlock | Read/Write | P-101 protection interlock instance |
| `Pump_02_Run_Request` | BOOL | Read/Write | P-102 run request from lead/lag sequencer or HMI hand start |
| `Pump_02_Disch_Press_Hi` | BOOL | Read Only | P-102 discharge pressure high, PSH-102 (1 = high, trip) |
| `Pump_02_Motor_Temp_Hi` | BOOL | Read Only | P-102 motor winding over-temperature relay TSH-102 (1 = hot, trip) |
| `Pump_02_Run_Enable` | BOOL | Read Only | P-102 run enable to MCC-1 cubicle 2A (de-energize to stop) |
| `Pump_02_Shutdown_Alarm` | BOOL | Read Only | P-102 protective shutdown alarm to HMI |
| `PUMP_02_IL` | AOI_PumpInterlock | Read/Write | P-102 protection interlock instance |
| `Pump_03_Run_Request` | BOOL | Read/Write | P-103 run request from lead/lag sequencer or HMI hand start |
| `Pump_03_Suction_Low` | BOOL | Read Only | P-103 suction pressure low, PSL-103 (1 = low, trip) |
| `Pump_03_Motor_Temp_Hi` | BOOL | Read Only | P-103 motor winding over-temperature relay TSH-103 (1 = hot, trip) |
| `Pump_03_Run_Enable` | BOOL | Read Only | P-103 run enable to MCC-1 cubicle 3A (de-energize to stop) |
| `Pump_03_Shutdown_Alarm` | BOOL | Read Only | P-103 protective shutdown alarm to HMI |
| `PUMP_03_IL` | AOI_PumpInterlock | Read/Write | P-103 protection interlock instance |
| `Pump_04_Run_Request` | BOOL | Read/Write | P-104 run request from lead/lag sequencer or HMI hand start |
| `Pump_04_Disch_Press_Hi` | BOOL | Read Only | P-104 discharge pressure high, PSH-104 (1 = high, trip) |
| `Pump_04_Motor_Temp_Hi` | BOOL | Read Only | P-104 motor winding over-temperature relay TSH-104 (1 = hot, trip) |
| `Pump_04_Run_Enable` | BOOL | Read Only | P-104 run enable to MCC-1 cubicle 4A (de-energize to stop) |
| `Pump_04_Shutdown_Alarm` | BOOL | Read Only | P-104 protective shutdown alarm to HMI |
| `PUMP_04_IL` | AOI_PumpInterlock | Read/Write | P-104 protection interlock instance |
| `Pump_05_Run_Request` | BOOL | Read/Write | P-105 run request from lead/lag sequencer or HMI hand start |
| `Pump_05_Disch_Press_Hi` | BOOL | Read Only | P-105 discharge pressure high, PSH-105 (1 = high, trip) |
| `Pump_05_Motor_Temp_Hi` | BOOL | Read Only | P-105 motor winding over-temperature relay TSH-105 (1 = hot, trip) |
| `Pump_05_Run_Enable` | BOOL | Read Only | P-105 run enable to MCC-1 cubicle 5A (de-energize to stop) |
| `Pump_05_Shutdown_Alarm` | BOOL | Read Only | P-105 protective shutdown alarm to HMI |
| `PUMP_05_IL` | AOI_PumpInterlock | Read/Write | P-105 protection interlock instance |
| `PT201_High` | BOOL | Read Only | C-201 receiver pressure high PSH-201, set 125 psig (1 = high) |
| `C201_Run_Cmd` | BOOL | Read/Write | C-201 run command from HMI |
| `C201_Suction_PV` | REAL | Read Only | C-201 suction pressure PT-201S (psig) |
| `C201_Shutdown_Cmd` | BOOL | Read Only | C-201 high pressure shutdown command (energize to trip) |
| `C201_Motor_Run` | BOOL | Read Only | C-201 motor run output to starter M-201 |
| `C201_LP_Delay` | TIMER | Read/Write | C-201 low suction pressure trip delay |
| `C201_Low_Press_Trip` | BOOL | Read Only | C-201 low suction pressure trip |
| `LT101_HH_Alm` | ALARM_DIGITAL | Read/Write | T-101 high-high level alarm (HMI alarm summary) |
| `C201_Shutdown_Alm` | ALARM_DIGITAL | Read/Write | C-201 high pressure shutdown alarm (HMI alarm summary) |
| `ESD_Trip_Horn` | BOOL | Read Only | Control room ESD horn and beacon AH-1 |
| `Seal_Water_Low` | BOOL | Read Only | Seal water tank low level LSL-104 (1 = low) |
| `Seal_Water_Valve_Open` | BOOL | Read Only | Seal water solenoid SV-104 open command (P-104) |
| `Sump_Level_Hi` | BOOL | Read Only | Drywell sump high level LSH-120 |
| `Sump_Pump_Run` | BOOL | Read Only | Drywell sump pump SP-1 run |
| `Dusk_Sensor` | BOOL | Read Only | Yard photocell PE-1 (1 = dark) |
| `Building_Temp_Hi` | BOOL | Read Only | Pump room temperature high TSH-130 |
| `Panel_Light_Maint` | BOOL | Read Only | Maintenance mode lamp on control panel CP-1 |
| `Yard_Lights` | BOOL | Read Only | Yard lighting contactor LC-1 |
| `Exhaust_Fan_Run` | BOOL | Read Only | Pump room exhaust fan EF-1 run |
| `Pump_01_Hours` | TIMER | Read/Write | P-101 run-hour accumulator (RTO, 1 h base) |
| `Pump_02_Hours` | TIMER | Read/Write | P-102 run-hour accumulator (RTO, 1 h base) |
| `\Utilities.Lamp_Test` (program) | BOOL | Read/Write | Control panel CP-1 lamp test pushbutton |

## Scenarios

### 01 Normal maintenance change

A routine maintenance export: documentation edits, two non-safety logic tweaks, an equivalent reorder of the ESD rung and a strengthened overflow trip. Nothing needs a safety review.

Files: `l5x/baseline-safe.L5X` -> `l5x/current-normal.L5X`, manifest `manifests/northgate.safety.json`, oracle `expected/01-normal-maintenance.json`.

**What changed**

- 4 rung comments and 6 tag descriptions reworded.
- Utilities/Lighting rung 1: `XIC(Dusk_Sensor)OTE(Yard_Lights);` -> `XIC(Dusk_Sensor)XIO(Lamp_Test)OTE(Yard_Lights);`
- Reporting/Main rung 0: RTO preset 3600000 -> 1800000 (and the Pump_01_Hours PRE with it).
- Safety/ESD rung 0 reordered: `XIO(Fire_Detected)XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)OTE(MCC_Main_Enable);`
- Safety/Overflow rung 0 strengthened: `[XIC(LSHH_101) ,GRT(LT101_PV,92.0) ]OTE(XV101_Close_Cmd);`

**Why it matters.** This is what most change reviews look like. A text diff shows a rewritten ESD rung and a rewritten overflow rung; the reviewer has to convince themselves both are fine. INTERLOCK proves the ESD rung equivalent and the overflow rung stronger, so the review set is empty.

**INTERLOCK is expected to report**

- `COSMETIC_LOGIC_CHANGE` LOW on SF-01 in Safety/ESD
- `PROTECTION_STRENGTHENED` INFO on SF-05 in Safety/Overflow
- `NON_SAFETY_LOGIC_CHANGE` INFO in Utilities/Lighting
- `NON_SAFETY_LOGIC_CHANGE` INFO in Reporting/Main
- Must not report: `PROTECTIVE_PATH_REMOVED`, `NEW_INHIBIT`, `SHUTDOWN_WEAKENED`, `PROTECTIVE_OUTPUT_BYPASSED`, `ALARM_SUPPRESSED`, `PERMISSIVE_WEAKENED`, `INTERLOCK_WEAKENED`, `SETPOINT_RELAXED`, `TRIP_DELAY_INCREASED`, `EXECUTION_CONTROL_INTRODUCED`, `UNDECLARED_LOGIC_CHANGED`, `SHARED_MODULE_PROPAGATION`, `MODULE_REVISION_NOT_BUMPED`, `EXTERNAL_WRITE_ACCESS_GRANTED`, `DECLARATION_UNRESOLVED`
- Safety functions: SF-01 CHANGED_EQUIVALENT, SF-02 CHANGED_EQUIVALENT, SF-03 CHANGED_EQUIVALENT, SF-04 CHANGED_EQUIVALENT, SF-05 STRENGTHENED, SF-08 CHANGED_EQUIVALENT; others NO_CHANGE
- trust VERIFIED_SCOPE, review priority NONE, undeclared affected 0

**Reasoning**

- Safety/ESD rung 0 only reorders three series contacts (AND is commutative), so MCC_Main_Enable has the same condition: COSMETIC_LOGIC_CHANGE at LOW, naming SF-01.
- Safety/Overflow rung 0 adds a parallel branch GRT(LT101_PV,92.0) next to XIC(LSHH_101). XV101_Close_Cmd is ENERGIZE-to-trip, so the valve now closes in every case it closed before plus when the transmitter reads above 92 %: PROTECTION_STRENGTHENED (INFO) on SF-05, status STRENGTHENED.
- Utilities/Lighting rung 1 and Reporting/Main rung 0 are in programs declared non-safety and write nothing any safety function reads: two NON_SAFETY_LOGIC_CHANGE findings at INFO. The Reporting edit also moves the stored PRE of Pump_01_Hours to 1800000, because in Logix the instruction preset and the timer PRE are one value.
- Reporting reads Pump_01_Run_Enable but does not write it, so it is not in SF-02's cone.
- DISAGREES WITH THE BRIEF: the brief says "others NO_CHANGE", but ESD rung 0 is inside the cones of SF-02, SF-03 and SF-04 (MCC_Main_Enable -> ESD_Active -> each AOI ESD_Active input) and of SF-08 (XIC(MCC_Main_Enable) in Permissives). A change sits in their cones and their firing conditions are provably equivalent, which is exactly CHANGED_EQUIVALENT. Reporting NO_CHANGE would claim nothing in the cone changed. SF-06 and SF-07 cones do not include ESD rung 0 and stay NO_CHANGE.
- The 4 rung comment and 6 tag description edits are documentation only. One of them is on Pump_05_Motor_Temp_Hi, which no safety function declares: a documentation edit in undeclared scope must not produce an UNDECLARED finding.
- Nothing is REVIEW or UNDECLARED, so surface.priority is NONE and the worst finding of any disposition is LOW. Every changed rung is inside a declared cone or declared non-safety, so trust is VERIFIED_SCOPE.

### 02 Compressor shutdown weakened by maintenance mode

One contact added to the C-201 high pressure shutdown rung lets an HMI-writable maintenance flag defeat the trip, and its alarm with it.

Files: `l5x/baseline-safe.L5X` -> `l5x/current-shutdown-weakened.L5X`, manifest `manifests/northgate.safety.json`, oracle `expected/02-shutdown-weakened.json`.

**What changed**

- Compressor/Main rung 0: `XIC(PT201_High)XIC(Safety_Enable)OTE(C201_Shutdown_Cmd);` -> `XIC(PT201_High)XIC(Safety_Enable)XIO(Maintenance_Mode)OTE(C201_Shutdown_Cmd);`

**Why it matters.** A single contact, typed during a maintenance outage so the compressor could be run against a stuck pressure switch, turns a shutdown into a shutdown-unless-someone-clicked-a-button. The button is on the HMI, and the alarm that would tell the control room is driven by the same command.

**INTERLOCK is expected to report**

- `NEW_INHIBIT` CRITICAL on SF-06 in Compressor/Main naming Maintenance_Mode
- `ALARM_SUPPRESSED` >= HIGH on SF-06 naming Maintenance_Mode
- Must not report: `PROTECTION_STRENGTHENED`, `COSMETIC_LOGIC_CHANGE`, `UNDECLARED_LOGIC_CHANGED`, `NON_SAFETY_LOGIC_CHANGE`, `SHARED_MODULE_PROPAGATION`, `PROTECTIVE_PATH_REMOVED`, `PROTECTIVE_OUTPUT_BYPASSED`, `EXTERNAL_WRITE_ACCESS_GRANTED`
- Safety functions: SF-06 IMPACTED; others NO_CHANGE
- trust VERIFIED_SCOPE, review priority CRITICAL, undeclared affected 0

**Reasoning**

- C201_Shutdown_Cmd is ENERGIZE-to-trip. Before: fires when PT201_High AND Safety_Enable. After: PT201_High AND Safety_Enable AND NOT Maintenance_Mode. Witness: PT201_High=1, Safety_Enable=1, Maintenance_Mode=1 fired before and does not fire now.
- Maintenance_Mode is a new atom that only removes firing cases, it is ExternalAccess Read/Write and no logic writes it (Utilities only reads it for a lamp): an HMI or OPC client can defeat the shutdown. NEW_INHIBIT, CRITICAL because SF-06 is CRITICAL.
- Compressor runs before Alarms in MainTask, so C201_Shutdown_Alm's rung-in XIC(C201_Shutdown_Cmd) sees this scan's value: the alarm loses exactly the same cases. ALARM_SUPPRESSED on SF-06 with suppressor Maintenance_Mode, at least HIGH: in exactly the cases where the shutdown no longer acts, the control room is not told either.
- No other function reads C201_Shutdown_Cmd or Maintenance_Mode, so only SF-06 is IMPACTED. The changed rung is inside SF-06's cone, so no UNDECLARED finding and trust stays VERIFIED_SCOPE.

### 03 High-high level alarm suppressed

A "temporary" nuisance-alarm inhibit is wired into the T-101 high-high alarm. The overflow valve still closes; the control room is no longer told.

Files: `l5x/baseline-safe.L5X` -> `l5x/current-alarm-suppressed.L5X`, manifest `manifests/northgate.safety.json`, oracle `expected/03-alarm-suppressed.json`.

**What changed**

- New controller tag `High_Level_Inhibit` (BOOL, Read/Write, "Nuisance alarm inhibit (temporary)").
- Alarms/Main rung 0: `ALMD(LT101_HH_Alm,0,0,0,0)` -> `ALMD(LT101_HH_Alm,0,0,High_Level_Inhibit,0)` (ProgDisable operand).

**Why it matters.** Chattering floats get inhibited; "temporary" inhibits stay. The inlet valve still closes, so a functional test of the valve passes, but the operator will not hear about a high-high wet well.

**INTERLOCK is expected to report**

- `ALARM_SUPPRESSED` CRITICAL on SF-07 in Alarms/Main naming High_Level_Inhibit
- Must not report: `NEW_INHIBIT`, `PROTECTIVE_PATH_REMOVED`, `SHUTDOWN_WEAKENED`, `PROTECTIVE_OUTPUT_BYPASSED`, `UNDECLARED_LOGIC_CHANGED`, `NON_SAFETY_LOGIC_CHANGE`, `COSMETIC_LOGIC_CHANGE`, `PROTECTION_STRENGTHENED`, `SHARED_MODULE_PROPAGATION`
- Safety functions: SF-07 IMPACTED; others NO_CHANGE
- trust VERIFIED_SCOPE, review priority CRITICAL, undeclared affected 0

**Reasoning**

- The ALMD operands are AlarmTag, ProgAck, ProgReset, ProgDisable, ProgEnable. High_Level_Inhibit now sits in the ProgDisable position, so while it is set the T-101 high-high alarm is disabled even though LSHH-101 is made.
- High_Level_Inhibit is a new controller tag, ExternalAccess Read/Write, written by no logic: an HMI or OPC client sets it. ALARM_SUPPRESSED, CRITICAL, on SF-07 with suppressor High_Level_Inhibit.
- SF-07 is an ALARM function with no protective output, so this is not a NEW_INHIBIT on a protective output.
- SF-05 also uses LSHH_101 but its rung (Safety/Overflow) is untouched and nothing it reads changed: XV-101 still closes. SF-05 NO_CHANGE is the point of the scenario: the protection works, the operator is not told.

### 04 Shared pump interlock AOI modified

AOI_PumpInterlock gains an optional maintenance bypass that defeats every trip. One edit to one block reaches five pumps, three of them safety functions.

Files: `l5x/baseline-safe.L5X` -> `l5x/current-aoi-modified.L5X`, manifest `manifests/northgate.safety.json`, oracle `expected/04-aoi-modified.json`.

**What changed**

- AOI_PumpInterlock Revision 3.4 -> 3.5; new parameter `Maint_Bypass` (Input, Required=false, Visible=true).
- AOI Logic rung 0: `[...]OTE(Trip);` -> `[...]XIO(Maint_Bypass)OTE(Trip);`
- Every instance tag gains a Maint_Bypass member (Logix updates instance data with the definition).

**Why it matters.** Reusable blocks multiply a change. The routine diff is one rung in one AOI; the effect is a writable bypass of every trip on five pumps, three of which carry declared safety functions.

**INTERLOCK is expected to report**

- `SHARED_MODULE_PROPAGATION` on SF-02, SF-03, SF-04 module AOI_PumpInterlock
- `NEW_INHIBIT` CRITICAL on SF-02, SF-03, SF-04 module AOI_PumpInterlock naming Maint_Bypass
- `ALARM_SUPPRESSED` on SF-02 naming Maint_Bypass
- Must not report: `MODULE_REVISION_NOT_BUMPED`, `PROTECTION_STRENGTHENED`, `COSMETIC_LOGIC_CHANGE`, `NON_SAFETY_LOGIC_CHANGE`, `PROTECTIVE_OUTPUT_BYPASSED`, `PROTECTIVE_PATH_REMOVED`
- Safety functions: SF-02 IMPACTED, SF-03 IMPACTED, SF-04 IMPACTED; others NO_CHANGE
- review priority CRITICAL, blast radius 5

**Reasoning**

- AOI_PumpInterlock Logic rung 0 becomes [...]XIO(Maint_Bypass)OTE(Trip): with Maint_Bypass set, Trip is false whatever the trip causes say, so Run_Enable = Run_Request and every protective input is defeated.
- Maint_Bypass is Required=false, so no call site passes it: it lives in each backing tag (PUMP_0n_IL.Maint_Bypass), the instance tags are Read/Write, and no logic writes it. It is an externally writable inhibit in every instance.
- The block has 5 call sites. PUMP_01..03 implement SF-02, SF-03 and SF-04 (safety-relevant); PUMP_04 and PUMP_05 are operational. SHARED_MODULE_PROPAGATION with blast radius 5 / 3 / 2.
- NEW_INHIBIT, CRITICAL, module AOI_PumpInterlock, covering SF-02, SF-03 and SF-04 (one module-level finding or one per function both satisfy the oracle).
- SF-02 declares Pump_01_Shutdown_Alarm, which follows PUMP_01_IL.Shutdown_Alarm = Trip: the bypass also silences that alarm, so ALARM_SUPPRESSED on SF-02. SF-03 and SF-04 declare no alarm.
- The revision was bumped 3.4 -> 3.5, so MODULE_REVISION_NOT_BUMPED must not appear. SF-01, SF-05..SF-08 read nothing the block writes and stay NO_CHANGE.

### 05 Protective output bypassed from non-safety code

A commissioning routine added to the non-safety Utilities program latches P-101's run enable on from the HMI, after the interlock has already decided.

Files: `l5x/baseline-safe.L5X` -> `l5x/current-protective-bypass.L5X`, manifest `manifests/northgate.safety.json`, oracle `expected/05-protective-bypass.json`.

**What changed**

- New controller tag `Pump_01_Manual_Override` (BOOL, Read/Write).
- New routine Utilities/Commissioning rung 0: `XIC(Pump_01_Manual_Override)OTL(Pump_01_Run_Enable);`
- Utilities/Main rung 2 appended: `JSR(Commissioning,0);`

**Why it matters.** Commissioning aids outlive commissioning. The interlock is untouched and still computes the right answer; a later program in the same scan overwrites it. Because Utilities is declared non-safety, a reviewer filtering by program would never look.

**INTERLOCK is expected to report**

- `PROTECTIVE_OUTPUT_BYPASSED` CRITICAL on SF-02 in Utilities/Commissioning naming Pump_01_Manual_Override
- Must not report: `ALARM_SUPPRESSED`, `PROTECTION_STRENGTHENED`, `COSMETIC_LOGIC_CHANGE`, `SHARED_MODULE_PROPAGATION`, `PROTECTIVE_PATH_REMOVED`, `MODULE_REVISION_NOT_BUMPED`
- Safety functions: SF-02 IMPACTED; others NO_CHANGE
- review priority CRITICAL

**Reasoning**

- Utilities runs after PumpControl in MainTask. Each scan the AOI writes Pump_01_Run_Enable from its trip logic, then Utilities/Commissioning OTLs it back to 1 whenever Pump_01_Manual_Override is set. The final value is Override OR (Run_Request AND NOT Trip): with the override set, SF-02 can never de-energize P-101.
- Pump_01_Manual_Override is a new Read/Write tag written by no logic. PROTECTIVE_OUTPUT_BYPASSED, CRITICAL, on SF-02, located in Utilities/Commissioning, naming the override tag.
- The writer sits in a program declared non-safety, which is the reason the declaration cannot be trusted at face value; it must not be reported only as an INFO non-safety change.
- Pump_01_Shutdown_Alarm still follows the AOI's Trip, so the operator is still told about the trip the pump ignores: no ALARM_SUPPRESSED.
- Only SF-02 is IMPACTED; no other function reads Pump_01_Run_Enable.

### 06 Undeclared logic changed

Three edits in logic no safety function declares: seal water, sump and a pump alarm rung. INTERLOCK cannot call them safe, so it asks for review.

Files: `l5x/baseline-safe.L5X` -> `l5x/current-undeclared-change.L5X`, manifest `manifests/northgate.safety.json`, oracle `expected/06-undeclared-change.json`.

**What changed**

- Auxiliary/SealWater rung 0: `XIO(Seal_Water_Low)` removed.
- Auxiliary/Sump rung 0: `XIO(Sump_Pump_Fault)` added (new tag `Sump_Pump_Fault`).
- PumpControl/PUMP_05 rung 1 (`XIC(PUMP_05_IL.Shutdown_Alarm)OTE(Pump_05_Shutdown_Alarm);`) deleted.

**Why it matters.** Safety manifests are never complete. Logic nobody declared is exactly where an unreviewed change hides; INTERLOCK reports it as undeclared rather than clean.

**INTERLOCK is expected to report**

- `UNDECLARED_LOGIC_CHANGED` in Auxiliary/SealWater
- `UNDECLARED_LOGIC_CHANGED` in Auxiliary/Sump
- `UNDECLARED_LOGIC_CHANGED` in PumpControl/PUMP_05
- Must not report: `PROTECTIVE_PATH_REMOVED`, `NEW_INHIBIT`, `SHUTDOWN_WEAKENED`, `PROTECTIVE_OUTPUT_BYPASSED`, `ALARM_SUPPRESSED`, `PERMISSIVE_WEAKENED`, `INTERLOCK_WEAKENED`, `SETPOINT_RELAXED`, `TRIP_DELAY_INCREASED`, `EXECUTION_CONTROL_INTRODUCED`, `PROTECTION_STRENGTHENED`, `COSMETIC_LOGIC_CHANGE`, `SHARED_MODULE_PROPAGATION`, `NON_SAFETY_LOGIC_CHANGE`
- Safety functions: all NO_CHANGE
- trust REVIEW_REQUIRED, undeclared affected 3

**Reasoning**

- Auxiliary is neither declared safety nor declared non-safety. SealWater loses XIO(Seal_Water_Low): SV-104 now opens with the seal water tank empty. Sump gains XIO(Sump_Pump_Fault). Both are outside every declared cone.
- PumpControl/PUMP_05 rung 1 (Pump_05_Shutdown_Alarm) is deleted. PUMP_05 is in a program that implements safety functions, but no declared function covers P-105, so this is undeclared too.
- INTERLOCK must not call any of these safe: three UNDECLARED_LOGIC_CHANGED findings (one per routine), undeclaredAffected = 3, trust REVIEW_REQUIRED.
- No declared function's cone contains these rungs (SealWater reads Pump_04_Run_Enable but SF-02..SF-04 cover P-101..P-103), so every function is NO_CHANGE and no weakening type may appear.

### 07 AOI drift across three sites

The same pump interlock block at three stations: one edited in place without a revision bump, one two revisions behind, and a valve block only one site has.

Files: Site A `l5x/site-a.L5X`, Site B `l5x/site-b-drift.L5X`, Site C `l5x/site-c-legacy.L5X`; oracle `expected/07-site-drift.json`.

**What changed**

- Site A (Northgate): AOI_PumpInterlock 3.4, identical to the approved baseline.
- Site B (Eastfield): still "3.4", but rung 0 lost `,XIC(Motor_Temp_Hi) `; EditedBy shows a site integrator account.
- Site C (Riverbend): v33 project, AOI 3.1 without the ESD_Active input (call sites pass one argument fewer), an extra AOI_ValveCtl 1.0, and documentation exported as LocalizedDescription / LocalizedComment.

**Why it matters.** Fleet owners assume a block with the same name and revision behaves the same everywhere. A revision number is a label someone types; only the logic says what the block does.

**INTERLOCK is expected to report**

- `AOI_PumpInterlock`: DRIFT; flags REVISION_NOT_BUMPED, OLDER_REVISION, SAFETY_BEHAVIOR_DIFFERS; Site A REFERENCE, Site B WEAKER, Site C WEAKER
- `AOI_ValveCtl`: flags MISSING_AT_SITE; missing at Site A, Site B

**Reasoning**

- Site A carries AOI_PumpInterlock 3.4 exactly as the approved baseline and is the reference.
- Site B still says Revision 3.4 but rung 0 lost XIC(Motor_Temp_Hi): same name and revision, different body (REVISION_NOT_BUMPED). Its Trip, and so Run_Enable's trip and Shutdown_Alarm, fire in fewer cases: Motor_Temp_Hi=1 with every other cause clear trips at A and not at B. WEAKER.
- Site C carries 3.1, which predates the ESD_Active input (OLDER_REVISION). With ESD_Active=1 and every other cause clear, A trips and C does not. WEAKER.
- Both differences remove trip cases from an output a safety function depends on, so SAFETY_BEHAVIOR_DIFFERS. SAME_NAME_DIFFERENT_DEFINITION is also true and may appear; it is not required.
- AOI_ValveCtl exists only in Site C's library (defined, not called): missingAt Site A and Site B.
- Site C is exported with documentation languages enabled (LocalizedDescription / LocalizedComment); that is a parser variant, not a drift.

### 08 Large noisy export with three logic changes

A 24-pump export with about 425 changes, almost all documentation and stored values. Three are logic, and one of them relaxes a safety setpoint.

Files: `l5x/baseline-large.L5X` -> `l5x/current-large.L5X`, manifest `manifests/northgate-large.safety.json`, oracle `expected/08-large-noisy.json`.

**What changed**

- 24 pumps (PUMP_01..PUMP_24) and 300 extra instrument tags; SF-02..SF-04 still cover P-101..P-103 only.
- 340 tag descriptions and 60 rung comments revised in a documentation pass; 20 stored process values drifted between uploads.
- Safety/Permissives: `GRT(Suction_Press_PV,12.0)` -> `GRT(Suction_Press_PV,8.0)`.
- Compressor/Main rung 2: `TON(C201_LP_Delay,2000,0)` -> `TON(C201_LP_Delay,10000,0)` (and the timer PRE).
- Safety/ESD rung 0: the equivalent reorder from scenario 01.

**Why it matters.** Real exports are noisy. A line diff of these two files is about 450 lines; three matter, one of them is a safety setpoint and one is a trip delay nobody declared.

**INTERLOCK is expected to report**

- `SETPOINT_RELAXED` HIGH on SF-08 in Safety/Permissives
- `UNDECLARED_LOGIC_CHANGED` in Compressor/Main
- `COSMETIC_LOGIC_CHANGE` on SF-01 in Safety/ESD
- Must not report: `NEW_INHIBIT`, `PROTECTIVE_PATH_REMOVED`, `SHUTDOWN_WEAKENED`, `PROTECTIVE_OUTPUT_BYPASSED`, `ALARM_SUPPRESSED`, `SHARED_MODULE_PROPAGATION`, `MODULE_REVISION_NOT_BUMPED`, `NON_SAFETY_LOGIC_CHANGE`, `EXECUTION_CONTROL_INTRODUCED`, `PROTECTION_STRENGTHENED`
- Safety functions: SF-01 CHANGED_EQUIVALENT, SF-02 CHANGED_EQUIVALENT, SF-03 CHANGED_EQUIVALENT, SF-04 CHANGED_EQUIVALENT, SF-08 IMPACTED; others NO_CHANGE
- trust REVIEW_REQUIRED, review priority HIGH, undeclared affected 1

**Reasoning**

- Of roughly 425 changes, 400 are documentation (340 tag descriptions, 60 rung comments), 20 are drifted process values, 1 is the C201_LP_Delay PRE that moves with its TON preset, and 2 are export dates. Exactly three rungs change.
- Safety/Permissives GRT(Suction_Press_PV,12.0) -> 8.0: the permissive (DE_ENERGIZE) used to drop for suction pressure in (8, 12] psig and no longer does. SETPOINT_RELAXED at HIGH on SF-08 (a HIGH function).
- Compressor/Main rung 2 TON preset 2000 -> 10000 delays C201_Low_Press_Trip from 2 s to 10 s. No declared function's cone contains it (SF-06 depends only on rung 0), so UNDECLARED_LOGIC_CHANGED; the tag name contains "Trip", which a name hint should surface.
- Safety/ESD rung 0 is the same commutative reorder as scenario 01: COSMETIC_LOGIC_CHANGE naming SF-01, and SF-01..SF-04 are CHANGED_EQUIVALENT for the cone reason explained in scenario 01. SF-08 also contains the reorder but its setpoint was relaxed, so IMPACTED.
- Documentation edits land in every cone, including SF-05, SF-06 and SF-07; they never change a status, so those stay NO_CHANGE.
- One undeclared routine changed, so trust is REVIEW_REQUIRED and undeclaredAffected = 1. The worst REVIEW finding is the HIGH setpoint relaxation.

### 09 Protective paths removed

The fire panel trip is removed from the ESD and the P-103 routine is no longer called. Two protective paths disappear, and the ESD change reaches every pump.

Files: `l5x/baseline-safe.L5X` -> `l5x/current-path-removed.L5X`, manifest `manifests/northgate.safety.json`, oracle `expected/09-path-removed.json`.

**What changed**

- Safety/ESD rung 0: `XIO(Fire_Detected)` removed.
- PumpControl/Main: `JSR(PUMP_03,0);` deleted (later rungs renumber).

**Why it matters.** Deleting is quieter than adding. Nothing new appears in the diff that looks dangerous: a contact and a call are simply gone, and with them the fire trip for the whole station and every trip on P-103.

**INTERLOCK is expected to report**

- `PROTECTIVE_PATH_REMOVED` CRITICAL on SF-01 in Safety/ESD naming Fire_Detected
- `PROTECTIVE_PATH_REMOVED` >= HIGH on SF-04
- `PROTECTIVE_PATH_REMOVED or SHUTDOWN_WEAKENED or INTERLOCK_WEAKENED or PERMISSIVE_WEAKENED` on SF-02, SF-03, SF-08
- Must not report: `NEW_INHIBIT`, `PROTECTION_STRENGTHENED`, `COSMETIC_LOGIC_CHANGE`, `NON_SAFETY_LOGIC_CHANGE`, `SHARED_MODULE_PROPAGATION`, `MODULE_REVISION_NOT_BUMPED`
- Safety functions: SF-01 IMPACTED, SF-02 IMPACTED, SF-03 IMPACTED, SF-04 IMPACTED, SF-08 IMPACTED; others NO_CHANGE
- review priority CRITICAL

**Reasoning**

- Safety/ESD rung 0 loses XIO(Fire_Detected): a fire panel alarm no longer drops MCC_Main_Enable. Fire_Detected disappears from SF-01's firing condition: PROTECTIVE_PATH_REMOVED, CRITICAL, naming Fire_Detected.
- JSR(PUMP_03,0) is deleted from PumpControl/Main, so PUMP_03 and the PUMP_03_IL call never execute. Pump_03_Run_Enable is no longer written and holds its last value: SF-04 cannot trip at all. PROTECTIVE_PATH_REMOVED on SF-04, at least HIGH (SF-04 is HIGH).
- BEYOND THE BRIEF: the ESD change propagates. ESD_Active = NOT MCC_Main_Enable feeds every pump interlock, so P-101 and P-102 no longer trip on fire (SF-02, SF-03), and Pump_Start_Permissive reads MCC_Main_Enable, so pumps may start during a fire (SF-08). Each loses the Fire_Detected case: a weakening finding of a path-removed or weakened type must name SF-02, SF-03 and SF-08, and all three are IMPACTED.
- SF-01's alarm ESD_Trip_Horn = NOT MCC_Main_Enable also no longer sounds on fire. The oracle does not require a separate alarm finding for it because the root-cause finding above already covers the same cause.
- SF-05, SF-06 and SF-07 read nothing that changed and stay NO_CHANGE. No atom was added, so NEW_INHIBIT must not appear.

## Where the oracle departs from the build brief

- **01 and 08, SF-02/03/04/08 status.** The brief lists them as NO_CHANGE. Safety/ESD rung 0 is in their dependency cones (MCC_Main_Enable -> ESD_Active -> every pump interlock; MCC_Main_Enable -> Pump_Start_Permissive), so after an equivalent edit their status is CHANGED_EQUIVALENT.
- **09, propagation.** The brief names SF-01 and SF-04. Removing the fire trip from the ESD also removes it from P-101, P-102 and the start permissive, so SF-02, SF-03 and SF-08 are IMPACTED as well.
