import { FileText, FolderOpen, GitCompareArrows, Gauge, History, ListChecks, Network, Route, Settings, Split } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  badge?: string
  /** Shown in the phone bottom bar. */
  primary?: boolean
  end?: boolean
}

export const APP_NAV: NavItem[] = [
  { to: '/app', label: 'Overview', icon: Gauge, primary: true, end: true },
  { to: '/app/projects', label: 'Projects', icon: FolderOpen },
  { to: '/app/analyses', label: 'Analyses', icon: History },
  { to: '/app/safety', label: 'Safety Map', icon: Route, primary: true },
  { to: '/app/graph', label: 'Reuse Graph', icon: Network, primary: true },
  { to: '/app/findings', label: 'Findings', icon: ListChecks, primary: true },
  { to: '/app/changes', label: 'Changes', icon: GitCompareArrows },
  { to: '/app/drift', label: 'Drift', icon: Split, badge: 'Experimental' },
  { to: '/app/reports', label: 'Reports', icon: FileText },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]

export const GITHUB_URL = 'https://github.com/het-P301204/interlock'
export const ADVISORY_URL = 'https://github.com/het-P301204/interlock/security/advisories/new'
