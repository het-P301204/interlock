/**
 * Runs engine jobs in worker threads with a heap cap and a wall-clock
 * timeout. One worker per job: the engine is synchronous and CPU-bound, and a
 * fresh isolate means a job that blew its memory budget leaves nothing behind.
 */
import { Worker } from 'node:worker_threads'
import type { SafetyManifest, Side } from '@interlock/core'

export interface EngineFile {
  name: string
  bytes: Uint8Array
}

export type EngineJob =
  | { kind: 'inspect'; file: EngineFile; role: Side }
  | { kind: 'analyze'; baseline: EngineFile; current: EngineFile; manifest: SafetyManifest; analyzedAt: string }
  | { kind: 'drift'; sites: (EngineFile & { label: string })[]; manifest?: SafetyManifest; analyzedAt: string }

export type EngineReply =
  | { ok: true; json: string }
  | { ok: false; kind: 'input'; side: Side | 'manifest'; code: string; message: string; location?: string; line?: number; column?: number; issues: string[] }
  | { ok: false; kind: 'internal'; code: string; message: string }

export type EngineFailureReason = 'TIMEOUT' | 'OUT_OF_MEMORY' | 'BUSY' | 'CRASHED' | 'SHUTTING_DOWN'

/** The job could not run to completion (as opposed to the engine rejecting its input). */
export class EngineFailure extends Error {
  readonly reason: EngineFailureReason
  constructor(reason: EngineFailureReason, message: string) {
    super(message)
    this.name = 'EngineFailure'
    this.reason = reason
  }
}

export interface EngineOptions {
  timeoutMs: number
  maxOldGenerationSizeMb: number
  maxConcurrent: number
}

const WORKER_URL = new URL('./engine-worker.ts', import.meta.url)

export class EngineRunner {
  private readonly opts: EngineOptions
  private readonly active = new Set<Worker>()
  private closed = false

  constructor(opts: EngineOptions) {
    this.opts = opts
  }

  get running(): number {
    return this.active.size
  }

  run(job: EngineJob, overrides: Partial<EngineOptions> = {}): Promise<EngineReply> {
    const opts = { ...this.opts, ...overrides }
    if (this.closed) return Promise.reject(new EngineFailure('SHUTTING_DOWN', 'The server is shutting down.'))
    if (this.active.size >= opts.maxConcurrent) {
      return Promise.reject(new EngineFailure('BUSY', `${this.active.size} analyses are already running. Try again shortly.`))
    }
    return new Promise<EngineReply>((resolve, reject) => {
      const worker = new Worker(WORKER_URL, {
        workerData: job,
        resourceLimits: { maxOldGenerationSizeMb: opts.maxOldGenerationSizeMb, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 },
        // The worker needs nothing from the parent's environment.
        env: {},
        stdout: false,
        stderr: false,
      })
      this.active.add(worker)
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.active.delete(worker)
        fn()
      }
      const timer = setTimeout(() => {
        finish(() => reject(new EngineFailure('TIMEOUT', `The analysis did not finish within ${opts.timeoutMs} ms and was stopped.`)))
        void worker.terminate()
      }, opts.timeoutMs)
      worker.once('message', (reply: EngineReply) => {
        finish(() => resolve(reply))
        void worker.terminate()
      })
      worker.once('error', (err: Error & { code?: string }) => {
        const oom = err.code === 'ERR_WORKER_OUT_OF_MEMORY'
        finish(() =>
          reject(
            oom
              ? new EngineFailure('OUT_OF_MEMORY', `The analysis exceeded its ${opts.maxOldGenerationSizeMb} MB memory limit and was stopped.`)
              : new EngineFailure('CRASHED', 'The analysis worker failed unexpectedly.'),
          ),
        )
      })
      worker.once('exit', () => {
        finish(() => reject(new EngineFailure(this.closed ? 'SHUTTING_DOWN' : 'CRASHED', 'The analysis worker exited without a result.')))
      })
    })
  }

  /** Stop accepting jobs and terminate every running worker. */
  async close(): Promise<void> {
    this.closed = true
    await Promise.all([...this.active].map((w) => w.terminate()))
    this.active.clear()
  }
}
