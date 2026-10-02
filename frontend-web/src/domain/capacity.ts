import type { Capacity } from '@/domain/types'

export type { Capacity }

/** The three permanent plans, always shown in this order. */
export const CAPACITIES: readonly Capacity[] = [8, 10, 12]

/** Parses a route parameter ("10") into a Capacity; null when it is not one of 8 / 10 / 12. */
export function parseCapacity(raw: string | undefined): Capacity | null {
  return CAPACITIES.find((capacity) => String(capacity) === raw) ?? null
}
