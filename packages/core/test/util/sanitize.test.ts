import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { INVISIBLE_CODE_POINT_RANGES, cleanText, isInvisibleCodePoint, stripInvisible } from '../../src/util/sanitize.ts'

const cp = (n: number): string => String.fromCodePoint(n)

const MUST_REMOVE = [
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // LRE RLE PDF LRO RLO
  0x2066, 0x2067, 0x2068, 0x2069, // LRI RLI FSI PDI
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, // ZWSP ZWNJ ZWJ LRM RLM
  0x061c, // ALM
  0x2028, 0x2029, // line / paragraph separator
  0xfeff, // ZWNBSP / BOM
  0x180e, // Mongolian vowel separator
  0xe0000, 0xe0001, 0xe0041, 0xe007f, // tag characters
  0x00, 0x01, 0x07, 0x08, 0x0b, 0x0c, 0x0e, 0x1b, 0x1f, // C0 except TAB LF CR
  0x7f, 0x80, 0x85, 0x9b, 0x9f, // DEL + C1
]

describe('stripInvisible', () => {
  it.each(MUST_REMOVE.map((n) => [n.toString(16).toUpperCase().padStart(4, '0'), n]))('removes U+%s', (_hex, n) => {
    const r = stripInvisible(`a${cp(n)}b`)
    expect(r).toEqual({ text: 'ab', removed: 1 })
    expect(isInvisibleCodePoint(n)).toBe(true)
  })

  it('keeps TAB, LF and CR', () => {
    expect(stripInvisible('a\tb\nc\r\nd')).toEqual({ text: 'a\tb\nc\r\nd', removed: 0 })
  })

  it('preserves accented Latin, CJK, emoji, Arabic and Hebrew text', () => {
    for (const s of ['Île-de-France', '日本語のポンプ', 'Pump ' + cp(0x1f6b0) + ' ok ' + cp(0x1f600), 'Tank ' + cp(0x1f1e9) + cp(0x1f1ea), 'مضخة', 'משאבה', 'Ωμέγα', '½ ° µ ©']) {
      expect(stripInvisible(s)).toEqual({ text: s, removed: 0 })
    }
  })

  it('returns the same string when nothing is removed', () => {
    const s = 'Pump P-101 run enable'
    expect(stripInvisible(s).text).toBe(s)
  })

  it('counts removed code points (an astral tag character counts once)', () => {
    const s = `${cp(0x202e)}Run${cp(0xe0041)}${cp(0xe0042)} enable${cp(0x200b)}${cp(0x202c)}`
    expect(stripInvisible(s)).toEqual({ text: 'Run enable', removed: 5 })
  })

  it('removes a classic Trojan Source sequence', () => {
    const s = `/* admin ${cp(0x202e)}${cp(0x2066)}// check later${cp(0x2069)}${cp(0x2066)} */`
    expect(cleanText(s)).toBe('/* admin // check later */')
  })

  it('removes lone surrogates but keeps valid pairs', () => {
    const lone = String.fromCharCode(0xd83d)
    expect(stripInvisible(`a${lone}b${String.fromCharCode(0xdc00)}`)).toEqual({ text: 'ab', removed: 2 })
    expect(stripInvisible(`x${cp(0x1f600)}y`).removed).toBe(0)
  })

  it('cannot join two surrogate halves into a new character', () => {
    // High half + ZWSP + low half: removing only the ZWSP would create U+E0000 (a tag character).
    const s = String.fromCharCode(0xdb40) + cp(0x200b) + String.fromCharCode(0xdc00)
    const once = cleanText(s)
    expect(once).toBe('')
    expect(cleanText(once)).toBe(once)
  })

  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (s) => {
        const once = stripInvisible(s)
        const twice = stripInvisible(once.text)
        expect(twice.text).toBe(once.text)
        expect(twice.removed).toBe(0)
      }),
      { numRuns: 3000 },
    )
  })

  it('never leaves a listed character behind and never removes anything else (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (s) => {
        const { text, removed } = stripInvisible(s)
        let expectedRemoved = 0
        let kept = ''
        for (let i = 0; i < s.length; ) {
          const c = s.codePointAt(i) ?? 0
          const width = c > 0xffff ? 2 : 1
          const lone = c >= 0xd800 && c <= 0xdfff
          if (lone || isInvisibleCodePoint(c)) expectedRemoved++
          else kept += String.fromCodePoint(c)
          i += width
        }
        expect(removed).toBe(expectedRemoved)
        expect(text).toBe(kept)
      }),
      { numRuns: 2000 },
    )
  })

  it('exposes the ranges in ascending order', () => {
    for (let i = 1; i < INVISIBLE_CODE_POINT_RANGES.length; i++) {
      const prev = INVISIBLE_CODE_POINT_RANGES[i - 1]
      const cur = INVISIBLE_CODE_POINT_RANGES[i]
      expect(prev?.[1]).toBeLessThan(cur?.[0] ?? 0)
    }
  })

  it('source file contains no literal invisible characters (guards against editor escape corruption)', () => {
    const src = readFileSync(new URL('../../src/util/sanitize.ts', import.meta.url), 'utf8')
    expect(stripInvisible(src).removed).toBe(0)
  })

  it('handles large inputs quickly', () => {
    const big = ('Pump P-101 ' + cp(0x202e) + 'run enable ').repeat(100_000)
    const t0 = performance.now()
    const r = stripInvisible(big)
    expect(r.removed).toBe(100_000)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
