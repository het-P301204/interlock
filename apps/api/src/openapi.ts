/**
 * Hand-written OpenAPI 3.1 description of every /api route. A test checks
 * that each route registered in the app appears here, so the two cannot drift.
 */
import { API_VERSION } from './config.ts'

type Schema = Record<string, unknown>

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` })
const json = (schema: Schema, description: string) => ({ description, content: { 'application/json': { schema } } })
const err = (description: string) => json(ref('Error'), description)
const idParam = (name: string, description: string, pattern?: string) => ({ name, in: 'path', required: true, description, schema: pattern ? { type: 'string', pattern } : { type: 'string' } })
const query = (name: string, description: string, schema: Schema = { type: 'string' }) => ({ name, in: 'query', required: false, description, schema })
const paging = [query('limit', 'Page size (1-500, default 100).', { type: 'integer', minimum: 1, maximum: 500 }), query('offset', 'Rows to skip.', { type: 'integer', minimum: 0 })]
const looseObject = (description: string): Schema => ({ type: 'object', description, additionalProperties: true })

const PRJ = '^prj_[0-9a-f]{32}$'
const VER = '^ver_[0-9a-f]{32}$'
const ANA = '^ana_[0-9a-f]{32}$'

const common = {
  '400': err('Validation failed.'),
  '401': err('Bearer token missing or invalid (only when INTERLOCK_API_TOKEN is set).'),
  '429': err('Rate limited.'),
}
const engineErrors = {
  '422': err('The engine rejected an input (parse error code, side, location and issues in details).'),
  '503': err('Analysis capacity exhausted, memory limit exceeded or server shutting down.'),
  '504': err('The analysis exceeded INTERLOCK_ANALYSIS_TIMEOUT_MS and was stopped.'),
}

export function openApiDocument(): Schema {
  return {
    openapi: '3.1.0',
    info: {
      title: 'INTERLOCK API',
      version: API_VERSION,
      summary: 'PLC safety logic integrity and impact analysis from exported project files.',
      description:
        'Upload exported PLC project versions (Rockwell L5X), declare safety functions, and compare two versions. Every engine call runs in a worker thread with a memory cap and a timeout. Errors use one envelope: {"error":{"code","message","details?"}}.',
      license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
    },
    servers: [{ url: '/' }],
    security: [{}, { bearerAuth: [] }],
    tags: [{ name: 'meta' }, { name: 'projects' }, { name: 'safety' }, { name: 'analyses' }, { name: 'drift' }],
    paths: {
      '/api/health': {
        get: { tags: ['meta'], summary: 'Liveness, versions, database and limits. Never requires a token.', security: [{}], responses: { '200': json(ref('Health'), 'Healthy.'), '503': json(ref('Health'), 'Database unavailable.') } },
      },
      '/api/openapi.json': { get: { tags: ['meta'], summary: 'This document.', responses: { '200': json({ type: 'object' }, 'OpenAPI 3.1 document.') } } },
      '/api/adapters': {
        get: { tags: ['meta'], summary: 'Project file formats and their support status.', responses: { '200': json({ type: 'object', properties: { adapters: { type: 'array', items: ref('Adapter') }, uploadExtensions: { type: 'array', items: { type: 'string' } } } }, 'Adapters.'), ...common } },
      },
      '/api/rules': { get: { tags: ['meta'], summary: 'Analysis rules with default severities.', responses: { '200': json({ type: 'object', properties: { rules: { type: 'array', items: ref('Rule') } } }, 'Rules.'), ...common } } },
      '/api/scenarios': { get: { tags: ['meta'], summary: 'Built-in synthetic scenario registry (read-only).', responses: { '200': json(looseObject('fixtures/scenarios.json'), 'Scenario registry.'), ...common } } },
      '/api/projects': {
        post: {
          tags: ['projects'],
          summary: 'Create a project.',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: ['string', 'null'], maxLength: 2000 } } } } } },
          responses: { '201': json(ref('Project'), 'Created.'), '415': err('Not JSON.'), ...common },
        },
        get: { tags: ['projects'], summary: 'List projects, newest first.', parameters: paging, responses: { '200': json({ type: 'object', properties: { total: { type: 'integer' }, projects: { type: 'array', items: ref('Project') } } }, 'Projects.'), ...common } },
      },
      '/api/projects/{id}': {
        get: { tags: ['projects'], summary: 'One project.', parameters: [idParam('id', 'Project id.', PRJ)], responses: { '200': json(ref('Project'), 'Project.'), '404': err('No such project.'), ...common } },
      },
      '/api/projects/{id}/versions': {
        post: {
          tags: ['projects'],
          summary: 'Upload a project version. The file is parsed in a worker; failed uploads are not stored.',
          parameters: [idParam('id', 'Project id.', PRJ), query('name', 'File name (required for octet-stream; must end in an accepted extension).')],
          requestBody: {
            required: true,
            content: {
              'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
              'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } },
            },
          },
          responses: {
            '201': json(ref('Version'), 'Parsed and stored; returns the summary.'),
            '404': err('No such project.'),
            '413': err('Larger than INTERLOCK_MAX_UPLOAD_MB.'),
            '415': err('Unsupported content type or file extension.'),
            ...engineErrors,
            ...common,
          },
        },
        get: { tags: ['projects'], summary: "A project's versions (summaries only).", parameters: [idParam('id', 'Project id.', PRJ), ...paging], responses: { '200': json({ type: 'object', properties: { total: { type: 'integer' }, versions: { type: 'array', items: ref('Version') } } }, 'Versions.'), '404': err('No such project.'), ...common } },
      },
      '/api/versions/{id}': {
        get: { tags: ['projects'], summary: 'One version summary (never the raw bytes).', parameters: [idParam('id', 'Version id.', VER)], responses: { '200': json(ref('Version'), 'Version.'), '404': err('No such version.'), ...common } },
      },
      '/api/projects/{id}/safety-manifest': {
        get: { tags: ['safety'], summary: "The project's safety manifest.", parameters: [idParam('id', 'Project id.', PRJ)], responses: { '200': json(ref('SafetyManifest'), 'Manifest.'), '404': err('No such project, or no manifest set.'), ...common } },
        put: {
          tags: ['safety'],
          summary: 'Replace the safety manifest (validated).',
          parameters: [idParam('id', 'Project id.', PRJ)],
          requestBody: { required: true, content: { 'application/json': { schema: ref('SafetyManifest') } } },
          responses: { '200': json(ref('SafetyManifest'), 'Stored.'), '404': err('No such project.'), '415': err('Not JSON.'), ...common },
        },
      },
      '/api/safety-functions': {
        post: {
          tags: ['safety'],
          summary: "Add a safety function to a project's manifest, or replace the one with the same id.",
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['projectId', 'function'], additionalProperties: false, properties: { projectId: { type: 'string', pattern: PRJ }, function: ref('SafetyFunction') } } } } },
          responses: {
            '200': json({ type: 'object', properties: { replaced: { const: true }, manifest: ref('SafetyManifest') } }, 'Replaced.'),
            '201': json({ type: 'object', properties: { replaced: { const: false }, manifest: ref('SafetyManifest') } }, 'Added.'),
            '404': err('No such project.'),
            ...common,
          },
        },
      },
      '/api/analyses': {
        post: {
          tags: ['analyses'],
          summary: "Compare two versions. Uses the given manifest, else the current version's project manifest.",
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['baselineVersionId', 'currentVersionId'], additionalProperties: false, properties: { baselineVersionId: { type: 'string', pattern: VER }, currentVersionId: { type: 'string', pattern: VER }, manifest: ref('SafetyManifest') } } } } },
          responses: { '201': json(ref('AnalysisCreated'), 'Analysis stored.'), '404': err('Version not found.'), ...engineErrors, ...common },
        },
        get: { tags: ['analyses'], summary: 'List analyses, newest first.', parameters: paging, responses: { '200': json({ type: 'object', properties: { total: { type: 'integer' }, analyses: { type: 'array', items: ref('AnalysisRecord') } } }, 'Analyses.'), ...common } },
      },
      '/api/analyses/{id}': {
        get: { tags: ['analyses'], summary: 'Analysis record and full result.', parameters: [idParam('id', 'Analysis id.', ANA)], responses: { '200': json({ allOf: [ref('AnalysisRecord'), { type: 'object', properties: { result: ref('AnalysisResult') } }] }, 'Analysis.'), '404': err('No such analysis.'), ...common } },
      },
      '/api/analyses/{id}/findings': {
        get: {
          tags: ['analyses'],
          summary: 'Findings in review order, optionally filtered. Each filter takes a comma-separated list.',
          parameters: [
            idParam('id', 'Analysis id.', ANA),
            query('severity', 'CRITICAL, HIGH, MEDIUM, LOW, INFO'),
            query('type', 'Finding type, e.g. NEW_INHIBIT'),
            query('safetyFunction', 'Safety function id, e.g. SF-06'),
            query('disposition', 'REVIEW, UNDECLARED, INFORMATIONAL, POSITIVE'),
          ],
          responses: { '200': json({ type: 'object', properties: { total: { type: 'integer' }, findings: { type: 'array', items: ref('Finding') } } }, 'Findings.'), '404': err('No such analysis.'), ...common },
        },
      },
      '/api/analyses/{id}/findings/{findingId}': {
        get: { tags: ['analyses'], summary: 'One finding with its evidence.', parameters: [idParam('id', 'Analysis id.', ANA), idParam('findingId', 'Finding id, e.g. IL-0001.')], responses: { '200': json(ref('Finding'), 'Finding.'), '404': err('No such analysis or finding.'), ...common } },
      },
      '/api/analyses/{id}/changes': {
        get: { tags: ['analyses'], summary: 'Every change between the two versions.', parameters: [idParam('id', 'Analysis id.', ANA), query('category', 'logic, execution, interface, configuration, data, documentation or metadata')], responses: { '200': json({ type: 'object', properties: { total: { type: 'integer' }, changes: { type: 'array', items: looseObject('Change') } } }, 'Changes.'), '404': err('No such analysis.'), ...common } },
      },
      '/api/analyses/{id}/graph': {
        get: { tags: ['analyses'], summary: 'Reuse / execution graph.', parameters: [idParam('id', 'Analysis id.', ANA)], responses: { '200': json({ type: 'object', properties: { nodes: { type: 'array', items: looseObject('GraphNode') }, edges: { type: 'array', items: looseObject('GraphEdge') } } }, 'Graph.'), '404': err('No such analysis.'), ...common } },
      },
      '/api/analyses/{id}/safety-map': {
        get: { tags: ['analyses'], summary: 'Safety function results and module blast radius.', parameters: [idParam('id', 'Analysis id.', ANA)], responses: { '200': json({ type: 'object', properties: { safetyFunctions: { type: 'array', items: looseObject('SafetyFunctionResult') }, modules: { type: 'array', items: looseObject('ModuleBlastRadius') } } }, 'Safety map.'), '404': err('No such analysis.'), ...common } },
      },
      '/api/analyses/{id}/report': {
        get: {
          tags: ['analyses'],
          summary: 'Download the report (Content-Disposition: attachment).',
          parameters: [idParam('id', 'Analysis id.', ANA), query('format', 'json (default), csv, md or pdf', { type: 'string', enum: ['json', 'csv', 'md', 'pdf'] })],
          responses: {
            '200': {
              description: 'Report file.',
              content: {
                'application/json': { schema: ref('AnalysisResult') },
                'text/csv': { schema: { type: 'string' } },
                'text/markdown': { schema: { type: 'string' } },
                'application/pdf': { schema: { type: 'string', format: 'binary' } },
              },
            },
            '404': err('No such analysis.'),
            ...common,
          },
        },
      },
      '/api/drift': {
        post: {
          tags: ['drift'],
          summary: 'Compare reusable module definitions across 2-20 site versions.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['sites'], additionalProperties: false, properties: { sites: { type: 'array', minItems: 2, maxItems: 20, items: { type: 'object', required: ['label', 'versionId'], properties: { label: { type: 'string', minLength: 1, maxLength: 64 }, versionId: { type: 'string', pattern: VER } } } }, manifest: ref('SafetyManifest') } } } },
          },
          responses: { '200': json(looseObject('DriftReport (schema interlock.drift/v1)'), 'Drift report.'), '404': err('Version not found.'), ...engineErrors, ...common },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Required on every /api route except /api/health when INTERLOCK_API_TOKEN is set.' } },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } },
        },
        Health: {
          type: 'object',
          properties: {
            status: { enum: ['ok', 'degraded'] },
            service: { type: 'string' },
            version: { type: 'string' },
            engineVersion: { type: 'string' },
            analysisMode: { const: 'SERVER' },
            db: { type: 'object', properties: { engine: { const: 'sqlite' }, mode: { enum: ['memory', 'file'] }, ok: { type: 'boolean' }, schemaVersion: { type: ['integer', 'null'] } } },
            uptimeSeconds: { type: 'integer' },
            authRequired: { type: 'boolean' },
            limits: { type: 'object', additionalProperties: { type: 'integer' } },
          },
        },
        Adapter: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, format: { type: 'string' }, vendor: { type: 'string' }, status: { enum: ['SUPPORTED', 'PLANNED'] }, version: { type: 'string' }, extensions: { type: 'array', items: { type: 'string' } } } },
        Rule: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, severity: { enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] } } },
        Project: { type: 'object', properties: { id: { type: 'string', pattern: PRJ }, name: { type: 'string' }, description: { type: ['string', 'null'] }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, versionCount: { type: 'integer' }, hasManifest: { type: 'boolean' } } },
        Version: {
          type: 'object',
          properties: { id: { type: 'string', pattern: VER }, projectId: { type: 'string' }, fileName: { type: 'string' }, sizeBytes: { type: 'integer' }, sha256: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, summary: looseObject('ProjectVersionSummary: parser, metadata, counts, diagnostics, readiness') },
        },
        SafetyFunction: {
          type: 'object',
          required: ['id', 'name', 'kind', 'criticality', 'implementation'],
          properties: {
            id: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', maxLength: 32 },
            name: { type: 'string' },
            description: { type: 'string' },
            kind: { enum: ['SHUTDOWN', 'TRIP', 'INTERLOCK', 'PERMISSIVE', 'ALARM'] },
            criticality: { enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
            implementation: { type: 'object', properties: { program: { type: 'string' }, routine: { type: 'string' }, module: { type: 'string' }, instance: { type: 'string' } } },
            protectiveOutput: { type: 'object', properties: { tag: { type: 'string' }, tripState: { enum: ['DE_ENERGIZE', 'ENERGIZE'] } } },
            alarm: { type: 'object', properties: { tag: { type: 'string' }, notification: { type: 'string' } } },
            enableCondition: { type: 'string' },
            notes: { type: 'string' },
          },
        },
        SafetyManifest: {
          type: 'object',
          required: ['schema', 'functions'],
          properties: {
            schema: { const: 'interlock.safety/v1' },
            project: { type: 'string' },
            functions: { type: 'array', items: ref('SafetyFunction') },
            nonSafetyScope: { type: 'object', properties: { programs: { type: 'array', items: { type: 'string' } }, routines: { type: 'array', items: { type: 'string' } } } },
          },
        },
        AnalysisRecord: {
          type: 'object',
          properties: {
            id: { type: 'string', pattern: ANA },
            resultId: { type: 'string' },
            projectId: { type: ['string', 'null'] },
            baselineVersionId: { type: 'string' },
            currentVersionId: { type: 'string' },
            status: { const: 'COMPLETE' },
            createdAt: { type: 'string', format: 'date-time' },
            durationMs: { type: 'integer' },
            trustStatus: { enum: ['VERIFIED_SCOPE', 'PARTIAL_COVERAGE', 'REVIEW_REQUIRED'] },
            priority: { enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'NONE'] },
            findingCount: { type: 'integer' },
          },
        },
        AnalysisCreated: { allOf: [ref('AnalysisRecord'), { type: 'object', properties: { trust: looseObject('Trust'), surface: looseObject('ReviewSurface'), coverage: looseObject('Coverage') } }] },
        AnalysisResult: looseObject('Full analysis result (schema interlock.analysis/v1).'),
        Finding: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            fingerprint: { type: 'string' },
            ruleId: { type: 'string' },
            type: { type: 'string' },
            title: { type: 'string' },
            severity: { enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] },
            confidence: { enum: ['HIGH', 'MEDIUM', 'LOW'] },
            disposition: { enum: ['REVIEW', 'UNDECLARED', 'INFORMATIONAL', 'POSITIVE'] },
            safetyFunctionIds: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
            evidence: { type: 'array', items: looseObject('EvidenceItem') },
          },
          additionalProperties: true,
        },
      },
    },
  }
}
