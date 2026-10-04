import type { FormatId, ParsedProject, ParserDiagnostic, SourceRef } from '../model/project.ts'

/**
 * A format adapter turns one vendor export into the vendor-neutral
 * `ParsedProject`. Adapters receive decoded text, never a path: they cannot
 * touch the filesystem or the network, and they never execute anything in
 * the file.
 */
export interface ProjectAdapter {
  id: string
  label: string
  format: FormatId
  vendor: string
  /** SUPPORTED adapters parse; PLANNED adapters exist only so the UI can say so honestly. */
  status: 'SUPPORTED' | 'PLANNED'
  version: string
  extensions: string[]
  /** Cheap sniff: extension plus the first few KB of the file. */
  canParse(input: { name: string; head: string }): boolean
  /** Throws ProjectParseError when the semantic model could not be trusted. */
  parse(text: string, options?: ParseOptions): ParsedProject
}

export interface XmlLimits {
  /** Maximum input size in characters. */
  maxChars: number
  maxDepth: number
  maxElements: number
  maxAttributesPerElement: number
  maxAttributeValueLength: number
  maxTextLength: number
}

export interface ParseOptions {
  limits?: Partial<XmlLimits>
}

export const DEFAULT_XML_LIMITS: XmlLimits = {
  maxChars: 64 * 1024 * 1024,
  maxDepth: 64,
  maxElements: 2_000_000,
  maxAttributesPerElement: 64,
  maxAttributeValueLength: 1024 * 1024,
  maxTextLength: 16 * 1024 * 1024,
}

/**
 * The one error type that crosses the parser boundary. `location` is a
 * friendly path such as "Controller.Tags[27]"; `source` the XML position.
 */
export class ProjectParseError extends Error {
  readonly code: string
  readonly location?: string
  readonly source?: SourceRef
  readonly diagnostics: ParserDiagnostic[]
  constructor(code: string, message: string, opts: { location?: string; source?: SourceRef; diagnostics?: ParserDiagnostic[] } = {}) {
    super(message)
    this.name = 'ProjectParseError'
    this.code = code
    if (opts.location !== undefined) this.location = opts.location
    if (opts.source !== undefined) this.source = opts.source
    this.diagnostics = opts.diagnostics ?? []
  }
}
