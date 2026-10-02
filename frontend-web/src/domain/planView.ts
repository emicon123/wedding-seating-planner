import type {
  Capacity,
  ClusterPlacement,
  Proposal,
  Scenario,
  SeatingPlan,
  TableLayout,
  Violation,
} from '@/domain/types'

/** The layout `PUT .../assignments` expects for a proposal: every table with its guests. */
export function toAcceptTables(plan: SeatingPlan): TableLayout[] {
  return plan.tables.map((table) => ({
    number: table.number,
    guestIds: table.clusters.flatMap((cluster) => cluster.guestIds),
  }))
}

/** A proposal is stale when the plan changed after it was generated: the server would answer 409. */
export function isProposalStale(proposal: Proposal, scenario: Scenario | undefined): boolean {
  return scenario !== undefined && scenario.version !== proposal.basedOnVersion
}

export function withoutProposal(proposals: Proposal[], capacity: Capacity): Proposal[] {
  return proposals.filter((proposal) => proposal.capacity !== capacity)
}

/** guestId -> table number (null = unseated). Guests the plan does not list are absent. */
export function guestTableMap(plan: SeatingPlan): Map<number, number | null> {
  const map = new Map<number, number | null>()
  for (const table of plan.tables) {
    for (const cluster of table.clusters) {
      for (const id of cluster.guestIds) map.set(id, table.number)
    }
  }
  for (const cluster of plan.unseated) {
    for (const id of cluster.guestIds) map.set(id, null)
  }
  return map
}

/** Stable display order: bigger paczki first (they are the hardest to place), then by name. */
export function sortPlacements(
  clusters: ClusterPlacement[],
  nameOf: (guestId: number) => string,
): ClusterPlacement[] {
  const first = (cluster: ClusterPlacement) => nameOf(cluster.guestIds[0] ?? 0)
  return [...clusters].sort(
    (a, b) =>
      b.guestIds.length - a.guestIds.length ||
      first(a).localeCompare(first(b), 'pl') ||
      a.clusterKey - b.clusterKey,
  )
}

/** Problems of one table that its fill counter cannot show (over capacity / under floor can). */
export function tableViolations(plan: SeatingPlan, tableNumber: number): Violation[] {
  return plan.violations.filter(
    (violation) =>
      violation.tableNumber === tableNumber &&
      violation.code !== 'over_capacity' &&
      violation.code !== 'under_floor',
  )
}
