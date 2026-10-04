/**
 * Diagnostics and attribute readers shared by the L5X adapter.
 *
 * Every string the adapter takes from the file goes through `clean`, which
 * strips invisible/bidi characters and records a TEXT_INVISIBLE_CHARACTERS
 * warning when it removed anything.
 */
import type { DiagnosticSeverity, ExternalAccess, ParserDiagnostic } from '../../model/project.ts'
import { displayValue } from '../../xml/parser.ts'
import { attr, childrenNamed, sourceOf } from '../../xml/query.ts'
import type { XmlElement } from '../../xml/types.ts'
import { stripInvisible } from '../../util/sanitize.ts'

export interface Ctx {
  diagnostics: ParserDiagnostic[]
  /** True for component exports (TargetType other than Controller). */
  partial: boolean
}

/** Logix limit on identifier length. */
export const LOGIX_NAME_MAX = 40

export function diag(ctx: Ctx, severity: DiagnosticSeverity, code: string, message: string, el?: XmlElement): void {
  const d: ParserDiagnostic = { severity, code, message }
  if (el !== undefined) {
    d.location = el.location
    d.source = sourceOf(el)
  }
  ctx.diagnostics.push(d)
}

/** Quote a file-supplied value for a diagnostic message. */
export function q(s: string): string {
  return `"${displayValue(s)}"`
}

/** Strip invisible characters; warn (with location) when any were removed. */
export function clean(ctx: Ctx, raw: string, el: XmlElement, label: string): string {
  const r = stripInvisible(raw)
  if (r.removed > 0) {
    diag(
      ctx,
      'warning',
      'TEXT_INVISIBLE_CHARACTERS',
      `Removed ${r.removed} invisible or bidirectional control character${r.removed === 1 ? '' : 's'} from the ${label} of <${el.name}>. ` +
        'Characters like these can make text display differently from what it contains (the "Trojan Source" pattern); review this text in the original export.',
      el,
    )
  }
  return r.text
}

/** Cleaned attribute value, or undefined when absent. */
export function readAttr(ctx: Ctx, el: XmlElement, name: string): string | undefined {
  const v = attr(el, name)
  return v === undefined ? undefined : clean(ctx, v, el, `${name} attribute`)
}

/** Cleaned, trimmed attribute value; undefined when absent or blank. */
export function readText(ctx: Ctx, el: XmlElement, name: string): string | undefined {
  const v = readAttr(ctx, el, name)
  if (v === undefined) return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

export function readBool(ctx: Ctx, el: XmlElement, name: string, fallback: boolean): boolean {
  const v = attr(el, name)
  if (v === undefined) return fallback
  const t = v.trim().toLowerCase()
  if (t === 'true' || t === '1') return true
  if (t === 'false' || t === '0') return false
  diag(ctx, 'warning', 'L5X_INVALID_BOOLEAN', `Attribute ${name}=${q(v)} on <${el.name}> is not true/false; treated as ${fallback}.`, el)
  return fallback
}

export function readNumber(ctx: Ctx, el: XmlElement, name: string): number | undefined {
  const v = attr(el, name)
  if (v === undefined) return undefined
  const t = v.trim()
  const n = t === '' ? Number.NaN : Number(t)
  if (!Number.isFinite(n)) {
    diag(ctx, 'warning', 'L5X_INVALID_NUMBER', `Attribute ${name}=${q(v)} on <${el.name}> is not a number; it was ignored.`, el)
    return undefined
  }
  return n
}

/** Loose Logix identifier syntax: letters, digits, underscore; not starting with a digit. */
export function isLogixIdentifier(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const letter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    const digit = c >= 48 && c <= 57
    if (!(letter || (digit && i > 0))) return false
  }
  return true
}

/**
 * Read the Name attribute of a named entity. A missing or blank Name is an
 * error (the model cannot identify the entity); bad syntax and over-long names
 * are warnings.
 */
