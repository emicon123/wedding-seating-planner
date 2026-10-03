import { isMixed, type PlanKind } from '@/domain/plans'
import type { Scenario } from '@/domain/types'

export const TABLE_SIZES = [9, 10, 11, 12] as const
export type TableSize = (typeof TABLE_SIZES)[number]

const LARGEST_SIZE: TableSize = 12

/**
 * Seats the venue must provide at a table with this fill (glossary "Table size"): a uniform plan
 * always uses its capacity; in the mixed plan it is the smallest of 9..12 that fits the guests
 * (12 above 12, where the server also reports over_capacity). null = an empty table, not needed.
 */
export function tableSize(fill: number, kind: PlanKind): TableSize | null {
  if (fill <= 0) return null
  if (!isMixed(kind)) return kind.capacity
  return TABLE_SIZES.find((size) => size >= fill) ?? LARGEST_SIZE
}

/** Tables the venue must provide, largest size first; sizes nobody needs are left out. */
export type TablesNeeded = { size: TableSize; count: number }[]

export function tablesNeeded(scenario: Pick<Scenario, 'key' | 'capacity' | 'plan'>): TablesNeeded {
  const counts = new Map<TableSize, number>()
  for (const table of scenario.plan.tables) {
    const size = tableSize(table.fill, scenario)
    if (size !== null) counts.set(size, (counts.get(size) ?? 0) + 1)
  }
  return [...TABLE_SIZES]
    .reverse()
    .filter((size) => counts.has(size))
    .map((size) => ({ size, count: counts.get(size) ?? 0 }))
}

/** "5 × 12, 3 × 11, 1 × 9"; "brak" when no table is needed. */
export function tablesNeededLabel(needed: TablesNeeded): string {
  if (needed.length === 0) return 'brak'
  return needed.map(({ size, count }) => `${count} × ${size}`).join(', ')
}

export const seatsTotal = (needed: TablesNeeded): number =>
  needed.reduce((total, { size, count }) => total + size * count, 0)

/**
 * The size shown in a drop hint: only a mixed-plan table changes size with its fill, so
 * `undefined` (= no size in the hint) for a uniform plan, null when the table would be empty.
 */
export const sizeAfterDrop = (fillAfter: number, kind: PlanKind): TableSize | null | undefined =>
  isMixed(kind) ? tableSize(fillAfter, kind) : undefined
