/**
 * Workspace state: the two loaded project versions, the safety declarations,
 * the running/finished analysis and local history.
 *
 * Nothing here is invented. Inspection phases mirror the worker's real
 * progress messages; stage state mirrors the engine's StageEvents; results
 * are whatever the engine returned. Project bytes stay in memory (File
 * objects) and are never persisted; results and history are saved to
 * IndexedDB when it is available.
 */
import { create } from 'zustand'
import type { AnalysisResult, SafetyManifest, Severity, Side, StageId, StageReport, TrustStatus } from '@interlock/core/types'
import { EngineCancelled, EngineError, engine, readFileInput } from '../engine/client.ts'
import type { SerializedError } from '../engine/protocol.ts'
import type { InspectResult } from '../engine/types.ts'
import { idbClear, idbDel, idbGet, idbSet } from './persist.ts'

/* ------------------------------------------------------------- ingest */

export type IngestPhase = 'idle' | 'reading' | 'hashing' | 'parsing' | 'ready' | 'failed'

export interface SideState {
  phase: IngestPhase
  file?: File
  name?: string
  size?: number
  /** SHA-256 the worker computed before parsing (the engine's own hash is in result.file). */
  sha256?: string
  result?: InspectResult
  error?: SerializedError
  elapsedMs?: number
  /** Increments per load so stale completions are ignored. */
  token: number
}

/* ----------------------------------------------------------- manifest */

export interface ManifestState {
  source: 'file' | 'demo'
  name: string
  manifest: SafetyManifest
}

/* ---------------------------------------------------------------- run */

export interface StageTrack {
  startedAtMs?: number
  doneAtMs?: number
  report?: StageReport
}

export type RunStatus = 'idle' | 'running' | 'complete' | 'failed' | 'cancelled'

export interface RunState {
  status: RunStatus
  stages: Partial<Record<StageId, StageTrack>>
  error?: SerializedError
  elapsedMs?: number
  token: number
}

export interface HistoryEntry {
  id: string
  analyzedAt: string
  baselineName: string
  currentName: string
  manifestName?: string
  priority: Severity | 'NONE'
  trust: TrustStatus
  findings: number
  totalChanges: number
  safetyRelevant: number
}

const HISTORY_KEY = 'interlock.history'
const CURRENT_KEY = 'interlock.analysis.current'
const resultKey = (id: string) => `interlock.analysis.${id}`

interface WorkspaceState {
  baseline: SideState
  current: SideState
  manifest: ManifestState | null
  manifestIssues: { name: string; issues: string[] } | null
  run: RunState
  result: AnalysisResult | null
  history: HistoryEntry[]
  hydrated: boolean

  loadSide: (side: Side, file: File) => Promise<void>
  clearSide: (side: Side) => void
  loadManifestJson: (name: string, json: unknown, source: ManifestState['source']) => Promise<void>
  clearManifest: () => void
  startAnalysis: () => Promise<void>
  cancelAnalysis: () => void
  resetRun: () => void
  openResult: (id: string) => Promise<boolean>
  hydrate: () => Promise<void>
  clearLocalData: () => Promise<boolean>
}

const emptySide = (token = 0): SideState => ({ phase: 'idle', token })
const emptyRun = (token = 0): RunState => ({ status: 'idle', stages: {}, token })

function toSerialized(err: unknown): SerializedError {
  if (err instanceof EngineError) return err.details
  if (err instanceof Error) return { message: err.message, name: err.name }
  return { message: 'Analysis could not be completed.' }
}

