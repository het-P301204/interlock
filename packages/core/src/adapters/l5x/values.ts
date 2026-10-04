/**
 * Compact canonical text for tag values (initial/stored data).
 *
 * The value is for display and for detecting value edits between two
 * exports, so it must not change when nothing meaningful changed: structure
 * members are sorted, whitespace is trimmed.
 */
import { attr, childAt, childrenNamed, firstChild } from '../../xml/query.ts'
import type { XmlElement } from '../../xml/types.ts'
import { clean } from './context.ts'
import type { Ctx } from './context.ts'

/** Natural order: "A[2]" before "A[10]"; deterministic and locale-independent. */
export function naturalCompare(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const ca = a.charCodeAt(i)
    const cb = b.charCodeAt(j)
    const da = ca >= 48 && ca <= 57
    const db = cb >= 48 && cb <= 57
    if (da && db) {
      let ie = i
      while (ie < a.length && a.charCodeAt(ie) >= 48 && a.charCodeAt(ie) <= 57) ie++
      let je = j
      while (je < b.length && b.charCodeAt(je) >= 48 && b.charCodeAt(je) <= 57) je++
      let na = a.slice(i, ie)
      let nb = b.slice(j, je)
      let k = 0
      while (k < na.length - 1 && na.charCodeAt(k) === 48) k++
      na = na.slice(k)
      k = 0
      while (k < nb.length - 1 && nb.charCodeAt(k) === 48) k++
      nb = nb.slice(k)
      if (na.length !== nb.length) return na.length - nb.length
      if (na !== nb) return na < nb ? -1 : 1
      i = ie
      j = je
      continue
    }
    if (ca !== cb) return ca - cb
    i++
    j++
  }
  return a.length - i - (b.length - j)
}

/** Flatten a Decorated Structure/Array into sorted "member=value" pairs. Iterative. */
function flatten(top: XmlElement): string | undefined {
  const entries: [string, string][] = []
  const work: [XmlElement, string][] = [[top, '']]
  while (work.length > 0) {
    const item = work.pop()
    if (item === undefined) break
    const [node, prefix] = item
    for (const c of node.children) {
      switch (c.name) {
        case 'DataValueMember':
          entries.push([prefix + (attr(c, 'Name') ?? '?'), attr(c, 'Value') ?? c.text.trim()])
          break
        case 'StructureMember':
          work.push([c, prefix + (attr(c, 'Name') ?? '?') + '.'])
          break
        case 'ArrayMember':
          work.push([c, prefix + (attr(c, 'Name') ?? '?')])
          break
        case 'Element': {
          const idx = attr(c, 'Index') ?? '[?]'
          const v = attr(c, 'Value')
          if (v !== undefined) entries.push([prefix + idx, v])
          else work.push([c, prefix + idx + '.'])
          break
        }
        case 'Structure':
          work.push([c, prefix])
          break
        default:
          break
      }
    }
  }
  if (entries.length === 0) return undefined
  entries.sort((x, y) => naturalCompare(x[0], y[0]))
  return entries.map(([k, v]) => `${k}=${v}`).join(';')
}

function decoratedValue(dec: XmlElement): string | undefined {
  if (dec.children.length !== 1) return undefined
  const top = dec.children[0]
  if (top === undefined) return undefined
  if (top.name === 'DataValue') return attr(top, 'Value') ?? (top.text.trim() || undefined)
  if (top.name === 'Structure' || top.name === 'Array') return flatten(top)
  return undefined
}

function pickLang(els: XmlElement[]): XmlElement | undefined {
  return els.find((e) => attr(e, 'Lang') === 'en-US') ?? els[0]
}

export const ALARM_CONFIG_KEYS = [
  'Severity', 'MinDurationPRE', 'ShelveDuration', 'MaxShelveDuration', 'Condition', 'AckRequired', 'Latched',
  'ProgDisable', 'OperDisable', 'ProgSuppress', 'OperSuppress', 'OperShelve',
] as const

function alarmValue(alarm: XmlElement): string | undefined {
  const parts: string[] = []
  const params = firstChild(alarm, 'AlarmDigitalParameters')
  // Configuration that changes when and whether the alarm notifies; runtime
  // state (In, Acked, timestamps) is deliberately left out.
  for (const key of ALARM_CONFIG_KEYS) {
    const v = params === undefined ? undefined : attr(params, key)
    if (v !== undefined) parts.push(`${key}=${v.trim()}`)
  }
  const messages = childAt(alarm, 'AlarmConfig', 'Messages')
  if (messages !== undefined) {
    const am = childrenNamed(messages, 'Message').find((m) => attr(m, 'Type') === 'AM')
    if (am !== undefined) {
      const textEl = pickLang(childrenNamed(am, 'Text'))
      const t = textEl?.text.trim()
      if (t !== undefined && t !== '') parts.push(`AM=${t}`)
    }
  }
  return parts.length > 0 ? parts.join(';') : undefined
}

/**
 * Canonical value of a tag (`Data`) or parameter/local tag (`DefaultData`):
 * Decorated single value or sorted structure members first, then the alarm
 * severity + message, then the raw L5K text.
 */
export function readValue(ctx: Ctx, el: XmlElement, dataName: 'Data' | 'DefaultData'): string | undefined {
  const datas = childrenNamed(el, dataName)
  if (datas.length === 0) return undefined
  const byFormat = (f: string): XmlElement | undefined => datas.find((d) => attr(d, 'Format') === f)
  const candidates: [XmlElement | undefined, (d: XmlElement) => string | undefined][] = [
    [byFormat('Decorated'), decoratedValue],
    [byFormat('Alarm'), alarmValue],
    [byFormat('L5K'), (d) => d.text.trim() || undefined],
    [byFormat('String'), (d) => d.text.trim() || undefined],
  ]
  for (const [d, read] of candidates) {
    if (d === undefined) continue
    const v = read(d)
    if (v !== undefined) return clean(ctx, v, d, 'value')
  }
  return undefined
}
