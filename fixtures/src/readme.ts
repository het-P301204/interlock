/**
 * fixtures/README.md, generated so the plant map can never drift from the
 * fixtures. Prose is written here by hand; tables come from the model.
 */
import type { SafetyManifest } from '../../packages/core/src/model/safety.ts'
import type { ControllerModel, Expected, ExpectedFinding, ScenarioRegistry, TagDef } from './types.ts'

function cell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function code(text: string): string {
  return '`' + text + '`'
}

const CHANGES: Record<string, { changed: string[]; matters: string }> = {
  '01': {
    changed: [
      '4 rung comments and 6 tag descriptions reworded.',
      'Utilities/Lighting rung 1: `XIC(Dusk_Sensor)OTE(Yard_Lights);` -> `XIC(Dusk_Sensor)XIO(Lamp_Test)OTE(Yard_Lights);`',
      'Reporting/Main rung 0: RTO preset 3600000 -> 1800000 (and the Pump_01_Hours PRE with it).',
      'Safety/ESD rung 0 reordered: `XIO(Fire_Detected)XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)OTE(MCC_Main_Enable);`',
      'Safety/Overflow rung 0 strengthened: `[XIC(LSHH_101) ,GRT(LT101_PV,92.0) ]OTE(XV101_Close_Cmd);`',
    ],
    matters: 'This is what most change reviews look like. A text diff shows a rewritten ESD rung and a rewritten overflow rung; the reviewer has to convince themselves both are fine. INTERLOCK proves the ESD rung equivalent and the overflow rung stronger, so the review set is empty.',
  },
  '02': {
    changed: ['Compressor/Main rung 0: `XIC(PT201_High)XIC(Safety_Enable)OTE(C201_Shutdown_Cmd);` -> `XIC(PT201_High)XIC(Safety_Enable)XIO(Maintenance_Mode)OTE(C201_Shutdown_Cmd);`'],
    matters: 'A single contact, typed during a maintenance outage so the compressor could be run against a stuck pressure switch, turns a shutdown into a shutdown-unless-someone-clicked-a-button. The button is on the HMI, and the alarm that would tell the control room is driven by the same command.',
  },
  '03': {
    changed: ['New controller tag `High_Level_Inhibit` (BOOL, Read/Write, "Nuisance alarm inhibit (temporary)").', 'Alarms/Main rung 0: `ALMD(LT101_HH_Alm,0,0,0,0)` -> `ALMD(LT101_HH_Alm,0,0,High_Level_Inhibit,0)` (ProgDisable operand).'],
    matters: 'Chattering floats get inhibited; "temporary" inhibits stay. The inlet valve still closes, so a functional test of the valve passes, but the operator will not hear about a high-high wet well.',
  },
  '04': {
    changed: [
      'AOI_PumpInterlock Revision 3.4 -> 3.5; new parameter `Maint_Bypass` (Input, Required=false, Visible=true).',
      'AOI Logic rung 0: `[...]OTE(Trip);` -> `[...]XIO(Maint_Bypass)OTE(Trip);`',
      'Every instance tag gains a Maint_Bypass member (Logix updates instance data with the definition).',
    ],
    matters: 'Reusable blocks multiply a change. The routine diff is one rung in one AOI; the effect is a writable bypass of every trip on five pumps, three of which carry declared safety functions.',
  },
  '05': {
    changed: ['New controller tag `Pump_01_Manual_Override` (BOOL, Read/Write).', 'New routine Utilities/Commissioning rung 0: `XIC(Pump_01_Manual_Override)OTL(Pump_01_Run_Enable);`', 'Utilities/Main rung 2 appended: `JSR(Commissioning,0);`'],
    matters: 'Commissioning aids outlive commissioning. The interlock is untouched and still computes the right answer; a later program in the same scan overwrites it. Because Utilities is declared non-safety, a reviewer filtering by program would never look.',
  },
  '06': {
    changed: [
      'Auxiliary/SealWater rung 0: `XIO(Seal_Water_Low)` removed.',
      'Auxiliary/Sump rung 0: `XIO(Sump_Pump_Fault)` added (new tag `Sump_Pump_Fault`).',
      'PumpControl/PUMP_05 rung 1 (`XIC(PUMP_05_IL.Shutdown_Alarm)OTE(Pump_05_Shutdown_Alarm);`) deleted.',
    ],
    matters: 'Safety manifests are never complete. Logic nobody declared is exactly where an unreviewed change hides; INTERLOCK reports it as undeclared rather than clean.',
  },
  '07': {
    changed: [
      'Site A (Northgate): AOI_PumpInterlock 3.4, identical to the approved baseline.',
      'Site B (Eastfield): still "3.4", but rung 0 lost `,XIC(Motor_Temp_Hi) `; EditedBy shows a site integrator account.',
      'Site C (Riverbend): v33 project, AOI 3.1 without the ESD_Active input (call sites pass one argument fewer), an extra AOI_ValveCtl 1.0, and documentation exported as LocalizedDescription / LocalizedComment.',
    ],
    matters: 'Fleet owners assume a block with the same name and revision behaves the same everywhere. A revision number is a label someone types; only the logic says what the block does.',
  },
  '08': {
    changed: [
      '24 pumps (PUMP_01..PUMP_24) and 300 extra instrument tags; SF-02..SF-04 still cover P-101..P-103 only.',
      '340 tag descriptions and 60 rung comments revised in a documentation pass; 20 stored process values drifted between uploads.',
      'Safety/Permissives: `GRT(Suction_Press_PV,12.0)` -> `GRT(Suction_Press_PV,8.0)`.',
      'Compressor/Main rung 2: `TON(C201_LP_Delay,2000,0)` -> `TON(C201_LP_Delay,10000,0)` (and the timer PRE).',
      'Safety/ESD rung 0: the equivalent reorder from scenario 01.',
    ],
    matters: 'Real exports are noisy. A line diff of these two files is about 450 lines; three matter, one of them is a safety setpoint and one is a trip delay nobody declared.',
  },
  '09': {
    changed: ['Safety/ESD rung 0: `XIO(Fire_Detected)` removed.', 'PumpControl/Main: `JSR(PUMP_03,0);` deleted (later rungs renumber).'],
    matters: 'Deleting is quieter than adding. Nothing new appears in the diff that looks dangerous: a contact and a call are simply gone, and with them the fire trip for the whole station and every trip on P-103.',
  },
}

