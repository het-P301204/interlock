/**
 * Analysis results. Everything the UI, API, CLI and reports display is one of
 * these types, produced deterministically by the engine from two parsed
 * projects and a safety manifest. Nothing here is written by hand or by a
 * model: every conclusion points at the evidence that produced it.
 */
import type { ExternalAccess, ParserDiagnostic, ParserInfo, ProjectMetadata, SourceFile, SourceRef } from './project.ts'
import type { SafetyFunction, SafetyManifest } from './safety.ts'

export type Side = 'baseline' | 'current'
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'

export const SEVERITY_ORDER: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']

/* ------------------------------------------------------------------ ingest */

export type Readiness = 'READY' | 'READY_WITH_WARNINGS' | 'BLOCKED'

export interface ProjectCounts {
  tasks: number
  programs: number
  routines: number
  rungs: number
  modules: number
  /** Module call sites found in executable logic. */
  instances: number
  tags: number
}

export interface ProjectVersionSummary {
  role: Side
  file: SourceFile
  parser: ParserInfo
  metadata: ProjectMetadata
  counts: ProjectCounts
  diagnostics: ParserDiagnostic[]
  readiness: Readiness
}

/* ----------------------------------------------------------------- changes */

export type ChangeOp = 'added' | 'removed' | 'modified'

/**
 *   logic          rung text / routine body
 *   execution      what runs and when: tasks, schedules, program disable, JSR
 *   interface      module parameters, data types
 *   configuration  tag attributes that change behaviour (external access, constant, alias)
 *   data           stored tag values
 *   documentation  descriptions and rung comments
 *   metadata       export date, software revision and other export bookkeeping
 */
export type ChangeCategory = 'logic' | 'execution' | 'interface' | 'configuration' | 'data' | 'documentation' | 'metadata'

export type ChangeEntityType = 'rung' | 'routine' | 'program' | 'task' | 'module' | 'module-parameter' | 'tag' | 'datatype' | 'metadata'

export interface ChangeEntity {
  type: ChangeEntityType
  name: string
  /** Program or module that contains the entity. */
  container?: string
  routineId?: string
  rung?: number
}

export interface Change {
  /** "CH-0001", numbered in a deterministic order. */
  id: string
  op: ChangeOp
  category: ChangeCategory
  entity: ChangeEntity
  /** Attribute that changed for 'modified' (e.g. "text", "comment", "externalAccess", "revision"). */
  field?: string
  summary: string
  before?: string
  after?: string
  baselineSource?: SourceRef
  currentSource?: SourceRef
  /**
   * For logic changes: whether the rung computes the same thing.
   *   equivalent  every output written by the rung has a provably equivalent condition
   *   different   at least one output's condition differs
   *   unknown     could not be decided (unsupported instruction, bound exceeded)
   */
  semantic?: 'equivalent' | 'different' | 'unknown'
}

/* ------------------------------------------------------------- conditions */

export type AtomKind = 'tag' | 'member' | 'comparison' | 'previous' | 'opaque' | 'constant-input'

export interface AtomInfo {
  id: string
  /** Display label, e.g. "Maintenance_Mode", "Level_PV > 85.0", "Pump_01_Run_Enable (previous scan)". */
  label: string
  kind: AtomKind
  /** Base tag the atom reads, when there is one. */
  tag?: string
  /** Whether an HMI/OPC client can write the base tag. 'n/a' for computed atoms. */
  externalAccess: ExternalAccess | 'n/a'
  /** True when no logic in the (current) project writes the tag: it is set from outside logic. */
  externallySet: boolean
  inBaseline: boolean
  inCurrent: boolean
}

export interface ConditionText {
  /** Minimal sum-of-products text, e.g. "Pressure_High AND Safety_Enable AND NOT Maintenance_Mode". */
  text: string
  /** Product terms in the displayed form. */
  terms: string[]
  /** True when `text` is a proven-equivalent minimal form; false when it is a structural rendering. */
  minimal: boolean
}

export type FiringVerdict =
  | 'UNCHANGED'
  | 'EQUIVALENT'
  | 'WEAKENED'
  | 'STRENGTHENED'
  | 'MIXED'
  | 'NEVER_FIRES'
  | 'ALWAYS_FIRES'
  | 'NOT_DECIDED'

export interface WitnessValue {
  atom: string
  label: string
  value: string
}

