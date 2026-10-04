/**
 * Engine API types used by the web app. Re-exported from one place so the
 * import path can change (e.g. to a `@interlock/core/api` subpath) in one edit.
 * Type-only: nothing from the engine is bundled through this module.
 */
export type {
  AdapterInfo,
  AnalyzeFailure,
  AnalyzeHooks,
  AnalyzeInput,
  DriftInput,
  DriftSiteInput,
  FileInput,
  InspectError,
  InspectResult,
  ManifestValidation,
  StageEvent,
} from '../../../../packages/core/src/api-types.ts'
