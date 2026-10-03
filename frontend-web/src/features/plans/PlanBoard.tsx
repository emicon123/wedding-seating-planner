import { DndContext, DragOverlay } from '@dnd-kit/core'
import { useMemo, type ReactNode } from 'react'
import { guestTableMap } from '@/domain/planView'
import type { ClusterOverview, Scenario } from '@/domain/types'
import { ChipOverlay } from '@/features/plans/ClusterChip'
import { FloorPlan } from '@/features/plans/FloorPlan'
import { PlanViewContext, type PlanView } from '@/features/plans/planViewContext'
import { UnseatedTray } from '@/features/plans/UnseatedTray'
import { useClusterDrag } from '@/features/plans/useClusterDrag'

type PlanBoardProps = {
  scenario: Scenario
  overview: ClusterOverview | undefined
  view: PlanView
  selectedGuestId: number | null
  settled: boolean
  compact: boolean
  /** The details panel: rendered above the tray on a desktop sidebar, above the hall on a phone. */
  details: ReactNode
}

/**
 * The drag & drop board: one DndContext around the hall (tables) and the unseated tray, so a chip
 * can be dropped on either. Layout: hall on the left, a sidebar with details + tray on the right;
 * on a phone the details come first, then the hall, then the tray.
 */
export function PlanBoard({
  scenario,
  overview,
  view,
  selectedGuestId,
  settled,
  compact,
  details,
}: PlanBoardProps) {
  const { plan } = scenario
  const { dndProps, dragging, activeCluster, over, hint } = useClusterDrag({
    plan,
    kind: view.kind,
    overview,
    nameOf: view.nameOf,
    onMove: view.onMove,
  })

  const selectedTable = useMemo(
    () => (selectedGuestId === null ? undefined : guestTableMap(plan).get(selectedGuestId)),
    [plan, selectedGuestId],
  )
  const hoveredTable = over?.kind === 'table' ? over.number : null

  return (
    <PlanViewContext value={view}>
      <DndContext {...dndProps}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
          <div className="order-2 min-w-0 lg:order-none">
            <FloorPlan
              plan={plan}
              highlightedTable={typeof selectedTable === 'number' ? selectedTable : null}
              hoveredTable={hoveredTable}
              hint={hint}
              dragging={dragging}
              settled={settled}
              compact={compact}
            />
          </div>
          <aside
            aria-label="Szczegóły i goście bez stołu"
            className="contents lg:sticky lg:top-16 lg:z-10 lg:block lg:max-h-[calc(100dvh-5rem)] lg:space-y-4 lg:overflow-y-auto lg:pr-1"
          >
            {details && <div className="order-1 lg:order-none">{details}</div>}
            <div className="order-3 lg:order-none">
              <UnseatedTray
                unseated={plan.unseated}
                highlighted={selectedGuestId !== null && selectedTable === null}
                hovered={over?.kind === 'tray'}
                dragging={dragging}
              />
            </div>
          </aside>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCluster ? <ChipOverlay cluster={activeCluster} /> : null}
        </DragOverlay>
      </DndContext>
    </PlanViewContext>
  )
}
