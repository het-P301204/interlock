import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { l5xAdapter } from '../../src/adapters/l5x/index.ts'
import { parseProjectText } from '../../src/adapters/registry.ts'
import { ProjectParseError } from '../../src/adapters/types.ts'
import type { ParsedProject } from '../../src/model/project.ts'
import { decodeProjectBytes } from '../../src/util/decode.ts'

const dir = new URL('../../../../fixtures/adversarial/', import.meta.url)

/** Expected error code per file; null = must parse. */
const EXPECTED: Record<string, string | null> = {
  'xxe-external-entity.L5X': 'XML_DOCTYPE_FORBIDDEN',
  'billion-laughs.L5X': 'XML_DOCTYPE_FORBIDDEN',
  'xxe-parameter-entity.L5X': 'XML_DOCTYPE_FORBIDDEN',
  'truncated.L5X': 'XML_UNCLOSED_TAG',
  'wrong-root.xml': 'L5X_WRONG_ROOT',
  'mismatched-tags.L5X': 'XML_MISMATCHED_TAG',
  'duplicate-attribute.L5X': 'XML_DUPLICATE_ATTRIBUTE',
  'unterminated-cdata.L5X': 'XML_UNTERMINATED_CDATA',
  'invalid-utf8.L5X': 'ENCODING_INVALID',
  'bidi-tag-name.L5X': null,
  'not-xml.L5X': 'XML_NOT_XML',
  'plcopen-sample.xml': 'FORMAT_NOT_SUPPORTED',
  'unknown-entity.L5X': 'XML_UNKNOWN_ENTITY',
  'deep-nesting.L5X': 'XML_TOO_DEEP',
  'missing-program-name.L5X': 'L5X_MISSING_NAME',
  'prototype-attributes.L5X': null,
}

function ingest(name: string): ParsedProject {
  const bytes = readFileSync(new URL(name, dir))
  return parseProjectText(name, decodeProjectBytes(new Uint8Array(bytes))).project
}

function outcome(name: string): string {
  try {
    ingest(name)
    return 'OK'
  } catch (e) {
    if (e instanceof ProjectParseError) return e.code
    throw e
  }
}

describe('adversarial fixtures', () => {
  it('every file in fixtures/adversarial has an expectation (and every expectation a file)', () => {
    const files = readdirSync(dir).filter((f) => f !== 'README.md' && f !== 'generate.ts').sort()
    expect(files).toEqual(Object.keys(EXPECTED).sort())
  })

  it('the README documents every file', () => {
    const readme = readFileSync(new URL('README.md', dir), 'utf8')
    for (const name of Object.keys(EXPECTED)) expect(readme).toContain(`\`${name}\``)
  })

  it.each(Object.entries(EXPECTED).filter(([, code]) => code !== null))('%s is refused with %s', (name, code) => {
    expect(outcome(name)).toBe(code)
  })

  it('refusals carry a readable message and a location', () => {
    for (const [name, code] of Object.entries(EXPECTED)) {
      if (code === null) continue
      try {
        ingest(name)
      } catch (e) {
        const err = e as ProjectParseError
        expect(err.message.length).toBeGreaterThan(20)
        expect(err.location).toBeTypeOf('string')
      }
    }
  })

  it('XXE files never leak entity content: the DOCTYPE is refused at its own position', () => {
    for (const name of ['xxe-external-entity.L5X', 'xxe-parameter-entity.L5X', 'billion-laughs.L5X']) {
      try {
        ingest(name)
      } catch (e) {
        const err = e as ProjectParseError
        expect(err.source?.line).toBe(2)
        expect(err.message).not.toContain('root:')
      }
    }
  })

  it('wrong-root.xml fails on the root even through the adapter directly', () => {
    const text = readFileSync(new URL('wrong-root.xml', dir), 'utf8')
    try {
      l5xAdapter.parse(text)
      expect.unreachable()
    } catch (e) {
      expect((e as ProjectParseError).code).toBe('L5X_WRONG_ROOT')
      expect((e as ProjectParseError).message).toContain('<Project>')
    }
  })

  it('bidi-tag-name.L5X parses, removes the bidi characters and warns with the tag location', () => {
    const project = ingest('bidi-tag-name.L5X')
    const tag = project.tags.find((t) => t.name === 'MCC_Main_Enable')
    expect(tag?.description).toBe('Main MCC enable elbane ton')
    for (const cp of [0x202e, 0x202c]) expect(tag?.description?.includes(String.fromCodePoint(cp))).toBe(false)
    const warnings = project.diagnostics.filter((d) => d.code === 'TEXT_INVISIBLE_CHARACTERS')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.severity).toBe('warning')
    expect(warnings[0]?.message).toContain('2 invisible or bidirectional control characters')
    expect(warnings[0]?.location).toBe('Controller.Tags.Tag[0].Description (Tag "MCC_Main_Enable")')
  })

  it('prototype-attributes.L5X parses without polluting any prototype', () => {
    const project = ingest('prototype-attributes.L5X')
    expect(project.tags.find((t) => t.name === 'MCC_Main_Enable')?.dataType).toBe('BOOL')
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  it('missing-program-name.L5X points at the program', () => {
    try {
      ingest('missing-program-name.L5X')
    } catch (e) {
      expect((e as ProjectParseError).location).toBe('Controller.Programs.Program[0]')
    }
  })
})
