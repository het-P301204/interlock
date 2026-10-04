/**
 * Promise RPC to the analysis worker.
 *
 *   const result = await engine.inspect(file, 'baseline', (p) => setPhase(p.phase))
 *   const analysis = await engine.analyze(input, (s) => onStage(s))
 *   engine.cancel()   // terminates the worker, rejects in-flight calls with EngineCancelled, respawns lazily
 *
 * Errors from the engine reject with EngineError carrying the serialized
 * details (which input failed, parser location and diagnostics).
 */
import type { Side } from '@interlock/core/types'
import type { AnalyzeInput, DriftInput, FileInput } from './types.ts'
import type { EngineProgress, EngineRequest, EngineResponse, InspectProgress, OpResults, SerializedError, StageProgress } from './protocol.ts'

export class EngineError extends Error {
  readonly details: SerializedError
  constructor(details: SerializedError) {
    super(details.message)
    this.name = 'EngineError'
    this.details = details
  }
}

export class EngineCancelled extends Error {
  constructor() {
    super('Analysis cancelled.')
    this.name = 'EngineCancelled'
  }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  onProgress?: (p: EngineProgress) => void
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

export interface Timed<T> {
  value: T
  elapsedMs: number
}

class EngineClient {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1

  private ensure(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'interlock-engine' })
    w.addEventListener('message', (e: MessageEvent<EngineResponse>) => this.onMessage(e.data))
    w.addEventListener('error', (e) => {
      e.preventDefault()
      this.failAll(new EngineError({ message: 'The analysis worker stopped unexpectedly. Reload the page and try again.', name: 'WorkerError' }))
      this.reset()
    })
    w.addEventListener('messageerror', () => {
      this.failAll(new EngineError({ message: 'The analysis worker returned data that could not be read.', name: 'WorkerMessageError' }))
    })
    this.worker = w
    return w
  }

  private onMessage(msg: EngineResponse): void {
    const p = this.pending.get(msg.id)
    if (!p) return
    if (msg.kind === 'progress') {
      p.onProgress?.(msg.progress)
      return
    }
    this.pending.delete(msg.id)
    if (msg.kind === 'result') p.resolve({ value: msg.value, elapsedMs: msg.elapsedMs } satisfies Timed<unknown>)
    else p.reject(new EngineError(msg.error))
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private reset(): void {
    this.worker?.terminate()
    this.worker = null
  }

  private call<K extends keyof OpResults>(
    req: DistributiveOmit<Extract<EngineRequest, { op: K }>, 'id'>,
    onProgress?: (p: EngineProgress) => void,
    transfer: Transferable[] = [],
  ): Promise<Timed<OpResults[K]>> {
    const w = this.ensure()
    const id = this.nextId++
    return new Promise<Timed<OpResults[K]>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
      w.postMessage({ ...req, id }, transfer)
    })
  }

  /** Terminates the worker: every in-flight call rejects with EngineCancelled. */
  cancel(): void {
    this.failAll(new EngineCancelled())
    this.reset()
  }

  info() {
    return this.call<'info'>({ op: 'info' })
  }

  async inspect(file: File, role: Side, onProgress?: (p: InspectProgress) => void) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const input: FileInput = { name: file.name, bytes }
    return this.call<'inspect'>({ op: 'inspect', file: input, role }, (p) => p.type === 'inspect' && onProgress?.(p), [bytes.buffer])
  }

  validateManifest(json: unknown) {
    return this.call<'validateManifest'>({ op: 'validateManifest', json })
  }

  analyze(input: AnalyzeInput, onStage?: (p: StageProgress) => void) {
    return this.call<'analyze'>({ op: 'analyze', input }, (p) => p.type === 'stage' && onStage?.(p), [input.baseline.bytes.buffer, input.current.bytes.buffer])
  }

  drift(input: DriftInput) {
    return this.call<'drift'>({ op: 'drift', input }, undefined, input.sites.map((s) => s.bytes.buffer))
  }
}

export const engine = new EngineClient()

export async function readFileInput(file: File): Promise<FileInput> {
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
}
