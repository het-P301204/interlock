import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openApiDocument } from '../src/openapi.ts'
import { fixture, makeApp, manifest } from './helpers.ts'

type Json = Record<string, any>

describe('meta routes', () => {
  const t = makeApp()
  afterAll(() => t.close())

  it('reports health without a token', async () => {
    const r = await t.app.request('/api/health')
    expect(r.status).toBe(200)
    const j = (await r.json()) as Json
    expect(j).toMatchObject({ status: 'ok', analysisMode: 'SERVER', db: { engine: 'sqlite', mode: 'memory', ok: true, schemaVersion: 1 }, authRequired: false })
    expect(typeof j['engineVersion']).toBe('string')
    expect(typeof j['uptimeSeconds']).toBe('number')
    expect(r.headers.get('content-security-policy')).toContain("worker-src 'self' blob:")
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('lists adapters, rules and scenarios', async () => {
    const a = (await (await t.app.request('/api/adapters')).json()) as Json
    expect(a['adapters'].some((x: Json) => x['id'] === 'l5x' || x['status'] === 'SUPPORTED')).toBe(true)
    expect(a['uploadExtensions']).toContain('.l5x')
    const rules = (await (await t.app.request('/api/rules')).json()) as Json
    expect(rules['rules'].length).toBeGreaterThan(5)
    const s = (await (await t.app.request('/api/scenarios')).json()) as Json
    expect(s['scenarios'].map((x: Json) => x['id'])).toContain('04')
  })

  it('documents every registered /api route in the OpenAPI document', async () => {
    const doc = (await (await t.app.request('/api/openapi.json')).json()) as Json
    expect(doc['openapi']).toBe('3.1.0')
    const paths = doc['paths'] as Record<string, Record<string, unknown>>
    const registered = t.app.routes.filter((r) => r.path.startsWith('/api/') && r.path !== '/api/*' && r.method !== 'ALL')
    expect(registered.length).toBeGreaterThan(20)
    for (const r of registered) {
      const p = r.path.replace(/:([A-Za-z]+)/g, '{$1}')
      expect(paths[p], `${r.method} ${r.path}`).toBeDefined()
      expect(paths[p]![r.method.toLowerCase()], `${r.method} ${r.path}`).toBeDefined()
    }
    expect(openApiDocument()).toEqual(doc)
  })

  it('answers unknown endpoints with the error envelope', async () => {
    const r = await t.app.request('/api/nope')
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } })
  })
})

