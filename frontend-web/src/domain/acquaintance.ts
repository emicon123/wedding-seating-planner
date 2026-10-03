import { FLOOR } from '@/domain/plans'
import type { ClusterOverview, Guest } from '@/domain/types'

/**
 * The missing-links report (task 015, glossary "Missing-links report"): per family, how many
 * people they know and how big the largest group is in which everybody knows everybody (an
 * "acquainted group", a clique of the *known* relation over clusters). Derived from the guest
 * list and the clusters overview; nothing here talks to the server.
 */

/** reach < 8 | 8..11 | >= 12: below the table floor, up to a smaller table only, enough for any table. */
export type ReachStatus = 'none' | 'partial' | 'ok'

/** The largest table of any plan: a group this big needs no more acquaintances. */
export const FULL_TABLE = 12

export type FamilyReach = {
  clusterKey: number
  /** Enabled members, Polish-collated by display name. */
  memberIds: number[]
  /** Seats the family takes (enabled members, children included: the floor counts seats). */
  seats: number
  /** Seats - 1 + seats of every cluster the family has a group-1/2 link with. */
  knownPeople: number
  /** Seats of the largest acquainted group containing the family (the family included). */
  reach: number
  /** The other clusters of that group, by name. */
  groupKeys: number[]
  /** The first member of each of `groupKeys` (for display), same order. */
  groupGuestIds: number[]
  status: ReachStatus
}

const polish = new Intl.Collator('pl')

export const reachStatus = (reach: number): ReachStatus =>
  reach < FLOOR ? 'none' : reach < FULL_TABLE ? 'partial' : 'ok'

type Group = { keys: number[]; weight: number }

/** Lexicographic order of two ascending key lists: the tie-break between equally heavy groups. */
function keysBefore(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0)
  }
  return a.length < b.length
}

/**
 * Heaviest clique containing each node, exact: a maximum-weight clique through v lies inside some
 * maximal clique, so it is enough to enumerate the maximal ones (Bron-Kerbosch with pivot) and
 * keep the heaviest per member. `adjacent[i]` are the neighbours of node i; nodes are indices in
 * ascending key order.
 */
function heaviestCliquePerNode(
  keys: readonly number[],
  weights: readonly number[],
  adjacent: readonly ReadonlySet<number>[],
): Group[] {
  const best: (Group | undefined)[] = keys.map(() => undefined)

  const record = (clique: readonly number[]) => {
    const ordered = [...clique].sort((a, b) => a - b)
    const group: Group = {
      keys: ordered.map((node) => keys[node] ?? 0),
      weight: ordered.reduce((sum, node) => sum + (weights[node] ?? 0), 0),
    }
    for (const node of ordered) {
      const current = best[node]
      if (
        !current ||
        group.weight > current.weight ||
        (group.weight === current.weight && keysBefore(group.keys, current.keys))
      ) {
        best[node] = group
      }
    }
  }

  const search = (r: number[], p: Set<number>, x: Set<number>) => {
    if (p.size === 0) {
      if (x.size === 0) record(r)
      return
    }
    // pivot: the vertex of P u X with the most neighbours in P (any pivot finds the same maximal cliques)
    let pivot = -1
    let pivotReach = -1
    for (const candidates of [p, x]) {
      for (const u of candidates) {
        let reach = 0
        for (const v of adjacent[u] ?? []) if (p.has(v)) reach++
        if (reach > pivotReach) {
          pivot = u
          pivotReach = reach
        }
      }
    }
    const skipped = adjacent[pivot] ?? new Set<number>()
    for (const v of [...p]) {
      if (skipped.has(v)) continue
      const neighbours = adjacent[v] ?? new Set<number>()
      search(
        [...r, v],
        new Set([...p].filter((u) => neighbours.has(u))),
        new Set([...x].filter((u) => neighbours.has(u))),
      )
      p.delete(v)
      x.add(v)
    }
  }

  search([], new Set(keys.keys()), new Set())
  return best.map((group, node) => group ?? { keys: [keys[node] ?? 0], weight: weights[node] ?? 0 })
}

/**
 * One entry per cluster with at least one enabled ADULT, worst first: reach ascending, then
 * known people, then family name (Polish collation), then key. A cluster of children only is a
 * node of the graph (it has seats and links) but never a row; it joins a group only through its
 * own links (glossary A-23). A cluster the overview does not know yet is ignored.
 */
export function familyReach(guests: readonly Guest[], overview: ClusterOverview): FamilyReach[] {
  const guestById = new Map(guests.map((guest) => [guest.id, guest]))
  const nodes = overview.clusters
    .filter((cluster) => cluster.seatedSize > 0)
    .sort((a, b) => a.key - b.key)
  const keys = nodes.map((cluster) => cluster.key)
  const weights = nodes.map((cluster) => cluster.seatedSize)
  const nodeOfKey = new Map(keys.map((key, node) => [key, node]))

  // an edge from either side counts; self and unknown keys are ignored
  const adjacent = nodes.map(() => new Set<number>())
  nodes.forEach((cluster, node) => {
    for (const { clusterKey } of cluster.affinities) {
      const other = nodeOfKey.get(clusterKey)
      if (other === undefined || other === node) continue
      adjacent[node]?.add(other)
      adjacent[other]?.add(node)
    }
  })

  const groups = heaviestCliquePerNode(keys, weights, adjacent)

  const enabledMembers = nodes.map((cluster) =>
    cluster.enabledGuestIds
      .map((id) => guestById.get(id))
      .filter((guest): guest is Guest => guest !== undefined && guest.enabled)
      .sort((a, b) => polish.compare(a.displayName, b.displayName) || a.id - b.id),
  )
  const membersOf = (clusterKey: number): Guest[] =>
    enabledMembers[nodeOfKey.get(clusterKey) ?? -1] ?? []
  const nameOfCluster = (clusterKey: number): string => membersOf(clusterKey)[0]?.displayName ?? ''
  const byClusterName = (a: number, b: number) =>
    polish.compare(nameOfCluster(a), nameOfCluster(b)) || a - b

  const rows: FamilyReach[] = []
  nodes.forEach((cluster, node) => {
    const enabled = enabledMembers[node] ?? []
    if (!enabled.some((guest) => !guest.isChild)) return
    const group = groups[node]
    if (!group) return
    const neighbourSeats = [...(adjacent[node] ?? [])].reduce(
      (sum, other) => sum + (weights[other] ?? 0),
      0,
    )
    const groupKeys = group.keys.filter((key) => key !== cluster.key).sort(byClusterName)
    rows.push({
      clusterKey: cluster.key,
      memberIds: enabled.map((guest) => guest.id),
      seats: cluster.seatedSize,
      knownPeople: cluster.seatedSize - 1 + neighbourSeats,
      reach: group.weight,
      groupKeys,
      groupGuestIds: groupKeys.flatMap((key) =>
        membersOf(key)
          .slice(0, 1)
          .map((guest) => guest.id),
      ),
      status: reachStatus(group.weight),
    })
  })

  const name = (row: FamilyReach) => guestById.get(row.memberIds[0] ?? -1)?.displayName ?? ''
  return rows.sort(
    (a, b) =>
      a.reach - b.reach ||
      a.knownPeople - b.knownPeople ||
      polish.compare(name(a), name(b)) ||
      a.clusterKey - b.clusterKey,
  )
}
