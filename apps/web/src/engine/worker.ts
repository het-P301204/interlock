/**
 * INTERLOCK analysis worker (module worker).
 *
 * Runs the deterministic engine off the UI thread, entirely inside this
 * browser: project bytes arrive by postMessage and never leave the page.
 * Progress messages are only ever sent for work that actually happened:
 *   inspect  hashing -> hashed (sha256 computed here) -> parsing -> result
 *   analyze  one `stage` message per StageEvent the engine emits
 */
import { ADAPTER_INFO, ENGINE_VERSION, analyzeDrift, analyzeProjects, inspectProject, toCsv, toJson, toMarkdown, toPdf, validateManifest } from '@interlock/core'
import type { ParserDiagnostic } from '@interlock/core/types'
import type { EngineProgress, EngineRequest, EngineResponse, SerializedError } from './protocol.ts'

interface WorkerScope {
  postMessage(message: EngineResponse): void
  addEventListener(type: 'message', listener: (e: MessageEvent<EngineRequest>) => void): void
}

const scope = self as unknown as WorkerScope

function post(msg: EngineResponse): void {
  scope.postMessage(msg)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function serializeError(err: unknown): SerializedError {
  if (isRecord(err)) {
    const out: SerializedError = {
      message: typeof err.message === 'string' ? err.message : 'Analysis could not be completed.',
      name: typeof err.name === 'string' ? err.name : undefined,
      code: typeof err.code === 'string' ? err.code : undefined,
    }
    // AnalyzeFailure: { side, error: InspectError }
    if ((err.side === 'baseline' || err.side === 'current' || err.side === 'manifest') && isRecord(err.error)) {
      const inner = err.error
      out.failure = {
        side: err.side,
        error: {
          code: String(inner.code ?? 'ANALYSIS_FAILED'),
          message: String(inner.message ?? out.message),
          location: typeof inner.location === 'string' ? inner.location : undefined,
          line: typeof inner.line === 'number' ? inner.line : undefined,
          column: typeof inner.column === 'number' ? inner.column : undefined,
          diagnostics: Array.isArray(inner.diagnostics) ? (inner.diagnostics as ParserDiagnostic[]) : [],
        },
      }
      if (typeof inner.message === 'string') out.message = inner.message
    } else if (typeof err.code === 'string' && Array.isArray(err.diagnostics)) {
      // ProjectParseError-shaped
      const source = isRecord(err.source) ? err.source : undefined
      out.inspect = {
        code: err.code,
        message: out.message,
        location: typeof err.location === 'string' ? err.location : undefined,
        line: typeof source?.line === 'number' ? source.line : undefined,
        column: typeof source?.column === 'number' ? source.column : undefined,
        diagnostics: err.diagnostics as ParserDiagnostic[],
      }
    }
    return out
  }
  return { message: typeof err === 'string' ? err : 'Analysis could not be completed.' }
}

async function handle(req: EngineRequest): Promise<unknown> {
  const started = performance.now()
  const progress = (p: EngineProgress) => post({ id: req.id, kind: 'progress', progress: p })
  const at = () => performance.now() - started

  switch (req.op) {
    case 'info':
      return { engineVersion: ENGINE_VERSION, adapters: ADAPTER_INFO }
    case 'inspect': {
      progress({ type: 'inspect', phase: 'hashing', atMs: at() })
      const sha256 = await sha256Hex(req.file.bytes)
      progress({ type: 'inspect', phase: 'hashed', sha256, atMs: at() })
      progress({ type: 'inspect', phase: 'parsing', atMs: at() })
      return inspectProject(req.file, req.role)
    }
    case 'validateManifest':
      return validateManifest(req.json)
    case 'analyze':
      return analyzeProjects(req.input, {
        onStage: (event) => progress({ type: 'stage', event, atMs: at() }),
      })
    case 'drift':
      return analyzeDrift(req.input)
    case 'report': {
      // Deterministic: the same AnalysisResult always yields the same bytes.
      const r = req.result
      if (req.format === 'pdf') return { format: 'pdf', mime: 'application/pdf', data: toPdf(r) }
      if (req.format === 'json') return { format: 'json', mime: 'application/json', data: toJson(r) }
      if (req.format === 'csv') return { format: 'csv', mime: 'text/csv', data: toCsv(r) }
      return { format: 'md', mime: 'text/markdown', data: toMarkdown(r) }
    }
  }
}

scope.addEventListener('message', (e) => {
  const req = e.data
  const started = performance.now()
  handle(req).then(
    (value) => post({ id: req.id, kind: 'result', value, elapsedMs: performance.now() - started }),
    (err: unknown) => post({ id: req.id, kind: 'error', error: serializeError(err) }),
  )
})
