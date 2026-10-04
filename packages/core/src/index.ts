/**
 * @interlock/core — the INTERLOCK analysis engine.
 *
 * Deterministic, side-effect free, and runnable both in the browser (Web
 * Worker) and in Node (API server, CLI). It never reads the clock, the
 * network or the filesystem: callers pass bytes in and get results out.
 */
export type * from './model/index.ts'
export type * from './api-types.ts'
export { SEVERITY_ORDER } from './model/analysis.ts'
export { ProjectParseError, DEFAULT_XML_LIMITS } from './adapters/types.ts'
export type { ProjectAdapter, XmlLimits, ParseOptions } from './adapters/types.ts'
export { ADAPTERS, detectAdapter, parseProjectText } from './adapters/registry.ts'
export {
  analyzeProjects, analyzeProjectsSync, inspectProject, inspectProjectSync, AnalysisInputError, ENGINE_VERSION, STAGE_LABELS,
} from './analysis/pipeline.ts'
export { validateManifest, parseManifestText } from './analysis/manifest.ts'
export { analyzeDrift, analyzeDriftSync } from './analysis/drift.ts'
export { RULE_INFO } from './analysis/rules/index.ts'
export { sha256, sha256Text } from './util/sha256.ts'
export { stripInvisible, cleanText } from './util/sanitize.ts'
export { toJson, toCsv, toMarkdown } from './report/export.ts'
export { toPdf } from './report/pdf.ts'

import { ADAPTERS } from './adapters/registry.ts'
import type { AdapterInfo } from './api-types.ts'

/** What each format adapter can do, for honest display in the UI. */
export const ADAPTER_INFO: AdapterInfo[] = ADAPTERS.map(({ id, label, format, vendor, status, version, extensions }) => ({ id, label, format, vendor, status, version, extensions }))
