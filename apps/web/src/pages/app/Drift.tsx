/**
 * Cross-project module drift (/app/drift) — Advanced / Experimental.
 *
 * Upload two or more site exports (and optionally safety declarations, which
 * give outputs a protective direction), then the engine's analyzeDrift runs
 * in the worker. /app/drift?scenario=07 loads the scenario's fixture sites
 * and declarations and runs automatically. Progress shows only real phases:
 * reading files, validating declarations, comparing in the worker.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { FileJson, Play, RotateCcw, X } from 'lucide-react'
import type { DriftReport, SafetyManifest } from '@interlock/core/types'
import { hasManifest, loadManifestText } from '../../demo/fixtures.ts'
import { DEMO_MANIFEST } from '../../demo/scenarios.ts'
import { DriftReportView } from '../../features/drift/DriftReportView.tsx'
import { driftScenario, driftSummary, loadDriftScenario } from '../../features/drift/driftModel.ts'
import { engine, readFileInput } from '../../engine/client.ts'
import type { DriftInput } from '../../engine/types.ts'
import { cx } from '../../lib/cx.ts'
import { formatBytes, formatMs, plural } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { Badge, Glyph } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { FileDropzone } from '../../ui/FileDropzone.tsx'
import { Input } from '../../ui/Field.tsx'
import { IconButton } from '../../ui/IconButton.tsx'
import { Metric, MetricRow } from '../../ui/Metric.tsx'
import { PageHeader } from '../../ui/Panel.tsx'
import { ErrorState } from '../../ui/States.tsx'

interface SiteEntry {
  key: number
  label: string
  name?: string
  file: File
}

type PhaseState = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

interface RunState {
  status: 'idle' | 'running' | 'complete' | 'failed'
  phases: { load?: PhaseState; read: PhaseState; manifest: PhaseState; compare: PhaseState }
  error?: string
  elapsedMs?: number
}

const IDLE: RunState = { status: 'idle', phases: { read: 'pending', manifest: 'pending', compare: 'pending' } }
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function PhaseRow({ state, label, detail }: { state: PhaseState; label: string; detail?: string }) {
  const glyph = state === 'done' ? <Glyph shape="check" className="text-ink" /> : state === 'failed' ? <Glyph shape="cross" className="text-coral-ink" /> : state === 'running' ? <Glyph shape="half" className="il-pulse-dot fill-ink text-ink" /> : <Glyph shape="ring" className="text-ink-3" />
  return (
    <li className="flex min-w-0 items-start gap-3 py-2">
      <span className="mt-[3px]">{glyph}</span>
      <span className="min-w-0 flex-1">
        <span className={cx('block font-mono text-xs font-semibold tracking-[0.08em]', state === 'pending' || state === 'skipped' ? 'text-ink-3' : 'text-ink')}>{label}</span>
        {detail && <span className="il-ident block text-[0.8125rem] text-ink-2">{detail}</span>}
      </span>
      <span className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-ink-2">{state === 'skipped' ? 'not used' : state}</span>
    </li>
  )
}

export function Drift() {
  useDocumentTitle('Module drift')
  const [params] = useSearchParams()
  const scenarioId = params.get('scenario')
  const scenario = scenarioId ? driftScenario(scenarioId) : undefined

  const [sites, setSites] = useState<SiteEntry[]>([])
  const [manifest, setManifest] = useState<{ name: string; manifest: SafetyManifest } | null>(null)
  const [manifestError, setManifestError] = useState<string | null>(null)
  const [run, setRun] = useState<RunState>(IDLE)
  const [report, setReport] = useState<DriftReport | null>(null)
  const nextKey = useRef(1)
  const autoRan = useRef(false)

  const addSite = (file: File, label?: string, name?: string) =>
    setSites((prev) => {
      const used = new Set(prev.map((s) => s.label))
      const auto = [...LETTERS].map((l) => `Site ${l}`).find((l) => !used.has(l)) ?? `Site ${prev.length + 1}`
      return [...prev, { key: nextKey.current++, label: label ?? auto, name, file }]
    })

  const validateManifest = async (name: string, json: unknown): Promise<SafetyManifest | null> => {
    setManifestError(null)
    const { value } = await engine.validateManifest(json)
    if (!value.ok) {
      setManifestError(`${name}: ${value.issues.join('; ')}`)
      return null
    }
    setManifest({ name, manifest: value.manifest })
    return value.manifest
  }

  const execute = useCallback(async (entries: SiteEntry[], m: SafetyManifest | null, preface?: Partial<RunState['phases']>) => {
    setReport(null)
    const phases: RunState['phases'] = { read: 'running', manifest: m ? 'done' : 'skipped', compare: 'pending', ...preface }
    setRun({ status: 'running', phases: { ...phases } })
    try {
      const inputs = await Promise.all(entries.map(async (s) => ({ ...(await readFileInput(s.file)), label: s.label.trim() })))
      phases.read = 'done'
      phases.compare = 'running'
      setRun({ status: 'running', phases: { ...phases } })
      // analyzeDrift also accepts `manifest` (DriftOptions); the worker passes the input through unchanged.
      const input: DriftInput & { manifest?: SafetyManifest } = { sites: inputs, analyzedAt: new Date().toISOString(), ...(m ? { manifest: m } : {}) }
      const { value, elapsedMs } = await engine.drift(input)
      phases.compare = 'done'
      setReport(value)
      setRun({ status: 'complete', phases: { ...phases }, elapsedMs })
    } catch (e) {
      if (phases.read === 'running') phases.read = 'failed'
      if (phases.compare === 'running') phases.compare = 'failed'
      setRun({ status: 'failed', phases: { ...phases }, error: e instanceof Error ? e.message : 'Drift analysis could not be completed.' })
    }
  }, [])

  // ?scenario=07: load the fixture sites and declarations, then run once.
  useEffect(() => {
    if (!scenario || autoRan.current) return
    autoRan.current = true
    void (async () => {
      setRun({ status: 'running', phases: { load: 'running', read: 'pending', manifest: 'pending', compare: 'pending' } })
      try {
        const loaded = await loadDriftScenario(scenario)
        const entries = loaded.sites.map((s) => ({ key: nextKey.current++, label: s.label, name: s.name, file: s.file }))
        setSites(entries)
        setRun({ status: 'running', phases: { load: 'done', read: 'pending', manifest: loaded.manifest ? 'running' : 'skipped', compare: 'pending' } })
        const m = loaded.manifest ? await validateManifest(loaded.manifest.name, loaded.manifest.json) : null
        if (loaded.manifest && !m) {
          setRun({ status: 'failed', phases: { load: 'done', read: 'pending', manifest: 'failed', compare: 'pending' }, error: 'The scenario declarations did not validate.' })
          return
        }
        await execute(entries, m, { load: 'done', manifest: m ? 'done' : 'skipped' })
      } catch (e) {
        setRun({ status: 'failed', phases: { load: 'failed', read: 'pending', manifest: 'pending', compare: 'pending' }, error: e instanceof Error ? e.message : 'The scenario files could not be loaded.' })
      }
    })()
  }, [scenario, execute])

  const labels = sites.map((s) => s.label.trim())
  const labelError = (s: SiteEntry) => (!s.label.trim() ? 'Give the site a label.' : labels.filter((l) => l.toLowerCase() === s.label.trim().toLowerCase()).length > 1 ? 'Labels must be unique.' : undefined)
  const canRun = sites.length >= 2 && sites.every((s) => !labelError(s)) && run.status !== 'running'
  const summary = report ? driftSummary(report) : null

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            Drift
            <Badge tone="iris" icon={<Glyph shape="diamond" className="fill-iris" />}>
              Advanced / Experimental
            </Badge>
          </span>
        }
        title="Cross-project module drift"
        description="The same module name across several site exports: same definition, same revision, same safety behaviour — or not. Each export is analyzed in this browser."
      />

      {scenario && (
        <p className="-mt-3 max-w-prose text-sm text-ink-2">
          Demo scenario {scenario.id}: <span className="font-semibold text-ink">{scenario.title}</span>. {scenario.summary}
        </p>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="drift-inputs" className="flex min-w-0 flex-col gap-4">
          <h2 id="drift-inputs" className="text-title-3 text-ink">
            Site exports <span className="il-num font-mono text-sm font-medium text-ink-2">({sites.length})</span>
          </h2>
          {sites.length > 0 && (
            <ul className="flex flex-col gap-2">
              {sites.map((s) => (
                <li key={s.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-card bg-surface p-3.5 shadow-inset-line sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-center">
                  <Input
                    aria-label={`Label for ${s.file.name}`}
                    value={s.label}
                    error={labelError(s)}
                    onChange={(e) => setSites((prev) => prev.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))}
                    className="h-9 text-sm font-semibold"
                    wrapperClassName="col-span-1"
                    disabled={run.status === 'running'}
                  />
                  <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto">
                    <p className="il-ident font-mono text-xs font-semibold text-ink">{s.file.name}</p>
                    <p className="font-mono text-[0.6875rem] text-ink-2">
                      {formatBytes(s.file.size)}
                      {s.name ? ` · ${s.name}` : ''}
                    </p>
                  </div>
                  <IconButton label={`Remove ${s.label || s.file.name}`} size="sm" disabled={run.status === 'running'} onClick={() => setSites((prev) => prev.filter((x) => x.key !== s.key))} tooltipAlign="end">
                    <X />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <FileDropzone
            role={sites.length < 2 ? `SITE EXPORT ${sites.length + 1} OF AT LEAST 2` : 'ANOTHER SITE EXPORT'}
            title="Drop a site export here"
            hint="An L5X export from one site."
            compact={sites.length >= 2}
            disabled={run.status === 'running'}
            onFile={(f) => addSite(f)}
            formats={[
              { label: 'L5X', status: 'SUPPORTED' },
              { label: 'PLCopen XML', status: 'PLANNED' },
            ]}
          />
        </section>

        <aside aria-labelledby="drift-decl" className="flex min-w-0 flex-col gap-4">
          <div className="rounded-card bg-surface p-5 shadow-inset-line">
            <h2 id="drift-decl" className="text-title-3 text-ink">
              Safety declarations <span className="text-sm font-medium text-ink-2">(optional)</span>
            </h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-2">
              Declarations tell INTERLOCK which way a module output protects. Without them a variant that acts in fewer cases is reported as DIFFERENT, never guessed to be weaker.
            </p>
            {manifest ? (
              <div className="mt-4 flex min-w-0 items-center justify-between gap-3 rounded-input bg-paper-2/60 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="il-ident block font-mono text-xs font-semibold text-ink">{manifest.name}</span>
                  <span className="block font-mono text-[0.6875rem] text-ink-2">{plural(manifest.manifest.functions.length, 'safety function')} · validated by the engine</span>
                </span>
                <IconButton label="Remove declarations" size="sm" disabled={run.status === 'running'} onClick={() => setManifest(null)} tooltipAlign="end">
                  <X />
                </IconButton>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <label className={cx('inline-flex h-9 cursor-pointer items-center gap-2 rounded-[12px] bg-surface px-3.5 text-[0.8125rem] font-semibold text-ink shadow-inset-line hover:bg-surface-raised has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus')}>
                  <FileJson aria-hidden="true" className="size-4" />
                  Choose declarations JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (!f) return
                      void f
                        .text()
                        .then((t) => validateManifest(f.name, JSON.parse(t) as unknown))
                        .catch((err: unknown) => setManifestError(`${f.name} is not valid JSON: ${err instanceof Error ? err.message : 'unreadable'}`))
                    }}
                  />
                </label>
                {hasManifest(DEMO_MANIFEST) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void loadManifestText(DEMO_MANIFEST).then((t) => validateManifest(DEMO_MANIFEST.slice(DEMO_MANIFEST.lastIndexOf('/') + 1), JSON.parse(t) as unknown))}
                  >
                    Use Northgate demo declarations
                  </Button>
                )}
              </div>
            )}
            {manifestError && (
              <p role="alert" className="il-ident mt-3 text-[0.8125rem] font-medium text-coral-ink">
                {manifestError}
              </p>
            )}
          </div>

          <div className="rounded-card bg-surface p-5 shadow-inset-line">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-title-3 text-ink">Compare</h2>
              <div className="flex gap-2">
                {(report || run.status === 'failed') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<RotateCcw />}
                    onClick={() => {
                      setReport(null)
                      setRun(IDLE)
                    }}
                  >
                    Clear result
                  </Button>
                )}
                <Button size="sm" variant="primary" iconLeft={<Play />} disabled={!canRun} loading={run.status === 'running'} onClick={() => void execute(sites, manifest?.manifest ?? null)}>
                  Analyze drift
                </Button>
              </div>
            </div>
            {sites.length < 2 && run.status === 'idle' && <p className="mt-2 text-[0.8125rem] text-ink-2">Add at least two site exports to compare.</p>}
            {run.status !== 'idle' && (
              <ol aria-live="polite" className="mt-3 divide-y divide-line">
                {run.phases.load && <PhaseRow state={run.phases.load} label="LOAD SCENARIO FILES" detail={scenario ? plural(scenario.sites?.length ?? 0, 'fixture export') : undefined} />}
                <PhaseRow state={run.phases.manifest} label="VALIDATE DECLARATIONS" detail={manifest ? manifest.name : 'No declarations: direction is not judged'} />
                <PhaseRow state={run.phases.read} label="READ EXPORTS" detail={plural(sites.length, 'file')} />
                <PhaseRow
                  state={run.phases.compare}
                  label="COMPARE MODULE DEFINITIONS"
                  detail={run.phases.compare === 'running' ? 'Parsing every export and comparing each module’s outputs in the analysis worker…' : run.elapsedMs !== undefined ? `Completed in ${formatMs(run.elapsedMs)}` : undefined}
                />
              </ol>
            )}
          </div>
        </aside>
      </div>

      {run.status === 'failed' && (
        <ErrorState title="DRIFT ANALYSIS FAILED" message="Analysis could not be completed." reason={run.error} consequence="No drift result is shown because at least one export could not be trusted." />
      )}

      {report && summary && (
        <section aria-labelledby="drift-result" className="flex min-w-0 flex-col gap-8">
          <div className="flex min-w-0 flex-col gap-6 border-t border-line pt-8">
            <h2 id="drift-result" className="text-title-2 text-ink">
              {summary.drift > 0 ? 'Drift detected' : 'No drift across these sites'}
            </h2>
            <MetricRow>
              <Metric label="Sites" value={report.sites.length} detail="exports compared" />
              <Metric label="Modules" value={report.modules.length} detail="module names seen at any site" />
              <Metric label="Drift" value={summary.drift} tone={summary.drift > 0 ? 'marigold' : 'neutral'} detail="modules that differ between sites" />
              <Metric label="Weaker at" value={summary.weaker} tone={summary.weaker > 0 ? 'coral' : 'neutral'} detail="site variants acting in fewer cases" />
              <Metric label="Consistent" value={summary.consistent} tone={summary.consistent > 0 ? 'sage' : 'neutral'} detail="identical everywhere" />
            </MetricRow>
          </div>
          <DriftReportView report={report} />
        </section>
      )}
    </div>
  )
}
