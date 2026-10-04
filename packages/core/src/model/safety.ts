/**
 * Engineer-declared safety intent.
 *
 * INTERLOCK never infers that logic is safety-relevant from its shape. An
 * engineer declares what each safety function is supposed to do (its
 * protective output and the state that output takes when the function acts,
 * its alarm, where it is implemented). Everything the engine concludes about
 * safety is relative to these declarations, and logic outside every declared
 * function is reported as UNDECLARED, never as safe.
 */

export type Criticality = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

/**
 * What kind of protection the function provides. It changes the wording of
 * findings and the default severity of a weakening:
 *   SHUTDOWN / TRIP  stop equipment when a hazardous condition occurs
 *   INTERLOCK        prevent equipment acting while another condition holds
 *   PERMISSIVE       must be satisfied before equipment may start or run
 *   ALARM            notify an operator (no protective output of its own)
 */
export type SafetyFunctionKind = 'SHUTDOWN' | 'TRIP' | 'INTERLOCK' | 'PERMISSIVE' | 'ALARM'

/**
 * The value the protective output takes when the function acts.
 *   DE_ENERGIZE  output goes to 0 (fail-safe "run enable" / "permit" style)
 *   ENERGIZE     output goes to 1 ("trip command" / "close valve" style)
 */
export type TripState = 'DE_ENERGIZE' | 'ENERGIZE'

export interface ProtectiveOutputDecl {
  /** Tag name as it appears in the project: "Pump_01_Run_Enable" or "\\Program.Tag" for program scope. */
  tag: string
  tripState: TripState
}

export interface AlarmDecl {
  /** An ALMD tag (digital alarm instruction) or a BOOL alarm tag read by the HMI. */
  tag: string
  /**
   * Declared downstream notification, e.g. "HMI alarm summary, Control Room A".
   * The project file cannot prove this link exists; it is shown as DECLARED.
   */
  notification?: string
}

export interface ImplementationDecl {
  program?: string
  routine?: string
  /** Reusable module (AOI) that implements the function. */
  module?: string
  /** Backing tag of the module instance, e.g. "PUMP_01_IL". */
  instance?: string
}

export interface SafetyFunction {
  /** Stable short id, e.g. "SF-01". */
  id: string
  name: string
  description?: string
  kind: SafetyFunctionKind
  criticality: Criticality
  implementation: ImplementationDecl
  protectiveOutput?: ProtectiveOutputDecl
  alarm?: AlarmDecl
  /** Optional arming condition the engineer expects, e.g. "Safety_Enable". Informational. */
  enableCondition?: string
  notes?: string
}

export interface NonSafetyScope {
  /** Programs declared to carry no safety intent. */
  programs?: string[]
  /** Routines declared to carry no safety intent, as "Program/Routine". */
  routines?: string[]
}

export interface SafetyManifest {
  schema: 'interlock.safety/v1'
  /** Free-text project label for humans. */
  project?: string
  functions: SafetyFunction[]
  /**
   * Logic the engineer has explicitly declared non-safety. Changes there are
   * INFORMATIONAL. Logic that is neither inside a safety function's dependency
   * cone nor declared non-safety is UNDECLARED and needs review.
   */
  nonSafetyScope?: NonSafetyScope
}
