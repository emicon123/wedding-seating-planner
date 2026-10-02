import { clusterOf, effectiveCompanions } from '@/domain/companions'
import type { Cluster, ClusterOverview, DataWarning, Guest, LinkLevel } from '@/domain/types'

/**
 * Why a guest comes along without being linked directly:
 * `cluster` = they sit in the group 0 of `guestId` ("przez grupę 0: X"),
 * `link` = a cluster-mate's own link brings them ("przez powiązanie: X").
 */
export type ViaReason = 'cluster' | 'link'

export type ColumnEntry = {
  guestId: number
  /** A link of this guest itself: removable here. Otherwise the entry is derived. */
  direct: boolean
  via?: { guestId: number; reason: ViaReason }
}

export type LinkColumns = Record<LinkLevel, ColumnEntry[]>

const LEVELS: LinkLevel[] = [0, 1, 2]

export function viaReason(
  companionId: number,
  viaId: number,
  overview: ClusterOverview,
): ViaReason {
  const theirCluster: Cluster | undefined = clusterOf(companionId, overview)
  return theirCluster?.guestIds.includes(viaId) ? 'cluster' : 'link'
}

/**
 * The three columns of the link editor for one guest: their own links first (removable), then
 * everyone who comes along automatically through group-0 clusters. Own links come from the guest
 * list, so they show at once; the derived part appears when the clusters overview is there.
 * Display logic only: nothing here scores a plan.
 */
export function linkColumns(
  guestId: number,
  guests: Guest[],
  overview: ClusterOverview | undefined,
): LinkColumns {
  const guest = guests.find((candidate) => candidate.id === guestId)
  const columns: LinkColumns = { 0: [], 1: [], 2: [] }
  if (!guest) return columns

  const nameOf = new Map(guests.map((candidate) => [candidate.id, candidate.displayName]))
  const byName = (a: ColumnEntry, b: ColumnEntry) =>
    (nameOf.get(a.guestId) ?? '').localeCompare(nameOf.get(b.guestId) ?? '', 'pl')
  const derived = overview ? effectiveCompanions(guestId, guests, overview) : []

  for (const level of LEVELS) {
    const direct: ColumnEntry[] = guest.links
      .filter((entry) => entry.level === level)
      .map((entry) => ({ guestId: entry.guestId, direct: true }))
    const known = new Set(direct.map((entry) => entry.guestId))
    const indirect: ColumnEntry[] = derived
      .filter((entry) => entry.level === level && !known.has(entry.guestId))
      .map((entry) => ({
        guestId: entry.guestId,
        direct: false,
        ...(entry.via === undefined
          ? {}
          : {
              via: { guestId: entry.via, reason: viaReason(entry.guestId, entry.via, overview!) },
            }),
      }))
    columns[level] = [...direct.sort(byName), ...indirect.sort(byName)]
  }
  return columns
}

/** Data warnings that involve the guest or anyone in their group-0 cluster. */
export function warningsForGuest(guestId: number, overview: ClusterOverview): DataWarning[] {
  const members = new Set(clusterOf(guestId, overview)?.guestIds ?? [guestId])
  return overview.warnings.filter((warning) => warning.guestIds.some((id) => members.has(id)))
}
