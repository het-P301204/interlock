/**
 * Boolean expressions as a hash-consed DAG.
 *
 * The symbolic scan builds one expression per storage location, and those
 * expressions share enormous amounts of structure (every AOI instance reuses
 * the same definition logic; every guarded write wraps the previous value).
 * Hash-consing keeps that sharing explicit: equal subexpressions are one node,
 * so memory stays linear and structurally identical conditions compare by id.
 *
 * Constructors simplify as they build: constants fold, nested AND/OR flatten,
 * duplicates and complementary pairs collapse, and arguments are sorted by id
 * so `A AND B` and `B AND A` are the same node.
 */

export type AtomKind = 'tag' | 'member' | 'comparison' | 'previous' | 'opaque' | 'constant-input'

export type CompareOp = 'GT' | 'GE' | 'LT' | 'LE' | 'EQ' | 'NE'

export interface NumericTest {
  /** Atom key of the tag being compared (shared by every test on that tag). */
  subject: string
  subjectLabel: string
  op: CompareOp
  value: number
  integer: boolean
}

export interface RangeTest {
  subject: string
  subjectLabel: string
  low: number
  high: number
  integer: boolean
}

export interface Atom {
  index: number
  /** Canonical, case-insensitive identity, e.g. "tag:c:maintenance_mode". */
  key: string
  label: string
  kind: AtomKind
  /** Base tag name for tag/member/previous atoms. */
  tag?: string
  numeric?: NumericTest
  range?: RangeTest
}

export type ExprNode =
  | { op: 'const'; v: boolean }
  | { op: 'atom'; atom: number }
  | { op: 'not'; a: number }
  | { op: 'and'; args: number[] }
  | { op: 'or'; args: number[] }

export class ExprPool {
  readonly nodes: ExprNode[] = []
  readonly atoms: Atom[] = []
  private readonly nodeKeys = new Map<string, number>()
  private readonly atomKeys = new Map<string, number>()
  private readonly notCache = new Map<number, number>()
  readonly TRUE: number
  readonly FALSE: number

  constructor() {
    this.FALSE = this.intern({ op: 'const', v: false }, 'F')
    this.TRUE = this.intern({ op: 'const', v: true }, 'T')
  }

  private intern(node: ExprNode, key: string): number {
    const hit = this.nodeKeys.get(key)
    if (hit !== undefined) return hit
    const id = this.nodes.length
    this.nodes.push(node)
    this.nodeKeys.set(key, id)
    return id
  }

  node(id: number): ExprNode {
    return this.nodes[id]!
  }

  /** Register (or find) an atom and return its expression node. */
  atom(spec: Omit<Atom, 'index'>): number {
    let index = this.atomKeys.get(spec.key)
    if (index === undefined) {
      index = this.atoms.length
      this.atoms.push({ ...spec, index })
      this.atomKeys.set(spec.key, index)
    }
    return this.intern({ op: 'atom', atom: index }, `a${index}`)
  }

  atomByKey(key: string): Atom | undefined {
    const i = this.atomKeys.get(key)
    return i === undefined ? undefined : this.atoms[i]
  }

  const(v: boolean): number {
    return v ? this.TRUE : this.FALSE
  }

  not(a: number): number {
    if (a === this.TRUE) return this.FALSE
    if (a === this.FALSE) return this.TRUE
    const n = this.nodes[a]!
    if (n.op === 'not') return n.a
    const cached = this.notCache.get(a)
    if (cached !== undefined) return cached
    const id = this.intern({ op: 'not', a }, `!${a}`)
    this.notCache.set(a, id)
    return id
  }

  and(...args: number[]): number {
    return this.nary('and', args)
  }

  or(...args: number[]): number {
    return this.nary('or', args)
  }

  /** if g then t else e */
  ite(g: number, t: number, e: number): number {
    if (g === this.TRUE || t === e) return t
    if (g === this.FALSE) return e
    if (t === this.TRUE && e === this.FALSE) return g
    if (t === this.FALSE && e === this.TRUE) return this.not(g)
    return this.or(this.and(g, t), this.and(this.not(g), e))
  }

