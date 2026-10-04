import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ProjectParseError } from '../../src/adapters/types.ts'
import { parseProjectText } from '../../src/adapters/registry.ts'
import { parseXml, serializeXml } from '../../src/xml/index.ts'
import type { XmlElement } from '../../src/xml/index.ts'
import { NORTHGATE_SAMPLE } from '../l5x/sample.ts'

/** Either succeeds or throws a ProjectParseError that is not an internal error. */
function assertOnlyProjectParseError(fn: () => unknown): void {
  try {
    fn()
  } catch (e) {
    if (!(e instanceof ProjectParseError)) throw new Error(`non-ProjectParseError thrown: ${String(e)}`, { cause: e })
    if (e.code.endsWith('_INTERNAL_ERROR')) throw new Error(`internal error: ${e.message}`, { cause: e })
    if (typeof e.message !== 'string' || e.message.length === 0) throw new Error('empty error message', { cause: e })
  }
}

const XML_TOKENS = [
  '<', '>', '/', '/>', '</', '=', '"', "'", ' ', '\n', '\r\n', '\t', '&', ';', '#', 'x', '&#', '&#x', '&amp;', '&lt;', '&bogus;',
  'a', 'b', 'Tag', 'Name', '<a>', '</a>', '<b x="1">', '</b>', '<a/>', '<![CDATA[', ']]>', ']]', '<!--', '-->', '<?', '?>',
  '<?xml version="1.0"?>', '<!DOCTYPE', '<!ENTITY', '[', ']', '%', '__proto__', 'constructor', '1', '0x', 'é', '日',
  String.fromCodePoint(0x1f600), String.fromCharCode(0xd800), String.fromCharCode(0xdc00), String.fromCodePoint(0x202e),
  String.fromCharCode(0), String.fromCharCode(0xfeff), String.fromCharCode(0xffff),
]

describe('parseXml: never throws anything but ProjectParseError', () => {
  it('on arbitrary strings (including lone surrogates and control characters)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (s) => {
        assertOnlyProjectParseError(() => parseXml(s))
        assertOnlyProjectParseError(() => parseXml('<a>' + s + '</a>'))
      }),
      { numRuns: 1500 },
    )
  })

  it('on token soups that look like XML', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...XML_TOKENS), { maxLength: 80 }), (tokens) => {
        assertOnlyProjectParseError(() => parseXml(tokens.join('')))
      }),
      { numRuns: 3000 },
    )
  })

  it('under tight limits', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...XML_TOKENS), { maxLength: 60 }),
        fc.record({
          maxChars: fc.integer({ min: 0, max: 200 }),
          maxDepth: fc.integer({ min: 0, max: 5 }),
          maxElements: fc.integer({ min: 0, max: 5 }),
          maxAttributesPerElement: fc.integer({ min: 0, max: 3 }),
          maxAttributeValueLength: fc.integer({ min: 0, max: 5 }),
          maxTextLength: fc.integer({ min: 0, max: 5 }),
        }),
        (tokens, limits) => {
          assertOnlyProjectParseError(() => parseXml(tokens.join(''), limits))
        },
      ),
      { numRuns: 1500 },
    )
  })
})

// ---------------------------------------------------------------- mutated L5X

type Mutation =
  | { kind: 'delete'; at: number; len: number }
  | { kind: 'insert'; at: number; text: string }
  | { kind: 'duplicate'; at: number; len: number }
  | { kind: 'replace'; at: number; text: string }

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({ kind: fc.constant('delete' as const), at: fc.nat(), len: fc.integer({ min: 1, max: 200 }) }),
  fc.record({ kind: fc.constant('insert' as const), at: fc.nat(), text: fc.oneof(fc.constantFrom(...XML_TOKENS), fc.string({ unit: 'binary', maxLength: 8 })) }),
  fc.record({ kind: fc.constant('duplicate' as const), at: fc.nat(), len: fc.integer({ min: 1, max: 400 }) }),
  fc.record({ kind: fc.constant('replace' as const), at: fc.nat(), text: fc.constantFrom(...XML_TOKENS) }),
)