describe('projects, uploads and manifests', () => {
  const t = makeApp()
  let projectId = ''
  beforeAll(async () => {
    projectId = await t.createProject()
  })
  afterAll(() => t.close())

  it('validates project bodies', async () => {
    expect((await t.json('POST', '/api/projects', { name: '' })).status).toBe(400)
    expect((await t.json('POST', '/api/projects', { name: 'x', extra: 1 })).status).toBe(400)
    const r = await t.app.request('/api/projects', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"name":"x"}' })
    expect(r.status).toBe(415)
    const bad = await t.app.request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":' })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as Json)['error']['code']).toBe('INVALID_JSON')
    const list = (await (await t.app.request('/api/projects')).json()) as Json
    expect(list['total']).toBe(1)
    expect((await t.app.request('/api/projects/prj_nothere')).status).toBe(404)
  })

  it('uploads an L5X and returns its summary', async () => {
    const r = await t.upload(projectId, 'l5x/baseline-safe.L5X')
    expect(r.status).toBe(201)
    const v = (await r.json()) as Json
    expect(v['id']).toMatch(/^ver_[0-9a-f]{32}$/)
    expect(v['fileName']).toBe('baseline-safe.L5X')
    expect(v['sha256']).toMatch(/^[0-9a-f]{64}$/)
    expect(v['summary']['metadata']['controllerName'] ?? v['summary']['metadata']['name'] ?? JSON.stringify(v['summary']['metadata'])).toContain('NORTHGATE_PS')
    expect(v['summary']['counts']['programs']).toBeGreaterThanOrEqual(7)
    expect(v).not.toHaveProperty('content')
    const got = (await (await t.app.request(`/api/versions/${v['id']}`)).json()) as Json
    expect(got['sha256']).toBe(v['sha256'])
    expect(JSON.stringify(got)).not.toContain('RSLogix5000Content SchemaRevision')
  })

  it('accepts multipart uploads', async () => {
    const form = new FormData()
    form.append('file', new File([fixture('l5x/current-normal.L5X')], 'current-normal.L5X'))
    const r = await t.app.request(`/api/projects/${projectId}/versions`, { method: 'POST', body: form })
    expect(r.status).toBe(201)
    expect(((await r.json()) as Json)['fileName']).toBe('current-normal.L5X')
  })

  it.each([
    ['adversarial/xxe-external-entity.L5X', 'XML_DOCTYPE_FORBIDDEN'],
    ['adversarial/billion-laughs.L5X', 'XML_DOCTYPE_FORBIDDEN'],
    ['adversarial/truncated.L5X', 'XML_UNCLOSED_TAG'],
    ['adversarial/not-xml.L5X', 'XML_NOT_XML'],
    ['adversarial/invalid-utf8.L5X', 'ENCODING_INVALID'],
    ['adversarial/deep-nesting.L5X', 'XML_TOO_DEEP'],
    ['adversarial/plcopen-sample.xml', 'FORMAT_NOT_SUPPORTED'],
  ])('rejects %s with 422 %s and stores nothing', async (rel, code) => {
    const before = ((await (await t.app.request(`/api/projects/${projectId}/versions`)).json()) as Json)['total']
    const r = await t.upload(projectId, rel)
    expect(r.status).toBe(422)
    const j = (await r.json()) as Json
    expect(j['error']['code']).toBe(code)
    expect(typeof j['error']['message']).toBe('string')
    expect(JSON.stringify(j)).not.toMatch(/\bat .+\.ts:\d+/)
    const after = ((await (await t.app.request(`/api/projects/${projectId}/versions`)).json()) as Json)['total']
    expect(after).toBe(before)
  })

  it('validates file names, types and emptiness', async () => {
    const send = (name: string | null, body: Uint8Array<ArrayBuffer>, type = 'application/octet-stream') =>
      t.app.request(`/api/projects/${projectId}/versions${name === null ? '' : `?name=${encodeURIComponent(name)}`}`, { method: 'POST', headers: { 'content-type': type }, body })
    const bytes = fixture('l5x/baseline-safe.L5X')
    expect((await send(null, bytes)).status).toBe(400)
    const exe = await send('evil.exe', bytes)
    expect(exe.status).toBe(415)
    expect(((await exe.json()) as Json)['error']['code']).toBe('UNSUPPORTED_FILE_TYPE')
    expect((await send('x.L5X', new Uint8Array())).status).toBe(400)
    expect((await send('x.L5X', bytes, 'text/plain')).status).toBe(415)
    // Path segments in the name are metadata only: the stored name is the last segment.
    const trav = await send('../../etc/passwd/../x.L5X', bytes)
    expect(trav.status).toBe(201)
    expect(((await trav.json()) as Json)['fileName']).toBe('x.L5X')
  })

  it('validates and stores the safety manifest', async () => {
    expect((await t.app.request(`/api/projects/${projectId}/safety-manifest`)).status).toBe(404)
    const bad = await t.json('PUT', `/api/projects/${projectId}/safety-manifest`, { schema: 'interlock.safety/v1', functions: [{ id: 'SF 1', name: 'x' }] })
    expect(bad.status).toBe(400)
    const bj = (await bad.json()) as Json
    expect(bj['error']['code']).toBe('MANIFEST_INVALID')
    expect(bj['error']['details']['issues'].length).toBeGreaterThan(0)
    const wrongSchema = await t.json('PUT', `/api/projects/${projectId}/safety-manifest`, { schema: 'other', functions: [] })
    expect(wrongSchema.status).toBe(400)
    const ok = await t.json('PUT', `/api/projects/${projectId}/safety-manifest`, manifest())
    expect(ok.status).toBe(200)
    const got = (await (await t.app.request(`/api/projects/${projectId}/safety-manifest`)).json()) as Json
    expect(got['functions']).toHaveLength(8)
    const p = (await (await t.app.request(`/api/projects/${projectId}`)).json()) as Json
    expect(p['hasManifest']).toBe(true)
  })

  it('adds and replaces safety functions by id', async () => {
    const fn = { id: 'SF-09', name: 'Sump high level', kind: 'SHUTDOWN', criticality: 'HIGH', implementation: { program: 'Auxiliary', routine: 'Sump' }, protectiveOutput: { tag: 'Sump_Pump_Run', tripState: 'ENERGIZE' } }
    const add = await t.json('POST', '/api/safety-functions', { projectId, function: fn })
    expect(add.status).toBe(201)
    expect(((await add.json()) as Json)['manifest']['functions']).toHaveLength(9)
    const rep = await t.json('POST', '/api/safety-functions', { projectId, function: { ...fn, name: 'Sump high-high level' } })
    expect(rep.status).toBe(200)
    const rj = (await rep.json()) as Json
    expect(rj['replaced']).toBe(true)
    expect(rj['manifest']['functions']).toHaveLength(9)
    const invalid = await t.json('POST', '/api/safety-functions', { projectId, function: { id: 'SF-10', name: 'No output', kind: 'SHUTDOWN', criticality: 'HIGH', implementation: {} } })
    expect(invalid.status).toBe(400)
    expect(((await invalid.json()) as Json)['error']['code']).toBe('MANIFEST_INVALID')
    expect((await t.json('POST', '/api/safety-functions', { projectId: 'prj_00000000000000000000000000000000', function: fn })).status).toBe(404)
  })
})

