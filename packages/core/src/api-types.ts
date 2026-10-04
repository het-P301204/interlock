/**
 * Public engine API types shared by the web worker, the API server and the CLI.
 */
import type { AnalysisResult, ProjectVersionSummary, Side, StageId, StageReport } from './model/analysis.ts'
import type { ParsedProject, ParserDiagnostic, SourceFile } from './model/project.ts'
import type { SafetyManifest } from './model/safety.ts'

export interface FileInput {
  name: string
  bytes: Uint8Array
}

export interface InspectError {
  code: string
  message: string
  /** Friendly location such as "Controller.Tags[27]". */
  location?: string
  line?: number
  column?: number
  diagnostics: ParserDiagnostic[]
}

export type InspectResult =
  | { ok: true; file: SourceFile; summary: ProjectVersionSummary; project: ParsedProject }
  | { ok: false; file: SourceFile; error: InspectError }

export interface AnalyzeInput {
  baseline: FileInput
  current: FileInput
  manifest: SafetyManifest
  /** ISO timestamp supplied by the caller: the engine never reads the clock. */
  analyzedAt: string
}

export interface StageEvent {
  id: StageId
  phase: 'start' | 'done'
  /** Present when phase is 'done'. */
  report?: StageReport
}

export interface AnalyzeHooks {
  onStage?: (event: StageEvent) => void
}

/** Raised by analyze() when an input cannot be trusted; carries which side failed. */
export interface AnalyzeFailure {
  side: Side | 'manifest'
  error: InspectError
}

export interface DriftSiteInput extends FileInput {
  label: string
}

export interface DriftInput {
  sites: DriftSiteInput[]
  analyzedAt: string
}

export type ManifestValidation = { ok: true; manifest: SafetyManifest } | { ok: false; issues: string[] }

export interface AdapterInfo {
  id: string
  label: string
  format: string
  vendor: string
  status: 'SUPPORTED' | 'PLANNED'
  version: string
  extensions: string[]
}

export type { AnalysisResult }