function findingLine(f: ExpectedFinding): string {
  const type = Array.isArray(f.type) ? f.type.join(' or ') : f.type
  const parts = [code(type)]
  if (f.severity !== undefined) parts.push(f.severity)
  else if (f.minSeverity !== undefined) parts.push(`>= ${f.minSeverity}`)
  if (f.safetyFunctionIds.length > 0) parts.push(`on ${f.safetyFunctionIds.join(', ')}`)
  if (f.module !== undefined) parts.push(`module ${f.module}`)
  if (f.program !== undefined) parts.push(`in ${f.program}${f.routine !== undefined ? '/' + f.routine : ''}`)
  const labels = [...(f.inhibitLabels ?? []), ...(f.suppressorLabels ?? []), ...(f.causeLabels ?? [])]
  if (labels.length > 0) parts.push(`naming ${labels.join(', ')}`)
  return parts.join(' ')
}

function expectedSection(e: Expected): string[] {
  const out: string[] = []
  if ('drift' in e) {
    for (const [module, d] of Object.entries(e.drift)) {
      const bits: string[] = []
      if (d.status !== undefined) bits.push(d.status)
      if (d.flags !== undefined) bits.push(`flags ${d.flags.join(', ')}`)
      if (d.variants !== undefined) bits.push(Object.entries(d.variants).map(([s, b]) => `${s} ${b}`).join(', '))
      if (d.missingAt !== undefined) bits.push(`missing at ${d.missingAt.join(', ')}`)
      out.push(`- ${code(module)}: ${bits.join('; ')}`)
    }
    return out
  }
  for (const f of e.findings.mustInclude) out.push(`- ${findingLine(f)}`)
  if (e.findings.mustNotIncludeTypes.length > 0) out.push(`- Must not report: ${e.findings.mustNotIncludeTypes.map(code).join(', ')}`)
  const changed = Object.entries(e.safetyStatus).filter(([, s]) => s !== 'NO_CHANGE')
  out.push(`- Safety functions: ${changed.length === 0 ? 'all NO_CHANGE' : changed.map(([id, s]) => `${id} ${s}`).join(', ') + '; others NO_CHANGE'}`)
  const extra: string[] = []
  if (e.trust !== undefined) extra.push(`trust ${e.trust}`)
  if (e.priority !== undefined) extra.push(`review priority ${e.priority}`)
  if (e.surface?.undeclaredAffected !== undefined) extra.push(`undeclared affected ${e.surface.undeclaredAffected}`)
  if (e.surface?.blastRadius !== undefined) extra.push(`blast radius ${e.surface.blastRadius}`)
  if (extra.length > 0) out.push(`- ${extra.join(', ')}`)
  return out
}