  private nary(op: 'and' | 'or', input: number[]): number {
    const absorbing = op === 'and' ? this.FALSE : this.TRUE
    const identity = op === 'and' ? this.TRUE : this.FALSE
    const set = new Set<number>()
    const stack = [...input]
    while (stack.length) {
      const a = stack.pop()!
      if (a === absorbing) return absorbing
      if (a === identity) continue
      const n = this.nodes[a]!
      if (n.op === op) {
        for (const x of n.args) stack.push(x)
        continue
      }
      set.add(a)
    }
    if (set.size === 0) return identity
    for (const a of set) {
      const n = this.nodes[a]!
      const complement = n.op === 'not' ? n.a : this.notCache.get(a)
      if (complement !== undefined && set.has(complement)) return absorbing
    }
    const args = [...set].sort((x, y) => x - y)
    if (args.length === 1) return args[0]!
    return this.intern({ op, args }, `${op === 'and' ? '&' : '|'}${args.join(',')}`)
  }

  /**
   * The expression with one atom fixed to a value (Shannon cofactor). Used to
   * prove an inhibit: if fixing a new term X to 0 restores the baseline
   * condition exactly, then X = 1 is what suppresses the function.
   */
  restrict(root: number, atomIndex: number, value: boolean): number {
    const memo = new Map<number, number>()
    const order: number[] = []
    const seen = new Set<number>()
    const stack: Array<[number, boolean]> = [[root, false]]
    while (stack.length) {
      const [id, done] = stack.pop()!
      if (done) {
        order.push(id)
        continue
      }
      if (seen.has(id)) continue
      seen.add(id)
      stack.push([id, true])
      const n = this.nodes[id]!
      if (n.op === 'not') stack.push([n.a, false])
      else if (n.op === 'and' || n.op === 'or') for (const a of n.args) stack.push([a, false])
    }
    for (const id of order) {
      const n = this.nodes[id]!
      let r: number
      switch (n.op) {
        case 'const':
          r = id
          break
        case 'atom':
          r = n.atom === atomIndex ? this.const(value) : id
          break
        case 'not':
          r = this.not(memo.get(n.a)!)
          break
        case 'and':
          r = this.and(...n.args.map((a) => memo.get(a)!))
          break
        case 'or':
          r = this.or(...n.args.map((a) => memo.get(a)!))
          break
      }
      memo.set(id, r)
    }
    return memo.get(root)!
  }

