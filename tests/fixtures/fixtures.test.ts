/**
 * Fixture generator tests. These deliberately do not use the INTERLOCK parser
 * (it is a separate component): XML well-formedness is checked with a tiny
 * local scanner, and scenario edits are checked against the plant model and
 * against a line diff of the written L5X.
 */
import { describe, expect, it } from 'vitest'
import { diffAgainstDisk } from '../../scripts/build-fixtures.ts'
import { buildFixtureFiles, buildModels, expectedById } from '../../fixtures/src/build.ts'
import { rungMap } from '../../fixtures/src/edit.ts'
import { LARGE_EXTRA_TAGS, LARGE_PUMPS, largeBaseline, largeCurrent, mulberry32 } from '../../fixtures/src/large.ts'
import { northgateLargeManifest, northgateManifest } from '../../fixtures/src/manifest.ts'
import { scenarioRegistry } from '../../fixtures/src/registry.ts'
import type { ControllerModel, ExpectedCompare, ExpectedDrift, FixtureFile } from '../../fixtures/src/types.ts'
import type { SafetyManifest } from '../../packages/core/src/model/safety.ts'

const files = buildFixtureFiles()
const byPath = new Map(files.map((f) => [f.path, f.content]))
const models = buildModels()

function file(path: string): string {
  const c = byPath.get(path)
  if (c === undefined) throw new Error(`not generated: ${path}`)
  return c
}

function model(path: string): ControllerModel {
  const m = models.get(path)
  if (m === undefined) throw new Error(`no model: ${path}`)
  return m
}

/* --------------------------------------------------------- XML scanner */

const NAME = /^[A-Za-z_:][-A-Za-z0-9_.:]*/
const ENTITY = /^&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/

function checkEntities(text: string, at: number): string | undefined {
  for (let k = text.indexOf('&'); k !== -1; k = text.indexOf('&', k + 1)) {
    if (!ENTITY.test(text.slice(k))) return `bad entity at ${at + k}`
  }
  return undefined
}

/** Returns undefined when `xml` is a well-formed document, else a reason. */
function wellFormed(xml: string): string | undefined {
  if (!xml.startsWith('<?xml ')) return 'missing XML declaration'
  const stack: string[] = []
  let roots = 0
  let i = 0
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    const text = xml.slice(i, lt === -1 ? xml.length : lt)
    if (text.trim() !== '' && stack.length === 0) return `text outside root at ${i}`
    const bad = checkEntities(text, i)
    if (bad !== undefined) return bad
    if (lt === -1) break
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt)
      if (end === -1) return 'unterminated PI'
      i = end + 2
      continue
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt)
      if (end === -1) return 'unterminated comment'
      i = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      if (stack.length === 0) return 'CDATA outside root'
      const end = xml.indexOf(']]>', lt + 9)
      if (end === -1) return 'unterminated CDATA'
      i = end + 3
      continue
    }
    if (xml.startsWith('</', lt)) {
      const m = NAME.exec(xml.slice(lt + 2))
      if (m === null) return `bad end tag at ${lt}`
      let j = lt + 2 + m[0].length
      while (/\s/.test(xml[j] ?? '')) j++
      if (xml[j] !== '>') return `bad end tag at ${lt}`
      const open = stack.pop()
      if (open !== m[0]) return `</${m[0]}> closes <${open ?? ''}> at ${lt}`
      i = j + 1
      continue
    }
    const m = NAME.exec(xml.slice(lt + 1))
    if (m === null) return `bad start tag at ${lt}`
    let j = lt + 1 + m[0].length
    const seen = new Set<string>()
    for (;;) {
      const ws = j
      while (/\s/.test(xml[j] ?? '')) j++
      if (xml.startsWith('/>', j)) {
        j += 2
        if (stack.length === 0) roots++
        break
      }
      if (xml[j] === '>') {
        j += 1
        if (stack.length === 0) roots++
        stack.push(m[0])
        break
      }
      if (j === ws) return `missing whitespace before attribute at ${j}`
      const a = NAME.exec(xml.slice(j))
      if (a === null) return `bad attribute at ${j}`
      if (seen.has(a[0])) return `duplicate attribute ${a[0]} at ${j}`
      seen.add(a[0])
      j += a[0].length
      if (xml[j] !== '=') return `attribute without value at ${j}`
      const q = xml[j + 1]
      if (q !== '"' && q !== "'") return `unquoted attribute at ${j}`
      const end = xml.indexOf(q, j + 2)
      if (end === -1) return 'unterminated attribute'
      const value = xml.slice(j + 2, end)
      if (value.includes('<')) return `< in attribute at ${j}`
      const badEntity = checkEntities(value, j + 2)
      if (badEntity !== undefined) return badEntity
      j = end + 1
    }
    i = j
  }
  if (stack.length > 0) return `unclosed <${stack.join('> <')}>`
  if (roots !== 1) return `expected one root element, found ${roots}`
  return undefined
}

