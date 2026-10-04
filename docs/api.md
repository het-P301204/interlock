# REST API

`apps/api` is a Hono server that stores project versions, safety manifests and analyses in SQLite (Node's built-in `node:sqlite`) and runs the same engine as the web app and the CLI. Every engine call (parsing an upload, an analysis, a drift comparison) runs in its own worker thread with a heap cap and a wall-clock timeout. The machine-readable contract is served at `GET /api/openapi.json` (OpenAPI 3.1).

```bash
npm run dev:api                       # API only, restarts on source changes
npm start                             # --production: also serves the built web app
```

The server listens on `http://127.0.0.1:8787` by default. Configuration is environment-only; see [deployment.md](deployment.md#configuration).

## Conventions

- **Base path** `/api`. JSON in and out unless stated otherwise.
- **Ids** are prefixed and opaque: `prj_<32 hex>`, `ver_<32 hex>`, `ana_<32 hex>`. Finding ids (`IL-0001`) are scoped to their analysis.
- **Errors** always use one envelope:

  ```json
  { "error": { "code": "ANALYSIS_NOT_FOUND", "message": "No analysis with that id." } }
  ```

  `details` is added when there is more to say (validation issues, the side and location of a parse error, a limit). Stack traces are never returned; a 500 carries a `requestId` that matches the server log line.
- **Request ids.** Every response has `X-Request-Id`. A client may send its own (`[A-Za-z0-9-]{8,64}`).
- **Pagination.** List endpoints accept `limit` (1 to 500, default 100) and `offset` and return `{ total, <items> }`.
- **Authentication.** When `INTERLOCK_API_TOKEN` is set, every `/api` route except `GET /api/health` requires `Authorization: Bearer <token>`; otherwise `401 UNAUTHORIZED` with `WWW-Authenticate: Bearer realm="interlock"`. The comparison is constant-time.
- **Rate limits** (fixed one-minute window, per client address, per server instance): upload, analysis and drift requests share `INTERLOCK_RATE_LIMIT_PER_MINUTE` (default 60); all other API requests get 20 times that. Responses carry `RateLimit-Limit` and `RateLimit-Remaining`; a refusal is `429 RATE_LIMITED` with `Retry-After`.
- **Body limits** are enforced while the body streams in: uploads `INTERLOCK_MAX_UPLOAD_MB` (default 64 MB), JSON bodies 4 MiB. Over the limit: `413 PAYLOAD_TOO_LARGE`.
- **Caching.** API responses are `Cache-Control: no-store`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness, versions, database state, limits (never requires a token) |
| GET | `/api/openapi.json` | OpenAPI 3.1 document |
| GET | `/api/adapters` | format adapters and their status, accepted upload extensions |
| GET | `/api/rules` | the 20 analysis rules (`id`, `title`, `description`, `severity`) |
| GET | `/api/scenarios` | the built-in synthetic scenario registry (`fixtures/scenarios.json`) |
| POST | `/api/projects` | create a project |
| GET | `/api/projects` | list projects |
| GET | `/api/projects/:id` | one project |
| POST | `/api/projects/:id/versions` | upload and parse a project version |
| GET | `/api/projects/:id/versions` | list a project's versions |
| GET | `/api/versions/:id` | one version (summary, hash, diagnostics) |
| GET | `/api/projects/:id/safety-manifest` | the project's safety manifest |
| PUT | `/api/projects/:id/safety-manifest` | replace the manifest |
| POST | `/api/safety-functions` | add or replace one safety function in a project's manifest |
| POST | `/api/analyses` | compare two versions |
| GET | `/api/analyses` | list analyses |
| GET | `/api/analyses/:id` | analysis record and full `AnalysisResult` |
| GET | `/api/analyses/:id/findings` | findings, filterable |
| GET | `/api/analyses/:id/findings/:findingId` | one finding with its evidence ledger |
| GET | `/api/analyses/:id/changes` | structural changes, filterable by category |
| GET | `/api/analyses/:id/graph` | reuse graph (nodes and edges) |
| GET | `/api/analyses/:id/safety-map` | per-function results and module blast radii |
| GET | `/api/analyses/:id/report?format=json\|csv\|md\|pdf` | downloadable report |
| POST | `/api/drift` | cross-project module drift (experimental) |

### Health

```
GET /api/health
200 {"status":"ok","service":"interlock-api","version":"0.1.0","engineVersion":"1.0.0","analysisMode":"SERVER",
     "db":{"engine":"sqlite","mode":"memory","ok":true,"schemaVersion":1},"uptimeSeconds":0,"authRequired":false,
     "limits":{"maxUploadBytes":67108864,"analysisTimeoutMs":60000,"workerMaxMemoryMb":512}}
```

`503` with `"status":"degraded"` when the database does not answer.

### Projects

```
POST /api/projects            {"name": "Northgate", "description": "optional"}
201 {"id":"prj_…","name":"Northgate","description":null,"createdAt":"…","updatedAt":"…","versionCount":0,"hasManifest":false}
```

`name` is 1 to 200 characters, `description` at most 2,000; both have invisible characters stripped. Unknown keys are rejected (`400 VALIDATION_FAILED`).

### Uploading a version

Two encodings:

```bash
# raw bytes, file name in the query string
curl -X POST "http://127.0.0.1:8787/api/projects/$PRJ/versions?name=baseline-safe.L5X" \
     -H "content-type: application/octet-stream" --data-binary @fixtures/l5x/baseline-safe.L5X

# multipart, field "file"
curl -X POST "http://127.0.0.1:8787/api/projects/$PRJ/versions" -F "file=@fixtures/l5x/baseline-safe.L5X"
```

The file name is metadata only: its last path segment is kept, invisible characters are stripped, it must be 1 to 200 characters and end in an accepted extension (`.l5x`, `.xml`, `.xef`), and it is never used as a filesystem path. The file is parsed in a worker before anything is stored; a file that cannot be trusted is not stored and the response says why:

```
422 {"error":{"code":"XML_DOCTYPE_FORBIDDEN","message":"The document contains a <!DOCTYPE> declaration. …",
              "details":{"side":"current","location":"(document)","line":2,"column":1}}}
```

On success, `201` returns the version record: `id`, `projectId`, `fileName`, `sizeBytes`, `sha256`, `createdAt` and the `summary` (`ProjectVersionSummary`: parser, metadata, counts, diagnostics, readiness). For `baseline-safe.L5X` the counts are 2 tasks, 7 programs, 20 routines, 43 rungs, 1 module, 5 instances, 64 tags, readiness `READY`.

Upload-specific errors: `400 FILE_NAME_REQUIRED`, `400 INVALID_FILE_NAME`, `415 UNSUPPORTED_FILE_TYPE`, `415 UNSUPPORTED_MEDIA_TYPE`, `400 FILE_REQUIRED`, `400 INVALID_MULTIPART`, `400 EMPTY_FILE`, `413 PAYLOAD_TOO_LARGE`, `422 <engine code>` (for example `FORMAT_NOT_SUPPORTED`, `ENCODING_INVALID`, `L5X_WRONG_ROOT`).

### Safety manifest

`PUT /api/projects/:id/safety-manifest` takes an `interlock.safety/v1` document ([safety-declarations.md](safety-declarations.md)) and returns the validated manifest. An invalid manifest is `400 MANIFEST_INVALID` with `details.issues`. `GET` returns it, or `404 MANIFEST_NOT_SET`.

`POST /api/safety-functions` with `{"projectId": "prj_…", "function": { … }}` adds a function, or replaces the one with the same id (case-insensitive). The whole resulting manifest is validated before it is stored. `201` when added, `200` when replaced; the body is `{ "replaced": boolean, "manifest": … }`.

### Analyses

```
POST /api/analyses   {"baselineVersionId":"ver_…","currentVersionId":"ver_…","manifest":{…optional…}}
```

Without `manifest`, the current version's project manifest is used (`400 MANIFEST_REQUIRED` if there is none). The server supplies `analyzedAt` from its clock. `201` returns the analysis record (`id`, `resultId` (the engine's content-derived id), `projectId`, both version ids, `status`, `createdAt`, `durationMs`, `trustStatus`, `priority`, `findingCount`) plus `trust`, `surface` and `coverage`. Scenario 02 through the API:

