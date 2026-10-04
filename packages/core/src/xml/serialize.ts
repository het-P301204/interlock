import type { XmlElement } from './types.ts'

/** Escape character data (also safe inside double-quoted attribute values). */
export function escapeXml(s: string): string {
  let out = ''
  let last = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    let rep: string | null = null
    if (c === 38) rep = '&amp;'
    else if (c === 60) rep = '&lt;'
    else if (c === 62) rep = '&gt;'
    else if (c === 34) rep = '&quot;'
    else if (c === 39) rep = '&apos;'
    else if (c === 13) rep = '&#13;'
    else if (c === 9) rep = '&#9;'
    else if (c === 10) rep = '&#10;'
    if (rep !== null) {
      out += s.slice(last, i) + rep
      last = i + 1
    }
  }
  return last === 0 ? s : out + s.slice(last)
}

/**
 * Serialize an element tree back to XML. Text is written before the
 * children (the tree does not keep mixed-content order). Iterative, so it
 * handles any depth the parser accepted. Mainly used by round-trip tests.
 */
export function serializeXml(root: XmlElement): string {
  const parts: string[] = []
  const work: (XmlElement | string)[] = [root]
  while (work.length > 0) {
    const item = work.pop()
    if (item === undefined) break
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    let open = '<' + item.name
    for (const key of Object.keys(item.attrs)) open += ` ${key}="${escapeXml(item.attrs[key] ?? '')}"`
    if (item.children.length === 0 && item.text === '') {
      parts.push(open + '/>')
      continue
    }
    parts.push(open + '>' + escapeXml(item.text))
    work.push(`</${item.name}>`)
    for (let k = item.children.length - 1; k >= 0; k--) {
      const child = item.children[k]
      if (child !== undefined) work.push(child)
    }
  }
  return parts.join('')
}
