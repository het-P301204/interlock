/**
 * Effects → findings: group effects that describe the same root cause,
 * rank them with a documented score, number them in review order and attach
 * an evidence ledger built only from parsed project content and computations.
 *
 * Score (docs/analysis-methodology.md):
 *   severity     CRITICAL 100 · HIGH 70 · MEDIUM 45 · LOW 20 · INFO 5
 *   criticality  highest declared criticality of affected functions: CRITICAL 15 · HIGH 10 · MEDIUM 5 · LOW 0
 *   breadth      5 × min(4, log2(1 + affected safety functions + safety-relevant instances))
 *   notification BROKEN 8 · SUPPRESSED 4 · DEGRADED 2
 *   rule bonus   bypass by a new writer +6, inhibit on an externally writable tag +6, external write access
 *                granted +4, shared module +2 per safety-relevant instance (max 10), protective name hint +4
 *   confidence   HIGH 0 · MEDIUM −3 · LOW −8
 *   order        REVIEW and UNDECLARED findings always precede INFORMATIONAL and POSITIVE ones; within a
 *                group, by score, then severity, then finding type, then fingerprint
 */
import type {
  Confidence, EvidenceItem, Finding, ProjectVersionSummary, Side, Severity,
} from '../model/analysis.ts'
import { shortHash } from '../util/sha256.ts'
import type { RawComparison } from '../logic/truth.ts'
import { negatedLabel } from '../logic/expr.ts'
import type { Effect, EvidenceHint, RuleContext } from './rules/types.ts'
import { CRITICALITY_RANK, maxSeverity, sortSfIds } from './rules/types.ts'
import type { DiffChange } from './diff.ts'
import { RULE_INFO } from './rules/index.ts'

const SEV_W: Record<Severity, number> = { CRITICAL: 100, HIGH: 70, MEDIUM: 45, LOW: 20, INFO: 5 }
const CRIT_W = [0, 5, 10, 15]
const NOTIF_W = { NONE: 0, DEGRADED: 2, SUPPRESSED: 4, BROKEN: 8 }
const CONF_W: Record<Confidence, number> = { HIGH: 0, MEDIUM: -3, LOW: -8 }
const CONF_ORDER: Confidence[] = ['LOW', 'MEDIUM', 'HIGH']

export interface FindingMeta {
  analyzedAt: string
  baseline: ProjectVersionSummary
  current: ProjectVersionSummary
}

export function toComparison(ctx: RuleContext, raw: RawComparison): Finding['firing'] {
  const pool = ctx.pool
  const atoms = raw.atoms.map((i) => {
    const a = pool.atoms[i]!
    const key = a.key.startsWith('tag:') ? a.key.slice(4) : null
    const meta = key ? (ctx.current.scan.meta.get(key) ?? ctx.baseline.scan.meta.get(key)) : undefined
    return {
      id: a.key,
      label: a.label,
      kind: a.kind,
      ...(a.tag ? { tag: a.tag } : {}),
      externalAccess: meta ? meta.externalAccess : ('n/a' as const),
      externallySet: key ? ctx.current.scan.executedWrites(key).length === 0 : false,
      inBaseline: true,
      inCurrent: true,
    }
  })
  const out: NonNullable<Finding['firing']> = {
    verdict: raw.verdict,
    before: raw.before,
    after: raw.after,
    atoms,
    exhaustive: raw.exhaustive,
    assignmentsChecked: raw.checked,
  }
  if (raw.lost) out.lost = raw.lost
  if (raw.gained) out.gained = raw.gained
  if (raw.reason) out.reason = raw.reason
  if (raw.witness) {
    out.witness = {
      before: raw.witness.before,
      after: raw.witness.after,
      values: [...raw.witness.values.entries()].map(([i, v]) => {
        const a = pool.atoms[i]!
        return { atom: a.key, label: a.label, value: a.numeric || a.range ? (v ? a.label : negatedLabel(a)) : v ? '1' : '0' }
      }),
    }
  }
  return out
}

/** Mark which atoms appear in each side's condition. */
function markSides(ctx: RuleContext, raw: RawComparison, firing: NonNullable<Finding['firing']>, roots?: { before: number; after: number }) {
  if (!roots) return
  const b = new Set(ctx.pool.atomsOf([roots.before]).map((i) => ctx.pool.atoms[i]!.key))
  const a = new Set(ctx.pool.atomsOf([roots.after]).map((i) => ctx.pool.atoms[i]!.key))
  for (const at of firing.atoms) {
    at.inBaseline = b.has(at.id)
    at.inCurrent = a.has(at.id)
  }
  void raw
}

