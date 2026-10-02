import type { ClusterPlacement, PlanTable, SeatingPlan } from '@/domain/types'

const seats = (clusters: ClusterPlacement[]) =>
  clusters.reduce((sum, cluster) => sum + cluster.guestIds.length, 0)

function withoutCluster(clusters: ClusterPlacement[], clusterKey: number): ClusterPlacement[] {
  return clusters.filter((cluster) => cluster.clusterKey !== clusterKey)
}

function updateTable(
  table: PlanTable,
  cluster: ClusterPlacement,
  toTable: number | null,
): PlanTable {
  const here = table.number === toTable
  const present = table.clusters.some((c) => c.clusterKey === cluster.clusterKey)
  if (!here && !present) return table // untouched tables keep their identity (cheap re-renders)

  const clusters = here
    ? present
      ? table.clusters.map((c) => (c.clusterKey === cluster.clusterKey ? cluster : c))
      : [...table.clusters, cluster]
    : withoutCluster(table.clusters, cluster.clusterKey)
  return { ...table, clusters, fill: seats(clusters) }
}

/**
 * Optimistic view of a drag & drop move: places `cluster` at `toTable` (null = the unseated tray)
 * and recomputes fills and seated / unseated counts. Scores, violations and the
 * needs-recalculation flag are deliberately left alone: they only ever come from the server.
 * A move to a table that does not exist returns the plan unchanged.
 */
export function applyMove(
  plan: SeatingPlan,
  cluster: ClusterPlacement,
  toTable: number | null,
): SeatingPlan {
  if (toTable !== null && !plan.tables.some((table) => table.number === toTable)) return plan

  const tables = plan.tables.map((table) => updateTable(table, cluster, toTable))
  const rest = withoutCluster(plan.unseated, cluster.clusterKey)
  // the server drops the pin together with the table (DELETE .../assignments)
  const unseated = toTable === null ? [...rest, { ...cluster, pinned: false }] : rest

  return {
    ...plan,
    tables,
    unseated,
    summary: {
      ...plan.summary,
      seatedCount: tables.reduce((sum, table) => sum + table.fill, 0),
      unseatedCount: seats(unseated),
    },
  }
}

/** The cluster placement (seated or unseated) that contains the guest, if the plan lists them. */
export function findPlacement(plan: SeatingPlan, guestId: number): ClusterPlacement | undefined {
  return [...plan.tables.flatMap((table) => table.clusters), ...plan.unseated].find((cluster) =>
    cluster.guestIds.includes(guestId),
  )
}
