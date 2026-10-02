import { effectiveCompanions } from '@/domain/companions'
import { viaReason, type ViaReason } from '@/domain/linkColumns'
import { guestTableMap } from '@/domain/planView'
import type { ClusterOverview, Guest, GuestScore, LinkLevel, SeatingPlan } from '@/domain/types'

/** Where someone is in this plan: a table number, in the tray, or switched off (not in the plan). */
export type Place = number | 'unseated' | 'disabled'

export type CompanionRow = {
  guest: Guest
  level: LinkLevel
  /** The guest through whom this one comes along (not linked directly). */
  via?: Guest
  /** Why `via` brings them along: their group 0, or a cluster-mate's own link. */
  viaReason?: ViaReason
  place: Place
  sameTable: boolean
}

export type GuestDetails = {
  guest: Guest
  table: Place
  /** Straight from the server's evaluation; absent for a guest it did not score. */
  score?: GuestScore
  companions: CompanionRow[]
}

/** A guest's place in the plan: disabled guests are not in it at all. */
export function placeOf(guest: Guest, tables: ReadonlyMap<number, number | null>): Place {
  if (!guest.enabled) return 'disabled'
  return tables.get(guest.id) ?? 'unseated'
}

/**
 * What the details panel shows for one guest (UC-14, UC-16): their table, the server's
 * satisfaction numbers and where each companion sits. Reads the plan, never scores it.
 */
export function guestDetails(
  guestId: number,
  plan: SeatingPlan,
  guests: Guest[],
  overview: ClusterOverview,
): GuestDetails | undefined {
  const byId = new Map(guests.map((guest) => [guest.id, guest]))
  const guest = byId.get(guestId)
  if (!guest) return undefined

  const tables = guestTableMap(plan)
  const table = placeOf(guest, tables)

  const companions = effectiveCompanions(guestId, guests, overview).flatMap((entry) => {
    const person = byId.get(entry.guestId)
    if (!person) return []
    const place = placeOf(person, tables)
    return [
      {
        guest: person,
        level: entry.level,
        via: entry.via === undefined ? undefined : byId.get(entry.via),
        viaReason:
          entry.via === undefined ? undefined : viaReason(entry.guestId, entry.via, overview),
        place,
        sameTable: typeof place === 'number' && place === table,
      },
    ]
  })

  return {
    guest,
    table,
    score: plan.guestScores.find((candidate) => candidate.guestId === guestId),
    companions,
  }
}
