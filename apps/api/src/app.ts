/**
 * INTERLOCK REST API. Every engine call (inspect, analyze, drift) runs in a
 * worker thread with a heap cap and a wall-clock timeout; this module only
 * validates input, moves bytes between the store and the engine, and shapes
 * responses. Errors always use one envelope: { error: { code, message, details? } }.
 */
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { ADAPTER_INFO, ENGINE_VERSION, RULE_INFO, cleanText, toCsv, toJson, toMarkdown, toPdf, validateManifest } from '@interlock/core'
import type { AnalysisResult, DriftReport, Finding, ProjectVersionSummary, SafetyFunction, SafetyManifest } from '@interlock/core'
import { API_VERSION } from './config.ts'
import type { Config } from './config.ts'
import { EngineFailure, EngineRunner } from './engine.ts'
import type { EngineJob, EngineReply } from './engine.ts'
import { openApiDocument } from './openapi.ts'
import { bearerAuth, cors, HttpError, hostCheck, logger, rateLimit, requestContext, secureHeaders, streamingBodyLimit } from './security.ts'
import type { Env, Log } from './security.ts'
import { serveStatic } from './static.ts'
import type { Page, Store } from './store.ts'

export interface AppDeps {
  store: Store
  config: Config
  /** Shared runner (the server passes one so shutdown can stop its workers). */
  engine?: EngineRunner
  log?: Log
  /** Process start, for uptime. */
  startedAt?: number
}

export interface InterlockApp {
  app: Hono<Env>
  engine: EngineRunner
}

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const
const DISPOSITIONS = ['REVIEW', 'UNDECLARED', 'INFORMATIONAL', 'POSITIVE'] as const
const CATEGORIES = ['logic', 'execution', 'interface', 'configuration', 'data', 'documentation', 'metadata'] as const
const REPORT_FORMATS = ['json', 'csv', 'md', 'pdf'] as const

/** Extensions any adapter recognises (planned formats are accepted so the engine can say so honestly). */
export const UPLOAD_EXTENSIONS: readonly string[] = [...new Set(ADAPTER_INFO.flatMap((a) => a.extensions.map((e) => e.toLowerCase())))]

const ID_RE = { prj: /^prj_[0-9a-f]{32}$/, ver: /^ver_[0-9a-f]{32}$/, ana: /^ana_[0-9a-f]{32}$/ } as const

const cleaned = (min: number, max: number) =>
  z
    .string()
    .transform((s) => cleanText(s).trim())
    .pipe(z.string().min(min).max(max))

const versionId = z.string().regex(ID_RE.ver, 'must be a version id (ver_...)')

const CreateProject = z.object({ name: cleaned(1, 200), description: cleaned(0, 2000).nullish() }).strict()
const AddSafetyFunction = z.object({ projectId: z.string().regex(ID_RE.prj, 'must be a project id (prj_...)'), function: z.record(z.string(), z.unknown()) }).strict()
const CreateAnalysis = z.object({ baselineVersionId: versionId, currentVersionId: versionId, manifest: z.unknown().optional() }).strict()
const CreateDrift = z
  .object({
    sites: z
      .array(z.object({ label: cleaned(1, 64), versionId }).strict())
      .min(2)
      .max(20),
    manifest: z.unknown().optional(),
  })
  .strict()

const listParam = (re: RegExp, label: string) =>
  z
    .string()
    .max(500)
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(re, `invalid ${label}`)).max(50))
    .optional()

const FindingFilter = z.object({
  severity: z
    .string()
    .max(200)
    .transform((s) => s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(z.enum(SEVERITIES)))
    .optional(),
  disposition: z
    .string()
    .max(200)
    .transform((s) => s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(z.enum(DISPOSITIONS)))
    .optional(),
  type: listParam(/^[A-Z_]{1,64}$/, 'finding type'),
  safetyFunction: listParam(/^[A-Za-z0-9_-]{1,32}$/, 'safety function id'),
})