/**
 * A concrete assignment of inputs showing the difference, e.g. "with
 * Pressure_High=1, Safety_Enable=1, Maintenance_Mode=1 the function fired
 * before and does not fire now".
 */
export interface Witness {
  values: WitnessValue[]
  before: boolean
  after: boolean
}

export interface FiringComparison {
  verdict: FiringVerdict
  /** "Fires when" in the baseline and current project. */
  before: ConditionText
  after: ConditionText
  /** Situations where the function fired before and no longer does. */
  lost?: ConditionText
  /** Situations where the function now fires and did not before. */
  gained?: ConditionText
  witness?: Witness
  atoms: AtomInfo[]
  /** True when every consistent assignment was checked. */
  exhaustive: boolean
  assignmentsChecked: number
  /** Why NOT_DECIDED, when it is. */
  reason?: string
}

/* ---------------------------------------------------------- safety results */

export type SafetyStatus = 'IMPACTED' | 'STRENGTHENED' | 'CHANGED_EQUIVALENT' | 'NO_CHANGE' | 'NOT_ANALYZED'
export type ResolutionState = 'RESOLVED' | 'UNRESOLVED' | 'NOT_DECLARED'

export type WriterKind = 'OTE' | 'OTL' | 'OTU' | 'MODULE_OUTPUT' | 'MOVE' | 'TIMER' | 'ALARM' | 'OTHER'

export interface WriterRef {
  routineId: string
  rung: number
  instruction: string
  kind: WriterKind
  source?: SourceRef
}

export interface DeclarationResolution {
  protectiveOutput: ResolutionState
  alarm: ResolutionState
  routine: ResolutionState
  module: ResolutionState
  notes: string[]
}

export interface SafetyCone {
  routines: string[]
  modules: string[]
  instances: string[]
  tags: string[]
  /** Rungs whose logic the function depends on, as "routineId#rung". */
  rungs: string[]
}

export type NotificationStageId = 'CONDITION' | 'LOGIC' | 'ALARM' | 'HMI' | 'OPERATOR'
export type StageState = 'OK' | 'CONDITIONAL' | 'BROKEN' | 'DECLARED' | 'UNKNOWN'
export type NotificationStatus = 'INTACT' | 'DEGRADED' | 'SUPPRESSED' | 'BROKEN' | 'NOT_ANALYZED'

export interface NotificationStage {
  id: NotificationStageId
  label: string
  before: StageState
  after: StageState
  detail: string
}

export interface NotificationPath {
  alarmTag: string
  mechanism: 'ALMD' | 'BOOL_TAG' | 'UNRESOLVED'
  declaredNotification?: string
  stages: NotificationStage[]
  status: NotificationStatus
  comparison?: FiringComparison
  /** Labels of atoms that now suppress the notification. */
  suppressors: string[]
}

export interface ProtectiveAnalysis extends FiringComparison {
  outputTag: string
  tripState: 'DE_ENERGIZE' | 'ENERGIZE'
  writersBefore: WriterRef[]
  writersAfter: WriterRef[]
}

export interface SafetyFunctionResult {
  function: SafetyFunction
  status: SafetyStatus
  resolution: DeclarationResolution
  protective?: ProtectiveAnalysis
  notification?: NotificationPath
  /** Dependency cone in the current project (baseline cone merged in). */
  cone: SafetyCone
  /** Changes located inside the cone. */
  changeIds: string[]
  findingIds: string[]
  confidence: Confidence
}

/* ------------------------------------------------------------ reuse graph */

export type GraphNodeType = 'task' | 'program' | 'routine' | 'module' | 'instance' | 'safety-function' | 'protective-output' | 'alarm' | 'tag'
export type GraphEdgeType = 'schedules' | 'calls' | 'defines' | 'instantiates' | 'references' | 'writes' | 'protects' | 'alarms' | 'implements' | 'influences'
export type NodeChange = 'none' | 'modified' | 'added' | 'removed'

export interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  sublabel?: string
  change: NodeChange
  /** Inside at least one declared safety function's cone. */
  safety: boolean
  /** Part of no declared cone and not declared non-safety. */
  undeclared: boolean
  /** Worst finding severity attached to this node. */
  severity?: Severity
  findingIds: string[]
  safetyFunctionIds: string[]
  meta: Record<string, string>
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: GraphEdgeType
  changed: boolean
  safety: boolean
}

