/**
 * One declared safety function drawn as a path:
 *   FUNCTION → IMPLEMENTATION → PROTECTIVE OUTPUT → ALARM → STATUS
 * Each connector carries the state of the link it stands for (protective
 * firing verdict, notification path status) as a line style plus a glyph;
 * the cell beside it says the same thing in words, so nothing is colour-only.
 * Expanding the row reveals the before/after firing condition, the
 * notification path, the dependency cone, the declaration and the findings.
 */
import { Fragment, useId } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Network } from 'lucide-react'
import type { AnalysisResult, FiringComparison, FiringVerdict, NotificationStatus, ResolutionState, SafetyFunctionResult } from '@interlock/core/types'
import { NotificationPath } from '../paths/NotificationPath.tsx'
import { cx } from '../../lib/cx.ts'
import { usePrefersReducedMotion } from '../../lib/hooks.ts'
import { enumLabel, plural } from '../../lib/format.ts'
import { Badge, Glyph, SeverityBadge, StatusPill } from '../../ui/Badge.tsx'
import type { GlyphShape, Tone } from '../../ui/Badge.tsx'
import { LogicDiff } from '../../ui/LogicDiff.tsx'
import { LogicText } from '../../ui/LogicText.tsx'

export const CRITICALITY_TONE: Record<string, Tone> = { CRITICAL: 'coral', HIGH: 'marigold', MEDIUM: 'outline', LOW: 'neutral' }

export const VERDICT_LABEL: Record<FiringVerdict, string> = {
  UNCHANGED: 'Unchanged',
  EQUIVALENT: 'Equivalent',
  WEAKENED: 'Weakened',
  STRENGTHENED: 'Strengthened',
  MIXED: 'Changed both ways',
  NEVER_FIRES: 'Never fires',
  ALWAYS_FIRES: 'Always fires',
  NOT_DECIDED: 'Not decided',
}

type LinkState = 'ok' | 'broken' | 'degraded' | 'strong' | 'unknown' | 'none'

const LINK: Record<LinkState, { line: string; glyph?: GlyphShape; glyphCls?: string; word: string }> = {
  ok: { line: 'bg-ink/70', word: 'intact' },
  broken: { line: 'bg-[repeating-linear-gradient(90deg,rgb(var(--coral))_0_6px,transparent_6px_10px)]', glyph: 'cross', glyphCls: 'text-coral-ink', word: 'weakened or broken' },
  degraded: { line: 'bg-[repeating-linear-gradient(90deg,rgb(var(--marigold))_0_6px,transparent_6px_10px)]', glyph: 'half', glyphCls: 'fill-marigold text-marigold-ink', word: 'degraded' },
  strong: { line: 'bg-sage', glyph: 'check', glyphCls: 'text-sage-ink', word: 'strengthened' },
  unknown: { line: 'bg-[repeating-linear-gradient(90deg,rgb(var(--ink-3))_0_3px,transparent_3px_7px)]', glyph: 'ring', glyphCls: 'text-ink-3', word: 'not decided' },
  none: { line: 'bg-[repeating-linear-gradient(90deg,rgb(var(--line-strong))_0_2px,transparent_2px_6px)]', word: 'not declared' },
}

const LINK_V: Record<LinkState, string> = {
  ok: 'bg-ink/70',
  broken: 'bg-[repeating-linear-gradient(180deg,rgb(var(--coral))_0_6px,transparent_6px_10px)]',
  degraded: 'bg-[repeating-linear-gradient(180deg,rgb(var(--marigold))_0_6px,transparent_6px_10px)]',
  strong: 'bg-sage',
  unknown: 'bg-[repeating-linear-gradient(180deg,rgb(var(--ink-3))_0_3px,transparent_3px_7px)]',
  none: 'bg-[repeating-linear-gradient(180deg,rgb(var(--line-strong))_0_2px,transparent_2px_6px)]',
}

export function verdictLink(v: FiringVerdict | undefined): LinkState {
  if (!v) return 'none'
  if (v === 'WEAKENED' || v === 'NEVER_FIRES' || v === 'MIXED') return 'broken'
  if (v === 'ALWAYS_FIRES') return 'degraded'
  if (v === 'STRENGTHENED') return 'strong'
  if (v === 'NOT_DECIDED') return 'unknown'
  return 'ok'
}

