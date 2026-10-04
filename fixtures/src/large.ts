/**
 * Scenario 08: the same plant scaled to 24 pumps plus 300 instrument points,
 * and a "current" export that buries exactly three logic changes under ~400
 * documentation edits and ~20 stored-value changes. Deterministic: every
 * choice comes from a seeded mulberry32 PRNG, never Math.random.
 */
import { logixDate } from './dates.ts'
import { clone, rungMap, setRungComment, setRungText, setTimerPreset, stamp } from './edit.ts'
import { buildPlant, dintTag, pad2, pumpNo, realTag } from './plant.ts'
import { COMPRESSOR_LP_RUNG, ESD_RUNG, ESD_RUNG_REORDERED, PERMISSIVE_RUNG } from './scenarios.ts'
import type { ControllerModel, TagDef } from './types.ts'

export const LARGE_PUMPS = 24
export const LARGE_EXTRA_TAGS = 300
export const LARGE_DESCRIPTION_EDITS = 340
export const LARGE_COMMENT_EDITS = 60
export const LARGE_VALUE_EDITS = 20

/** mulberry32: tiny, well-distributed 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

/** Deterministic Fisher-Yates on a copy. */
function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = out[i] as T
    out[i] = out[j] as T
    out[j] = tmp
  }
  return out
}

/* ------------------------------------------------------- instrument list */

interface PointSpec {
  name: string
  instrument: string
  what: string
  units: string
  range: string
  kind: 'REAL' | 'DINT'
  value: number
  decimals: number
}

const BASINS = ['Basin 1', 'Basin 2', 'Basin 3', 'Basin 4']
const FLOW_SITES = ['influent channel', 'force main', 'discharge header A', 'discharge header B', 'overflow weir', 'return activated sludge', 'plant water', 'washwater']
const PRESS_SITES = ['discharge header A', 'discharge header B', 'force main', 'suction header', 'plant water', 'seal water', 'air header', 'bubbler line']
const VALVE_DUTY = ['inlet isolation', 'discharge isolation', 'check bypass', 'surge relief', 'air release']
const ANALYZERS: { what: string; units: string; range: string; lo: number; hi: number; decimals: number }[] = [
  { what: 'free chlorine residual', units: 'mg/L', range: '0-5', lo: 0.6, hi: 1.8, decimals: 2 },
  { what: 'turbidity', units: 'NTU', range: '0-100', lo: 0.4, hi: 12, decimals: 2 },
  { what: 'pH', units: 'pH', range: '0-14', lo: 6.8, hi: 7.6, decimals: 2 },
]

