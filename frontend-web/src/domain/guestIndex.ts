import type { Guest } from '@/domain/types'

export type GuestIndex = {
  byId: ReadonlyMap<number, Guest>
  /**
   * Case- and diacritics-insensitive search over display names ("michal" finds "Michał").
   * Every word of the query must occur in the name; word starts rank before inner matches, ties
   * keep the list order. A blank query returns the whole list (it is also the "no filter" case).
   */
  search(query: string): Guest[]
}

/** Lower-case, strip combining marks (ą→a) and fold ł (which has no decomposition) to l. */
export function normalizeText(text: string): string {
  return text
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replaceAll('ł', 'l')
    .trim()
}

type Entry = { guest: Guest; words: string[]; name: string }

function rank(entry: Entry, tokens: string[]): number | null {
  if (!tokens.every((token) => entry.name.includes(token))) return null
  const everyTokenStartsAWord = tokens.every((token) =>
    entry.words.some((word) => word.startsWith(token)),
  )
  return everyTokenStartsAWord ? 0 : 1
}

export function buildGuestIndex(guests: Guest[]): GuestIndex {
  const entries: Entry[] = guests.map((guest) => {
    const name = normalizeText(guest.displayName)
    return { guest, name, words: name.split(/\s+/) }
  })

  return {
    byId: new Map(guests.map((guest) => [guest.id, guest])),
    search(query) {
      const tokens = normalizeText(query).split(/\s+/).filter(Boolean)
      if (tokens.length === 0) return [...guests]

      return entries
        .map((entry, position) => ({ entry, position, rank: rank(entry, tokens) }))
        .filter((hit) => hit.rank !== null)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.position - b.position)
        .map((hit) => hit.entry.guest)
    },
  }
}
