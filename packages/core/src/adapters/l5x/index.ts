import type { ProjectAdapter } from '../types.ts'
import { L5X_FORMAT_LABEL, L5X_VENDOR, parseL5x } from './parse.ts'

/** Version of the L5X adapter; recorded with every analysis as ParserInfo.version. */
export const PARSER_VERSION = '1.0.0'

export const l5xAdapter: ProjectAdapter = {
  id: 'rockwell-l5x',
  label: 'Rockwell Logix Designer (L5X)',
  format: 'L5X',
  vendor: L5X_VENDOR,
  status: 'SUPPORTED',
  version: PARSER_VERSION,
  extensions: ['.l5x'],
  canParse({ name, head }) {
    return name.toLowerCase().endsWith('.l5x') || head.includes('<RSLogix5000Content')
  },
  parse(text, options) {
    return parseL5x(text, options)
  },
}

export { parseL5x, L5X_FORMAT_LABEL, L5X_VENDOR }
