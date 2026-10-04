/** Local settings: theme, storage, engine information. No accounts exist. */
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { engine } from '../../engine/client.ts'
import type { EngineInfo } from '../../engine/protocol.ts'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { ThemeSwitcher } from '../../shell/ThemeSwitcher.tsx'
import { LocalModeIndicator } from '../../shell/LocalModeIndicator.tsx'
import { useWorkspace } from '../../state/analysis.ts'
import { idbAvailable } from '../../state/persist.ts'
import { StatusPill } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { Modal } from '../../ui/Modal.tsx'
import { KeyValue, PageHeader, Panel, Section } from '../../ui/Panel.tsx'
import { Skeleton } from '../../ui/States.tsx'
import { toast } from '../../ui/Toast.tsx'

export function Settings() {
  useDocumentTitle('Settings')
  const history = useWorkspace((s) => s.history)
  const clearLocalData = useWorkspace((s) => s.clearLocalData)
  const [storage, setStorage] = useState<boolean | null>(null)
  const [info, setInfo] = useState<EngineInfo | null | 'error'>(null)
  const [confirm, setConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    void idbAvailable().then(setStorage)
    engine.info().then(
      ({ value }) => setInfo(value),
      () => setInfo('error'),
    )
  }, [])

  return (
    <div className="flex flex-col gap-10">
      <PageHeader eyebrow="Settings" title="This browser" description="INTERLOCK has no accounts. Everything here applies only to this browser on this device." />

      <Section title="Appearance">
        <Panel className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">Theme</p>
            <p className="text-[0.8125rem] text-ink-2">System follows your operating system’s light or dark setting.</p>
          </div>
          <ThemeSwitcher />
        </Panel>
      </Section>

      <Section title="Local data" description="Analysis results are stored in IndexedDB so you can reopen them. Project files are never stored.">
        <Panel className="flex flex-col gap-5">
          <KeyValue
            items={[
              ['Analysis mode', <LocalModeIndicator key="m" />],
              ['IndexedDB', storage === null ? <Skeleton key="s" className="h-4 w-24" /> : storage ? <StatusPill key="s" status="READY" label="AVAILABLE" /> : <StatusPill key="s" status="BLOCKED" label="UNAVAILABLE" />],
              ['Saved analyses', String(history.length)],
            ]}
          />
          {storage === false && (
            <p className="text-[0.8125rem] text-ink-2">This browser is not allowing IndexedDB (private window or blocked site data). Analyses work, but are not remembered after reload.</p>
          )}
          <div className="border-t border-line pt-4">
            <Button variant="danger" iconLeft={<Trash2 />} onClick={() => setConfirm(true)}>
              Delete saved analyses and project records
            </Button>
          </div>
        </Panel>
      </Section>

      <Section title="Analysis engine" description="The engine runs in a Web Worker inside this page.">
        <Panel>
          {info === null ? (
            <Skeleton className="h-16 w-full" />
          ) : info === 'error' ? (
            <p className="text-sm text-ink-2">The analysis engine could not be started in this browser.</p>
          ) : (
            <div className="flex flex-col gap-5">
              <KeyValue items={[['Engine version', info.engineVersion]]} />
              <ul className="divide-y divide-line rounded-input shadow-inset-line">
                {info.adapters.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{a.label}</span>
                      <span className="font-mono text-[0.6875rem] text-ink-2">
                        {a.vendor} · {a.extensions.join(', ')} · v{a.version}
                      </span>
                    </span>
                    <StatusPill status={a.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </Section>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete saved analyses and project records?"
        description={`This removes ${history.length} saved analysis result${history.length === 1 ? '' : 's'} and the list of inspected project versions from this browser. It cannot be undone.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep them
            </Button>
            <Button
              variant="danger"
              loading={clearing}
              onClick={async () => {
                setClearing(true)
                const ok = await clearLocalData()
                setClearing(false)
                setConfirm(false)
                toast(ok ? { title: 'Saved analyses deleted', tone: 'success' } : { title: 'Nothing was stored', body: 'IndexedDB is unavailable in this browser.' })
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">The current page keeps working; you can run any analysis again from the original files.</p>
      </Modal>
    </div>
  )
}
