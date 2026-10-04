/**
 * Relay ladder logic (RLL) rung parser.
 *
 * Logix neutral rung text is a left-to-right sequence of instructions with
 * parallel branches:
 *
 *   XIC(A)[XIO(B) ,XIC(C) ]OTE(D);
 *
 * Instructions in series are ANDed into the rung condition; the legs of a
 * branch `[leg ,leg ,leg ]` are ORed. Output instructions pass the rung
 * condition through unchanged, which is what makes output branches work.
 *
 * Inside an instruction's parentheses `[` and `,` mean array index and
 * argument separator, so tokenizing is context-sensitive: operands are split
 * on commas at nesting depth zero only. `CPT(Dest, A*(B+C))` and
 * `MOV(Tbl[3,1],X)` both parse.
 */

export interface RllInstruction {
  kind: 'ins'
  mnemonic: string
  operands: string[]
  /** Offset of the mnemonic in the rung text. */
  offset: number
}

export interface RllBranch {
  kind: 'branch'
  legs: RllElement[][]
  offset: number
}

export type RllElement = RllInstruction | RllBranch

export interface RllParseResult {
  elements: RllElement[]
  /** Empty when the rung parsed cleanly. */
  errors: string[]
}

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c)
const isIdentChar = (c: string) => /[A-Za-z0-9_]/.test(c)

/** Parse neutral rung text. Never throws: problems are returned in `errors`. */
export function parseRung(text: string): RllParseResult {
  const errors: string[] = []
  let i = 0
  const n = text.length

  const skipWs = () => {
    while (i < n && /\s/.test(text[i]!)) i++
  }

  const readInstruction = (): RllInstruction | null => {
    const start = i
    while (i < n && isIdentChar(text[i]!)) i++
    const mnemonic = text.slice(start, i)
    skipWs()
    if (text[i] !== '(') {
      errors.push(`Expected "(" after ${mnemonic} at offset ${i}`)
      return null
    }
    i++ // (
    const operands: string[] = []
    let depth = 0
    let cur = ''
    let quote: string | null = null
    while (i < n) {
      const c = text[i]!
      if (quote) {
        cur += c
        if (c === quote) quote = null
        i++
        continue
      }
      if (c === "'" || c === '"') {
        quote = c
        cur += c
        i++
        continue
      }
      if (c === '(' || c === '[') depth++
      else if (c === ')' || c === ']') {
        if (depth === 0) {
          if (c === ']') {
            errors.push(`Unbalanced "]" inside ${mnemonic} at offset ${i}`)
            return null
          }
          break
        }
        depth--
      } else if (c === ',' && depth === 0) {
        operands.push(cur.trim())
        cur = ''
        i++
        continue
      }
      cur += c
      i++
    }
    if (text[i] !== ')') {
      errors.push(`Unterminated operand list for ${mnemonic}`)
      return null
    }
    i++ // )
    if (cur.trim() !== '' || operands.length > 0) operands.push(cur.trim())
    return { kind: 'ins', mnemonic: mnemonic.toUpperCase(), operands, offset: start }
  }

  // Parse a sequence until one of the terminators; returns the elements.
  const readSequence = (terminators: string): RllElement[] => {
    const seq: RllElement[] = []
    for (;;) {
      skipWs()
      if (i >= n) return seq
      const c = text[i]!
      if (terminators.includes(c)) return seq
      if (c === '[') {
        const offset = i
        i++
        const legs: RllElement[][] = []
        for (;;) {
          legs.push(readSequence(',];'))
          skipWs()
          if (text[i] === ',') {
            i++
            continue
          }
          if (text[i] === ']') {
            i++
            break
          }
          errors.push(`Unterminated branch starting at offset ${offset}`)
          return seq
        }
        seq.push({ kind: 'branch', legs, offset })
        continue
      }
      if (isIdentStart(c)) {
        const ins = readInstruction()
        if (!ins) return seq
        seq.push(ins)
        continue
      }
      errors.push(`Unexpected "${c}" at offset ${i}`)
      return seq
    }
  }

  const elements = readSequence(';')
  skipWs()
  if (errors.length === 0) {
    if (text[i] === ';') {
      i++
      skipWs()
      if (i < n) errors.push(`Unexpected content after ";" at offset ${i}`)
    } else if (i < n) {
      errors.push(`Unexpected "${text[i]}" at offset ${i}`)
    }
  }
  return { elements, errors }
}

