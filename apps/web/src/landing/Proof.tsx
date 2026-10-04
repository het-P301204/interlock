import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { cx } from '../lib/cx.ts'
import { StatusPill } from '../ui/Badge.tsx'
import { ButtonLink } from '../ui/Button.tsx'
import { LogicDiff } from '../ui/LogicDiff.tsx'
import { Mark } from '../ui/Mark.tsx'
import { ExampleTag, Reveal } from './Reveal.tsx'
import { SCENARIOS } from '../demo/scenarios.ts'

/* ------------------------------------------------------------------ demo */

export function DemoTeaser() {
  return (
    <section aria-labelledby="demo-title" className="border-t border-line">
      <div className="mx-auto max-w-page px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <Reveal className="overflow-hidden rounded-hero bg-inverse text-inverse-ink dark:bg-paper-3 dark:text-ink">
          <div className="grid grid-cols-1 gap-10 p-6 sm:p-10 lg:grid-cols-12 lg:p-14">
            <div className="flex flex-col gap-6 lg:col-span-5">
              <p className="font-mono text-label uppercase text-inverse-2 dark:text-ink-2">Demo</p>
              <h2 id="demo-title" className="text-title-1 [text-wrap:balance]">
                A pump station you can break on purpose.
              </h2>
              <p className="text-[0.9375rem] leading-relaxed text-inverse-2 dark:text-ink-2">
                Northgate Pump Station is a synthetic controller: an emergency shutdown, five pumps sharing one interlock AOI, a compressor, tank
                alarms and the ordinary plumbing around them. Each scenario is a real pair of L5X exports that INTERLOCK analyzes in your browser.
                Nothing on the results pages is pre-computed.
              </p>
              <div>
                <ButtonLink to="/app/demo" variant="secondary" size="lg" iconRight={<ArrowRight />} className="bg-paper text-ink dark:bg-surface">
                  Explore Demo
                </ButtonLink>
              </div>
            </div>
            <ol className="grid grid-cols-1 content-start gap-px overflow-hidden rounded-card bg-inverse-ink/15 dark:bg-line lg:col-span-7">
              {SCENARIOS.map((s) => (
                <li key={s.id} className="flex min-w-0 items-baseline gap-4 bg-inverse px-5 py-3 dark:bg-paper-3">
                  <span className="il-num font-mono text-xs text-inverse-2 dark:text-ink-2">{s.id}</span>
                  <span className="min-w-0 flex-1 text-sm font-semibold">{s.title}</span>
                  <span className="hidden font-mono text-[0.6875rem] text-inverse-2 sm:inline dark:text-ink-2">{s.highlights[0]}</span>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------- evidence */

const LEDGER: Array<[string, string]> = [
  ['Finding', 'IL-0001 · NEW_INHIBIT'],
  ['Source file', 'current-shutdown-weakened.L5X'],
  ['File hash', 'SHA-256 of the exact bytes analyzed'],
  ['Parser', 'L5X adapter, versioned'],
  ['XML location', "/RSLogix5000Content/Controller/Programs/Program[@Name='Compressor']/Routines/Routine[@Name='Main']/RLLContent/Rung[@Number='0']"],
  ['Rule', 'Inhibit term added to a protective firing condition'],
]

export function Evidence() {
  return (
    <section aria-labelledby="evidence-title" className="border-t border-line bg-paper-2/50">
      <div className="mx-auto grid grid-cols-1 max-w-page gap-12 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:px-10 lg:py-28">
        <Reveal className="flex flex-col gap-5 lg:col-span-4">
          <p className="il-label">Evidence</p>
          <h2 id="evidence-title" className="text-title-1 text-ink [text-wrap:balance]">
            Every conclusion points at the bytes it came from.
          </h2>
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">
            Findings carry the exact rung text from both versions, where it sits in the XML, the hash of the file it was read from, the parser that
            read it and the rule that fired. A reviewer can check each claim without trusting INTERLOCK.
          </p>
        </Reveal>
        <Reveal delay={0.08} className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          <LogicDiff
            before="XIC(Pressure_High)XIC(Safety_Enable)OTE(Shutdown_Cmd);"
            after="XIC(Pressure_High)XIC(Safety_Enable)XIO(Maintenance_Mode)OTE(Shutdown_Cmd);"
            beforeMeta="Compressor/Main · rung 0"
            afterMeta="Compressor/Main · rung 0"
          />
          <LogicDiff
            language="condition"
            beforeLabel="FIRES WHEN · BASELINE"
            afterLabel="FIRES WHEN · CURRENT"
            before="Pressure_High AND Safety_Enable"
            after="Pressure_High AND Safety_Enable AND NOT Maintenance_Mode"
          />
          <div className="rounded-card bg-surface shadow-inset-line">
            <p className="il-label border-b border-line px-5 py-3">Evidence ledger</p>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
              {LEDGER.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="il-label pt-0.5">{k}</dt>
                  <dd className="il-ident font-mono text-data text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <ExampleTag />
        </Reveal>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------- coverage */

const COVERAGE: Array<[string, number, number]> = [
  ['Safety functions', 8, 8],
  ['Declared routines', 23, 23],
  ['AOI relationships', 41, 41],
  ['Notification paths', 17, 19],
]

export function Coverage() {
  return (
    <section aria-labelledby="coverage-title" className="border-t border-line">
      <div className="mx-auto grid grid-cols-1 max-w-page gap-12 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:px-10 lg:py-28">
        <Reveal className="flex flex-col gap-6 lg:col-span-6">
          <p className="il-label">Coverage</p>
          <h2 id="coverage-title" className="text-title-1 text-ink [text-wrap:balance]">
            Undeclared is not the same as safe.
          </h2>
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">
            When a change lands in logic that no declared safety function depends on, and that nobody has declared non-safety, INTERLOCK does not
            call it harmless. It reports the routine as needing review and says why it could not conclude more.
          </p>
          <blockquote className="rounded-card border border-dashed border-line-strong bg-paper-2/50 p-5">
            <p className="flex items-center gap-2">
              <StatusPill status="UNDECLARED" />
            </p>
            <p className="mt-3 text-[0.9375rem] font-medium leading-relaxed text-ink">
              No safety intent has been declared for this logic. INTERLOCK therefore cannot conclude that it is safe.
            </p>
          </blockquote>
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">
            The same honesty applies to what the engine cannot read: protected routines, unsupported instructions or an unresolved reference
            inside a safety function lower the coverage and the trust status, never silently pass.
          </p>
        </Reveal>
        <Reveal delay={0.08} className="lg:col-span-5 lg:col-start-8">
          <div className="rounded-panel bg-surface p-6 shadow-soft ring-1 ring-line sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="il-label">Analysis coverage</p>
              <StatusPill status="PARTIAL_COVERAGE" />
            </div>
            <ul className="mt-6 flex flex-col gap-4">
              {COVERAGE.map(([label, c, t]) => (
                <li key={label}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink">{label}</span>
                    <span className="il-num font-mono text-data text-ink">
                      {c}/{t}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.08]" aria-hidden="true">
                    <div className={cx('h-full rounded-full', c === t ? 'bg-ink' : 'bg-marigold')} style={{ width: `${(c / t) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex items-baseline justify-between border-t border-line pt-4">
              <span className="il-label">Coverage</span>
              <span className="il-num text-[2rem] font-extrabold leading-none tracking-[-0.03em] text-ink">91%</span>
            </div>
          </div>
          <div className="mt-3">
            <ExampleTag>Example · trust status is VERIFIED SCOPE, PARTIAL COVERAGE or REVIEW REQUIRED, never “secure”.</ExampleTag>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- trust */

const PRINCIPLES = [
  {
    title: 'Deterministic',
    body: 'Same files and declarations, same result. The analysis id is a hash of the inputs, and no language model decides anything.',
  },
  {
    title: 'Evidence-backed',
    body: 'Each finding cites source file, SHA-256, XML location, parser version, the rule that fired, and the exact logic before and after.',
  },
  {
    title: 'Local',
    body: 'The engine runs in a Web Worker in this page. Project files are not uploaded, and the page makes no third-party requests.',
  },
]

export function Trust() {
  return (
    <section aria-labelledby="trust-title" className="border-t border-line bg-paper-2/50">
      <div className="mx-auto max-w-page px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <Reveal className="max-w-3xl">
          <p className="il-label mb-5">Architecture</p>
          <h2 id="trust-title" className="text-title-1 text-ink [text-wrap:balance]">
            Built to be checked, not believed.
          </h2>
        </Reveal>
        <ul className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-panel bg-line shadow-inset-line md:grid-cols-3">
          {PRINCIPLES.map((p, i) => (
            <Reveal as="li" key={p.title} delay={i * 0.06} className="flex flex-col gap-3 bg-surface p-6 sm:p-8">
              <h3 className="text-title-3 text-ink">{p.title}</h3>
              <p className="text-[0.9375rem] leading-relaxed text-ink-2">{p.body}</p>
            </Reveal>
          ))}
        </ul>
        <Reveal className="mt-6 flex flex-col gap-3 rounded-card border border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-3 text-sm font-semibold text-ink">
            <Mark className="size-6 text-ink" />
            Reads exported project files. Never connects to a PLC, never writes logic, never runs anything from the file.
          </p>
          <Link to="/security" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
            Security model <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </Reveal>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------- cta */

export function Cta() {
  return (
    <section aria-labelledby="cta-title" className="border-t border-line">
      <div className="mx-auto flex max-w-page flex-col items-start gap-8 px-4 py-24 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-10 lg:py-32">
        <Reveal>
          <h2 id="cta-title" className="text-display-2 text-ink">
            Find the changes that matter.
          </h2>
          <p className="mt-4 max-w-xl text-lede text-ink-2">Two exports and your safety declarations. The review set takes seconds and stays in this browser.</p>
        </Reveal>
        <Reveal delay={0.08} className="flex flex-wrap gap-2.5">
          <ButtonLink to="/app/new" variant="primary" size="lg" iconRight={<ArrowRight />}>
            Analyze a Project
          </ButtonLink>
          <ButtonLink to="/app/demo" variant="secondary" size="lg">
            Explore Demo
          </ButtonLink>
        </Reveal>
      </div>
    </section>
  )
}
