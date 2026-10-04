/**
 * Worker thread entry: runs one engine job and exits. The parent caps its heap
 * (resourceLimits) and its wall-clock time (terminate on timeout), so a
 * pathological file can slow down one request, never the server.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { AnalysisInputError, analyzeDriftSync, analyzeProjectsSync, inspectProjectSync } from '@interlock/core'
import type { EngineJob, EngineReply } from './engine.ts'

function run(job: EngineJob): EngineReply {
  try {
    switch (job.kind) {
      case 'inspect': {
        const r = inspectProjectSync({ name: job.file.name, bytes: job.file.bytes }, job.role)
        return r.ok ? { ok: true, json: JSON.stringify(r.summary) } : { ok: false, kind: 'input', side: job.role, code: r.error.code, message: r.error.message, location: r.error.location, line: r.error.line, column: r.error.column, issues: [] }
      }
      case 'analyze': {
        const r = analyzeProjectsSync({ baseline: job.baseline, current: job.current, manifest: job.manifest, analyzedAt: job.analyzedAt })
        return { ok: true, json: JSON.stringify(r) }
      }
      case 'drift': {
        const input = job.manifest ? { sites: job.sites, analyzedAt: job.analyzedAt, manifest: job.manifest } : { sites: job.sites, analyzedAt: job.analyzedAt }
        return { ok: true, json: JSON.stringify(analyzeDriftSync(input)) }
      }
    }
  } catch (e) {
    if (e instanceof AnalysisInputError) {
      return { ok: false, kind: 'input', side: e.side, code: e.code, message: e.message, location: e.location, line: e.line, column: e.column, issues: e.issues }
    }
    return { ok: false, kind: 'internal', code: 'ENGINE_ERROR', message: e instanceof Error ? e.message : String(e) }
  }
}

parentPort?.postMessage(run(workerData as EngineJob))
