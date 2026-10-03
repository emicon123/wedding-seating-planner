import { TableGlyph } from '@/components/TableGlyph'
import { pluralPl } from '@/domain/labels'
import { seatsTotal, tablesNeeded, type TableSize } from '@/domain/tableSizes'
import type { Scenario } from '@/domain/types'

type TablesNeededLineProps = {
  scenario: Pick<Scenario, 'key' | 'capacity' | 'plan'>
}

function SizeGroup({ size, count }: { size: TableSize; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle font-medium whitespace-nowrap">
      <TableGlyph seats={size} className="size-5 text-ink" />
      {count} × {size}
    </span>
  )
}

/**
 * "Potrzebne stoły: 5 × 12, 3 × 11, 1 × 9 (102 miejsca)": what the venue must provide, with a tiny
 * table of the right size before each group, so the five plans can be compared at a glance.
 * Hidden while the plan has no non-empty table.
 */
export function TablesNeededLine({ scenario }: TablesNeededLineProps) {
  const needed = tablesNeeded(scenario)
  if (needed.length === 0) return null
  const seats = pluralPl(seatsTotal(needed), 'miejsce', 'miejsca', 'miejsc')
  return (
    <p className="text-sm leading-7 text-muted-foreground">
      Potrzebne stoły:{' '}
      {needed.map(({ size, count }, index) => (
        <span key={size}>
          {index > 0 && ', '}
          <SizeGroup size={size} count={count} />
        </span>
      ))}{' '}
      ({seats})
    </p>
  )
}
