import { useLocation } from 'react-router'
import { useDocumentTitle } from '../lib/hooks.ts'
import { ButtonLink } from '../ui/Button.tsx'
import { EmptyState } from '../ui/States.tsx'

export function NotFound({ inApp = false }: { inApp?: boolean }) {
  const { pathname } = useLocation()
  useDocumentTitle('Page not found')
  return (
    <div className={inApp ? '' : 'mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:py-28'}>
      <EmptyState
        eyebrow="404 · Not found"
        title="There is no page at this address."
        body={
          <>
            Nothing is routed to <code className="il-ident font-mono text-[0.9em] text-ink">{pathname}</code>. Check the address, or continue from one
            of these.
          </>
        }
        action={
          <ButtonLink to={inApp ? '/app' : '/'} variant="primary">
            {inApp ? 'Go to Overview' : 'Go to the home page'}
          </ButtonLink>
        }
        secondary={
          <ButtonLink to="/app/new" variant="secondary">
            Start Analysis
          </ButtonLink>
        }
      />
    </div>
  )
}