/* ---------------------------------------------------------- rung text */

function balanced(text: string): boolean {
  const stack: string[] = []
  for (const ch of text) {
    if (ch === '(' || ch === '[') stack.push(ch)
    else if (ch === ')' || ch === ']') {
      const open = stack.pop()
      if ((ch === ')' && open !== '(') || (ch === ']' && open !== '[')) return false
    }
  }
  return stack.length === 0
}

/** Rung texts as written in the L5X (CDATA line between <Text> and </Text>). */
function rungTextsInFile(xml: string): string[] {
  const out: string[] = []
  const re = /<Text>\n<!\[CDATA\[(.*?)\]\]>\n<\/Text>/g
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) out.push(m[1] ?? '')
  return out
}

/* ------------------------------------------------------------ line diff */

function header(line: string): boolean {
  return line.startsWith('<RSLogix5000Content ') || line.startsWith('<Controller ')
}

/** LCS line diff, header lines excluded. Returns removed and added lines. */
function lineDiff(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split('\n').filter((l) => !header(l))
  const b = after.split('\n').filter((l) => !header(l))
  const n = a.length
  const m = b.length
  const w = m + 1
  const dp = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? (dp[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(dp[(i + 1) * w + j] ?? 0, dp[i * w + j + 1] ?? 0)
    }
  }
  const removed: string[] = []
  const added: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if ((dp[(i + 1) * w + j] ?? 0) >= (dp[i * w + j + 1] ?? 0)) removed.push(a[i++] ?? '')
    else added.push(b[j++] ?? '')
  }
  while (i < n) removed.push(a[i++] ?? '')
  while (j < m) added.push(b[j++] ?? '')
  return { removed, added }
}

const cd = (text: string): string => `<![CDATA[${text}]]>`

/* ---------------------------------------------------------- model diff */

function changedRoutines(base: ControllerModel, cur: ControllerModel): Map<string, string[]> {
  const a = rungMap(base)
  const b = rungMap(cur)
  const out = new Map<string, string[]>()
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const before = (a.get(key) ?? []).map((r) => r.text)
    const after = (b.get(key) ?? []).map((r) => r.text)
    if (JSON.stringify(before) !== JSON.stringify(after)) out.set(key, after)
  }
  return out
}

function docDiffs(base: ControllerModel, cur: ControllerModel): { descriptions: string[]; comments: string[] } {
  const descriptions: string[] = []
  const comments: string[] = []
  const baseTags = new Map(base.tags.map((t) => [t.name, t.description]))
  for (const t of cur.tags) {
    const d = baseTags.get(t.name)
    if (d !== undefined && d !== t.description) descriptions.push(t.name)
  }
  const a = rungMap(base)
  for (const [key, rungs] of rungMap(cur)) {
    const old = a.get(key)
    if (old === undefined || old.length !== rungs.length) continue
    rungs.forEach((r, i) => {
      if (r.comment !== old[i]?.comment) comments.push(`${key}#${i}`)
    })
  }
  return { descriptions, comments }
}

function addedTags(base: ControllerModel, cur: ControllerModel): string[] {
  const names = new Set(base.tags.map((t) => t.name))
  return cur.tags.filter((t) => !names.has(t.name)).map((t) => t.name)
}

const BASE = 'l5x/baseline-safe.L5X'
const base = model(BASE)
const ESD = 'XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)XIO(Fire_Detected)OTE(MCC_Main_Enable);'

/* ================================================================ tests */