```
201 {"id":"ana_…","resultId":"ec75374e87d0","status":"COMPLETE","durationMs":225,"trustStatus":"VERIFIED_SCOPE",
     "priority":"CRITICAL","findingCount":2,"trust":{"status":"VERIFIED_SCOPE",…},…}
```

`GET /api/analyses/:id` returns the record with the full `AnalysisResult` under `result` (schema `interlock.analysis/v1`, defined in `packages/core/src/model/analysis.ts`).

Engine failures map to: `422 <code>` when an input cannot be trusted (with `details.side` = `baseline`, `current` or `manifest`), `504 ANALYSIS_TIMEOUT`, `503 ANALYSIS_MEMORY_LIMIT`, `503 ANALYSIS_BUSY` (more than `INTERLOCK_MAX_CONCURRENT_ANALYSES` engine jobs running; jobs are refused, not queued; an upload is refused before its body is read when that many uploads are already in progress, with `Retry-After`), `503 SHUTTING_DOWN`, `500 ENGINE_FAILED`.

### Findings and changes

```
GET /api/analyses/:id/findings?severity=critical,high&type=NEW_INHIBIT&safetyFunction=SF-06&disposition=REVIEW
200 {"total":1,"findings":[{"id":"IL-0001","type":"NEW_INHIBIT","severity":"CRITICAL",…}]}
```

