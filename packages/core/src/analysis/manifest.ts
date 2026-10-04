/**
 * Validation of engineer-supplied safety declarations. The manifest is
 * untrusted input like the project files: strict schema, bounded sizes,
 * invisible characters stripped from every string.
 */
import { z } from 'zod'
import type { ManifestValidation } from '../api-types.ts'
import type { SafetyManifest } from '../model/safety.ts'
import { cleanText } from '../util/sanitize.ts'

const text = (max: number) => z.string().transform((s) => cleanText(s).trim()).pipe(z.string().max(max))
const ident = z
  .string()
  .transform((s) => cleanText(s).trim())
  .pipe(z.string().min(1).max(200).regex(/^[\\A-Za-z_][A-Za-z0-9_.:[\]\\]*$/, 'must be a tag or routine name'))

const functionSchema = z
  .object({
    id: text(32).pipe(z.string().min(1).regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, "-" and "_" only')),
    name: text(160).pipe(z.string().min(1)),
    description: text(2000).optional(),
    kind: z.enum(['SHUTDOWN', 'TRIP', 'INTERLOCK', 'PERMISSIVE', 'ALARM']),
    criticality: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
    implementation: z
      .object({ program: ident.optional(), routine: ident.optional(), module: ident.optional(), instance: ident.optional() })
      .strict(),
    protectiveOutput: z.object({ tag: ident, tripState: z.enum(['DE_ENERGIZE', 'ENERGIZE']) }).strict().optional(),
    alarm: z.object({ tag: ident, notification: text(300).optional() }).strict().optional(),
    enableCondition: text(200).optional(),
    notes: text(4000).optional(),
  })
  .strict()

const manifestSchema = z
  .object({
    schema: z.literal('interlock.safety/v1'),
    project: text(200).optional(),
    functions: z.array(functionSchema).max(500),
    nonSafetyScope: z
      .object({ programs: z.array(ident).max(1000).optional(), routines: z.array(z.string().transform((s) => cleanText(s).trim()).pipe(z.string().min(1).max(300))).max(5000).optional() })
      .strict()
      .optional(),
  })
  .strict()

export function validateManifest(json: unknown): ManifestValidation {
  const r = manifestSchema.safeParse(json)
  if (!r.success) {
    return { ok: false, issues: r.error.issues.slice(0, 50).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
  }
  const m = r.data as SafetyManifest
  const issues: string[] = []
  const ids = new Set<string>()
  m.functions.forEach((f, i) => {
    if (ids.has(f.id.toLowerCase())) issues.push(`functions.${i}.id: duplicate id ${f.id}`)
    ids.add(f.id.toLowerCase())
    if (!f.protectiveOutput && !f.alarm) issues.push(`functions.${i}: declare a protectiveOutput, an alarm, or both`)
    if (f.kind === 'ALARM' && !f.alarm) issues.push(`functions.${i}: an ALARM function needs an alarm`)
  })
  return issues.length ? { ok: false, issues } : { ok: true, manifest: m }
}

/** Parse manifest text (JSON). Never throws. */
export function parseManifestText(textValue: string): ManifestValidation {
  if (textValue.length > 2 * 1024 * 1024) return { ok: false, issues: ['The safety declarations file is larger than 2 MB.'] }
  let json: unknown
  try {
    json = JSON.parse(textValue)
  } catch (e) {
    return { ok: false, issues: [`Not valid JSON: ${(e as Error).message}`] }
  }
  return validateManifest(json)
}
