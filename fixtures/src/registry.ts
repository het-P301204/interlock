/**
 * The scenario registry the UI, API, CLI and engine tests read. Paths are
 * relative to fixtures/.
 */
import type { ScenarioEntry, ScenarioRegistry } from './types.ts'

const MANIFEST = 'manifests/northgate.safety.json'
const BASELINE = 'l5x/baseline-safe.L5X'

function compare(id: string, slug: string, title: string, current: string, summary: string, highlights: string[], baseline = BASELINE, manifest = MANIFEST): ScenarioEntry {
  return { id, slug, title, summary, kind: 'compare', baseline, current, manifest, expected: `expected/${id}-${slug}.json`, highlights }
}

export function scenarioRegistry(): ScenarioRegistry {
  return {
    schema: 'interlock.scenarios/v1',
    scenarios: [
      compare(
        '01',
        'normal-maintenance',
        'Normal maintenance change',
        'l5x/current-normal.L5X',
        'A routine maintenance export: documentation edits, two non-safety logic tweaks, an equivalent reorder of the ESD rung and a strengthened overflow trip. Nothing needs a safety review.',
        ['10 documentation edits, 4 logic edits', 'ESD rung reordered: proven equivalent', 'Overflow protection strengthened with a transmitter backup', 'Review priority: none'],
      ),
      compare(
        '02',
        'shutdown-weakened',
        'Compressor shutdown weakened by maintenance mode',
        'l5x/current-shutdown-weakened.L5X',
        'One contact added to the C-201 high pressure shutdown rung lets an HMI-writable maintenance flag defeat the trip, and its alarm with it.',
        ['XIO(Maintenance_Mode) added to SF-06', 'Inhibit is writable from the HMI', 'Shutdown alarm silenced in the same cases'],
      ),
      compare(
        '03',
        'alarm-suppressed',
        'High-high level alarm suppressed',
        'l5x/current-alarm-suppressed.L5X',
        'A "temporary" nuisance-alarm inhibit is wired into the T-101 high-high alarm. The overflow valve still closes; the control room is no longer told.',
        ['New Read/Write tag High_Level_Inhibit', 'Wired to the ALMD ProgDisable operand', 'Protective path SF-05 untouched'],
      ),
      compare(
        '04',
        'aoi-modified',
        'Shared pump interlock AOI modified',
        'l5x/current-aoi-modified.L5X',
        'AOI_PumpInterlock gains an optional maintenance bypass that defeats every trip. One edit to one block reaches five pumps, three of them safety functions.',
        ['Revision 3.4 -> 3.5, new Maint_Bypass input', 'Blast radius: 5 instances, 3 safety-relevant', 'P-101 shutdown alarm silenced too'],
      ),
      compare(
        '05',
        'protective-bypass',
        'Protective output bypassed from non-safety code',
        'l5x/current-protective-bypass.L5X',
        'A commissioning routine added to the non-safety Utilities program latches P-101\'s run enable on from the HMI, after the interlock has already decided.',
        ['New routine Utilities/Commissioning', 'OTL on a declared protective output', 'Runs after PumpControl in the same scan'],
      ),
      compare(
        '06',
        'undeclared-change',
        'Undeclared logic changed',
        'l5x/current-undeclared-change.L5X',
        'Three edits in logic no safety function declares: seal water, sump and a pump alarm rung. INTERLOCK cannot call them safe, so it asks for review.',
        ['Seal water dry-run protection removed', 'P-105 shutdown alarm rung deleted', 'Trust: review required'],
      ),
      {
        id: '07',
        slug: 'site-drift',
        title: 'AOI drift across three sites',
        summary: 'The same pump interlock block at three stations: one edited in place without a revision bump, one two revisions behind, and a valve block only one site has.',
        kind: 'drift',
        sites: [
          { label: 'Site A', name: 'Northgate (Site A)', file: 'l5x/site-a.L5X' },
          { label: 'Site B', name: 'Eastfield (Site B)', file: 'l5x/site-b-drift.L5X' },
          { label: 'Site C', name: 'Riverbend (Site C)', file: 'l5x/site-c-legacy.L5X' },
        ],
        manifest: MANIFEST,
        expected: 'expected/07-site-drift.json',
        highlights: ['Site B: "3.4" without the motor over-temperature trip', 'Site C: revision 3.1, no ESD input', 'AOI_ValveCtl only at Site C'],
      },
      compare(
        '08',
        'large-noisy',
        'Large noisy export with three logic changes',
        'l5x/current-large.L5X',
        'A 24-pump export with about 425 changes, almost all documentation and stored values. Three are logic, and one of them relaxes a safety setpoint.',
        ['400 documentation edits, 20 value edits', 'Suction permissive 12 -> 8 psig', 'C-201 low suction trip delay 2 s -> 10 s (undeclared)'],
        'l5x/baseline-large.L5X',
        'manifests/northgate-large.safety.json',
      ),
      compare(
        '09',
        'path-removed',
        'Protective paths removed',
        'l5x/current-path-removed.L5X',
        'The fire panel trip is removed from the ESD and the P-103 routine is no longer called. Two protective paths disappear, and the ESD change reaches every pump.',
        ['Fire_Detected removed from SF-01', 'JSR(PUMP_03) deleted: SF-04 never executes', 'ESD change propagates to pumps and permissive'],
      ),
    ],
  }
}