describe('generator', () => {
  it('is deterministic: two runs produce identical files', () => {
    const again = buildFixtureFiles()
    expect(again.map((f) => f.path)).toEqual(files.map((f) => f.path))
    for (const f of again) expect(f.content, f.path).toBe(byPath.get(f.path))
    expect(largeCurrent(largeBaseline())).toEqual(largeCurrent(largeBaseline()))
  })

  it('seeded PRNG is stable', () => {
    const r = mulberry32(42)
    const seq = [r(), r(), r()]
    const r2 = mulberry32(42)
    expect([r2(), r2(), r2()]).toEqual(seq)
    expect(seq.every((x) => x >= 0 && x < 1)).toBe(true)
  })

  it('generates exactly the expected set of outputs', () => {
    const l5x = [
      'baseline-safe',
      'current-normal',
      'current-shutdown-weakened',
      'current-alarm-suppressed',
      'current-aoi-modified',
      'current-protective-bypass',
      'current-undeclared-change',
      'current-path-removed',
      'site-a',
      'site-b-drift',
      'site-c-legacy',
      'baseline-large',
      'current-large',
    ].map((n) => `l5x/${n}.L5X`)
    const expected = [
      ...l5x,
      'manifests/northgate.safety.json',
      'manifests/northgate-large.safety.json',
      'scenarios.json',
      'README.md',
      ...scenarioRegistry().scenarios.map((s) => s.expected),
    ].sort()
    expect(files.map((f) => f.path)).toEqual(expected)
  })

  it('--check passes against the files on disk', () => {
    expect(diffAgainstDisk(files)).toEqual([])
  })

  it('--check reports a file that differs', () => {
    const tampered: FixtureFile[] = files.map((f) => (f.path === 'scenarios.json' ? { path: f.path, content: f.content + ' ' } : f))
    expect(diffAgainstDisk(tampered)).toEqual(['scenarios.json'])
  })
})

describe('local checkers reject bad input', () => {
  it('well-formedness scanner', () => {
    const decl = '<?xml version="1.0"?>\n'
    expect(wellFormed(`${decl}<a><b/></a>`)).toBeUndefined()
    expect(wellFormed(`${decl}<a><![CDATA[x]]]></a>`)).toBeUndefined()
    expect(wellFormed(`${decl}<a><b></a>`)).toBeDefined()
    expect(wellFormed(`${decl}<a x="1" x="2"/>`)).toBeDefined()
    expect(wellFormed(`${decl}<a>&bogus;</a>`)).toBeDefined()
    expect(wellFormed(`${decl}<a><![CDATA[x</a>`)).toBeDefined()
    expect(wellFormed(`${decl}<a/><b/>`)).toBeDefined()
    expect(wellFormed(`${decl}<a x=1/>`)).toBeDefined()
  })

  it('bracket balance', () => {
    expect(balanced('[XIC(A) ,XIC(B) ]OTE(C);')).toBe(true)
    expect(balanced('[XIC(A) ,XIC(B) OTE(C);')).toBe(false)
    expect(balanced('[XIC(A] ,XIC(B) )OTE(C);')).toBe(false)
  })
})

