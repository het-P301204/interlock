/**
 * SARIF 2.1.0 output, for GitHub code scanning and other SARIF consumers.
 * One reporting descriptor per INTERLOCK rule; one result per finding.
 */
import { RULE_INFO } from '@interlock/core'
import type { AnalysisResult, EvidenceItem, Finding, Severity } from '@interlock/core'

export type SarifLevel = 'error' | 'warning' | 'note'

export function sarifLevel(s: Severity): SarifLevel {
  return s === 'CRITICAL' || s === 'HIGH' ? 'error' : s === 'MEDIUM' ? 'warning' : 'note'
}

/** GitHub's security-severity scale (0-10) so code scanning ranks results like INTERLOCK does. */
const SECURITY_SEVERITY: Record<Severity, string> = { CRITICAL: '9.5', HIGH: '8.0', MEDIUM: '5.5', LOW: '3.0', INFO: '0.0' }

function lineOf(f: Finding, currentName: string): number | undefined {
  const onCurrent = (e: EvidenceItem) => (e.side === 'current' || e.side === 'both') && typeof e.line === 'number' && e.line > 0 && (!e.sourceFile || e.sourceFile === currentName)
  return f.evidence.find(onCurrent)?.line
}

export interface SarifOptions {
  /** URI of the current project file as it should appear in the report (repository-relative when possible). */
  currentUri: string
  toolVersion: string
  informationUri?: string
}

export function toSarif(r: AnalysisResult, opts: SarifOptions): Record<string, unknown> {
  const rules = [...RULE_INFO]
  for (const f of r.findings) if (!rules.some((x) => x.id === f.ruleId)) rules.push({ id: f.ruleId, title: f.ruleTitle, description: f.ruleTitle, severity: f.severity })
  const index = new Map(rules.map((x, i) => [x.id, i]))
  const results = r.findings.map((f) => {
    const line = lineOf(f, r.current.file.name)
    const physicalLocation: Record<string, unknown> = { artifactLocation: { uri: opts.currentUri, index: 0 } }
    if (line !== undefined) physicalLocation['region'] = { startLine: line }
    const loc = [f.location.program, f.location.routine, f.location.rung !== undefined ? `rung ${f.location.rung}` : undefined].filter(Boolean).join('/')
    const location: Record<string, unknown> = { physicalLocation }
    if (loc) location['logicalLocations'] = [{ fullyQualifiedName: loc, kind: 'function' }]
    return {
      ruleId: f.ruleId,
      ruleIndex: index.get(f.ruleId)!,
      level: sarifLevel(f.severity),
      message: { text: f.summary },
      locations: [location],
      partialFingerprints: { 'interlockFingerprint/v1': f.fingerprint },
      properties: {
        findingId: f.id,
        type: f.type,
        severity: f.severity,
        disposition: f.disposition,
        confidence: f.confidence,
        safetyFunctionIds: f.safetyFunctionIds,
        'security-severity': SECURITY_SEVERITY[f.severity],
      },
    }
  })
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'INTERLOCK',
            version: opts.toolVersion,
            semanticVersion: opts.toolVersion,
            ...(opts.informationUri ? { informationUri: opts.informationUri } : {}),
            rules: rules.map((x) => ({
              id: x.id,
              name: x.title.replace(/[^A-Za-z0-9]+(.)?/g, (_m, ch: string | undefined) => (ch ? ch.toUpperCase() : '')).replace(/^./, (ch) => ch.toUpperCase()),
              shortDescription: { text: x.title },
              fullDescription: { text: x.description },
              defaultConfiguration: { level: sarifLevel(x.severity) },
              properties: { severity: x.severity, 'security-severity': SECURITY_SEVERITY[x.severity], tags: ['safety', 'plc'] },
            })),
          },
        },
        artifacts: [
          { location: { uri: opts.currentUri }, length: r.current.file.sizeBytes, hashes: { 'sha-256': r.current.file.sha256 }, roles: ['analysisTarget'] },
        ],
        invocations: [{ executionSuccessful: true }],
        properties: { analysisId: r.id, engineVersion: r.engineVersion, trust: r.trust.status, priority: r.surface.priority, baseline: { name: r.baseline.file.name, sha256: r.baseline.file.sha256 } },
        results,
      },
    ],
  }
}
