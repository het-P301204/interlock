import type { SourceRef } from '../model/project.ts'
import type { XmlElement } from './types.ts'

/** Direct children named `name`, in document order. */
export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = []
  for (const c of el.children) if (c.name === name) out.push(c)
  return out
}

/** First direct child named `name`. */
export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  for (const c of el.children) if (c.name === name) return c
  return undefined
}

/** Follow a chain of first-children, e.g. childAt(controller, 'Programs', 'Program'). */
export function childAt(el: XmlElement, ...names: string[]): XmlElement | undefined {
  let cur: XmlElement | undefined = el
  for (const name of names) {
    if (cur === undefined) return undefined
    cur = firstChild(cur, name)
  }
  return cur
}

/** Attribute value or undefined; safe for any attribute name (attrs has no prototype). */
export function attr(el: XmlElement, name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : undefined
}

/** SourceRef for an element. */
export function sourceOf(el: XmlElement): SourceRef {
  return { path: el.path, line: el.line, column: el.column }
}
