import type { Guest } from '@/domain/types'

export type ParsedName = { firstName: string; lastName: string | null }

/** "Imię Nazwisko" as typed into the quick-add bar: the first word is the first name, the rest the surname. */
export function parseGuestName(input: string): ParsedName | null {
  const [firstName, ...rest] = input.trim().split(/\s+/).filter(Boolean)
  if (firstName === undefined) return null
  return { firstName, lastName: rest.length > 0 ? rest.join(' ') : null }
}

const nameKey = (name: string) => name.trim().split(/\s+/).join(' ').toLocaleLowerCase('pl')

/** True when a guest already has exactly this display name (the server's uniqueness rule). */
export function hasGuestNamed(guests: Guest[], name: string): boolean {
  const key = nameKey(name)
  return guests.some((guest) => nameKey(guest.displayName) === key)
}
