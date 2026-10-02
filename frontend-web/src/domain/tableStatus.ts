import { MIN_TABLE_FILL } from '@/domain/dropPreview'

export type FillStatus = 'ok' | 'over' | 'under'

/**
 * How a table's seat count reads against the hard rules (glossary "Capacity", "Floor"): shown
 * live from the counts, so a move is judged the moment it is made. Whether it also counts as
 * a violation is the server's call.
 */
export function fillStatus(fill: number, capacity: number, tableCount: number): FillStatus {
  if (fill > capacity) return 'over'
  if (tableCount > 1 && fill < MIN_TABLE_FILL) return 'under'
  return 'ok'
}
