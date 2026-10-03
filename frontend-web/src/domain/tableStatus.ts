export type FillStatus = 'ok' | 'over' | 'under'

/**
 * How a table's seat count reads against the hard rules (glossary "Capacity", "Floor"): shown
 * live from the counts, so a move is judged the moment it is made. `floor` is the plan's
 * (`minTableFill`: 8, or 9 in the mixed plan). Whether it also counts as a violation is the
 * server's call.
 */
export function fillStatus(
  fill: number,
  capacity: number,
  tableCount: number,
  floor: number,
): FillStatus {
  if (fill > capacity) return 'over'
  if (tableCount > 1 && fill < floor) return 'under'
  return 'ok'
}
