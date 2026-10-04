/** Router error boundary: plain, specific, no apology. */
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { ButtonLink } from '../ui/Button.tsx'
import { ErrorState } from '../ui/States.tsx'

export function RouteError() {
  const err = useRouteError()
  const reason = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : 'Unknown error'
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <ErrorState
        title="View could not be displayed"
        message="This page hit an error while rendering. Your project files and saved analyses are unaffected."
        reason={reason}
        action={
          <ButtonLink to="/app" variant="primary" reloadDocument>
            Reload the workstation
          </ButtonLink>
        }
      />
    </div>
  )
}
