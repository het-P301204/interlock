import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { jsonSafe, term, termDocument } from '../src/terminal.ts'

const ROOT = resolve(import.meta.dirname, '..', '..', '..')
const MAIN = join(ROOT, 'apps', 'cli', 'src', 'main.ts')
const FX = (p: string) => join(ROOT, 'fixtures', p)
const MANIFEST = FX('manifests/northgate.safety.json')
const tmp = mkdtempSync(join(tmpdir(), 'interlock-cli-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function cli(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [MAIN, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '', FORCE_COLOR: '0', ...env }, timeout: 60_000 })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

const cp = (n: number) => String.fromCodePoint(n)
const ESC = cp(0x1b)
const CSI = cp(0x9b)
const RLO = cp(0x202e)

describe('basics', () => {
  it('prints version and help', () => {
    const v = cli(['--version'])
    expect(v.code).toBe(0)
    expect(v.stdout).toMatch(/^interlock \d+\.\d+\.\d+ \(engine \d+\.\d+\.\d+\)/)
    const h = cli(['--help'])
    expect(h.code).toBe(0)
    expect(h.stdout).toContain('--fail-on')
    expect(cli([]).code).toBe(1)
  })

  it('exits 1 on usage errors', () => {
    expect(cli(['bogus']).code).toBe(1)
    expect(cli(['analyze', FX('l5x/baseline-safe.L5X')]).code).toBe(1)
    const noManifest = cli(['analyze', FX('l5x/baseline-safe.L5X'), FX('l5x/current-normal.L5X')])
    expect(noManifest.code).toBe(1)
    expect(noManifest.stderr).toContain('--manifest')
    expect(cli(['analyze', FX('l5x/baseline-safe.L5X'), FX('l5x/current-normal.L5X'), '-m', MANIFEST, '--format', 'exe']).code).toBe(1)
    expect(cli(['analyze', FX('l5x/baseline-safe.L5X'), FX('l5x/current-normal.L5X'), '-m', MANIFEST, '--fail-on', 'sometimes']).code).toBe(1)
    expect(cli(['inspect', join(tmp, 'missing.L5X')]).code).toBe(1)
  })
})

describe('inspect', () => {
  it('summarises a valid export', () => {
    const r = cli(['inspect', FX('l5x/baseline-safe.L5X')])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('NORTHGATE_PS')
    expect(r.stdout).toMatch(/Readiness\s+READY/)
    const j = cli(['inspect', FX('l5x/baseline-safe.L5X'), '--format', 'json'])
    expect(JSON.parse(j.stdout).summary.metadata.controllerName).toBe('NORTHGATE_PS')
  })

  it('rejects a hostile file with its error code and exit 1', () => {
    const r = cli(['inspect', FX('adversarial/xxe-external-entity.L5X')])
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('XML_DOCTYPE_FORBIDDEN')
    expect(r.stdout).not.toContain('/etc/passwd:')
  })
})

describe('analyze', () => {
  const base = FX('l5x/baseline-safe.L5X')
  const weakened = FX('l5x/current-shutdown-weakened.L5X')

  it('exits 2 when a gating finding exists and 0 with --fail-on none', () => {
    const fail = cli(['analyze', base, weakened, '--manifest', MANIFEST])
    expect(fail.code).toBe(2)
    expect(fail.stdout).toContain('NEW_INHIBIT')
    expect(fail.stdout).toContain('Gate: FAIL')
    const none = cli(['analyze', base, weakened, '--manifest', MANIFEST, '--fail-on', 'none'])
    expect(none.code).toBe(0)
  })

  it('passes a normal maintenance change at the default threshold', () => {
    const r = cli(['scenario', '01'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('Gate: pass')
    // At --fail-on low the cosmetic change is INFORMATIONAL, so it still passes.
    expect(cli(['scenario', '01', '--fail-on', 'low']).code).toBe(0)
  })

  it('gates UNDECLARED findings too', () => {
    const r = cli(['scenario', '06', '--fail-on', 'medium'])
    expect(r.code).toBe(2)
    expect(r.stdout).toContain('UNDECLARED_LOGIC_CHANGED')
  })

  it('exits 1 when an input fails to parse', () => {
    const r = cli(['analyze', base, FX('adversarial/truncated.L5X'), '--manifest', MANIFEST])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('XML_UNCLOSED_TAG')
    const badManifest = join(tmp, 'bad.safety.json')
    writeFileSync(badManifest, JSON.stringify({ schema: 'interlock.safety/v1', functions: [{ id: 'x' }] }))
    const m = cli(['analyze', base, weakened, '--manifest', badManifest])
    expect(m.code).toBe(1)
    expect(m.stderr).toContain('not valid')
  })

  it('writes json, md, csv and pdf; the gate verdict goes to stderr', () => {
    const j = cli(['analyze', base, weakened, '-m', MANIFEST, '--format', 'json'])
    expect(j.code).toBe(2)
    expect(JSON.parse(j.stdout).schema).toBe('interlock.analysis/v1')
    expect(j.stderr).toContain('Gate: FAIL')
    expect(cli(['analyze', base, weakened, '-m', MANIFEST, '--format', 'md', '--fail-on', 'none']).stdout).toContain('IL-0001')
    expect(cli(['analyze', base, weakened, '-m', MANIFEST, '--format', 'csv', '--fail-on', 'none']).stdout).toContain('NEW_INHIBIT')
    const pdf = join(tmp, 'report.pdf')
    const p = cli(['analyze', base, weakened, '-m', MANIFEST, '--format', 'pdf', '--out', pdf, '--fail-on', 'none'])
    expect(p.code).toBe(0)
    expect(readFileSync(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('emits structurally valid SARIF 2.1.0', () => {
    const r = cli(['analyze', 'fixtures/l5x/baseline-safe.L5X', 'fixtures/l5x/current-shutdown-weakened.L5X', '-m', MANIFEST, '--format', 'sarif'])
    expect(r.code).toBe(2)
    const s = JSON.parse(r.stdout)
    expect(s.version).toBe('2.1.0')
    expect(s.$schema).toContain('sarif-2.1.0')
    expect(s.runs).toHaveLength(1)
    const run = s.runs[0]
    const rules = run.tool.driver.rules as { id: string; shortDescription: { text: string }; defaultConfiguration: { level: string } }[]
    expect(run.tool.driver.name).toBe('INTERLOCK')
    expect(new Set(rules.map((x) => x.id)).size).toBe(rules.length)
    for (const rule of rules) {
      expect(rule.shortDescription.text.length).toBeGreaterThan(0)
      expect(['error', 'warning', 'note']).toContain(rule.defaultConfiguration.level)
    }
    expect(run.results.length).toBeGreaterThanOrEqual(2)
    for (const res of run.results) {
      expect(rules[res.ruleIndex]!.id).toBe(res.ruleId)
      expect(['error', 'warning', 'note']).toContain(res.level)
      expect(res.message.text.length).toBeGreaterThan(0)
      const loc = res.locations[0].physicalLocation
      expect(loc.artifactLocation.uri).toBe('fixtures/l5x/current-shutdown-weakened.L5X')
      if (loc.region) expect(Number.isInteger(loc.region.startLine) && loc.region.startLine > 0).toBe(true)
      expect(typeof res.partialFingerprints['interlockFingerprint/v1']).toBe('string')
    }
    const inhibit = run.results.find((x: { properties: { type: string } }) => x.properties.type === 'NEW_INHIBIT')
    expect(inhibit.level).toBe('error')
    expect(inhibit.locations[0].physicalLocation.region.startLine).toBeGreaterThan(1)
    expect(run.artifacts[0].hashes['sha-256']).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('drift and scenarios', () => {
  it('reports AOI drift across sites', () => {
    const r = cli(['drift', `A=${FX('l5x/site-a.L5X')}`, `B=${FX('l5x/site-b-drift.L5X')}`, '--format', 'json'])
    expect(r.code).toBe(0)
    const d = JSON.parse(r.stdout)
    expect(d.modules.find((m: { module: string }) => m.module === 'AOI_PumpInterlock').flags).toContain('REVISION_NOT_BUMPED')
    expect(cli(['drift', `A=${FX('l5x/site-a.L5X')}`]).code).toBe(1)
    expect(cli(['drift', `A=${FX('l5x/site-a.L5X')}`, `a=${FX('l5x/site-b-drift.L5X')}`]).code).toBe(1)
  })

  it('lists and runs built-in scenarios', () => {
    const l = cli(['scenarios'])
    expect(l.code).toBe(0)
    expect(l.stdout).toContain('04')
    const four = cli(['scenario', '04', '--fail-on', 'none'])
    expect(four.code).toBe(0)
    expect(four.stdout).toContain('SHARED_MODULE_PROPAGATION')
    expect(cli(['scenario', '07']).stdout).toContain('AOI_ValveCtl')
    expect(cli(['scenario', '99']).code).toBe(1)
  })
})

describe('terminal escape injection', () => {
  it('term() strips C0, C1, DEL, bidi and newlines', () => {
    const hostile = `A${ESC}]0;pwned${cp(7)}B${CSI}31mC${RLO}D${cp(0x7f)}E\nF\rG${cp(0x200b)}H`
    const out = term(hostile)
    expect(out).not.toMatch(new RegExp(`[${cp(0)}-${cp(0x1f)}${cp(0x7f)}-${cp(0x9f)}${RLO}${cp(0x200b)}]`, 'u'))
    expect(out).toContain('pwned')
    expect(termDocument(`a${ESC}[2Jb\nc${CSI}d`)).toBe('a[2Jb\ncd')
    const j = jsonSafe(JSON.stringify({ x: `${CSI}${RLO}` }))
    expect(j).toBe('{"x":"\\u009b\\u202e"}')
    expect(JSON.parse(j).x).toBe(`${CSI}${RLO}`)
  })

  it('never prints control or bidi characters from a hostile export', () => {
    const src = readFileSync(FX('l5x/current-shutdown-weakened.L5X'), 'utf8')
    // C1 CSI and an RLO override in attributes that are printed (names, revisions, dates).
    const hostile = src
      .replace('ProcessorType="1756-L83E"', `ProcessorType="1756${CSI}2J${RLO}L83E"`)
      .replace('ExportDate="Mon Sep 28 16:47:30 2026"', `ExportDate="Mon${CSI}31m Sep${RLO} 28"`)
    const file = join(tmp, 'hostile.L5X')
    writeFileSync(file, hostile, 'utf8')
    // And an ESC as a character reference, which an XML parser could decode into a raw ESC.
    const escFile = join(tmp, 'hostile-esc.L5X')
    writeFileSync(escFile, src.replace('ProcessorType="1756-L83E"', 'ProcessorType="1756&#x1B;]0;owned&#x7;L83E"'), 'utf8')
    const outputs = [
      cli(['inspect', file]),
      cli(['inspect', escFile]),
      cli(['analyze', FX('l5x/baseline-safe.L5X'), file, '-m', MANIFEST]),
      cli(['analyze', FX('l5x/baseline-safe.L5X'), escFile, '-m', MANIFEST]),
      cli(['analyze', FX('l5x/baseline-safe.L5X'), file, '-m', MANIFEST, '--format', 'md']),
      cli(['analyze', FX('l5x/baseline-safe.L5X'), file, '-m', MANIFEST, '--format', 'json']),
      cli(['analyze', FX('l5x/baseline-safe.L5X'), file, '-m', MANIFEST, '--format', 'sarif']),
    ]
    const bad = new RegExp(`[${cp(0)}-${cp(8)}${cp(0x0b)}-${cp(0x1f)}${cp(0x7f)}-${cp(0x9f)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`, 'u')
    for (const o of outputs) {
      expect(o.code === 0 || o.code === 1 || o.code === 2).toBe(true)
      expect(o.stdout).not.toMatch(bad)
      expect(o.stderr).not.toMatch(bad)
    }
    // The hostile file was still analyzed (the characters were neutralised, not fatal).
    expect(outputs[2]!.stdout).toContain('NEW_INHIBIT')
  })
})