describe('L5X files', () => {
  const l5xFiles = files.filter((f) => f.path.endsWith('.L5X'))
  const DATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2} \d{2}:\d{2}:\d{2} \d{4}$/

  it.each(l5xFiles.map((f) => [f.path, f.content]))('%s is well-formed XML laid out like a Logix export', (_path, xml) => {
    expect(wellFormed(xml)).toBeUndefined()
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<RSLogix5000Content SchemaRevision="1.0" ')).toBe(true)
    expect(xml.includes('\r')).toBe(false)
    expect(xml.endsWith('</RSLogix5000Content>\n')).toBe(true)
    for (const attr of ['ExportDate', 'LastModifiedDate', 'ProjectCreationDate']) {
      const m = new RegExp(`${attr}="([^"]*)"`).exec(xml)
      expect(m?.[1], attr).toMatch(DATE)
    }
    // No indentation: every line starts at column 0.
    expect(xml.split('\n').some((l) => /^\s/.test(l))).toBe(false)
  })

  it('weekday in Logix dates is correct', () => {
    expect(file('l5x/current-normal.L5X')).toContain('ExportDate="Wed Sep 30 14:12:09 2026"')
    expect(file(BASE)).toContain('ProjectCreationDate="Mon Feb 12 09:02:11 2024"')
  })

  it('every rung balances brackets and parentheses and ends with ";"', () => {
    for (const [path, m] of models) {
      for (const [key, rungs] of rungMap(m)) {
        for (const r of rungs) {
          expect(balanced(r.text), `${path} ${key}: ${r.text}`).toBe(true)
          expect(r.text.endsWith(';'), `${path} ${key}: ${r.text}`).toBe(true)
        }
      }
      const inFile = rungTextsInFile(file(path))
      expect(inFile.length).toBe([...rungMap(m).values()].reduce((s, r) => s + r.length, 0))
      for (const t of inFile) expect(balanced(t), `${path}: ${t}`).toBe(true)
    }
  })

  it('AOI calls pass the backing tag plus every required parameter', () => {
    for (const [path, m] of models) {
      const aois = new Map(m.aois.map((a) => [a.name, a]))
      for (const [key, rungs] of rungMap(m)) {
        for (const r of rungs) {
          const call = /^(AOI_\w+)\(([^)]*)\);$/.exec(r.text)
          if (call === null) continue
          const def = aois.get(call[1] ?? '')
          expect(def, `${path} ${key}`).toBeDefined()
          const required = def?.parameters.filter((p) => p.required).length ?? 0
          expect((call[2] ?? '').split(',').length, `${path} ${key}`).toBe(1 + required)
        }
      }
    }
  })

  it('every rung operand that looks like a tag exists in the project', () => {
    const KEYWORDS = new Set(['XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'JSR', 'GRT', 'LES', 'TON', 'RTO', 'ALMD'])
    for (const [path, m] of models) {
      const known = new Set<string>(m.tags.map((t) => t.name))
      for (const p of m.programs) {
        for (const t of p.tags) known.add(t.name)
        for (const r of p.routines) known.add(r.name)
      }
      for (const a of m.aois) known.add(a.name)
      for (const p of m.programs) {
        for (const r of p.routines) {
          for (const g of r.rungs) {
            for (const token of g.text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
              if (KEYWORDS.has(token)) continue
              if (/^(DN|EN|TT|PRE|ACC|Shutdown_Alarm)$/.test(token)) continue
              expect(known.has(token), `${path} ${p.name}/${r.name}: ${token}`).toBe(true)
            }
          }
        }
      }
    }
  })
})

