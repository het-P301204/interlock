/**
 * New Analysis (ingest): baseline + current project versions, safety
 * declarations, then the analysis pipeline and its completion summary.
 */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Info } from 'lucide-react'
import type { Side } from '@interlock/core/types'
import { AnalysisComplete } from '../../features/AnalysisComplete.tsx'
import { ManifestStep } from '../../features/ingest/ManifestStep.tsx'
import { RunPanel, useStageReveal } from '../../features/ingest/RunPanel.tsx'
import { ParseFailedCard, VerificationCard, VerifyingCard } from '../../features/ingest/VerificationCard.tsx'
import { engine } from '../../engine/client.ts'
import type { AdapterInfo } from '../../engine/types.ts'
import { cx } from '../../lib/cx.ts'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { useWorkspace } from '../../state/analysis.ts'
import type { SideState } from '../../state/analysis.ts'
import { Glyph } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { FileDropzone } from '../../ui/FileDropzone.tsx'
import type { FormatTag } from '../../ui/FileDropzone.tsx'
import { PageHeader } from '../../ui/Panel.tsx'
import { ErrorState } from '../../ui/States.tsx'

/** Shown until the engine reports its adapters; mirrors the spec (L5X supported, others planned). */
const FALLBACK_FORMATS: FormatTag[] = [
  { label: 'L5X', status: 'SUPPORTED' },
  { label: 'PLCopen XML', status: 'PLANNED' },
  { label: 'Siemens TIA XML', status: 'PLANNED' },
  { label: 'Schneider XEF', status: 'PLANNED' },
]

/** Compact pill labels per format id; the full adapter label is listed in Settings. */
const SHORT_FORMAT: Record<string, string> = {
  L5X: 'L5X',
  PLCOPEN_XML: 'PLCopen XML',
  SIEMENS_TIA_XML: 'Siemens TIA XML',
  SCHNEIDER_XEF: 'Schneider XEF',
}

function useFormats(): FormatTag[] {
  const [formats, setFormats] = useState<FormatTag[]>(FALLBACK_FORMATS)
  useEffect(() => {
    let live = true
    engine
      .info()
      .then(({ value }) => {
        if (live && value.adapters.length) setFormats(value.adapters.map((a: AdapterInfo) => ({ label: SHORT_FORMAT[a.format] ?? a.format, status: a.status })))
      })
      .catch(() => {
        /* engine unavailable: keep the static list */
      })
    return () => {
      live = false
    }
  }, [])
  return formats
}

function StepHeader({ n, title, description, done }: { n: number; title: string; description: string; done?: boolean }) {
  return (
    <div className="mb-4 flex items-start gap-4">
      <span
        aria-hidden="true"
        className={cx(
          'il-num mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold',
          done ? 'bg-ink text-paper' : 'bg-surface text-ink shadow-inset-line',
        )}
      >
        {done ? <Glyph shape="check" className="size-3.5" /> : String(n).padStart(2, '0')}
      </span>
      <div className="min-w-0">
        <h2 className="text-title-3 text-ink">
          <span className="sr-only">Step {n}: </span>
          {title}
          {done && <span className="sr-only"> (complete)</span>}
        </h2>
        <p className="mt-0.5 text-sm text-ink-2">{description}</p>
      </div>
    </div>
  )
}

