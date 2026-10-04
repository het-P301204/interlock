/**
 * Hardened, hand-written XML tree builder for PLC project exports.
 *
 * Security posture
 * - Any `<!DOCTYPE` is rejected outright (XML_DOCTYPE_FORBIDDEN). Without a
 *   DTD there are no entity declarations, so XXE (external entities) and
 *   entity-expansion bombs ("billion laughs") are impossible by construction,
 *   not by a limit that might be tuned wrong.
 * - Only the five predefined entities and numeric character references are
 *   decoded; anything else is XML_UNKNOWN_ENTITY.
 * - Every XmlLimits field is enforced with its own error code.
 * - Iterative: no recursion anywhere, so a 100k-deep document produces an
 *   error, never a stack overflow. Linear time: every scan moves forward and
 *   no regular expression is applied to unbounded hostile input.
 * - The only exception that leaves `parseXml` is ProjectParseError.
 */
import { DEFAULT_XML_LIMITS, ProjectParseError } from '../adapters/types.ts'
import type { XmlLimits } from '../adapters/types.ts'
import { cleanText } from '../util/sanitize.ts'
import type { XmlElement } from './types.ts'

const C_TAB = 9
const C_LF = 10
const C_CR = 13
const C_SPACE = 32
const C_BANG = 33
const C_DQUOTE = 34
const C_HASH = 35
const C_AMP = 38
const C_SQUOTE = 39
const C_DASH = 45
const C_DOT = 46
const C_SLASH = 47
const C_SEMI = 59
const C_LT = 60
const C_EQ = 61
const C_GT = 62
const C_QMARK = 63

/** Longest entity/character reference body we look at before giving up (leading zeros included). */
const MAX_REFERENCE_LENGTH = 64

function isWs(c: number): boolean {
  return c === C_SPACE || c === C_LF || c === C_TAB || c === C_CR
}

/** XML 1.0 (5th ed.) NameStartChar, with surrogate halves accepted for supplementary planes. */
function isNameStart(c: number): boolean {
  if (c < 0x80) return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58
  return (
    (c >= 0xc0 && c <= 0xd6) ||
    (c >= 0xd8 && c <= 0xf6) ||
    (c >= 0xf8 && c <= 0x2ff) ||
    (c >= 0x370 && c <= 0x37d) ||
    (c >= 0x37f && c <= 0x1fff) ||
    (c >= 0x200c && c <= 0x200d) ||
    (c >= 0x2070 && c <= 0x218f) ||
    (c >= 0x2c00 && c <= 0x2fef) ||
    (c >= 0x3001 && c <= 0xd7ff) ||
    (c >= 0xd800 && c <= 0xdbff) ||
    (c >= 0xf900 && c <= 0xfdcf) ||
    (c >= 0xfdf0 && c <= 0xfffd)
  )
}

function isNameChar(c: number): boolean {
  if (isNameStart(c)) return true
  if (c < 0x80) return (c >= 48 && c <= 57) || c === C_DASH || c === C_DOT
  return c === 0xb7 || (c >= 0x300 && c <= 0x36f) || (c >= 0x203f && c <= 0x2040) || (c >= 0xdc00 && c <= 0xdfff)
}

/** XML 1.0 Char production. */
export function isXmlChar(cp: number): boolean {
  return (
    cp === C_TAB ||
    cp === C_LF ||
    cp === C_CR ||
    (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0x10ffff)
  )
}

/** True when `s` is a syntactically valid XML Name. */
export function isXmlName(s: string): boolean {
  if (s.length === 0 || !isNameStart(s.charCodeAt(0))) return false
  for (let i = 1; i < s.length; i++) if (!isNameChar(s.charCodeAt(i))) return false
  return true
}

const DISPLAY_LIMIT = 80

/** Make attacker-controlled text safe and short enough to put in a message or location. */
export function displayValue(s: string, limit = DISPLAY_LIMIT): string {
  const short = s.length > limit * 4 ? s.slice(0, limit * 4) : s
  let t = cleanText(short).replace(/[\r\n\t]/g, ' ')
  if (t.length > limit || short.length < s.length) t = t.slice(0, limit) + '…'
  return t
}

function describeChar(c: number): string {
  if (Number.isNaN(c)) return 'end of input'
  if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return `control character U+${c.toString(16).toUpperCase().padStart(4, '0')}`
  if (c === C_DQUOTE) return "'\"'"
  return `"${displayValue(String.fromCharCode(c), 4)}"`
}

