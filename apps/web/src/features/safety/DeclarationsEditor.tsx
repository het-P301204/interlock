/**
 * Declarations editor: add, edit and remove safety functions and the
 * declared non-safety scope, validated by the engine's validateManifest (in
 * the worker) with immediate local checks on top. Names are suggested from
 * the analyzed project. The edited manifest can be exported as JSON, and the
 * analysis re-run with it through the workspace store's existing
 * loadManifestJson + startAnalysis (project bytes are only in memory; after a
 * reload the user re-imports the exports on New Analysis).
 */
import { useEffect, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Download, Pencil, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import type { AnalysisResult, SafetyFunction, SafetyManifest } from '@interlock/core/types'
import { engine } from '../../engine/client.ts'
import { cx } from '../../lib/cx.ts'
import { enumLabel, plural } from '../../lib/format.ts'
import { useWorkspace } from '../../state/analysis.ts'
import { STAGES } from '../../state/stages.ts'
import { Badge, Glyph, StatusPill } from '../../ui/Badge.tsx'
import { Button, ButtonLink } from '../../ui/Button.tsx'
import { Input, Select, Textarea } from '../../ui/Field.tsx'
import { IconButton } from '../../ui/IconButton.tsx'
import { Modal } from '../../ui/Modal.tsx'
import { Sheet } from '../../ui/Sheet.tsx'
import { toast } from '../../ui/Toast.tsx'
import {
  CRITICALITY_OPTIONS,
  KIND_OPTIONS,
  downloadManifest,
  emptyForm,
  fromForm,
  issuesForFunction,
  localErrors,
  projectWarnings,
  sameFunction,
  sameManifest,
  suggestionsFrom,
  toForm,
} from './manifestDraft.ts'
import type { FormField, FunctionForm, Suggestions } from './manifestDraft.ts'
import { CRITICALITY_TONE } from './SafetyPathRow.tsx'

type Validation = { state: 'idle' | 'checking' } | { state: 'valid' } | { state: 'invalid'; issues: string[] } | { state: 'error'; message: string }

/** Debounced engine validation of a manifest (worker). */
function useEngineValidation(manifest: SafetyManifest | null, delay = 250): Validation {
  const [v, setV] = useState<Validation>({ state: 'idle' })
  const key = manifest ? JSON.stringify(manifest) : ''
  useEffect(() => {
    if (!key) return
    let live = true
    const t = setTimeout(() => {
      setV({ state: 'checking' })
      engine.validateManifest(JSON.parse(key) as unknown).then(
        ({ value }) => live && setV(value.ok ? { state: 'valid' } : { state: 'invalid', issues: value.issues }),
        (e: unknown) => live && setV({ state: 'error', message: e instanceof Error ? e.message : 'Validation could not be completed.' }),
      )
    }, delay)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [key, delay])
  return v
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-marigold-ink">
      <Glyph shape="triangle" className="mt-[3px] size-2.5 fill-marigold" />
      <span>{children}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ form */

function FunctionFormSheet({
  open,
  initial,
  index,
  draft,
  suggestions,
  hasProject,
  onSave,
  onClose,
}: {
  open: boolean
  initial: FunctionForm
  /** Position in draft.functions; equals functions.length when adding. */
  index: number
  draft: SafetyManifest
  suggestions: Suggestions
  hasProject: boolean
  onSave: (f: SafetyFunction) => void
  onClose: () => void
}) {
  const [form, setForm] = useState(initial)
  const [touched, setTouched] = useState<Partial<Record<FormField, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const ids = useId()

  const otherIds = draft.functions.filter((_, i) => i !== index).map((f) => f.id)
  const local = localErrors(form, otherIds)
  const warnings = projectWarnings(form, suggestions, hasProject)
  const candidate = useMemo<SafetyManifest>(() => {
    const functions = [...draft.functions]
    functions[index] = fromForm(form)
    return { ...draft, functions }
  }, [draft, form, index])
  const validation = useEngineValidation(open ? candidate : null)
  const engineIssues = validation.state === 'invalid' ? issuesForFunction(validation.issues, index) : { fields: {}, other: [] }

  const set = <K extends FormField>(k: K, v: FunctionForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const blur = (k: FormField) => setTouched((t) => ({ ...t, [k]: true }))
  const err = (k: FormField) => ((touched[k] || submitted) && local[k]) || engineIssues.fields[k] || undefined
  const hint = (k: FormField, base?: ReactNode) => (warnings[k] ? <Warn>{warnings[k]}</Warn> : base)
  const blocking = Object.keys(local).length > 0 || validation.state === 'invalid' || validation.state === 'checking'

  const routineOptions = suggestions.routines.filter((r) => !form.program.trim() || r.program?.toLowerCase() === form.program.trim().toLowerCase())
  const instanceOptions = suggestions.instances.filter((r) => !form.module.trim() || r.module?.toLowerCase() === form.module.trim().toLowerCase())

  const save = () => {
    setSubmitted(true)
    if (Object.keys(local).length > 0 || validation.state === 'invalid') return
    onSave(fromForm(form))
  }

  const field = (k: FormField) => ({
    value: form[k],
    onBlur: () => blur(k),
    error: err(k),
    autoComplete: 'off',
    spellCheck: false,
  })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="right"
      width="lg"
      eyebrow={index < draft.functions.length ? 'Edit safety function' : 'Add safety function'}
      title={form.name.trim() || form.id || 'New safety function'}
      description="Declare what the function is supposed to do. INTERLOCK evaluates the project against these declarations only."
      footer={
        <>
          <span className="mr-auto min-w-0 text-[0.8125rem] text-ink-2" aria-live="polite">
            {validation.state === 'checking' ? 'Engine is checking…' : validation.state === 'valid' ? 'Engine validation passed.' : validation.state === 'invalid' ? plural(validation.issues.length, 'engine issue') : ''}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={submitted && blocking}>
            {index < draft.functions.length ? 'Save changes' : 'Add function'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        noValidate
      >
        <datalist id={`${ids}-programs`}>
          {suggestions.programs.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        <datalist id={`${ids}-routines`}>
          {routineOptions.map((x) => (
            <option key={`${x.program}/${x.name}`} value={x.name}>
              {x.program}
            </option>
          ))}
        </datalist>
        <datalist id={`${ids}-modules`}>
          {suggestions.modules.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        <datalist id={`${ids}-instances`}>
          {instanceOptions.map((x) => (
            <option key={x.name} value={x.name}>
              {x.module}
            </option>
          ))}
        </datalist>
        <datalist id={`${ids}-outputs`}>
          {suggestions.tags.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <legend className="il-label mb-3 text-ink">Function</legend>
          <Input label="ID" {...field('id')} onChange={(e) => set('id', e.target.value)} className="font-mono" />
          <Input label="Name" {...field('name')} onChange={(e) => set('name', e.target.value)} />
          <Textarea
            label="Description"
            rows={3}
            wrapperClassName="sm:col-span-2"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            error={engineIssues.fields.description}
            hint="What hazard it protects against, in plain words."
          />
          <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
          <Select label="Kind" value={form.kind} onChange={(e) => set('kind', e.target.value as FunctionForm['kind'])} hint={KIND_OPTIONS.find((k) => k.value === form.kind)?.hint}>
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
          <Select label="Criticality" value={form.criticality} onChange={(e) => set('criticality', e.target.value as FunctionForm['criticality'])}>
            {CRITICALITY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {enumLabel(c)}
              </option>
            ))}
          </Select>
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="il-label mb-3 text-ink">Implementation</legend>
          <Input label="Program" list={`${ids}-programs`} {...field('program')} hint={hint('program')} onChange={(e) => set('program', e.target.value)} className="font-mono" />
          <Input label="Routine" list={`${ids}-routines`} {...field('routine')} hint={hint('routine')} onChange={(e) => set('routine', e.target.value)} className="font-mono" />
          <Input label="Module (AOI)" list={`${ids}-modules`} {...field('module')} hint={hint('module', 'Optional: the reusable block that implements it.')} onChange={(e) => set('module', e.target.value)} className="font-mono" />
          <Input label="Instance" list={`${ids}-instances`} {...field('instance')} hint={hint('instance', 'Backing tag of the call, e.g. PUMP_01_IL.')} onChange={(e) => set('instance', e.target.value)} className="font-mono" />
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <legend className="il-label mb-3 text-ink">Protective output</legend>
          <Input label="Output tag" list={`${ids}-outputs`} {...field('outputTag')} onChange={(e) => set('outputTag', e.target.value)} className="font-mono" hint="The tag that takes the safe state when the function acts." />
          <Select label="Acts at" value={form.tripState} onChange={(e) => set('tripState', e.target.value as FunctionForm['tripState'])} hint={form.tripState === 'DE_ENERGIZE' ? 'Run enable / permit style' : 'Trip command / close valve style'}>
            <option value="DE_ENERGIZE">0 (de-energize)</option>
            <option value="ENERGIZE">1 (energize)</option>
          </Select>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="il-label mb-3 text-ink">Alarm</legend>
          <Input label="Alarm tag" list={`${ids}-outputs`} {...field('alarmTag')} onChange={(e) => set('alarmTag', e.target.value)} className="font-mono" hint="An ALMD tag or a BOOL alarm tag the HMI reads." />
          <Input
            label="Declared notification"
            value={form.notification}
            onChange={(e) => set('notification', e.target.value)}
            error={engineIssues.fields.notification}
            hint="e.g. HMI alarm summary, Control Room A. Shown as DECLARED: a project file cannot prove it."
          />
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4">
          <legend className="il-label mb-3 text-ink">Context</legend>
          <Input label="Enable condition" value={form.enableCondition} onChange={(e) => set('enableCondition', e.target.value)} className="font-mono" hint="Optional arming condition you expect, e.g. Safety_Enable. Informational." error={engineIssues.fields.enableCondition} />
          <Textarea label="Notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} error={engineIssues.fields.notes} />
        </fieldset>

        {engineIssues.other.length > 0 && (
          <div role="alert" className="rounded-input border border-coral/45 px-4 py-3 text-sm text-ink">
            <p className="il-label mb-1 text-coral-ink">Engine validation</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {engineIssues.other.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}

/* --------------------------------------------------------- scope editor */

function ScopeList({ label, hint, items, placeholder, onChange }: { label: string; hint: string; items: string[]; placeholder: string; onChange: (next: string[]) => void }) {
  const [value, setValue] = useState('')
  const id = useId()
  const add = () => {
    const v = value.trim()
    if (!v || items.some((x) => x.toLowerCase() === v.toLowerCase())) return
    onChange([...items, v])
    setValue('')
  }
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <p className="text-[0.8125rem] text-ink-2">{hint}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((x) => (
          <li key={x} className="inline-flex max-w-full items-center gap-1 rounded-chip bg-ink/[0.06] py-1 pl-2.5 pr-1 font-mono text-xs text-ink ring-1 ring-inset ring-ink/10">
            <span className="il-ident">{x}</span>
            <button type="button" onClick={() => onChange(items.filter((y) => y !== x))} className="rounded-[6px] p-0.5 text-ink-2 hover:bg-ink/10 hover:text-ink" aria-label={`Remove ${x}`}>
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-[0.8125rem] text-ink-3">None declared</li>}
      </ul>
      <div className="mt-2 flex gap-2">
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          className="h-9 font-mono text-sm"
          wrapperClassName="flex-1"
        />
        <Button size="sm" onClick={add} disabled={!value.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- editor */

export interface DeclarationsEditorProps {
  result: AnalysisResult
  /** The declarations the current analysis used (or the workspace's newer ones). */
  source: SafetyManifest
  sourceName: string
  draft: SafetyManifest
  onDraftChange: (m: SafetyManifest) => void
}

export function DeclarationsEditor({ result, source, sourceName, draft, onDraftChange }: DeclarationsEditorProps) {
  const navigate = useNavigate()
  const suggestions = useMemo(() => suggestionsFrom(result), [result])
  const validation = useEngineValidation(draft)
  const [editing, setEditing] = useState<{ index: number; form: FunctionForm; key: number } | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)

  const baseline = useWorkspace((s) => s.baseline)
  const current = useWorkspace((s) => s.current)
  const run = useWorkspace((s) => s.run)
  const loadManifestJson = useWorkspace((s) => s.loadManifestJson)
  const [rerun, setRerun] = useState<{ state: 'idle' | 'loading' | 'running' } | { state: 'failed'; message: string }>({ state: 'idle' })

  const dirty = !sameManifest(draft, source)
  const filesInMemory = baseline.phase === 'ready' && current.phase === 'ready' && !!baseline.file && !!current.file
  const statusById = new Map(result.safetyFunctions.map((s) => [s.function.id, s.status]))
  const doneStages = STAGES.filter((s) => run.stages[s.id]?.doneAtMs !== undefined).length
  const activeStage = STAGES.find((s) => run.stages[s.id]?.startedAtMs !== undefined && run.stages[s.id]?.doneAtMs === undefined)

  const startEdit = (index: number) => {
    const f = draft.functions[index]
    setEditing({ index, form: f ? toForm(f) : emptyForm(draft.functions.map((x) => x.id)), key: Date.now() })
  }

  const saveFunction = (f: SafetyFunction) => {
    if (!editing) return
    const functions = [...draft.functions]
    functions[editing.index] = f
    onDraftChange({ ...draft, functions })
    setEditing(null)
    toast({ title: editing.index < draft.functions.length ? `${f.id} updated in the draft` : `${f.id} added to the draft`, tone: 'neutral' })
  }

  const remove = () => {
    if (removing === null) return
    const f = draft.functions[removing]
    onDraftChange({ ...draft, functions: draft.functions.filter((_, i) => i !== removing) })
    setRemoving(null)
    if (f) toast({ title: `${f.id} removed from the draft`, tone: 'neutral' })
  }

  const scope = draft.nonSafetyScope ?? {}
  const setScope = (k: 'programs' | 'routines', v: string[]) => {
    const next = { ...scope, [k]: v }
    if (next.programs?.length === 0) delete next.programs
    if (next.routines?.length === 0) delete next.routines
    onDraftChange({ ...draft, nonSafetyScope: Object.keys(next).length ? next : undefined })
  }

  const manifestName = sourceName.replace(/(\.edited)?\.json$/i, '') + (dirty ? '.edited.json' : '.json')

  const applyAndRun = async () => {
    setRerun({ state: 'loading' })
    await loadManifestJson(manifestName, draft, 'file')
    const ws = useWorkspace.getState()
    if (ws.manifestIssues) {
      setRerun({ state: 'failed', message: ws.manifestIssues.issues.join('; ') })
      return
    }
    setRerun({ state: 'running' })
    await ws.startAnalysis()
    const after = useWorkspace.getState().run
    if (after.status === 'complete') {
      setRerun({ state: 'idle' })
      toast({ title: 'Analysis re-run with the edited declarations', body: 'Every view now shows the new result.', tone: 'success' })
    } else if (after.status === 'failed') setRerun({ state: 'failed', message: after.error?.message ?? 'Analysis could not be completed.' })
    else setRerun({ state: 'idle' })
  }

  const loadForNext = async () => {
    await loadManifestJson(manifestName, draft, 'file')
    if (!useWorkspace.getState().manifestIssues) navigate('/app/new')
    else setRerun({ state: 'failed', message: useWorkspace.getState().manifestIssues?.issues.join('; ') ?? '' })
  }

  const busy = rerun.state === 'loading' || rerun.state === 'running' || run.status === 'running'
  const invalid = validation.state === 'invalid' || validation.state === 'error'

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Draft status + actions */}
      <div className="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-5 shadow-inset-line sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="il-label mb-1.5">Declarations draft</p>
          <p className="il-ident font-mono text-sm font-semibold text-ink">
            {sourceName}
            {dirty && <span className="ml-2 font-sans text-[0.8125rem] font-semibold text-marigold-ink">· unsaved edits</span>}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-2" aria-live="polite">
            {plural(draft.functions.length, 'safety function')} ·{' '}
            {validation.state === 'valid' ? (
              <span className="inline-flex items-center gap-1 text-sage-ink">
                <Glyph shape="check" className="size-3" /> Engine validation passed
              </span>
            ) : validation.state === 'invalid' ? (
              <span className="inline-flex items-center gap-1 text-coral-ink">
                <Glyph shape="cross" className="size-3" /> {plural(validation.issues.length, 'engine issue')}
              </span>
            ) : validation.state === 'error' ? (
              <span className="text-coral-ink">{validation.message}</span>
            ) : (
              <span>Checking with the engine…</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" iconLeft={<RotateCcw />} disabled={!dirty || busy} onClick={() => onDraftChange(source)}>
            Discard edits
          </Button>
          <Button size="sm" variant="secondary" iconLeft={<Download />} disabled={invalid} onClick={() => downloadManifest(draft, manifestName)}>
            Export JSON
          </Button>
          {filesInMemory ? (
            <Button size="sm" variant="primary" iconLeft={<Play />} loading={busy} disabled={invalid || busy || !dirty} title={dirty ? undefined : 'Edit the declarations first: the current analysis already uses these.'} onClick={() => void applyAndRun()}>
              Re-run analysis with these declarations
            </Button>
          ) : (
            <Button size="sm" variant="primary" iconLeft={<Play />} disabled={invalid || busy} onClick={() => void loadForNext()}>
              Use for a new analysis
            </Button>
          )}
        </div>
      </div>

      {!filesInMemory && (
        <p className="-mt-2 max-w-prose text-[0.8125rem] text-ink-2">
          The two project exports are not in memory (INTERLOCK never stores project files). “Use for a new analysis” loads these declarations into New Analysis, where you re-import the baseline and current exports.
        </p>
      )}

      {(rerun.state === 'loading' || rerun.state === 'running' || run.status === 'running') && (
        <div role="status" className="flex min-w-0 flex-col gap-2 rounded-input bg-paper-2/60 px-4 py-3 shadow-inset-line">
          <p className="text-sm font-semibold text-ink">
            {rerun.state === 'loading' ? 'Validating declarations in the engine…' : `Re-running analysis · ${doneStages} of ${STAGES.length} stages complete${activeStage ? ` · ${activeStage.label}` : ''}`}
          </p>
          <div aria-hidden="true" className="flex gap-1">
            {STAGES.map((s) => (
              <span key={s.id} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-base', run.stages[s.id]?.doneAtMs !== undefined ? 'bg-ink' : run.stages[s.id]?.startedAtMs !== undefined ? 'bg-ink/40' : 'bg-ink/[0.1]')} />
            ))}
          </div>
        </div>
      )}
      {rerun.state === 'failed' && (
        <div role="alert" className="rounded-input border border-coral/45 bg-surface px-4 py-3 text-sm text-ink">
          <p className="il-label mb-1 text-coral-ink">Analysis could not be completed.</p>
          <p className="il-ident">{rerun.message}</p>
        </div>
      )}

      {validation.state === 'invalid' && (
        <div className="rounded-input border border-coral/45 bg-surface px-4 py-3 text-sm">
          <p className="il-label mb-1.5 text-coral-ink">Engine validation issues</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 font-mono text-xs text-ink">
            {validation.issues.map((x) => (
              <li key={x} className="il-ident">
                {x}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Functions */}
      <section aria-labelledby="decl-functions" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="decl-functions" className="text-title-3 text-ink">
              Safety functions
            </h2>
            <p className="text-[0.8125rem] text-ink-2">Logic outside every declared function is reported as UNDECLARED, never as safe.</p>
          </div>
          <Button size="sm" variant="primary" iconLeft={<Plus />} onClick={() => startEdit(draft.functions.length)}>
            Add safety function
          </Button>
        </div>
        <ul className="flex min-w-0 flex-col overflow-hidden rounded-card bg-surface shadow-inset-line">
          {draft.functions.map((f, i) => {
            const original = source.functions.find((x) => x.id === f.id)
            const state = !original ? 'added' : !sameFunction(original, f) ? 'edited' : null
            const status = statusById.get(f.id)
            return (
              <li key={`${f.id}-${i}`} className="grid min-w-0 grid-cols-1 gap-3 border-b border-line px-4 py-4 last:border-0 sm:px-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink-2">{f.id}</span>
                    <Badge tone={CRITICALITY_TONE[f.criticality]}>{f.criticality}</Badge>
                    <span className="font-mono text-[0.6875rem] text-ink-2">{enumLabel(f.kind)}</span>
                    {state && (
                      <Badge tone="marigold" icon={<span aria-hidden="true">{state === 'added' ? '+' : 'Δ'}</span>}>
                        {state === 'added' ? 'Added in draft' : 'Edited in draft'}
                      </Badge>
                    )}
                  </p>
                  <p className="il-ident mt-1 text-[0.9375rem] font-semibold text-ink">{f.name}</p>
                  <p className="il-ident font-mono text-[0.6875rem] text-ink-2">
                    {[f.implementation.program, f.implementation.routine].filter(Boolean).join('/') || 'no routine'}
                    {f.implementation.module ? ` · ${f.implementation.module}` : ''}
                    {f.implementation.instance ? ` · ${f.implementation.instance}` : ''}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="il-label">Protective output</p>
                  <p className="il-ident font-mono text-xs text-ink">{f.protectiveOutput ? `${f.protectiveOutput.tag} · acts at ${f.protectiveOutput.tripState === 'DE_ENERGIZE' ? '0' : '1'}` : '—'}</p>
                </div>
                <div className="min-w-0">
                  <p className="il-label">Alarm</p>
                  <p className="il-ident font-mono text-xs text-ink">{f.alarm?.tag ?? '—'}</p>
                </div>
                <div className="flex items-center gap-1 md:justify-end">
                  {status && !state && <StatusPill status={status} className="mr-2" />}
                  <IconButton label={`Edit ${f.id}`} size="sm" variant="secondary" onClick={() => startEdit(i)}>
                    <Pencil />
                  </IconButton>
                  <IconButton label={`Remove ${f.id}`} size="sm" variant="secondary" onClick={() => setRemoving(i)} tooltipAlign="end">
                    <Trash2 />
                  </IconButton>
                </div>
              </li>
            )
          })}
          {draft.functions.length === 0 && <li className="px-5 py-8 text-sm text-ink-2">No safety function declared. Every changed routine will be reported as UNDECLARED.</li>}
        </ul>
        {source.functions
          .filter((f) => !draft.functions.some((d) => d.id === f.id))
          .map((f) => (
            <p key={f.id} className="mt-2 font-mono text-xs text-coral-ink">
              − {f.id} {f.name} removed in draft
            </p>
          ))}
      </section>

      {/* Non-safety scope */}
      <section aria-labelledby="decl-scope" className="min-w-0 rounded-card bg-surface p-5 shadow-inset-line sm:p-6">
        <h2 id="decl-scope" className="text-title-3 text-ink">
          Declared non-safety scope
        </h2>
        <p className="mb-4 max-w-prose text-[0.8125rem] text-ink-2">Changes here are informational. Anything neither inside a function’s cone nor listed here is UNDECLARED and needs review.</p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ScopeList label="Programs" hint="Whole programs with no safety intent." items={scope.programs ?? []} placeholder="Program name" onChange={(v) => setScope('programs', v)} />
          <ScopeList label="Routines" hint="As Program/Routine." items={scope.routines ?? []} placeholder="Program/Routine" onChange={(v) => setScope('routines', v)} />
        </div>
      </section>

      {editing && (
        <FunctionFormSheet
          key={editing.key}
          open
          initial={editing.form}
          index={editing.index}
          draft={draft}
          suggestions={suggestions}
          hasProject
          onSave={saveFunction}
          onClose={() => setEditing(null)}
        />
      )}

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        size="sm"
        title={`Remove ${draft.functions[removing ?? -1]?.id ?? ''} from the draft?`}
        description="Logic that only this function covered becomes UNDECLARED in the next analysis. The loaded declarations file is not changed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={remove}>
              Remove
            </Button>
          </>
        }
      />
      {/* Kept for keyboard users who reach the bottom: a quick route back to the map. */}
      <ButtonLink to="/app/safety" variant="ghost" size="sm" className="self-start" onClick={() => window.scrollTo({ top: 0 })}>
        Back to the safety map
      </ButtonLink>
    </div>
  )
}