export function buildFindings(effects: Effect[], ctx: RuleContext, meta: FindingMeta): Finding[] {
  const groups = new Map<string, Effect[]>()
  for (const e of effects) {
    const g = groups.get(e.groupKey)
    if (g) g.push(e)
    else groups.set(e.groupKey, [e])
  }
  const critOf = (ids: string[]) => Math.max(-1, ...ids.map((id) => CRITICALITY_RANK[ctx.sfById.get(id)?.sf.criticality ?? 'LOW']!))

  type Draft = Omit<Finding, 'id' | 'rank' | 'evidence'> & { hints: EvidenceHint[] }
  const drafts: Draft[] = []
  for (const list of groups.values()) {
    list.sort((x, y) => critOf(y.safetyFunctionIds) - critOf(x.safetyFunctionIds) || (x.safetyFunctionIds[0] ?? '').localeCompare(y.safetyFunctionIds[0] ?? ''))
    const primary = list[0]!
    const sfIds = sortSfIds(list.flatMap((e) => e.safetyFunctionIds), ctx)
    const changeIds = [...new Set(list.flatMap((e) => e.changeIds))].sort()
    const severity = maxSeverity(...list.map((e) => e.severity))
    const confidence = list.map((e) => e.confidence).reduce((a, b) => (CONF_ORDER.indexOf(b) < CONF_ORDER.indexOf(a) ? b : a))
    const explanation = [...primary.explanation]
    const impact = [...primary.impact]
    if (list.length > 1) {
      const others = list.slice(1)
      explanation.push(`The same change affects ${others.length} more declared safety function${others.length === 1 ? '' : 's'}:`)
      for (const e of others) {
        const name = e.safetyFunctionIds.map((id) => ctx.sfById.get(id)!.sf.name).join(', ')
        explanation.push(e.firing ? `${name}: before ${e.firing.before.text}; now ${e.firing.after.text}.` : `${name}: ${e.summary}`)
        impact.push(...e.impact.filter((x) => !impact.includes(x) && !x.startsWith('Affected safety function')))
      }
      const names = sfIds.map((id) => ctx.sfById.get(id)!.sf.name)
      const idx = impact.findIndex((x) => x.startsWith('Affected safety function'))
      const line = `Affected safety functions: ${names.join(', ')}.`
      if (idx >= 0) impact[idx] = line
      else impact.push(line)
    }
    const module = primary.module ?? list.find((e) => e.module)?.module
    let blastRadius = primary.blastRadius
    if (!blastRadius && module) {
      const m = ctx.modules.find((x) => x.name.toLowerCase() === module.toLowerCase())
      if (m && m.changed) {
        const ex = m.instances.filter((i) => i.executed)
        blastRadius = { instances: m.instances.length, safetyRelevant: ex.filter((i) => i.safetyFunctionIds.length).length, operational: ex.filter((i) => !i.safetyFunctionIds.length).length }
      }
    }
    const notificationImpact = list.map((e) => e.notificationImpact).reduce((a, b) => (NOTIF_W[b] > NOTIF_W[a] ? b : a))
    const hints: EvidenceHint[] = []
    const seen = new Set<string>()
    for (const e of list)
      for (const h of e.evidence) {
        const key = h.kind === 'change' ? `c${h.changeId}` : h.kind === 'declaration' ? `d${h.sfId}` : h.kind === 'writer' ? `w${h.side}${h.writer.routineId}${h.writer.rung}${h.writer.instruction}` : `${h.kind}${'title' in h ? h.title : ''}${'note' in h ? h.note : ''}`
        if (seen.has(key)) continue
        seen.add(key)
        hints.push(h)
      }
    const breadth = 5 * Math.min(4, Math.log2(1 + sfIds.length + (blastRadius?.safetyRelevant ?? 0)))
    const bonus = Math.max(...list.map((e) => e.bonus))
    let score = SEV_W[severity] + CRIT_W[Math.max(0, critOf(sfIds))]! * (sfIds.length ? 1 : 0) + breadth + NOTIF_W[notificationImpact] + bonus + CONF_W[confidence]
    if (primary.disposition === 'POSITIVE' || primary.disposition === 'INFORMATIONAL') score = Math.min(score, 30)
    score = Math.round(score * 10) / 10
    const firing = primary.firing ? toComparison(ctx, primary.firing) : undefined
    if (firing && primary.firing) {
      const a = ctx.sfById.get(primary.safetyFunctionIds[0] ?? '')
      const roots =
        primary.type === 'ALARM_SUPPRESSED' && a?.notification
          ? { before: a.notification.notifyB, after: a.notification.notifyC }
          : a?.protective
            ? { before: a.protective.tripB, after: a.protective.tripC }
            : undefined
      markSides(ctx, primary.firing, firing, roots)
    }
    const changeNames = changeIds.map((id) => ctx.changeById.get(id)?.summary ?? id).sort()
    const fingerprint = shortHash([primary.type, primary.ruleId, sfIds.join(','), module ?? '', primary.location.routineId ?? '', changeNames.join('|')].join('|'))
    const d: Draft = {
      fingerprint,
      ruleId: primary.ruleId,
      ruleTitle: ruleTitle(primary.ruleId),
      type: primary.type,
      title: primary.title,
      severity,
      confidence,
      disposition: primary.disposition,
      safetyFunctionIds: sfIds,
      location: primary.location,
      notificationImpact,
      summary: primary.summary,
      explanation,
      impact,
      recommendation: primary.recommendation,
      changeIds,
      score,
      hints,
    }
    if (module) d.module = module
    if (blastRadius) d.blastRadius = blastRadius
    if (firing) d.firing = firing
    drafts.push(d)
  }

  const typeOrder = (t: string) => ['PROTECTIVE_OUTPUT_BYPASSED', 'PROTECTIVE_PATH_REMOVED', 'NEW_INHIBIT', 'SHUTDOWN_WEAKENED', 'ALARM_SUPPRESSED'].indexOf(t)
  const group = (d: { disposition: string }) => (d.disposition === 'REVIEW' || d.disposition === 'UNDECLARED' ? 0 : 1)
  drafts.sort(
    (a, b) =>
      group(a) - group(b) ||
      b.score - a.score ||
      SEV_W[b.severity] - SEV_W[a.severity] ||
      (typeOrder(a.type) === -1 ? 99 : typeOrder(a.type)) - (typeOrder(b.type) === -1 ? 99 : typeOrder(b.type)) ||
      a.fingerprint.localeCompare(b.fingerprint),
  )
  return drafts.map((d, i) => {
    const id = `IL-${String(i + 1).padStart(4, '0')}`
    const { hints, ...rest } = d
    const finding: Finding = { ...rest, id, rank: i + 1, evidence: [] }
    finding.evidence = hints.map((h, k) => evidenceItem(ctx, meta, finding, h, `EV-${id.slice(3)}-${String(k + 1).padStart(2, '0')}`))
    return finding
  })
}

