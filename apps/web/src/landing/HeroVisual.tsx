/**
 * Hero figure: one ladder rung between two power rails.
 *
 *   INPUT ─┤ ├─ CONDITION ─┤ ├─ [ INTERLOCK ] ─( PROTECTIVE OUTPUT )─
 *
 * Sequence (about five seconds, then it settles):
 *   1. the rung energizes left to right and the protective output fires;
 *   2. a new normally-closed contact (XIO Maintenance_Mode) drops into the
 *      interlock gate — the same symbol as the INTERLOCK mark;
 *   3. the path beyond it de-energizes and the output goes dark;
 *   4. the firing-condition panel resolves into the finding.
 * Under reduced motion the final state renders immediately and completely.
 * Everything here is an illustration and is labelled as one.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { RotateCcw } from 'lucide-react'
import { cx } from '../lib/cx.ts'
import { useMediaQuery, usePrefersReducedMotion } from '../lib/hooks.ts'
import { SeverityBadge } from '../ui/Badge.tsx'

type Phase = 0 | 1 | 2 | 3 | 4 | 5
const SCHEDULE: Array<[Phase, number]> = [
  [1, 350],
  [2, 1900],
  [3, 3100],
  [4, 3750],
  [5, 4650],
]

const EASE: [number, number, number, number] = [0.45, 0, 0.55, 1]

/* ------------------------------------------------------------ geometry */

interface Layout {
  vertical: boolean
  width: number
  height: number
  rung: number
  rail: [number, number]
  railSpan: [number, number]
  a: number
  b: number
  gate: [number, number]
  coil: number
  p: (t: number, c: number) => [number, number]
}

const H: Layout = {
  vertical: false,
  width: 900,
  height: 300,
  rung: 150,
  rail: [36, 864],
  railSpan: [34, 266],
  a: 170,
  b: 320,
  gate: [430, 590],
  coil: 735,
  p: (t, c) => [t, c],
}

const V: Layout = {
  vertical: true,
  width: 380,
  height: 560,
  rung: 92,
  rail: [36, 864],
  railSpan: [52, 132],
  a: 170,
  b: 320,
  gate: [430, 590],
  coil: 735,
  p: (t, c) => [c, 14 + t * 0.6],
}

function d(L: Layout, ...segs: Array<['M' | 'L', number, number] | ['Q', number, number, number, number]>): string {
  return segs
    .map((s) => {
      if (s[0] === 'Q') {
        const [x1, y1] = L.p(s[1], s[2])
        const [x2, y2] = L.p(s[3], s[4])
        return `Q${x1} ${y1} ${x2} ${y2}`
      }
      const [x, y] = L.p(s[1], s[2])
      return `${s[0]}${x} ${y}`
    })
    .join(' ')
}

function contact(L: Layout, t: number, half = 18) {
  const c = L.rung
  return [d(L, ['M', t - 8, c - half], ['L', t - 8, c + half]), d(L, ['M', t + 8, c - half], ['L', t + 8, c + half])]
}

/* --------------------------------------------------------------- labels */

function Label({ L, t, stage, name, mnemonic, tone = 'ink', status, offset = 0 }: { L: Layout; t: number; stage: string; name?: string; mnemonic?: string; tone?: 'ink' | 'coral'; status?: ReactNode; offset?: number }) {
  const c = L.rung
  const nameCls = tone === 'coral' ? 'fill-coral-ink' : 'fill-ink'
  if (!L.vertical) {
    const [x] = L.p(t, c)
    return (
      <g>
        <text x={x} y={c - 64 - offset} textAnchor="middle" className="fill-ink-2 font-mono text-[12.5px] font-medium tracking-[0.14em]">
          {stage}
        </text>
        {name && (
          <text x={x} y={c - 40 - offset} textAnchor="middle" className={cx(nameCls, 'font-mono text-[15.5px] font-medium')}>
            {name}
          </text>
        )}
        {mnemonic && (
          <text x={x} y={c + 44} textAnchor="middle" className={cx(tone === 'coral' ? 'fill-coral-ink' : 'fill-ink-2', 'font-mono text-[12.5px] font-semibold tracking-[0.08em]')}>
            {mnemonic}
          </text>
        )}
        {status}
      </g>
    )
  }
  const [, y] = L.p(t, c)
  const x = c + 50 + offset
  return (
    <g>
      <text x={x} y={y - 6} className="fill-ink-2 font-mono text-[11px] font-medium tracking-[0.14em]">
        {stage}
        {mnemonic && <tspan className={tone === 'coral' ? 'fill-coral-ink' : 'fill-ink-2'}>{`  ·  ${mnemonic}`}</tspan>}
      </text>
      {name && (
        <text x={x} y={y + 13} className={cx(nameCls, 'font-mono text-[14px] font-medium')}>
          {name}
        </text>
      )}
      {status}
    </g>
  )
}

