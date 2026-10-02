import { clusterOf } from '@/domain/companions'
import { linkColumns, type ColumnEntry } from '@/domain/linkColumns'
import type { ClusterOverview, Guest, LinkLevel } from '@/domain/types'

/**
 * "Who is connected to this person?" (003-frontend-design §5), derived from the guest list and the
 * server's clusters overview: nothing here scores a plan or invents a link. Built on `linkColumns`
 * (direct links + who comes along through group-0 clusters), then grouped into families.
 */

export type Relation = ColumnEntry

/** People who belong together: one group-0 cluster ("paczka"). A lone person is a family of one. */
export type Family = { key: string; members: Relation[] }

export type RelationBlock = {
  level: LinkLevel
  families: Family[]
  personCount: number
  familyCount: number
}

export type Relations = {
  blocks: Record<LinkLevel, RelationBlock>
  /** Distinct people related at any level. */
  total: number
}

const LEVELS: LinkLevel[] = [0, 1, 2]
const polish = new Intl.Collator('pl')

function familiesOf(
  entries: ColumnEntry[],
  overview: ClusterOverview | undefined,
  nameOf: (guestId: number) => string,
): Family[] {
  const byKey = new Map<string, Relation[]>()
  for (const entry of entries) {
    const cluster = overview ? clusterOf(entry.guestId, overview) : undefined
    const key = cluster ? `c${cluster.key}` : `g${entry.guestId}`
    byKey.set(key, [...(byKey.get(key) ?? []), entry])
  }
  return [...byKey]
    .map(([key, members]) => ({ key, members }))
    .sort((a, b) => polish.compare(nameOf(a.members[0]!.guestId), nameOf(b.members[0]!.guestId)))
}

export function relationsOf(
  guestId: number,
  guests: Guest[],
  overview: ClusterOverview | undefined,
): Relations {
  const columns = linkColumns(guestId, guests, overview)
  const names = new Map(guests.map((guest) => [guest.id, guest.displayName]))
  const nameOf = (id: number) => names.get(id) ?? ''

  const blocks = Object.fromEntries(
    LEVELS.map((level) => {
      const families = familiesOf(columns[level], overview, nameOf)
      const block: RelationBlock = {
        level,
        families,
        personCount: columns[level].length,
        familyCount: families.length,
      }
      return [level, block]
    }),
  ) as Record<LinkLevel, RelationBlock>

  const distinct = new Set(LEVELS.flatMap((level) => columns[level].map((entry) => entry.guestId)))
  return { blocks, total: distinct.size }
}

/** What a guest-list row shows at a glance: group-0 partner names, counts and names per level. */
export type RelationSummary = {
  partners: string[]
  counts: Record<LinkLevel, number>
  names: Record<LinkLevel, string[]>
}

export function summariseRelations(
  guests: Guest[],
  overview: ClusterOverview | undefined,
): Map<number, RelationSummary> {
  const names = new Map(guests.map((guest) => [guest.id, guest.displayName]))
  const nameList = (entries: ColumnEntry[]) =>
    entries.map((entry) => names.get(entry.guestId) ?? `Gość ${entry.guestId}`)

  return new Map(
    guests.map((guest) => {
      const columns = linkColumns(guest.id, guests, overview)
      const listed = { 0: nameList(columns[0]), 1: nameList(columns[1]), 2: nameList(columns[2]) }
      const summary: RelationSummary = {
        partners: listed[0],
        counts: { 0: listed[0].length, 1: listed[1].length, 2: listed[2].length },
        names: listed,
      }
      return [guest.id, summary]
    }),
  )
}

/** The person (`level: null`), then everyone related to them by level, for the "related to …" filter. */
export type RelatedGuest = { guestId: number; level: LinkLevel | null }

export function relatedTo(
  guestId: number,
  guests: Guest[],
  overview: ClusterOverview | undefined,
): RelatedGuest[] {
  const columns = linkColumns(guestId, guests, overview)
  const seen = new Set([guestId])
  const related: RelatedGuest[] = [{ guestId, level: null }]
  for (const level of LEVELS) {
    for (const entry of columns[level]) {
      if (seen.has(entry.guestId)) continue
      seen.add(entry.guestId)
      related.push({ guestId: entry.guestId, level })
    }
  }
  return related
}
