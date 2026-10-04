/**
 * Ingest cards for one project version:
 *   VerifyingCard      real progress while the worker hashes and the engine parses
 *   VerificationCard   the engine's ProjectVersionSummary once parsing succeeded
 *   ParseFailedCard    PROJECT PARSE FAILED with location / reason / diagnostics
 */
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Check, ChevronRight, Copy, RefreshCw, X } from 'lucide-react'
import type { ProjectVersionSummary } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { formatBytes, formatCount, formatMs, shortHash } from '../../lib/format.ts'
import type { SideState } from '../../state/analysis.ts'
import { Glyph, StatusPill } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { IconButton } from '../../ui/IconButton.tsx'
import { DiagnosticsList, ErrorState, Skeleton } from '../../ui/States.tsx'
import { toast } from '../../ui/Toast.tsx'

function CardFrame({ role, children, className, status }: { role: string; children: ReactNode; className?: string; status?: ReactNode }) {
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      aria-label={`${role} project`}
      className={cx('flex min-w-0 flex-col overflow-hidden rounded-panel bg-surface shadow-soft ring-1 ring-line', className)}
    >
      <header className="flex min-h-[52px] items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
        <p className="il-label text-ink">{role}</p>
        {status}
      </header>
      {children}
    </motion.section>
  )
}

/* ------------------------------------------------------------- verifying */

type StepState = 'done' | 'active' | 'pending'

function Step({ state, label, detail }: { state: StepState; label: string; detail?: ReactNode }) {
  return (
    <li className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-3">
      <span aria-hidden="true" className="mt-0.5 flex size-[18px] items-center justify-center">
        {state === 'done' && (
          <span className="flex size-[18px] items-center justify-center rounded-full bg-ink text-paper">
            <Glyph shape="check" className="size-2.5" />
          </span>
        )}
        {state === 'active' && (
          <span className="flex size-[18px] items-center justify-center rounded-full ring-2 ring-ink">
            <span className="il-pulse-dot size-1.5 rounded-full bg-ink" />
          </span>
        )}
        {state === 'pending' && <span className="size-3 rounded-full ring-[1.5px] ring-line-strong" />}
      </span>
      <div className="min-w-0">
        <p className={cx('text-sm font-semibold', state === 'pending' ? 'text-ink-3' : 'text-ink')}>
          {label}
          <span className="sr-only"> — {state === 'done' ? 'complete' : state === 'active' ? 'in progress' : 'pending'}</span>
        </p>
        {detail && <div className="mt-0.5 min-w-0">{detail}</div>}
      </div>
    </li>
  )
}

export function VerifyingCard({ role, side, onCancel }: { role: string; side: SideState; onCancel: () => void }) {
  const p = side.phase
  const read: StepState = p === 'reading' ? 'active' : 'done'
  const hash: StepState = p === 'reading' ? 'pending' : p === 'hashing' && !side.sha256 ? 'active' : 'done'
  const parse: StepState = p === 'parsing' ? 'active' : 'pending'
  return (
    <CardFrame role={role} status={<span className="font-mono text-xs text-ink-2">Verifying…</span>}>
      <div className="flex flex-col gap-5 px-5 py-5 sm:px-6" aria-live="polite" aria-busy="true">
        <div className="min-w-0">
          <p className="il-ident text-title-3 text-ink">{side.name}</p>
          <p className="font-mono text-xs text-ink-2">{side.size !== undefined ? formatBytes(side.size) : ''}</p>
        </div>
        <ol className="flex flex-col gap-3.5">
          <Step state={read} label="Read file into this browser" />
          <Step
            state={hash}
            label="Compute SHA-256"
            detail={side.sha256 ? <p className="il-ident font-mono text-xs text-ink-2">{side.sha256}</p> : hash === 'active' ? <Skeleton className="mt-1 h-3 w-4/5" /> : null}
          />
          <Step state={parse} label="Parse and build the project model" detail={parse === 'active' ? <Skeleton className="mt-1 h-3 w-1/2" /> : null} />
        </ol>
        <div className="flex flex-col gap-2.5 border-t border-line pt-4">
          <Skeleton className="h-3 w-1/3" />
          <div className="grid grid-cols-4 gap-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        </div>
        <div>
          <Button variant="ghost" size="sm" iconLeft={<X />} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </CardFrame>
  )
}

/* ---------------------------------------------------------- verification */

function HashRow({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sha)
      setCopied(true)
      toast({ title: 'SHA-256 copied', tone: 'success' })
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast({ title: 'Could not copy to the clipboard', body: 'Select the hash and copy it manually.', tone: 'error' })
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-input bg-paper-2/70 py-1.5 pl-3.5 pr-1.5 shadow-inset-line">
      <span className="il-label shrink-0">SHA-256</span>
      <span className="min-w-0 flex-1 truncate font-mono text-data text-ink" title={sha}>
        <span aria-hidden="true">{shortHash(sha, 16, 8)}</span>
        <span className="sr-only">{sha}</span>
      </span>
      <IconButton label={copied ? 'Copied' : 'Copy SHA-256'} size="sm" onClick={copy} tooltipSide="top" tooltipAlign="end">
        {copied ? <Check /> : <Copy />}
      </IconButton>
    </div>
  )
}

