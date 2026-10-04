/**
 * Six editorial capability sections. Each answers one question an engineer
 * asks during change review, with a small specimen of what the workstation
 * shows. Specimens are examples from the synthetic Northgate plant and are
 * labelled as such.
 */
import type { ReactNode } from 'react'
import { cx } from '../lib/cx.ts'
import { Glyph, SeverityBadge, StatusPill } from '../ui/Badge.tsx'
import { ExampleTag, Reveal } from './Reveal.tsx'

function Capability({ name, question, body, specimen, flip, index }: { name: string; question: string; body: ReactNode; specimen: ReactNode; flip?: boolean; index: number }) {
  return (
    <article aria-labelledby={`cap-${index}`} className="border-t border-line">
      <div className="mx-auto grid grid-cols-1 max-w-page gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:gap-x-14 lg:px-10 lg:py-24">
        <Reveal className={cx('flex flex-col gap-5 lg:row-start-1 lg:col-span-5 lg:self-center', flip && 'lg:col-start-8')}>
          <p className="il-label text-ink">{name}</p>
          <h3 id={`cap-${index}`} className="text-title-1 text-ink [text-wrap:balance]">
            {question}
          </h3>
          <div className="max-w-prose text-[0.9375rem] leading-relaxed text-ink-2 [&>p+p]:mt-3">{body}</div>
        </Reveal>
        <Reveal delay={0.1} className={cx('min-w-0 lg:row-start-1 lg:col-span-7', flip ? 'lg:col-start-1' : 'lg:col-start-6')}>
          <div className="flex flex-col gap-3">
            {specimen}
            <ExampleTag />
          </div>
        </Reveal>
      </div>
    </article>
  )
}

/* -------------------------------------------------------------- specimens */

const INSTANCES = [
  { tag: 'PUMP_01_IL', routine: 'PumpControl/PUMP_01', sf: 'SF-02' },
  { tag: 'PUMP_02_IL', routine: 'PumpControl/PUMP_02', sf: 'SF-03' },
  { tag: 'PUMP_03_IL', routine: 'PumpControl/PUMP_03', sf: 'SF-04' },
  { tag: 'PUMP_04_IL', routine: 'PumpControl/PUMP_04' },
  { tag: 'PUMP_05_IL', routine: 'PumpControl/PUMP_05' },
]

