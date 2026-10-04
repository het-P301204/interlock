import type { ComponentType } from 'react'
import { createBrowserRouter } from 'react-router'
import { SiteLayout } from './site/SiteLayout.tsx'
import { RouteError } from './site/RouteError.tsx'
import { Landing } from './pages/Landing.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { LoadingState } from './ui/States.tsx'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

/** Shown only while a lazily loaded route module arrives on a cold start. */
function RouteFallback() {
  return (
    <div className="mx-auto max-w-page px-4 py-16 sm:px-6 lg:px-10">
      <LoadingState variant="page" label="Loading INTERLOCK" />
    </div>
  )
}

const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => async () => ({ Component: (await load())[name] })

export const router = createBrowserRouter(
  [
    {
      element: <SiteLayout />,
      errorElement: <RouteError />,
      hydrateFallbackElement: <RouteFallback />,
      children: [
        { index: true, element: <Landing /> },
        { path: 'how-it-works', lazy: page(() => import('./pages/HowItWorks.tsx'), 'HowItWorks') },
        { path: 'security', lazy: page(() => import('./pages/Security.tsx'), 'SecurityPage') },
        { path: 'privacy', lazy: page(() => import('./pages/Privacy.tsx'), 'PrivacyPage') },
        { path: '*', element: <NotFound /> },
      ],
    },
    {
      path: 'app',
      lazy: page(() => import('./shell/AppShell.tsx'), 'AppShell'),
      errorElement: <RouteError />,
      hydrateFallbackElement: <RouteFallback />,
      children: [
        { index: true, lazy: page(() => import('./pages/app/Overview.tsx'), 'Overview') },
        { path: 'new', lazy: page(() => import('./pages/app/NewAnalysis.tsx'), 'NewAnalysis') },
        { path: 'analyses', lazy: page(() => import('./pages/app/Analyses.tsx'), 'Analyses') },
        { path: 'settings', lazy: page(() => import('./pages/app/Settings.tsx'), 'Settings') },
        { path: 'demo', lazy: page(() => import('./pages/app/Demo.tsx'), 'Demo') },
        { path: 'projects', lazy: page(() => import('./pages/app/Projects.tsx'), 'Projects') },
        { path: 'safety', lazy: page(() => import('./pages/app/SafetyMap.tsx'), 'SafetyMap') },
        { path: 'graph', lazy: page(() => import('./pages/app/ReuseGraph.tsx'), 'ReuseGraph') },
        { path: 'findings', lazy: page(() => import('./pages/app/Findings.tsx'), 'Findings') },
        { path: 'findings/:id', lazy: page(() => import('./pages/app/FindingDetail.tsx'), 'FindingDetail') },
        { path: 'changes', lazy: page(() => import('./pages/app/Changes.tsx'), 'Changes') },
        { path: 'drift', lazy: page(() => import('./pages/app/Drift.tsx'), 'Drift') },
        { path: 'reports', lazy: page(() => import('./pages/app/Reports.tsx'), 'Reports') },
        { path: '*', element: <NotFound inApp /> },
      ],
    },
  ],
  { basename },
)
