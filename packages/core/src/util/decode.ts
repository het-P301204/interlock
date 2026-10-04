/**
 * Bytes -> text for uploaded project files.
 *
 * UTF-8 (the L5X norm, BOM optional) is decoded strictly: an invalid byte
 * sequence is an ENCODING_INVALID error, never a silent U+FFFD that would
 * change a tag name or rung text. UTF-16 is accepted when the file says so
 * with a BOM (or unmistakably starts with "<?" / "<" in UTF-16).
 */
import { ProjectParseError } from '../adapters/types.ts'

type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be'

function detect(bytes: Uint8Array): { encoding: Encoding; skip: number } {
  const b0 = bytes[0]
  const b1 = bytes[1]
  const b2 = bytes[2]
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) return { encoding: 'utf-8', skip: 3 }
  if (b0 === 0xff && b1 === 0xfe) return { encoding: 'utf-16le', skip: 2 }
  if (b0 === 0xfe && b1 === 0xff) return { encoding: 'utf-16be', skip: 2 }
  // No BOM: "<" followed by a zero byte (or the reverse) is UTF-16 without a BOM.
  if (b0 === 0x3c && b1 === 0x00 && bytes[3] === 0x00) return { encoding: 'utf-16le', skip: 0 }
  if (b0 === 0x00 && b1 === 0x3c && b2 === 0x00) return { encoding: 'utf-16be', skip: 0 }
  return { encoding: 'utf-8', skip: 0 }
}

/** Byte offset of the first invalid UTF-8 sequence, or -1. */
export function findInvalidUtf8(bytes: Uint8Array, from = 0): number {
  const n = bytes.length
  let i = from
  while (i < n) {
    const b = bytes[i] ?? 0
    if (b < 0x80) {
      i++
      continue
    }
    let need: number
    let min: number
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1
      min = 0x80
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2
      min = 0x800
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3
      min = 0x10000
    } else {
      return i
    }
    let cp = b & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07)
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k]
      if (c === undefined || (c & 0xc0) !== 0x80) return i
      cp = (cp << 6) | (c & 0x3f)
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return i
    i += need + 1
  }
  return -1
}

/** Look for encoding="..." in an ASCII-compatible XML declaration (for a friendlier error). */
function declaredEncoding(bytes: Uint8Array): string | undefined {
  let head = ''
  const max = Math.min(bytes.length, 200)
  for (let i = 0; i < max; i++) {
    const b = bytes[i] ?? 0
    if (b >= 0x80) break
    head += String.fromCharCode(b)
  }
  const at = head.indexOf('encoding=')
  if (at === -1) return undefined
  const q = head.charAt(at + 9)
  if (q !== '"' && q !== "'") return undefined
  const end = head.indexOf(q, at + 10)
  if (end === -1 || end - at > 60) return undefined
  return head.slice(at + 10, end)
}

/**
 * Decode an uploaded project file. Throws ProjectParseError EMPTY_FILE for
 * an empty input (or a bare BOM) and ENCODING_INVALID for bytes that are not
 * valid in the detected encoding.
 */
export function decodeProjectBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    throw new ProjectParseError('EMPTY_FILE', 'The file is empty (0 bytes).', { location: '(file)' })
  }
  const { encoding, skip } = detect(bytes)
  const body = bytes.subarray(skip)
  if (encoding !== 'utf-8' && body.length % 2 !== 0) {
    throw new ProjectParseError(
      'ENCODING_INVALID',
      `The file looks like ${encoding.toUpperCase()} but has an odd number of bytes; it is truncated or not really UTF-16.`,
      { location: '(file)' },
    )
  }
  let text: string
  try {
    text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(body)
  } catch {
    if (encoding === 'utf-8') {
      const at = findInvalidUtf8(body)
      const declared = declaredEncoding(bytes)
      const hint =
        declared !== undefined && !/^utf-?8$/i.test(declared)
          ? ` The XML declaration says encoding="${declared.replace(/[^\x20-\x7e]/g, '?')}"; INTERLOCK reads UTF-8 and UTF-16 exports only. Re-export from Logix Designer (which writes UTF-8).`
          : ''
      throw new ProjectParseError(
        'ENCODING_INVALID',
        `The file is not valid UTF-8${at >= 0 ? `: invalid byte sequence at byte offset ${at + skip}` : ''}.${hint}`,
        { location: '(file)' },
      )
    }
    throw new ProjectParseError('ENCODING_INVALID', `The file is not valid ${encoding.toUpperCase()} (unpaired surrogate).`, {
      location: '(file)',
    })
  }
  if (text.length === 0) {
    throw new ProjectParseError('EMPTY_FILE', 'The file contains only a byte-order mark and no content.', { location: '(file)' })
  }
  return text
}
