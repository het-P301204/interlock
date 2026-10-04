/**
 * JSON, CSV and Markdown exports. Every user-controlled string (tag names,
 * descriptions, rung text, file names) is untrusted:
 *   - invisible and bidirectional control characters are stripped (Trojan Source)
 *   - CSV cells that a spreadsheet would execute (= + - @ tab CR) are prefixed with '
 *   - Markdown table cells escape | and collapse newlines, so a value cannot forge cells or headings
 *   - Markdown inline text escapes the characters that create links, images and HTML
 */
import type { AnalysisResult } from '../model/analysis.ts'
import { cleanText } from '../util/sanitize.ts'
import { reportDocument, type Block } from './document.ts'

export function toJson(r: AnalysisResult): string {
  return JSON.stringify(r, null, 2)
}

export function csvCell(v: unknown): string {
  let x = cleanText(String(v ?? ''))
  if (/^[=+\-@\t\r]/.test(x)) x = `'${x}`
  return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x
}

export function toCsv(r: AnalysisResult): string {
  const head = ['finding_id', 'rank', 'severity', 'confidence', 'disposition', 'type', 'rule', 'title', 'safety_functions', 'module', 'program', 'routine', 'rung', 'tag', 'blast_instances', 'blast_safety_relevant', 'notification_impact', 'before', 'after', 'summary', 'change_ids', 'fingerprint']
  const rows = r.findings.map((f) => [
    f.id, f.rank, f.severity, f.confidence, f.disposition, f.type, f.ruleId, f.title,
    f.safetyFunctionIds.join(' '), f.module ?? '', f.location.program ?? '', f.location.routine ?? '', f.location.rung ?? '', f.location.tag ?? '',
    f.blastRadius?.instances ?? '', f.blastRadius?.safetyRelevant ?? '', f.notificationImpact,
    f.firing?.before.text ?? '', f.firing?.after.text ?? '', f.summary, f.changeIds.join(' '), f.fingerprint,
  ])
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Escape inline Markdown so user text cannot create links, images, HTML or emphasis. */
export function mdInline(v: string): string {
  return cleanText(v).replace(/[\\`*_{}[\]()<>#+!|&~]/g, (c) => `\\${c}`).replace(/\r\n|\r|\n/g, ' ')
}

export function mdCell(v: string): string {
  return mdInline(v).replace(/\s+/g, ' ').trim() || ' '
}

function mdCode(v: string): string {
  const text = cleanText(v).replace(/\r\n?/g, '\n')
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)))
  return `${fence}text\n${text}\n${fence}`
}

export function renderMarkdown(blocks: Block[]): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.t) {
      case 'h1':
        out.push(`# ${mdInline(b.text)}`)
        break
      case 'h2':
        out.push(`## ${mdInline(b.text)}`)
        break
      case 'h3':
        out.push(`### ${mdInline(b.text)}`)
        break
      case 'p':
        out.push(mdInline(b.text))
        break
      case 'kv':
        out.push(['| | |', '|---|---|', ...b.rows.map(([k, v]) => `| ${mdCell(k)} | ${mdCell(v)} |`)].join('\n'))
        break
      case 'table':
        out.push([`| ${b.head.map(mdCell).join(' | ')} |`, `|${b.head.map(() => '---').join('|')}|`, ...b.rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`)].join('\n'))
        break
      case 'code':
        out.push(mdCode(b.text))
        break
      case 'list':
        out.push(b.items.map((i) => `- ${mdInline(i)}`).join('\n'))
        break
      case 'rule':
        out.push('---')
        break
    }
  }
  return out.join('\n\n') + '\n'
}

export function toMarkdown(r: AnalysisResult): string {
  return renderMarkdown(reportDocument(r))
}
