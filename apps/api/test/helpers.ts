import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createApp } from '../src/app.ts'
import { REPO_ROOT, testConfig } from '../src/config.ts'
import type { Config } from '../src/config.ts'
import { SqliteStore } from '../src/store.ts'
import type { Store } from '../src/store.ts'

export const FIXTURES = resolve(REPO_ROOT, 'fixtures')

export function fixture(rel: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(resolve(FIXTURES, rel)))
}

export function manifest(rel = 'manifests/northgate.safety.json'): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, rel), 'utf8'))
}

export function makeApp(overrides: Partial<Config> = {}, store: Store = new SqliteStore({ memory: true })) {
  const config = testConfig(overrides)
  const { app, engine } = createApp({ store, config })
  const json = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const upload = (projectId: string, rel: string, headers: Record<string, string> = {}) =>
    app.request(`/api/projects/${projectId}/versions?name=${encodeURIComponent(basename(rel))}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', ...headers },
      body: fixture(rel),
    })
  const createProject = async (name = 'Northgate Pump Station', headers: Record<string, string> = {}) => {
    const r = await json('POST', '/api/projects', { name }, headers)
    if (r.status !== 201) throw new Error(`create project: ${r.status} ${await r.text()}`)
    return ((await r.json()) as { id: string }).id
  }
  const close = async () => {
    await engine.close()
    store.close()
  }
  return { app, store, engine, config, json, upload, createProject, close }
}