Every filter takes a comma-separated list. `severity` and `disposition` are case-insensitive; `safetyFunction` matches case-insensitively. `GET …/findings/:findingId` returns one `Finding` with its `firing` comparison and `evidence` ledger, or `404 FINDING_NOT_FOUND`.

`GET /api/analyses/:id/changes?category=logic` filters by `logic`, `execution`, `interface`, `configuration`, `data`, `documentation` or `metadata`.

### Graph and safety map

`GET …/graph` returns `{ nodes, edges }` (`ReuseGraph`). `GET …/safety-map` returns `{ safetyFunctions, modules }`: each declared function's status, resolution, protective and notification comparisons and dependency cone, and each module's blast radius.

### Reports

`GET /api/analyses/:id/report?format=json|csv|md|pdf` (default `json`) answers with `Content-Disposition: attachment; filename="interlock-<current file>-<result id>.<ext>"`, for example `interlock-current-shutdown-weakened-ec75374e87d0.csv`. The file name is reduced to `[A-Za-z0-9._-]`. Report content is described in the README; CSV cells are protected against formula injection.

### Drift

```
POST /api/drift   {"sites":[{"label":"Site A","versionId":"ver_…"},{"label":"Site B","versionId":"ver_…"}],"manifest":{…optional…}}
```

2 to 20 sites; labels are 1 to 64 characters and unique (case-insensitive, `400 DUPLICATE_LABEL`). Returns a `DriftReport` (`schema: "interlock.drift/v1"`). Without a manifest, differences are reported without a direction. See [analysis-methodology.md](analysis-methodology.md#13-cross-project-drift-experimental).

## Cross-cutting protections

| Protection | Behaviour |
|---|---|
| Host check | `421 HOST_NOT_ALLOWED` unless the `Host` is in `INTERLOCK_ALLOWED_HOSTS` (loopback names by default when bound to loopback): DNS-rebinding protection |
| Origin check | a non-GET request from another origin not listed in `INTERLOCK_ALLOWED_ORIGINS` is `403 ORIGIN_REJECTED`; listed origins get CORS headers |
| Security headers | CSP (`default-src 'self'`, no inline script, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`, a restrictive `Permissions-Policy`; HSTS in production |
| Logging | JSON lines with the route pattern, status and duration; never request bodies, file contents, query strings or tokens |
| Static files (production) | paths are decoded, resolved and checked to stay inside the web build directory (symlinks included) before anything is read |

See [threat-model.md](threat-model.md) for the reasoning and the residual risk.