function ReuseSpecimen() {
  return (
    <div className="rounded-panel bg-surface p-5 shadow-soft ring-1 ring-line sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="il-label">Module definition</p>
          <p className="il-ident mt-1 font-mono text-[0.9375rem] font-semibold text-ink">AOI_PumpInterlock</p>
        </div>
        <p className="font-mono text-xs text-ink-2">
          rev 3.4 <span aria-hidden="true">→</span>
          <span className="sr-only">changed to</span> <span className="rounded-[4px] bg-marigold/40 px-1 text-ink">3.5</span>
        </p>
      </div>
      <ul className="relative mt-5 flex flex-col gap-2 pl-6" aria-label="Instances of AOI_PumpInterlock">
        <span aria-hidden="true" className="absolute bottom-5 left-[7px] top-0 w-[2px] bg-ink" />
        {INSTANCES.map((i) => (
          <li key={i.tag} className="relative flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-input bg-paper-2/70 px-4 py-2.5 shadow-inset-line">
            <span aria-hidden="true" className="absolute -left-[17px] top-1/2 h-[2px] w-[17px] bg-ink" />
            <span className="min-w-0">
              <span className="il-ident block font-mono text-data font-semibold text-ink">{i.tag}</span>
              <span className="il-ident block font-mono text-[0.6875rem] text-ink-2">{i.routine}</span>
            </span>
            {i.sf ? (
              <span className="inline-flex items-center gap-2 font-mono text-[0.6875rem] font-medium text-ink">
                <Glyph shape="diamond" className="fill-ink" />
                SAFETY · {i.sf}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 font-mono text-[0.6875rem] text-ink-2">
                <Glyph shape="ring" className="text-ink-3" />
                OPERATIONAL
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

const DECLS = [
  { id: 'SF-01', name: 'Emergency Shutdown', impl: 'Safety / ESD', out: 'MCC_Main_Enable', trip: 'de-energize', alarm: 'ESD_Trip_Horn', status: 'NO_CHANGE' },
  { id: 'SF-05', name: 'Tank T-101 Overflow Protection', impl: 'Safety / Overflow', out: 'XV101_Close_Cmd', trip: 'energize', alarm: '—', status: 'STRENGTHENED' },
  { id: 'SF-06', name: 'Compressor C-201 High-Pressure Shutdown', impl: 'Compressor / Main', out: 'C201_Shutdown_Cmd', trip: 'energize', alarm: 'C201_Shutdown_Alm', status: 'IMPACTED' },
]

function SafetySpecimen() {
  return (
    <div className="overflow-hidden rounded-panel bg-surface shadow-soft ring-1 ring-line">
      <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] gap-4 border-b border-line px-6 py-3 md:grid">
        {['Function', 'Implementation', 'Protective output', 'Status'].map((h) => (
          <span key={h} className="il-label">
            {h}
          </span>
        ))}
      </div>
      <ul>
        {DECLS.map((d) => (
          <li key={d.id} className="grid grid-cols-1 gap-x-4 gap-y-2 border-b border-line px-5 py-4 last:border-0 sm:px-6 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] md:items-center">
            <span className="min-w-0">
              <span className="font-mono text-[0.6875rem] text-ink-2">{d.id}</span>
              <span className="il-ident block text-sm font-semibold text-ink">{d.name}</span>
            </span>
            <span className="il-ident font-mono text-xs text-ink-2">{d.impl}</span>
            <span className="min-w-0">
              <span className="il-ident block font-mono text-xs text-ink">{d.out}</span>
              <span className="font-mono text-[0.6875rem] text-ink-2">trips: {d.trip}</span>
            </span>
            <span>
              <StatusPill status={d.status} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FiringSpecimen() {
  const row = (label: string, value: string) => (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
      <span className="il-ident font-mono text-data text-ink">{label}</span>
      <span className="il-num font-mono text-data font-semibold text-ink">{value}</span>
    </div>
  )
  return (
    <div className="grid grid-cols-1 gap-4 rounded-panel bg-surface p-5 shadow-soft ring-1 ring-line sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:p-7">
      <div className="min-w-0">
        <p className="il-label mb-2">Witness assignment</p>
        {row('Pressure_High', '1')}
        {row('Safety_Enable', '1')}
        {row('Maintenance_Mode', '1')}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <p className="il-label">Shutdown_Cmd</p>
        <div className="flex items-center justify-between rounded-input bg-paper-2/70 px-4 py-3 shadow-inset-line">
          <span className="font-mono text-xs text-ink-2">BASELINE</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-ink">
            <Glyph shape="check" className="text-ink" /> FIRES
          </span>
        </div>
        <div className="flex items-center justify-between rounded-input bg-coral/[0.1] px-4 py-3 ring-1 ring-inset ring-coral/40">
          <span className="font-mono text-xs text-ink-2">CURRENT</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-coral-ink">
            <Glyph shape="cross" className="text-coral-ink" /> DOES NOT FIRE
          </span>
        </div>
        <p className="mt-1 font-mono text-[0.6875rem] text-ink-2">Exhaustive: 8 of 8 input combinations checked.</p>
      </div>
    </div>
  )
}

const STAGES = ['CONDITION', 'LOGIC', 'ALARM', 'HMI', 'OPERATOR']

function AlarmSpecimen() {
  const before = ['High_Level', 'ALMD', 'LT101_HH_Alm', 'Alarm summary', 'Notified']
  const after = ['High_Level', 'Inhibit', 'No alarm', 'Declared', 'Not notified']
  const afterState = ['ok', 'broken', 'broken', 'declared', 'broken'] as const
  return (
    <div className="rounded-panel bg-surface p-5 shadow-soft ring-1 ring-line sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="il-label">Alarm path · Tank T-101 high-high</p>
          <p className="mt-1 text-sm font-semibold text-ink">Operator notification path</p>
        </div>
        <StatusPill status="BROKEN" />
      </div>
      <div className="il-scroll-thin relative mt-6 overflow-x-auto pb-1">
        <table className="w-full min-w-[34rem] border-separate border-spacing-x-1.5 border-spacing-y-1.5 text-left">
          <caption className="sr-only">Notification path stages before and after the change</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Version</span>
              </th>
              {STAGES.map((s) => (
                <th key={s} scope="col" className="il-label px-1 pb-1 font-medium">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="pr-2 font-mono text-[0.6875rem] font-medium text-ink-2">
                BEFORE
              </th>
              {before.map((b, i) => (
                <td key={i} className="rounded-[10px] bg-paper-2/80 px-3 py-2 font-mono text-[0.75rem] text-ink shadow-inset-line">
                  {b}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="pr-2 font-mono text-[0.6875rem] font-medium text-ink">
                AFTER
              </th>
              {after.map((a, i) => {
                const st = afterState[i]
                return (
                  <td
                    key={i}
                    className={cx(
                      'rounded-[10px] px-3 py-2 font-mono text-[0.75rem]',
                      st === 'broken' && 'bg-coral/[0.12] text-coral-ink ring-1 ring-inset ring-coral/40',
                      st === 'ok' && 'bg-paper-2/80 text-ink shadow-inset-line',
                      st === 'declared' && 'border border-dashed border-line-strong text-ink-2',
                    )}
                  >
                    {st === 'broken' && <span className="sr-only">Broken: </span>}
                    {a}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-2">The HMI and operator stages are shown as DECLARED: a project file cannot prove what an HMI displays.</p>
    </div>
  )
}

function BlastSpecimen() {
  return (
    <div className="rounded-panel bg-surface p-5 shadow-soft ring-1 ring-line sm:p-7">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <p className="il-num text-[3.25rem] font-extrabold leading-none tracking-[-0.04em] text-ink">1</p>
        <p className="text-sm text-ink-2">definition changed</p>
        <span aria-hidden="true" className="text-ink-3">→</span>
        <p className="il-num text-[3.25rem] font-extrabold leading-none tracking-[-0.04em] text-ink">5</p>
        <p className="text-sm text-ink-2">instantiations affected</p>
      </div>
      <div className="mt-6 flex h-10 gap-1" role="img" aria-label="3 safety-relevant instances, 2 operational instances">
        {[1, 1, 1, 0, 0].map((s, i) => (
          <span key={i} className={cx('flex-1 rounded-[8px]', s ? 'bg-ink' : 'bg-ink/[0.12] ring-1 ring-inset ring-ink/15')} />
        ))}
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-ink" />
          <dt className="text-ink-2">Safety-relevant</dt>
          <dd className="il-num font-semibold text-ink">3</dd>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-ink/[0.12] ring-1 ring-inset ring-ink/15" />
          <dt className="text-ink-2">Operational</dt>
          <dd className="il-num font-semibold text-ink">2</dd>
        </div>
      </dl>
    </div>
  )
}

function ReviewSpecimen() {
  const order = [
    { title: 'Emergency Shutdown', sev: 'CRITICAL' as const },
    { title: 'Alarm Suppression', sev: 'CRITICAL' as const },
    { title: 'Shared AOI modification', sev: 'HIGH' as const },
    { title: 'Pump Interlock', sev: 'HIGH' as const },
  ]
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-panel bg-line shadow-soft ring-1 ring-line sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <dl className="flex flex-col justify-center gap-4 bg-surface p-5 sm:p-7">
        {[
          ['428', 'total changes'],
          ['17', 'meaningful logic changes'],
          ['4', 'safety-relevant'],
        ].map(([n, l], i) => (
          <div key={l} className="flex items-baseline gap-3" style={{ paddingLeft: `${i * 14}px` }}>
            <dd className={cx('il-num font-extrabold leading-none tracking-[-0.04em]', i === 2 ? 'text-[2.5rem] text-ink' : 'text-[1.75rem] text-ink-2')}>{n}</dd>
            <dt className="text-sm text-ink-2">{l}</dt>
          </div>
        ))}
      </dl>
      <div className="bg-surface p-5 sm:p-7">
        <p className="il-label mb-3">Recommended review order</p>
        <ol className="flex flex-col">
          {order.map((o, i) => (
            <li key={o.title} className="flex min-w-0 items-center gap-3 border-b border-line py-2.5 last:border-0">
              <span className="il-num font-mono text-xs font-semibold text-ink-2">{String(i + 1).padStart(2, '0')}</span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{o.title}</span>
              <SeverityBadge severity={o.sev} />
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export function Capabilities() {
  return (
    <div aria-label="Capabilities">
      <Capability
        index={1}
        name="Reuse Graph"
        question="Which call sites run this definition?"
        body={
          <>
            <p>
              Reusable modules hide their reach. INTERLOCK resolves every Add-On Instruction call to its backing tag, routine, program and task, so
              a definition change arrives with the list of places that execute it.
            </p>
          </>
        }
        specimen={<ReuseSpecimen />}
      />
      <Capability
        index={2}
        flip
        name="Safety Functions"
        question="What is this logic supposed to protect?"
        body={
          <>
            <p>
              You declare each safety function once: where it is implemented, its protective output and the state that output takes when it acts,
              and its alarm. INTERLOCK never guesses intent from tag names.
            </p>
            <p>Every conclusion about safety is relative to those declarations, and says so.</p>
          </>
        }
        specimen={<SafetySpecimen />}
      />
      <Capability
        index={3}
        name="Firing Conditions"
        question="When does the shutdown fire now?"
        body={
          <>
            <p>
              The protective output's firing condition is derived from a symbolic scan of both versions and compared over every consistent input
              combination. A weakening comes with a concrete witness: the inputs under which it fired before and does not now.
            </p>
          </>
        }
        specimen={<FiringSpecimen />}
      />
      <Capability
        index={4}
        flip
        name="Alarm Paths"
        question="Will the operator still hear about it?"
        body={
          <>
            <p>
              Notification is analyzed as a path, not a tag: condition, logic, alarm instruction, HMI, operator. A new inhibit, a suppress input on
              an ALMD, or an alarm that no longer follows its trip is reported as the stage where the path breaks.
            </p>
          </>
        }
        specimen={<AlarmSpecimen />}
      />
      <Capability
        index={5}
        name="Blast Radius"
        question="How far does one edit travel?"
        body={
          <>
            <p>
              A changed module is counted against its real call sites, split into the instances inside a declared safety function and the ones that
              run plant equipment without one.
            </p>
          </>
        }
        specimen={<BlastSpecimen />}
      />
      <Capability
        index={6}
        flip
        name="Review Prioritization"
        question="What should I review first?"
        body={
          <>
            <p>
              Documentation edits, export metadata and equivalent rewrites are recorded and set aside. What remains is ranked by what it does to
              protection, so review starts with the change that could stop a shutdown.
            </p>
          </>
        }
        specimen={<ReviewSpecimen />}
      />
    </div>
  )
}