export function notificationLink(s: NotificationStatus | undefined): LinkState {
  if (!s) return 'none'
  if (s === 'SUPPRESSED' || s === 'BROKEN') return 'broken'
  if (s === 'DEGRADED') return 'degraded'
  if (s === 'NOT_ANALYZED') return 'unknown'
  return 'ok'
}

function resolutionLink(r: ResolutionState): LinkState {
  return r === 'UNRESOLVED' ? 'unknown' : 'ok'
}

/** Horizontal on wide screens (between cells), vertical on narrow ones (down the left rail). */
function Connector({ state, delay }: { state: LinkState; delay: number }) {
  const m = LINK[state]
  const reduced = usePrefersReducedMotion()
  return (
    <div aria-hidden="true" className="relative flex h-5 w-full items-center pl-[1.15rem] lg:h-auto lg:min-h-12 lg:justify-center lg:pl-0">
      <span className={cx('block h-full w-[2px] lg:hidden', LINK_V[state])} />
      <motion.span
        initial={reduced ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
        className={cx('hidden h-[2px] w-full origin-left lg:block', m.line)}
      />
      {m.glyph && (
        <span className="absolute left-[0.6rem] top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-surface ring-1 ring-line lg:left-1/2 lg:-translate-x-1/2">
          <Glyph shape={m.glyph} className={cx('size-2.5', m.glyphCls)} />
        </span>
      )}
    </div>
  )
}

function Cell({ label, children, muted }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className={cx('min-w-0 rounded-input px-3.5 py-3 lg:px-3', muted ? 'border border-dashed border-line-strong' : 'bg-ink/[0.045]')}>
      <p className="il-label mb-1 lg:hidden">{label}</p>
      {children}
    </div>
  )
}

/** Identifier with line-break opportunities after "_", "/", "." and ":" so long tag names wrap at word joints, not mid-word. */
export function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[_/.:])/)
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </>
  )
}

function Ident({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cx('il-ident block font-mono text-[0.8125rem] font-semibold text-ink', className)}>
      <Breakable text={text} />
    </span>
  )
}

function Resolution({ state }: { state: ResolutionState }) {
  if (state !== 'UNRESOLVED') return null
  return (
    <span className="mt-1 inline-flex items-center gap-1 font-mono text-[0.625rem] font-semibold tracking-[0.06em] text-coral-ink">
      <Glyph shape="cross" className="size-2.5" />
      UNRESOLVED
    </span>
  )
}

