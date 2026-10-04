/**
 * Demo scenarios. "Load Demo Scenario" runs the real engine on the synthetic
 * fixture files (inspect, validate, analyze) and opens the ingest page so the
 * verification and pipeline are visible. Nothing is pre-computed.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { hasFixture } from '../../demo/fixtures.ts'
import { loadScenario, scenarioAvailable } from '../../demo/loadScenario.ts'
import { SCENARIOS } from '../../demo/scenarios.ts'
import type { Scenario } from '../../demo/scenarios.ts'
import { useDocumentTitle } from '../../lib/hooks.ts'
import { Badge } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { PageHeader } from '../../ui/Panel.tsx'
import { EmptyState } from '../../ui/States.tsx'
import { toast } from '../../ui/Toast.tsx'

function ScenarioRow({ s, busy, onLoad }: { s: Scenario; busy: boolean; onLoad: () => void }) {
  const available = scenarioAvailable(s, hasFixture)
  return (
    <li className="grid grid-cols-1 gap-4 border-b border-line px-5 py-5 last:border-0 sm:px-7 md:grid-cols-[3rem_minmax(0,1fr)_auto] md:items-start">
      <span className="il-num font-mono text-sm font-semibold text-ink-2">{s.id}</span>
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-2 text-title-3 text-ink">
          {s.title}
          {s.kind === 'drift' && <Badge tone="iris">Drift · Experimental</Badge>}
        </h2>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-2">{s.summary}</p>
        {s.highlights.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {s.highlights.map((h) => (
              <li key={h} className="il-ident rounded-chip bg-ink/[0.05] px-2 py-1 font-mono text-[0.6875rem] text-ink-2 ring-1 ring-inset ring-ink/[0.08]">
                {h}
              </li>
            ))}
          </ul>
        )}
        <p className="il-ident mt-3 font-mono text-[0.6875rem] text-ink-2">
          {s.kind === 'compare' ? `${s.baseline} → ${s.current}` : s.sites?.map((x) => x.file).join(' · ')}
        </p>
      </div>
      <div className="md:pt-0.5">
        {s.kind === 'compare' ? (
          <Button variant={available ? 'primary' : 'secondary'} disabled={!available || busy} loading={busy} onClick={onLoad} iconRight={<ArrowRight />}>
            Load Demo Scenario
          </Button>
        ) : (
          <p className="max-w-[14rem] text-[0.8125rem] text-ink-2">Multi-site drift runs from the Drift page, which is not in this build yet.</p>
        )}
      </div>
    </li>
  )
}

export function Demo() {
  useDocumentTitle('Demo')
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)

  const load = async (s: Scenario) => {
    setBusy(s.id)
    navigate('/app/new')
    try {
      await loadScenario(s)
    } catch (e) {
      toast({ title: 'Demo scenario could not be loaded', body: e instanceof Error ? e.message : undefined, tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Demo"
        title="Northgate Pump Station"
        description="A synthetic controller with an emergency shutdown, five pumps sharing one interlock AOI, a compressor and tank alarms. Each scenario is a pair of real L5X exports analyzed in this browser."
      />
      {SCENARIOS.length === 0 ? (
        <EmptyState title="No demo scenarios in this build." body="The fixture catalogue (fixtures/scenarios.json) was not found when this build was made." />
      ) : (
        <ol className="overflow-hidden rounded-panel bg-surface shadow-soft ring-1 ring-line">
          {SCENARIOS.map((s) => (
            <ScenarioRow key={s.id} s={s} busy={busy === s.id} onLoad={() => void load(s)} />
          ))}
        </ol>
      )}
    </div>
  )
}