  /** Atom indices reachable from the given roots, in first-visit (left-to-right) order. */
  atomsOf(roots: number[]): number[] {
    const seen = new Set<number>()
    const out: number[] = []
    const outSet = new Set<number>()
    const stack = [...roots].reverse()
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const n = this.nodes[id]!
      if (n.op === 'atom') {
        if (!outSet.has(n.atom)) {
          outSet.add(n.atom)
          out.push(n.atom)
        }
      } else if (n.op === 'not') stack.push(n.a)
      else if (n.op === 'and' || n.op === 'or') for (let i = n.args.length - 1; i >= 0; i--) stack.push(n.args[i]!)
    }
    return out
  }

  /** Number of distinct nodes reachable from a root (a size measure for bounds). */
  size(root: number): number {
    const seen = new Set<number>()
    const stack = [root]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const n = this.nodes[id]!
      if (n.op === 'not') stack.push(n.a)
      else if (n.op === 'and' || n.op === 'or') stack.push(...n.args)
    }
    return seen.size
  }

  /**
   * Evaluate roots under an assignment of atom values (indexed by atom index).
   * Iterative post-order with a per-call memo, so deep DAGs cannot overflow
   * the stack and shared nodes are evaluated once.
   */
  evaluator(roots: number[]): (values: Uint8Array) => boolean[] {
    // Topologically order every node reachable from the roots once.
    const order: number[] = []
    const state = new Map<number, number>()
    for (const r of roots) {
      const stack: Array<[number, boolean]> = [[r, false]]
      while (stack.length) {
        const [id, expanded] = stack.pop()!
        if (expanded) {
          if (state.get(id) !== 2) {
            state.set(id, 2)
            order.push(id)
          }
          continue
        }
        if (state.has(id)) continue
        state.set(id, 1)
        stack.push([id, true])
        const n = this.nodes[id]!
        if (n.op === 'not') stack.push([n.a, false])
        else if (n.op === 'and' || n.op === 'or') for (const a of n.args) stack.push([a, false])
      }
    }
    const pos = new Map<number, number>()
    order.forEach((id, i) => pos.set(id, i))
    const ops = order.map((id) => {
      const n = this.nodes[id]!
      switch (n.op) {
        case 'const':
          return { t: 0, v: n.v ? 1 : 0, a: 0, args: [] as number[] }
        case 'atom':
          return { t: 1, v: 0, a: n.atom, args: [] as number[] }
        case 'not':
          return { t: 2, v: 0, a: pos.get(n.a)!, args: [] as number[] }
        case 'and':
          return { t: 3, v: 0, a: 0, args: n.args.map((x) => pos.get(x)!) }
        case 'or':
          return { t: 4, v: 0, a: 0, args: n.args.map((x) => pos.get(x)!) }
      }
    })
    const rootPos = roots.map((r) => pos.get(r)!)
    const memo = new Uint8Array(order.length)
    return (values) => {
      for (let i = 0; i < ops.length; i++) {
        const o = ops[i]!
        switch (o.t) {
          case 0:
            memo[i] = o.v
            break
          case 1:
            memo[i] = values[o.a]!
            break
          case 2:
            memo[i] = memo[o.a]! ? 0 : 1
            break
          case 3: {
            let r = 1
            for (const x of o.args) if (!memo[x]) { r = 0; break }
            memo[i] = r
            break
          }
          case 4: {
            let r = 0
            for (const x of o.args) if (memo[x]) { r = 1; break }
            memo[i] = r
            break
          }
        }
      }
      return rootPos.map((p) => memo[p] === 1)
    }
  }

  /** Structural rendering (used when a minimal form cannot be computed). */
  render(root: number, maxLength = 600): string {
    const memo = new Map<number, string>()
    const go = (id: number, parent: 'and' | 'or' | 'not' | null): string => {
      const n = this.nodes[id]!
      let s: string
      switch (n.op) {
        case 'const':
          s = n.v ? 'TRUE' : 'FALSE'
          break
        case 'atom':
          s = this.atoms[n.atom]!.label
          break
        case 'not': {
          const inner = this.nodes[n.a]!
          if (inner.op === 'atom') s = negatedLabel(this.atoms[inner.atom]!)
          else s = `NOT (${go(n.a, 'not')})`
          break
        }
        case 'and':
        case 'or': {
          const key = id
          const cached = memo.get(key)
          const body = cached ?? n.args.map((a) => go(a, n.op)).join(n.op === 'and' ? ' AND ' : ' OR ')
          if (cached === undefined) memo.set(key, body)
          s = parent && parent !== n.op ? `(${body})` : body
          break
        }
      }
      return s.length > maxLength ? `${s.slice(0, maxLength)}…` : s
    }
    return go(root, null)
  }
}

const OP_TEXT: Record<CompareOp, string> = { GT: '>', GE: '>=', LT: '<', LE: '<=', EQ: '=', NE: '<>' }
const OP_NEG: Record<CompareOp, CompareOp> = { GT: 'LE', GE: 'LT', LT: 'GE', LE: 'GT', EQ: 'NE', NE: 'EQ' }

export function numericLabel(t: NumericTest, negate = false): string {
  const op = negate ? OP_NEG[t.op] : t.op
  return `${t.subjectLabel} ${OP_TEXT[op]} ${t.integer ? String(t.value) : formatReal(t.value)}`
}

function formatReal(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v)
}

export function rangeLabel(r: RangeTest, negate = false): string {
  const lo = r.integer ? String(r.low) : formatReal(r.low)
  const hi = r.integer ? String(r.high) : formatReal(r.high)
  return negate ? `${r.subjectLabel} outside [${lo}, ${hi}]` : `${r.subjectLabel} within [${lo}, ${hi}]`
}

/** Readable negation of an atom: comparisons flip their relation, others get NOT. */
export function negatedLabel(atom: Atom): string {
  if (atom.numeric) return numericLabel(atom.numeric, true)
  if (atom.range) return rangeLabel(atom.range, true)
  return `NOT ${atom.label}`
}

export function compareTest(op: CompareOp, x: number, c: number): boolean {
  switch (op) {
    case 'GT':
      return x > c
    case 'GE':
      return x >= c
    case 'LT':
      return x < c
    case 'LE':
      return x <= c
    case 'EQ':
      return x === c
    case 'NE':
      return x !== c
  }
}