function mutate(base: string, mutations: Mutation[]): string {
  let s = base
  for (const m of mutations) {
    const at = s.length === 0 ? 0 : m.at % s.length
    switch (m.kind) {
      case 'delete':
        s = s.slice(0, at) + s.slice(at + m.len)
        break
      case 'insert':
        s = s.slice(0, at) + m.text + s.slice(at)
        break
      case 'duplicate':
        s = s.slice(0, at + m.len) + s.slice(at, at + m.len) + s.slice(at + m.len)
        break
      case 'replace':
        s = s.slice(0, at) + m.text + s.slice(at + m.text.length)
        break
    }
  }
  return s
}

describe('L5X adapter: mutated valid exports never throw anything but ProjectParseError', () => {
  it('on random mutations of the Northgate sample', () => {
    fc.assert(
      fc.property(fc.array(mutationArb, { minLength: 1, maxLength: 4 }), (mutations) => {
        const text = mutate(NORTHGATE_SAMPLE, mutations)
        assertOnlyProjectParseError(() => parseProjectText('northgate.L5X', text))
      }),
      { numRuns: 1500 },
    )
  })

  it('on attribute values and names replaced with hostile strings', () => {
    const slots = ['Name="Safety"', 'Name="Pump_01_Run_Enable"', 'Type="RLL"', 'Usage="Input"', 'Number="1"', 'ExternalAccess="Read Only"', 'Format="Decorated"']
    fc.assert(
      fc.property(fc.constantFrom(...slots), fc.string({ unit: 'binary', maxLength: 30 }), (slot, value) => {
        const attrName = slot.slice(0, slot.indexOf('='))
        const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
        const text = NORTHGATE_SAMPLE.replace(slot, `${attrName}="${escaped}"`)
        assertOnlyProjectParseError(() => parseProjectText('northgate.L5X', text))
      }),
      { numRuns: 800 },
    )
  })
})

// ---------------------------------------------------------------- round trip

interface Node {
  name: string
  attrs: [string, string][]
  text: string
  children: Node[]
}

const nameArb = fc.constantFrom('a', 'Tag', 'Rung', 'x:y', 'n-1', 'n.2', '_u', 'Ünï', 'RLLContent')
const attrNameArb = fc.constantFrom('Name', 'Number', 'Type', '__proto__', 'constructor', 'toString', 'a:b', 'x-y', '_z')
// Characters legal in XML 1.0, including ones the serializer must escape.
const xmlCharArb = fc.oneof(
  fc.constantFrom('<', '>', '&', '"', "'", '\r', '\n', '\t', ' ', ']', ']]>', '日', 'é', String.fromCodePoint(0x1f600), String.fromCodePoint(0x202e)),
  fc.string({ unit: 'grapheme-ascii', maxLength: 3 }).filter((s) => [...s].every((ch) => isLegalXmlChar(ch.codePointAt(0) ?? 0))),
)

function isLegalXmlChar(cp: number): boolean {
  return cp === 9 || cp === 10 || cp === 13 || cp >= 0x20
}
const textArb = fc.array(xmlCharArb, { maxLength: 8 }).map((parts) => parts.join(''))

function nodeArb(depth: number): fc.Arbitrary<Node> {
  return fc.record({
    name: nameArb,
    attrs: fc.uniqueArray(fc.tuple(attrNameArb, textArb), { selector: (t) => t[0], maxLength: 4 }),
    text: textArb,
    children: depth <= 0 ? fc.constant<Node[]>([]) : fc.array(nodeArb(depth - 1), { maxLength: 3 }),
  })
}

function toElement(n: Node): XmlElement {
  const attrs = Object.create(null) as Record<string, string>
  for (const [k, v] of n.attrs) attrs[k] = v
  return { name: n.name, attrs, text: n.text, children: n.children.map(toElement), line: 0, column: 0, path: '', location: '' }
}

function shape(el: XmlElement): unknown {
  return { name: el.name, attrs: Object.entries(el.attrs), text: el.text, children: el.children.map(shape) }
}

describe('serialize -> parse round trip', () => {
  it('preserves names, attributes (in order), text and children', () => {
    fc.assert(
      fc.property(nodeArb(4), (node) => {
        const el = toElement(node)
        const parsed = parseXml(serializeXml(el))
        expect(shape(parsed)).toEqual(shape(el))
      }),
      { numRuns: 1000 },
    )
  })

  it('is stable: parse(serialize(parse(x))) equals parse(x)', () => {
    const once = parseXml(NORTHGATE_SAMPLE)
    const twice = parseXml(serializeXml(once))
    expect(shape(twice)).toEqual(shape(once))
  })
})
