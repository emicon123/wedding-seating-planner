import { Outlet } from 'react-router'
import { errorMessage } from '@/api/errorMessage'
import { useSession } from '@/api/session'
import { Loading } from '@/app/Loading'
import { Button } from '@/components/ui/button'
import { PinScreen } from '@/features/session/PinScreen'

/**
 * Pathless root route around every screen (print view included). It asks `GET /session` once and
 * renders either the PIN screen or the app; the URL is never touched, so after the PIN the same
 * route renders again. Pages mount only when open: no data query fires before the session is known.
 */
export function AccessGate() {
  const session = useSession()
  if (session.isPending) return <Loading />
  if (session.isError) {
    return (
      <div role="alert" className="mx-auto max-w-sm space-y-4 p-6 text-center">
        <p>{errorMessage(session.error)}</p>
        <Button type="button" onClick={() => void session.refetch()}>
          Spróbuj ponownie
        </Button>
      </div>
    )
  }
  if (session.data.status === 'pinRequired') return <PinScreen />
  return <Outlet />
}
