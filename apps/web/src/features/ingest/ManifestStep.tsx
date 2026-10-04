/**
 * Safety declarations step: load a manifest JSON, or the Northgate demo
 * declarations when that fixture is part of the build. Validation is done by
 * the engine (validateManifest) in the worker.
 */
import { useId, useState } from 'react'
import { FileJson, X } from 'lucide-react'
import type { SafetyFunction } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { useWorkspace } from '../../state/analysis.ts'
import { Badge, Glyph } from '../../ui/Badge.tsx'
import type { Tone } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { IconButton } from '../../ui/IconButton.tsx'
import { ErrorState } from '../../ui/States.tsx'
import { DEMO_MANIFEST } from '../../demo/scenarios.ts'
import { hasManifest, loadManifestText } from '../../demo/fixtures.ts'

const CRIT_TONE: Record<SafetyFunction['criticality'], Tone> = { CRITICAL: 'coral', HIGH: 'marigold', MEDIUM: 'outline', LOW: 'neutral' }

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text()
  return JSON.parse(text) as unknown
}

export function ManifestStep() {
  const inputId = useId()
  const manifest = useWorkspace((s) => s.manifest)
  const issues = useWorkspace((s) => s.manifestIssues)
  const load = useWorkspace((s) => s.loadManifestJson)
  const clear = useWorkspace((s) => s.clearManifest)
  const [busy, setBusy] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const demoAvailable = hasManifest(DEMO_MANIFEST)

  const fromFile = async (file: File) => {
    setBusy(true)
    setParseError(null)
    try {
      const json = await readJsonFile(file)
      await load(file.name, json, 'file')
    } catch (e) {
      setParseError(`${file.name} is not valid JSON: ${e instanceof Error ? e.message : 'unreadable'}`)
    } finally {
      setBusy(false)
    }
  }

  const fromDemo = async () => {
    setBusy(true)
    setParseError(null)
    try {
      const text = await loadManifestText(DEMO_MANIFEST)
      await load(DEMO_MANIFEST.slice(DEMO_MANIFEST.lastIndexOf('/') + 1), JSON.parse(text) as unknown, 'demo')
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'The demo declarations could not be loaded.')
    } finally {
      setBusy(false)
    }
  }

  if (manifest) {
    const fns = manifest.manifest.functions
    return (
      <div className="overflow-hidden rounded-panel bg-surface shadow-soft ring-1 ring-line">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <FileJson aria-hidden="true" className="size-[18px] shrink-0 text-ink-2" />
            <div className="min-w-0">
              <p className="il-ident text-sm font-semibold text-ink">{manifest.manifest.project ?? manifest.name}</p>
              <p className="il-ident font-mono text-xs text-ink-2">
                {manifest.name}
                {manifest.source === 'demo' && ' · demo declarations'} · {fns.length} declared function{fns.length === 1 ? '' : 's'}
                {manifest.manifest.nonSafetyScope?.programs?.length ? ` · non-safety: ${manifest.manifest.nonSafetyScope.programs.join(', ')}` : ''}
              </p>
            </div>
          </div>
          <IconButton label="Remove safety declarations" size="sm" onClick={clear} tooltipSide="top" tooltipAlign="end">
            <X />
          </IconButton>
        </div>
        <ul className="divide-y divide-line">
          {fns.map((f) => (
            <li key={f.id} className="grid grid-cols-1 gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,0.9fr)_auto] sm:items-center sm:px-6">
              <span className="font-mono text-xs font-semibold text-ink-2">{f.id}</span>
              <span className="min-w-0">
                <span className="il-ident block text-sm font-semibold text-ink">{f.name}</span>
                <span className="il-ident block font-mono text-[0.6875rem] text-ink-2">
                  {f.kind}
                  {f.implementation.program && ` · ${f.implementation.program}`}
                  {f.implementation.routine && `/${f.implementation.routine}`}
                  {f.implementation.module && ` · ${f.implementation.module}`}
                </span>
              </span>
              <span className="il-ident min-w-0 font-mono text-xs text-ink">
                {f.protectiveOutput ? (
                  <>
                    {f.protectiveOutput.tag}
                    <span className="text-ink-2"> · {f.protectiveOutput.tripState === 'DE_ENERGIZE' ? 'de-energize' : 'energize'}</span>
                  </>
                ) : f.alarm ? (
                  <>
                    {f.alarm.tag}
                    <span className="text-ink-2"> · alarm</span>
                  </>
                ) : (
                  <span className="text-ink-2">—</span>
                )}
              </span>
              <span>
                <Badge tone={CRIT_TONE[f.criticality]}>{f.criticality}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={cx('grid grid-cols-1 gap-px overflow-hidden rounded-panel bg-line shadow-inset-line', demoAvailable ? 'md:grid-cols-2' : '')}>
        <div className="flex flex-col gap-3 bg-paper-2 p-5 sm:p-6">
          <p className="text-sm font-semibold text-ink">Load safety declarations</p>
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">
            A JSON file (<code className="font-mono text-[0.92em]">interlock.safety/v1</code>) that names each safety function, where it is implemented, its
            protective output and trip state, and its alarm.
          </p>
          <div className="mt-1">
            <input
              id={inputId}
              type="file"
              accept=".json,application/json"
              className="peer sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void fromFile(f)
                e.target.value = ''
              }}
            />
            <label
              htmlFor={inputId}
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-control bg-surface px-5 text-sm font-semibold text-ink shadow-inset-line hover:bg-surface-raised peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-50"
            >
              <FileJson aria-hidden="true" className="size-[18px]" />
              Choose declarations file
            </label>
          </div>
        </div>
        {demoAvailable && (
          <div className="flex flex-col gap-3 bg-paper-2 p-5 sm:p-6">
            <p className="text-sm font-semibold text-ink">Northgate demo declarations</p>
            <p className="text-[0.8125rem] leading-relaxed text-ink-2">
              Eight safety functions for the synthetic Northgate Pump Station, matching the demo fixtures.
            </p>
            <div className="mt-1">
              <Button variant="secondary" onClick={fromDemo} loading={busy}>
                Use the Northgate demo declarations
              </Button>
            </div>
          </div>
        )}
      </div>
      {parseError && <ErrorState title="Declarations not loaded" message={parseError} />}
      {issues && (
        <ErrorState
          title="Safety declarations rejected"
          message={`${issues.name} does not match the interlock.safety/v1 schema.`}
          reason={
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {issues.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          }
          consequence="Fix the declarations and load the file again. INTERLOCK does not analyze against declarations it cannot validate."
        />
      )}
      {!demoAvailable && (
        <p className="flex items-center gap-2 font-mono text-xs text-ink-2">
          <Glyph shape="ring" className="text-ink-3" />
          The Northgate demo declarations are not included in this build.
        </p>
      )}
    </div>
  )
}
