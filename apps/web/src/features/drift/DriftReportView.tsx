/**
 * Renders a DriftReport: a site × module matrix (revision, definition hash
 * and behaviour per cell, the reference marked), then one section per
 * module with its flags explained in plain English, its notes, and each
 * variant's behaviour, including the output-by-output comparison against the
 * reference for variants that act differently.
 */
import type { DriftReport, ModuleDrift, ModuleVariant } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { formatBytes, plural, shortHash } from '../../lib/format.ts'
import { Badge, Glyph, StatusPill } from '../../ui/Badge.tsx'
import { LogicDiff } from '../../ui/LogicDiff.tsx'
import { LogicText } from '../../ui/LogicText.tsx'
import { Breakable, VERDICT_LABEL } from '../safety/SafetyPathRow.tsx'
import { BEHAVIOR_META, FLAG_META, flagSites, referenceVariant, stripModulePrefix, variantOf } from './driftModel.ts'

const FILL: Record<string, string> = { coral: 'fill-coral', marigold: 'fill-marigold', sage: 'fill-sage', iris: 'fill-iris', neutral: 'fill-ink-2', outline: 'fill-ink-2' }

export function BehaviorBadge({ behavior }: { behavior: ModuleVariant['behavior'] }) {
  const m = BEHAVIOR_META[behavior]
  const stroke = m.shape === 'check' || m.shape === 'ring'
  return (
    <Badge tone={m.tone} dashed={behavior === 'NOT_DECIDED'} solid={behavior === 'REFERENCE'} icon={<Glyph shape={m.shape} className={cx(stroke ? '' : behavior === 'REFERENCE' ? 'fill-current' : FILL[m.tone])} />}>
      {m.label}
    </Badge>
  )
}

