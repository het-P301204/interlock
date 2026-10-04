/**
 * Deciding how a firing condition changed.
 *
 * INTERLOCK compares the baseline and current condition by checking every
 * consistent assignment of the atoms they mention. That is exponential in the
 * number of atoms, which is fine for the 3-15 inputs a real protective
 * function depends on and is bounded explicitly: beyond the bound the verdict
 * is NOT_DECIDED, never a guess.
 *
 * Numeric comparisons on the same tag are not independent bits: "Level > 95"
 * implies "Level > 85". Such atoms are grouped per tag, and the group is
 * enumerated over representative values of the tag (each constant, values
 * between and beyond them), so only assignments a real value could produce
 * are checked. That is what lets INTERLOCK say "setpoint raised from 85.0 to
 * 95.0: the trip no longer fires for Level in (85.0, 95.0]" instead of
 * reporting two unrelated atoms.
 */
import type { ExprPool } from './expr.ts'
import { compareTest, negatedLabel } from './expr.ts'

export interface Bounds {
  /** Maximum number of assignments enumerated. */
  maxAssignments: number
  /** Maximum atoms for computing a minimal sum-of-products rendering. */
  maxMinimizeAtoms: number
}

export const DEFAULT_BOUNDS: Bounds = { maxAssignments: 1 << 20, maxMinimizeAtoms: 12 }

type Var =
  | { kind: 'bool'; atom: number }
  | { kind: 'numeric'; atoms: number[]; rows: Uint8Array[] }

export interface Space {
  atoms: number[]
  vars: Var[]
  total: number
}

function representativePoints(constants: number[], integer: boolean): number[] {
  const cs = [...new Set(constants)].sort((a, b) => a - b)
  const pts: number[] = []
  if (integer) {
    for (const c of cs) pts.push(Math.floor(c) - 1, Math.floor(c), Math.ceil(c), Math.ceil(c) + 1)
  } else {
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      pts.push(c)
      if (i === 0) pts.push(c - 1)
      const next = cs[i + 1]
      pts.push(next === undefined ? c + 1 : (c + next) / 2)
    }
  }
  return [...new Set(pts)].sort((a, b) => a - b)
}

/** Group atoms into enumeration variables. */
export function buildSpace(pool: ExprPool, atomIdx: number[]): Space {
  const vars: Var[] = []
  const groups = new Map<string, number[]>()
  for (const a of atomIdx) {
    const atom = pool.atoms[a]!
    const subject = atom.numeric?.subject ?? atom.range?.subject
    if (subject) {
      const g = groups.get(subject)
      if (g) g.push(a)
      else groups.set(subject, [a])
    } else vars.push({ kind: 'bool', atom: a })
  }
  for (const atoms of groups.values()) {
    const constants: number[] = []
    let integer = true
    for (const a of atoms) {
      const at = pool.atoms[a]!
      if (at.numeric) {
        constants.push(at.numeric.value)
        integer &&= at.numeric.integer
      }
      if (at.range) {
        constants.push(at.range.low, at.range.high)
        integer &&= at.range.integer
      }
    }
    const pts = representativePoints(constants, integer)
    const seen = new Set<string>()
    const rows: Uint8Array[] = []
    for (const x of pts) {
      const row = new Uint8Array(atoms.length)
      atoms.forEach((a, i) => {
        const at = pool.atoms[a]!
        if (at.numeric) row[i] = compareTest(at.numeric.op, x, at.numeric.value) ? 1 : 0
        else if (at.range) {
          const { low, high } = at.range
          row[i] = low <= high ? (x >= low && x <= high ? 1 : 0) : x >= low || x <= high ? 1 : 0
        }
      })
      const key = row.join('')
      if (!seen.has(key)) {
        seen.add(key)
        rows.push(row)
      }
    }
    vars.push({ kind: 'numeric', atoms, rows })
  }
  let total = 1
  for (const v of vars) {
    total *= v.kind === 'bool' ? 2 : v.rows.length
    if (total > Number.MAX_SAFE_INTEGER / 64) break
  }
  return { atoms: atomIdx, vars, total }
}

/**
 * Visit every consistent assignment. `values` is indexed by atom index (size
 * = pool.atoms.length) and is mutated in place before each callback.
 */
