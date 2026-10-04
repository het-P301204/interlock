/**
 * INTERLOCK API server.
 *   node apps/api/src/index.ts                API only (the web app runs on Vite in development)
 *   node apps/api/src/index.ts --production   also serves the built web app from apps/web/dist
 */
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { ConfigError, loadConfig } from './config.ts'
import { logger } from './security.ts'
import { openStore } from './store.ts'

const startedAt = Date.now()
let config
try {
  config = loadConfig()
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', service: 'interlock-api', operation: 'config', error: e.message }))
    process.exit(1)
  }
  throw e
}
const log = logger(config.logLevel)
const store = openStore({ memory: config.memoryDb, dataDir: config.dataDir })
const { app, engine } = createApp({ store, config, log, startedAt })

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  log('info', {
    operation: 'listen',
    url: `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${info.port}`,
    production: config.production,
    db: store.mode,
    schemaVersion: store.schemaVersion(),
    authRequired: config.apiToken !== null,
    webDist: config.production ? config.webDist : null,
  })
})

let stopping = false
const shutdown = (signal: string) => {
  if (stopping) return
  stopping = true
  log('info', { operation: 'shutdown', signal })
  // New connections are refused at once; requests in flight (including running
  // analyses) get up to 10 s to finish before a hard stop.
  const force = setTimeout(() => process.exit(1), 10_000)
  force.unref()
  server.close(() => {
    void engine.close().finally(() => {
      store.close()
      process.exit(0)
    })
  })
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
