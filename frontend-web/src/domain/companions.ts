import type { Cluster, ClusterOverview, Guest, LinkLevel } from '@/domain/types'

export type Companion = {
  guestId: number
  level: LinkLevel
  /** Present when the guest is not linked directly: the guest through whom they come along. */
  via?: number
}

export function clusterOf(guestId: number, overview: ClusterOverview): Cluster | undefined {
  return overview.clusters.find((cluster) => cluster.guestIds.includes(guestId))
}

const polish = new Intl.Collator('pl')

/** A group-0 cluster as the plain guest list sees it: only its visible members count. */
type Unit = {
  key: number
  /** The Polish-collated first visible member's name. */
  name: string
  members: Guest[]
}

function byName(a: Guest, b: Guest): number {
  return polish.compare(a.displayName, b.displayName) || a.id - b.id
}

function byUnit(a: Unit, b: Unit): number {
  return polish.compare(a.name, b.name) || a.key - b.key
}

/** Visible guests grouped by cluster; one the overview does not know is a unit of one. */
function unitsOf(guests: Guest[], overview: ClusterOverview): Map<number, Unit> {
  const clusterKeyOf = new Map<number, number>()
  for (const cluster of overview.clusters) {
    for (const id of cluster.guestIds) clusterKeyOf.set(id, cluster.key)
  }
  const grouped = new Map<number, Guest[]>()
  for (const guest of guests) {
    const key = clusterKeyOf.get(guest.id) ?? guest.id
    grouped.set(key, [...(grouped.get(key) ?? []), guest])
  }
  const units = new Map<number, Unit>()
  for (const [key, members] of grouped) {
    const sorted = members.sort(byName)
    const [first] = sorted
    if (first) units.set(key, { key, name: first.displayName, members: sorted })
  }
  return units
}

/** Level-1 partners among the visible units, read from both sides; level 2 is not used. */
function partnerGraph(units: Map<number, Unit>, overview: ClusterOverview): Map<number, Unit[]> {
  const partners = new Map<number, Set<Unit>>([...units.keys()].map((key) => [key, new Set()]))
  for (const cluster of overview.clusters) {
    const from = units.get(cluster.key)
    if (!from) continue
    for (const { clusterKey, level } of cluster.affinities) {
      const to = units.get(clusterKey)
      if (level !== 1 || !to || to === from) continue
      partners.get(from.key)?.add(to)
      partners.get(to.key)?.add(from)
    }
  }
  return new Map([...partners].map(([key, set]) => [key, [...set].sort(byUnit)]))
}

/**
 * Default guest-list order (003-frontend-design §11): group 0 first, group 1 second. A unit is a
 * group-0 cluster with a visible member (a guest the overview does not know is a unit of one);
 * its members stay together, ordered by name. Units joined by level-1 affinity form a block: a
 * depth-first walk from the block's alphabetically first unit, always continuing with the
 * first not-yet-placed partner. Blocks and loners are ordered by their first unit's name
 * (Polish collation, ties by key), taken from visible members only. Level 2 is not used.
 * Search hits and the "related to …" view keep their own ranking — the caller applies this
 * only to the plain list. Pure and deterministic; returns a new array.
 */
export function sortByCluster(guests: Guest[], overview: ClusterOverview | undefined): Guest[] {
  if (!overview) return guests
  const units = unitsOf(guests, overview)
  const partners = partnerGraph(units, overview)

  const placed = new Set<number>()
  const result: Guest[] = []
  for (const root of [...units.values()].sort(byUnit)) {
    const stack = [root]
    for (let unit = stack.pop(); unit; unit = stack.pop()) {
      if (placed.has(unit.key)) continue
      placed.add(unit.key)
      result.push(...unit.members)
      const next = (partners.get(unit.key) ?? []).filter(({ key }) => !placed.has(key))
      stack.push(...next.reverse())
    }
  }
  return result
}

function directLinks(guest: Guest | undefined, level: LinkLevel): number[] {
  return (guest?.links ?? []).filter((link) => link.level === level).map((link) => link.guestId)
}

function companion(guestId: number, level: LinkLevel, via?: number): Companion {
  return via === undefined ? { guestId, level } : { guestId, level, via }
}

/** Group 0: the rest of the guest's cluster, each reached directly or through a first hop. */
function clusterMates(
  guest: Guest,
  byId: ReadonlyMap<number, Guest>,
  cluster: Cluster,
): Companion[] {
  const direct = directLinks(guest, 0).sort((a, b) => a - b)
  const firstHop = new Map<number, number | undefined>(direct.map((id) => [id, undefined]))
  const queue = [...direct]
  for (const current of queue) {
    for (const next of directLinks(byId.get(current), 0)) {
      if (next === guest.id || firstHop.has(next)) continue
      firstHop.set(next, firstHop.get(current) ?? current)
      queue.push(next)
    }
  }
  return cluster.guestIds
    .filter((id) => id !== guest.id)
    .map((id) => companion(id, 0, firstHop.get(id)))
}

/** The affine cluster's members the guest links to directly at this level. */
function linksInto(guest: Guest | undefined, target: Cluster, level: LinkLevel): number[] {
  return directLinks(guest, level)
    .filter((id) => target.guestIds.includes(id))
    .sort((a, b) => a - b)
}

/** Group 1/2: every member of each affine cluster, with who they come along through. */
function affineClusters(
  guest: Guest,
  byId: ReadonlyMap<number, Guest>,
  overview: ClusterOverview,
  own: Cluster,
): Companion[] {
  return own.affinities.flatMap(({ clusterKey, level }) => {
    const target = overview.clusters.find((cluster) => cluster.key === clusterKey)
    if (!target) return []

    const direct = linksInto(guest, target, level)
    // No direct link: the affinity comes from a cluster-mate's link, so they are credited.
    const anchor =
      direct[0] ??
      own.guestIds
        .filter((id) => id !== guest.id && linksInto(byId.get(id), target, level).length > 0)
        .sort((a, b) => a - b)[0]

    return target.guestIds.map((id) =>
      companion(id, level, direct.includes(id) ? undefined : anchor),
    )
  })
}

/**
 * Everyone who "comes along" with a guest, as the editor shows it: the group-0 mates of their
 * cluster, plus every member of each cluster they have group 1/2 affinity with (the server owns
 * the affinities, 003-frontend-design §2). Display logic only: nothing here scores a plan.
 * Ordered by level, then directly linked before reached through someone, then by id.
 */
export function effectiveCompanions(
  guestId: number,
  guests: Guest[],
  overview: ClusterOverview,
): Companion[] {
  const byId = new Map(guests.map((guest) => [guest.id, guest]))
  const guest = byId.get(guestId)
  const own = clusterOf(guestId, overview)
  if (!guest || !own) return []

  const found = [...clusterMates(guest, byId, own), ...affineClusters(guest, byId, overview, own)]
  return found.sort(
    (a, b) =>
      a.level - b.level ||
      Number(a.via !== undefined) - Number(b.via !== undefined) ||
      a.guestId - b.guestId,
  )
}
