/**
 * Post-deployment smoke test. Exercises a live INTERLOCK API the way a
 * pipeline would: health, adapters, create a project, upload two synthetic
 * fixture exports, set the safety manifest, analyze, read the findings and
 * download the PDF report. Uses only the synthetic Northgate fixtures.
 *
 *   node scripts/smoke.ts http://127.0.0.1:8787
 *   INTERLOCK_SMOKE_TOKEN=... node scripts/smoke.ts https://interlock.example.com
 *   INTERLOCK_SMOKE_API_ONLY=true node scripts/smoke.ts http://127.0.0.1:8787   (skip the web page check)
 *
 * Runs every check, then exits non-zero if any failed.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const token = process.env['INTERLOCK_SMOKE_TOKEN']
const apiOnly = process.env['INTERLOCK_SMOKE_API_ONLY'] === 'true'
let failed = false

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return token ? { authorization: `Bearer ${token}`, ...extra } : extra
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: headers(body === undefined ? {} : { 'content-type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
}

async function json<T>(r: Response): Promise<T> {
  const text = await r.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`HTTP ${r.status}, not JSON: ${text.slice(0, 120)}`)
  }
}

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const t = performance.now()
  try {
    const detail = await fn()
    console.log(`  ok    ${name.padEnd(30)} ${String(Math.round(performance.now() - t)).padStart(5)}ms  ${detail}`)
  } catch (e) {
    failed = true
    console.log(`  FAIL  ${name.padEnd(30)} ${(e as Error).message}`)
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

interface ErrorBody {
  error?: { code: string; message: string }
}

const fixture = (rel: string) => readFileSync(join(ROOT, 'fixtures', rel))
let projectId = ''
const versions: string[] = []
let analysisId = ''

console.log(`INTERLOCK smoke test -> ${base}${apiOnly ? ' (API only)' : ''}`)

await check('health', async () => {
  const r = await call('GET', '/api/health')
  const j = await json<{ status: string; engineVersion: string; analysisMode: string; db: { engine: string; mode: string } }>(r)
  assert(r.ok && j.status === 'ok', `health ${r.status} ${j.status}`)
  assert(j.analysisMode === 'SERVER', 'analysisMode is not SERVER')
  assert(r.headers.get('content-security-policy'), 'missing Content-Security-Policy header')
  assert(r.headers.get('x-content-type-options') === 'nosniff', 'missing X-Content-Type-Options')
  return `engine ${j.engineVersion}, ${j.db.engine} (${j.db.mode})`
})

await check('adapters', async () => {
  const r = await call('GET', '/api/adapters')
  const j = await json<{ adapters: { id: string; status: string }[] }>(r)
  assert(r.ok, `status ${r.status}`)
  const supported = j.adapters.filter((a) => a.status === 'SUPPORTED').map((a) => a.id)
  assert(supported.length > 0, 'no supported adapter')
  return `supported: ${supported.join(', ')}`
})

await check('create project', async () => {
  const r = await call('POST', '/api/projects', { name: 'Smoke test (synthetic Northgate)', description: 'Created by scripts/smoke.ts' })
  const j = await json<{ id: string } & ErrorBody>(r)
  assert(r.status === 201, `status ${r.status} ${j.error?.code ?? ''}`)
  projectId = j.id
  return projectId
})

for (const rel of ['l5x/baseline-safe.L5X', 'l5x/current-shutdown-weakened.L5X']) {
  await check(`upload ${rel.split('/').pop()}`, async () => {
    assert(projectId, 'no project')
    const name = rel.split('/').pop()!
    const r = await fetch(`${base}/api/projects/${projectId}/versions?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/octet-stream' }),
      body: fixture(rel),
      signal: AbortSignal.timeout(120_000),
    })
    const j = await json<{ id: string; summary: { readiness: string; counts: { rungs: number } } } & ErrorBody>(r)
    assert(r.status === 201, `status ${r.status} ${j.error?.code ?? ''}`)
    versions.push(j.id)
    return `${j.summary.readiness}, ${j.summary.counts.rungs} rungs`
  })
}

await check('rejects hostile upload', async () => {
  assert(projectId, 'no project')
  const r = await fetch(`${base}/api/projects/${projectId}/versions?name=xxe.L5X`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/octet-stream' }),
    body: fixture('adversarial/xxe-external-entity.L5X'),
  })
  const j = await json<ErrorBody>(r)
  assert(r.status === 422 && j.error?.code === 'XML_DOCTYPE_FORBIDDEN', `status ${r.status} ${j.error?.code ?? ''}`)
  return j.error.code
})

await check('safety manifest', async () => {
  const r = await call('PUT', `/api/projects/${projectId}/safety-manifest`, JSON.parse(fixture('manifests/northgate.safety.json').toString('utf8')))
  const j = await json<{ functions: unknown[] } & ErrorBody>(r)
  assert(r.ok, `status ${r.status} ${j.error?.code ?? ''}`)
  return `${j.functions.length} safety functions`
})

await check('analyze', async () => {
  assert(versions.length === 2, 'uploads failed')
  const r = await call('POST', '/api/analyses', { baselineVersionId: versions[0], currentVersionId: versions[1] })
  const j = await json<{ id: string; durationMs: number; trust: { status: string }; surface: { priority: string } } & ErrorBody>(r)
  assert(r.status === 201, `status ${r.status} ${j.error?.code ?? ''}`)
  analysisId = j.id
  assert(j.surface.priority === 'CRITICAL', `priority ${j.surface.priority}, expected CRITICAL`)
  return `${j.trust.status}, priority ${j.surface.priority}, ${j.durationMs}ms`
})

await check('findings', async () => {
  assert(analysisId, 'no analysis')
  const r = await call('GET', `/api/analyses/${analysisId}/findings?severity=CRITICAL`)
  const j = await json<{ total: number; findings: { id: string; type: string; safetyFunctionIds: string[] }[] }>(r)
  assert(r.ok, `status ${r.status}`)
  const inhibit = j.findings.find((f) => f.type === 'NEW_INHIBIT')
  assert(inhibit && inhibit.safetyFunctionIds.includes('SF-06'), 'NEW_INHIBIT on SF-06 not found')
  return `${j.total} critical: ${j.findings.map((f) => f.type).join(', ')}`
})

await check('PDF report', async () => {
  assert(analysisId, 'no analysis')
  const r = await call('GET', `/api/analyses/${analysisId}/report?format=pdf`)
  const buf = Buffer.from(await r.arrayBuffer())
  assert(r.ok, `status ${r.status}`)
  assert(r.headers.get('content-type') === 'application/pdf', `content-type ${r.headers.get('content-type')}`)
  assert((r.headers.get('content-disposition') ?? '').startsWith('attachment;'), 'not an attachment')
  assert(buf.subarray(0, 5).toString('latin1') === '%PDF-', 'not a PDF')
  return `${Math.round(buf.length / 1024)} KB`
})

if (!apiOnly) {
  await check('web app served', async () => {
    const r = await fetch(`${base}/`)
    const html = await r.text()
    assert(r.ok, `status ${r.status}`)
    assert((r.headers.get('content-type') ?? '').startsWith('text/html'), 'not HTML')
    assert(/<script[^>]+type="module"/.test(html), 'no module script in index.html')
    const spa = await fetch(`${base}/analysis/does-not-exist`)
    assert(spa.ok && (await spa.text()) === html, 'SPA fallback did not return index.html')
    return 'index.html + SPA fallback'
  })
}

console.log(failed ? '\nsmoke test FAILED' : '\nsmoke test passed')
process.exit(failed ? 1 : 0)
