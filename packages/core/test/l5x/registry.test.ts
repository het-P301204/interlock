import { describe, expect, it } from 'vitest'
import { PARSER_VERSION, l5xAdapter } from '../../src/adapters/l5x/index.ts'
import { ADAPTERS, detectAdapter, fileExtension, parseProjectText } from '../../src/adapters/registry.ts'
import { ProjectParseError } from '../../src/adapters/types.ts'
import { NORTHGATE_SAMPLE } from './sample.ts'

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof ProjectParseError) return e.code
    throw e
  }
  return 'NO_ERROR'
}

const PLCOPEN = '<?xml version="1.0" encoding="utf-8"?>\n<project xmlns="http://www.plcopen.org/xml/tc6_0201"><fileHeader companyName="x"/></project>'
const SIEMENS = '<?xml version="1.0" encoding="utf-8"?>\n<Document>\n<Engineering version="V18" />\n<SW.Blocks.FB ID="0"/></Document>'
const SCHNEIDER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<FEFExchangeFile><fileHeader company="x"/></FEFExchangeFile>'

describe('adapter registry', () => {
  it('lists the supported L5X adapter first, then the planned formats', () => {
    expect(ADAPTERS.map((a) => [a.id, a.format, a.status])).toEqual([
      ['rockwell-l5x', 'L5X', 'SUPPORTED'],
      ['plcopen-xml', 'PLCOPEN_XML', 'PLANNED'],
      ['siemens-tia-openness', 'SIEMENS_TIA_XML', 'PLANNED'],
      ['schneider-xef', 'SCHNEIDER_XEF', 'PLANNED'],
    ])
    expect(ADAPTERS[0]).toBe(l5xAdapter)
    expect(l5xAdapter.version).toBe(PARSER_VERSION)
  })

  it('detects L5X by extension (any case) or by the root element', () => {
    expect(detectAdapter('plant.L5X', '')?.id).toBe('rockwell-l5x')
    expect(detectAdapter('plant.l5x', '')?.id).toBe('rockwell-l5x')
    expect(detectAdapter('export.xml', NORTHGATE_SAMPLE.slice(0, 4096))?.id).toBe('rockwell-l5x')
  })

  it('detects planned formats by content', () => {
    expect(detectAdapter('p.xml', PLCOPEN)?.id).toBe('plcopen-xml')
    expect(detectAdapter('s.xml', SIEMENS)?.id).toBe('siemens-tia-openness')
    expect(detectAdapter('u.xef', SCHNEIDER)?.id).toBe('schneider-xef')
    expect(detectAdapter('x.xml', '<root/>')).toBeNull()
  })

  it('parses an L5X and reports the adapter used', () => {
    const { project, adapter } = parseProjectText('northgate.L5X', NORTHGATE_SAMPLE)
    expect(adapter.id).toBe('rockwell-l5x')
    expect(project.metadata.controllerName).toBe('NORTHGATE_PS')
  })

  it.each([
    ['PLCopen XML', 'p.xml', PLCOPEN],
    ['Siemens TIA Portal Openness XML', 's.xml', SIEMENS],
    ['Schneider EcoStruxure Control Expert / Unity Pro XEF', 'u.xef', SCHNEIDER],
  ])('declines %s honestly with FORMAT_NOT_SUPPORTED', (label, name, text) => {
    let err: unknown
    try {
      parseProjectText(name, text)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ProjectParseError)
    expect((err as ProjectParseError).code).toBe('FORMAT_NOT_SUPPORTED')
    expect((err as ProjectParseError).message).toBe(
      `Detected ${label}. INTERLOCK does not parse this format yet; it is on the roadmap. Export the project as Rockwell L5X to analyze it today.`,
    )
  })

  it('rejects disallowed extensions before looking at content', () => {
    for (const name of ['plant.txt', 'plant.ACD', 'plant.l5x.exe', 'plant', '.l5x', 'C:\\dir.l5x\\file']) {
      expect(codeOf(() => parseProjectText(name, NORTHGATE_SAMPLE))).toBe('EXTENSION_NOT_ALLOWED')
    }
    expect(codeOf(() => parseProjectText('dir/plant.L5X', NORTHGATE_SAMPLE))).toBe('NO_ERROR')
  })

  it('throws FORMAT_UNRECOGNIZED for an allowed extension with unknown content', () => {
    expect(codeOf(() => parseProjectText('config.xml', '<?xml version="1.0"?><Settings/>'))).toBe('FORMAT_UNRECOGNIZED')
  })

  it('passes parse options (limits) through', () => {
    expect(codeOf(() => parseProjectText('northgate.L5X', NORTHGATE_SAMPLE, { limits: { maxDepth: 4 } }))).toBe('XML_TOO_DEEP')
  })

  it('extracts extensions', () => {
    expect(fileExtension('a/b/c.L5X')).toBe('.l5x')
    expect(fileExtension('a\\b.XML')).toBe('.xml')
    expect(fileExtension('noext')).toBe('')
    expect(fileExtension('.hidden')).toBe('')
  })
})
