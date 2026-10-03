import { useMemo } from 'react'
import { tableViolations } from '@/domain/planView'
import { tableStrangerPairs } from '@/domain/strangers'
import type { SeatingPlan } from '@/domain/types'
import { TableCard, type DropHint } from '@/features/plans/TableCard'
import { cn } from '@/lib/utils'

type FloorPlanProps = {
  plan: SeatingPlan
  /** The table that contains the selected guest. */
  highlightedTable: number | null
  /** Hovered table while dragging, with its drop preview. */
  hoveredTable: number | null
  hint: DropHint | null
  dragging: boolean
  /** Server numbers (scores, violations) are stale while a save is in flight. */
  settled: boolean
  compact: boolean
}

/**
 * The hall: a grid of tables, each drawn as a round table with its guests. A table card
 * re-renders only when its own data changes (not on every pointer move while dragging).
 */
export function FloorPlan({
  plan,
  highlightedTable,
  hoveredTable,
  hint,
  dragging,
  settled,
  compact,
}: FloorPlanProps) {
  const violationsByTable = useMemo(
    () => new Map(plan.tables.map((table) => [table.number, tableViolations(plan, table.number)])),
    [plan],
  )
  const pairsByTable = useMemo(
    () =>
      new Map(
        plan.tables.map((table) => [
          table.number,
          tableStrangerPairs(plan.guestScores, table.number),
        ]),
      ),
    [plan],
  )

  return (
    <section
      aria-label="Sala"
      className="rounded-2xl border border-dashed border-ink/30 bg-paper-deep/50 p-3"
    >
      <ul
        className={cn(
          'grid gap-3',
          compact
            ? 'grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]'
            : 'grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]',
        )}
      >
        {plan.tables.map((table) => (
          <li key={table.number} className="min-w-0">
            <TableCard
              table={table}
              tableCount={plan.tables.length}
              violations={settled ? (violationsByTable.get(table.number) ?? NONE) : NONE}
              score={settled ? table.score : null}
              strangerPairs={settled ? (pairsByTable.get(table.number) ?? 0) : null}
              highlighted={highlightedTable === table.number}
              hint={hoveredTable === table.number ? hint : null}
              dragging={dragging}
              compact={compact}
            />
          </li>
        ))}
      </ul>
      {plan.tables.length === 0 && (
        <p className="p-6 text-center text-muted-foreground">
          Ten plan nie ma jeszcze stołów. Dodaj stół albo wygeneruj plany.
        </p>
      )}
    </section>
  )
}

const NONE: never[] = []
