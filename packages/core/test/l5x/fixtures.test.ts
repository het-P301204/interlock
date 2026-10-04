import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseProjectText } from '../../src/adapters/registry.ts'
import { decodeProjectBytes } from '../../src/util/decode.ts'

const dir = new URL('../../../../fixtures/l5x/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.l5x')).sort()

function load(name: string) {
  return parseProjectText(name, decodeProjectBytes(readFileSync(new URL(name, dir)))).project
}

describe('generated L5X fixtures', () => {
  it('exist', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s parses with no error or warning diagnostics', (name) => {
    const project = load(name)
    expect(project.metadata.format).toBe('L5X')
    expect(project.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    expect(project.programs.length).toBeGreaterThan(0)
    expect(project.tasks.length).toBeGreaterThan(0)
    expect(project.modules.some((m) => m.name === 'AOI_PumpInterlock')).toBe(true)
    for (const r of project.routines) {
      if (r.kind === 'RLL' && !r.protected) for (const rung of r.rungs) expect(rung.text.length).toBeGreaterThan(0)
    }
  })

  it('reads LocalizedComment rung comments and LocalizedDescription descriptions (site-c-legacy)', () => {
    if (!files.includes('site-c-legacy.L5X')) return
    const project = load('site-c-legacy.L5X')
    expect(project.routines.flatMap((r) => r.rungs).filter((r) => r.comment !== undefined).length).toBeGreaterThan(0)
    expect(project.tags.filter((t) => t.description !== undefined).length).toBeGreaterThan(0)
    expect(project.modules.map((m) => [m.name, m.revision])).toContainEqual(['AOI_PumpInterlock', '3.1'])
  })

  it('baseline-large has 24 AOI_PumpInterlock instances', () => {
    if (!files.includes('baseline-large.L5X')) return
    const project = load('baseline-large.L5X')
    expect(project.tags.filter((t) => t.dataType === 'AOI_PumpInterlock')).toHaveLength(24)
  })
})
