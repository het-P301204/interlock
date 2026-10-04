import { describe, expect, it } from 'vitest'
import { parseProjectText } from '../../src/adapters/registry.ts'
import { decodeProjectBytes } from '../../src/util/decode.ts'
import { generateLargeL5x } from './sample.ts'

describe('performance', () => {
  it('decodes and parses a ~20 MB L5X in well under 5 seconds', () => {
    const text = generateLargeL5x(34_000, 180, 240)
    expect(text.length).toBeGreaterThan(19_000_000)
    const bytes = new TextEncoder().encode(text)

    const t0 = performance.now()
    const { project } = parseProjectText('big.L5X', decodeProjectBytes(bytes))
    const elapsed = performance.now() - t0

    expect(project.tags).toHaveLength(34_000)
    expect(project.routines).toHaveLength(180)
    expect(project.routines.reduce((n, r) => n + r.rungs.length, 0)).toBe(180 * 240)
    expect(project.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    expect(project.tags[123]?.value).toBe('123.5')
    expect(elapsed).toBeLessThan(5000)
  }, 60_000)
})
