/**
 * Tokenizers for rung text (Logix RLL neutral text) and condition text
 * ("Pressure_High AND NOT Maintenance_Mode"), plus a unit-level LCS diff.
 * Display-only: the engine owns real parsing.
 */

export type UnitKind = 'call' | 'branch' | 'end' | 'space' | 'word' | 'keyword' | 'paren' | 'other'

export interface Unit {
  text: string
  kind: UnitKind
}

const IDENT_START = /[A-Za-z_\\]/
const IDENT_CHAR = /[\w.:\\]/

export function splitRung(text: string): Unit[] {
  const units: Unit[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (/\s/.test(ch)) {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j]!)) j++
      units.push({ text: text.slice(i, j), kind: 'space' })
      i = j
    } else if (ch === '[' || ch === ']' || ch === ',') {
      units.push({ text: ch, kind: 'branch' })
      i++
    } else if (ch === ';') {
      units.push({ text: ch, kind: 'end' })
      i++
    } else if (IDENT_START.test(ch)) {
      let j = i + 1
      while (j < text.length && IDENT_CHAR.test(text[j]!)) j++
      if (text[j] === '(') {
        let depth = 0
        let k = j
        for (; k < text.length; k++) {
          if (text[k] === '(') depth++
          else if (text[k] === ')') {
            depth--
            if (depth === 0) {
              k++
              break
            }
          }
        }
        units.push({ text: text.slice(i, k), kind: 'call' })
        i = k
      } else {
        units.push({ text: text.slice(i, j), kind: 'word' })
        i = j
      }
    } else {
      units.push({ text: ch, kind: 'other' })
      i++
    }
  }
  return units
}

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'XOR', 'TRUE', 'FALSE'])

export function splitCondition(text: string): Unit[] {
  const units: Unit[] = []
  const re = /\s+|[()]|[A-Za-z_\\][\w.:\\[\]]*|[^\s()]+/g
  for (const m of text.matchAll(re)) {
    const t = m[0]
    if (/^\s+$/.test(t)) units.push({ text: t, kind: 'space' })
    else if (t === '(' || t === ')') units.push({ text: t, kind: 'paren' })
    else if (KEYWORDS.has(t)) units.push({ text: t, kind: 'keyword' })
    else units.push({ text: t, kind: 'word' })
  }
  return units
}

/** Known Logix instruction mnemonics; any other `Name(...)` call is a module (AOI) call. */
export const INSTRUCTIONS = new Set([
  'XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'OSR', 'OSF', 'JSR', 'RET', 'SBR', 'JMP', 'LBL', 'MCR', 'AFI', 'NOP', 'TND',
  'TON', 'TOF', 'RTO', 'CTU', 'CTD', 'RES', 'MOV', 'MVM', 'COP', 'CPS', 'FLL', 'CLR', 'CPT', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'NEG', 'ABS', 'SQR',
  'EQU', 'NEQ', 'GRT', 'GEQ', 'LES', 'LEQ', 'LIM', 'MEQ', 'CMP', 'AND', 'OR', 'XOR', 'NOT', 'BTD', 'ALMD', 'ALMA', 'GSV', 'SSV', 'MSG', 'PID', 'TONR', 'TOFR', 'RTOR',
])

export const OUTPUT_INSTRUCTIONS = new Set(['OTE', 'OTL', 'OTU'])

export type DiffMark = 'same' | 'added' | 'removed'

/** LCS over non-space unit texts. Returns marks aligned with the input arrays. */
export function diffUnits(a: Unit[], b: Unit[]): { a: DiffMark[]; b: DiffMark[] } {
  const ai = a.map((u, i) => (u.kind === 'space' ? -1 : i)).filter((i) => i >= 0)
  const bi = b.map((u, i) => (u.kind === 'space' ? -1 : i)).filter((i) => i >= 0)
  const n = ai.length
  const m = bi.length
  const marksA: DiffMark[] = a.map(() => 'same')
  const marksB: DiffMark[] = b.map(() => 'same')
  if (n * m > 400_000) {
    // Too large to diff usefully in the browser; leave unmarked.
    return { a: marksA, b: marksB }
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[ai[i]!]!.text === b[bi[j]!]!.text ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[ai[i]!]!.text === b[bi[j]!]!.text) {
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      marksA[ai[i]!] = 'removed'
      i++
    } else {
      marksB[bi[j]!] = 'added'
      j++
    }
  }
  for (; i < n; i++) marksA[ai[i]!] = 'removed'
  for (; j < m; j++) marksB[bi[j]!] = 'added'
  bridgeSpaces(a, marksA)
  bridgeSpaces(b, marksB)
  return { a: marksA, b: marksB }
}

/** A space between two marked units of the same kind joins the run, so "AND NOT X" highlights as one span. */
function bridgeSpaces(units: Unit[], marks: DiffMark[]): void {
  for (let k = 1; k < units.length - 1; k++) {
    if (units[k]!.kind !== 'space') continue
    const before = marks[k - 1]
    if (before !== 'same' && before === marks[k + 1]) marks[k] = before!
  }
}
