/**
 * The element tree produced by the hardened XML parser.
 *
 * Deliberately minimal: no namespaces, no DTD, no entity declarations, no
 * mixed-content node list. L5X needs none of these, and every feature not
 * implemented is a feature that cannot be abused.
 */
export interface XmlElement {
  /** Element name exactly as written (prefix included, if any). */
  name: string
  /**
   * Attributes, created with Object.create(null): an attribute named
   * "__proto__" or "constructor" is just data, never a prototype hook.
   */
  attrs: Record<string, string>
  children: XmlElement[]
  /** Character data and CDATA of this element only (not descendants), entity-decoded, CRLF normalized to LF. */
  text: string
  /** 1-based line of the element's "<". */
  line: number
  /** 1-based column (UTF-16 code units) of the element's "<". */
  column: number
  /**
   * XPath-like path, e.g.
   * /RSLogix5000Content/Controller/Programs/Program[@Name='Safety']/Routines/Routine[@Name='ESD']/RLLContent/Rung[@Number='2'].
   * Uses the Name attribute, else Number, else a 1-based position among
   * same-named siblings when there is more than one.
   */
  path: string
  /**
   * Friendly location for people, e.g.
   * `Controller.Tags.Tag[27] (Tag "Pump_01_Run_Enable")`. Dot-joined element
   * names below the root, with the 0-based index among same-named siblings for
   * repeated elements and the named ancestors in parentheses.
   */
  location: string
}
