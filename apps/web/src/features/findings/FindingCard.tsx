/**
 * FindingCard — one ranked finding as a large, readable record (not a table
 * row). The title is the link; the whole card is clickable through a
 * stretched pseudo-element, so keyboard and screen-reader users get one
 * focusable link per finding.
 */
import { Link } from 'react-router'
import type { ReactNode } from 'react'
import type { Finding, SafetyFunctionResult } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { Badge, SeverityBadge, StatusPill } from '../../ui/Badge.tsx'
import { DISPOSITION_LABEL, FINDING_TYPE_LABEL, NOTIFICATION_LABEL, NOTIFICATION_TONE, UNDECLARED_COPY, locationLabel } from './meta.ts'

const RAIL: Record<Finding['severity'], string> = {
  CRITICAL: 'bg-coral',
  HIGH: 'bg-marigold',
  MEDIUM: 'bg-ink-3',
  LOW: 'bg-line-strong',
  INFO: 'bg-iris',
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <dt className="il-label">{label}</dt>
      <dd className="il-ident min-w-0 text-sm text-ink">{children}</dd>
    </div>
  )
}

export function FindingCard({ finding: f, sfs }: { finding: Finding; sfs: Map<string, SafetyFunctionResult> }) {
  const undeclared = f.disposition === 'UNDECLARED'
  const where = locationLabel(f)
  return (
    <article
      aria-labelledby={`f-${f.id}`}
      className={cx(
        'group relative grid min-w-0 grid-cols-1 gap-x-6 overflow-hidden rounded-panel bg-surface transition-shadow duration-base ease-out-quart hover:shadow-lift sm:grid-cols-[4.5rem_minmax(0,1fr)]',
        undeclared ? 'border border-dashed border-line-strong' : 'shadow-soft ring-1 ring-line',
        'focus-within:ring-2 focus-within:ring-focus',
      )}
    >
      <span aria-hidden="true" className={cx('absolute inset-y-0 left-0 w-1', RAIL[f.severity])} />
      <div className="hidden flex-col items-center border-r border-line py-6 sm:flex">
        <span className="il-num font-mono text-2xl font-semibold tracking-[-0.02em] text-ink">{String(f.rank).padStart(2, '0')}</span>
        <span className="il-label mt-1">rank</span>
      </div>
      <div className="flex min-w-0 flex-col gap-4 px-5 py-5 sm:px-0 sm:py-6 sm:pr-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="il-num font-mono text-xs font-semibold text-ink-2 sm:hidden">#{String(f.rank).padStart(2, '0')}</span>
          <SeverityBadge severity={f.severity} />
          <span className="font-mono text-xs font-semibold text-ink">{f.id}</span>
          <span className="font-mono text-xs text-ink-2">{FINDING_TYPE_LABEL[f.type]}</span>
          <StatusPill status={f.disposition} label={DISPOSITION_LABEL[f.disposition].toUpperCase()} className="sm:ml-auto" />
        </div>

        <div className="min-w-0">
          <h2 id={`f-${f.id}`} className="il-ident text-title-2 text-ink">
            <Link
              to={`/app/findings/${encodeURIComponent(f.id)}`}
              className="outline-none after:absolute after:inset-0 after:content-[''] group-hover:underline group-hover:decoration-ink-3 group-hover:underline-offset-4"
            >
              {f.title}
            </Link>
          </h2>
          <p className="il-ident mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2">{f.summary}</p>
          {undeclared && (
            <p className="mt-3 flex items-start gap-2 rounded-input border border-dashed border-line-strong bg-paper-2/60 px-3.5 py-2.5 text-sm text-ink">
              {UNDECLARED_COPY}
            </p>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Fact label="Safety functions" className="col-span-2 lg:col-span-1">
            {f.safetyFunctionIds.length === 0 ? (
              <span className="text-ink-2">None declared</span>
            ) : (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {f.safetyFunctionIds.map((id) => (
                  <span key={id} className="min-w-0">
                    <span className="font-mono text-xs font-semibold">{id}</span> <span className="text-ink-2">{sfs.get(id)?.function.name}</span>
                  </span>
                ))}
              </span>
            )}
          </Fact>
          <Fact label="Module">{f.module ? <span className="font-mono text-data">{f.module}</span> : <span className="text-ink-2">—</span>}</Fact>
          <Fact label="Blast radius">
            {f.blastRadius ? (
              <span className="il-num">
                <span className="font-semibold">{f.blastRadius.instances}</span> instances · <span className="font-semibold">{f.blastRadius.safetyRelevant}</span> safety
              </span>
            ) : (
              <span className="font-mono text-data text-ink-2">{where || '—'}</span>
            )}
          </Fact>
          <Fact label="Notification">
            {f.notificationImpact === 'NONE' ? (
              <span className="text-ink-2">No impact</span>
            ) : (
              <Badge tone={NOTIFICATION_TONE[f.notificationImpact]}>{NOTIFICATION_LABEL[f.notificationImpact].replace('Notification ', '')}</Badge>
            )}
          </Fact>
          <Fact label="Confidence">
            <span className="font-mono text-xs font-semibold">{f.confidence}</span>
          </Fact>
        </dl>
      </div>
    </article>
  )
}
