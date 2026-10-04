/**
 * Evidence ledger and the forensic evidence panel.
 *
 *   <EvidenceLedger items={finding.evidence} />   list with a "View Evidence" button per item
 *   <EvidenceSheet item={ev} onClose={…} />        the detailed panel (Sheet)
 *
 * The panel lays the record out like an exhibit sheet: identity, provenance
 * (file, SHA-256, parser, XML location, line/column), scope (program, routine,
 * module), the rule that fired and when it was recorded, then the original and
 * modified content with copy buttons. Nothing here is summarized: values are
 * shown exactly as the engine recorded them.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, FileSearch } from 'lucide-react'
import type { EvidenceItem } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { formatTimestamp, shortHash } from '../../lib/format.ts'
import { Badge } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { IconButton } from '../../ui/IconButton.tsx'
import { LogicDiff } from '../../ui/LogicDiff.tsx'
import { LogicText } from '../../ui/LogicText.tsx'
import { Sheet } from '../../ui/Sheet.tsx'
import { toast } from '../../ui/Toast.tsx'

const SIDE_LABEL: Record<EvidenceItem['side'], string> = {
  baseline: 'BASELINE',
  current: 'CURRENT',
  both: 'BASELINE + CURRENT',
  declaration: 'DECLARATION',
}

const KIND_LABEL: Record<EvidenceItem['kind'], string> = {
  rung: 'Rung',
  'module-rung': 'Module rung',
  routine: 'Routine',
  tag: 'Tag',
  task: 'Task',
  program: 'Program',
  module: 'Module',
  declaration: 'Declaration',
  computation: 'Computation',
}

async function copyText(text: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast({ title: `${what} copied`, tone: 'success' })
    return true
  } catch {
    toast({ title: 'Could not copy to the clipboard', body: 'Select the text and copy it manually.', tone: 'error' })
    return false
  }
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <IconButton
      label={done ? 'Copied' : `Copy ${label}`}
      size="sm"
      tooltipSide="top"
      tooltipAlign="end"
      onClick={async () => {
        if (await copyText(text, label)) {
          setDone(true)
          window.setTimeout(() => setDone(false), 1500)
        }
      }}
    >
      {done ? <Check /> : <Copy />}
    </IconButton>
  )
}

function Row({ label, children, copy }: { label: string; children: ReactNode; copy?: { text: string; label: string } }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 border-b border-line py-2.5 last:border-0 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:items-start">
      <dt className="il-label pt-[3px]">{label}</dt>
      {/* A <dl> group may hold only <dt>/<dd>: the copy action is a second <dd>, and a row without one spans both columns. */}
      <dd className={cx('il-ident min-w-0 font-mono text-data text-ink', !copy && 'sm:col-span-2')}>{children}</dd>
      {copy && (
        <dd className="-my-1 justify-self-start sm:justify-self-end">
          <CopyButton text={copy.text} label={copy.label} />
        </dd>
      )}
    </div>
  )
}

function ContentBlock({ title, text, kind }: { title: string; text: string; kind: EvidenceItem['kind'] }) {
  const lang = kind === 'rung' || kind === 'module-rung' ? 'rung' : kind === 'computation' ? 'condition' : null
  return (
    <figure className="min-w-0 overflow-hidden rounded-input bg-paper-2/70 shadow-inset-line">
      <figcaption className="flex items-center justify-between gap-3 border-b border-line py-1.5 pl-4 pr-1.5">
        <span className="il-label">{title}</span>
        <CopyButton text={text} label={title.toLowerCase()} />
      </figcaption>
      <div className="il-scroll-thin max-h-80 overflow-auto px-4 py-3">
        {lang ? <LogicText text={text} language={lang} /> : <pre className="il-ident whitespace-pre-wrap font-mono text-data text-ink">{text}</pre>}
      </div>
    </figure>
  )
}