describe('scenario edits land exactly where intended', () => {
  it('site-a is the baseline re-exported', () => {
    const d = lineDiff(file(BASE), file('l5x/site-a.L5X'))
    expect(d).toEqual({ removed: [], added: [] })
    expect(file('l5x/site-a.L5X')).not.toBe(file(BASE))
  })

  it('01 normal maintenance', () => {
    const cur = model('l5x/current-normal.L5X')
    const ch = changedRoutines(base, cur)
    expect([...ch.keys()].sort()).toEqual(['Reporting/Main', 'Safety/ESD', 'Safety/Overflow', 'Utilities/Lighting'])
    expect(ch.get('Safety/ESD')).toEqual(['XIO(Fire_Detected)XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)OTE(MCC_Main_Enable);', 'XIO(MCC_Main_Enable)OTE(ESD_Active);'])
    expect(ch.get('Safety/Overflow')).toEqual(['[XIC(LSHH_101) ,GRT(LT101_PV,92.0) ]OTE(XV101_Close_Cmd);'])
    expect(ch.get('Utilities/Lighting')).toEqual(['XIC(Maintenance_Mode)OTE(Panel_Light_Maint);', 'XIC(Dusk_Sensor)XIO(Lamp_Test)OTE(Yard_Lights);'])
    expect(ch.get('Reporting/Main')).toEqual(['XIC(Pump_01_Run_Enable)RTO(Pump_01_Hours,1800000,0);', 'XIC(Pump_02_Run_Enable)RTO(Pump_02_Hours,3600000,0);'])
    const docs = docDiffs(base, cur)
    expect(docs.descriptions).toHaveLength(6)
    expect(docs.comments).toHaveLength(4)
    expect(addedTags(base, cur)).toEqual([])
    const d = lineDiff(file(BASE), file('l5x/current-normal.L5X'))
    expect(d.removed).toHaveLength(16)
    expect(d.added).toHaveLength(16)
    expect(d.removed).toContain(cd(ESD))
    expect(d.added).toContain(cd('XIC(Dusk_Sensor)XIO(Lamp_Test)OTE(Yard_Lights);'))
    expect(d.added).toContain('<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="1800000"/>')
    expect(file('l5x/current-normal.L5X')).toContain('ExportDate="Wed Sep 30 14:12:09 2026"')
  })

  it('02 shutdown weakened', () => {
    const cur = model('l5x/current-shutdown-weakened.L5X')
    const ch = changedRoutines(base, cur)
    expect([...ch.keys()]).toEqual(['Compressor/Main'])
    expect(ch.get('Compressor/Main')?.[0]).toBe('XIC(PT201_High)XIC(Safety_Enable)XIO(Maintenance_Mode)OTE(C201_Shutdown_Cmd);')
    expect(lineDiff(file(BASE), file('l5x/current-shutdown-weakened.L5X'))).toEqual({
      removed: [cd('XIC(PT201_High)XIC(Safety_Enable)OTE(C201_Shutdown_Cmd);')],
      added: [cd('XIC(PT201_High)XIC(Safety_Enable)XIO(Maintenance_Mode)OTE(C201_Shutdown_Cmd);')],
    })
  })

  it('03 alarm suppressed', () => {
    const cur = model('l5x/current-alarm-suppressed.L5X')
    const ch = changedRoutines(base, cur)
    expect([...ch.keys()]).toEqual(['Alarms/Main'])
    expect(ch.get('Alarms/Main')?.[0]).toBe('XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,High_Level_Inhibit,0);')
    expect(addedTags(base, cur)).toEqual(['High_Level_Inhibit'])
    const t = cur.tags.find((x) => x.name === 'High_Level_Inhibit')
    expect(t?.externalAccess).toBe('Read/Write')
    expect(t?.description).toBe('Nuisance alarm inhibit (temporary)')
    const d = lineDiff(file(BASE), file('l5x/current-alarm-suppressed.L5X'))
    expect(d.removed).toEqual([cd('XIC(LSHH_101)ALMD(LT101_HH_Alm,0,0,0,0);')])
    expect(d.added).toHaveLength(12)
    expect(d.added).toContain('<Tag Name="High_Level_Inhibit" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false" ExternalAccess="Read/Write">')
  })

  it('04 AOI modified', () => {
    const cur = model('l5x/current-aoi-modified.L5X')
    const ch = changedRoutines(base, cur)
    expect([...ch.keys()]).toEqual(['AOI_PumpInterlock/Logic'])
    expect(ch.get('AOI_PumpInterlock/Logic')?.[0]).toBe('[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ,XIC(ESD_Active) ]XIO(Maint_Bypass)OTE(Trip);')
    const a = cur.aois[0]
    expect(a?.revision).toBe('3.5')
    expect(a?.parameters.map((p) => p.name)).toEqual(['Run_Request', 'Level_HH', 'Press_Trip', 'Motor_Temp_Hi', 'ESD_Active', 'Run_Enable', 'Shutdown_Alarm', 'Maint_Bypass'])
    expect(a?.parameters.at(-1)).toMatchObject({ usage: 'Input', required: false, visible: true })
    const d = lineDiff(file(BASE), file('l5x/current-aoi-modified.L5X'))
    expect(d.removed).toHaveLength(3)
    expect(d.added).toHaveLength(19)
    expect(d.added.filter((l) => l === '<DataValueMember Name="Maint_Bypass" DataType="BOOL" Value="0"/>')).toHaveLength(5)
    expect(d.added).toContain('<Parameter Name="Maint_Bypass" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="true" ExternalAccess="Read/Write">')
    // Call sites are unchanged: Maint_Bypass is optional.
    for (let n = 1; n <= 5; n++) expect(rungMap(cur).get(`PumpControl/PUMP_0${n}`)?.[0]?.text).toBe(rungMap(base).get(`PumpControl/PUMP_0${n}`)?.[0]?.text)
  })

  it('05 protective bypass', () => {
    const cur = model('l5x/current-protective-bypass.L5X')
    const ch = changedRoutines(base, cur)
    expect([...ch.keys()].sort()).toEqual(['Utilities/Commissioning', 'Utilities/Main'])
    expect(ch.get('Utilities/Commissioning')).toEqual(['XIC(Pump_01_Manual_Override)OTL(Pump_01_Run_Enable);'])
    expect(ch.get('Utilities/Main')).toEqual(['JSR(Lighting,0);', 'JSR(HVAC,0);', 'JSR(Commissioning,0);'])
    expect(addedTags(base, cur)).toEqual(['Pump_01_Manual_Override'])
    const d = lineDiff(file(BASE), file('l5x/current-protective-bypass.L5X'))
    expect(d.removed).toEqual([])
    expect(d.added).toHaveLength(34)
  })

  it('06 undeclared change', () => {
    const cur = model('l5x/current-undeclared-change.L5X')
    const ch = changedRoutines(base, cur)
    expect([...ch.keys()].sort()).toEqual(['Auxiliary/SealWater', 'Auxiliary/Sump', 'PumpControl/PUMP_05'])
    expect(ch.get('Auxiliary/SealWater')).toEqual(['XIC(Pump_04_Run_Enable)OTE(Seal_Water_Valve_Open);'])
    expect(ch.get('Auxiliary/Sump')).toEqual(['XIC(Sump_Level_Hi)XIO(Sump_Pump_Fault)OTE(Sump_Pump_Run);'])
    expect(ch.get('PumpControl/PUMP_05')).toEqual(['AOI_PumpInterlock(PUMP_05_IL,Pump_05_Run_Request,LSHH_101,Pump_05_Disch_Press_Hi,Pump_05_Motor_Temp_Hi,ESD_Active,Pump_05_Run_Enable);'])
    expect(addedTags(base, cur)).toEqual(['Sump_Pump_Fault'])
    const d = lineDiff(file(BASE), file('l5x/current-undeclared-change.L5X'))
    expect(d.removed).toHaveLength(10)
    expect(d.removed).toContain(cd('XIC(PUMP_05_IL.Shutdown_Alarm)OTE(Pump_05_Shutdown_Alarm);'))
    expect(d.added).toHaveLength(13)
  })

  it('09 path removed', () => {
    const cur = model('l5x/current-path-removed.L5X')
    const ch = changedRoutines(base, cur)
    expect([...ch.keys()].sort()).toEqual(['PumpControl/Main', 'Safety/ESD'])
    expect(ch.get('Safety/ESD')?.[0]).toBe('XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)OTE(MCC_Main_Enable);')
    expect(ch.get('PumpControl/Main')).toEqual(['JSR(PUMP_01,0);', 'JSR(PUMP_02,0);', 'JSR(PUMP_04,0);', 'JSR(PUMP_05,0);'])
    // PUMP_03 still exists; it is simply never called.
    expect(rungMap(cur).has('PumpControl/PUMP_03')).toBe(true)
    const d = lineDiff(file(BASE), file('l5x/current-path-removed.L5X'))
    expect(d.removed).toContain(cd(ESD))
    expect(d.removed).toContain(cd('JSR(PUMP_03,0);'))
    expect(d.added).toContain(cd('XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)OTE(MCC_Main_Enable);'))
    expect(d.added.every((l) => /^<Rung Number="\d" Type="N">$/.test(l) || l.startsWith('<![CDATA['))).toBe(true)
  })

  it('07 drift sites', () => {
    const b = model('l5x/site-b-drift.L5X')
    const c = model('l5x/site-c-legacy.L5X')
    const a = model('l5x/site-a.L5X')
    expect(a.aois).toEqual(base.aois)
    expect([...changedRoutines(base, b).keys()]).toEqual(['AOI_PumpInterlock/Logic'])
    expect(b.aois[0]?.revision).toBe('3.4')
    expect(rungMap(b).get('AOI_PumpInterlock/Logic')?.[0]?.text).toBe('[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(ESD_Active) ]OTE(Trip);')
    expect(b.name).toBe('EASTFIELD_PS')

    expect(c.name).toBe('RIVERBEND_PS')
    const pi = c.aois.find((x) => x.name === 'AOI_PumpInterlock')
    expect(pi?.revision).toBe('3.1')
    expect(pi?.parameters.some((p) => p.name === 'ESD_Active')).toBe(false)
    expect(rungMap(c).get('AOI_PumpInterlock/Logic')?.[0]?.text).toBe('[XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ]OTE(Trip);')
    expect(rungMap(c).get('PumpControl/PUMP_01')?.[0]?.text).toBe('AOI_PumpInterlock(PUMP_01_IL,Pump_01_Run_Request,LSHH_101,Pump_01_Disch_Press_Hi,Pump_01_Motor_Temp_Hi,Pump_01_Run_Enable);')
    expect(c.aois.map((x) => x.name)).toEqual(['AOI_PumpInterlock', 'AOI_ValveCtl'])
    expect(a.aois.some((x) => x.name === 'AOI_ValveCtl') || b.aois.some((x) => x.name === 'AOI_ValveCtl')).toBe(false)
    const xml = file('l5x/site-c-legacy.L5X')
    expect(xml).toContain('<LocalizedDescription Lang="en-US">')
    expect(xml).toContain('<LocalizedComment Lang="en-US">')
    expect(xml).toContain('SoftwareRevision="33.01"')
    expect(xml).not.toContain('<DataValueMember Name="ESD_Active"')
  })
})

