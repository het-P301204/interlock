/**
 * Typed model of a Logix Designer project, just detailed enough to write an
 * L5X export that looks like the real thing. The fixture generator builds the
 * Northgate plant in this shape, scenarios mutate clones of it, and
 * l5x-writer.ts serializes it. Nothing here parses L5X: the parser is a
 * separate component and the fixtures must not depend on it.
 */
import type { DriftFlag, FindingType, SafetyStatus, Severity, TrustStatus, VariantBehavior } from '../../packages/core/src/model/analysis.ts'

export type ExternalAccess = 'Read/Write' | 'Read Only' | 'None'

/** Stored value of a tag. AOI instance data is derived from the definition at write time. */
export type TagValue =
  | { kind: 'BOOL'; value: 0 | 1 }
  | { kind: 'DINT'; value: number }
  | { kind: 'REAL'; value: number }
  | { kind: 'TIMER'; pre: number; acc: number }
  | { kind: 'AOI' }
  | { kind: 'ALARM'; severity: number; message: string }

export interface TagDef {
  name: string
  /** BOOL, DINT, REAL, TIMER, ALARM_DIGITAL or an AOI name. Ignored for alias tags. */
  dataType: string
  /** Alias target (TagType="Alias"), e.g. "Local:3:I.Data.4". */
  aliasFor?: string
  description: string
  externalAccess: ExternalAccess
  constant?: boolean
  value?: TagValue
}

export interface Rung {
  comment?: string
  /** Neutral rung text exactly as Logix exports it. */
  text: string
}

export interface Routine {
  name: string
  type: 'RLL'
  description?: string
  rungs: Rung[]
}

export interface Program {
  name: string
  description: string
  mainRoutine: string
  tags: TagDef[]
  routines: Routine[]
}

export interface Task {
  name: string
  type: 'CONTINUOUS' | 'PERIODIC'
  /** Period in ms for PERIODIC tasks. */
  rate?: number
  priority: number
  watchdog: number
  description: string
  programs: string[]
}

export interface AoiParameter {
  name: string
  usage: 'Input' | 'Output'
  dataType: 'BOOL'
  required: boolean
  visible: boolean
  description: string
  defaultValue: 0 | 1
}

export interface AoiLocalTag {
  name: string
  dataType: 'BOOL' | 'TIMER'
  description?: string
}

export interface AoiDefinition {
  name: string
  revision: string
  vendor: string
  description: string
  revisionNote: string
  /** ISO timestamps as Logix writes them, e.g. "2024-02-11T09:12:44.123Z". */
  createdDate: string
  createdBy: string
  editedDate: string
  editedBy: string
  softwareRevision: string
  /** Declared parameters, EXCLUDING EnableIn/EnableOut (the writer emits those first). */
  parameters: AoiParameter[]
  localTags: AoiLocalTag[]
  routines: Routine[]
}

export interface UdtMember {
  name: string
  dataType: 'BOOL' | 'DINT' | 'REAL'
  description: string
}

export interface DataTypeDef {
  name: string
  description: string
  members: UdtMember[]
}

export interface IoModule {
  name: string
  catalogNumber: string
  productType: number
  productCode: number
  major: number
  minor: number
  slot: number
  description: string
}

export interface ControllerModel {
  name: string
  description: string
  processorType: string
  /** Controller firmware major/minor. */
  majorRev: number
  minorRev: number
  /** Logix Designer version that wrote the export, e.g. "35.00". */
  softwareRevision: string
  /** Logix-format dates: "Wed Sep 30 14:12:09 2026". */
  projectCreationDate: string
  lastModifiedDate: string
  exportDate: string
  ethernetAddress: string
  /** Write descriptions/comments as LocalizedDescription/LocalizedComment (documentation languages enabled). */
  localizedDocumentation?: boolean
  dataTypes: DataTypeDef[]
  modules: IoModule[]
  aois: AoiDefinition[]
  tags: TagDef[]
  programs: Program[]
  tasks: Task[]
}

/* ------------------------------------------------------------ expectations */

/**
 * One required finding. Matching rules (the engine test harness implements them):
 *  - `type` is a finding type, or an array meaning "any of these types".
 *  - `severity` is exact; `minSeverity` means "at least this severe".
 *  - `safetyFunctionIds`: every listed id must appear in the safetyFunctionIds of
 *    at least one finding that matches the other filters (union semantics, so one
 *    module-level finding or one finding per function both satisfy it). An empty
 *    list adds no constraint.
 *  - `module`, `program`, `routine` filter on the finding's module and location.
 *    Entries are checked independently; where the brief expects several findings
 *    of one type (e.g. NON_SAFETY_LOGIC_CHANGE x2) each entry names a different
 *    location, so they cannot be satisfied by the same finding.
 *  - `inhibitLabels` / `suppressorLabels` / `causeLabels`: each label must be named
 *    (substring match) by an atom label in the finding's firing comparison or
 *    notification suppressors, or in its summary/explanation text.
 */
export interface ExpectedFinding {
  type: FindingType | FindingType[]
  severity?: Severity
  minSeverity?: Severity
  safetyFunctionIds: string[]
  module?: string
  program?: string
  routine?: string
  inhibitLabels?: string[]
  suppressorLabels?: string[]
  causeLabels?: string[]
}

export interface ExpectedCompare {
  scenario: string
  title: string
  why: string[]
  findings: {
    mustInclude: ExpectedFinding[]
    mustNotIncludeTypes: FindingType[]
    /** Highest severity allowed among REVIEW and UNDECLARED findings. */
    maxSeverity?: Severity
    /** Highest severity allowed among ALL findings. */
    maxSeverityOverall?: Severity
  }
  /** Status of every declared safety function. */
  safetyStatus: Record<string, SafetyStatus>
  trust?: TrustStatus
  /** surface.priority */
  priority?: Severity | 'NONE'
  surface?: { undeclaredAffected?: number; blastRadius?: number }
  blastRadius?: Record<string, { instances: number; safetyRelevant: number; operational: number; notExecuted?: number }>
  /** Bounds on the number of changes per category (Change.category). */
  changeCounts?: Partial<Record<'logic' | 'execution' | 'interface' | 'configuration' | 'data' | 'documentation' | 'metadata', { min: number; max: number }>>
}

export interface ExpectedModuleDrift {
  status?: 'CONSISTENT' | 'DRIFT'
  reference?: string
  /** Every listed flag must be present. */
  flags?: DriftFlag[]
  /** Which site(s) cause each flag (informational for reviewers and the UI). */
  flagSites?: Partial<Record<DriftFlag, string[]>>
  variants?: Record<string, VariantBehavior>
  revisions?: Record<string, string>
  missingAt?: string[]
}

export interface ExpectedDrift {
  scenario: string
  title: string
  why: string[]
  drift: Record<string, ExpectedModuleDrift>
}

export type Expected = ExpectedCompare | ExpectedDrift

/* --------------------------------------------------------------- registry */

export interface DriftSiteEntry {
  label: string
  name: string
  file: string
}

export interface ScenarioEntry {
  id: string
  slug: string
  title: string
  summary: string
  kind: 'compare' | 'drift'
  baseline?: string
  current?: string
  sites?: DriftSiteEntry[]
  manifest: string
  expected: string
  highlights: string[]
}

export interface ScenarioRegistry {
  schema: 'interlock.scenarios/v1'
  scenarios: ScenarioEntry[]
}

/** A generated output: path relative to fixtures/, and its exact content. */
export interface FixtureFile {
  path: string
  content: string
}
