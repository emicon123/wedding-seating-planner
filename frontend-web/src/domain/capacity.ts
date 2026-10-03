import type { Capacity } from '@/domain/types'

export type { Capacity }

/** The four permanent plans, always shown in this order. */
export const CAPACITIES: readonly Capacity[] = [9, 10, 11, 12]

/** Parses a route parameter ("10") into a Capacity; null when it is not one of 9 / 10 / 11 / 12. */
export function parseCapacity(raw: string | undefined): Capacity | null {
  return CAPACITIES.find((capacity) => String(capacity) === raw) ?? null
}

/**
 * Task 006: the 8-seat plan was converted to the 9-seat plan. A bookmark or link that still says 8
 * means "the smallest plan", so it is sent to 9 instead of to the overview.
 */
const RETIRED_CAPACITY = '8'
export const REPLACEMENT_FOR_RETIRED: Capacity = 9

export function isRetiredCapacity(raw: string | undefined): boolean {
  return raw === RETIRED_CAPACITY
}