describe('08 large noisy', () => {
  const lb = model('l5x/baseline-large.L5X')
  const lc = model('l5x/current-large.L5X')

  it('is the plant scaled to 24 pumps with 300 extra tags', () => {
    expect(rungMap(lb).get('PumpControl/Main')).toHaveLength(LARGE_PUMPS)
    for (let n = 1; n <= LARGE_PUMPS; n++) expect(rungMap(lb).has(`PumpControl/PUMP_${String(n).padStart(2, '0')}`)).toBe(true)
    expect(lb.tags.length - base.tags.length - (LARGE_PUMPS - 5) * 6).toBe(LARGE_EXTRA_TAGS)
    expect(lb.tags.filter((t) => t.dataType === 'AOI_PumpInterlock')).toHaveLength(LARGE_PUMPS)
  })

  it('has exactly the three logic changes', () => {
    const ch = changedRoutines(lb, lc)
    expect([...ch.keys()].sort()).toEqual(['Compressor/Main', 'Safety/ESD', 'Safety/Permissives'])
    expect(ch.get('Safety/Permissives')).toEqual(['XIC(MCC_Main_Enable)XIO(LSHH_101)GRT(Suction_Press_PV,8.0)OTE(Pump_Start_Permissive);'])
    expect(ch.get('Compressor/Main')?.[2]).toBe('LES(C201_Suction_PV,3.5)TON(C201_LP_Delay,10000,0);')
    expect(ch.get('Safety/ESD')?.[0]).toBe('XIO(Fire_Detected)XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)OTE(MCC_Main_Enable);')
    expect(addedTags(lb, lc)).toEqual([])
  })

  it('has 380-480 documentation edits and about 20 value edits', () => {
    const docs = docDiffs(lb, lc)
    const total = docs.descriptions.length + docs.comments.length
    expect(total).toBeGreaterThanOrEqual(380)
    expect(total).toBeLessThanOrEqual(480)

    // Line level: same layout, so a positional diff classifies every changed line.
    const a = file('l5x/baseline-large.L5X').split('\n')
    const b = file('l5x/current-large.L5X').split('\n')
    expect(b.length).toBe(a.length)
    const counts = { documentation: 0, logic: 0, header: 0, other: 0 }
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue
      const prev = a[i - 1] ?? ''
      if (header(a[i] ?? '')) counts.header++
      else if (prev === '<Description>' || prev === '<Comment>') counts.documentation++
      else if (prev === '<Text>') counts.logic++
      else counts.other++
    }
    expect(counts.documentation).toBeGreaterThanOrEqual(380)
    expect(counts.documentation).toBeLessThanOrEqual(480)
    expect(counts.logic).toBe(3)
    expect(counts.header).toBe(2)
    // 20 REAL values (L5K + Decorated line each) and the C201_LP_Delay PRE (L5K + Decorated).
    expect(counts.other).toBe(42)
  })
})

