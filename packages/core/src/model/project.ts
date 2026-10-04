/**
 * Vendor-neutral PLC project model.
 *
 * Every adapter (L5X today; PLCopen XML and others are planned) turns raw
 * vendor XML into a `ParsedProject` exactly once. Nothing downstream of an
 * adapter ever sees XML: the normalizer, graph builder, symbolic scan, rules
 * and UI all work on these types.
 *
 * Naming: a reusable logic definition is a *module* (Rockwell: Add-On
 * Instruction definition; IEC 61131-3 / PLCopen: function block type). A
 * runtime use of a module is an *instance* (an AOI call site with its backing
 * tag). Logix-specific vocabulary appears only in labels, never in the shape.
 */

/** Where something came from in the source XML. Lines and columns are 1-based. */
export interface SourceRef {
  /** XPath-like location, e.g. /RSLogix5000Content/Controller/Programs/Program[@Name='Safety']/Routines/Routine[@Name='ESD']/RLLContent/Rung[@Number='2'] */
  path: string
  line: number
  column: number
}

export type FormatId = 'L5X' | 'PLCOPEN_XML' | 'SIEMENS_TIA_XML' | 'SCHNEIDER_XEF'

export interface ProjectMetadata {
  format: FormatId
  /** Human label, e.g. "Rockwell Logix Designer export (L5X)". */
  formatLabel: string
  vendor: string
  /** Name of the controller (or the exported component for partial exports). */
  controllerName: string
  processorType?: string
  /** Major.minor firmware revision of the controller, as exported. */
  firmwareRevision?: string
  schemaRevision?: string
  /** Version of the engineering software that wrote the export, as exported. */
  softwareRevision?: string
  /** Export date exactly as written in the file (never parsed into a clock value). */
  exportDate?: string
  /** What was exported: a whole controller, or a single program/AOI/rung set. */
  targetType: string
  /** True when the export is a partial component export with context. */
  containsContext: boolean
}

export type TagScope =
  | { kind: 'controller' }
  | { kind: 'program'; program: string }
  | { kind: 'module'; module: string }

export type ExternalAccess = 'Read/Write' | 'Read Only' | 'None' | 'Unknown'

export interface Tag {
  name: string
  scope: TagScope
  dataType: string
  /** For module-scoped tags: parameter usage or 'Local'. */
  usage?: 'Input' | 'Output' | 'InOut' | 'Local'
  description?: string
  /** Alias target (Logix alias tags), e.g. "Local:1:I.Data.3". */
  aliasFor?: string
  /** Array dimensions as written, e.g. "10" or "4 8". */
  dimensions?: string
  constant: boolean
  /** Whether HMI/OPC clients may write the tag. Read/Write on a safety-relevant tag matters. */
  externalAccess: ExternalAccess
  /** Initial/stored value in a compact canonical text form when the export carries one. */
  value?: string
  source: SourceRef
}

export interface DataTypeMember {
  name: string
  dataType: string
  hidden: boolean
}

export interface DataType {
  name: string
  family?: string
  members: DataTypeMember[]
  source: SourceRef
}

export type RoutineKind = 'RLL' | 'ST' | 'FBD' | 'SFC' | 'UNKNOWN'

export interface Rung {
  /** Rung number as exported (0-based in Logix). */
  number: number
  /** Neutral rung text exactly as exported, e.g. "XIC(A)[XIO(B),XIC(C)]OTE(D);". */
  text: string
  comment?: string
  /** Logix rung edit type: N (normal), I/R/D (pending edits). */
  type?: string
  source: SourceRef
}

export interface StLine {
  number: number
  text: string
  source: SourceRef
}

export type ContainerRef =
  | { kind: 'program'; name: string }
  | { kind: 'module'; name: string }

export interface Routine {
  /** Stable id: "program:<Program>/<Routine>" or "module:<Module>/<Routine>". */
  id: string
  name: string
  container: ContainerRef
  kind: RoutineKind
  description?: string
  /** RLL rungs in order. Empty for non-RLL routines. */
  rungs: Rung[]
  /** Structured text lines (kept for display and structural diff; semantic analysis is RLL-only). */
  stLines: StLine[]
  /** True when the routine body is source-protected/encoded and cannot be read. */
  protected: boolean
  source: SourceRef
}

export interface Program {
  name: string
  mainRoutine?: string
  faultRoutine?: string
  /** Logix "Disabled" program attribute: a disabled program does not execute. */
  disabled: boolean
  /** Equipment-phase and other non-standard program classes are kept as-is. */
  programClass?: string
  description?: string
  source: SourceRef
}

export interface Task {
  name: string
  type: 'CONTINUOUS' | 'PERIODIC' | 'EVENT' | 'UNKNOWN'
  priority?: number
  /** Period in ms for periodic tasks. */
  rate?: number
  watchdog?: number
  /** Logix "InhibitTask": an inhibited task does not execute. */
  inhibited: boolean
  disableUpdateOutputs: boolean
  /** Programs in scheduled execution order. */
  scheduledPrograms: string[]
  description?: string
  source: SourceRef
}

export interface ModuleParameter {
  name: string
  dataType: string
  usage: 'Input' | 'Output' | 'InOut'
  /** Required parameters appear as operands at the call site, in declaration order. */
  required: boolean
  visible: boolean
  description?: string
  defaultValue?: string
  externalAccess: ExternalAccess
  source: SourceRef
}

export interface ModuleDefinition {
  name: string
  kind: 'AOI' | 'FUNCTION_BLOCK'
  revision?: string
  revisionExtension?: string
  vendor?: string
  description?: string
  /** Parameters in declaration order, excluding the implicit EnableIn/EnableOut. */
  parameters: ModuleParameter[]
  localTags: Tag[]
  /** Ids of this module's routines (they live in ParsedProject.routines). */
  routineIds: string[]
  /** True when the definition is source-protected. */
  protected: boolean
  /** Signature/history identifiers if the export carries them (sealed AOIs). */
  signatureId?: string
  editedDate?: string
  source: SourceRef
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface ParserDiagnostic {
  severity: DiagnosticSeverity
  /** Stable machine code, e.g. "XML_DOCTYPE_FORBIDDEN", "L5X_UNSUPPORTED_ROUTINE_TYPE". */
  code: string
  message: string
  /** Friendly location such as "Controller.Tags[27]" when one can be derived. */
  location?: string
  source?: SourceRef
}

/** Output of a format adapter. Structural only: rung text is not interpreted here. */
export interface ParsedProject {
  metadata: ProjectMetadata
  tasks: Task[]
  programs: Program[]
  routines: Routine[]
  modules: ModuleDefinition[]
  /** Controller- and program-scoped tags. Module parameters/locals live on the module. */
  tags: Tag[]
  dataTypes: DataType[]
  diagnostics: ParserDiagnostic[]
}

/** The file a project came from, as the ingest step measured it. */
export interface SourceFile {
  name: string
  sizeBytes: number
  sha256: string
}

export interface ParserInfo {
  adapter: string
  version: string
}
