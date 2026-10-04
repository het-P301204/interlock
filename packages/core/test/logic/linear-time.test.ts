/**
 * Hostile-length operands must not trigger super-linear regex behaviour.
 * Found by the documentation review: a 40 000-digit operand made one
 * analysis take ~25 s through a backtracking numeric-literal pattern.
 */
import { describe, expect, it } from 'vitest'
import { parseNumericLiteral } from '../../src/logic/rll.ts'
import { stAssignmentTargets } from '../../src/analysis/scan.ts'

describe('linear-time tokenizing', () => {
  it('rejects a 200 000-character digit run quickly', () => {
    const t0 = performance.now()
    expect(parseNumericLiteral(`${'1'.repeat(200_000)}x`)).toBeNull()
    expect(performance.now() - t0).toBeLessThan(200)
  })

  it('still parses ordinary literals', () => {
    expect(parseNumericLiteral('12.0')).toBe(12)
    expect(parseNumericLiteral('-3.5e2')).toBe(-350)
    expect(parseNumericLiteral('.5')).toBe(0.5)
    expect(parseNumericLiteral('16#1F')).toBe(31)
  })

  it('finds structured-text assignment targets in linear time', () => {
    expect(stAssignmentTargets('A := B; Pump.Run:=1; X[2] := 0; IF Y = 1 THEN Z := 2; END_IF;')).toEqual(['A', 'Pump.Run', 'X[2]', 'Z'])
    const t0 = performance.now()
    expect(stAssignmentTargets(`${'a'.repeat(200_000)} + b`)).toEqual([])
    expect(performance.now() - t0).toBeLessThan(200)
  })
})