export function forEachAssignment(space: Space, values: Uint8Array, visit: () => void): void {
  const radix = space.vars.map((v) => (v.kind === 'bool' ? 2 : v.rows.length))
  const digit = new Array<number>(space.vars.length).fill(0)
  const apply = (i: number) => {
    const v = space.vars[i]!
    if (v.kind === 'bool') values[v.atom] = digit[i]!
    else {
      const row = v.rows[digit[i]!]!
      v.atoms.forEach((a, k) => (values[a] = row[k]!))
    }
  }
  for (let i = 0; i < space.vars.length; i++) apply(i)
  for (;;) {
    visit()
    let i = 0
    while (i < space.vars.length) {
      digit[i]!++
      if (digit[i]! < radix[i]!) {
        apply(i)
        break
      }
      digit[i] = 0
      apply(i)
      i++
    }
    if (i === space.vars.length) return
  }
}

export interface Term {
  /** Atom index → required value. */
  literals: Array<{ atom: number; value: boolean }>
}

export interface ConditionRendering {
  text: string
  terms: string[]
  minimal: boolean
}

export interface RawComparison {
  verdict: 'UNCHANGED' | 'EQUIVALENT' | 'WEAKENED' | 'STRENGTHENED' | 'MIXED' | 'NEVER_FIRES' | 'ALWAYS_FIRES' | 'NOT_DECIDED'
  exhaustive: boolean
  checked: number
  atoms: number[]
  /** Witness assignment (atom index → value) for the most telling difference. */
  witness?: { values: Map<number, boolean>; before: boolean; after: boolean }
  before: ConditionRendering
  after: ConditionRendering
  lost?: ConditionRendering
  gained?: ConditionRendering
  beforeSatisfiable: boolean
  afterSatisfiable: boolean
  reason?: string
}

/**
 * Compare two conditions over the union of their atoms.
 *   WEAKENED      some assignment fired before and does not fire now, none the other way
 *   STRENGTHENED  the reverse
 *   MIXED         both directions
 *   NEVER_FIRES   the current condition is unsatisfiable while the baseline was not
 *   ALWAYS_FIRES  the current condition is a tautology while the baseline was not
 */
export function compareConditions(pool: ExprPool, before: number, after: number, bounds: Bounds = DEFAULT_BOUNDS): RawComparison {
  const atoms = pool.atomsOf([before, after])
  const space = buildSpace(pool, atoms)
  const structural = (): RawComparison => ({
    verdict: 'NOT_DECIDED',
    exhaustive: false,
    checked: 0,
    atoms,
    before: { text: pool.render(before), terms: [pool.render(before)], minimal: false },
    after: { text: pool.render(after), terms: [pool.render(after)], minimal: false },
    beforeSatisfiable: before !== pool.FALSE,
    afterSatisfiable: after !== pool.FALSE,
    reason: `The conditions depend on ${atoms.length} inputs (${space.total.toLocaleString('en-US')} assignments), more than the exhaustive-analysis bound of ${bounds.maxAssignments.toLocaleString('en-US')}.`,
  })
  if (space.total > bounds.maxAssignments) return structural()

  const values = new Uint8Array(pool.atoms.length)
  const evalBoth = pool.evaluator([before, after])
  const minimize = atoms.length <= bounds.maxMinimizeAtoms
  const feasible = new Set<number>()
  const onB = new Set<number>()
  const onA = new Set<number>()
  let checked = 0
  let lost = 0
  let gained = 0
  let anyB = false
  let allB = true
  let anyA = false
  let allA = true
  type W = { bits: Uint8Array; weight: number }
  const wit: { lost: W | null; gained: W | null } = { lost: null, gained: null }

  // A "normal operating state": the lowest-weight assignment in which the
  // baseline condition does not fire. Witnesses are chosen closest to it, so
  // examples read as "everything normal, except these inputs".
  let rest: Uint8Array | null = null
  let restWeight = Infinity
  {
    const evB = pool.evaluator([before])
    forEachAssignment(space, values, () => {
      if (evB(values)[0]) return
      let w = 0
      for (const at of atoms) w += values[at]!
      if (w < restWeight) {
        restWeight = w
        rest = values.slice()
      }
    })
  }
  const restBits: Uint8Array | null = rest

  forEachAssignment(space, values, () => {
    checked++
    const [b, a] = evalBoth(values) as [boolean, boolean]
    anyB ||= b
    allB &&= b
    anyA ||= a
    allA &&= a
    let weight = 0
    if (restBits) for (const at of atoms) weight += values[at] === restBits[at] ? 0 : 1
    else for (const at of atoms) weight += values[at]!
    if (b && !a) {
      lost++
      if (!wit.lost || weight < wit.lost.weight) wit.lost = { bits: values.slice(), weight }
    } else if (a && !b) {
      gained++
      if (!wit.gained || weight < wit.gained.weight) wit.gained = { bits: values.slice(), weight }
    }
    if (minimize) {
      let key = 0
      atoms.forEach((at, i) => {
        if (values[at]) key |= 1 << i
      })
      feasible.add(key)
      if (b) onB.add(key)
      if (a) onA.add(key)
    }
  })

  const render = (on: Set<number>, root: number | null): ConditionRendering => {
    if (minimize) return renderSop(pool, atoms, minimalSop(on, feasible, atoms.length))
    const text = root === null ? '(difference not rendered: too many inputs)' : pool.render(root)
    return { text, terms: [text], minimal: false }
  }

  let verdict: RawComparison['verdict']
  if (before === after) verdict = 'UNCHANGED'
  else if (lost === 0 && gained === 0) verdict = 'EQUIVALENT'
  else if (!anyA && anyB) verdict = 'NEVER_FIRES'
  else if (allA && !allB) verdict = 'ALWAYS_FIRES'
  else if (lost > 0 && gained === 0) verdict = 'WEAKENED'
  else if (gained > 0 && lost === 0) verdict = 'STRENGTHENED'
  else verdict = 'MIXED'

  const result: RawComparison = {
    verdict,
    exhaustive: true,
    checked,
    atoms,
    before: render(onB, before),
    after: render(onA, after),
    beforeSatisfiable: anyB,
    afterSatisfiable: anyA,
  }
  if (lost > 0) {
    const on = new Set([...onB].filter((k) => !onA.has(k)))
    result.lost = render(on, null)
  }
  if (gained > 0) {
    const on = new Set([...onA].filter((k) => !onB.has(k)))
    result.gained = render(on, null)
  }
  const w = lost > 0 ? wit.lost : wit.gained
  if (w) {
    const m = new Map<number, boolean>()
    for (const at of atoms) m.set(at, w.bits[at] === 1)
    result.witness = { values: m, before: lost > 0, after: lost === 0 }
  }
  return result
}