export function safeFileName(s: string): string {
  const out = s.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._]+/, '').slice(0, 80)
  return out || 'report'
}

export function createApp(deps: AppDeps): InterlockApp {
  const { store, config } = deps
  const log = deps.log ?? logger(config.logLevel)
  const startedAt = deps.startedAt ?? Date.now()
  const engine =
    deps.engine ?? new EngineRunner({ timeoutMs: config.analysisTimeoutMs, maxOldGenerationSizeMb: config.workerMaxMemoryMb, maxConcurrent: config.maxConcurrentAnalyses })
  const app = new Hono<Env>()

  app.use('*', requestContext(log))
  app.use('*', secureHeaders(config))
  app.use('*', hostCheck(config))
  app.use('/api/*', cors(config))
  app.use('/api/*', rateLimit('api', config.rateLimitPerMinute * 20, 60_000, config.trustProxyHops))

  // The token is checked first: an unauthenticated request is answered before
  // any of its body is read. Body limits are then enforced as the handler reads
  // the body, so neither a large Content-Length nor a chunked body without one
  // gets read past the limit, and a body the handler never reads is never buffered.
  app.use('/api/*', bearerAuth(config))
  const tooLarge = (max: number) => new HttpError(413, 'PAYLOAD_TOO_LARGE', `The request body exceeds the ${formatBytes(max)} limit.`, { limitBytes: max })
  const uploadMax = config.maxUploadBytes + 64 * 1024
  const uploadLimit = streamingBodyLimit(uploadMax, () => tooLarge(config.maxUploadBytes))
  const jsonLimit = streamingBodyLimit(config.maxJsonBytes, () => tooLarge(config.maxJsonBytes))
  const isUpload = (path: string) => /^\/api\/projects\/[^/]+\/versions\/?$/.test(path)
  app.use('/api/*', (c, next) => (c.req.method === 'POST' && isUpload(c.req.path) ? uploadLimit(c, next) : jsonLimit(c, next)))

  const engineLimiter = rateLimit('engine', config.rateLimitPerMinute, 60_000, config.trustProxyHops)

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const body: { error: { code: string; message: string; details?: unknown } } = { error: { code: err.code, message: err.message } }
      if (err.details !== undefined) body.error.details = err.details
      return c.json(body, err.status as 400)
    }
    if (err instanceof z.ZodError) {
      return c.json(
        { error: { code: 'VALIDATION_FAILED', message: 'The request did not match the expected shape.', details: err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        400,
      )
    }
    // Never return stack traces: log a truncated one with the request id the client gets back.
    log('error', {
      requestId: c.get('requestId'),
      route: c.req.routePath,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 6).join(' | ') : undefined,
    })
    return c.json({ error: { code: 'INTERNAL', message: 'INTERLOCK could not complete the request. The error has been logged.', details: { requestId: c.get('requestId') } } }, 500)
  })

  /* ---------------------------------------------------------------- helpers */

  const jsonBody = async <T extends z.ZodType>(c: Context<Env>, schema: T): Promise<z.infer<T>> => {
    const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (type !== 'application/json') throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json.')
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch (e) {
      if (e instanceof HttpError) throw e
      throw new HttpError(400, 'INVALID_JSON', 'The request body is not valid JSON.')
    }
    return schema.parse(raw)
  }

  const page = (c: Context<Env>): Page => {
    const p = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) })
      .parse({ limit: c.req.query('limit'), offset: c.req.query('offset') })
    return p
  }

  const project = (id: string) => {
    const p = ID_RE.prj.test(id) ? store.getProject(id) : null
    if (!p) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'No project with that id.')
    return p
  }

  const version = (id: string) => {
    const v = ID_RE.ver.test(id) ? store.getVersion(id) : null
    if (!v) throw new HttpError(404, 'VERSION_NOT_FOUND', `No project version ${id}.`, { versionId: id })
    return v
  }

  const versionFile = (id: string) => {
    const v = version(id)
    const bytes = store.getVersionBytes(v.id)
    if (!bytes) throw new HttpError(404, 'VERSION_NOT_FOUND', `No project version ${id}.`, { versionId: id })
    return { record: v, file: { name: v.fileName, bytes } }
  }

  const analysisResult = (id: string): AnalysisResult => {
    const r = ID_RE.ana.test(id) ? store.getAnalysisResult(id) : null
    if (!r) throw new HttpError(404, 'ANALYSIS_NOT_FOUND', 'No analysis with that id.')
    return r
  }

  const manifestOrError = (json: unknown): SafetyManifest => {
    const v = validateManifest(json)
    if (!v.ok) throw new HttpError(400, 'MANIFEST_INVALID', 'The safety manifest is not valid.', { issues: v.issues })
    return v.manifest
  }

  const runEngine = async (job: EngineJob): Promise<Extract<EngineReply, { ok: true }>> => {
    let reply: EngineReply
    try {
      reply = await engine.run(job)
    } catch (e) {
      if (e instanceof EngineFailure) {
        switch (e.reason) {
          case 'TIMEOUT':
            throw new HttpError(504, 'ANALYSIS_TIMEOUT', e.message, { timeoutMs: config.analysisTimeoutMs })
          case 'OUT_OF_MEMORY':
            throw new HttpError(503, 'ANALYSIS_MEMORY_LIMIT', e.message, { limitMb: config.workerMaxMemoryMb })
          case 'BUSY':
            throw new HttpError(503, 'ANALYSIS_BUSY', e.message)
          case 'SHUTTING_DOWN':
            throw new HttpError(503, 'SHUTTING_DOWN', e.message)
          default:
            throw new HttpError(500, 'ENGINE_FAILED', 'The analysis worker failed unexpectedly. The error has been logged.')
        }
      }
      throw e
    }
    if (reply.ok) return reply
    if (reply.kind === 'input') {
      const details: Record<string, unknown> = { side: reply.side }
      if (reply.location !== undefined) details['location'] = reply.location
      if (reply.line !== undefined) details['line'] = reply.line
      if (reply.column !== undefined) details['column'] = reply.column
      if (reply.issues.length) details['issues'] = reply.issues
      throw new HttpError(422, reply.code, reply.message, details)
    }
    log('error', { operation: `engine.${job.kind}`, error: reply.message })
    throw new HttpError(500, 'ENGINE_FAILED', 'The analysis engine failed unexpectedly. The error has been logged.')
  }

  let scenarios: unknown = null
  const loadScenarios = () => {
    if (scenarios === null) {
      try {
        scenarios = JSON.parse(readFileSync(config.scenariosFile, 'utf8'))
      } catch {
        scenarios = { schema: 'interlock.scenarios/v1', scenarios: [] }
      }
    }
    return scenarios
  }

  /* ----------------------------------------------------------------- public */

  app.get('/api/health', (c) => {
    const ok = store.ping()
    return c.json(
      {
        status: ok ? 'ok' : 'degraded',
        service: 'interlock-api',
        version: API_VERSION,
        engineVersion: ENGINE_VERSION,
        analysisMode: 'SERVER',
        db: { engine: store.engine, mode: store.mode, ok, schemaVersion: ok ? store.schemaVersion() : null },
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        authRequired: config.apiToken !== null,
        limits: { maxUploadBytes: config.maxUploadBytes, analysisTimeoutMs: config.analysisTimeoutMs, workerMaxMemoryMb: config.workerMaxMemoryMb },
      },
      ok ? 200 : 503,
    )
  })

  app.get('/api/openapi.json', (c) => c.json(openApiDocument()))
  app.get('/api/adapters', (c) => c.json({ adapters: ADAPTER_INFO, uploadExtensions: UPLOAD_EXTENSIONS }))
  app.get('/api/rules', (c) => c.json({ rules: RULE_INFO }))
  app.get('/api/scenarios', (c) => c.json(loadScenarios()))

  /* --------------------------------------------------------------- projects */

  app.post('/api/projects', async (c) => {
    const input = await jsonBody(c, CreateProject)
    const p = store.createProject({ name: input.name, description: input.description ? input.description : null })
    return c.json(p, 201)
  })

  app.get('/api/projects', (c) => {
    const { rows, total } = store.listProjects(page(c))
    return c.json({ total, projects: rows })
  })

  app.get('/api/projects/:id', (c) => c.json(project(c.req.param('id'))))

  // Uploads whose body is being buffered or inspected right now. Every upload
  // runs an engine job, so more of them than engine slots can never all
  // succeed; refusing the excess before reading the body keeps N concurrent
  // max-size uploads from buffering N bodies in the server's memory only to be
  // answered ANALYSIS_BUSY afterwards.
  let uploadsInFlight = 0

  app.post('/api/projects/:id/versions', engineLimiter, async (c) => {
    const p = project(c.req.param('id'))
    const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const name = c.req.query('name')
    // Reject a bad name or extension before reading a possibly large body.
    if (name !== undefined) validateFileName(name)
    if (uploadsInFlight >= config.maxConcurrentAnalyses) {
      c.header('Retry-After', '5')
      throw new HttpError(503, 'ANALYSIS_BUSY', `${uploadsInFlight} uploads are already being processed. Try again shortly.`)
    }
    uploadsInFlight++
    try {
      return await receiveVersion(c, p.id, type, name)
    } finally {
      uploadsInFlight--
    }
  })

  const receiveVersion = async (c: Context<Env>, projectId: string, type: string, name: string | undefined) => {
    let bytes: Uint8Array
    if (type === 'multipart/form-data') {
      let form: Record<string, unknown>
      try {
        form = await c.req.parseBody()
      } catch (e) {
        if (e instanceof HttpError) throw e
        throw new HttpError(400, 'INVALID_MULTIPART', 'The multipart body could not be read.')
      }
      const f = form['file']
      if (!(f instanceof File)) throw new HttpError(400, 'FILE_REQUIRED', 'Send the project file in a multipart field named "file".')
      name = name ?? f.name
      bytes = new Uint8Array(await f.arrayBuffer())
    } else if (type === 'application/octet-stream') {
      bytes = new Uint8Array(await c.req.arrayBuffer())
    } else {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the file as application/octet-stream with ?name=<filename>, or as multipart/form-data field "file".')
    }
    const fileName = validateFileName(name)
    if (bytes.length > config.maxUploadBytes) throw tooLarge(config.maxUploadBytes)
    if (bytes.length === 0) throw new HttpError(400, 'EMPTY_FILE', 'The uploaded file is empty.')
    const reply = await runEngine({ kind: 'inspect', file: { name: fileName, bytes }, role: 'current' })
    const summary = JSON.parse(reply.json) as ProjectVersionSummary
    const v = store.addVersion({ projectId, fileName, sha256: summary.file.sha256, bytes, summary })
    return c.json(v, 201)
  }

  app.get('/api/projects/:id/versions', (c) => {
    const p = project(c.req.param('id'))
    const { rows, total } = store.listVersions(p.id, page(c))
    return c.json({ total, versions: rows })
  })

  app.get('/api/versions/:id', (c) => c.json(version(c.req.param('id'))))

  /* -------------------------------------------------------- safety manifest */

  app.get('/api/projects/:id/safety-manifest', (c) => {
    const p = project(c.req.param('id'))
    const m = store.getManifest(p.id)
    if (!m) throw new HttpError(404, 'MANIFEST_NOT_SET', 'This project has no safety manifest yet. PUT one, or add functions with POST /api/safety-functions.')
    return c.json(m)
  })

  app.put('/api/projects/:id/safety-manifest', async (c) => {
    const p = project(c.req.param('id'))
    const manifest = manifestOrError(await jsonBody(c, z.unknown()))
    store.setManifest(p.id, manifest)
    return c.json(manifest)
  })

  app.post('/api/safety-functions', async (c) => {
    const input = await jsonBody(c, AddSafetyFunction)
    const p = project(input.projectId)
    const existing: SafetyManifest = store.getManifest(p.id) ?? { schema: 'interlock.safety/v1', project: p.name, functions: [] }
    const fn = input.function as unknown as SafetyFunction
    const id = typeof fn.id === 'string' ? cleanText(fn.id).trim().toLowerCase() : ''
    const at = existing.functions.findIndex((f) => f.id.toLowerCase() === id)
    const functions = [...existing.functions]
    if (at >= 0) functions[at] = fn
    else functions.push(fn)
    const manifest = manifestOrError({ ...existing, functions })
    store.setManifest(p.id, manifest)
    return c.json({ replaced: at >= 0, manifest }, at >= 0 ? 200 : 201)
  })

  /* --------------------------------------------------------------- analyses */

  app.post('/api/analyses', engineLimiter, async (c) => {
    const input = await jsonBody(c, CreateAnalysis)
    const baseline = versionFile(input.baselineVersionId)
    const current = versionFile(input.currentVersionId)
    let manifest: SafetyManifest
    if (input.manifest !== undefined) manifest = manifestOrError(input.manifest)
    else {
      const stored = store.getManifest(current.record.projectId)
      if (!stored) throw new HttpError(400, 'MANIFEST_REQUIRED', "Pass a manifest, or set the current version's project safety manifest first.")
      manifest = stored
    }
    const t0 = performance.now()
    const reply = await runEngine({ kind: 'analyze', baseline: baseline.file, current: current.file, manifest, analyzedAt: new Date().toISOString() })
    const result = JSON.parse(reply.json) as AnalysisResult
    const rec = store.addAnalysis({
      projectId: current.record.projectId,
      baselineVersionId: baseline.record.id,
      currentVersionId: current.record.id,
      durationMs: performance.now() - t0,
      result,
      resultJson: reply.json,
    })
    return c.json({ ...rec, trust: result.trust, surface: result.surface, coverage: result.coverage }, 201)
  })

  app.get('/api/analyses', (c) => {
    const { rows, total } = store.listAnalyses(page(c))
    return c.json({ total, analyses: rows })
  })

  app.get('/api/analyses/:id', (c) => {
    const id = c.req.param('id')
    const result = analysisResult(id)
    return c.json({ ...store.getAnalysis(id)!, result })
  })

  app.get('/api/analyses/:id/findings', (c) => {
    const r = analysisResult(c.req.param('id'))
    const f = FindingFilter.parse({ severity: c.req.query('severity'), disposition: c.req.query('disposition'), type: c.req.query('type'), safetyFunction: c.req.query('safetyFunction') })
    const lower = (xs: string[] | undefined) => (xs ? new Set(xs.map((x) => x.toLowerCase())) : null)
    const sfs = lower(f.safetyFunction)
    const findings = r.findings.filter(
      (x: Finding) =>
        (!f.severity?.length || f.severity.includes(x.severity)) &&
        (!f.disposition?.length || f.disposition.includes(x.disposition)) &&
        (!f.type?.length || f.type.includes(x.type)) &&
        (!sfs?.size || x.safetyFunctionIds.some((s) => sfs.has(s.toLowerCase()))),
    )
    return c.json({ total: findings.length, findings })
  })

  app.get('/api/analyses/:id/findings/:findingId', (c) => {
    const r = analysisResult(c.req.param('id'))
    const fid = c.req.param('findingId')
    const finding = r.findings.find((x) => x.id === fid)
    if (!finding) throw new HttpError(404, 'FINDING_NOT_FOUND', 'No finding with that id in this analysis.')
    return c.json(finding)
  })

  app.get('/api/analyses/:id/changes', (c) => {
    const r = analysisResult(c.req.param('id'))
    const cat = z.enum(CATEGORIES).optional().parse(c.req.query('category') || undefined)
    const changes = cat ? r.changes.filter((x) => x.category === cat) : r.changes
    return c.json({ total: changes.length, changes })
  })

  app.get('/api/analyses/:id/graph', (c) => c.json(analysisResult(c.req.param('id')).graph))

  app.get('/api/analyses/:id/safety-map', (c) => {
    const r = analysisResult(c.req.param('id'))
    return c.json({ safetyFunctions: r.safetyFunctions, modules: r.modules })
  })

  app.get('/api/analyses/:id/report', (c) => {
    const r = analysisResult(c.req.param('id'))
    const format = z.enum(REPORT_FORMATS).parse(c.req.query('format') ?? 'json')
    const base = `interlock-${safeFileName(r.current.file.name.replace(/\.[^.]*$/, ''))}-${r.id.slice(0, 12)}`
    const send = (body: string | Uint8Array, type: string, ext: string) => {
      c.header('Content-Type', type)
      c.header('Content-Disposition', `attachment; filename="${safeFileName(`${base}.${ext}`)}"`)
      return c.body(typeof body === 'string' ? body : new Uint8Array(body))
    }
    switch (format) {
      case 'json':
        return send(toJson(r), 'application/json; charset=utf-8', 'json')
      case 'csv':
        return send(toCsv(r), 'text/csv; charset=utf-8', 'csv')
      case 'md':
        return send(toMarkdown(r), 'text/markdown; charset=utf-8', 'md')
      case 'pdf':
        return send(toPdf(r), 'application/pdf', 'pdf')
    }
  })

  /* ------------------------------------------------------------------ drift */

  app.post('/api/drift', engineLimiter, async (c) => {
    const input = await jsonBody(c, CreateDrift)
    const labels = new Set<string>()
    for (const s of input.sites) {
      const k = s.label.toLowerCase()
      if (labels.has(k)) throw new HttpError(400, 'DUPLICATE_LABEL', `Site label "${s.label}" is used twice.`)
      labels.add(k)
    }
    const sites = input.sites.map((s) => ({ label: s.label, ...versionFile(s.versionId).file }))
    const job: EngineJob = { kind: 'drift', sites, analyzedAt: new Date().toISOString() }
    if (input.manifest !== undefined) job.manifest = manifestOrError(input.manifest)
    const reply = await runEngine(job)
    return c.json(JSON.parse(reply.json) as DriftReport)
  })

  app.all('/api/*', () => {
    throw new HttpError(404, 'NOT_FOUND', 'No such endpoint.')
  })

  if (config.production) serveStatic(app, config.webDist)

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404))

  function validateFileName(raw: string | undefined): string {
    if (!raw) throw new HttpError(400, 'FILE_NAME_REQUIRED', 'Pass the file name as ?name=<filename>.')
    // Metadata only: the name is never used as a path. Keep the last segment, strip invisible characters.
    // Control characters (CR/LF, ESC, C1) are removed too: the name is echoed in JSON, reports and logs.
    const last = cleanText(raw).replace(/\p{Cc}/gu, '').split(/[\\/]/).pop()!.trim()
    if (!last || last.length > 200 || last === '.' || last === '..') throw new HttpError(400, 'INVALID_FILE_NAME', 'The file name is empty or longer than 200 characters.')
    const ext = (/\.[^.]+$/.exec(last)?.[0] ?? '').toLowerCase()
    if (!UPLOAD_EXTENSIONS.includes(ext)) {
      throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', `Files of type "${ext || '(none)'}" are not accepted. Upload a project export (${UPLOAD_EXTENSIONS.join(', ')}).`, {
        accepted: UPLOAD_EXTENSIONS,
      })
    }
    return last
  }

  return { app, engine }
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${Math.round((n / 1024 / 1024) * 10) / 10} MB` : `${Math.ceil(n / 1024)} KB`
}
