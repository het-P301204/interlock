import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ProjectParseError } from '../../src/adapters/types.ts'
import { decodeProjectBytes, findInvalidUtf8 } from '../../src/util/decode.ts'

function errorOf(fn: () => unknown): ProjectParseError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ProjectParseError) return e
    throw e
  }
  throw new Error('expected an error')
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

function utf16(s: string, littleEndian: boolean, bom: boolean): Uint8Array {
  const out = new Uint8Array((s.length + (bom ? 1 : 0)) * 2)
  const view = new DataView(out.buffer)
  let o = 0
  if (bom) {
    view.setUint16(0, 0xfeff, littleEndian)
    o = 2
  }
  for (let i = 0; i < s.length; i++, o += 2) view.setUint16(o, s.charCodeAt(i), littleEndian)
  return out
}

const DOC = '<?xml version="1.0"?><RSLogix5000Content><Controller Name="Île_日本"/></RSLogix5000Content>'

describe('decodeProjectBytes', () => {
  it('decodes UTF-8 without a BOM', () => {
    expect(decodeProjectBytes(utf8(DOC))).toBe(DOC)
  })

  it('strips a UTF-8 BOM', () => {
    expect(decodeProjectBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(DOC)]))).toBe(DOC)
  })

  it('decodes UTF-16LE and UTF-16BE with a BOM', () => {
    expect(decodeProjectBytes(utf16(DOC, true, true))).toBe(DOC)
    expect(decodeProjectBytes(utf16(DOC, false, true))).toBe(DOC)
  })

  it('recognizes UTF-16 without a BOM from the leading "<"', () => {
    expect(decodeProjectBytes(utf16(DOC, true, false))).toBe(DOC)
    expect(decodeProjectBytes(utf16(DOC, false, false))).toBe(DOC)
  })

  it('rejects an empty file and a BOM-only file with EMPTY_FILE', () => {
    expect(errorOf(() => decodeProjectBytes(new Uint8Array(0))).code).toBe('EMPTY_FILE')
    expect(errorOf(() => decodeProjectBytes(new Uint8Array([0xef, 0xbb, 0xbf]))).code).toBe('EMPTY_FILE')
    expect(errorOf(() => decodeProjectBytes(new Uint8Array([0xff, 0xfe]))).code).toBe('EMPTY_FILE')
  })

  it('rejects invalid UTF-8 with ENCODING_INVALID and the byte offset, never U+FFFD', () => {
    const bytes = new Uint8Array([...utf8('<a>ok '), 0xc3, 0x28, ...utf8('</a>')])
    const err = errorOf(() => decodeProjectBytes(bytes))
    expect(err.code).toBe('ENCODING_INVALID')
    expect(err.message).toContain('byte offset 6')
  })

  it.each([
    ['lone continuation byte', [0x80]],
    ['overlong NUL', [0xc0, 0x80]],
    ['overlong slash', [0xe0, 0x80, 0xaf]],
    ['encoded surrogate', [0xed, 0xa0, 0x80]],
    ['above U+10FFFF', [0xf4, 0x90, 0x80, 0x80]],
    ['truncated sequence', [0xe6, 0x97]],
    ['0xFF byte', [0xff]],
  ])('rejects %s', (_label, bad) => {
    const bytes = new Uint8Array([...utf8('<a>'), ...bad, ...utf8('</a>')])
    expect(errorOf(() => decodeProjectBytes(bytes)).code).toBe('ENCODING_INVALID')
    expect(findInvalidUtf8(bytes)).toBe(3)
  })

  it('mentions a declared legacy encoding', () => {
    const bytes = new Uint8Array([...utf8('<?xml version="1.0" encoding="ISO-8859-1"?><a>caf'), 0xe9, ...utf8('</a>')])
    const err = errorOf(() => decodeProjectBytes(bytes))
    expect(err.code).toBe('ENCODING_INVALID')
    expect(err.message).toContain('encoding="ISO-8859-1"')
  })

  it('rejects odd-length and unpaired-surrogate UTF-16', () => {
    expect(errorOf(() => decodeProjectBytes(new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x61]))).code).toBe('ENCODING_INVALID')
    expect(errorOf(() => decodeProjectBytes(new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x00, 0xd8, 0x3e, 0x00]))).code).toBe('ENCODING_INVALID')
  })

  it('findInvalidUtf8 agrees with a fatal TextDecoder (property)', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        let ok = true
        try {
          decoder.decode(bytes)
        } catch {
          ok = false
        }
        expect(findInvalidUtf8(bytes) === -1).toBe(ok)
      }),
      { numRuns: 5000 },
    )
  })

  it('never throws anything but ProjectParseError (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        try {
          decodeProjectBytes(bytes)
        } catch (e) {
          expect(e).toBeInstanceOf(ProjectParseError)
        }
      }),
      { numRuns: 3000 },
    )
  })
})
