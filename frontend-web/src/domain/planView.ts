import { CAPACITIES } from '@/domain/capacity'
import type {
  Capacity,
  ClusterPlacement,
  GenerateUndo,
  Scenario,
  ScenariosReplace,
  SeatingPlan,
  TableLayout,
  Violation,
} from '@/domain/types'

/** What `PUT /scenarios` stores for a plan: every table with its guests and its pinned guests. */
export function toTableLayouts(plan: SeatingPlan): TableLayout[] {
  return plan.tables.map((table) => ({
    number: table.number,
    guestIds: table.clusters.flatMap((cluster) => cluster.guestIds),
    pinnedGuestIds: table.clusters
      .filter((cluster) => cluster.pinned)
      .flatMap((cluster) => cluster.guestIds),
  }))
}

type PlanToStore = { capacity: Capacity; basedOnVersion: number; plan: SeatingPlan }

/** The body of `PUT /scenarios`: all four plans, each replacing the stored version it names. */
export function toScenariosReplace(plans: PlanToStore[]): ScenariosReplace {
  return {
    plans: plans.map(({ capacity, basedOnVersion, plan }) => ({
      capacity,
      basedOnVersion,
      tables: toTableLayouts(plan),
    })),
  }
}

/** The version of each plan, by capacity. Throws when a plan is missing (the API always sends four). */
export function versionsOf(scenarios: Scenario[]): Record<Capacity, number> {
  const versions = {} as Record<Capacity, number>
  for (const capacity of CAPACITIES) {
    const scenario = scenarios.find((candidate) => candidate.capacity === capacity)
    if (!scenario) throw new Error(`Brak planu na ${capacity} miejsc`)
    versions[capacity] = scenario.version
  }
  return versions
}

/**
 * Cofnij is offered only while every plan still has the version the last Generate produced: any
 * move, pin, table change, delete or other Generate (here or on another device) moves a version on.
 */
export function canUndoGenerate(
  undo: GenerateUndo | undefined,
  scenarios: Scenario[] | undefined,
): boolean {
  if (!undo || !scenarios || scenarios.length === 0) return false
  return (
    scenarios.length === CAPACITIES.length &&
    scenarios.every((scenario) => scenario.version === undo.generatedVersions[scenario.capacity])
  )
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
