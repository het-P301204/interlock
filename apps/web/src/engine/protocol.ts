/**
 * Message protocol between the UI thread (client.ts) and the analysis worker
 * (worker.ts). Every request carries an id; the worker answers with zero or
 * more `progress` messages and exactly one `result` or `error`.
 */
import type { AnalysisResult, DriftReport, SafetyManifest, Side } from '@interlock/core/types'
import type { AdapterInfo, AnalyzeFailure, AnalyzeInput, DriftInput, FileInput, InspectError, InspectResult, ManifestValidation, StageEvent } from './types.ts'

export type EngineRequest =
  | { id: number; op: 'info' }
  | { id: number; op: 'inspect'; file: FileInput; role: Side }
  | { id: number; op: 'validateManifest'; json: unknown }
  | { id: number; op: 'analyze'; input: AnalyzeInput }
  | { id: number; op: 'drift'; input: DriftInput }

export interface EngineInfo {
  engineVersion: string
  adapters: AdapterInfo[]
}

export interface OpResults {
  info: EngineInfo
  inspect: InspectResult
  validateManifest: ManifestValidation
  analyze: AnalysisResult
  drift: DriftReport
}

/** Real milestones of an inspect call: the worker hashes the bytes itself, then hands them to the engine. */
export type InspectProgress =
  | { type: 'inspect'; phase: 'hashing'; atMs: number }
  | { type: 'inspect'; phase: 'hashed'; sha256: string; atMs: number }
  | { type: 'inspect'; phase: 'parsing'; atMs: number }

/** A StageEvent from the engine, timestamped in the worker (ms since the request started). */
export interface StageProgress {
  type: 'stage'
  event: StageEvent
  atMs: number
}

export type EngineProgress = InspectProgress | StageProgress

export interface SerializedError {
  message: string
  name?: string
  code?: string
  /** Present when the engine reported which input could not be trusted. */
  failure?: AnalyzeFailure
  /** Present when the thrown value looked like an InspectError / ProjectParseError. */
  inspect?: InspectError
}

export type EngineResponse =
  | { id: number; kind: 'progress'; progress: EngineProgress }
  | { id: number; kind: 'result'; value: unknown; elapsedMs: number }
  | { id: number; kind: 'error'; error: SerializedError }

export type { SafetyManifest }