function historyEntry(r: AnalysisResult, manifestName?: string): HistoryEntry {
  return {
    id: r.id,
    analyzedAt: r.analyzedAt,
    baselineName: r.baseline.file.name,
    currentName: r.current.file.name,
    manifestName,
    priority: r.surface.priority,
    trust: r.trust.status,
    findings: r.findings.length,
    totalChanges: r.surface.totalChanges,
    safetyRelevant: r.surface.safetyRelevant,
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  baseline: emptySide(),
  current: emptySide(),
  manifest: null,
  manifestIssues: null,
  run: emptyRun(),
  result: null,
  history: [],
  hydrated: false,

  async loadSide(side, file) {
    const token = get()[side].token + 1
    const patch = (p: Partial<SideState>) => {
      if (get()[side].token !== token) return
      set({ [side]: { ...get()[side], ...p } } as Pick<WorkspaceState, Side>)
    }
    set({ [side]: { phase: 'reading', file, name: file.name, size: file.size, token } } as Pick<WorkspaceState, Side>)
    // A new input invalidates a finished run.
    if (get().run.status !== 'running') set({ run: emptyRun(get().run.token) })
    try {
      const { value, elapsedMs } = await engine.inspect(file, side, (p) => {
        if (p.phase === 'hashing') patch({ phase: 'hashing' })
        else if (p.phase === 'hashed') patch({ sha256: p.sha256 })
        else if (p.phase === 'parsing') patch({ phase: 'parsing' })
      })
      patch({ phase: value.ok ? 'ready' : 'failed', result: value, elapsedMs, sha256: value.file.sha256 })
    } catch (err) {
      if (err instanceof EngineCancelled) return
      patch({ phase: 'failed', error: toSerialized(err) })
    }
  },

  clearSide(side) {
    set({ [side]: emptySide(get()[side].token + 1) } as Pick<WorkspaceState, Side>)
  },

  async loadManifestJson(name, json, source) {
    try {
      const { value } = await engine.validateManifest(json)
      if (value.ok) set({ manifest: { name, source, manifest: value.manifest }, manifestIssues: null })
      else set({ manifestIssues: { name, issues: value.issues } })
    } catch (err) {
      set({ manifestIssues: { name, issues: [toSerialized(err).message] } })
    }
  },

  clearManifest() {
    set({ manifest: null, manifestIssues: null })
  },

  async startAnalysis() {
    const { baseline, current, manifest } = get()
    if (!baseline.file || !current.file || !manifest) return
    const token = get().run.token + 1
    set({ run: { status: 'running', stages: {}, token } })
    const guard = () => get().run.token === token
    try {
      const [b, c] = await Promise.all([readFileInput(baseline.file), readFileInput(current.file)])
      const { value, elapsedMs } = await engine.analyze(
        { baseline: b, current: c, manifest: manifest.manifest, analyzedAt: new Date().toISOString() },
        ({ event, atMs }) => {
          if (!guard()) return
          const prev = get().run.stages[event.id] ?? {}
          const next: StageTrack = event.phase === 'start' ? { ...prev, startedAtMs: atMs } : { ...prev, doneAtMs: atMs, report: event.report }
          set({ run: { ...get().run, stages: { ...get().run.stages, [event.id]: next } } })
        },
      )
      if (!guard()) return
      const entry = historyEntry(value, manifest.name)
      const history = [entry, ...get().history.filter((h) => h.id !== value.id)].slice(0, 50)
      set({ result: value, history, run: { ...get().run, status: 'complete', elapsedMs } })
      void idbSet(resultKey(value.id), value)
      void idbSet(CURRENT_KEY, value.id)
      void idbSet(HISTORY_KEY, history)
    } catch (err) {
      if (!guard()) return
      if (err instanceof EngineCancelled) set({ run: { ...get().run, status: 'cancelled' } })
      else set({ run: { ...get().run, status: 'failed', error: toSerialized(err) } })
    }
  },

  cancelAnalysis() {
    engine.cancel()
    // Any inspection in flight was cancelled too: return those sides to idle.
    for (const side of ['baseline', 'current'] as const) {
      const s = get()[side]
      if (s.phase === 'reading' || s.phase === 'hashing' || s.phase === 'parsing') set({ [side]: emptySide(s.token + 1) } as Pick<WorkspaceState, Side>)
    }
  },

  resetRun() {
    set({ run: emptyRun(get().run.token + 1) })
  },

  async openResult(id) {
    if (get().result?.id === id) return true
    const r = await idbGet<AnalysisResult>(resultKey(id))
    if (!r) return false
    set({ result: r })
    void idbSet(CURRENT_KEY, id)
    return true
  },

  async hydrate() {
    if (get().hydrated) return
    const [history, currentId] = await Promise.all([idbGet<HistoryEntry[]>(HISTORY_KEY), idbGet<string>(CURRENT_KEY)])
    const result = currentId ? await idbGet<AnalysisResult>(resultKey(currentId)) : undefined
    set({
      hydrated: true,
      history: Array.isArray(history) ? history : [],
      result: get().result ?? result ?? null,
    })
  },

  async clearLocalData() {
    const ok = await idbClear()
    for (const h of get().history) void idbDel(resultKey(h.id))
    set({ history: [], result: null })
    return ok
  },
}))
