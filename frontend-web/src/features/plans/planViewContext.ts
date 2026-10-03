import { createContext, use } from 'react'
import type { PlanKind } from '@/domain/plans'
import type { ClusterPlacement, GuestScore } from '@/domain/types'

export type TableFill = { number: number; fill: number }

/** What every chip and table needs from the page, so it is not threaded through three levels. */
export type PlanView = {
  /** Key and capacity of the plan on screen: they decide each table's size and seat count. */
  kind: PlanKind
  nameOf: (guestId: number) => string
  /** Server satisfaction per guest. `undefined` while a save is in flight: they would be stale. */
  scores: ReadonlyMap<number, GuestScore> | undefined
  selectedGuestId: number | null
  /** Tables with their live fill, for the "Przenieś do stołu…" menu. */
  tables: readonly TableFill[]
  onSelectGuest: (guestId: number) => void
  onMove: (cluster: ClusterPlacement, toTable: number | null) => void
  onTogglePin: (cluster: ClusterPlacement, tableNumber: number) => void
  onDeleteTable: (tableNumber: number) => void
}

export const PlanViewContext = createContext<PlanView | null>(null)

export function usePlanView(): PlanView {
  const view = use(PlanViewContext)
  if (!view) throw new Error('usePlanView needs a PlanViewContext')
  return view
}
