import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, so every entry point (npm start, dev:api, tests) shares one layout. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const API_VERSION = '0.1.0'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

/**
 * Configuration comes only from the environment (documented in .env.example).
 * INTERLOCK holds no secrets of its own: the only credential is the optional
 * INTERLOCK_API_TOKEN, which is never logged and never defaulted.
 */
export interface Config {
  production: boolean
  port: number
  host: string
  /** In-memory database (tests, CI, ephemeral demos). */
  memoryDb: boolean
  dataDir: string
  maxUploadBytes: number
  /** Limit for JSON request bodies (a manifest may be up to 2 MB). */
  maxJsonBytes: number
  analysisTimeoutMs: number
  workerMaxMemoryMb: number
  maxConcurrentAnalyses: number
  /** Uploads + analyses + drift requests per client address per minute. */
  rateLimitPerMinute: number
  apiToken: string | null
  allowedOrigins: string[]
  /**
   * Host header values accepted (DNS-rebinding protection). Empty means any
   * host; by default only loopback names are accepted when bound to loopback.
   */
  allowedHosts: string[]
  trustProxyHops: number
  logLevel: LogLevel
  webDist: string
  scenariosFile: string
}

export class ConfigError extends Error {}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${key} must be an integer between ${min} and ${max}.`)
  return n
}

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host.toLowerCase())
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): Config {
  const production = argv.includes('--production') || env['NODE_ENV'] === 'production'
  const host = env['HOST']?.trim() || '127.0.0.1'
  const port = int(env, 'PORT', 8787, 0, 65535)
  const token = env['INTERLOCK_API_TOKEN']?.trim() || null
  // Fail closed: a short token is a guessable token.
  if (token !== null && token.length < 16) throw new ConfigError('INTERLOCK_API_TOKEN must be at least 16 characters (use a long random value).')
  const logLevel = (env['INTERLOCK_LOG_LEVEL'] ?? 'info') as LogLevel
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel)) throw new ConfigError('INTERLOCK_LOG_LEVEL must be debug, info, warn, error or silent.')
  const hostsEnv = env['INTERLOCK_ALLOWED_HOSTS']
  const allowedHosts =
    hostsEnv !== undefined ? (hostsEnv.trim() === '*' ? [] : list(hostsEnv).map((h) => h.toLowerCase())) : isLoopback(host) ? ['127.0.0.1', 'localhost', '[::1]'] : []
  return {
    production,
    port,
    host,
    memoryDb: env['INTERLOCK_DB'] === 'memory',
    dataDir: resolve(REPO_ROOT, env['INTERLOCK_DATA_DIR'] ?? '.data'),
    maxUploadBytes: int(env, 'INTERLOCK_MAX_UPLOAD_MB', 64, 1, 1024) * 1024 * 1024,
    maxJsonBytes: 4 * 1024 * 1024,
    analysisTimeoutMs: int(env, 'INTERLOCK_ANALYSIS_TIMEOUT_MS', 60_000, 1, 3_600_000),
    workerMaxMemoryMb: int(env, 'INTERLOCK_WORKER_MAX_MEMORY_MB', 512, 64, 16_384),
    maxConcurrentAnalyses: int(env, 'INTERLOCK_MAX_CONCURRENT_ANALYSES', 2, 1, 64),
    rateLimitPerMinute: int(env, 'INTERLOCK_RATE_LIMIT_PER_MINUTE', 60, 1, 100_000),
    apiToken: token,
    allowedOrigins: list(env['INTERLOCK_ALLOWED_ORIGINS']),
    allowedHosts,
    trustProxyHops: int(env, 'INTERLOCK_TRUST_PROXY_HOPS', 0, 0, 10),
    logLevel,
    webDist: resolve(REPO_ROOT, env['INTERLOCK_WEB_DIST'] ?? 'apps/web/dist'),
    scenariosFile: resolve(REPO_ROOT, 'fixtures', 'scenarios.json'),
  }
}

/** Defaults for tests: in-memory, silent, generous limits. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({ INTERLOCK_DB: 'memory', INTERLOCK_LOG_LEVEL: 'silent' }, []), allowedHosts: [], ...overrides }
}
