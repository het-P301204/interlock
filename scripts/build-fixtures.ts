/**
 * Writes every generated fixture under fixtures/.
 *
 *   node scripts/build-fixtures.ts          write fixtures to disk
 *   node scripts/build-fixtures.ts --check  regenerate in memory; exit 1 and list
 *                                           every file that is missing or differs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFixtureFiles } from '../fixtures/src/build.ts'
import type { FixtureFile } from '../fixtures/src/types.ts'

export const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

/** Paths (relative to fixtures/) whose disk content is missing or differs from `files`. */
export function diffAgainstDisk(files: FixtureFile[], root: string = FIXTURES_DIR): string[] {
  const stale: string[] = []
  for (const f of files) {
    let onDisk: string | undefined
    try {
      onDisk = readFileSync(join(root, f.path), 'utf8')
    } catch {
      onDisk = undefined
    }
    if (onDisk !== f.content) stale.push(f.path)
  }
  return stale
}

export function writeFixtures(files: FixtureFile[], root: string = FIXTURES_DIR): void {
  for (const f of files) {
    const target = join(root, f.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, f.content, 'utf8')
  }
}

function main(argv: string[]): number {
  const files = buildFixtureFiles()
  if (argv.includes('--check')) {
    const stale = diffAgainstDisk(files)
    if (stale.length > 0) {
      console.error(`fixtures out of date (${stale.length} of ${files.length}); run: npm run fixtures`)
      for (const p of stale) console.error(`  fixtures/${p}`)
      return 1
    }
    console.log(`fixtures up to date (${files.length} files)`)
    return 0
  }
  writeFixtures(files)
  for (const f of files) console.log(`wrote fixtures/${f.path} (${Buffer.byteLength(f.content, 'utf8')} bytes)`)
  return 0
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exitCode = main(process.argv.slice(2))
