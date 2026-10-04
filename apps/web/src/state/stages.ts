import type { StageId } from '@interlock/core/types'

/** The ten pipeline stages in execution order, with their display labels. */
export const STAGES: ReadonlyArray<{ id: StageId; label: string }> = [
  { id: 'INGEST', label: 'INGEST' },
  { id: 'NORMALIZE', label: 'NORMALIZE' },
  { id: 'RESOLVE_MODULES', label: 'RESOLVE MODULES' },
  { id: 'BUILD_REUSE_GRAPH', label: 'BUILD REUSE GRAPH' },
  { id: 'MAP_SAFETY_FUNCTIONS', label: 'MAP SAFETY FUNCTIONS' },
  { id: 'COMPARE_LOGIC', label: 'COMPARE LOGIC' },
  { id: 'TRACE_PROTECTIVE_PATHS', label: 'TRACE PROTECTIVE PATHS' },
  { id: 'ANALYZE_ALARMS', label: 'ANALYZE ALARMS' },
  { id: 'RANK_IMPACT', label: 'RANK IMPACT' },
  { id: 'GENERATE_REVIEW_SET', label: 'GENERATE REVIEW SET' },
]
