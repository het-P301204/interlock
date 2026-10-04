/**
 * The analysis report as a small document model. Markdown and PDF are both
 * rendered from this one model, so the two formats can never disagree, and
 * every sentence in it is assembled from the AnalysisResult: nothing is
 * written freehand.
 */
import type { AnalysisResult, Finding } from '../model/analysis.ts'
import { cleanText } from '../util/sanitize.ts'

export type Block =
  | { t: 'h1' | 'h2' | 'h3'; text: string }
  | { t: 'p'; text: string }
  | { t: 'kv'; rows: Array<[string, string]> }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'code'; text: string }
  | { t: 'list'; items: string[] }
  | { t: 'rule' }

const s = (x: unknown) => cleanText(String(x ?? ''))
const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${a} / ${b}`)

export function reportDocument(r: AnalysisResult): Block[] {
  const b: Block[] = []
  const sfName = (id: string) => r.safetyFunctions.find((x) => x.function.id === id)?.function.name ?? id
  const review = r.findings.filter((f) => f.disposition === 'REVIEW' || f.disposition === 'UNDECLARED')

  b.push({ t: 'h1', text: 'INTERLOCK Impact Review' })
  b.push({ t: 'p', text: `PLC Safety Logic Integrity & Impact Analyzer. Analysis ${s(r.id)}, ${s(r.analyzedAt)}, engine ${s(r.engineVersion)}.` })

  b.push({ t: 'h2', text: '1. Executive summary' })
  b.push({
    t: 'kv',
    rows: [
      ['Review priority', r.surface.priority],
      ['Trust status', r.trust.status.replace(/_/g, ' ')],
      ['Coverage', `${r.coverage.percent}%`],
      ['Total changes', String(r.surface.totalChanges)],
      ['Meaningful logic changes', String(r.surface.meaningfulLogicChanges)],
      ['Safety-relevant changes', String(r.surface.safetyRelevant)],
      ['Notification-path changes', String(r.surface.notificationPathChanges)],
      ['Shared modules with safety impact', String(r.surface.sharedModulesWithSafetyImpact)],
      ['Undeclared routines affected', String(r.surface.undeclaredAffected)],
    ],
  })
  b.push({ t: 'p', text: s(r.trust.headline) })
  if (r.trust.reasons.length) b.push({ t: 'list', items: r.trust.reasons.map(s) })
  if (review.length === 0)
    b.push({ t: 'p', text: 'No safety-impacting changes identified within the declared analysis scope.' })

  b.push({ t: 'h2', text: '2. Project metadata' })
  b.push({
    t: 'table',
    head: ['', 'Baseline', 'Current'],
    rows: [
      ['File', s(r.baseline.file.name), s(r.current.file.name)],
      ['SHA-256', r.baseline.file.sha256, r.current.file.sha256],
      ['Size (bytes)', String(r.baseline.file.sizeBytes), String(r.current.file.sizeBytes)],
      ['Format', s(r.baseline.metadata.formatLabel), s(r.current.metadata.formatLabel)],
      ['Controller', s(`${r.baseline.metadata.controllerName} (${r.baseline.metadata.processorType ?? '?'})`), s(`${r.current.metadata.controllerName} (${r.current.metadata.processorType ?? '?'})`)],
      ['Firmware', s(r.baseline.metadata.firmwareRevision ?? ''), s(r.current.metadata.firmwareRevision ?? '')],
      ['Export date', s(r.baseline.metadata.exportDate ?? ''), s(r.current.metadata.exportDate ?? '')],
      ['Programs / routines / rungs', `${r.baseline.counts.programs} / ${r.baseline.counts.routines} / ${r.baseline.counts.rungs}`, `${r.current.counts.programs} / ${r.current.counts.routines} / ${r.current.counts.rungs}`],
      ['AOI definitions / instances', `${r.baseline.counts.modules} / ${r.baseline.counts.instances}`, `${r.current.counts.modules} / ${r.current.counts.instances}`],
      ['Tags', String(r.baseline.counts.tags), String(r.current.counts.tags)],
    ],
  })

  b.push({ t: 'h2', text: '3. Analysis scope' })
  b.push({
    t: 'table',
    head: ['ID', 'Safety function', 'Kind', 'Criticality', 'Protective output', 'Alarm', 'Status'],
    rows: r.safetyFunctions.map((x) => [
      s(x.function.id),
      s(x.function.name),
      x.function.kind,
      x.function.criticality,
      s(x.function.protectiveOutput ? `${x.function.protectiveOutput.tag} (${x.function.protectiveOutput.tripState === 'ENERGIZE' ? 'acts at 1' : 'acts at 0'})` : '—'),
      s(x.function.alarm?.tag ?? '—'),
      x.status.replace(/_/g, ' '),
    ]),
  })
  b.push({
    t: 'kv',
    rows: [
      ['Safety functions analyzed', pct(r.coverage.safetyFunctions.covered, r.coverage.safetyFunctions.total)],
      ['Declared routines covered', pct(r.coverage.declaredRoutines.covered, r.coverage.declaredRoutines.total)],
      ['AOI relationships resolved', pct(r.coverage.moduleRelationships.covered, r.coverage.moduleRelationships.total)],
      ['Notification paths analyzed', pct(r.coverage.notificationPaths.covered, r.coverage.notificationPaths.total)],
      ['Declared non-safety scope', s([...(r.manifest.nonSafetyScope?.programs ?? []), ...(r.manifest.nonSafetyScope?.routines ?? [])].join(', ') || 'none')],
    ],
  })

  b.push({ t: 'h2', text: '4. Change summary' })
  b.push({
    t: 'table',
    head: ['Category', 'Changes'],
    rows: Object.entries(r.surface.byCategory).filter(([, n]) => n > 0).map(([k, n]) => [k, String(n)]),
  })
  const logic = r.changes.filter((c) => c.category === 'logic' || c.category === 'execution' || c.category === 'interface')
  if (logic.length)
    b.push({
      t: 'table',
      head: ['Change', 'Summary', 'Semantics'],
      rows: logic.slice(0, 200).map((c) => [c.id, s(c.summary), c.semantic ?? '—']),
    })

  const findingBlocks = (fs: Finding[]) => {
    for (const f of fs) {
      b.push({ t: 'h3', text: `${f.id} · ${f.severity} · ${s(f.title)}` })
      const kv: Array<[string, string]> = [
        ['Rule', `${f.ruleId} ${s(f.ruleTitle)}`],
        ['Confidence', f.confidence],
        ['Safety functions', s(f.safetyFunctionIds.map(sfName).join(', ') || '—')],
      ]
      if (f.module) kv.push(['Module', s(f.module)])
      if (f.blastRadius) kv.push(['Blast radius', `${f.blastRadius.instances} instances, ${f.blastRadius.safetyRelevant} safety-relevant, ${f.blastRadius.operational} operational`])
      if (f.notificationImpact !== 'NONE') kv.push(['Notification impact', f.notificationImpact])
      b.push({ t: 'kv', rows: kv })
      b.push({ t: 'p', text: s(f.summary) })
      if (f.firing) {
        b.push({ t: 'code', text: `Before: ${s(f.firing.before.text)}\nAfter:  ${s(f.firing.after.text)}${f.firing.lost ? `\nNo longer: ${s(f.firing.lost.text)}` : ''}` })
      }
      b.push({ t: 'list', items: f.explanation.map(s) })
      if (f.recommendation.length) b.push({ t: 'p', text: `Recommended review: ${f.recommendation.map(s).join(' ')}` })
    }
  }

  const safety = r.findings.filter((f) => f.disposition === 'REVIEW' && f.type !== 'ALARM_SUPPRESSED' && f.type !== 'SHARED_MODULE_PROPAGATION')
  b.push({ t: 'h2', text: '5. Safety-relevant findings' })
  if (safety.length) findingBlocks(safety)
  else b.push({ t: 'p', text: 'No safety-impacting changes identified within the declared analysis scope.' })

  const alarms = r.findings.filter((f) => f.type === 'ALARM_SUPPRESSED')
  b.push({ t: 'h2', text: '6. Alarm and notification findings' })
  if (alarms.length) findingBlocks(alarms)
  else b.push({ t: 'p', text: 'No declared notification path changed.' })
  const paths = r.safetyFunctions.filter((x) => x.notification)
  if (paths.length)
    b.push({
      t: 'table',
      head: ['Safety function', 'Alarm', 'Path status', 'Suppressed by'],
      rows: paths.map((x) => [s(x.function.name), s(x.notification!.alarmTag), x.notification!.status, s(x.notification!.suppressors.join(', ') || '—')]),
    })

  b.push({ t: 'h2', text: '7. Reuse blast radius' })
  const mods = r.modules
  if (mods.length) {
    b.push({
      t: 'table',
      head: ['Module', 'Changed', 'Revision', 'Instances', 'Safety-relevant', 'Operational', 'Not executed'],
      rows: mods.map((m) => [s(m.module), m.changed ? 'yes' : 'no', s(m.revisionBefore === m.revisionAfter ? (m.revisionAfter ?? '—') : `${m.revisionBefore ?? '—'} → ${m.revisionAfter ?? '—'}`), String(m.totals.instances), String(m.totals.safetyRelevant), String(m.totals.operational), String(m.totals.notExecuted)]),
    })
    findingBlocks(r.findings.filter((f) => f.type === 'SHARED_MODULE_PROPAGATION'))
  } else b.push({ t: 'p', text: 'The projects contain no reusable module call sites.' })

  b.push({ t: 'h2', text: '8. Undeclared logic' })
  if (r.undeclared.length) {
    b.push({ t: 'p', text: 'UNDECLARED: no safety intent has been declared for this logic. INTERLOCK therefore cannot conclude that it is safe.' })
    b.push({ t: 'table', head: ['Routine', 'Changes', 'Note'], rows: r.undeclared.map((u) => [s(`${u.program ? `${u.program}/` : ''}${u.routine}`), u.changeIds.join(', '), s(u.hint ?? '')]) })
  } else b.push({ t: 'p', text: 'No undeclared routine was affected by the changes.' })

  b.push({ t: 'h2', text: '9. Evidence' })
  for (const f of review.length ? review : r.findings) {
    for (const e of f.evidence) {
      b.push({ t: 'h3', text: `${e.id} · ${s(e.title)}` })
      const rows: Array<[string, string]> = [
        ['Finding', e.findingId],
        ['Side', e.side],
        ['Rule', s(e.rule)],
      ]
      if (e.sourceFile) rows.push(['Source file', s(e.sourceFile)])
      if (e.fileSha256) rows.push(['SHA-256', e.fileSha256])
      if (e.parserVersion) rows.push(['Parser', s(e.parserVersion)])
      if (e.xmlPath) rows.push(['XML location', s(`${e.xmlPath}${e.line ? ` (line ${e.line}, column ${e.column})` : ''}`)])
      if (e.program || e.routine) rows.push(['Routine', s(`${e.program ? `${e.program}/` : ''}${e.routine ?? ''}`)])
      if (e.module) rows.push(['Module', s(e.module)])
      rows.push(['Recorded', e.analyzedAt])
      b.push({ t: 'kv', rows })
      if (e.original !== undefined || e.modified !== undefined)
        b.push({ t: 'code', text: `${e.original !== undefined ? `Original: ${s(e.original)}` : ''}${e.original !== undefined && e.modified !== undefined ? '\n' : ''}${e.modified !== undefined ? `Modified: ${s(e.modified)}` : ''}` })
      if (e.note) b.push({ t: 'p', text: s(e.note) })
    }
  }

  b.push({ t: 'h2', text: '10. Recommended review order' })
  if (r.surface.reviewOrder.length)
    b.push({ t: 'table', head: ['#', 'Finding', 'Severity', 'Title', 'Safety function'], rows: r.surface.reviewOrder.map((x) => [String(x.rank).padStart(2, '0'), x.findingId, x.severity, s(x.title), s(x.safetyFunction ?? '—')]) })
  else b.push({ t: 'p', text: 'Nothing requires safety review within the declared scope.' })
  const info = r.findings.filter((f) => f.disposition === 'INFORMATIONAL' || f.disposition === 'POSITIVE')
  if (info.length) b.push({ t: 'list', items: info.map((f) => `${f.id} (${f.disposition.toLowerCase()}): ${s(f.title)}`) })

  b.push({ t: 'h2', text: '11. Parser and analysis metadata' })
  b.push({
    t: 'kv',
    rows: [
      ['Engine', `INTERLOCK ${r.engineVersion}`],
      ['Parser (baseline)', s(`${r.baseline.parser.adapter} ${r.baseline.parser.version}`)],
      ['Parser (current)', s(`${r.current.parser.adapter} ${r.current.parser.version}`)],
      ['Analysis id', r.id],
      ['Analyzed at', r.analyzedAt],
      ['Method', 'Symbolic single-scan execution; exhaustive truth-table comparison of firing conditions; deterministic rules. No machine learning or language model is involved in any conclusion.'],
    ],
  })
  b.push({ t: 'table', head: ['Stage', 'What it did'], rows: r.stages.map((x) => [x.label, s(x.detail)]) })
  b.push({ t: 'table', head: ['Rule', 'Title', 'Base severity'], rows: r.rules.map((x) => [x.id, s(x.title), x.severity]) })
  if (r.coverage.unsupported.length)
    b.push({ t: 'list', items: r.coverage.unsupported.slice(0, 50).map((u) => `${u.side}: ${s(u.detail)} (${s(u.location)})${u.inSafetyCone ? ' [in safety logic]' : ''}`) })
  b.push({ t: 'rule' })
  b.push({ t: 'p', text: 'INTERLOCK analyzes exported project files only. It never connects to a controller. This report accelerates engineering review; it does not certify a project as safe or secure.' })
  return b
}