export function VerificationCard({ role, summary, elapsedMs, onReplace, onRemove }: { role: string; summary: ProjectVersionSummary; elapsedMs?: number; onReplace: (f: File) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const diagId = useId()
  const replaceId = useId()
  const m = summary.metadata
  const c = summary.counts
  const errors = summary.diagnostics.filter((d) => d.severity === 'error').length
  const warnings = summary.diagnostics.filter((d) => d.severity === 'warning').length
  const infos = summary.diagnostics.length - errors - warnings

  const meta: Array<[string, ReactNode]> = [
    ['Vendor', m.vendor],
    ['Format', m.formatLabel],
    ['Parser', `${summary.parser.adapter} ${summary.parser.version}`],
    ['Controller', m.controllerName],
    ['Processor', m.processorType ?? '—'],
    ['Firmware', m.firmwareRevision ?? '—'],
    ['Software', m.softwareRevision ?? '—'],
    ['Exported', m.exportDate ?? '—'],
  ]
  if (m.containsContext || m.targetType !== 'Controller') meta.push(['Export scope', `${m.targetType}${m.containsContext ? ' (partial, with context)' : ''}`])

  const counts: Array<[string, number]> = [
    ['Programs', c.programs],
    ['Routines', c.routines],
    ['Rungs', c.rungs],
    ['AOI definitions', c.modules],
    ['Instances', c.instances],
    ['Tags', c.tags],
    ['Tasks', c.tasks],
  ]

  return (
    <CardFrame role={role} status={<StatusPill status={summary.readiness} />}>
      <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="il-ident text-title-3 text-ink">{summary.file.name}</p>
            <p className="mt-0.5 font-mono text-xs text-ink-2">
              {formatBytes(summary.file.sizeBytes)} · {m.format}
              {elapsedMs !== undefined && <> · verified in {formatMs(elapsedMs)}</>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <input
              id={replaceId}
              type="file"
              accept=".L5X,.l5x,.xml"
              className="peer sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onReplace(f)
                e.target.value = ''
              }}
            />
            <label
              htmlFor={replaceId}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-[10px] text-ink-2 hover:bg-ink/[0.06] hover:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
              title={`Replace ${role.toLowerCase()} file`}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              <span className="sr-only">Replace {role.toLowerCase()} file</span>
            </label>
            <IconButton label={`Remove ${role.toLowerCase()} file`} size="sm" onClick={onRemove} tooltipSide="top" tooltipAlign="end">
              <X />
            </IconButton>
          </div>
        </div>

        <HashRow sha={summary.file.sha256} />

        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="il-label pt-[3px]">{k}</dt>
              <dd className="il-ident min-w-0 font-mono text-data text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-input bg-line shadow-inset-line xs:grid-cols-4">
          {counts.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <dt className="font-mono text-[0.625rem] uppercase tracking-[0.08em] text-ink-2">{k}</dt>
              <dd className="il-num text-lg font-extrabold tracking-[-0.02em] text-ink">{formatCount(v)}</dd>
            </div>
          ))}
          <div aria-hidden="true" className="hidden bg-surface xs:block" />
        </dl>

        <div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={diagId}
            onClick={() => setOpen((o) => !o)}
            disabled={summary.diagnostics.length === 0}
            className="inline-flex items-center gap-2 rounded-[8px] text-sm font-semibold text-ink disabled:cursor-default disabled:text-ink-2"
          >
            {summary.diagnostics.length > 0 && <ChevronRight aria-hidden="true" className={cx('size-4 transition-transform duration-fast', open && 'rotate-90')} />}
            Parser diagnostics
            <span className="flex items-center gap-2 font-mono text-xs font-normal text-ink-2">
              {summary.diagnostics.length === 0 ? (
                'none'
              ) : (
                <>
                  {errors > 0 && <span className="inline-flex items-center gap-1"><Glyph shape="octagon" className="size-2.5 fill-coral" />{errors} error{errors === 1 ? '' : 's'}</span>}
                  {warnings > 0 && <span className="inline-flex items-center gap-1"><Glyph shape="triangle" className="size-2.5 fill-marigold" />{warnings} warning{warnings === 1 ? '' : 's'}</span>}
                  {infos > 0 && <span className="inline-flex items-center gap-1"><Glyph shape="square" className="size-2.5 fill-iris" />{infos} info</span>}
                </>
              )}
            </span>
          </button>
          <div id={diagId} hidden={!open} className="mt-3">
            <DiagnosticsList diagnostics={summary.diagnostics} />
          </div>
        </div>
      </div>
    </CardFrame>
  )
}

/* ---------------------------------------------------------------- failed */

export function ParseFailedCard({ role, side, onRetry }: { role: string; side: SideState; onRetry: (f: File) => void }) {
  const inputId = useId()
  const res = side.result
  const err = res && !res.ok ? res.error : side.error?.inspect
  const message = err ? `The uploaded file could not be parsed as a trusted project model.` : side.error?.message ?? 'Analysis could not be completed.'
  return (
    <CardFrame role={role} status={<StatusPill status="BLOCKED" />}>
      <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <p className="il-ident text-title-3 text-ink">{side.name}</p>
          <p className="font-mono text-xs text-ink-2">
            {side.size !== undefined && formatBytes(side.size)}
            {res && ` · SHA-256 ${shortHash(res.file.sha256)}`}
          </p>
        </div>
        <ErrorState
          title="Project parse failed"
          message={err?.message ?? message}
          location={err?.location ?? (err?.line ? `line ${err.line}${err.column ? `, column ${err.column}` : ''}` : undefined)}
          reason={err?.code}
          consequence="INTERLOCK did not continue analysis because the semantic model could not be trusted."
          diagnostics={err?.diagnostics}
        />
        <div>
          <input
            id={inputId}
            type="file"
            accept=".L5X,.l5x,.xml"
            className="peer sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onRetry(f)
              e.target.value = ''
            }}
          />
          <label
            htmlFor={inputId}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-control bg-surface px-3.5 text-[0.8125rem] font-semibold text-ink shadow-inset-line hover:bg-surface-raised peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Choose another file
          </label>
        </div>
      </div>
    </CardFrame>
  )
}
