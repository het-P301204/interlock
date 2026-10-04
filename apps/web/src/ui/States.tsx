/**
 * EmptyState, LoadingState (skeletons) and ErrorState.
 *
 *   <EmptyState title="Nothing analyzed yet." body="Import a known-good PLC project and a current export to reveal changes that matter."
 *               action={<ButtonLink to="/app/new" variant="primary">Start Analysis</ButtonLink>} />
 *   <EmptyState title="No safety-impacting changes identified within the declared analysis scope."
 *               facts={[['Safety functions analyzed', '8/8'], ['Declared routines covered', '100%'], ['Undeclared routines touched', '0']]} />
 *   <LoadingState variant="table" label="Loading findings" />
 *   <ErrorState title="PROJECT PARSE FAILED" message="The uploaded L5X file appears malformed." location="Controller.Tags[27]"
 *               reason="Unexpected XML element." consequence="INTERLOCK did not continue analysis because the semantic model could not be trusted."
 *               diagnostics={[…]} />
 *
 * Copy rules: never "Oops", never "No vulnerabilities found". Errors say what
 * happened and what to do; empty states invite the next action.
 */
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ParserDiagnostic } from '@interlock/core/types'
import { cx } from '../lib/cx.ts'
import { Glyph } from './Badge.tsx'

/* ----------------------------------------------------------------- empty */

export interface EmptyStateProps {
  title: string
  body?: ReactNode
  eyebrow?: string
  action?: ReactNode
  secondary?: ReactNode
  facts?: Array<[string, ReactNode]>
  illustration?: ReactNode
  className?: string
}

/** A quiet ladder-rung drawing: two rails and an open rung, used as the default empty illustration. */
export function OpenRungIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 72" aria-hidden="true" className={cx('h-auto w-[220px] text-ink-3', className)} fill="none">
      <path d="M8 6v60M212 6v60" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M8 36h50M66 36h44M150 36h28M196 36h16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 5" strokeLinecap="round" />
      <path d="M58 24v24M66 24v24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M110 36h40" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
      <path d="M182 26a12 12 0 000 20M192 26a12 12 0 010 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function EmptyState({ title, body, eyebrow, action, secondary, facts, illustration, className }: EmptyStateProps) {
  return (
    <section className={cx('flex flex-col items-start gap-5 rounded-panel border border-dashed border-line-strong bg-paper-2/40 px-6 py-10 sm:px-10 sm:py-14', className)}>
      {illustration ?? <OpenRungIllustration />}
      <div className="max-w-xl">
        {eyebrow && <p className="il-label mb-2">{eyebrow}</p>}
        <h2 className="text-title-2 text-ink">{title}</h2>
        {body && <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">{body}</p>}
      </div>
      {facts && facts.length > 0 && (
        <dl className="grid w-full max-w-xl grid-cols-[minmax(0,1fr)_auto] gap-x-6 border-t border-line pt-4 font-mono text-data">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="py-1 text-ink-2">{k}</dt>
              <dd className="il-num py-1 text-right text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {(action || secondary) && (
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </section>
  )
}

/* --------------------------------------------------------------- loading */

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('il-skeleton block', className)} />
}

export function LoadingState({ variant = 'page', label = 'Loading', className }: { variant?: 'page' | 'table' | 'card' | 'lines'; label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cx('w-full', className)}>
      <span className="sr-only">{label}</span>
      {variant === 'lines' && (
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-9/12" />
          <Skeleton className="h-3.5 w-10/12" />
        </div>
      )}
      {variant === 'card' && (
        <div className="flex flex-col gap-4 rounded-card bg-surface p-5 shadow-inset-line">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-2/3" />
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        </div>
      )}
      {variant === 'table' && (
        <div className="overflow-hidden rounded-card bg-surface shadow-inset-line">
          <div className="flex gap-6 border-b border-line px-5 py-3.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-40" />
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-6 border-b border-line px-5 py-4 last:border-0">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-3.5 flex-1" />
            </div>
          ))}
        </div>
      )}
      {variant === 'page' && (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-1/2" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-panel" />
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- error */

export interface ErrorStateProps {
  title: string
  message: ReactNode
  location?: string
  reason?: ReactNode
  consequence?: ReactNode
  diagnostics?: ParserDiagnostic[]
  action?: ReactNode
  className?: string
  /** Announce assertively when it appears (default true). */
  announce?: boolean
}

export function ErrorState({ title, message, location, reason, consequence, diagnostics, action, className, announce = true }: ErrorStateProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <section
      role={announce ? 'alert' : undefined}
      className={cx('relative min-w-0 overflow-hidden rounded-card border border-coral/45 bg-surface', className)}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-coral" />
      <div className="flex flex-col gap-4 py-5 pl-6 pr-5 sm:pl-7">
        <div className="flex items-center gap-2.5">
          <Glyph shape="octagon" className="size-3.5 fill-coral" />
          <h3 className="font-mono text-[0.8125rem] font-semibold uppercase tracking-[0.1em] text-coral-ink">{title}</h3>
        </div>
        <p className="text-[0.9375rem] font-medium text-ink">{message}</p>
        {(location || reason) && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 font-mono text-data">
            {location && (
              <>
                <dt className="text-ink-2">Location</dt>
                <dd className="il-ident text-ink">{location}</dd>
              </>
            )}
            {reason && (
              <>
                <dt className="text-ink-2">Reason</dt>
                <dd className="il-ident text-ink">{reason}</dd>
              </>
            )}
          </dl>
        )}
        {consequence && <p className="text-sm text-ink-2">{consequence}</p>}
        {(diagnostics?.length || action) && (
          <div className="flex flex-wrap items-center gap-3">
            {action}
            {diagnostics && diagnostics.length > 0 && (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-[8px] text-sm font-semibold text-ink underline-offset-4 hover:underline"
              >
                <ChevronRight aria-hidden="true" className={cx('size-4 transition-transform duration-fast', open && 'rotate-90')} />
                View parser diagnostics
                <span className="il-num font-mono text-xs font-normal text-ink-2">({diagnostics.length})</span>
              </button>
            )}
          </div>
        )}
        {diagnostics && diagnostics.length > 0 && (
          <div id={panelId} hidden={!open}>
            <DiagnosticsList diagnostics={diagnostics} />
          </div>
        )}
      </div>
    </section>
  )
}

const diagGlyph = {
  error: <Glyph shape="octagon" className="mt-[3px] fill-coral" />,
  warning: <Glyph shape="triangle" className="mt-[3px] fill-marigold" />,
  info: <Glyph shape="square" className="mt-[3px] fill-iris" />,
}

export function DiagnosticsList({ diagnostics, className }: { diagnostics: ParserDiagnostic[]; className?: string }) {
  return (
    <ol className={cx('il-scroll-thin max-h-72 overflow-y-auto rounded-input bg-paper-2/70 p-1 shadow-inset-line', className)}>
      {diagnostics.map((d, i) => (
        <li key={`${d.code}-${i}`} className="flex min-w-0 gap-2.5 rounded-[12px] px-3 py-2.5 font-mono text-xs odd:bg-surface/60">
          {diagGlyph[d.severity]}
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold uppercase text-ink">{d.severity}</span>
              <span className="il-ident text-ink-2">{d.code}</span>
            </p>
            <p className="il-ident mt-0.5 font-sans text-[0.8125rem] text-ink">{d.message}</p>
            {(d.location || d.source) && (
              <p className="il-ident mt-0.5 text-ink-2">
                {d.location}
                {d.source && ` · line ${d.source.line}, col ${d.source.column}`}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