/** Quote a value for an XPath predicate (XPath 2.0 style: a quote is doubled). */
function xpathLiteral(v: string): string {
  return "'" + displayValue(v, 256).replace(/'/g, "''") + "'"
}

function isCollection(parentName: string, childName: string): boolean {
  return parentName === childName + 's'
}

function annotationFor(name: string, attrs: Record<string, string>): string {
  const n = attrs['Name']
  if (n !== undefined) return `${name} "${displayValue(n).replace(/"/g, "'")}"`
  const num = attrs['Number']
  if (num !== undefined) return `${name} ${displayValue(num, 16)}`
  return ''
}

function joinAnnot(parent: string, own: string): string {
  if (own === '') return parent
  return parent === '' ? own : parent + ', ' + own
}

function formatLocation(base: string, annot: string): string {
  return annot === '' ? base : `${base} (${annot})`
}

interface Frame {
  el: XmlElement
  /** child element name -> number seen so far (lazily created). */
  counts: Map<string, number> | null
  /** Provisional path and location used for error reporting during the parse. */
  path: string
  locBase: string
  annot: string
}

interface Pending {
  name: string
  index: number
  attrs: Record<string, string>
}

export function resolveLimits(limits?: Partial<XmlLimits>): XmlLimits {
  const out: XmlLimits = { ...DEFAULT_XML_LIMITS }
  if (limits) {
    for (const key of Object.keys(DEFAULT_XML_LIMITS) as (keyof XmlLimits)[]) {
      const v = limits[key]
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = Math.floor(v)
    }
  }
  return out
}

/**
 * Parse `text` into an element tree. Throws ProjectParseError (and nothing
 * else) for any malformed, hostile or over-limit input.
 */
export function parseXml(text: string, limits?: Partial<XmlLimits>): XmlElement {
  const lim = resolveLimits(limits)
  try {
    const root = parseTree(String(text), lim)
    assignPaths(root)
    return root
  } catch (e) {
    if (e instanceof ProjectParseError) throw e
    if (e instanceof RangeError) {
      throw new ProjectParseError('XML_RESOURCE_LIMIT', `The document exceeded an internal resource limit while parsing (${e.message}).`, {
        location: '(document)',
      })
    }
    throw new ProjectParseError('XML_INTERNAL_ERROR', `Internal XML parser error: ${e instanceof Error ? e.message : String(e)}`, {
      location: '(document)',
    })
  }
}

function parseTree(text: string, lim: XmlLimits): XmlElement {
  const n = text.length
  let i = 0
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1

  // ---------------------------------------------------------------- positions
  let lineNo = 1
  let lineStart = 0
  let scanned = 0
  let nextNl = text.indexOf('\n')
  function posAt(idx: number): { line: number; column: number } {
    if (idx < scanned) {
      lineNo = 1
      lineStart = 0
      scanned = 0
      nextNl = text.indexOf('\n')
    }
    while (nextNl !== -1 && nextNl < idx) {
      lineNo++
      lineStart = nextNl + 1
      nextNl = text.indexOf('\n', lineStart)
    }
    scanned = idx
    return { line: lineNo, column: idx - lineStart + 1 }
  }

  // ---------------------------------------------------------------- state
  const stack: Frame[] = []
  let root: XmlElement | null = null
  let rootClosed = false
  let elementCount = 0
  let sawMarkup = false
  let pending: Pending | null = null

  function fail(code: string, message: string, idx: number): never {
    const { line, column } = posAt(Math.min(Math.max(idx, 0), n))
    const top = stack[stack.length - 1]
    let location = '(document)'
    let path = '/'
    if (pending) {
      const seg = pending.name + (pending.index > 0 || (top !== undefined && isCollection(top.el.name, pending.name)) ? `[${pending.index}]` : '')
      const base = top === undefined ? displayValue(pending.name) : top.locBase === '' ? seg : `${top.locBase}.${seg}`
      const own = stack.length >= 2 ? annotationFor(pending.name, pending.attrs) : ''
      location = formatLocation(displayValue(base, 400), joinAnnot(top?.annot ?? '', own))
      path = (top?.path ?? '') + '/' + displayValue(pending.name)
    } else if (top) {
      location = formatLocation(top.locBase === '' ? top.el.name : top.locBase, top.annot)
      path = top.path
    }
    throw new ProjectParseError(code, `${message} (line ${line}, column ${column})`, { location, source: { path, line, column } })
  }

  if (n - i > lim.maxChars) {
    throw new ProjectParseError(
      'XML_TOO_LARGE',
      `The document is ${n - i} characters long; the limit is ${lim.maxChars}.`,
      { location: '(document)' },
    )
  }
  const nul = text.indexOf('\0', i)
  if (nul !== -1) fail('XML_NUL_CHARACTER', 'NUL character (U+0000) in the document; XML forbids it', nul)

  {
    let k = i
    while (k < n && isWs(text.charCodeAt(k))) k++
    if (k >= n) fail('XML_NO_ROOT', 'The document is empty: no root element', k)
    if (text.charCodeAt(k) !== C_LT) fail('XML_NOT_XML', `The file does not look like XML: it starts with ${describeChar(text.charCodeAt(k))} instead of "<"`, k)
  }

  // ---------------------------------------------------------------- helpers
  function skipWs(j: number): number {
    while (j < n && isWs(text.charCodeAt(j))) j++
    return j
  }

  /** Read an XML Name starting at j; returns the index just past it. */
  function readName(j: number, what: string): number {
    const c = text.charCodeAt(j)
    if (j >= n) fail('XML_UNTERMINATED_TAG', `Unexpected end of input while reading ${what} name`, j)
    if (!isNameStart(c)) fail('XML_INVALID_NAME', `Invalid ${what} name: it cannot start with ${describeChar(c)}`, j)
    let k = j + 1
    while (k < n && isNameChar(text.charCodeAt(k))) k++
    return k
  }

  function normalizeLiteral(s: string, isAttr: boolean): string {
    let t = s
    if (t.indexOf('\r') !== -1) t = t.replace(/\r\n?/g, '\n')
    if (isAttr && (t.indexOf('\n') !== -1 || t.indexOf('\t') !== -1)) t = t.replace(/[\n\t]/g, ' ')
    return t
  }

  function resolveReference(body: string, absIdx: number): string {
    switch (body) {
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'amp':
        return '&'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
    }
    if (body.charCodeAt(0) === C_HASH) {
      const hex = body.charCodeAt(1) === 120 // 'x'
      const start = hex ? 2 : 1
      if (body.length <= start) fail('XML_MALFORMED_ENTITY', `Empty character reference "&${displayValue(body)};"`, absIdx)
      let cp = 0
      for (let k = start; k < body.length; k++) {
        const c = body.charCodeAt(k)
        let d: number
        if (c >= 48 && c <= 57) d = c - 48
        else if (hex && c >= 97 && c <= 102) d = c - 87
        else if (hex && c >= 65 && c <= 70) d = c - 55
        else fail('XML_MALFORMED_ENTITY', `Malformed character reference "&${displayValue(body)};"`, absIdx)
        cp = cp * (hex ? 16 : 10) + d
        if (cp > 0x10ffff) fail('XML_INVALID_CHAR_REF', `Character reference "&${displayValue(body)};" is above U+10FFFF`, absIdx)
      }
      if (!isXmlChar(cp)) {
        const u = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')
        fail('XML_INVALID_CHAR_REF', `Character reference "&${displayValue(body)};" (${u}) is not a legal XML character`, absIdx)
      }
      return String.fromCodePoint(cp)
    }
    if (isXmlName(body)) {
      fail(
        'XML_UNKNOWN_ENTITY',
        `Unknown entity "&${displayValue(body)};". Only the five predefined XML entities are allowed; INTERLOCK never processes DTD entity declarations`,
        absIdx,
      )
    }
    fail('XML_MALFORMED_ENTITY', `Malformed entity reference "&${displayValue(body)};"`, absIdx)
  }

  /** Decode character data or an attribute value in text[start, end). */
  function decodeRange(start: number, end: number, isAttr: boolean): string {
    const raw = text.slice(start, end)
    if (raw.indexOf('&') === -1) return normalizeLiteral(raw, isAttr)
    let out = ''
    let lit = 0
    for (;;) {
      const amp = raw.indexOf('&', lit)
      if (amp === -1) break
      out += normalizeLiteral(raw.slice(lit, amp), isAttr)
      let semi = -1
      const limit = Math.min(raw.length, amp + 2 + MAX_REFERENCE_LENGTH)
      for (let q = amp + 1; q < limit; q++) {
        const c = raw.charCodeAt(q)
        if (c === C_SEMI) {
          semi = q
          break
        }
        if (c === C_AMP || c === C_LT || isWs(c)) break
      }
      if (semi === -1) {
        fail('XML_MALFORMED_ENTITY', 'Bare "&" or unterminated entity reference (write "&amp;" for a literal ampersand)', start + amp)
      }
      out += resolveReference(raw.slice(amp + 1, semi), start + amp)
      lit = semi + 1
    }
    out += normalizeLiteral(raw.slice(lit), isAttr)
    return out
  }

  function appendText(frame: Frame, s: string, idx: number): void {
    if (s.length === 0) return
    if (frame.el.text.length + s.length > lim.maxTextLength) {
      fail('XML_TEXT_TOO_LONG', `Text content of <${displayValue(frame.el.name)}> exceeds the limit of ${lim.maxTextLength} characters`, idx)
    }
    frame.el.text += s
  }

  function handleText(a: number, b: number): void {
    const top = stack[stack.length - 1]
    if (top === undefined) {
      for (let j = a; j < b; j++) {
        if (!isWs(text.charCodeAt(j))) {
          if (rootClosed) fail('XML_TEXT_OUTSIDE_ROOT', 'Text after the root element has been closed', j)
          fail('XML_TEXT_OUTSIDE_ROOT', 'Text before the root element', j)
        }
      }
      return
    }
    appendText(top, decodeRange(a, b, false), a)
  }

  function parseProcessingInstruction(at: number): number {
    const end = text.indexOf('?>', at + 2)
    if (end === -1) fail('XML_UNTERMINATED_PI', 'Unterminated processing instruction or XML declaration ("?>" not found)', at)
    const nameEnd = readName(at + 2, 'processing instruction')
    const target = text.slice(at + 2, nameEnd)
    if (nameEnd < end && !isWs(text.charCodeAt(nameEnd))) {
      fail('XML_INVALID_NAME', `Invalid processing instruction target "${displayValue(target)}"`, at + 2)
    }
    if (target.toLowerCase() === 'xml') {
      if (sawMarkup || root !== null) fail('XML_MISPLACED_DECLARATION', 'The XML declaration must be the very first thing in the document', at)
    }
    return end + 2
  }

  function parseComment(at: number): number {
    const end = text.indexOf('-->', at + 4)
    if (end === -1) fail('XML_UNTERMINATED_COMMENT', 'Unterminated comment ("-->" not found)', at)
    return end + 3
  }

  function parseCData(at: number): number {
    const top = stack[stack.length - 1]
    if (top === undefined) fail('XML_TEXT_OUTSIDE_ROOT', 'CDATA section outside the root element', at)
    const end = text.indexOf(']]>', at + 9)
    if (end === -1) fail('XML_UNTERMINATED_CDATA', 'Unterminated CDATA section ("]]>" not found)', at)
    appendText(top, normalizeLiteral(text.slice(at + 9, end), false), at)
    return end + 3
  }

  function parseEndTag(at: number): number {
    const nameEnd = readName(at + 2, 'closing tag')
    const name = text.slice(at + 2, nameEnd)
    const j = skipWs(nameEnd)
    if (j >= n) fail('XML_UNTERMINATED_TAG', `Unterminated closing tag </${displayValue(name)}>`, at)
    if (text.charCodeAt(j) !== C_GT) fail('XML_MALFORMED_TAG', `Unexpected ${describeChar(text.charCodeAt(j))} in closing tag </${displayValue(name)}>`, j)
    const top = stack[stack.length - 1]
    if (top === undefined) fail('XML_UNEXPECTED_CLOSE_TAG', `Closing tag </${displayValue(name)}> without a matching opening tag`, at)
    if (top.el.name !== name) {
      fail(
        'XML_MISMATCHED_TAG',
        `Mismatched closing tag: expected </${displayValue(top.el.name)}> (opened at line ${top.el.line}, column ${top.el.column}) but found </${displayValue(name)}>`,
        at,
      )
    }
    stack.pop()
    if (stack.length === 0) rootClosed = true
    return j + 1
  }

  function parseStartTag(at: number): number {
    if (rootClosed) fail('XML_MULTIPLE_ROOTS', 'A second root element after the first one was closed; a document has exactly one root', at)
    const nameEnd = readName(at + 1, 'element')
    const name = text.slice(at + 1, nameEnd)
    const parent = stack[stack.length - 1]
    let index = 0
    if (parent !== undefined) {
      if (parent.counts === null) parent.counts = new Map()
      index = parent.counts.get(name) ?? 0
      parent.counts.set(name, index + 1)
    }
    const attrs = Object.create(null) as Record<string, string>
    pending = { name, index, attrs }

    elementCount++
    if (elementCount > lim.maxElements) fail('XML_TOO_MANY_ELEMENTS', `The document has more than ${lim.maxElements} elements`, at)
    if (stack.length + 1 > lim.maxDepth) fail('XML_TOO_DEEP', `Elements are nested more than ${lim.maxDepth} levels deep`, at)

    let attrCount = 0
    let ltCache = -2
    let selfClosing = false
    let j = nameEnd
    for (;;) {
      const wsStart = j
      j = skipWs(j)
      if (j >= n) fail('XML_UNTERMINATED_TAG', `Unterminated start tag <${displayValue(name)}>`, at)
      const c = text.charCodeAt(j)
      if (c === C_GT) {
        j++
        break
      }
      if (c === C_SLASH) {
        if (text.charCodeAt(j + 1) === C_GT) {
          selfClosing = true
          j += 2
          break
        }
        fail('XML_MALFORMED_TAG', `Unexpected "/" in start tag <${displayValue(name)}>`, j)
      }
      if (j === wsStart) {
        fail(
          'XML_MALFORMED_TAG',
          `Unexpected ${describeChar(c)} in start tag <${displayValue(name)}> (attributes must be separated by whitespace)`,
          j,
        )
      }
      const attrStart = j
      const attrEnd = readName(j, 'attribute')
      const attrName = text.slice(attrStart, attrEnd)
      j = skipWs(attrEnd)
      if (j >= n) fail('XML_UNTERMINATED_TAG', `Unterminated start tag <${displayValue(name)}>`, at)
      if (text.charCodeAt(j) !== C_EQ) {
        fail('XML_MALFORMED_TAG', `Attribute "${displayValue(attrName)}" on <${displayValue(name)}> has no value (expected "=")`, j)
      }
      j = skipWs(j + 1)
      if (j >= n) fail('XML_UNTERMINATED_TAG', `Unterminated start tag <${displayValue(name)}>`, at)
      const q = text.charCodeAt(j)
      if (q !== C_DQUOTE && q !== C_SQUOTE) {
        fail('XML_MALFORMED_TAG', `Value of attribute "${displayValue(attrName)}" on <${displayValue(name)}> must be quoted`, j)
      }
      const close = text.indexOf(q === C_DQUOTE ? '"' : "'", j + 1)
      if (close === -1) fail('XML_UNTERMINATED_STRING', `Unterminated value of attribute "${displayValue(attrName)}" on <${displayValue(name)}>`, j)
      if (close - (j + 1) > lim.maxAttributeValueLength) {
        fail(
          'XML_ATTRIBUTE_TOO_LONG',
          `Value of attribute "${displayValue(attrName)}" on <${displayValue(name)}> is ${close - (j + 1)} characters; the limit is ${lim.maxAttributeValueLength}`,
          j,
        )
      }
      if (ltCache < j + 1) {
        ltCache = text.indexOf('<', j + 1)
        if (ltCache === -1) ltCache = n
      }
      if (ltCache < close) fail('XML_LT_IN_ATTRIBUTE', `"<" inside the value of attribute "${displayValue(attrName)}" (write "&lt;")`, ltCache)
      if (attrName in attrs) fail('XML_DUPLICATE_ATTRIBUTE', `Duplicate attribute "${displayValue(attrName)}" on <${displayValue(name)}>`, attrStart)
      attrCount++
      if (attrCount > lim.maxAttributesPerElement) {
        fail('XML_TOO_MANY_ATTRIBUTES', `<${displayValue(name)}> has more than ${lim.maxAttributesPerElement} attributes`, attrStart)
      }
      // Decoding never lengthens a value, so the raw-length check above also bounds the result.
      attrs[attrName] = decodeRange(j + 1, close, true)
      j = close + 1
    }

    const { line, column } = posAt(at)
    const el: XmlElement = { name, attrs, children: [], text: '', line, column, path: '', location: '' }
    pending = null
    if (parent === undefined) {
      root = el
    } else {
      parent.el.children.push(el)
    }
    if (!selfClosing) {
      let path: string
      let locBase: string
      let annot: string
      if (parent === undefined) {
        path = '/' + name
        locBase = ''
        annot = ''
      } else {
        path = parent.path + '/' + name
        const seg = name + (index > 0 || isCollection(parent.el.name, name) ? `[${index}]` : '')
        locBase = parent.locBase === '' ? seg : `${parent.locBase}.${seg}`
        annot = stack.length >= 2 ? joinAnnot(parent.annot, annotationFor(name, attrs)) : ''
      }
      stack.push({ el, counts: null, path, locBase, annot })
    } else if (parent === undefined) {
      rootClosed = true
    }
    return j
  }

  // ---------------------------------------------------------------- main loop
  while (i < n) {
    const lt = text.indexOf('<', i)
    const end = lt === -1 ? n : lt
    if (end > i) handleText(i, end)
    if (lt === -1) break
    const c1 = text.charCodeAt(lt + 1)
    if (c1 === C_QMARK) {
      i = parseProcessingInstruction(lt)
    } else if (c1 === C_BANG) {
      if (text.startsWith('<!--', lt)) i = parseComment(lt)
      else if (text.startsWith('<![CDATA[', lt)) i = parseCData(lt)
      else if (text.slice(lt, lt + 9).toUpperCase() === '<!DOCTYPE') {
        fail(
          'XML_DOCTYPE_FORBIDDEN',
          'The document contains a <!DOCTYPE> declaration. L5X exports never need a DTD, and INTERLOCK rejects every DTD so that external entities (XXE) and entity expansion cannot occur',
          lt,
        )
      } else {
        fail('XML_INVALID_MARKUP', `Unsupported markup declaration "${displayValue(text.slice(lt, lt + 12), 12)}" (only comments and CDATA sections are allowed)`, lt)
      }
    } else if (c1 === C_SLASH) {
      i = parseEndTag(lt)
    } else {
      i = parseStartTag(lt)
    }
    sawMarkup = true
  }

  const open = stack[stack.length - 1]
  if (open !== undefined) {
    fail('XML_UNCLOSED_TAG', `Unexpected end of input: <${displayValue(open.el.name)}> opened at line ${open.el.line}, column ${open.el.column} is never closed`, n)
  }
  if (root === null) fail('XML_NO_ROOT', 'The document has no root element', n)
  return root
}

/**
 * Assign final `path` and `location` to every element. Done after the parse
 * so positional predicates are only used when a name really repeats.
 * Iterative to survive any depth the limits allow.
 */
function assignPaths(root: XmlElement): void {
  root.path = '/' + root.name
  root.location = displayValue(root.name)
  const work: { el: XmlElement; locBase: string; annot: string }[] = [{ el: root, locBase: '', annot: '' }]
  while (work.length > 0) {
    const item = work.pop()
    if (item === undefined) break
    const { el, locBase, annot } = item
    if (el.children.length === 0) continue
    const totals = new Map<string, number>()
    for (const c of el.children) totals.set(c.name, (totals.get(c.name) ?? 0) + 1)
    const seen = new Map<string, number>()
    for (const c of el.children) {
      const k = seen.get(c.name) ?? 0
      seen.set(c.name, k + 1)
      const repeated = (totals.get(c.name) ?? 0) > 1
      const nameAttr = c.attrs['Name']
      const numberAttr = c.attrs['Number']
      const pred =
        nameAttr !== undefined
          ? `[@Name=${xpathLiteral(nameAttr)}]`
          : numberAttr !== undefined
            ? `[@Number=${xpathLiteral(numberAttr)}]`
            : repeated
              ? `[${k + 1}]`
              : ''
      c.path = el.path + '/' + c.name + pred
      const seg = c.name + (repeated || isCollection(el.name, c.name) ? `[${k}]` : '')
      const childBase = locBase === '' ? seg : `${locBase}.${seg}`
      // The root's direct child (L5X: the Controller) is the same for every element, so it is not repeated.
      const childAnnot = el === root ? '' : joinAnnot(annot, annotationFor(c.name, c.attrs))
      c.location = formatLocation(childBase, childAnnot)
      if (c.children.length > 0) work.push({ el: c, locBase: childBase, annot: childAnnot })
    }
  }
}