function tagRow(t: TagDef): string {
  const type = t.aliasFor !== undefined ? `alias -> ${t.aliasFor}` : t.dataType
  return `| ${code(t.name)} | ${cell(type)} | ${t.externalAccess} | ${cell(t.description)} |`
}

export function readme(base: ControllerModel, manifest: SafetyManifest, registry: ScenarioRegistry, expected: Map<string, Expected>): string {
  const L: string[] = []
  L.push('# INTERLOCK fixtures: Northgate Pump Station', '')
  L.push(
    '> **Synthetic.** Northgate Water Authority, its stations (Northgate, Eastfield, Riverbend), tag names, drawing numbers and values are invented for demonstration. No file here was exported from a real controller or describes a real site.',
    '',
  )
  L.push('This directory is **generated**. Edit `fixtures/src/*.ts`, then run `npm run fixtures` (write) or `npm run fixtures:check` (CI: exit 1 if anything on disk differs). Do not hand-edit the outputs.', '')
  L.push('| Path | What |', '|---|---|')
  L.push('| `l5x/` | L5X exports laid out like Logix Designer v35 full-controller exports |')
  L.push('| `manifests/` | Engineer-declared safety functions (`interlock.safety/v1`) |')
  L.push('| `expected/` | Hand-written expected findings per scenario: the engine\'s test oracle, with a `why` line per expectation |')
  L.push('| `scenarios.json` | Scenario registry (`interlock.scenarios/v1`) read by the UI, API, CLI and tests |')
  L.push('| `src/` | Plant model, L5X writer, scenario mutations, large-plant generator (seeded PRNG) |', '')

  L.push('## The plant', '')
  L.push(
    'Northgate is a wastewater lift station run by a water utility. Inflow arrives through inlet valve XV-101 into wet well T-101 (level transmitter LT-101, high-high float LSHH-101). Five wet well pumps P-101..P-105 lift it to the force main; each pump\'s run enable goes to a starter in MCC-1 and passes through one instance of the standard NWA block `AOI_PumpInterlock`. Air compressor C-201 supplies bubbler and instrument air and has its own high pressure shutdown (PSH-201). A gatehouse ESD pushbutton, the E-stop loop and the fire panel FACP-1 drop MCC-1 through the ESD routine.',
    '',
  )
  L.push(`Controller ${code(base.name)}, ${base.processorType}, firmware ${base.majorRev}.${base.minorRev}, exported by Logix Designer ${base.softwareRevision}.`, '')

  L.push('### Scan order', '', '| Task | Type | Programs in order |', '|---|---|---|')
  for (const t of base.tasks) L.push(`| ${code(t.name)} | ${t.type}${t.rate !== undefined ? ` ${t.rate} ms` : ''}, priority ${t.priority} | ${t.programs.join(', ')} |`)
  L.push('')

  L.push('### Safety functions (`manifests/northgate.safety.json`)', '', '| Id | Function | Kind | Criticality | Implemented in | Protective output | Alarm |', '|---|---|---|---|---|---|---|')
  for (const f of manifest.functions) {
    const impl = [f.implementation.program, f.implementation.routine].filter((x) => x !== undefined).join('/') + (f.implementation.instance !== undefined ? ` (${f.implementation.instance})` : '')
    const out = f.protectiveOutput !== undefined ? `${code(f.protectiveOutput.tag)} ${f.protectiveOutput.tripState}` : '-'
    const alarm = f.alarm !== undefined ? code(f.alarm.tag) : '-'
    L.push(`| ${f.id} | ${cell(f.name)} | ${f.kind} | ${f.criticality} | ${cell(impl)} | ${out} | ${alarm} |`)
  }
  L.push('', `Declared non-safety: ${(manifest.nonSafetyScope?.programs ?? []).join(', ')}. \`Auxiliary\` is declared neither way, so changes there are UNDECLARED.`, '')

  L.push('### Routines', '')
  for (const p of base.programs) {
    L.push(`#### ${p.name}`, '', cell(p.description), '', '| Routine | Rung | Text | Comment |', '|---|---|---|---|')
    for (const r of p.routines) r.rungs.forEach((g, i) => L.push(`| ${r.name} | ${i} | ${code(g.text)} | ${cell(g.comment ?? '')} |`))
    L.push('')
  }

  for (const a of base.aois) {
    L.push(`### ${a.name} ${a.revision}`, '', cell(a.description), '', '| Parameter | Usage | Required | Description |', '|---|---|---|---|')
    for (const p of a.parameters) L.push(`| ${code(p.name)} | ${p.usage} | ${p.required ? 'yes' : 'no'} | ${cell(p.description)} |`)
    L.push('', '| Rung | Text |', '|---|---|')
    for (const r of a.routines) r.rungs.forEach((g, i) => L.push(`| ${i} | ${code(g.text)} |`))
    L.push('', 'An AOI call passes the backing tag, then the required parameters in declaration order: `AOI_PumpInterlock(PUMP_01_IL,Pump_01_Run_Request,LSHH_101,Pump_01_Disch_Press_Hi,Pump_01_Motor_Temp_Hi,ESD_Active,Pump_01_Run_Enable);`. Shutdown_Alarm is optional and read as `PUMP_01_IL.Shutdown_Alarm`.', '')
  }

  L.push('### Controller tags', '', '| Tag | Type | External access | Description |', '|---|---|---|---|')
  for (const t of base.tags) L.push(tagRow(t))
  for (const p of base.programs) for (const t of p.tags) L.push(`| ${code(`\\${p.name}.${t.name}`)} (program) | ${t.dataType} | ${t.externalAccess} | ${cell(t.description)} |`)
  L.push('')

  L.push('## Scenarios', '')
  for (const s of registry.scenarios) {
    L.push(`### ${s.id} ${s.title}`, '', s.summary, '')
    if (s.kind === 'compare') L.push(`Files: ${code(s.baseline ?? '')} -> ${code(s.current ?? '')}, manifest ${code(s.manifest)}, oracle ${code(s.expected)}.`, '')
    else L.push(`Files: ${(s.sites ?? []).map((x) => `${x.label} ${code(x.file)}`).join(', ')}; oracle ${code(s.expected)}.`, '')
    const c = CHANGES[s.id]
    if (c !== undefined) {
      L.push('**What changed**', '')
      for (const line of c.changed) L.push(`- ${line}`)
      L.push('', `**Why it matters.** ${c.matters}`, '')
    }
    const e = expected.get(s.id)
    if (e !== undefined) {
      L.push('**INTERLOCK is expected to report**', '')
      L.push(...expectedSection(e))
      L.push('', '**Reasoning**', '')
      for (const w of e.why) L.push(`- ${w}`)
      L.push('')
    }
  }

  L.push('## Where the oracle departs from the build brief', '')
  L.push(
    '- **01 and 08, SF-02/03/04/08 status.** The brief lists them as NO_CHANGE. Safety/ESD rung 0 is in their dependency cones (MCC_Main_Enable -> ESD_Active -> every pump interlock; MCC_Main_Enable -> Pump_Start_Permissive), so after an equivalent edit their status is CHANGED_EQUIVALENT.',
    '- **09, propagation.** The brief names SF-01 and SF-04. Removing the fire trip from the ESD also removes it from P-101, P-102 and the start permissive, so SF-02, SF-03 and SF-08 are IMPACTED as well.',
    '',
  )
  return L.join('\n')
}
