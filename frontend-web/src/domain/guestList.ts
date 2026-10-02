import type { Guest } from '@/domain/types'

export type GuestCounts = { total: number; enabled: number; children: number }

export function guestCounts(guests: Guest[]): GuestCounts {
  return {
    total: guests.length,
    enabled: guests.filter((guest) => guest.enabled).length,
    children: guests.filter((guest) => guest.isChild).length,
  }
}

/** Optimistic view of a toggle: only the listed guests change, the rest keep their identity. */
export function applyEnabled(guests: Guest[], guestIds: number[], enabled: boolean): Guest[] {
  const ids = new Set(guestIds)
  return guests.map((guest) => (ids.has(guest.id) ? { ...guest, enabled } : guest))
}

/** Adds (or replaces) a guest, keeping the list ordered by display name like the server does. */
export function insertGuest(guests: Guest[], added: Guest): Guest[] {
  return [...guests.filter((guest) => guest.id !== added.id), added].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'pl'),
  )
}

/** The contract's link key: the pair as `{smallerId}-{largerId}`. */
export function linkKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`
}
