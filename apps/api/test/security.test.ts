import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config.ts'
import { resolveInside } from '../src/static.ts'
import { tokenMatches } from '../src/security.ts'
import { makeApp } from './helpers.ts'

type Json = Record<string, any>
const TOKEN = 'test-token-0123456789abcdef'

describe('bearer token', () => {
  const t = makeApp({ apiToken: TOKEN })
  afterAll(() => t.close())

  it('leaves /api/health open', async () => {
    const r = await t.app.request('/api/health')
    expect(r.status).toBe(200)
    expect(((await r.json()) as Json)['authRequired']).toBe(true)
  })

  it.each(['/api/adapters', '/api/rules', '/api/projects', '/api/analyses', '/api/openapi.json', '/api/nope'])('requires the token on %s', async (path) => {
    const none = await t.app.request(path)
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toContain('Bearer')
    expect(((await none.json()) as Json)['error']['code']).toBe('UNAUTHORIZED')
    expect((await t.app.request(path, { headers: { authorization: `Bearer ${TOKEN}x` } })).status).toBe(401)
    expect((await t.app.request(path, { headers: { authorization: `Basic ${TOKEN}` } })).status).toBe(401)
    expect((await t.app.request(path, { headers: { authorization: `Bearer ${TOKEN}` } })).status).not.toBe(401)
  })

  it('protects mutations too', async () => {
    expect((await t.json('POST', '/api/projects', { name: 'x' })).status).toBe(401)
    expect((await t.json('POST', '/api/projects', { name: 'x' }, { authorization: `Bearer ${TOKEN}` })).status).toBe(201)
  })

  it('compares tokens of any length safely', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true)
    expect(tokenMatches('', TOKEN)).toBe(false)
    expect(tokenMatches(TOKEN + TOKEN, TOKEN)).toBe(false)
  })
})

describe('configuration', () => {
  it('refuses a short API token', () => {
    expect(() => loadConfig({ INTERLOCK_API_TOKEN: 'short' }, [])).toThrow(ConfigError)
  })
  it('rejects nonsense limits', () => {
    expect(() => loadConfig({ INTERLOCK_MAX_UPLOAD_MB: '-1' }, [])).toThrow(ConfigError)
    expect(() => loadConfig({ INTERLOCK_ANALYSIS_TIMEOUT_MS: 'soon' }, [])).toThrow(ConfigError)
  })
  it('binds loopback by default and accepts only loopback Host names there', () => {
    const c = loadConfig({}, [])
    expect(c.host).toBe('127.0.0.1')
    expect(c.allowedHosts).toEqual(['127.0.0.1', 'localhost', '[::1]'])
    expect(c.maxUploadBytes).toBe(64 * 1024 * 1024)
    expect(c.analysisTimeoutMs).toBe(60_000)
    expect(loadConfig({ HOST: '0.0.0.0' }, []).allowedHosts).toEqual([])
  })
})

describe('origin, host and CORS', () => {
  const t = makeApp({ allowedOrigins: ['https://review.example.com'], allowedHosts: ['127.0.0.1', 'localhost'] })
  afterAll(() => t.close())

  it('rejects cross-origin mutations from unknown origins', async () => {
    const r = await t.json('POST', '/api/projects', { name: 'x' }, { origin: 'https://evil.example' })
    expect(r.status).toBe(403)
    expect(((await r.json()) as Json)['error']['code']).toBe('ORIGIN_REJECTED')
    const ok = await t.json('POST', '/api/projects', { name: 'x' }, { origin: 'https://review.example.com' })
    expect(ok.status).toBe(201)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://review.example.com')
  })

  it('gives no CORS headers to unknown origins', async () => {
    const r = await t.app.request('/api/rules', { headers: { origin: 'https://evil.example' } })
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
    const pre = await t.app.request('/api/projects', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
    expect(pre.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses requests for foreign Host names (DNS rebinding)', async () => {
    const r = await t.app.request('http://attacker.example/api/rules')
    expect(r.status).toBe(421)
    expect((await t.app.request('http://127.0.0.1:8797/api/rules')).status).toBe(200)
  })
})

describe('static web app serving', () => {
  const base = mkdtempSync(join(tmpdir(), 'interlock-static-'))
  const dist = join(base, 'dist')
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>INTERLOCK</title><div id="root"></div>')
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(join(base, 'secret.txt'), 'TOP-SECRET-OUTSIDE-DIST')
  const t = makeApp({ production: true, webDist: dist })
  afterAll(async () => {
    await t.close()
    rmSync(base, { recursive: true, force: true })
  })

  it('serves index.html, hashed assets and SPA routes', async () => {
    const root = await t.app.request('/')
    expect(root.status).toBe(200)
    expect(root.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(root.headers.get('cache-control')).toBe('no-cache')
    expect(await root.text()).toContain('INTERLOCK')
    const js = await t.app.request('/assets/index-abc123.js')
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const spa = await t.app.request('/analyses/ana_1/findings')
    expect(spa.status).toBe(200)
    expect(await spa.text()).toContain('<div id="root">')
    expect((await t.app.request('/assets/missing.js')).status).toBe(404)
    expect((await t.app.request('/api/missing')).status).toBe(404)
  })

  it.each([
    '/../secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%5csecret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/assets/%2e%2e%5c%2e%2e%5csecret.txt',
    '/%252e%252e%252fsecret.txt',
    '/..%00/secret.txt',
    `/${encodeURIComponent(join(base, 'secret.txt'))}`,
  ])('never serves a file outside dist for %s', async (path) => {
    const r = await t.app.request(path)
    const body = await r.text()
    expect(body).not.toContain('TOP-SECRET-OUTSIDE-DIST')
  })

  it('resolveInside rejects escapes and accepts real files', () => {
    expect(resolveInside(dist, '/index.html')).not.toBeNull()
    expect(resolveInside(dist, '/../secret.txt')).toBeNull()
    expect(resolveInside(dist, '/..%5csecret.txt')).toBeNull()
    expect(resolveInside(dist, '/%E0%A4%A')).toBeNull()
    expect(resolveInside(dist, '/assets')).toBeNull()
  })
})
