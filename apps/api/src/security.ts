import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import type { Config, LogLevel } from './config.ts'

export type Env = { Variables: { requestId: string; started: number } }

/** A failure with a status and a stable machine code, rendered as the error envelope. */
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export type Log = (level: Exclude<LogLevel, 'silent'>, fields: Record<string, unknown>) => void

/** Structured JSON logs. Callers pass fields, never request bodies, headers or tokens. */
export function logger(level: LogLevel): Log {
  const rank = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const
  return (lvl, fields) => {
    if (rank[lvl] < rank[level]) return
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, service: 'interlock-api', ...fields })
    if (lvl === 'error' || lvl === 'warn') console.error(line)
    else console.log(line)
  }
}

export function requestContext(log: Log): MiddlewareHandler<Env> {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id')
    const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID()
    c.set('requestId', requestId)
    c.set('started', performance.now())
    await next()
    c.header('X-Request-Id', requestId)
    log(c.res.status >= 500 ? 'error' : 'info', {
      requestId,
      method: c.req.method,
      // The matched route pattern, not the raw path: ids and query strings stay out of the logs.
      route: c.req.routePath,
      status: c.res.status,
      durationMs: Math.round(performance.now() - c.get('started')),
    })
  }
}

/**
 * Security headers for every response. The CSP allows the web app's analysis
 * Web Worker (worker-src 'self' blob:) and inline styles set by the motion
 * library, nothing else: no inline scripts, no third-party origins.
 */
export function secureHeaders(config: Config): MiddlewareHandler<Env> {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  return async (c, next) => {
    await next()
    c.header('Content-Security-Policy', csp)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Cross-Origin-Opener-Policy', 'same-origin')
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()')
    c.header('X-Permitted-Cross-Domain-Policies', 'none')
    if (config.production) c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store')
  }
}

/**
 * DNS-rebinding protection: when the server is bound to loopback, a page on
 * another site that resolves its own name to 127.0.0.1 must not reach the API.
 * Only the configured Host names are accepted.
 */
export function hostCheck(config: Config): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (config.allowedHosts.length) {
      // The request URL is built from the Host header by the Node adapter.
      const host = new URL(c.req.url).hostname.toLowerCase()
      if (!config.allowedHosts.includes(host)) throw new HttpError(421, 'HOST_NOT_ALLOWED', 'This server does not answer for that host name.')
    }
    await next()
  }
}

/**
 * CORS is off by default (the web app is served from the same origin). Origins
 * listed in INTERLOCK_ALLOWED_ORIGINS get CORS headers; any other cross-origin
 * request that would change data is rejected outright, so a page on another
 * site cannot use a simple (unpreflighted) form POST to upload files.
 */
export function cors(config: Config): MiddlewareHandler<Env> {
  return async (c, next) => {
    const origin = c.req.header('origin')
    const self = new URL(c.req.url).origin
    const allowed = !!origin && config.allowedOrigins.includes(origin)
    if (c.req.method === 'OPTIONS') {
      if (!allowed) return c.body(null, 204)
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT')
      c.header('Access-Control-Allow-Headers', 'authorization, content-type, x-request-id')
      c.header('Access-Control-Max-Age', '600')
      c.header('Vary', 'Origin')
      return c.body(null, 204)
    }
    if (origin && origin !== self && !allowed && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      throw new HttpError(403, 'ORIGIN_REJECTED', 'Cross-origin request rejected.')
    }
    await next()
    if (allowed) {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Access-Control-Expose-Headers', 'content-disposition, x-request-id, retry-after')
      c.header('Vary', 'Origin')
    }
  }
}

/**
 * Request body limit that counts bytes as the handler reads them. Unlike
 * hono/body-limit, which drains a body without Content-Length (chunked) into
 * memory before calling the next handler, nothing is read here: a request the
 * handler rejects (no token, busy, bad name) never has its body buffered, and
 * one that is read stops at the first chunk past the limit. The stream errors
 * with the error `tooLarge()` returns, which the handler's read rethrows.
 */
export function streamingBodyLimit(maxSize: number, tooLarge: () => Error): MiddlewareHandler<Env> {
  return async (c, next) => {
    const raw = c.req.raw
    if (!raw.body) return next()
    const declared = raw.headers.get('content-length')
    if (declared !== null && !raw.headers.has('transfer-encoding') && Number.parseInt(declared, 10) > maxSize) throw tooLarge()
    const reader = raw.body.getReader()
    let size = 0
    const limited = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        const { done, value } = await reader.read()
        if (done) return ctrl.close()
        size += value.byteLength
        if (size > maxSize) {
          void reader.cancel().catch(() => {})
          ctrl.error(tooLarge())
          return
        }
        ctrl.enqueue(value)
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })
    c.req.raw = new Request(raw, { body: limited, duplex: 'half' } as RequestInit)
    await next()
  }
}

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest()
}

/** Constant-time token comparison (hashing first makes the lengths equal). */
export function tokenMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected))
}

/** Optional bearer token. When INTERLOCK_API_TOKEN is set, every /api route except /api/health requires it. */
export function bearerAuth(config: Config): MiddlewareHandler<Env> {
  const expected = config.apiToken
  return async (c, next) => {
    if (!expected || c.req.path === '/api/health' || c.req.method === 'OPTIONS') return next()
    const auth = c.req.header('authorization') ?? ''
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth)
    if (!m || !tokenMatches(m[1]!, expected)) {
      c.header('WWW-Authenticate', 'Bearer realm="interlock"')
      throw new HttpError(401, 'UNAUTHORIZED', 'A valid bearer token is required.')
    }
    await next()
  }
}

/** Fixed-window in-memory rate limit per client address (per API instance). */
export function rateLimit(bucket: string, limit: number, windowMs: number, trustProxyHops: number): MiddlewareHandler<Env> {
  const hits = new Map<string, { count: number; reset: number }>()
  let nextSweep = Date.now() + windowMs
  return async (c, next) => {
    const now = Date.now()
    if (now >= nextSweep) {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
      nextSweep = now + windowMs
    }
    const key = `${bucket}:${clientAddress(c, trustProxyHops)}`
    let h = hits.get(key)
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + windowMs }
      hits.set(key, h)
    }
    h.count++
    c.header('RateLimit-Limit', String(limit))
    c.header('RateLimit-Remaining', String(Math.max(0, limit - h.count)))
    if (h.count > limit) {
      c.header('Retry-After', String(Math.ceil((h.reset - now) / 1000)))
      throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.')
    }
    await next()
  }
}

/**
 * Client address for rate limiting. Behind N trusted proxies the client is the
 * Nth X-Forwarded-For entry from the right; entries to its left are forgeable.
 */
export function clientAddress(c: Context<Env>, trustProxyHops: number): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  let addr = env?.incoming?.socket?.remoteAddress ?? 'local'
  if (trustProxyHops > 0) {
    const chain = (c.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const picked = chain[chain.length - trustProxyHops]
    if (picked) addr = picked
  }
  return addr.replace(/^::ffff:/, '')
}