/** Is the condition satisfiable / a tautology? (bounded; null when undecided) */
export function satisfiability(pool: ExprPool, root: number, bounds: Bounds = DEFAULT_BOUNDS): { any: boolean; all: boolean } | null {
  if (root === pool.TRUE) return { any: true, all: true }
  if (root === pool.FALSE) return { any: false, all: false }
  const atoms = pool.atomsOf([root])
  const space = buildSpace(pool, atoms)
  if (space.total > bounds.maxAssignments) return null
  const values = new Uint8Array(pool.atoms.length)
  const ev = pool.evaluator([root])
  let any = false
  let all = true
  forEachAssignment(space, values, () => {
    const [v] = ev(values) as [boolean]
    any ||= v
    all &&= v
  })
  return { any, all }
}

/* ------------------------------------------------------- Quine-McCluskey */

interface Implicant {
  value: number
  /** Bits that are "don't care" in this implicant. */
  mask: number
}

/**
 * Minimal-ish sum of products: prime implicants by Quine-McCluskey (with
 * infeasible assignments as don't-cares), then essential primes plus a
 * deterministic greedy cover. Returns implicants over `n` variables.
 */
export function minimalSop(on: Set<number>, feasible: Set<number>, n: number): Implicant[] {
  if (on.size === 0) return []
  const full = (1 << n) - 1
  const dc: number[] = []
  for (let k = 0; k <= full; k++) if (!feasible.has(k)) dc.push(k)
  if (on.size + dc.length === full + 1) return [{ value: 0, mask: full }]

  let current = new Map<string, Implicant>()
  for (const k of [...on, ...dc]) current.set(`${k}/0`, { value: k, mask: 0 })
  const primes: Implicant[] = []
  while (current.size) {
    const next = new Map<string, Implicant>()
    const used = new Set<string>()
    const byMask = new Map<number, Implicant[]>()
    for (const imp of current.values()) {
      const list = byMask.get(imp.mask)
      if (list) list.push(imp)
      else byMask.set(imp.mask, [imp])
    }
    for (const list of byMask.values()) {
      const values = new Set(list.map((x) => x.value))
      for (const imp of list) {
        for (let b = 0; b < n; b++) {
          const bit = 1 << b
          if (imp.mask & bit || imp.value & bit) continue
          const partner = imp.value | bit
          if (!values.has(partner)) continue
          const merged = { value: imp.value, mask: imp.mask | bit }
          next.set(`${merged.value}/${merged.mask}`, merged)
          used.add(`${imp.value}/${imp.mask}`)
          used.add(`${partner}/${imp.mask}`)
        }
      }
    }
    for (const [key, imp] of current) if (!used.has(key)) primes.push(imp)
    current = next
  }

  const covers = (imp: Implicant, k: number) => (k & ~imp.mask) === (imp.value & ~imp.mask)
  const literals = (imp: Implicant) => n - popcount(imp.mask)
  const uncovered = new Set(on)
  const chosen: Implicant[] = []
  // Essential primes: the only prime covering some minterm.
  for (const k of on) {
    const cover = primes.filter((p) => covers(p, k))
    if (cover.length === 1 && !chosen.includes(cover[0]!)) chosen.push(cover[0]!)
  }
  for (const p of chosen) for (const k of [...uncovered]) if (covers(p, k)) uncovered.delete(k)
  const candidates = primes.filter((p) => !chosen.includes(p))
  while (uncovered.size) {
    let best: Implicant | null = null
    let bestCount = -1
    for (const p of candidates) {
      let c = 0
      for (const k of uncovered) if (covers(p, k)) c++
      if (c === 0) continue
      if (
        c > bestCount ||
        (c === bestCount && best && (literals(p) < literals(best) || (literals(p) === literals(best) && p.value + p.mask * 4096 < best.value + best.mask * 4096)))
      ) {
        best = p
        bestCount = c
      }
    }
    if (!best) break
    chosen.push(best)
    for (const k of [...uncovered]) if (covers(best, k)) uncovered.delete(k)
  }
  return chosen
}