describe('manifests', () => {
  const KINDS = ['SHUTDOWN', 'TRIP', 'INTERLOCK', 'PERMISSIVE', 'ALARM']
  const CRIT = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

  function check(path: string, m: SafetyManifest, plant: ControllerModel): void {
    const json = JSON.parse(file(path)) as SafetyManifest
    expect(json).toEqual(m)
    expect(json.schema).toBe('interlock.safety/v1')
    expect(json.functions.map((f) => f.id)).toEqual(['SF-01', 'SF-02', 'SF-03', 'SF-04', 'SF-05', 'SF-06', 'SF-07', 'SF-08'])
    expect(json.nonSafetyScope).toEqual({ programs: ['Utilities', 'Reporting'] })
    const tags = new Set(plant.tags.map((t) => t.name))
    const routines = rungMap(plant)
    for (const f of json.functions) {
      expect(typeof f.name).toBe('string')
      expect(typeof f.description).toBe('string')
      expect(KINDS).toContain(f.kind)
      expect(CRIT).toContain(f.criticality)
      const impl = f.implementation
      expect(routines.has(`${impl.program ?? ''}/${impl.routine ?? ''}`), f.id).toBe(true)
      if (impl.module !== undefined) expect(plant.aois.some((a) => a.name === impl.module)).toBe(true)
      if (impl.instance !== undefined) expect(tags.has(impl.instance)).toBe(true)
      if (f.protectiveOutput !== undefined) {
        expect(tags.has(f.protectiveOutput.tag), f.id).toBe(true)
        expect(['DE_ENERGIZE', 'ENERGIZE']).toContain(f.protectiveOutput.tripState)
      }
      if (f.alarm !== undefined) expect(tags.has(f.alarm.tag), f.id).toBe(true)
      if (f.enableCondition !== undefined) expect(tags.has(f.enableCondition)).toBe(true)
      expect(f.protectiveOutput !== undefined || f.alarm !== undefined).toBe(true)
      for (const k of Object.keys(f)) expect(['id', 'name', 'description', 'kind', 'criticality', 'implementation', 'protectiveOutput', 'alarm', 'enableCondition', 'notes']).toContain(k)
    }
  }

  it('northgate.safety.json matches the brief and resolves in the baseline', () => {
    check('manifests/northgate.safety.json', northgateManifest(), base)
    const m = northgateManifest()
    const sf06 = m.functions.find((f) => f.id === 'SF-06')
    expect(sf06).toMatchObject({ kind: 'SHUTDOWN', criticality: 'CRITICAL', protectiveOutput: { tag: 'C201_Shutdown_Cmd', tripState: 'ENERGIZE' }, alarm: { tag: 'C201_Shutdown_Alm' }, enableCondition: 'Safety_Enable' })
  })

  it('northgate-large.safety.json declares the same functions', () => {
    check('manifests/northgate-large.safety.json', northgateLargeManifest(), model('l5x/baseline-large.L5X'))
    expect(northgateLargeManifest().functions).toEqual(northgateManifest().functions)
  })
})

