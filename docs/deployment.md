# Deployment

INTERLOCK runs in three ways. Pick the one that matches where project files are allowed to go.

| Mode | Where files go | Best for |
|---|---|---|
| Static web app (local analysis) | nowhere: the engine runs in a Web Worker in the browser | individual reviewers; sites that forbid uploading project files |
| API server (Node or container) | uploaded to the server, stored in SQLite | a team sharing projects, analyses and reports |
| CLI | read from local paths | CI gates on change requests |

All three run the same engine and produce the same result for the same inputs.

## Requirements

- Node.js 24 or later. The API, CLI and engine run TypeScript directly through Node's type stripping: there is no compile step for them.
- npm (workspaces). `npm ci` installs everything.
- For the container: Docker with BuildKit.

There is no `make` target; every task is an npm script. All commands work in PowerShell, cmd and POSIX shells.

## Local development

```bash
npm ci
npm run dev        # web app on Vite's dev server; /api is proxied to 127.0.0.1:8787
npm run dev:api    # API on http://127.0.0.1:8787, restarts on changes in apps/api/src and packages/core/src
```

The web app does not need the API: analysis runs in the browser. Start the API only to work on it.

## Production server (Node)

```bash
npm ci
npm run build      # builds apps/web/dist
npm start          # node apps/api/src/index.ts --production
```

`--production` (or `NODE_ENV=production`) serves the built web app from the same origin as the API and adds HSTS. On start the server logs one JSON line with its URL, database mode, schema version and whether a token is required. `SIGINT`/`SIGTERM` stop new connections at once and give requests in flight up to 10 seconds.

## Container

```bash
docker compose up --build          # http://127.0.0.1:8787
```

`Dockerfile` is a two-stage build on `node:24.21.0-alpine3.24` (pin it by digest in your registry mirror):

- The build stage installs all dependencies and builds the web app.
- The runtime stage installs production dependencies only, then removes npm, npx, corepack and yarn (the server never runs a package manager), applies OS package updates, copies the engine, API and CLI sources, the scenario registry and the synthetic fixtures, and the built web app.
- It runs as the unprivileged `node` user, keeps its database on the `/data` volume, listens on `0.0.0.0:8787` inside the container, and has a health check against `/api/health`.

`docker-compose.yml` publishes the port on loopback only (`127.0.0.1:8787`), runs the container read-only with a 64 MB `/tmp` tmpfs, drops all capabilities, sets `no-new-privileges`, and limits memory to 2 GB and processes to 256. It passes the `INTERLOCK_*` variables through from `.env` with the defaults listed below, and restricts accepted host names to `127.0.0.1,localhost`.

CI builds the image, runs it read-only with all capabilities dropped, waits for it to be healthy, runs `scripts/smoke.ts` against it (health, adapters, project, two uploads, manifest, analysis, findings, PDF report), checks that it serves the web app, produces an SPDX SBOM and scans the image with Trivy (CRITICAL and HIGH fail the build).

## Static site (GitHub Pages)

```bash
npm run build:pages               # Vite build with base path /interlock/
```

`.github/workflows/pages.yml` runs this on every push to `main`, copies `index.html` to `404.html` so deep links work, and deploys `apps/web/dist` to GitHub Pages. When deployed, the site is served at https://het-p301204.github.io/interlock/. It has no server component: every analysis runs in the visitor's browser and no project file leaves the machine. The built `index.html` carries a Content-Security-Policy that limits connections, scripts and fonts to the site's own origin.

Any static host works the same way: serve `apps/web/dist` (built with `npm run build` for the root path, or `npm run build:pages` for `/interlock/`) and route unknown paths to `index.html`.

## Configuration

The server reads configuration only from the environment. `.env.example` documents every variable; copy it to `.env` (never commit `.env`). Invalid values stop the server at start with a one-line error.

| Variable | Default | Range | Meaning |
|---|---|---|---|
| `PORT` | `8787` | 0 to 65535 | listen port |
| `HOST` | `127.0.0.1` | | bind address; the container image sets `0.0.0.0` |
| `NODE_ENV` | | | `production` behaves like `--production` |
| `INTERLOCK_API_TOKEN` | unset | at least 16 characters | bearer token for every `/api` route except `/api/health`; no default token exists |
| `INTERLOCK_ALLOWED_HOSTS` | `127.0.0.1,localhost,[::1]` when `HOST` is loopback, otherwise any | comma list, or `*` | accepted `Host` header names (DNS-rebinding protection) |
| `INTERLOCK_ALLOWED_ORIGINS` | none | comma list | origins allowed to call the API cross-origin |
| `INTERLOCK_TRUST_PROXY_HOPS` | `0` | 0 to 10 | trusted proxies appending to `X-Forwarded-For` (used for rate limiting) |
| `INTERLOCK_DATA_DIR` | `.data` | | database directory (`interlock.db`); relative paths resolve from the repository root; the image uses `/data` |
| `INTERLOCK_DB` | file | `memory` | `memory` keeps everything in memory (tests, CI, throwaway demos) |
| `INTERLOCK_MAX_UPLOAD_MB` | `64` | 1 to 1024 | largest accepted upload, enforced while the body streams in; the CLI uses it as its input size limit |
| `INTERLOCK_ANALYSIS_TIMEOUT_MS` | `60000` | 1 to 3,600,000 | wall-clock limit per engine job; exceeded jobs are stopped and answered with 504 |
| `INTERLOCK_WORKER_MAX_MEMORY_MB` | `512` | 64 to 16,384 | heap limit of each engine worker thread |
| `INTERLOCK_MAX_CONCURRENT_ANALYSES` | `2` | 1 to 64 | engine jobs at once; more are refused with 503 `ANALYSIS_BUSY` |
| `INTERLOCK_RATE_LIMIT_PER_MINUTE` | `60` | 1 to 100,000 | uploads, analyses and drift requests per client address per minute; other API calls get 20 times this |
| `INTERLOCK_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` | JSON-line logs; never bodies, file contents or tokens |
| `INTERLOCK_WEB_DIST` | `apps/web/dist` | | built web app served in production |
| `INTERLOCK_SMOKE_TOKEN`, `INTERLOCK_SMOKE_API_ONLY` | | | used by `scripts/smoke.ts` only |

Generate a token with:

```bash
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```

## Exposing the server

The defaults are safe for one person on one machine. Before anyone else can reach the server:

1. Set `INTERLOCK_API_TOKEN`.
2. Put a TLS-terminating reverse proxy in front; the server speaks plain HTTP.
3. Set `INTERLOCK_ALLOWED_HOSTS` to the public host name and `INTERLOCK_TRUST_PROXY_HOPS` to the number of proxies.
4. Protect the data volume: uploaded project files are stored unencrypted in SQLite, and reports describe how the plant's protection works.
5. Run one instance per trust domain. There are no user accounts and no tenant separation: everyone with the token sees everything.

See [threat-model.md](threat-model.md#unsafe-deployment-assumptions).

## Health and smoke test

`GET /api/health` needs no token and returns `200` with versions, database state and limits, or `503` when the database does not answer. `scripts/smoke.ts` exercises a running deployment end to end with the synthetic fixtures only:

```bash
node scripts/smoke.ts http://127.0.0.1:8787
INTERLOCK_SMOKE_TOKEN=... node scripts/smoke.ts https://interlock.example.com
```