function popcount(x: number): number {
  let c = 0
  while (x) {
    x &= x - 1
    c++
  }
  return c
}

export function renderSop(pool: ExprPool, atoms: number[], implicants: Implicant[]): ConditionRendering {
  if (implicants.length === 0) return { text: 'never', terms: [], minimal: true }
  const n = atoms.length
  const terms = implicants.map((imp) => {
    const lits: string[] = []
    for (let i = 0; i < n; i++) {
      const bit = 1 << i
      if (imp.mask & bit) continue
      const atom = pool.atoms[atoms[i]!]!
      lits.push(imp.value & bit ? atom.label : negatedLabel(atom))
    }
    return { lits, text: lits.length ? lits.join(' AND ') : 'always' }
  })
  terms.sort((a, b) => a.lits.length - b.lits.length || a.text.localeCompare(b.text))
  if (terms.length === 1 && terms[0]!.lits.length === 0) return { text: 'always', terms: ['always'], minimal: true }
  return { text: factorText(terms.map((t) => t.lits)), terms: terms.map((t) => t.text), minimal: true }
}

/**
 * Display-only factoring of a sum of products: literals shared by several
 * products are pulled out, so "(A AND X) OR (B AND X) OR C" reads
 * "C OR ((A OR B) AND X)". The underlying product terms are unchanged.
 */
export function factorText(products: string[][], depth = 0): string {
  const joinOr = (parts: string[]) => parts.join(' OR ')
  const andText = (lits: string[]) => lits.join(' AND ')
  if (products.length === 1) return andText(products[0]!)
  if (depth < 3) {
    const counts = new Map<string, number>()
    for (const p of products) if (p.length > 1) for (const l of p) counts.set(l, (counts.get(l) ?? 0) + 1)
    let best: string | null = null
    let bestN = 1
    for (const [l, n] of counts) if (n > bestN || (n === bestN && best !== null && l < best)) {
      if (n > 1) {
        best = l
        bestN = n
      }
    }
    if (best !== null) {
      const withL = products.filter((p) => p.length > 1 && p.includes(best!))
      const without = products.filter((p) => !(p.length > 1 && p.includes(best!)))
      const inner = factorText(withL.map((p) => p.filter((l) => l !== best)), depth + 1)
      const factored = `(${inner}) AND ${best}`
      const rest = without.map((p) => (p.length > 1 ? `(${andText(p)})` : andText(p)))
      return rest.length ? joinOr([...rest, withL.length === products.length ? factored : `(${factored})`]) : factored
    }
  }
  return joinOr(products.map((p) => (p.length > 1 ? `(${andText(p)})` : andText(p))))
}