/* ---------------------------------------------------------------- figure */

function Schematic({ L, phase, instant }: { L: Layout; phase: Phase; instant: boolean }) {
  const c = L.rung
  const [gl, gr] = L.gate
  const gm = (gl + gr) / 2
  const energized = phase >= 1
  const inhibit = phase >= 3
  const broken = phase >= 4
  const fires = phase >= 2 && !broken
  const dur = (s: number) => (instant ? 0 : s)

  const up = d(L, ['M', L.rail[0], c], ['L', gm - 8, c])
  const bridge = d(L, ['M', gm - 8, c], ['L', gm + 8, c])
  const down = d(L, ['M', gm + 8, c], ['L', L.rail[1], c])
  const [gx0, gy0] = L.p(gl, c - (L.vertical ? 40 : 30))
  const [gx1, gy1] = L.p(gr, c + (L.vertical ? 40 : 30))
  const gate = { x: Math.min(gx0, gx1), y: Math.min(gy0, gy1), w: Math.abs(gx1 - gx0), h: Math.abs(gy1 - gy0) }
  const coilL = d(L, ['M', L.coil - 6, c - 19], ['Q', L.coil - 19, c, L.coil - 6, c + 19])
  const coilR = d(L, ['M', L.coil + 6, c - 19], ['Q', L.coil + 19, c, L.coil + 6, c + 19])
  const [cx0, cy0] = L.p(L.coil, c)
  const [kx, ky] = L.p(gm, c)

  return (
    <svg viewBox={`0 0 ${L.width} ${L.height}`} className="h-auto w-full" role="img" aria-labelledby="hero-fig-title hero-fig-desc">
      <title id="hero-fig-title">Illustration: a shutdown rung before and after one edit</title>
      <desc id="hero-fig-desc">
        Pressure_High and Safety_Enable energize the interlock and the protective output Shutdown_Cmd fires. A new normally-closed contact on
        Maintenance_Mode is then added inside the interlock; while Maintenance_Mode is set, the path is open and the shutdown no longer fires.
      </desc>

      {/* power rails */}
      <path d={d(L, ['M', L.rail[0], L.railSpan[0]], ['L', L.rail[0], L.railSpan[1]])} className="stroke-ink" strokeWidth="3.5" strokeLinecap="round" />
      <path d={d(L, ['M', L.rail[1], L.railSpan[0]], ['L', L.rail[1], L.railSpan[1]])} className="stroke-ink" strokeWidth="3.5" strokeLinecap="round" />
      {!L.vertical && (
        <text x={L.rail[0] + 12} y={L.railSpan[0] + 10} className="fill-ink-3 font-mono text-[12px] font-medium tracking-[0.1em]">
          RUNG 000
        </text>
      )}

      {/* base wiring */}
      <path d={d(L, ['M', L.rail[0], c], ['L', L.a - 8, c])} className="stroke-line-strong" strokeWidth="2" fill="none" />
      <path d={d(L, ['M', L.a + 8, c], ['L', L.b - 8, c])} className="stroke-line-strong" strokeWidth="2" fill="none" />
      <path d={d(L, ['M', L.b + 8, c], ['L', L.coil - 10, c])} className="stroke-line-strong" strokeWidth="2" fill="none" />
      <path d={d(L, ['M', L.coil + 10, c], ['L', L.rail[1], c])} className="stroke-line-strong" strokeWidth="2" fill="none" />

      {/* interlock gate */}
      <motion.rect
        x={gate.x}
        y={gate.y}
        width={gate.w}
        height={gate.h}
        rx="16"
        fill="rgb(var(--paper-2))"
        strokeWidth="1.5"
        strokeDasharray="5 6"
        initial={false}
        animate={{ stroke: inhibit ? 'rgb(var(--coral))' : 'rgb(var(--line-strong))' }}
        transition={{ duration: dur(0.4) }}
      />
      {/* wire through the gate (behind the inhibit contact) */}
      <path d={d(L, ['M', gl, c], ['L', gr, c])} className="stroke-line-strong" strokeWidth="2" fill="none" />

      {/* energized path */}
      <motion.path
        d={up}
        className="stroke-ink"
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: energized ? 1 : 0, opacity: energized ? 1 : 0 }}
        transition={{ pathLength: { duration: dur(0.95), ease: EASE }, opacity: { duration: dur(0.1) } }}
      />
      <motion.path
        d={bridge}
        className="stroke-ink"
        strokeWidth="3.5"
        fill="none"
        initial={false}
        animate={{ opacity: energized && !inhibit ? 1 : 0 }}
        transition={{ duration: dur(0.12), delay: energized && !inhibit ? dur(0.95) : 0 }}
      />
      <motion.path
        d={down}
        className="stroke-ink"
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: energized && !broken ? 1 : 0, opacity: energized && !broken ? 1 : 0 }}
        transition={
          broken
            ? { pathLength: { duration: dur(0.6), ease: EASE }, opacity: { duration: dur(0.2), delay: dur(0.5) } }
            : { pathLength: { duration: dur(0.55), ease: EASE, delay: dur(1.0) }, opacity: { duration: dur(0.05), delay: dur(1.0) } }
        }
      />
      {/* moving current ticks while energized (CSS animation; off under reduced motion) */}
      {phase >= 2 && !inhibit && <path d={d(L, ['M', L.rail[0], c], ['L', L.rail[1], c])} className="il-dash-flow stroke-paper" strokeWidth="1.2" fill="none" opacity="0.7" />}
      {inhibit && <path d={up} className="il-dash-flow stroke-paper" strokeWidth="1.2" fill="none" opacity="0.7" />}

      {/* contacts */}
      {[L.a, L.b].map((t) =>
        contact(L, t).map((p, i) => <path key={`${t}-${i}`} d={p} className="stroke-ink" strokeWidth="3.5" strokeLinecap="round" />),
      )}

      {/* the new inhibit: normally-closed contact (the INTERLOCK mark) */}
      <AnimatePresence>
        {inhibit && (
          <motion.g
            key="inhibit"
            initial={instant ? false : { opacity: 0, y: L.vertical ? 0 : -22, x: L.vertical ? -22 : 0 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            transition={{ duration: dur(0.45), ease: [0.16, 1, 0.3, 1] }}
          >
            <rect x={kx - 14} y={ky - 14} width="28" height="28" fill="rgb(var(--paper-2))" />
            {contact(L, gm, 20).map((p, i) => (
              <path key={i} d={p} className="stroke-ink" strokeWidth="3.5" strokeLinecap="round" />
            ))}
            <path
              d={d(L, ['M', gm - 7, c + (L.vertical ? -17 : 17)], ['L', gm + 7, c + (L.vertical ? 17 : -17)])}
              className="stroke-coral"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          </motion.g>
        )}
      </AnimatePresence>

      {/* coil */}
      <motion.circle
        cx={cx0}
        cy={cy0}
        r="15"
        initial={false}
        animate={{ opacity: fires ? 1 : 0, scale: fires ? 1 : 0.6 }}
        transition={{ duration: dur(0.3) }}
        className="fill-ink"
        style={{ transformOrigin: `${cx0}px ${cy0}px` }}
      />
      <motion.path d={coilL} fill="none" strokeWidth="3.5" strokeLinecap="round" initial={false} animate={{ stroke: broken ? 'rgb(var(--coral))' : 'rgb(var(--ink))' }} transition={{ duration: dur(0.3) }} />
      <motion.path d={coilR} fill="none" strokeWidth="3.5" strokeLinecap="round" initial={false} animate={{ stroke: broken ? 'rgb(var(--coral))' : 'rgb(var(--ink))' }} transition={{ duration: dur(0.3) }} />

      {/* labels */}
      <Label L={L} t={L.a} stage="INPUT" name="Pressure_High" mnemonic="XIC" />
      <Label L={L} t={L.b} stage="CONDITION" name="Safety_Enable" mnemonic="XIC" />
      <Label
        L={L}
        t={gm}
        stage="INTERLOCK"
        name={inhibit ? 'Maintenance_Mode' : undefined}
        mnemonic={inhibit ? 'XIO · NEW TERM' : undefined}
        tone="coral"
        offset={L.vertical ? 0 : 0}
      />
      <Label
        L={L}
        t={L.coil}
        stage="PROTECTIVE OUTPUT"
        name="Shutdown_Cmd"
        mnemonic="OTE"
        status={
          phase >= 2 && (
            <text
              x={L.vertical ? L.rung + 50 : L.p(L.coil, c)[0]}
              y={L.vertical ? L.p(L.coil, c)[1] + 32 : c + 66}
              textAnchor={L.vertical ? 'start' : 'middle'}
              className={cx('font-mono text-[12.5px] font-semibold tracking-[0.1em]', broken ? 'fill-coral-ink' : 'fill-ink')}
            >
              {broken ? 'DOES NOT FIRE' : 'FIRES'}
            </text>
          )
        }
      />
    </svg>
  )
}

