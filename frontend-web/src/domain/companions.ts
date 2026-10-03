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

/**
 * Default guest-list order: whole group-0 clusters together. A cluster sorts by its
 * alphabetically first member (Polish collation), members inside by name; guests the
 * overview does not know behave as clusters of one. Search hits and the "related to …"
 * view keep their own ranking — the caller applies this only to the plain list.
 */
export function sortByCluster(guests: Guest[], overview: ClusterOverview | undefined): Guest[] {
  if (!overview) return guests
  const names = new Map(guests.map((guest) => [guest.id, guest.displayName]))
  const firstOf = new Map<number, string>()
  for (const cluster of overview.clusters) {
    const first =
      cluster.guestIds.map((id) => names.get(id) ?? '').sort((a, b) => polish.compare(a, b))[0] ??
      ''
    for (const id of cluster.guestIds) firstOf.set(id, first)
  }
  return [...guests].sort(
    (a, b) =>
      polish.compare(firstOf.get(a.id) ?? a.displayName, firstOf.get(b.id) ?? b.displayName) ||
      polish.compare(a.displayName, b.displayName) ||
      a.id - b.id,
  )
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