export function readName(ctx: Ctx, el: XmlElement, kind: string): string | undefined {
  const raw = attr(el, 'Name')
  const name = raw === undefined ? '' : clean(ctx, raw, el, 'name').trim()
  if (name === '') {
    diag(ctx, 'error', 'L5X_MISSING_NAME', `${kind} <${el.name}> has no Name attribute, so it cannot be identified or referenced.`, el)
    return undefined
  }
  if (!isLogixIdentifier(name)) {
    diag(
      ctx,
      'warning',
      'L5X_INVALID_NAME',
      `${kind} name ${q(name)} is not a valid Logix identifier (letters, digits and underscores, not starting with a digit).`,
      el,
    )
  } else if (name.length > LOGIX_NAME_MAX) {
    diag(ctx, 'warning', 'L5X_NAME_TOO_LONG', `${kind} name ${q(name)} is ${name.length} characters; Logix allows at most ${LOGIX_NAME_MAX}.`, el)
  }
  return name
}

/**
 * Duplicate-name detector for one scope. Logix names are case-insensitive,
 * so "Pump_01" and "PUMP_01" collide.
 */
export function makeScope(ctx: Ctx, scopeLabel: string): { add(name: string, el: XmlElement, kind: string): void; has(name: string): boolean } {
  const seen = new Map<string, XmlElement>()
  return {
    add(name, el, kind) {
      const key = name.toUpperCase()
      const prev = seen.get(key)
      if (prev !== undefined) {
        diag(
          ctx,
          'warning',
          'L5X_DUPLICATE_NAME',
          `Duplicate ${kind} name ${q(name)} in ${scopeLabel} (first defined at line ${prev.line}). Logix names are case-insensitive; ` +
            'both definitions were kept, and a reference may resolve to either.',
          el,
        )
        return
      }
      seen.set(key, el)
    },
    has(name) {
      return seen.has(name.toUpperCase())
    },
  }
}

/**
 * Items of a container, e.g. collect(ctx, controller, 'Tags', ['Tag']).
 * Every container of that name is read (none is silently ignored), and an
 * unexpected element inside a container is reported.
 */
export function collect(ctx: Ctx, parent: XmlElement, containerName: string, itemNames: readonly string[]): XmlElement[] {
  const out: XmlElement[] = []
  const containers = childrenNamed(parent, containerName)
  if (containers.length > 1) {
    diag(
      ctx,
      'warning',
      'L5X_DUPLICATE_ELEMENT',
      `<${parent.name}> has ${containers.length} <${containerName}> elements; L5X exports have one. All of them were read.`,
      containers[1],
    )
  }
  for (const c of containers) {
    for (const item of c.children) {
      if (itemNames.includes(item.name)) out.push(item)
      else {
        diag(
          ctx,
          'warning',
          'L5X_UNEXPECTED_ELEMENT',
          `Unexpected <${displayValue(item.name)}> inside <${containerName}> (expected ${itemNames.map((n) => `<${n}>`).join(' or ')}); it was ignored.`,
          item,
        )
      }
    }
  }
  return out
}

export function readExternalAccess(ctx: Ctx, el: XmlElement): ExternalAccess {
  const v = attr(el, 'ExternalAccess')
  if (v === undefined) return 'Read/Write' // the Logix default when the attribute is absent
  const t = v.trim()
  if (t === 'Read/Write' || t === 'Read Only' || t === 'None') return t
  diag(
    ctx,
    'warning',
    'L5X_UNKNOWN_EXTERNAL_ACCESS',
    `ExternalAccess=${q(v)} on <${el.name}> is not Read/Write, Read Only or None; recorded as Unknown (it may be externally writable).`,
    el,
  )
  return 'Unknown'
}

/**
 * Description/comment text: direct CDATA, or a Localized* child (en-US
 * preferred, else the first). Returns undefined when absent or blank.
 */
export function readDoc(ctx: Ctx, owner: XmlElement, childName: string, label: string): string | undefined {
  const docs = childrenNamed(owner, childName)
  const d = docs[0]
  if (d === undefined) return undefined
  if (docs.length > 1) {
    diag(ctx, 'warning', 'L5X_DUPLICATE_ELEMENT', `<${owner.name}> has ${docs.length} <${childName}> elements; only the first was used.`, docs[1])
  }
  let src: XmlElement = d
  const localized = d.children.filter((c) => c.name.startsWith('Localized'))
  if (localized.length > 0) {
    src = localized.find((c) => attr(c, 'Lang') === 'en-US') ?? localized[0] ?? d
  }
  const t = clean(ctx, src.text, src, label).trim()
  return t === '' ? undefined : t
}
