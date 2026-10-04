/**
 * Commands for the Ctrl/⌘+K palette: fixed actions, navigation, theme, and —
 * when an analysis is loaded — its real findings, safety functions, modules,
 * routines, programs and tags (from the engine's result, nothing else).
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  Boxes,
  FileDown,
  FileSearch,
  FlaskConical,
  FolderOpen,
  ListChecks,
  Monitor,
  Moon,
  Network,
  OctagonAlert,
  Play,
  Route,
  Sun,
  Tag,
  BookOpen,
  Workflow,
} from 'lucide-react'
import { SEVERITY_ORDER } from '@interlock/core/types'
import { useWorkspace } from '../state/analysis.ts'
import { useUi } from '../state/ui.ts'
import type { Command } from '../ui/CommandMenu.tsx'
import { APP_NAV } from './nav.ts'

export function useCommands(): Command[] {
  const navigate = useNavigate()
  const result = useWorkspace((s) => s.result)
  const setTheme = useUi((s) => s.setTheme)

  return useMemo(() => {
    const go = (to: string) => () => navigate(to)
    const cmds: Command[] = [
      { id: 'act-open', group: 'Actions', label: 'Open Project', icon: <FolderOpen />, keywords: ['import', 'l5x', 'upload', 'baseline'], run: go('/app/new') },
      { id: 'act-start', group: 'Actions', label: 'Start Analysis', icon: <Play />, keywords: ['analyze', 'new', 'compare'], run: go('/app/new') },
      { id: 'act-demo', group: 'Actions', label: 'Load Demo', icon: <FlaskConical />, keywords: ['scenario', 'northgate', 'example'], run: go('/app/demo') },
      { id: 'act-sf', group: 'Actions', label: 'Find Safety Function', icon: <Route />, keywords: ['safety map', 'shutdown', 'interlock', 'trip'], run: go('/app/safety') },
      { id: 'act-critical', group: 'Actions', label: 'Show Critical Findings', icon: <OctagonAlert />, keywords: ['severity', 'critical'], run: go('/app/findings?severity=CRITICAL') },
      { id: 'act-graph', group: 'Actions', label: 'Open Reuse Graph', icon: <Network />, keywords: ['aoi', 'blast radius', 'module'], run: go('/app/graph') },
      { id: 'act-export', group: 'Actions', label: 'Export Report', icon: <FileDown />, keywords: ['pdf', 'json', 'csv'], run: go('/app/reports'), disabled: !result },
      { id: 'act-docs', group: 'Actions', label: 'Open Documentation', icon: <BookOpen />, keywords: ['help', 'how it works'], run: go('/how-it-works') },
    ]
    for (const n of APP_NAV) {
      const Icon = n.icon
      cmds.push({ id: `nav-${n.to}`, group: 'Go to', label: n.label, icon: <Icon />, run: go(n.to) })
    }
    cmds.push(
      { id: 'theme-light', group: 'Theme', label: 'Use light theme', icon: <Sun />, run: () => setTheme('light') },
      { id: 'theme-dark', group: 'Theme', label: 'Use dark theme', icon: <Moon />, run: () => setTheme('dark') },
      { id: 'theme-system', group: 'Theme', label: 'Follow system theme', icon: <Monitor />, run: () => setTheme('system') },
    )

    if (result) {
      for (const sev of SEVERITY_ORDER) {
        const n = result.findings.filter((f) => f.severity === sev).length
        if (!n) continue
        cmds.push({
          id: `sev-${sev}`,
          group: 'Severity',
          label: `${sev} findings`,
          icon: <ListChecks />,
          hint: String(n),
          keywords: ['severity', sev.toLowerCase()],
          run: go(`/app/findings?severity=${sev}`),
        })
      }
      for (const f of result.findings) {
        cmds.push({
          id: `f-${f.id}`,
          group: 'Findings',
          label: `${f.id} ${f.title}`,
          icon: <ListChecks />,
          hint: f.severity,
          keywords: [f.severity, f.type, f.module ?? '', f.location.routine ?? '', f.location.program ?? '', ...f.safetyFunctionIds],
          run: go(`/app/findings/${encodeURIComponent(f.id)}`),
        })
      }
      for (const sf of result.safetyFunctions) {
        cmds.push({
          id: `sf-${sf.function.id}`,
          group: 'Safety functions',
          label: `${sf.function.id} ${sf.function.name}`,
          icon: <Route />,
          hint: sf.status.replace(/_/g, ' '),
          keywords: [sf.function.kind, sf.function.protectiveOutput?.tag ?? '', sf.function.alarm?.tag ?? ''],
          run: go(`/app/safety#${encodeURIComponent(sf.function.id)}`),
        })
      }
      const groupFor: Record<string, { group: string; icon: ReactNode } | undefined> = {
        module: { group: 'Modules', icon: <Boxes /> },
        routine: { group: 'Routines', icon: <FileSearch /> },
        program: { group: 'Programs', icon: <Workflow /> },
        tag: { group: 'Tags', icon: <Tag /> },
      }
      for (const n of result.graph.nodes) {
        const g = groupFor[n.type]
        if (!g) continue
        cmds.push({
          id: `n-${n.id}`,
          group: g.group,
          label: n.label,
          icon: g.icon,
          hint: n.sublabel,
          keywords: [n.type, n.sublabel ?? ''],
          run: go(`/app/graph?focus=${encodeURIComponent(n.id)}`),
        })
      }
    }
    return cmds
  }, [navigate, result, setTheme])
}
