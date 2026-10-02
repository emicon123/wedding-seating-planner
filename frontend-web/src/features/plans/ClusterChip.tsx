import { useDraggable } from '@dnd-kit/core'
import { GripVerticalIcon, PinIcon } from 'lucide-react'
import {
  memo,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type TouchEventHandler,
} from 'react'
import { GroupMark } from '@/components/GroupMark'
import { Button } from '@/components/ui/button'
import type { ClusterPlacement } from '@/domain/types'
import { GuestScoreMark } from '@/features/plans/GuestScoreMark'
import { MoveMenu } from '@/features/plans/MoveMenu'
import { usePlanView, type PlanView } from '@/features/plans/planViewContext'
import { cn } from '@/lib/utils'

const chipDragId = (clusterKey: number) => `cluster-${clusterKey}`

const stopDrag: MouseEventHandler & TouchEventHandler = (event) => event.stopPropagation()

type MembersProps = { cluster: ClusterPlacement; view: PlanView; interactive: boolean }

function Members({ cluster, view, interactive }: MembersProps) {
  return (
    <ul className="min-w-0 flex-1 space-y-0.5">
      {cluster.guestIds.map((guestId) => {
        const selected = view.selectedGuestId === guestId
        const name = view.nameOf(guestId)
        const score = view.scores?.get(guestId)
        return (
          <li
            key={guestId}
            className={cn(
              'flex min-w-0 items-center gap-1 rounded px-1',
              selected && 'bg-brass/30 ring-1 ring-brass',
            )}
          >
            {interactive ? (
              <button
                type="button"
                title={name}
                aria-current={selected ? 'true' : undefined}
                onClick={() => view.onSelectGuest(guestId)}
                className="min-w-0 truncate rounded py-0.5 text-left text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {name}
              </button>
            ) : (
              <span className="truncate py-0.5 text-sm font-medium">{name}</span>
            )}
            {score && <GuestScoreMark score={score} />}
          </li>
        )
      })}
    </ul>
  )
}

function frameClass(cluster: ClusterPlacement): string {
  return cn(
    'rounded-lg border bg-card px-1.5 py-1',
    cluster.guestIds.length > 1 && 'border-group-0/60 bg-group-0/5',
  )
}

type ClusterChipProps = {
  cluster: ClusterPlacement
  /** The table the chip is at; null in the tray. */
  tableNumber: number | null
}

/**
 * A paczka (cluster) as one draggable chip: the unit that is moved, pinned and dropped. A bound
 * cluster (group 0, more than one person) carries the solid wine "Grupa 0 ×N" mark. Pointer and
 * touch grab anywhere on the chip; the grip button is the keyboard handle (Spacja, strzałki,
 * Spacja). "Przenieś do stołu…" does the same without dragging at all.
 */
export const ClusterChip = memo(function ClusterChip({ cluster, tableNumber }: ClusterChipProps) {
  const view = usePlanView()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: chipDragId(cluster.clusterKey),
    data: { clusterKey: cluster.clusterKey },
  })
  const { onKeyDown, ...pointerListeners } = listeners ?? {}
  // dnd-kit types every listener as `Function`; the keyboard sensor's one is a React keydown handler
  const onHandleKeyDown = onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined
  const names = cluster.guestIds.map(view.nameOf).join(', ')
  const bound = cluster.guestIds.length > 1

  const actions = (
    <div className="flex shrink-0 items-center">
      {tableNumber !== null && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-pressed={cluster.pinned}
          className={cn(
            'pointer-coarse:size-8',
            cluster.pinned && 'bg-brass/30 text-brass-ink hover:bg-brass/40',
          )}
          onMouseDown={stopDrag}
          onTouchStart={stopDrag}
          onClick={() => view.onTogglePin(cluster, tableNumber)}
        >
          <PinIcon aria-hidden="true" className={cn(cluster.pinned && 'fill-brass')} />
          <span className="sr-only">
            {cluster.pinned ? 'Odepnij od stołu' : 'Przypnij do stołu'} ({names})
          </span>
        </Button>
      )}
      <MoveMenu cluster={cluster} tableNumber={tableNumber} label={names} stopDrag={stopDrag} />
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        onKeyDown={onHandleKeyDown}
        aria-label={`Przeciągnij paczkę: ${names}`}
        className="inline-flex size-6 cursor-grab items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-8"
      >
        <GripVerticalIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  )

  return (
    <div
      ref={setNodeRef}
      {...pointerListeners}
      data-cluster={cluster.clusterKey}
      data-pinned={cluster.pinned || undefined}
      className={cn(frameClass(cluster), 'touch-manipulation', isDragging && 'opacity-35')}
    >
      {bound ? (
        <>
          <div className="flex items-center justify-between gap-1">
            <GroupMark level={0} count={cluster.guestIds.length} />
            {actions}
          </div>
          <div className="pt-0.5">
            <Members cluster={cluster} view={view} interactive />
          </div>
        </>
      ) : (
        <div className="flex items-center gap-1">
          <Members cluster={cluster} view={view} interactive />
          {actions}
        </div>
      )}
    </div>
  )
})

/** What follows the pointer while dragging: the same chip, without controls. */
export function ChipOverlay({ cluster }: { cluster: ClusterPlacement }) {
  const view = usePlanView()
  return (
    <div className={cn(frameClass(cluster), 'w-60 cursor-grabbing shadow-lg ring-2 ring-ink')}>
      {cluster.guestIds.length > 1 && (
        <div className="pb-0.5">
          <GroupMark level={0} count={cluster.guestIds.length} />
        </div>
      )}
      <Members cluster={cluster} view={view} interactive={false} />
    </div>
  )
}
