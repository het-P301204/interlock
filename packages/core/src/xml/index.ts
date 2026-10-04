export type { XmlElement } from './types.ts'
export { parseXml, resolveLimits, isXmlName, isXmlChar, displayValue } from './parser.ts'
export { childrenNamed, firstChild, childAt, attr, sourceOf } from './query.ts'
export { serializeXml, escapeXml } from './serialize.ts'