describe('upload size limit', () => {
  const t = makeApp({ maxUploadBytes: 4096 })
  afterAll(() => t.close())

  it('returns 413 for a body over INTERLOCK_MAX_UPLOAD_MB (Content-Length)', async () => {
    const id = await t.createProject()
    const r = await t.upload(id, 'l5x/baseline-safe.L5X')
    expect(r.status).toBe(413)
    expect(((await r.json()) as Json)['error']['code']).toBe('PAYLOAD_TOO_LARGE')
  })

  it('returns 413 for a chunked body without Content-Length', async () => {
    const id = await t.createProject()
    const bytes = new Uint8Array(8 * 1024 * 1024).fill(0x20)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent >= bytes.length) return ctrl.close()
        ctrl.enqueue(bytes.subarray(sent, sent + 16384))
        sent += 16384
      },
    })
    const r = await t.app.request(`/api/projects/${id}/versions?name=big.L5X`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: stream, duplex: 'half' } as RequestInit)
    expect(r.status).toBe(413)
    // The limit stopped reading early: far less than the whole file was consumed.
    expect(sent).toBeLessThan(bytes.length)
  })
})

describe('analysis of scenario 02 through the API', () => {
  const t = makeApp()
  let projectId = ''
  let baseline = ''
  let current = ''
  let analysisId = ''
  beforeAll(async () => {
    projectId = await t.createProject()
    baseline = ((await (await t.upload(projectId, 'l5x/baseline-safe.L5X')).json()) as Json)['id']
    current = ((await (await t.upload(projectId, 'l5x/current-shutdown-weakened.L5X')).json()) as Json)['id']
  })
  afterAll(() => t.close())

  it('requires a manifest when the project has none', async () => {
    const r = await t.json('POST', '/api/analyses', { baselineVersionId: baseline, currentVersionId: current })
    expect(r.status).toBe(400)
    expect(((await r.json()) as Json)['error']['code']).toBe('MANIFEST_REQUIRED')
  })

  it('404s an unknown version', async () => {
    const r = await t.json('POST', '/api/analyses', { baselineVersionId: baseline, currentVersionId: 'ver_00000000000000000000000000000000', manifest: manifest() })
    expect(r.status).toBe(404)
  })

  it('runs the analysis in a worker and finds NEW_INHIBIT on SF-06', async () => {
    const r = await t.json('POST', '/api/analyses', { baselineVersionId: baseline, currentVersionId: current, manifest: manifest() })
    expect(r.status).toBe(201)
    const j = (await r.json()) as Json
    analysisId = j['id']
    expect(analysisId).toMatch(/^ana_/)
    expect(j['status']).toBe('COMPLETE')
    expect(j['surface']['priority']).toBe('CRITICAL')
    expect(j['trust']['status']).toBeDefined()
    expect(j['coverage']['percent']).toBeGreaterThan(0)

    const all = (await (await t.app.request(`/api/analyses/${analysisId}/findings`)).json()) as Json
    const inhibit = all['findings'].find((f: Json) => f['type'] === 'NEW_INHIBIT')
    expect(inhibit).toBeDefined()
    expect(inhibit['severity']).toBe('CRITICAL')
    expect(inhibit['safetyFunctionIds']).toContain('SF-06')

    const list = (await (await t.app.request('/api/analyses')).json()) as Json
    expect(list['analyses'][0]).toMatchObject({ id: analysisId, priority: 'CRITICAL', findingCount: all['total'] })
    const full = (await (await t.app.request(`/api/analyses/${analysisId}`)).json()) as Json
    expect(full['result']['schema']).toBe('interlock.analysis/v1')
  })

  it('filters findings', async () => {
    const get = async (q: string) => ((await (await t.app.request(`/api/analyses/${analysisId}/findings?${q}`)).json()) as Json)
    const byType = await get('type=NEW_INHIBIT')
    expect(byType['total']).toBe(1)
    expect(byType['findings'][0]['type']).toBe('NEW_INHIBIT')
    const bySev = await get('severity=critical')
    expect(bySev['findings'].every((f: Json) => f['severity'] === 'CRITICAL')).toBe(true)
    expect(bySev['total']).toBeGreaterThanOrEqual(1)
    const bySf = await get('safetyFunction=sf-06')
    expect(bySf['total']).toBeGreaterThanOrEqual(1)
    expect((await get('safetyFunction=SF-01'))['total']).toBe(0)
    expect((await get('disposition=REVIEW'))['findings'].every((f: Json) => f['disposition'] === 'REVIEW')).toBe(true)
    expect((await get('severity=CRITICAL,INFO&type=ALARM_SUPPRESSED'))['findings'].map((f: Json) => f['type'])).toEqual(['ALARM_SUPPRESSED'])
    const bad = await t.app.request(`/api/analyses/${analysisId}/findings?severity=URGENT`)
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as Json)['error']['code']).toBe('VALIDATION_FAILED')
  })

  it('serves one finding, changes, graph and safety map', async () => {
    const one = await t.app.request(`/api/analyses/${analysisId}/findings/IL-0001`)
    expect(one.status).toBe(200)
    expect(((await one.json()) as Json)['evidence'].length).toBeGreaterThan(0)
    expect((await t.app.request(`/api/analyses/${analysisId}/findings/IL-9999`)).status).toBe(404)
    const ch = (await (await t.app.request(`/api/analyses/${analysisId}/changes?category=logic`)).json()) as Json
    expect(ch['total']).toBeGreaterThanOrEqual(1)
    expect(ch['changes'].every((c: Json) => c['category'] === 'logic')).toBe(true)
    const g = (await (await t.app.request(`/api/analyses/${analysisId}/graph`)).json()) as Json
    expect(g['nodes'].length).toBeGreaterThan(10)
    const sm = (await (await t.app.request(`/api/analyses/${analysisId}/safety-map`)).json()) as Json
    expect(sm['safetyFunctions'].find((s: Json) => s['function']['id'] === 'SF-06')['status']).toBe('IMPACTED')
    expect(Array.isArray(sm['modules'])).toBe(true)
    expect((await t.app.request('/api/analyses/ana_00000000000000000000000000000000/graph')).status).toBe(404)
  })

  it.each([
    ['json', 'application/json', '.json'],
    ['csv', 'text/csv', '.csv'],
    ['md', 'text/markdown', '.md'],
    ['pdf', 'application/pdf', '.pdf'],
  ])('downloads the %s report', async (format, type, ext) => {
    const r = await t.app.request(`/api/analyses/${analysisId}/report?format=${format}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain(type)
    const cd = r.headers.get('content-disposition') ?? ''
    expect(cd).toMatch(new RegExp(`^attachment; filename="[A-Za-z0-9._-]+\\${ext}"$`))
    const buf = Buffer.from(await r.arrayBuffer())
    if (format === 'pdf') expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    else if (format === 'json') expect(JSON.parse(buf.toString('utf8'))['findings'].length).toBeGreaterThan(0)
    else expect(buf.toString('utf8')).toContain('IL-0001')
  })

  it('rejects an unknown report format', async () => {
    expect((await t.app.request(`/api/analyses/${analysisId}/report?format=exe`)).status).toBe(400)
  })

  it('uses the stored project manifest when none is passed', async () => {
    await t.json('PUT', `/api/projects/${projectId}/safety-manifest`, manifest())
    const r = await t.json('POST', '/api/analyses', { baselineVersionId: baseline, currentVersionId: current })
    expect(r.status).toBe(201)
  })
})

describe('drift through the API', () => {
  const t = makeApp()
  afterAll(() => t.close())

  it('compares AOI definitions across three sites', async () => {
    const id = await t.createProject('Sites')
    const ids: string[] = []
    for (const f of ['l5x/site-a.L5X', 'l5x/site-b-drift.L5X', 'l5x/site-c-legacy.L5X']) ids.push(((await (await t.upload(id, f)).json()) as Json)['id'])
    const r = await t.json('POST', '/api/drift', { sites: [{ label: 'Site A', versionId: ids[0] }, { label: 'Site B', versionId: ids[1] }, { label: 'Site C', versionId: ids[2] }] })
    expect(r.status).toBe(200)
    const d = (await r.json()) as Json
    expect(d['schema']).toBe('interlock.drift/v1')
    const aoi = d['modules'].find((m: Json) => m['module'] === 'AOI_PumpInterlock')
    expect(aoi['status']).toBe('DRIFT')
    expect(aoi['flags']).toContain('REVISION_NOT_BUMPED')
    const dup = await t.json('POST', '/api/drift', { sites: [{ label: 'A', versionId: ids[0] }, { label: 'a', versionId: ids[1] }] })
    expect(dup.status).toBe(400)
    expect((await t.json('POST', '/api/drift', { sites: [{ label: 'A', versionId: ids[0] }] })).status).toBe(400)
  })
})

describe('worker timeout', () => {
  it('returns 504 when the analysis exceeds INTERLOCK_ANALYSIS_TIMEOUT_MS', async () => {
    const normal = makeApp()
    const id = await normal.createProject()
    const b = ((await (await normal.upload(id, 'l5x/baseline-large.L5X')).json()) as Json)['id']
    const c = ((await (await normal.upload(id, 'l5x/current-large.L5X')).json()) as Json)['id']
    // A second app over the same store, with a 1 ms budget: the worker cannot even start in time.
    const tiny = makeApp({ analysisTimeoutMs: 1 }, normal.store)
    const r = await tiny.json('POST', '/api/analyses', { baselineVersionId: b, currentVersionId: c, manifest: manifest('manifests/northgate-large.safety.json') })
    expect(r.status).toBe(504)
    const j = (await r.json()) as Json
    expect(j['error']['code']).toBe('ANALYSIS_TIMEOUT')
    expect(j['error']['message']).toMatch(/did not finish within 1 ms/)
    expect(tiny.engine.running).toBe(0)
    // Nothing was stored for the failed run.
    expect(((await (await normal.app.request('/api/analyses')).json()) as Json)['total']).toBe(0)
    await tiny.engine.close()
    await normal.close()
  })

  it('rejects work beyond the concurrency limit with 503', async () => {
    const t = makeApp({ maxConcurrentAnalyses: 1 })
    const id = await t.createProject()
    const results = await Promise.all([t.upload(id, 'l5x/baseline-safe.L5X'), t.upload(id, 'l5x/current-normal.L5X'), t.upload(id, 'l5x/site-a.L5X')])
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toContain(201)
    expect(statuses).toContain(503)
    await t.close()
  })
})

describe('upload admission', () => {
  it('refuses uploads beyond the engine slots before reading their bodies', async () => {
    const t = makeApp({ maxConcurrentAnalyses: 1 })
    const id = await t.createProject()
    const bytes = fixture('l5x/baseline-safe.L5X')
    // The first upload stalls half-way through its body until `release` is called.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let firstSent = 0
    const first = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        if (firstSent >= bytes.length) return ctrl.close()
        if (firstSent >= bytes.length / 2) await gate
        ctrl.enqueue(bytes.subarray(firstSent, firstSent + 4096))
        firstSent += 4096
      },
    })
    const send = (body: ReadableStream<Uint8Array>) =>
      t.app.request(`/api/projects/${id}/versions?name=a.L5X`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body, duplex: 'half' } as RequestInit)
    const pending = send(first)
    while (firstSent < bytes.length / 2) await new Promise((r) => setTimeout(r, 5))

    let secondPulled = 0
    const second = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        secondPulled++
        ctrl.enqueue(new Uint8Array(4096).fill(0x20))
      },
    })
    const busy = await send(second)
    expect(busy.status).toBe(503)
    expect(((await busy.json()) as Json)['error']['code']).toBe('ANALYSIS_BUSY')
    expect(busy.headers.get('retry-after')).toBe('5')
    // Answered without draining the endless body (streams prime a chunk or two).
    expect(secondPulled).toBeLessThanOrEqual(4)

    release()
    expect((await pending).status).toBe(201)
    // The slot is free again.
    expect((await t.upload(id, 'l5x/current-normal.L5X')).status).toBe(201)
    await t.close()
  })

  it('strips control characters from the stored file name', async () => {
    const t = makeApp()
    const id = await t.createProject()
    const r = await t.app.request(`/api/projects/${id}/versions?name=${encodeURIComponent('a\r\nX-Injected: 1\u001b[31m\u009b.L5X')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: fixture('l5x/baseline-safe.L5X'),
    })
    expect(r.status).toBe(201)
    expect(((await r.json()) as Json)['fileName']).toBe('aX-Injected: 1[31m.L5X')
    await t.close()
  })
})