function FiringDetail({ cmp, title, outputLabel }: { cmp: FiringComparison; title: string; outputLabel: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="il-label text-ink">{title}</h4>
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={verdictLink(cmp.verdict) === 'broken' ? 'coral' : cmp.verdict === 'STRENGTHENED' ? 'sage' : cmp.verdict === 'NOT_DECIDED' ? 'outline' : 'neutral'}>{VERDICT_LABEL[cmp.verdict]}</Badge>
          <span className="font-mono text-[0.6875rem] text-ink-2">
            {cmp.exhaustive ? `exhaustive · ${plural(cmp.assignmentsChecked, 'assignment')} checked` : cmp.reason ? 'not exhaustive' : `${plural(cmp.assignmentsChecked, 'assignment')} checked`}
          </span>
        </span>
      </div>
      <LogicDiff language="condition" before={cmp.before.text} after={cmp.after.text} beforeLabel={`${outputLabel} · BASELINE`} afterLabel={`${outputLabel} · CURRENT`} />
      {cmp.lost && (
        <div className="rounded-input bg-coral/[0.07] px-4 py-3 ring-1 ring-inset ring-coral/30">
          <p className="il-label mb-1 text-coral-ink">No longer acts when</p>
          <LogicText language="condition" text={cmp.lost.text} />
        </div>
      )}
      {cmp.gained && (
        <div className="rounded-input bg-sage/[0.1] px-4 py-3 ring-1 ring-inset ring-sage/35">
          <p className="il-label mb-1 text-sage-ink">Now also acts when</p>
          <LogicText language="condition" text={cmp.gained.text} />
        </div>
      )}
      {cmp.witness && (
        <div className="min-w-0">
          <p className="text-[0.8125rem] text-ink-2">
            Concrete case: with these inputs the function {cmp.witness.before ? 'acted' : 'did not act'} in the baseline and {cmp.witness.after ? 'acts' : 'does not act'} now.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {cmp.witness.values.map((v) => (
              <li key={v.atom} className="il-ident rounded-[7px] bg-surface px-2 py-1 font-mono text-[0.6875rem] text-ink shadow-inset-line">
                {v.label} = <span className="font-semibold">{v.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cmp.verdict === 'NOT_DECIDED' && cmp.reason && <p className="text-[0.8125rem] text-ink-2">Why not decided: {cmp.reason}</p>}
    </section>
  )
}

function ConeList({ label, items }: { label: string; items: string[] }) {
  return (
    <details className="group min-w-0 rounded-input bg-ink/[0.045] px-3.5 py-2.5">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="text-[0.8125rem] font-semibold text-ink">{label}</span>
        <span className="il-num font-mono text-[1.125rem] font-bold text-ink">{items.length}</span>
      </summary>
      {items.length > 0 ? (
        <ul className="mt-2 flex max-h-48 flex-col gap-0.5 overflow-y-auto il-scroll-thin border-t border-line pt-2">
          {items.map((x) => (
            <li key={x} className="il-ident font-mono text-[0.6875rem] text-ink-2">
              {x}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-2">None</p>
      )}
    </details>
  )
}

export function SafetyPathRow({ sf, result, expanded, onToggle, index, reducedMotion }: { sf: SafetyFunctionResult; result: AnalysisResult; expanded: boolean; onToggle: () => void; index: number; reducedMotion: boolean }) {
  const regionId = useId()
  const f = sf.function
  const impl = f.implementation
  const prot = sf.protective
  const notif = sf.notification
  const findings = sf.findingIds.map((id) => result.findings.find((x) => x.id === id)).filter((x) => x !== undefined)
  const d = (i: number) => (reducedMotion ? 0 : 0.08 * i + Math.min(index, 8) * 0.04)

  return (
    <article
      id={`sf-${f.id}`}
      aria-labelledby={`${regionId}-title`}
      className={cx('min-w-0 scroll-mt-24 rounded-card bg-surface shadow-inset-line transition-shadow duration-base', expanded && 'shadow-soft ring-1 ring-line-strong')}
    >
      <div className="grid grid-cols-1 gap-0 p-3 sm:p-4 lg:grid-cols-[minmax(0,1.1fr)_1.75rem_minmax(0,1fr)_1.75rem_minmax(0,1fr)_1.75rem_minmax(16.5rem,1.2fr)_1.75rem_minmax(8.5rem,auto)] lg:items-stretch lg:gap-0">
        {/* FUNCTION */}
        <div className="min-w-0 rounded-input bg-ink px-4 py-3 text-paper">
          <p className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] tracking-[0.06em] text-paper/70">
            <span className="font-semibold text-paper">{f.id}</span>
            <span>{enumLabel(f.kind)}</span>
          </p>
          <h3 id={`${regionId}-title`} className="il-ident mt-1 text-[0.9375rem] font-bold leading-snug tracking-[-0.01em]">
            {f.name}
          </h3>
          <span className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[0.625rem] font-semibold tracking-[0.08em] text-paper/85">
            <Glyph shape={f.criticality === 'CRITICAL' ? 'octagon' : f.criticality === 'HIGH' ? 'triangle' : f.criticality === 'MEDIUM' ? 'diamond' : 'circle'} className={cx('size-2.5', f.criticality === 'CRITICAL' ? 'fill-coral' : f.criticality === 'HIGH' ? 'fill-marigold' : 'fill-paper/70')} />
            {f.criticality} FUNCTION
          </span>
        </div>
        <Connector state={resolutionLink(sf.resolution.routine)} delay={d(0)} />

        {/* IMPLEMENTATION */}
        <Cell label="Implementation">
          {impl.routine || impl.program ? (
            <>
              <Ident text={impl.routine ?? impl.program ?? ''} />
              {impl.routine && impl.program && (
                <span className="il-ident mt-0.5 block font-mono text-[0.6875rem] text-ink-2">
                  in <Breakable text={impl.program} />
                </span>
              )}
            </>
          ) : (
            <span className="text-[0.8125rem] text-ink-2">No routine declared</span>
          )}
          {(impl.module || impl.instance) && (
            <span className="il-ident mt-0.5 block font-mono text-[0.6875rem] text-ink-2">
              {impl.module && <Breakable text={impl.module} />}
              {impl.instance && (
                <>
                  {impl.module ? ' · ' : ''}
                  <Breakable text={impl.instance} />
                </>
              )}
            </span>
          )}
          <Resolution state={sf.resolution.routine} />
          {sf.resolution.module === 'UNRESOLVED' && <Resolution state="UNRESOLVED" />}
        </Cell>
        <Connector state={f.protectiveOutput ? verdictLink(prot?.verdict) : 'none'} delay={d(1)} />

        {/* PROTECTIVE OUTPUT */}
        <Cell label="Protective output" muted={!f.protectiveOutput}>
          {f.protectiveOutput ? (
            <>
              <Ident text={f.protectiveOutput.tag} />
              <span className="mt-0.5 block font-mono text-[0.6875rem] text-ink-2">acts at {f.protectiveOutput.tripState === 'DE_ENERGIZE' ? '0 (de-energize)' : '1 (energize)'}</span>
              {prot && (
                <span className={cx('mt-1 block font-mono text-[0.6875rem] font-semibold tracking-[0.04em]', verdictLink(prot.verdict) === 'broken' ? 'text-coral-ink' : prot.verdict === 'STRENGTHENED' ? 'text-sage-ink' : 'text-ink')}>
                  Firing: {VERDICT_LABEL[prot.verdict]}
                </span>
              )}
              <Resolution state={sf.resolution.protectiveOutput} />
            </>
          ) : (
            <span className="text-[0.8125rem] text-ink-2">No protective output declared{f.kind === 'ALARM' ? ' (alarm function)' : ''}</span>
          )}
        </Cell>
        <Connector state={f.alarm ? notificationLink(notif?.status) : 'none'} delay={d(2)} />

        {/* ALARM */}
        <Cell label="Alarm" muted={!f.alarm}>
          {f.alarm ? (
            <>
              <Ident text={f.alarm.tag} />
              {notif ? (
                <div className="mt-1.5">
                  <NotificationPath path={notif} compact />
                  <span className={cx('mt-1 block font-mono text-[0.6875rem] font-semibold tracking-[0.04em]', notificationLink(notif.status) === 'broken' ? 'text-coral-ink' : notif.status === 'DEGRADED' ? 'text-marigold-ink' : 'text-ink')}>
                    Notification: {enumLabel(notif.status)}
                  </span>
                </div>
              ) : (
                <span className="mt-0.5 block font-mono text-[0.6875rem] text-ink-2">not analyzed</span>
              )}
              <Resolution state={sf.resolution.alarm} />
            </>
          ) : (
            <span className="text-[0.8125rem] text-ink-2">No alarm declared</span>
          )}
        </Cell>
        <Connector state="ok" delay={d(3)} />

        {/* STATUS */}
        <div className="flex min-w-0 flex-row flex-wrap items-center justify-between gap-2 rounded-input px-1 py-2 lg:flex-col lg:items-stretch lg:justify-center lg:px-0 lg:py-0 lg:pl-1">
          <span className="flex flex-col gap-1">
            <StatusPill status={sf.status} />
            <span className="font-mono text-[0.6875rem] text-ink-2">
              {findings.length > 0 ? plural(findings.length, 'finding') : 'no findings'} · {sf.confidence.toLowerCase()} confidence
            </span>
          </span>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`${regionId}-details`}
            onClick={onToggle}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] px-3 text-[0.8125rem] font-semibold text-ink shadow-inset-line transition-colors hover:bg-paper-2"
          >
            {expanded ? 'Hide details' : 'Details'}
            <ChevronDown aria-hidden="true" className={cx('size-4 transition-transform duration-base', expanded && 'rotate-180')} />
            <span className="sr-only"> for {f.name}</span>
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={`${regionId}-details`}
            key="details"
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex min-w-0 flex-col gap-7 border-t border-line px-4 pb-6 pt-5 sm:px-6">
              {(f.description || f.enableCondition || f.notes || sf.resolution.notes.length > 0) && (
                <section className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <h4 className="il-label mb-1.5 text-ink">Declared intent</h4>
                    {f.description && <p className="max-w-prose text-sm leading-relaxed text-ink">{f.description}</p>}
                    {f.notes && <p className="mt-2 max-w-prose text-[0.8125rem] leading-relaxed text-ink-2">Notes: {f.notes}</p>}
                    {sf.resolution.notes.length > 0 && (
                      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[0.8125rem] text-ink-2">
                        {sf.resolution.notes.map((n) => (
                          <li key={n} className="il-ident">
                            {n}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {f.enableCondition && (
                    <div className="min-w-0">
                      <h4 className="il-label mb-1.5 text-ink">Enable condition</h4>
                      <LogicText language="condition" text={f.enableCondition} />
                      <p className="mt-1 text-xs text-ink-2">Declared by the engineer; informational.</p>
                    </div>
                  )}
                </section>
              )}

              {prot ? (
                <FiringDetail cmp={prot} title="Protective firing condition" outputLabel={`${prot.outputTag} ACTS WHEN`} />
              ) : f.protectiveOutput ? (
                <p className="text-sm text-ink-2">The protective output could not be analyzed. INTERLOCK therefore cannot conclude that this function still acts.</p>
              ) : null}

              {prot && (prot.writersBefore.length > 0 || prot.writersAfter.length > 0) && (
                <section className="min-w-0">
                  <h4 className="il-label mb-2 text-ink">Writers of {prot.outputTag}</h4>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {(['writersBefore', 'writersAfter'] as const).map((k) => (
                      <div key={k} className="min-w-0 rounded-input bg-ink/[0.045] px-3.5 py-2.5">
                        <p className="il-label mb-1">{k === 'writersBefore' ? 'Baseline' : 'Current'}</p>
                        <ul className="flex flex-col gap-0.5">
                          {prot[k].map((w) => (
                            <li key={`${w.routineId}#${w.rung}#${w.instruction}`} className="il-ident font-mono text-[0.6875rem] text-ink">
                              {w.routineId.replace(/^program:/, '')} · rung {w.rung} · {w.instruction}
                            </li>
                          ))}
                          {prot[k].length === 0 && <li className="text-xs text-ink-2">No writer</li>}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {notif && (
                <section className="min-w-0 rounded-card bg-paper-2/40 p-4 shadow-inset-line sm:p-5">
                  <NotificationPath path={notif} />
                </section>
              )}

              <section className="min-w-0">
                <h4 className="il-label mb-2 text-ink">Dependency cone (current project)</h4>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <ConeList label="Routines" items={sf.cone.routines} />
                  <ConeList label="Modules" items={sf.cone.modules} />
                  <ConeList label="Instances" items={sf.cone.instances} />
                  <ConeList label="Tags" items={sf.cone.tags} />
                </div>
                <p className="mt-2 font-mono text-[0.6875rem] text-ink-2">
                  {plural(sf.cone.rungs.length, 'rung')} in the cone · {plural(sf.changeIds.length, 'change')} inside it
                </p>
              </section>

              <section className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <h4 className="il-label mb-2 text-ink">Related findings</h4>
                  {findings.length === 0 ? (
                    <p className="text-sm text-ink-2">No finding affects this function.</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-input bg-surface shadow-inset-line">
                      {findings.map((x) => (
                        <li key={x.id}>
                          <Link to={`/app/findings/${encodeURIComponent(x.id)}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 hover:bg-ink/[0.06]">
                            <span className="font-mono text-xs font-semibold text-ink">{x.id}</span>
                            <span className="il-ident min-w-0 flex-1 text-sm text-ink">{x.title}</span>
                            <SeverityBadge severity={x.severity} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Link
                  to={`/app/graph?node=${encodeURIComponent(`sf:${f.id}`)}`}
                  className="inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-[12px] bg-surface px-3.5 text-[0.8125rem] font-semibold text-ink shadow-inset-line hover:bg-surface-raised"
                >
                  <Network aria-hidden="true" className="size-4" />
                  Show protective path in graph
                </Link>
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  )
}

/** Column headings shown once above the rows on wide screens. */
export function SafetyPathHeader() {
  const cols = ['Function', '', 'Implementation', '', 'Protective output', '', 'Alarm', '', 'Status']
  return (
    <div aria-hidden="true" className="hidden px-4 lg:grid lg:grid-cols-[minmax(0,1.1fr)_1.75rem_minmax(0,1fr)_1.75rem_minmax(0,1fr)_1.75rem_minmax(16.5rem,1.2fr)_1.75rem_minmax(8.5rem,auto)]">
      {cols.map((c, i) => (
        <span key={i} className={cx('il-label', i === 0 ? 'pl-1' : 'pl-3')}>
          {c}
        </span>
      ))}
    </div>
  )
}
