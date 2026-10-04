import { describe, expect, it } from 'vitest'
import { parseRung, renderRung, splitTagRef, parseNumericLiteral } from '../../src/logic/rll.ts'
import { ExprPool } from '../../src/logic/expr.ts'
import { compareConditions, satisfiability } from '../../src/logic/truth.ts'
import { sha256Text } from '../../src/util/sha256.ts'

describe('sha256', () => {
  it('matches FIPS 180-4 test vectors', () => {
    expect(sha256Text('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
    expect(sha256Text('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })
})

describe('parseRung', () => {
  it('parses series, branches and output branches with Logix spacing', () => {
    const r = parseRung('XIC(A)[XIO(B) ,XIC(C) ]OTE(D);')
    expect(r.errors).toEqual([])
    expect(renderRung(r.elements)).toBe('XIC(A)[XIO(B),XIC(C)]OTE(D);')
  })

  it('keeps commas inside array indices and nested parentheses in one operand', () => {
    const r = parseRung('CPT(Dest,A*(B+C))MOV(Tbl[3,1],X);')
    expect(r.errors).toEqual([])
    const [cpt, mov] = r.elements as Array<{ operands: string[] }>
    expect(cpt!.operands).toEqual(['Dest', 'A*(B+C)'])
    expect(mov!.operands).toEqual(['Tbl[3,1]', 'X'])
  })

  it('parses nested branches and AOI calls', () => {
    const r = parseRung('[XIC(A) [XIC(B) ,XIC(C) ] ,XIC(D) ]AOI_X(I1,A,B,Q);')
    expect(r.errors).toEqual([])
    expect(renderRung(r.elements)).toBe('[XIC(A)[XIC(B),XIC(C)],XIC(D)]AOI_X(I1,A,B,Q);')
  })

  it('reports malformed rungs without throwing', () => {
    for (const bad of ['XIC(A', 'XIC(A)]OTE(B);', '[XIC(A),XIC(B)OTE(C);', 'XIC A;', 'XIC(A);OTE(B)', '@@@']) {
      const r = parseRung(bad)
      expect(r.errors.length, bad).toBeGreaterThan(0)
    }
  })

  it('accepts an empty rung', () => {
    expect(parseRung(';').errors).toEqual([])
  })
})

describe('tag references and literals', () => {
  it('splits members, program scope and I/O paths', () => {
    expect(splitTagRef('PUMP_01_IL.Shutdown_Alarm')).toEqual({ base: 'PUMP_01_IL', member: 'Shutdown_Alarm' })
    expect(splitTagRef('\\Safety.Trip_Bit')).toEqual({ base: 'Trip_Bit', member: '', program: 'Safety' })
    expect(splitTagRef('Local:3:I.Data.4')).toEqual({ base: 'Local:3:I', member: 'Data.4' })
  })
  it('parses Logix numeric literals', () => {
    expect(parseNumericLiteral('12.0')).toBe(12)
    expect(parseNumericLiteral('16#FF')).toBe(255)
    expect(parseNumericLiteral('1_000')).toBe(1000)
    expect(parseNumericLiteral('Level_PV')).toBeNull()
  })
})

describe('truth-table comparison', () => {
  const setup = () => {
    const p = new ExprPool()
    const atom = (name: string) => p.atom({ key: `tag:c:${name.toLowerCase()}`, label: name, kind: 'tag', tag: name })
    return { p, atom }
  }

  it('detects a new inhibit term as WEAKENED with a witness', () => {
    const { p, atom } = setup()
    const ph = atom('Pressure_High')
    const se = atom('Safety_Enable')
    const mm = atom('Maintenance_Mode')
    const before = p.and(ph, se)
    const after = p.and(ph, se, p.not(mm))
    const c = compareConditions(p, before, after)
    expect(c.verdict).toBe('WEAKENED')
    expect(c.before.text).toBe('Pressure_High AND Safety_Enable')
    expect(c.after.text).toBe('Pressure_High AND Safety_Enable AND NOT Maintenance_Mode')
    expect(c.lost!.text).toBe('Pressure_High AND Safety_Enable AND Maintenance_Mode')
    expect([...c.witness!.values.entries()].filter(([, v]) => v).length).toBe(3)
  })

  it('classifies an extra trip cause as STRENGTHENED and a reorder as EQUIVALENT', () => {
    const { p, atom } = setup()
    const a = atom('A')
    const b = atom('B')
    const c = atom('C')
    expect(compareConditions(p, p.or(a, b), p.or(a, b, c)).verdict).toBe('STRENGTHENED')
    // Same function, different structure: (A AND B) OR (A AND C) vs A AND (B OR C)
    expect(compareConditions(p, p.or(p.and(a, b), p.and(a, c)), p.and(a, p.or(b, c))).verdict).toBe('EQUIVALENT')
    expect(compareConditions(p, p.and(a, b), p.and(b, a)).verdict).toBe('UNCHANGED')
  })

  it('reasons about setpoints on the same tag', () => {
    const p = new ExprPool()
    const gt = (v: number) =>
      p.atom({
        key: `cmp:c:level_pv:GT:${v}`,
        label: `Level_PV > ${v.toFixed(1)}`,
        kind: 'comparison',
        numeric: { subject: 'tag:c:level_pv', subjectLabel: 'Level_PV', op: 'GT', value: v, integer: false },
      })
    const c = compareConditions(p, gt(85), gt(95))
    expect(c.verdict).toBe('WEAKENED')
    expect(c.lost!.text).toBe('Level_PV > 85.0 AND Level_PV <= 95.0')
    expect(c.after.text).toBe('Level_PV > 95.0')
    expect(compareConditions(p, gt(95), gt(85)).verdict).toBe('STRENGTHENED')
  })

  it('reports NEVER_FIRES and NOT_DECIDED honestly', () => {
    const { p, atom } = setup()
    const a = atom('A')
    expect(compareConditions(p, a, p.FALSE).verdict).toBe('NEVER_FIRES')
    const many = Array.from({ length: 24 }, (_, i) => atom(`X${i}`))
    const r = compareConditions(p, p.and(...many), p.or(...many), { maxAssignments: 1 << 16, maxMinimizeAtoms: 12 })
    expect(r.verdict).toBe('NOT_DECIDED')
    expect(r.exhaustive).toBe(false)
    expect(r.reason).toMatch(/bound/)
  })

  it('simplifies complements and constants', () => {
    const { p, atom } = setup()
    const a = atom('A')
    expect(p.and(a, p.not(a))).toBe(p.FALSE)
    expect(p.or(a, p.not(a))).toBe(p.TRUE)
    expect(p.not(p.not(a))).toBe(a)
    expect(satisfiability(p, p.and(a, p.not(a)))).toEqual({ any: false, all: false })
  })
})
