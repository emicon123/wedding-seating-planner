import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import {
  isRetiredPlanKey,
  parsePlanKey,
  REPLACEMENT_FOR_RETIRED,
  type PlanKey,
} from '@/domain/plans'

/**
 * Guards `:planKey` routes: only 9 / 10 / 11 / 12 / mixed are real plans. The retired 8 (old
 * bookmarks) goes to the 9-seat plan it became; anything else goes back to Plany.
 */
export function PlanRoute({ render }: { render: (key: PlanKey) => ReactNode }) {
  const raw = useParams().planKey
  const location = useLocation()
  const key = parsePlanKey(raw)
  if (key !== null) return render(key)
  if (isRetiredPlanKey(raw)) {
    const pathname = location.pathname.replace(/8\/?$/, REPLACEMENT_FOR_RETIRED)
    return <Navigate to={{ pathname, search: location.search }} replace />
  }
  return <Navigate to="/" replace />
}
