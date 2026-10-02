import type { ReactNode } from 'react'
import { Navigate, useParams } from 'react-router'
import { parseCapacity, type Capacity } from '@/domain/capacity'

/** Guards `:capacity` routes: only 8 / 10 / 12 are real plans, anything else goes back to Plany. */
export function CapacityRoute({ render }: { render: (capacity: Capacity) => ReactNode }) {
  const capacity = parseCapacity(useParams().capacity)
  return capacity === null ? <Navigate to="/" replace /> : render(capacity)
}
