/**
 * Persistence. The app talks to the `Store` interface only, so the SQLite
 * implementation (Node's built-in node:sqlite, no native dependency) could be
 * replaced by PostgreSQL without touching a route.
 *
 * Uploaded project files are stored as BLOBs next to their SHA-256. Nothing a
 * client sends is ever used to build a filesystem path: the only file this
 * module opens is the database itself, at a path chosen by the operator.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AnalysisResult, ProjectVersionSummary, SafetyManifest } from '@interlock/core'

export interface ProjectRecord {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
  versionCount: number
  hasManifest: boolean
}

export interface VersionRecord {
  id: string
  projectId: string
  fileName: string
  sizeBytes: number
  sha256: string
  createdAt: string
  summary: ProjectVersionSummary
}

export interface AnalysisRecord {
  id: string
  /** Engine-computed content id: same inputs, same value. */
  resultId: string
  projectId: string | null
  baselineVersionId: string
  currentVersionId: string
  status: 'COMPLETE'
  createdAt: string
  durationMs: number
  trustStatus: string
  priority: string
  findingCount: number
}

export interface NewAnalysis {
  projectId: string | null
  baselineVersionId: string
  currentVersionId: string
  durationMs: number
  result: AnalysisResult
  /** The serialized result, when the caller already has it (avoids a second stringify). */
  resultJson?: string
}

export interface Page {
  limit: number
  offset: number
}

export interface Store {
  readonly engine: 'sqlite'
  readonly mode: 'memory' | 'file'
  ping(): boolean
  schemaVersion(): number
  createProject(input: { name: string; description: string | null }): ProjectRecord
  listProjects(page: Page): { rows: ProjectRecord[]; total: number }
  getProject(id: string): ProjectRecord | null
  getManifest(projectId: string): SafetyManifest | null
  setManifest(projectId: string, manifest: SafetyManifest): void
  addVersion(input: { projectId: string; fileName: string; sha256: string; bytes: Uint8Array; summary: ProjectVersionSummary }): VersionRecord
  listVersions(projectId: string, page: Page): { rows: VersionRecord[]; total: number }
  getVersion(id: string): VersionRecord | null
  getVersionBytes(id: string): Uint8Array | null
  addAnalysis(input: NewAnalysis): AnalysisRecord
  listAnalyses(page: Page): { rows: AnalysisRecord[]; total: number }
  getAnalysis(id: string): AnalysisRecord | null
  getAnalysisResult(id: string): AnalysisResult | null
  close(): void
}

/** Migrations run in order, each once, recorded in schema_version. Append only. */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE projects (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        description   TEXT,
        manifest_json TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE TABLE versions (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_name    TEXT NOT NULL,
        size_bytes   INTEGER NOT NULL,
        sha256       TEXT NOT NULL,
        content      BLOB NOT NULL,
        summary_json TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX versions_project ON versions(project_id, created_at);
      CREATE TABLE analyses (
        id                  TEXT PRIMARY KEY,
        result_id           TEXT NOT NULL,
        project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,
        baseline_version_id TEXT NOT NULL REFERENCES versions(id),
        current_version_id  TEXT NOT NULL REFERENCES versions(id),
        status              TEXT NOT NULL,
        trust_status        TEXT NOT NULL,
        priority            TEXT NOT NULL,
        finding_count       INTEGER NOT NULL,
        duration_ms         INTEGER NOT NULL,
        result_json         TEXT NOT NULL,
        created_at          TEXT NOT NULL
      );
      CREATE INDEX analyses_created ON analyses(created_at);
    `,
  },
]

export function newId(prefix: 'prj' | 'ver' | 'ana'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`
}

type Row = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''))
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : Number(v ?? 0))

export class SqliteStore implements Store {
  readonly engine = 'sqlite' as const
  readonly mode: 'memory' | 'file'
  private readonly db: DatabaseSync

