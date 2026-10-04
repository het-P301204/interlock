/**
 * Format adapter registry.
 *
 * Only the L5X adapter parses. The PLANNED entries exist so the product can
 * recognize those formats and say honestly that they are not supported yet,
 * instead of failing with a confusing XML error or, worse, pretending.
 */
import type { FormatId, ParsedProject } from '../model/project.ts'
import { l5xAdapter } from './l5x/index.ts'
import { ProjectParseError } from './types.ts'
import type { ParseOptions, ProjectAdapter } from './types.ts'

/** How many characters of the file the sniffers look at. */
export const SNIFF_CHARS = 4096

/** File extensions INTERLOCK will accept at all (lower-case). */
export const ALLOWED_EXTENSIONS: readonly string[] = ['.l5x', '.xml', '.xef']

function planned(spec: {
  id: string
  label: string
  format: FormatId
  vendor: string
  extensions: string[]
  formatName: string
  sniff: (head: string) => boolean
}): ProjectAdapter {
  return {
    id: spec.id,
    label: spec.label,
    format: spec.format,
    vendor: spec.vendor,
    status: 'PLANNED',
    version: '0.0.0',
    extensions: spec.extensions,
    canParse({ head }) {
      return spec.sniff(head)
    },
    parse(): ParsedProject {
      throw new ProjectParseError(
        'FORMAT_NOT_SUPPORTED',
        `Detected ${spec.formatName}. INTERLOCK does not parse this format yet; it is on the roadmap. Export the project as Rockwell L5X to analyze it today.`,
        { location: '(file)' },
      )
    },
  }
}

export const plcopenAdapter = planned({
  id: 'plcopen-xml',
  label: 'PLCopen XML (IEC 61131-3 TC6)',
  format: 'PLCOPEN_XML',
  vendor: 'PLCopen',
  extensions: ['.xml'],
  formatName: 'PLCopen XML',
  sniff: (head) => head.includes('<project') && head.includes('http://www.plcopen.org/xml/tc6'),
})

export const siemensTiaAdapter = planned({
  id: 'siemens-tia-openness',
  label: 'Siemens TIA Portal Openness XML',
  format: 'SIEMENS_TIA_XML',
  vendor: 'Siemens',
  extensions: ['.xml'],
  formatName: 'Siemens TIA Portal Openness XML',
  sniff: (head) => head.includes('<Document>') && head.includes('<Engineering version='),
})

export const schneiderXefAdapter = planned({
  id: 'schneider-xef',
  label: 'Schneider EcoStruxure / Unity Pro (XEF)',
  format: 'SCHNEIDER_XEF',
  vendor: 'Schneider Electric',
  extensions: ['.xef'],
  formatName: 'Schneider EcoStruxure Control Expert / Unity Pro XEF',
  sniff: (head) => head.includes('<FEFExchangeFile'),
})

export const ADAPTERS: ProjectAdapter[] = [l5xAdapter, plcopenAdapter, siemensTiaAdapter, schneiderXefAdapter]

/** Lower-cased extension including the dot, or '' when the name has none. */
export function fileExtension(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

/** First adapter whose sniff matches, or null. `head` is the start of the decoded text. */
export function detectAdapter(name: string, head: string): ProjectAdapter | null {
  const h = head.length > SNIFF_CHARS ? head.slice(0, SNIFF_CHARS) : head
  for (const a of ADAPTERS) if (a.canParse({ name, head: h })) return a
  return null
}

/**
 * Detect the format and parse. Throws ProjectParseError:
 * EXTENSION_NOT_ALLOWED, FORMAT_UNRECOGNIZED, FORMAT_NOT_SUPPORTED, or any
 * XML_* / L5X_* parse error.
 */
export function parseProjectText(name: string, text: string, options?: ParseOptions): { project: ParsedProject; adapter: ProjectAdapter } {
  const ext = fileExtension(name)
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new ProjectParseError(
      'EXTENSION_NOT_ALLOWED',
      `${ext === '' ? 'The file has no extension' : `Files with the extension "${ext.slice(0, 16)}" are not accepted`}. ` +
        'INTERLOCK accepts PLC project exports: .L5X (Rockwell), plus .xml / .xef for recognizing planned formats.',
      { location: '(file)' },
    )
  }
  const adapter = detectAdapter(name, text.slice(0, SNIFF_CHARS))
  if (adapter === null) {
    throw new ProjectParseError(
      'FORMAT_UNRECOGNIZED',
      'The file is not a recognized PLC project export. INTERLOCK parses Rockwell Logix Designer L5X exports (root element <RSLogix5000Content>).',
      { location: '(file)' },
    )
  }
  return { project: adapter.parse(text, options), adapter }
}
