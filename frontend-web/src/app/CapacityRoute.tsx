import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import {
  isRetiredCapacity,
  parseCapacity,
  REPLACEMENT_FOR_RETIRED,
  type Capacity,
} from '@/domain/capacity'

/**
 * Guards `:capacity` routes: only 9 / 10 / 11 / 12 are real plans. The retired 8 (old bookmarks)
 * goes to the 9-seat plan it became; anything else goes back to Plany.
 */
export function CapacityRoute({ render }: { render: (capacity: Capacity) => ReactNode }) {
  const raw = useParams().capacity
  const location = useLocation()
  const capacity = parseCapacity(raw)
  if (capacity !== null) return render(capacity)
  if (isRetiredCapacity(raw)) {
    const pathname = location.pathname.replace(/8\/?$/, String(REPLACEMENT_FOR_RETIRED))
    return <Navigate to={{ pathname, search: location.search }} replace />
  }
  return <Navigate to="/" replace />
}