function Matrix({ report }: { report: DriftReport }) {
  const sites = report.sites
  return (
    <>
      {/* md+: a real table */}
      <div className="hidden overflow-hidden rounded-card bg-surface shadow-inset-line md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">Module definitions per site</caption>
          <thead>
            <tr className="border-b border-line bg-paper-2/50">
              <th scope="col" className="w-[26%] px-5 py-3">
                <span className="il-label">Module</span>
              </th>
              {sites.map((s) => (
                <th key={s.label} scope="col" className="px-4 py-3 align-bottom">
                  <span className="il-ident block text-sm font-bold text-ink">{s.label}</span>
                  <span className="il-ident block font-mono text-[0.6875rem] font-normal text-ink-2">
                    <Breakable text={s.controller} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.modules.map((m) => (
              <tr key={m.module} className="border-b border-line last:border-0">
                <th scope="row" className="px-5 py-4 align-top">
                  <a href={`#drift-${m.module}`} className="il-ident block font-mono text-[0.8125rem] font-semibold text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
                    <Breakable text={m.module} />
                  </a>
                  <StatusPill status={m.status} className="mt-2" />
                </th>
                {sites.map((s) => {
                  const v = variantOf(m, s.label)
                  return (
                    <td key={s.label} className="px-4 py-4 align-top">
                      {v ? (
                        <div className={cx('flex min-w-0 flex-col items-start gap-1.5 rounded-input px-3 py-2.5', v.behavior === 'REFERENCE' ? 'bg-ink/[0.05] ring-1 ring-inset ring-ink/25' : 'bg-ink/[0.045]')}>
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="il-num text-[1.25rem] font-extrabold leading-none tracking-[-0.03em] text-ink">v{v.revision ?? '?'}</span>
                            <span className="font-mono text-[0.625rem] text-ink-2">#{v.hash.slice(0, 6)}</span>
                          </span>
                          <BehaviorBadge behavior={v.behavior} />
                        </div>
                      ) : (
                        <div className="flex min-w-0 items-center gap-1.5 rounded-input border border-dashed border-line-strong px-3 py-2.5 font-mono text-[0.6875rem] text-ink-2">
                          <Glyph shape="dash" className="fill-ink-3" />
                          Not present
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* phones: one card per module */}
      <ul className="flex flex-col gap-3 md:hidden">
        {report.modules.map((m) => (
          <li key={m.module} className="rounded-card bg-surface p-4 shadow-inset-line">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="il-ident font-mono text-[0.8125rem] font-semibold text-ink">
                <Breakable text={m.module} />
              </span>
              <StatusPill status={m.status} />
            </div>
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {sites.map((s) => {
                const v = variantOf(m, s.label)
                return (
                  <li key={s.label} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 text-sm font-semibold text-ink">{s.label}</span>
                    {v ? (
                      <span className="flex items-center gap-2">
                        <span className="il-num font-mono text-sm font-bold text-ink">v{v.revision ?? '?'}</span>
                        <BehaviorBadge behavior={v.behavior} />
                      </span>
                    ) : (
                      <span className="font-mono text-[0.6875rem] text-ink-2">Not present</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>
    </>
  )
}

function VariantCard({ m, v, reference }: { m: ModuleDrift; v: ModuleVariant; reference?: ModuleVariant }) {
  const meta = BEHAVIOR_META[v.behavior]
  const differs = v.outputs.filter((o) => o.comparison.verdict !== 'UNCHANGED' && o.comparison.verdict !== 'EQUIVALENT')
  return (
    <li className={cx('min-w-0 rounded-card p-4 sm:p-5', v.behavior === 'WEAKER' ? 'bg-surface ring-1 ring-inset ring-coral/40' : 'bg-surface shadow-inset-line')}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <BehaviorBadge behavior={v.behavior} />
            <span className="text-sm font-bold text-ink">{v.sites.join(', ')}</span>
          </p>
          <p className="mt-1.5 font-mono text-[0.6875rem] text-ink-2">
            revision {v.revision ?? 'not stated'} · definition #{v.hash}
          </p>
        </div>
        <p className="max-w-sm text-[0.8125rem] text-ink-2">{meta.explain}</p>
      </div>
      <p className="il-ident mt-3 rounded-input bg-ink/[0.045] px-3 py-2 font-mono text-[0.6875rem] text-ink-2">
        <span className="font-semibold text-ink">Parameters</span> {v.parameterSignature}
      </p>
      {differs.length > 0 && reference && (
        <div className="mt-4 flex flex-col gap-4">
          {differs.map((o) => (
            <div key={o.parameter} className="flex min-w-0 flex-col gap-2.5">
              <p className="flex flex-wrap items-center gap-2">
                <span className="il-label text-ink">Output {o.parameter}</span>
                <Badge tone={o.comparison.verdict === 'WEAKENED' || o.comparison.verdict === 'NEVER_FIRES' ? 'coral' : o.comparison.verdict === 'STRENGTHENED' ? 'sage' : 'marigold'}>{VERDICT_LABEL[o.comparison.verdict]}</Badge>
                <span className="font-mono text-[0.6875rem] text-ink-2">{o.comparison.exhaustive ? `exhaustive · ${plural(o.comparison.assignmentsChecked, 'assignment')}` : 'not exhaustive'}</span>
              </p>
              <LogicDiff
                language="condition"
                before={stripModulePrefix(o.comparison.before.text, m.module)}
                after={stripModulePrefix(o.comparison.after.text, m.module)}
                beforeLabel={`REFERENCE · ${m.reference}`}
                afterLabel={v.sites.join(', ').toUpperCase()}
                beforeMeta={reference.revision ? `v${reference.revision}` : undefined}
                afterMeta={v.revision ? `v${v.revision}` : undefined}
              />
              {o.comparison.lost && (
                <div className="rounded-input bg-coral/[0.07] px-4 py-3 ring-1 ring-inset ring-coral/30">
                  <p className="il-label mb-1 text-coral-ink">Acts at {m.reference}, not at {v.sites.join(', ')}, when</p>
                  <LogicText language="condition" text={stripModulePrefix(o.comparison.lost.text, m.module)} />
                </div>
              )}
              {o.comparison.gained && (
                <div className="rounded-input bg-sage/[0.1] px-4 py-3 ring-1 ring-inset ring-sage/35">
                  <p className="il-label mb-1 text-sage-ink">Acts at {v.sites.join(', ')} but not at {m.reference}, when</p>
                  <LogicText language="condition" text={stripModulePrefix(o.comparison.gained.text, m.module)} />
                </div>
              )}
              {o.comparison.witness && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Concrete case">
                  {o.comparison.witness.values.map((w) => (
                    <li key={w.atom} className="il-ident rounded-[7px] bg-ink/[0.06] px-2 py-1 font-mono text-[0.6875rem] text-ink">
                      {stripModulePrefix(w.label, m.module)} = <span className="font-semibold">{w.value}</span>
                    </li>
                  ))}
                  <li className="px-1 py-1 text-[0.6875rem] text-ink-2">
                    → {o.comparison.witness.before ? 'acts' : 'does not act'} at {m.reference}, {o.comparison.witness.after ? 'acts' : 'does not act'} at {v.sites.join(', ')}
                  </li>
                </ul>
              )}
            </div>
          ))}
          <p className="text-xs text-ink-2">Conditions are over the parameters of {m.module}, evaluated in isolation. The direction (weaker / stronger) comes from the declared protective outputs.</p>
        </div>
      )}
    </li>
  )
}

function ModuleSection({ m }: { m: ModuleDrift }) {
  const sitesFor = flagSites(m)
  const ref = referenceVariant(m)
  const ordered = [...m.variants].sort((a, b) => (a === ref ? -1 : b === ref ? 1 : 0))
  return (
    <section id={`drift-${m.module}`} aria-labelledby={`drift-${m.module}-title`} className="min-w-0 scroll-mt-24 rounded-panel bg-paper-2/40 p-4 shadow-inset-line sm:p-6">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="il-label mb-1">Module</p>
          <h3 id={`drift-${m.module}-title`} className="il-ident font-mono text-[1.25rem] font-bold tracking-[-0.01em] text-ink">
            <Breakable text={m.module} />
          </h3>
          <p className="mt-1 text-[0.8125rem] text-ink-2">
            {plural(m.variants.length, 'distinct definition')} · reference {m.reference}
            {m.missingAt.length > 0 ? ` · missing at ${m.missingAt.join(', ')}` : ''}
          </p>
        </div>
        <StatusPill status={m.status} size="md" label={m.status === 'DRIFT' ? 'DRIFT DETECTED' : 'CONSISTENT'} />
      </header>

      {m.flags.length > 0 && (
        <ul className="mt-5 flex flex-col gap-2.5">
          {m.flags.map((f) => {
            const meta = FLAG_META[f]
            const at = sitesFor[f] ?? []
            return (
              <li key={f} className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:items-baseline">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <Badge tone={meta.tone} dashed={meta.tone === 'outline'} icon={<Glyph shape={meta.shape} className={meta.shape === 'ring' ? '' : FILL[meta.tone]} />} className="whitespace-normal">
                    {meta.label}
                  </Badge>
                </span>
                <span className="text-sm leading-relaxed text-ink">
                  {meta.explain}
                  {at.length > 0 && <span className="ml-1 font-mono text-xs font-semibold text-ink-2">({at.join(', ')})</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {m.notes.length > 0 && (
        <ul className="mt-4 flex list-disc flex-col gap-1 pl-5 text-[0.8125rem] text-ink-2">
          {m.notes.map((n) => (
            <li key={n} className="il-ident">
              {n}
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-5 flex flex-col gap-3">
        {ordered.map((v) => (
          <VariantCard key={v.hash} m={m} v={v} reference={ref} />
        ))}
      </ul>
    </section>
  )
}

export function DriftReportView({ report }: { report: DriftReport }) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby="drift-sites" className="min-w-0">
        <h2 id="drift-sites" className="il-label mb-3 text-ink">
          Sites compared
        </h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {report.sites.map((s) => (
            <li key={s.label} className="min-w-0 rounded-input bg-surface px-4 py-3 shadow-inset-line">
              <p className="text-sm font-bold text-ink">{s.label}</p>
              <p className="il-ident font-mono text-xs text-ink">
                <Breakable text={s.file.name} />
              </p>
              <p className="il-ident font-mono text-[0.6875rem] text-ink-2">
                {s.controller} · {formatBytes(s.file.sizeBytes)} · SHA-256 {shortHash(s.file.sha256, 8, 4)}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="drift-matrix" className="min-w-0">
        <h2 id="drift-matrix" className="il-label mb-3 text-ink">
          Site × module matrix
        </h2>
        <Matrix report={report} />
      </section>
      {report.modules.map((m) => (
        <ModuleSection key={m.module} m={m} />
      ))}
    </div>
  )
}
