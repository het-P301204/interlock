import { LogicText } from '../ui/LogicText.tsx'
import { diffUnits } from '../ui/logicTokens.ts'
import { tokenize } from '../ui/LogicText.tsx'
import { ExampleTag, Reveal } from './Reveal.tsx'

const BEFORE = 'XIC(Pressure_High)XIC(Safety_Enable)OTE(Shutdown_Cmd);'
const AFTER = 'XIC(Pressure_High)XIC(Safety_Enable)XIO(Maintenance_Mode)OTE(Shutdown_Cmd);'

export function Problem() {
  const ua = tokenize(BEFORE, 'rung')
  const ub = tokenize(AFTER, 'rung')
  const marks = diffUnits(ua, ub)
  return (
    <section aria-labelledby="problem-title" className="border-t border-line">
      <div className="mx-auto max-w-page px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <Reveal>
          <p className="il-label mb-5">The problem</p>
          <h2 id="problem-title" className="max-w-5xl text-display-2 text-ink [text-wrap:balance]">
            A diff can tell you what changed. <span className="text-ink-2">It cannot tell you what stopped working.</span>
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-panel bg-line shadow-inset-line md:grid-cols-2">
          <Reveal className="flex min-w-0 flex-col gap-5 bg-surface p-6 sm:p-8">
            <p className="il-label">What the diff shows</p>
            <div className="min-w-0 overflow-hidden rounded-input bg-paper-2/70 font-mono text-data shadow-inset-line">
              <p className="border-b border-line px-4 py-2 text-[0.6875rem] text-ink-2">Compressor / Main · rung 0</p>
              <div className="flex gap-3 bg-ink/[0.03] px-4 py-2.5">
                <span aria-hidden="true" className="select-none text-ink-3">−</span>
                <span className="sr-only">Removed line: </span>
                <LogicText text={BEFORE} units={ua} marks={marks.a} />
              </div>
              <div className="flex gap-3 px-4 py-2.5">
                <span aria-hidden="true" className="select-none text-ink">+</span>
                <span className="sr-only">Added line: </span>
                <LogicText text={AFTER} units={ub} marks={marks.b} />
              </div>
            </div>
            <p className="text-sm leading-relaxed text-ink-2">
              One rung among hundreds of edits in the same export: tag descriptions, rung comments, export dates, preset tweaks. Nothing in the diff says
              which of them matters.
            </p>
          </Reveal>
          <Reveal delay={0.08} className="flex min-w-0 flex-col gap-5 bg-surface p-6 sm:p-8">
            <p className="il-label">What it means</p>
            <p className="text-title-2 text-ink [text-wrap:pretty]">
              The shutdown no longer fires while <span className="whitespace-nowrap font-mono text-[0.92em]">Maintenance_Mode</span> is set.
            </p>
            <p className="text-[0.9375rem] leading-relaxed text-ink-2">
              That sentence is the review. INTERLOCK derives it from the two project files and the safety functions you declare, names the function it
              affects, counts the call sites that inherit it, and attaches the exact logic it came from.
            </p>
            <div className="mt-auto">
              <ExampleTag />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

const MODEL = [
  { name: 'Project', body: 'Both exports parsed into one vendor-neutral model: tasks, programs, routines, rungs, modules and tags.' },
  { name: 'Reuse Graph', body: 'Which reusable definitions run where, called from which routine, scheduled by which task.' },
  { name: 'Safety Map', body: 'The safety functions you declare, resolved to the logic, outputs and alarms that implement them.' },
  { name: 'Semantic Analysis', body: 'Firing conditions compared over every input combination, before and after the change.' },
  { name: 'Impact Review', body: 'Findings ranked by safety impact, each with the evidence that produced it.' },
]

export function Model() {
  return (
    <section aria-labelledby="model-title" className="border-t border-line bg-paper-2/50">
      <div className="mx-auto max-w-page px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <Reveal className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="il-label mb-5">The model</p>
            <h2 id="model-title" className="text-title-1 text-ink [text-wrap:balance]">
              Five representations, each built from the one before it.
            </h2>
          </div>
          <p className="text-lede text-ink-2 lg:col-span-6 lg:col-start-7 lg:self-end">
            A change is only meaningful against a model of what the project does. INTERLOCK builds that model in order, and every finding can be
            walked back through it.
          </p>
        </Reveal>

        <ol className="relative mt-14 grid grid-cols-1 gap-0 lg:grid-cols-5">
          {/* the rail */}
          <span aria-hidden="true" className="absolute bottom-3 left-[11px] top-3 w-[2px] bg-ink lg:bottom-auto lg:left-3 lg:right-3 lg:top-[11px] lg:h-[2px] lg:w-auto" />
          {MODEL.map((m, i) => (
            <Reveal as="li" key={m.name} delay={i * 0.07} className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-x-5 pb-9 last:pb-0 lg:flex lg:flex-col lg:gap-5 lg:pb-0 lg:pr-8">
              <span aria-hidden="true" className="relative z-10 flex size-6 items-center justify-center rounded-full bg-paper ring-2 ring-ink">
                <span className="size-2 rounded-full bg-ink" />
              </span>
              <div className="min-w-0">
                <p className="il-num font-mono text-xs font-semibold tracking-[0.1em] text-ink-2">{String(i + 1).padStart(2, '0')}</p>
                <h3 className="mt-1.5 text-title-3 text-ink">{m.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{m.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
