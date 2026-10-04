import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { inspectProjectSync } from '@interlock/core'
import { MIGRATIONS, SqliteStore } from '../src/store.ts'
import { fixture } from './helpers.ts'

describe('SqliteStore (file mode)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-store-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('migrates once, persists across reopen and round-trips BLOBs byte for byte', () => {
    const bytes = fixture('l5x/baseline-safe.L5X')
    const r = inspectProjectSync({ name: 'baseline-safe.L5X', bytes }, 'current')
    if (!r.ok) throw new Error('fixture did not parse')

    const a = new SqliteStore({ memory: false, dataDir: dir })
    expect(a.mode).toBe('file')
    expect(a.schemaVersion()).toBe(MIGRATIONS.at(-1)!.version)
    const p = a.createProject({ name: 'Northgate', description: null })
    const v = a.addVersion({ projectId: p.id, fileName: 'baseline-safe.L5X', sha256: r.file.sha256, bytes, summary: r.summary })
    a.close()
    expect(existsSync(join(dir, 'interlock.db'))).toBe(true)

    const b = new SqliteStore({ memory: false, dataDir: dir })
    expect(b.schemaVersion()).toBe(MIGRATIONS.at(-1)!.version)
    expect(b.getProject(p.id)?.versionCount).toBe(1)
    const back = b.getVersionBytes(v.id)!
    expect(Buffer.compare(Buffer.from(back), Buffer.from(bytes))).toBe(0)
    expect(b.getVersion(v.id)?.summary.file.sha256).toBe(r.file.sha256)
    expect(b.listVersions(p.id, { limit: 10, offset: 0 }).total).toBe(1)
    b.close()
  })
})