/* ---------------------------------------------------------- result panel */

function ResultPanel({ phase, instant }: { phase: Phase; instant: boolean }) {
  const term = phase >= 3
  const resolved = phase >= 5
  return (
    <div className="flex h-full min-w-0 flex-col rounded-card bg-surface p-5 shadow-soft ring-1 ring-line sm:p-6">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <p className="il-label">Firing condition</p>
        <AnimatePresence>
          {resolved && (
            <motion.span key="sev" initial={instant ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
              <SeverityBadge severity="CRITICAL" solid />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <dl className="mt-4 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 font-mono text-[0.8125rem] leading-snug">
        <dt className="text-ink-2">Before</dt>
        <dd className="il-ident text-ink">
          Pressure_High <span className="text-ink-2">AND</span> Safety_Enable
        </dd>
        <dt className={term ? 'text-ink' : 'text-ink-3'}>After</dt>
        <dd className="il-ident text-ink">
          Pressure_High <span className="text-ink-2">AND</span> Safety_Enable
          <AnimatePresence>
            {term && (
              <motion.ins
                key="term"
                initial={instant ? false : { opacity: 0, backgroundColor: 'rgb(var(--marigold) / 0)' }}
                animate={{ opacity: 1, backgroundColor: 'rgb(var(--marigold) / 0.4)' }}
                transition={{ duration: 0.4 }}
                className="ml-1 rounded-[4px] px-1 no-underline [box-decoration-break:clone]"
              >
                <span className="sr-only">added: </span>
                AND <span className="font-semibold">NOT</span> Maintenance_Mode
              </motion.ins>
            )}
          </AnimatePresence>
        </dd>
      </dl>

      <div className="mt-auto pt-5">
        <AnimatePresence mode="wait" initial={false}>
          {resolved ? (
            <motion.div key="resolved" initial={instant ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} className="border-t border-line pt-4">
              <p className="text-[0.8125rem] font-semibold text-ink-2">Safety-impacting logic change identified.</p>
              <p className="mt-1 text-title-3 text-ink">Shutdown condition weakened</p>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-2">
                Maintenance_Mode now suppresses the shutdown. Affected safety function: <span className="font-semibold text-ink">High Pressure Shutdown</span>.
              </p>
            </motion.div>
          ) : (
            <motion.p key="pending" exit={{ opacity: 0 }} className="border-t border-dashed border-line-strong pt-4 font-mono text-xs text-ink-3">
              {phase >= 3 ? 'Comparing before and after…' : phase >= 1 ? 'Rung energized. Output fires.' : 'Baseline loaded.'}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function HeroVisual() {
  const reduced = usePrefersReducedMotion()
  const vertical = !useMediaQuery('(min-width: 640px)')
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.2 })
  const [phase, setPhase] = useState<Phase>(0)
  const [run, setRun] = useState(0)

  useEffect(() => {
    if (reduced) {
      setPhase(5)
      return
    }
    if (!inView) return
    setPhase(0)
    const timers = SCHEDULE.map(([p, at]) => window.setTimeout(() => setPhase(p), at))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [reduced, inView, run])

  const instant = reduced
  const L = vertical ? V : H

  return (
    <figure ref={ref} className="relative overflow-hidden rounded-hero border border-line bg-paper-2">
      <div className="il-drafting pointer-events-none absolute inset-0" aria-hidden="true" />
      <figcaption className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line px-5 py-3.5 sm:px-8">
        <span className="flex items-center gap-3">
          <span className="whitespace-nowrap font-mono text-xs font-semibold tracking-[0.14em] text-ink">FIG. 1</span>
          <span className="text-[0.8125rem] text-ink-2">A shutdown rung, before and after one edit. Illustration.</span>
        </span>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          disabled={phase < 5 || reduced}
          className={cx(
            'inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-ink-2 transition-opacity hover:bg-ink/[0.06] hover:text-ink',
            phase < 5 || reduced ? 'pointer-events-none opacity-0' : 'opacity-100',
          )}
          aria-hidden={phase < 5 || reduced}
          tabIndex={phase < 5 || reduced ? -1 : 0}
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          REPLAY
        </button>
      </figcaption>
      <div className="relative grid grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-6 lg:p-8 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-w-0 items-center">
          <Schematic L={L} phase={phase} instant={instant} />
        </div>
        <ResultPanel phase={phase} instant={instant} />
      </div>
    </figure>
  )
}