function sideMeta(meta: FindingMeta, side: Side) {
  const s = side === 'baseline' ? meta.baseline : meta.current
  return { sourceFile: s.file.name, fileSha256: s.file.sha256, parserVersion: `${s.parser.adapter} ${s.parser.version}` }
}

function changeKind(c: DiffChange): EvidenceItem['kind'] {
  if (c.entity.type === 'rung') return c.entity.routineId?.startsWith('module:') ? 'module-rung' : 'rung'
  if (c.entity.type === 'module-parameter' || c.entity.type === 'module') return 'module'
  if (c.entity.type === 'routine') return 'routine'
  if (c.entity.type === 'tag') return 'tag'
  if (c.entity.type === 'task') return 'task'
  if (c.entity.type === 'program') return 'program'
  return 'computation'
}

function evidenceItem(ctx: RuleContext, meta: FindingMeta, f: Finding, h: EvidenceHint, id: string): EvidenceItem {
  const base = { id, findingId: f.id, rule: `${f.ruleId} ${ruleTitle(f.ruleId)}`, analyzedAt: meta.analyzedAt }
  switch (h.kind) {
    case 'change': {
      const c = ctx.changeById.get(h.changeId)!
      const side: EvidenceItem['side'] = c.baselineSource && c.currentSource ? 'both' : c.currentSource ? 'current' : 'baseline'
      const src = c.currentSource ?? c.baselineSource
      const sm = sideMeta(meta, c.currentSource ? 'current' : 'baseline')
      const item: EvidenceItem = {
        ...base,
        side,
        kind: changeKind(c),
        title: `${h.changeId}: ${c.summary}`,
        ...sm,
      }
      if (src) {
        item.xmlPath = src.path
        item.line = src.line
        item.column = src.column
      }
      const rid = c.entity.routineId
      if (rid?.startsWith('module:')) item.module = c.entity.container ?? ''
      else if (c.entity.type === 'module' || c.entity.type === 'module-parameter') item.module = c.entity.container ?? c.entity.name
      if (rid && !rid.startsWith('module:')) {
        item.program = c.entity.container ?? ''
        item.routine = rid.split('/').slice(1).join('/')
      }
      if (c.before !== undefined) item.original = c.before
      if (c.after !== undefined) item.modified = c.after
      if (side === 'both' && c.baselineSource) {
        const bm = sideMeta(meta, 'baseline')
        item.note = `Baseline: ${bm.sourceFile} (sha256 ${bm.fileSha256.slice(0, 12)}…) line ${c.baselineSource.line}, ${c.baselineSource.path}`
      }
      if (c.semantic) item.note = `${item.note ? `${item.note}. ` : ''}Rung semantics: ${c.semantic}.`
      return item
    }
    case 'writer': {
      const idx = ctx.indexOf(h.side)
      const routine = idx.routines.get(h.writer.routineId)
      const rung = routine?.rungs.find((r) => r.number === h.writer.rung)
      const item: EvidenceItem = { ...base, side: h.side, kind: routine?.container.kind === 'module' ? 'module-rung' : 'rung', title: `${h.note}: ${h.writer.instruction}`, ...sideMeta(meta, h.side), note: h.note }
      const src = rung?.source ?? h.writer.source
      if (src) {
        item.xmlPath = src.path
        item.line = src.line
        item.column = src.column
      }
      if (routine) {
        if (routine.container.kind === 'module') item.module = routine.container.name
        else item.program = routine.container.name
        item.routine = routine.name
      }
      if (rung) {
        if (h.side === 'baseline') item.original = rung.text
        else item.modified = rung.text
      }
      return item
    }
    case 'declaration': {
      const a = ctx.sfById.get(h.sfId)!
      return { ...base, side: 'declaration', kind: 'declaration', title: `Declared safety function ${a.sf.id}: ${a.sf.name}`, original: JSON.stringify(a.sf, null, 2), note: 'Engineer-declared safety intent from the safety manifest.' }
    }
    case 'computation': {
      const raw = h.comparison
      const witness = raw.witness
        ? [...raw.witness.values.entries()].map(([i, v]) => {
            const at = ctx.pool.atoms[i]!
            return at.numeric || at.range ? (v ? at.label : negatedLabel(at)) : `${at.label}=${v ? 1 : 0}`
          }).join(', ')
        : ''
      return {
        ...base,
        side: 'both',
        kind: 'computation',
        title: h.title,
        original: raw.before.text,
        modified: raw.after.text,
        note: `${h.note} Verdict: ${raw.verdict}.${witness ? ` Witness: ${witness}.` : ''}`,
        parserVersion: `${meta.current.parser.adapter} ${meta.current.parser.version}`,
      }
    }
    case 'routine': {
      const idx = ctx.indexOf(h.side)
      const r = idx.routines.get(h.routineId) ?? ctx.indexOf(h.side === 'current' ? 'baseline' : 'current').routines.get(h.routineId)
      const item: EvidenceItem = { ...base, side: h.side, kind: 'routine', title: `Routine ${h.routineId.replace(/^(program|module):/, '')}`, ...sideMeta(meta, h.side), note: h.note }
      if (r) {
        item.xmlPath = r.source.path
        item.line = r.source.line
        item.column = r.source.column
        item.routine = r.name
        if (r.container.kind === 'program') item.program = r.container.name
        else item.module = r.container.name
      }
      return item
    }
    case 'tag':
      return { ...base, side: h.side, kind: 'tag', title: `Tag ${h.tag}`, ...sideMeta(meta, h.side), note: h.note }
  }
}

const RULE_TITLES = new Map(RULE_INFO.map((r) => [r.id, r.title]))
function ruleTitle(id: string): string {
  return RULE_TITLES.get(id) ?? ''
}