export interface ReuseGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type InstanceRelevance = 'safety' | 'operational' | 'not-executed'

export interface ModuleInstanceImpact {
  id: string
  backingTag: string
  routineId: string
  program: string
  rung: number
  safetyFunctionIds: string[]
  relevance: InstanceRelevance
}

export interface ModuleBlastRadius {
  module: string
  changed: boolean
  revisionBefore?: string
  revisionAfter?: string
  changeIds: string[]
  instances: ModuleInstanceImpact[]
  totals: { instances: number; safetyRelevant: number; operational: number; notExecuted: number }
}

/* ---------------------------------------------------------------- findings */

export type FindingType =
  | 'PROTECTIVE_PATH_REMOVED'
  | 'NEW_INHIBIT'
  | 'SHUTDOWN_WEAKENED'
  | 'PROTECTIVE_OUTPUT_BYPASSED'
  | 'ALARM_SUPPRESSED'
  | 'PERMISSIVE_WEAKENED'
  | 'INTERLOCK_WEAKENED'
  | 'SETPOINT_RELAXED'
  | 'TRIP_DELAY_INCREASED'
  | 'EXECUTION_CONTROL_INTRODUCED'
  | 'SHARED_MODULE_PROPAGATION'
  | 'UNDECLARED_LOGIC_CHANGED'
  | 'PROTECTION_STRENGTHENED'
  | 'COSMETIC_LOGIC_CHANGE'
  | 'NON_SAFETY_LOGIC_CHANGE'
  | 'DECLARATION_UNRESOLVED'
  | 'MODULE_REVISION_NOT_BUMPED'
  | 'EXTERNAL_WRITE_ACCESS_GRANTED'

/**
 *   REVIEW       a safety-relevant change an engineer must review
 *   UNDECLARED   no safety intent declared: INTERLOCK cannot conclude it is safe
 *   INFORMATIONAL recorded for completeness
 *   POSITIVE     protection became stronger
 */
export type Disposition = 'REVIEW' | 'UNDECLARED' | 'INFORMATIONAL' | 'POSITIVE'

export type NotificationImpact = 'NONE' | 'DEGRADED' | 'SUPPRESSED' | 'BROKEN'

export type EvidenceKind = 'rung' | 'module-rung' | 'routine' | 'tag' | 'task' | 'program' | 'module' | 'declaration' | 'computation'

export interface EvidenceItem {
  /** "EV-0007-01" */
  id: string
  findingId: string
  side: Side | 'both' | 'declaration'
  kind: EvidenceKind
  title: string
  sourceFile?: string
  fileSha256?: string
  parserVersion?: string
  xmlPath?: string
  line?: number
  column?: number
  program?: string
  routine?: string
  module?: string
  original?: string
  modified?: string
  rule: string
  analyzedAt: string
  note?: string
}

export interface FindingLocation {
  program?: string
  routine?: string
  routineId?: string
  rung?: number
  tag?: string
}

export interface Finding {
  /** "IL-0001", numbered in review order. */
  id: string
  /** Stable across re-runs of the same inputs: hash of type, rule and subject. */
  fingerprint: string
  ruleId: string
  ruleTitle: string
  type: FindingType
  title: string
  severity: Severity
  confidence: Confidence
  disposition: Disposition
  /** Affected safety function ids, most critical first. */
  safetyFunctionIds: string[]
  module?: string
  location: FindingLocation
  blastRadius?: { instances: number; safetyRelevant: number; operational: number }
  notificationImpact: NotificationImpact
  summary: string
  explanation: string[]
  impact: string[]
  recommendation: string[]
  firing?: FiringComparison
  changeIds: string[]
  evidence: EvidenceItem[]
  /** Ranking score; the formula is documented in docs/analysis-methodology.md. */
  score: number
  rank: number
}

/* ---------------------------------------------------------- coverage/trust */

export type UnsupportedKind = 'ROUTINE_TYPE' | 'INSTRUCTION' | 'PROTECTED_CONTENT' | 'EXECUTION_CONTROL' | 'BOUND_EXCEEDED' | 'UNRESOLVED_REFERENCE'

export interface UnsupportedConstruct {
  kind: UnsupportedKind
  detail: string
  location: string
  side: Side
  /** Inside a declared safety function's cone. */
  inSafetyCone: boolean
  /** Touched by a change in this analysis. */
  changed: boolean
}