  constructor(opts: { memory: true } | { memory: false; dataDir: string }) {
    if (opts.memory) {
      this.mode = 'memory'
      this.db = new DatabaseSync(':memory:')
    } else {
      this.mode = 'file'
      mkdirSync(opts.dataDir, { recursive: true })
      this.db = new DatabaseSync(join(opts.dataDir, 'interlock.db'))
      this.db.exec('PRAGMA journal_mode = WAL')
    }
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    const current = this.schemaVersion()
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue
      this.db.exec('BEGIN')
      try {
        this.db.exec(m.sql)
        this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString())
        this.db.exec('COMMIT')
      } catch (e) {
        this.db.exec('ROLLBACK')
        throw e
      }
    }
  }

  schemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as Row | undefined
    return row?.['v'] === null || row?.['v'] === undefined ? 0 : num(row['v'])
  }

  ping(): boolean {
    try {
      this.db.prepare('SELECT 1').get()
      return true
    } catch {
      return false
    }
  }

  private projectFrom(r: Row): ProjectRecord {
    return {
      id: str(r['id']),
      name: str(r['name']),
      description: r['description'] === null ? null : str(r['description']),
      createdAt: str(r['created_at']),
      updatedAt: str(r['updated_at']),
      versionCount: num(r['version_count']),
      hasManifest: num(r['has_manifest']) === 1,
    }
  }

  private static readonly PROJECT_SELECT =
    'SELECT p.id, p.name, p.description, p.created_at, p.updated_at, p.manifest_json IS NOT NULL AS has_manifest, (SELECT COUNT(*) FROM versions v WHERE v.project_id = p.id) AS version_count FROM projects p'

  createProject(input: { name: string; description: string | null }): ProjectRecord {
    const id = newId('prj')
    const now = new Date().toISOString()
    this.db.prepare('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, input.name, input.description, now, now)
    return this.getProject(id)!
  }

  listProjects(page: Page): { rows: ProjectRecord[]; total: number } {
    const rows = this.db.prepare(`${SqliteStore.PROJECT_SELECT} ORDER BY p.created_at DESC, p.id LIMIT ? OFFSET ?`).all(page.limit, page.offset) as Row[]
    const total = num((this.db.prepare('SELECT COUNT(*) AS n FROM projects').get() as Row)['n'])
    return { rows: rows.map((r) => this.projectFrom(r)), total }
  }

  getProject(id: string): ProjectRecord | null {
    const r = this.db.prepare(`${SqliteStore.PROJECT_SELECT} WHERE p.id = ?`).get(id) as Row | undefined
    return r ? this.projectFrom(r) : null
  }

  getManifest(projectId: string): SafetyManifest | null {
    const r = this.db.prepare('SELECT manifest_json FROM projects WHERE id = ?').get(projectId) as Row | undefined
    const json = r?.['manifest_json']
    return typeof json === 'string' ? (JSON.parse(json) as SafetyManifest) : null
  }

  setManifest(projectId: string, manifest: SafetyManifest): void {
    this.db.prepare('UPDATE projects SET manifest_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(manifest), new Date().toISOString(), projectId)
  }

  private versionFrom(r: Row): VersionRecord {
    return {
      id: str(r['id']),
      projectId: str(r['project_id']),
      fileName: str(r['file_name']),
      sizeBytes: num(r['size_bytes']),
      sha256: str(r['sha256']),
      createdAt: str(r['created_at']),
      summary: JSON.parse(str(r['summary_json'])) as ProjectVersionSummary,
    }
  }

  addVersion(input: { projectId: string; fileName: string; sha256: string; bytes: Uint8Array; summary: ProjectVersionSummary }): VersionRecord {
    const id = newId('ver')
    const now = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare('INSERT INTO versions (id, project_id, file_name, size_bytes, sha256, content, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, input.projectId, input.fileName, input.bytes.length, input.sha256, input.bytes, JSON.stringify(input.summary), now)
      this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, input.projectId)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return this.getVersion(id)!
  }

  listVersions(projectId: string, page: Page): { rows: VersionRecord[]; total: number } {
    const rows = this.db
      .prepare('SELECT id, project_id, file_name, size_bytes, sha256, summary_json, created_at FROM versions WHERE project_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?')
      .all(projectId, page.limit, page.offset) as Row[]
    const total = num((this.db.prepare('SELECT COUNT(*) AS n FROM versions WHERE project_id = ?').get(projectId) as Row)['n'])
    return { rows: rows.map((r) => this.versionFrom(r)), total }
  }

  getVersion(id: string): VersionRecord | null {
    const r = this.db.prepare('SELECT id, project_id, file_name, size_bytes, sha256, summary_json, created_at FROM versions WHERE id = ?').get(id) as Row | undefined
    return r ? this.versionFrom(r) : null
  }

  getVersionBytes(id: string): Uint8Array | null {
    const r = this.db.prepare('SELECT content FROM versions WHERE id = ?').get(id) as Row | undefined
    const c = r?.['content']
    return c instanceof Uint8Array ? c : null
  }

  private analysisFrom(r: Row): AnalysisRecord {
    return {
      id: str(r['id']),
      resultId: str(r['result_id']),
      projectId: r['project_id'] === null ? null : str(r['project_id']),
      baselineVersionId: str(r['baseline_version_id']),
      currentVersionId: str(r['current_version_id']),
      status: 'COMPLETE',
      createdAt: str(r['created_at']),
      durationMs: num(r['duration_ms']),
      trustStatus: str(r['trust_status']),
      priority: str(r['priority']),
      findingCount: num(r['finding_count']),
    }
  }

  private static readonly ANALYSIS_COLUMNS =
    'id, result_id, project_id, baseline_version_id, current_version_id, status, trust_status, priority, finding_count, duration_ms, created_at'

  addAnalysis(input: NewAnalysis): AnalysisRecord {
    const id = newId('ana')
    const r = input.result
    this.db
      .prepare(
        `INSERT INTO analyses (id, result_id, project_id, baseline_version_id, current_version_id, status, trust_status, priority, finding_count, duration_ms, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'COMPLETE', ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, r.id, input.projectId, input.baselineVersionId, input.currentVersionId, r.trust.status, r.surface.priority, r.findings.length, Math.round(input.durationMs), input.resultJson ?? JSON.stringify(r), new Date().toISOString())
    return this.getAnalysis(id)!
  }

  listAnalyses(page: Page): { rows: AnalysisRecord[]; total: number } {
    const rows = this.db.prepare(`SELECT ${SqliteStore.ANALYSIS_COLUMNS} FROM analyses ORDER BY created_at DESC, id LIMIT ? OFFSET ?`).all(page.limit, page.offset) as Row[]
    const total = num((this.db.prepare('SELECT COUNT(*) AS n FROM analyses').get() as Row)['n'])
    return { rows: rows.map((r) => this.analysisFrom(r)), total }
  }

  getAnalysis(id: string): AnalysisRecord | null {
    const r = this.db.prepare(`SELECT ${SqliteStore.ANALYSIS_COLUMNS} FROM analyses WHERE id = ?`).get(id) as Row | undefined
    return r ? this.analysisFrom(r) : null
  }

  getAnalysisResult(id: string): AnalysisResult | null {
    const r = this.db.prepare('SELECT result_json FROM analyses WHERE id = ?').get(id) as Row | undefined
    const json = r?.['result_json']
    return typeof json === 'string' ? (JSON.parse(json) as AnalysisResult) : null
  }

  close(): void {
    if (this.db.isOpen) this.db.close()
  }
}

export function openStore(opts: { memory: boolean; dataDir: string }): Store {
  return opts.memory ? new SqliteStore({ memory: true }) : new SqliteStore({ memory: false, dataDir: opts.dataDir })
}
