import type { Capacity, ClusterOverview, ClusterPlacement, SeatingPlan } from '@/domain/types'

/** Hard lower bound for every table (glossary "Floor"), waived when a plan needs just one table. */
export const MIN_TABLE_FILL = 6

export type DropPreview = {
  /** Seats taken at the target table if dropped now (0 for the tray). */
  fillAfter: number
  overCapacity: boolean
  /** The table the cluster leaves would fall below the floor. */
  underFloorSource: boolean
  /** Guests already at the target table whom this cluster prefers (group 1 only). */
  preferredHere: number
}

const seats = (cluster: ClusterPlacement) => cluster.guestIds.length

/**
 * What a drop would look like, shown while hovering a table (state machine §3). A display hint
 * only: counts, never scores. Whether the plan really breaks a rule is the server's call.
 */
export function dropPreview(
  plan: SeatingPlan,
  cluster: ClusterPlacement,
  toTable: number | null,
  capacity: Capacity,
  overview: ClusterOverview,
): DropPreview {
  const source = plan.tables.find((table) =>
    table.clusters.some((c) => c.clusterKey === cluster.clusterKey),
  )
  const target =
    toTable === null ? undefined : plan.tables.find((table) => table.number === toTable)

  const leavesSource = source !== undefined && source.number !== toTable
  const underFloorSource =
    leavesSource && plan.tables.length > 1 && source.fill - seats(cluster) < MIN_TABLE_FILL

  if (!target) return { fillAfter: 0, overCapacity: false, underFloorSource, preferredHere: 0 }

  const alreadyThere = source?.number === target.number
  const fillAfter = alreadyThere ? target.fill : target.fill + seats(cluster)

  const liked = new Set(
    (overview.clusters.find((c) => c.key === cluster.clusterKey)?.affinities ?? [])
      .filter((affinity) => affinity.level === 1)
      .map((affinity) => affinity.clusterKey),
  )
  const preferredHere = target.clusters
    .filter((c) => liked.has(c.clusterKey))
    .reduce((sum, c) => sum + seats(c), 0)

  return { fillAfter, overCapacity: fillAfter > capacity, underFloorSource, preferredHere }
}