function SideSlot({ side, role, hint, state, formats }: { side: Side; role: string; hint: string; state: SideState; formats: FormatTag[] }) {
  const loadSide = useWorkspace((s) => s.loadSide)
  const clearSide = useWorkspace((s) => s.clearSide)
  const cancel = useWorkspace((s) => s.cancelAnalysis)
  const busy = state.phase === 'reading' || state.phase === 'hashing' || state.phase === 'parsing'
  const res = state.result

  return (
    <AnimatePresence mode="wait" initial={false}>
      {state.phase === 'idle' && (
        <motion.div key="drop" exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.16 }} className="min-w-0">
          <FileDropzone role={role} hint={hint} formats={formats} onFile={(f) => void loadSide(side, f)} className="h-full" />
        </motion.div>
      )}
      {busy && (
        <motion.div key="verifying" exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="min-w-0">
          <VerifyingCard role={role} side={state} onCancel={cancel} />
        </motion.div>
      )}
      {state.phase === 'ready' && res?.ok && (
        <motion.div key={`ready-${state.token}`} className="min-w-0">
          <VerificationCard role={role} summary={res.summary} elapsedMs={state.elapsedMs} onReplace={(f) => void loadSide(side, f)} onRemove={() => clearSide(side)} />
        </motion.div>
      )}
      {state.phase === 'failed' && (
        <motion.div key={`failed-${state.token}`} className="min-w-0">
          <ParseFailedCard role={role} side={state} onRetry={(f) => void loadSide(side, f)} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function NewAnalysis() {
  useDocumentTitle('New analysis')
  const baseline = useWorkspace((s) => s.baseline)
  const current = useWorkspace((s) => s.current)
  const manifest = useWorkspace((s) => s.manifest)
  const run = useWorkspace((s) => s.run)
  const result = useWorkspace((s) => s.result)
  const start = useWorkspace((s) => s.startAnalysis)
  const cancel = useWorkspace((s) => s.cancelAnalysis)
  const formats = useFormats()
  const reveal = useStageReveal(run)
  const pipelineRef = useRef<HTMLDivElement>(null)

  const summary = (s: SideState) => (s.result?.ok ? s.result.summary : undefined)
  const b = summary(baseline)
  const c = summary(current)
  const usable = (s: SideState) => s.phase === 'ready' && !!summary(s) && summary(s)!.readiness !== 'BLOCKED'

  const missing: string[] = []
  const sideNeed = (label: string, st: SideState) =>
    st.phase === 'ready'
      ? `${label} project is BLOCKED by parser diagnostics`
      : st.phase === 'failed'
        ? `${label} project could not be parsed: choose another file`
        : st.phase === 'idle'
          ? `${label} project not loaded`
          : `${label} project is being verified`
  if (!usable(baseline)) missing.push(sideNeed('Baseline', baseline))
  if (!usable(current)) missing.push(sideNeed('Current', current))
  if (!manifest) missing.push('Safety declarations not loaded')
  const ready = missing.length === 0
  const running = run.status === 'running'

  const notes: string[] = []
  if (b && c) {
    if (b.file.sha256 === c.file.sha256) notes.push('Both files are byte-for-byte identical (same SHA-256). The analysis will report no changes.')
    if (b.metadata.controllerName !== c.metadata.controllerName)
      notes.push(`The exports name different controllers (${b.metadata.controllerName} and ${c.metadata.controllerName}). INTERLOCK compares them as two versions of one project.`)
  }

  const onStart = () => {
    void start()
    requestAnimationFrame(() => pipelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const showComplete = run.status === 'complete' && reveal.settled && result

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        eyebrow="New analysis"
        title="Compare two exports of one project"
        description="Load the known-good export and the current one, declare the safety functions to check, and INTERLOCK ranks what changed by safety impact. Files are parsed in this browser and are not uploaded."
      />

      <section aria-label="Project versions">
        <StepHeader n={1} title="Project versions" description="The known-good baseline and the current export you want reviewed." done={usable(baseline) && usable(current)} />
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
          <SideSlot side="baseline" role="BASELINE" hint="The known-good export," state={baseline} formats={formats} />
          <SideSlot side="current" role="CURRENT" hint="The export to review," state={current} formats={formats} />
        </div>
        {notes.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n} className="flex items-start gap-2.5 rounded-input bg-iris/[0.1] px-4 py-3 text-sm text-ink ring-1 ring-inset ring-iris/30">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-iris-ink" />
                {n}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Safety declarations">
        <StepHeader n={2} title="Safety declarations" description="What each safety function is supposed to do. INTERLOCK never infers safety intent." done={!!manifest} />
        <ManifestStep />
      </section>

      <section aria-label="Analyze">
        <StepHeader n={3} title="Analyze" description="Ten stages, all in this browser. Each one reports what it did." done={run.status === 'complete'} />
        <div className="flex flex-col gap-4 rounded-panel bg-paper-2/50 p-5 shadow-inset-line sm:flex-row sm:items-center sm:justify-between sm:p-6">
          {ready ? (
            <p className="text-sm text-ink">
              Ready: <span className="font-semibold">{baseline.name}</span> → <span className="font-semibold">{current.name}</span>, {manifest?.manifest.functions.length}{' '}
              declared functions.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm text-ink-2" aria-label="Still needed">
              {missing.map((m) => (
                <li key={m} className="flex items-center gap-2">
                  <Glyph shape="ring" className="text-ink-3" />
                  {m}
                </li>
              ))}
            </ul>
          )}
          <Button variant="primary" size="lg" disabled={!ready || running} loading={running} onClick={onStart} iconRight={<ArrowRight />} className="shrink-0">
            {run.status === 'complete' ? 'Analyze Again' : 'Analyze Project'}
          </Button>
        </div>
      </section>

      <div ref={pipelineRef} className="scroll-mt-24">
        {run.status !== 'idle' && <RunPanel key={run.token} run={run} onCancel={cancel} reveal={reveal} />}
      </div>

      {run.status === 'failed' && run.error && (
        <ErrorState
          title="Analysis could not be completed"
          message={
            run.error.failure
              ? `The ${run.error.failure.side === 'manifest' ? 'safety declarations' : `${run.error.failure.side} project`} could not be trusted: ${run.error.failure.error.message}`
              : run.error.message
          }
          location={run.error.failure?.error.location ?? run.error.inspect?.location}
          reason={run.error.failure?.error.code ?? run.error.code}
          consequence="No partial results were produced."
          diagnostics={run.error.failure?.error.diagnostics ?? run.error.inspect?.diagnostics}
        />
      )}

      <AnimatePresence>
        {showComplete && (
          <motion.div key={result.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
            <AnalysisComplete result={result} elapsedMs={run.elapsedMs} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