export function EvidenceSheet({ item, onClose }: { item: EvidenceItem | null; onClose: () => void }) {
  // Keep the last item so the panel keeps its content during the exit animation.
  const [last, setLast] = useState<EvidenceItem | null>(item)
  if (item && item !== last) setLast(item)
  const ev = item ?? last
  const location = ev ? [ev.line !== undefined ? `line ${ev.line}` : null, ev.column !== undefined ? `column ${ev.column}` : null].filter(Boolean).join(', ') : ''
  const diffable = ev && ev.original !== undefined && ev.modified !== undefined && (ev.kind === 'rung' || ev.kind === 'module-rung' || ev.kind === 'computation')
  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      width="xl"
      eyebrow={ev ? `Evidence ${ev.id} · finding ${ev.findingId}` : 'Evidence'}
      title={ev?.title ?? ''}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {ev && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="outline">{KIND_LABEL[ev.kind]}</Badge>
            <Badge tone={ev.side === 'declaration' ? 'iris' : 'neutral'}>{SIDE_LABEL[ev.side]}</Badge>
          </div>

          <section aria-labelledby="ev-prov">
            <h3 id="ev-prov" className="il-label mb-1 text-ink">
              Provenance
            </h3>
            <dl>
              <Row label="Source file">{ev.sourceFile ?? <span className="text-ink-2">Declaration (safety manifest)</span>}</Row>
              {ev.fileSha256 && (
                <Row label="SHA-256" copy={{ text: ev.fileSha256, label: 'SHA-256' }}>
                  <span className="break-all">{ev.fileSha256}</span>
                </Row>
              )}
              {ev.parserVersion && <Row label="Parser">{ev.parserVersion}</Row>}
              {ev.xmlPath && (
                <Row label="XML location" copy={{ text: ev.xmlPath, label: 'XML path' }}>
                  <span className="break-all">{ev.xmlPath}</span>
                </Row>
              )}
              {location && <Row label="Line / column">{location}</Row>}
            </dl>
          </section>

          {(ev.program || ev.routine || ev.module) && (
            <section aria-labelledby="ev-scope">
              <h3 id="ev-scope" className="il-label mb-1 text-ink">
                Scope
              </h3>
              <dl>
                {ev.program && <Row label="Program">{ev.program}</Row>}
                {ev.routine && <Row label="Routine">{ev.routine}</Row>}
                {ev.module && <Row label="Module">{ev.module}</Row>}
              </dl>
            </section>
          )}

          <section aria-labelledby="ev-rule">
            <h3 id="ev-rule" className="il-label mb-1 text-ink">
              Analysis
            </h3>
            <dl>
              <Row label="Rule">{ev.rule}</Row>
              <Row label="Recorded">
                {formatTimestamp(ev.analyzedAt)} <span className="text-ink-2">({ev.analyzedAt})</span>
              </Row>
              <Row label="Finding">{ev.findingId}</Row>
            </dl>
            {ev.note && <p className="il-ident mt-3 rounded-input bg-iris/[0.08] px-4 py-3 text-sm text-ink ring-1 ring-inset ring-iris/25">{ev.note}</p>}
          </section>

          {diffable && (
            <section aria-labelledby="ev-diff">
              <h3 id="ev-diff" className="il-label mb-2 text-ink">
                Changed terms
              </h3>
              <LogicDiff before={ev.original} after={ev.modified} language={ev.kind === 'computation' ? 'condition' : 'rung'} stacked beforeLabel="ORIGINAL" afterLabel="MODIFIED" />
            </section>
          )}

          {(ev.original !== undefined || ev.modified !== undefined) && (
            <section aria-labelledby="ev-content" className="flex flex-col gap-3">
              <h3 id="ev-content" className="il-label text-ink">
                Recorded content
              </h3>
              {ev.original !== undefined && <ContentBlock title="Original" text={ev.original} kind={ev.kind} />}
              {ev.modified !== undefined && <ContentBlock title="Modified" text={ev.modified} kind={ev.kind} />}
            </section>
          )}
        </div>
      )}
    </Sheet>
  )
}

export function EvidenceLedger({ items, className }: { items: EvidenceItem[]; className?: string }) {
  const [open, setOpen] = useState<EvidenceItem | null>(null)
  return (
    <>
      <ol className={cx('overflow-hidden rounded-card bg-surface shadow-inset-line', className)}>
        {items.map((ev) => (
          <li key={ev.id} className="grid grid-cols-1 gap-x-5 gap-y-2 border-b border-line px-5 py-4 last:border-0 md:grid-cols-[6.5rem_minmax(0,1fr)_auto] md:items-center">
            <span className="font-mono text-xs font-semibold text-ink">{ev.id}</span>
            <div className="min-w-0">
              <p className="il-ident text-sm font-semibold text-ink">{ev.title}</p>
              <p className="il-ident mt-0.5 font-mono text-[0.6875rem] text-ink-2">
                {KIND_LABEL[ev.kind]} · {SIDE_LABEL[ev.side]}
                {ev.sourceFile && ` · ${ev.sourceFile}`}
                {ev.line !== undefined && ` · line ${ev.line}`}
                {ev.fileSha256 && ` · ${shortHash(ev.fileSha256, 8, 4)}`}
              </p>
            </div>
            <Button variant="secondary" size="sm" iconLeft={<FileSearch />} onClick={() => setOpen(ev)} aria-haspopup="dialog" className="justify-self-start">
              View Evidence
            </Button>
          </li>
        ))}
      </ol>
      <EvidenceSheet item={open} onClose={() => setOpen(null)} />
    </>
  )
}