function points(rand: () => number): PointSpec[] {
  const out: PointSpec[] = []
  const real = (name: string, instrument: string, what: string, units: string, range: string, lo: number, hi: number, decimals = 1): void => {
    out.push({ name, instrument, what, units, range, kind: 'REAL', value: round(lo + rand() * (hi - lo), decimals), decimals })
  }
  for (let n = 1; n <= LARGE_PUMPS; n++) {
    const nn = pad2(n)
    const p = pumpNo(n)
    const on = n % 3 !== 0
    real(`Pump_${nn}_Motor_Amps`, `IT-${100 + n}`, `${p} motor current`, 'A', '0-150', on ? 48 : 0, on ? 71 : 0)
    real(`Pump_${nn}_Speed_Fbk`, `SI-${100 + n}`, `${p} VFD speed feedback`, '%', '0-100', on ? 62 : 0, on ? 94 : 0)
    real(`Pump_${nn}_Disch_PV`, `PIT-${100 + n}`, `${p} discharge pressure`, 'psig', '0-150', 38, 61)
    real(`Pump_${nn}_Brg_Temp`, `TIT-${100 + n}`, `${p} motor bearing temperature`, 'degF', '0-250', 92, 141)
    out.push({ name: `Pump_${nn}_Starts_Today`, instrument: `KQI-${100 + n}`, what: `${p} starts since midnight`, units: 'count', range: '0-99', kind: 'DINT', value: Math.floor(rand() * 9), decimals: 0 })
  }
  for (let i = 1; i <= 20; i++) {
    const basin = BASINS[(i - 1) % BASINS.length] ?? 'Basin 1'
    real(`LIT_${200 + i}_PV`, `LIT-${200 + i}`, `${basin} ${i <= 4 ? 'wet well' : i <= 12 ? 'equalization cell ' + (i - 4) : 'chemical tank ' + (i - 12)} level`, i <= 12 ? 'ft' : '%', i <= 12 ? '0-25' : '0-100', i <= 12 ? 4 : 22, i <= 12 ? 18 : 88)
  }
  for (let i = 1; i <= 40; i++) {
    const site = FLOW_SITES[(i - 1) % FLOW_SITES.length] ?? 'influent channel'
    real(`FIT_${300 + i}_PV`, `FIT-${300 + i}`, `${BASINS[(i - 1) % 4] ?? 'Basin 1'} ${site} flow`, i % 5 === 0 ? 'gpm' : 'MGD', i % 5 === 0 ? '0-2500' : '0-12', i % 5 === 0 ? 400 : 1.2, i % 5 === 0 ? 1900 : 9.8, 2)
  }
  for (let i = 1; i <= 40; i++) {
    const site = PRESS_SITES[(i - 1) % PRESS_SITES.length] ?? 'discharge header A'
    real(`PIT_${400 + i}_PV`, `PIT-${400 + i}`, `${BASINS[(i - 1) % 4] ?? 'Basin 1'} ${site} pressure`, 'psig', '0-150', 12, 88)
  }
  for (let i = 1; i <= 24; i++) {
    const a = ANALYZERS[(i - 1) % ANALYZERS.length] ?? ANALYZERS[0]
    if (a === undefined) continue
    real(`AIT_${500 + i}_PV`, `AIT-${500 + i}`, `Sample point SP-${Math.ceil(i / 3)} ${a.what}`, a.units, a.range, a.lo, a.hi, a.decimals)
  }
  for (let i = 1; i <= 30; i++) {
    const duty = VALVE_DUTY[(i - 1) % VALVE_DUTY.length] ?? 'inlet isolation'
    real(`ZT_${600 + i}_Pos`, `ZT-${600 + i}`, `Valve XV-${600 + i} ${duty} position`, '% open', '0-100', 0, 100, 0)
  }
  for (let i = 1; i <= 16; i++) {
    real(`JT_${700 + i}_kW`, `JT-${700 + i}`, `${i <= 8 ? 'MCC-1' : 'MCC-2'} feeder ${((i - 1) % 8) + 1} real power`, 'kW', '0-500', 35, 310)
  }
  for (let i = 1; i <= 10; i++) {
    real(`TT_${800 + i}_PV`, `TT-${800 + i}`, `${['Pump room', 'Electrical room', 'Chemical room', 'Generator room', 'Control room'][(i - 1) % 5] ?? 'Pump room'} ${i <= 5 ? 'air' : 'wall'} temperature`, 'degF', '-20-140', 58, 84)
  }
  return out
}

/** Baseline description of an instrument point: "Basin 1 influent channel flow FIT-301 (MGD)". */
function oldDescription(p: PointSpec): string {
  return `${p.what} ${p.instrument} (${p.units})`
}

/** Description after the tag-standard documentation pass: "FIT-301 Basin 1 influent channel flow, MGD, range 0-12". */
function newDescription(p: PointSpec): string {
  const what = p.what.charAt(0).toUpperCase() + p.what.slice(1)
  return `${p.instrument} ${what}, ${p.units}, range ${p.range}`
}

function pointTag(p: PointSpec): TagDef {
  return p.kind === 'DINT' ? dintTag(p.name, oldDescription(p), p.value) : realTag(p.name, oldDescription(p), p.value)
}

/* ------------------------------------------------------------- baseline */

const SEED = 0x4e47_5053 // "NGPS"

