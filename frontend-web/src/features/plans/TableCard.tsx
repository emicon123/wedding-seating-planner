import { useDroppable } from '@dnd-kit/core'
import { Trash2Icon, TriangleAlertIcon } from 'lucide-react'
import { memo, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { tableDropId, tableElementId } from '@/domain/dropTargets'
import type { DropPreview } from '@/domain/dropPreview'
import {
  dropHintLabel,
  EMPTY_TABLE_LABEL,
  fillStatusLabel,
  peopleCountLabel,
  preferredHereLabel,
  scoreLabel,
  sourceUnderFloorLabel,
  STRANGER_PAIRS_HINT,
  strangerPairsLabel,
  tableSizeBadgeLabel,
  violationLabel,
} from '@/domain/labels'
import { isMixed, minTableFill, type PlanKind } from '@/domain/plans'
import { sortPlacements } from '@/domain/planView'
import { sizeAfterDrop, tableSize } from '@/domain/tableSizes'
import { fillStatus } from '@/domain/tableStatus'
import type { PlanTable, Violation } from '@/domain/types'
import { ClusterChip } from '@/features/plans/ClusterChip'
import { usePlanView } from '@/features/plans/planViewContext'
import { TableSeats } from '@/features/plans/TableSeats'
import { cn } from '@/lib/utils'

/** Seats drawn at an empty mixed-plan table (nobody sits there, so it needs no size). */
const FALLBACK_SEATS = 9

export type DropHint = {
  preview: DropPreview
  /** The cluster is already at this table: dropping changes nothing. */
  sameTable: boolean
  /** The table the cluster is leaving (for the under-floor warning), when it differs. */
  sourceNumber: number | null
}

type TableCardProps = {
  table: PlanTable
  tableCount: number
  /** Server findings the fill counter cannot show; empty while a save is in flight. */
  violations: Violation[]
  /** The server's table score; hidden (null) while a save is in flight. */
  score: number | null
  /** Stranger pairs at this table (derived from the guest scores); null while a save is in flight. */
  strangerPairs: number | null
  highlighted: boolean
  /** Set on the hovered table while dragging. */
  hint: DropHint | null
  dragging: boolean
  compact: boolean
}

function DropHintBanner({ hint, kind }: { hint: DropHint; kind: PlanKind }) {
  const { preview } = hint
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-x-2 bottom-full z-20 mb-1 space-y-0.5 rounded-lg px-3 py-2 text-sm text-white shadow-lg',
        preview.overCapacity ? 'bg-brick' : 'bg-ink',
      )}
    >
      {hint.sameTable ? (
        <p className="font-semibold">Zostaje przy tym stole</p>
      ) : (
        <>
          <p className="flex items-center gap-1.5 font-semibold">
            {preview.overCapacity && <TriangleAlertIcon className="size-4" />}
            {dropHintLabel(preview, kind.capacity, sizeAfterDrop(preview.fillAfter, kind))}
          </p>
          <p className="text-white/85">{preferredHereLabel(preview.preferredHere)}</p>
          {preview.underFloorSource && hint.sourceNumber !== null && (
            <p className="flex items-center gap-1.5 font-medium">
              <TriangleAlertIcon className="size-4" />
              {sourceUnderFloorLabel(hint.sourceNumber, minTableFill(kind))}
            </p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * One table of the floor plan: its seats drawn as a round table, the live fill ("7/10"), rule
 * breaks as icon + text, and the paczki sitting there as draggable chips. It is a drop target;
 * while a paczka is dragged over it, a banner shows the seats the table would have afterwards.
 */
export const TableCard = memo(function TableCard({
  table,
  tableCount,
  violations,
  score,
  strangerPairs,
  highlighted,
  hint,
  dragging,
  compact,
}: TableCardProps) {
  const view = usePlanView()
  const { kind } = view
  const { capacity } = kind
  const mixed = isMixed(kind)
  const size = tableSize(table.fill, kind)
  const { setNodeRef, isOver } = useDroppable({ id: tableDropId(table.number) })
  const floor = minTableFill(kind)
  const status = fillStatus(table.fill, capacity, tableCount, floor)
  const statusText = fillStatusLabel(status, table.fill, capacity, floor)
  const clusters = useMemo(
    () => sortPlacements(table.clusters, view.nameOf),
    [table.clusters, view.nameOf],
  )
  const clusterSizes = useMemo(() => clusters.map((c) => c.guestIds.length), [clusters])

  return (
    <section
      ref={setNodeRef}
      id={tableElementId(table.number)}
      data-drop-id={tableDropId(table.number)}
      data-highlighted={highlighted || undefined}
      aria-labelledby={`${tableElementId(table.number)}-nazwa`}
      className={cn(
        'relative scroll-mt-24 rounded-xl border bg-card p-3 transition-shadow',
        dragging && !isOver && 'border-dashed border-ink/40',
        isOver && (hint?.preview.overCapacity ? 'ring-2 ring-brick' : 'ring-2 ring-ink'),
        highlighted && 'border-brass bg-brass/10 ring-2 ring-brass',
        status !== 'ok' && !isOver && !highlighted && 'border-brick/60',
      )}
    >
      {hint && <DropHintBanner hint={hint} kind={kind} />}

      <header className="flex items-start gap-3">
        <TableSeats
          number={table.number}
          capacity={mixed ? (size ?? FALLBACK_SEATS) : capacity}
          clusterSizes={clusterSizes}
          status={status}
          className={compact ? 'size-20' : 'size-24'}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 id={`${tableElementId(table.number)}-nazwa`} className="text-lg font-semibold">
                Stół {table.number}
              </h3>
              {mixed && size !== null && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                  {tableSizeBadgeLabel(size)}
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="pointer-coarse:size-8"
              onClick={() => view.onDeleteTable(table.number)}
            >
              <Trash2Icon aria-hidden="true" />
              <span className="sr-only">Usuń stół {table.number}</span>
            </Button>
          </div>
          <p
            className={cn(
              'font-display text-3xl leading-none font-semibold',
              status !== 'ok' && 'text-brick',
            )}
          >
            <span className="sr-only">Zajęte miejsca: </span>
            {mixed ? peopleCountLabel(table.fill) : `${table.fill}/${capacity}`}
          </p>
          {mixed && size === null && (
            <p className="text-xs text-muted-foreground">{EMPTY_TABLE_LABEL}</p>
          )}
          {statusText && (
            <p className="flex items-start gap-1 text-xs font-semibold text-brick">
              <TriangleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              {statusText}
            </p>
          )}
          {violations.map((violation, index) => (
            <p key={index} className="flex items-start gap-1 text-xs font-semibold text-brick">
              <TriangleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              {violationLabel(violation, floor)}
            </p>
          ))}
          <p className="text-xs text-muted-foreground">
            Zadowolenie {score === null ? '…' : scoreLabel(score)}
            {strangerPairs !== null && strangerPairs > 0 && (
              <span title={STRANGER_PAIRS_HINT}> · {strangerPairsLabel(strangerPairs)}</span>
            )}
          </p>
        </div>
      </header>

      {!compact && (
        <ul className="mt-3 space-y-1.5">
          {clusters.map((cluster) => (
            <li key={cluster.clusterKey}>
              <ClusterChip cluster={cluster} tableNumber={table.number} />
            </li>
          ))}
          {clusters.length === 0 && (
            <li className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              Pusty stół. Przeciągnij tu paczkę albo wybierz „Przenieś do stołu…”.
            </li>
          )}
        </ul>
      )}
    </section>
  )
})
