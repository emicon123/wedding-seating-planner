import { useDroppable } from '@dnd-kit/core'
import { CircleCheckIcon, InboxIcon } from 'lucide-react'
import { useMemo } from 'react'
import { TRAY_ID } from '@/domain/dropTargets'
import { peopleLabel } from '@/domain/labels'
import { sortPlacements } from '@/domain/planView'
import type { ClusterPlacement } from '@/domain/types'
import { ClusterChip } from '@/features/plans/ClusterChip'
import { usePlanView } from '@/features/plans/planViewContext'
import { cn } from '@/lib/utils'

type UnseatedTrayProps = {
  unseated: ClusterPlacement[]
  highlighted: boolean
  /** A paczka is being dragged over the tray: dropping it takes it off its table. */
  hovered: boolean
  dragging: boolean
}

/** Guests without a table, as paczki. Also a drop target: drop here to take a paczka off a table. */
export function UnseatedTray({ unseated, highlighted, hovered, dragging }: UnseatedTrayProps) {
  const { nameOf } = usePlanView()
  const { setNodeRef } = useDroppable({ id: TRAY_ID })
  const clusters = useMemo(() => sortPlacements(unseated, nameOf), [unseated, nameOf])
  const people = unseated.reduce((sum, cluster) => sum + cluster.guestIds.length, 0)

  return (
    <section
      ref={setNodeRef}
      id="bez-stolu"
      data-drop-id={TRAY_ID}
      aria-labelledby="bez-stolu-naglowek"
      className={cn(
        'rounded-xl border bg-card p-3',
        people > 0 && 'border-brick/60',
        dragging && 'border-dashed border-ink/50',
        hovered && 'ring-2 ring-ink',
        highlighted && 'border-brass bg-brass/10 ring-2 ring-brass',
      )}
    >
      <h2
        id="bez-stolu-naglowek"
        className="flex items-center gap-2 font-display text-lg font-semibold"
      >
        <InboxIcon aria-hidden="true" className="size-5" />
        Bez stołu
        <span className="ml-auto font-sans text-sm font-medium text-muted-foreground">
          {people === 0 ? 'nikogo' : peopleLabel(people)}
        </span>
      </h2>
      {hovered && <p className="mt-1 text-sm font-medium">Upuść, żeby zdjąć paczkę ze stołu</p>}
      {people === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheckIcon aria-hidden="true" className="size-4 text-sage" />
          Wszyscy mają stół. Tu możesz upuścić paczkę, żeby zdjąć ją ze stołu.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {clusters.map((cluster) => (
            <li key={cluster.clusterKey}>
              <ClusterChip cluster={cluster} tableNumber={null} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