/** Canonical single-line rendering used for comparing rung text. */
export function renderRung(elements: RllElement[]): string {
  const seq = (els: RllElement[]): string =>
    els
      .map((e) => (e.kind === 'ins' ? `${e.mnemonic}(${e.operands.join(',')})` : `[${e.legs.map(seq).join(',')}]`))
      .join('')
  return `${seq(elements)};`
}

/** Every instruction in the rung, depth-first left to right. */
export function instructionsOf(elements: RllElement[]): RllInstruction[] {
  const out: RllInstruction[] = []
  const walk = (els: RllElement[]) => {
    for (const e of els) {
      if (e.kind === 'ins') out.push(e)
      else for (const leg of e.legs) walk(leg)
    }
  }
  walk(elements)
  return out
}

/* --------------------------------------------------------- instruction set */

/** Condition (input) instructions INTERLOCK models exactly. */
export const BIT_INPUTS = new Set(['XIC', 'XIO'])
export const COMPARISONS = new Set(['EQU', 'NEQ', 'GRT', 'GEQ', 'LES', 'LEQ', 'LIM'])
/** Instructions that change what executes, not just what is written. */
export const EXECUTION_CONTROL = new Set(['JMP', 'LBL', 'TND', 'MCR', 'SBR', 'RET', 'UID', 'UIE', 'EOT', 'SFP', 'SFR'])
/** Instructions with a destination operand INTERLOCK treats as an opaque (non-boolean) write. */
export const MOVE_LIKE: Record<string, number> = {
  MOV: 1, MVM: 2, CPT: 0, COP: 1, CPS: 1, FLL: 1, CLR: 0, ADD: 2, SUB: 2, MUL: 2, DIV: 2, MOD: 2,
  SQR: 1, NEG: 1, ABS: 1, AND: 2, OR: 2, XOR: 2, NOT: 1, BTD: 2, TOD: 1, FRD: 1, SWPB: 2, DDT: -1,
  GSV: 3, MSG: -1, RES: 0,
}
export const TIMERS = new Set(['TON', 'TOF', 'RTO'])
export const COUNTERS = new Set(['CTU', 'CTD'])
export const ONE_SHOTS = new Set(['ONS', 'OSR', 'OSF'])

/** Classic (non-AOI) instructions known to INTERLOCK; anything else is an AOI call or unsupported. */
export const KNOWN_INSTRUCTIONS = new Set<string>([
  ...BIT_INPUTS, ...COMPARISONS, ...EXECUTION_CONTROL, ...Object.keys(MOVE_LIKE), ...TIMERS, ...COUNTERS, ...ONE_SHOTS,
  'OTE', 'OTL', 'OTU', 'JSR', 'NOP', 'AFI', 'ALMD', 'ALMA', 'SSV', 'MEQ', 'CMP',
])

/** Numeric literal (Logix allows 16#, 8#, 2# radix prefixes and underscores). */
export function parseNumericLiteral(s: string): number | null {
  const t = s.trim().replace(/_/g, '')
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t)
  const m = /^([+-]?)(16|8|2)#([0-9A-Fa-f]+)$/.exec(t)
  if (m) {
    const v = parseInt(m[3]!, Number(m[2]))
    return Number.isNaN(v) ? null : m[1] === '-' ? -v : v
  }
  return null
}

/** True for operands that are tag references (as opposed to literals or "?"). */
export function isTagOperand(s: string): boolean {
  const t = s.trim()
  return t !== '' && t !== '?' && parseNumericLiteral(t) === null && /^[\\A-Za-z_]/.test(t)
}

/**
 * Split a tag reference into its base tag and member path:
 *   "PUMP_01_IL.Shutdown_Alarm" → { base: "PUMP_01_IL", member: "Shutdown_Alarm" }
 *   "\\Safety.Trip_Bit"          → { base: "Trip_Bit", program: "Safety" }
 *   "Local:3:I.Data.4"           → { base: "Local:3:I", member: "Data.4" }
 *   "Tbl[3].Value"                → { base: "Tbl", member: "[3].Value" }
 */
export function splitTagRef(ref: string): { base: string; member: string; program?: string } {
  let t = ref.trim()
  let program: string | undefined
  if (t.startsWith('\\')) {
    const dot = t.indexOf('.')
    if (dot > 0) {
      program = t.slice(1, dot)
      t = t.slice(dot + 1)
    }
  }
  const m = /^([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z0-9_]+)*)(.*)$/.exec(t)
  const base = m ? m[1]! : t
  let member = m ? m[2]! : ''
  if (member.startsWith('.')) member = member.slice(1)
  return program !== undefined ? { base, member, program } : { base, member }
}