export interface CoverageRatio {
  covered: number
  total: number
}

export interface Coverage {
  safetyFunctions: CoverageRatio
  declaredRoutines: CoverageRatio
  moduleRelationships: CoverageRatio
  notificationPaths: CoverageRatio
  unsupported: UnsupportedConstruct[]
  /** Mean of the four ratios that have a non-zero total, 0..100, rounded down. */
  percent: number
}

export type TrustStatus = 'VERIFIED_SCOPE' | 'PARTIAL_COVERAGE' | 'REVIEW_REQUIRED'

export interface Trust {
  status: TrustStatus
  headline: string
  reasons: string[]
}

export interface ReviewItem {
  rank: number
  findingId: string
  title: string
  severity: Severity
  safetyFunction?: string
}

export interface ReviewSurface {
  totalChanges: number
  meaningfulLogicChanges: number
  safetyRelevant: number
  notificationPathChanges: number
  /** Changed modules with at least one safety-relevant instance. */
  sharedModulesWithSafetyImpact: number
  /** Largest instance count among changed modules. */
  blastRadius: number
  undeclaredAffected: number
  reviewOrder: ReviewItem[]
  /** Highest severity among REVIEW and UNDECLARED findings, or NONE. */
  priority: Severity | 'NONE'
  byCategory: Record<ChangeCategory, number>
}

export interface UndeclaredLogic {
  routineId: string
  program?: string
  routine: string
  changeIds: string[]
  /** Deterministic name-based hint, e.g. "tag names suggest protective intent (Seal_Water_Low_Trip)". */
  hint?: string
}

/* ------------------------------------------------------------------ stages */

export type StageId =
  | 'INGEST'
  | 'NORMALIZE'
  | 'RESOLVE_MODULES'
  | 'BUILD_REUSE_GRAPH'
  | 'MAP_SAFETY_FUNCTIONS'
  | 'COMPARE_LOGIC'
  | 'TRACE_PROTECTIVE_PATHS'
  | 'ANALYZE_ALARMS'
  | 'RANK_IMPACT'
  | 'GENERATE_REVIEW_SET'

export interface StageReport {
  id: StageId
  label: string
  /** One line describing what the stage actually did, with real counts. */
  detail: string
  counts: Record<string, number>
}

export interface RuleInfo {
  id: string
  title: string
  description: string
  severity: Severity
}

export interface AnalysisResult {
  schema: 'interlock.analysis/v1'
  /** Hash of both input files and the manifest: same inputs, same id. */
  id: string
  analyzedAt: string
  engineVersion: string
  baseline: ProjectVersionSummary
  current: ProjectVersionSummary
  manifest: SafetyManifest
  changes: Change[]
  findings: Finding[]
  safetyFunctions: SafetyFunctionResult[]
  modules: ModuleBlastRadius[]
  graph: ReuseGraph
  coverage: Coverage
  trust: Trust
  surface: ReviewSurface
  undeclared: UndeclaredLogic[]
  stages: StageReport[]
  rules: RuleInfo[]
}

/* ------------------------------------------------------------------- drift */

export type DriftFlag = 'SAME_NAME_DIFFERENT_DEFINITION' | 'REVISION_NOT_BUMPED' | 'OLDER_REVISION' | 'SAFETY_BEHAVIOR_DIFFERS' | 'MISSING_AT_SITE'
export type VariantBehavior = 'REFERENCE' | 'EQUIVALENT' | 'WEAKER' | 'STRONGER' | 'DIFFERENT' | 'NOT_DECIDED'

export interface ModuleVariant {
  /** Short content hash of the normalized definition. */
  hash: string
  revision?: string
  sites: string[]
  parameterSignature: string
  behavior: VariantBehavior
  outputs: { parameter: string; comparison: FiringComparison }[]
}

export interface ModuleDrift {
  module: string
  status: 'CONSISTENT' | 'DRIFT'
  reference: string
  variants: ModuleVariant[]
  flags: DriftFlag[]
  missingAt: string[]
  notes: string[]
}

export interface DriftSite {
  label: string
  file: SourceFile
  controller: string
}

export interface DriftReport {
  schema: 'interlock.drift/v1'
  analyzedAt: string
  engineVersion: string
  sites: DriftSite[]
  modules: ModuleDrift[]
}

export type { SafetyFunction }