describe('registry and expected findings', () => {
  const registry = JSON.parse(file('scenarios.json')) as ReturnType<typeof scenarioRegistry>
  const ids = new Set(northgateManifest().functions.map((f) => f.id))

  it('lists scenarios 01..09 in order with paths that exist', () => {
    expect(registry.schema).toBe('interlock.scenarios/v1')
    expect(registry.scenarios.map((s) => s.id)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09'])
    for (const s of registry.scenarios) {
      expect(s.expected).toBe(`expected/${s.id}-${s.slug}.json`)
      const paths = [s.manifest, s.expected, ...(s.kind === 'compare' ? [s.baseline ?? '', s.current ?? ''] : (s.sites ?? []).map((x) => x.file))]
      for (const p of paths) expect(byPath.has(p), `${s.id}: ${p}`).toBe(true)
      expect(s.summary.length).toBeGreaterThan(20)
      expect(s.highlights.length).toBeGreaterThan(0)
    }
    expect(registry.scenarios.find((s) => s.id === '07')?.sites?.map((x) => x.label)).toEqual(['Site A', 'Site B', 'Site C'])
  })

  it('expected files reference only declared safety functions and give every status', () => {
    for (const s of registry.scenarios) {
      const e = JSON.parse(file(s.expected)) as ExpectedCompare | ExpectedDrift
      expect(e).toEqual(expectedById().get(s.id))
      expect(e.scenario).toBe(s.id)
      expect(e.why.length).toBeGreaterThan(0)
      if ('drift' in e) continue
      expect(Object.keys(e.safetyStatus).sort()).toEqual([...ids].sort())
      for (const f of e.findings.mustInclude) for (const id of f.safetyFunctionIds) expect(ids.has(id), `${s.id}: ${id}`).toBe(true)
      for (const f of e.findings.mustInclude) {
        const types = Array.isArray(f.type) ? f.type : [f.type]
        for (const t of types) expect(e.findings.mustNotIncludeTypes).not.toContain(t)
      }
    }
  })

  it('drift oracle names the registry site labels', () => {
    const e = expectedById().get('07') as ExpectedDrift
    expect(Object.keys(e.drift.AOI_PumpInterlock?.variants ?? {})).toEqual(['Site A', 'Site B', 'Site C'])
    expect(e.drift.AOI_ValveCtl?.missingAt).toEqual(['Site A', 'Site B'])
  })
})