export function largeBaseline(): ControllerModel {
  const m = buildPlant({ pumps: LARGE_PUMPS })
  m.description = 'Northgate Pump Station PLC-1, scaled 24-pump variant with full instrument list. SYNTHETIC DEMONSTRATION PROJECT: fictional utility, no real site or equipment.'
  stamp(m, logixDate(2026, 3, 2, 11, 3, 27), logixDate(2026, 3, 9, 8, 52, 4))
  for (const p of points(mulberry32(SEED))) m.tags.push(pointTag(p))
  return m
}

/* -------------------------------------------------------------- current */

/** Documentation pass on a free-text description that is not an instrument point. */
function reviseText(text: string, k: number): string {
  switch (k % 4) {
    case 0:
      return `${text} (as-built rev D)`
    case 1:
      return `${text}; loop dwg NG-L-${120 + (k % 60)}`
    case 2:
      return `${text} (verified at SAT 2026-08)`
    default:
      return `${text}; see NG-E-${300 + (k % 40)} rev D`
  }
}

export function largeCurrent(base: ControllerModel = largeBaseline()): ControllerModel {
  const m = clone(base)
  stamp(m, logixDate(2026, 10, 1, 17, 38, 12), logixDate(2026, 10, 1, 17, 41, 56))
  const rand = mulberry32(SEED ^ 0x0001_0008)
  const specs = new Map(points(mulberry32(SEED)).map((p) => [p.name, p]))

  // 1. Documentation: 340 tag descriptions.
  const tagPick = shuffled(m.tags.map((t) => t.name), rand).slice(0, LARGE_DESCRIPTION_EDITS)
  tagPick.forEach((name, k) => {
    const t = m.tags.find((x) => x.name === name)
    if (t === undefined) return
    const spec = specs.get(name)
    t.description = spec !== undefined ? newDescription(spec) : reviseText(t.description, k)
  })

  // 2. Documentation: 60 rung comments, never on the three rungs whose logic changes.
  const logicRungs = new Set(['Safety/ESD#0', 'Safety/Permissives#0', 'Compressor/Main#2'])
  const rungKeys: string[] = []
  for (const [key, rungs] of rungMap(m)) {
    if (key.startsWith('AOI_')) continue
    rungs.forEach((_, i) => {
      if (!logicRungs.has(`${key}#${i}`)) rungKeys.push(`${key}#${i}`)
    })
  }
  shuffled(rungKeys, rand)
    .slice(0, LARGE_COMMENT_EDITS)
    .forEach((key, k) => {
      const [path, idx] = key.split('#')
      const [prog, rout] = (path ?? '').split('/')
      const rung = m.programs.find((p) => p.name === prog)?.routines.find((r) => r.name === rout)?.rungs[Number(idx)]
      if (prog === undefined || rout === undefined || rung === undefined) return
      setRungComment(m, prog, rout, Number(idx), reviseText(rung.comment ?? '', k + 1))
    })

  // 3. Data: 20 stored process values drifted between uploads (REAL instrument points only).
  const realPoints = [...specs.values()].filter((p) => p.kind === 'REAL' && p.value !== 0)
  shuffled(realPoints, rand)
    .slice(0, LARGE_VALUE_EDITS)
    .forEach((p) => {
      const t = m.tags.find((x) => x.name === p.name)
      if (t?.value?.kind !== 'REAL') return
      let next = round(p.value * (0.85 + rand() * 0.3), p.decimals)
      if (next === p.value) next = round(p.value + 10 ** -p.decimals, p.decimals)
      t.value.value = next
    })

  // 4. Exactly three logic changes.
  setRungText(m, 'Safety', 'Permissives', 0, PERMISSIVE_RUNG, PERMISSIVE_RUNG.replace('GRT(Suction_Press_PV,12.0)', 'GRT(Suction_Press_PV,8.0)'))
  setRungText(m, 'Compressor', 'Main', 2, COMPRESSOR_LP_RUNG, 'LES(C201_Suction_PV,3.5)TON(C201_LP_Delay,10000,0);')
  setTimerPreset(m, 'C201_LP_Delay', 2000, 10000)
  setRungText(m, 'Safety', 'ESD', 0, ESD_RUNG, ESD_RUNG_REORDERED)
  return m
}
