// Contract-shaped test data builders (types come from the generated schema, so a contract
// change breaks the tests at compile time). Shared by domain, hook and component tests.
import type {
  Capacity,
  Cluster,
  ClusterOverview,
  ClusterPlacement,
  Guest,
  GuestLinkRef,
  Scenario,
  SeatingPlan,
} from '@/domain/types'

type GuestInput = Partial<Guest> & Pick<Guest, 'id' | 'firstName'>

export function makeGuest(input: GuestInput): Guest {
  const lastName = input.lastName ?? null
  return {
    notes: '',
    isChild: false,
    enabled: true,
    version: 1,
    links: [],
    createdAt: '2026-10-02T09:15:00Z',
    updatedAt: '2026-10-02T09:15:00Z',
    ...input,
    lastName,
    displayName: lastName ? `${input.firstName} ${lastName}` : input.firstName,
  }
}

export function link(guestId: number, level: GuestLinkRef['level']): GuestLinkRef {
  return { guestId, level }
}

export function makeCluster(input: Partial<Cluster> & Pick<Cluster, 'key' | 'guestIds'>): Cluster {
  return {
    enabledGuestIds: input.guestIds,
    seatedSize: (input.enabledGuestIds ?? input.guestIds).length,
    affinities: [],
    ...input,
  }
}

export function makeOverview(clusters: Cluster[]): ClusterOverview {
  return { clusters, warnings: [] }
}

export function placement(
  clusterKey: number,
  guestIds: number[],
  pinned = false,
): ClusterPlacement {
  return { clusterKey, guestIds, pinned }
}

type TableInput = { number: number; clusters: ClusterPlacement[] }

/** A plan with fills and counts derived from the placements (scores and violations are fixed fakes). */
export function makePlan(tables: TableInput[], unseated: ClusterPlacement[] = []): SeatingPlan {
  const size = (clusters: ClusterPlacement[]) =>
    clusters.reduce((sum, cluster) => sum + cluster.guestIds.length, 0)
  const seatedCount = tables.reduce((sum, table) => sum + size(table.clusters), 0)
  return {
    summary: {
      tableCount: tables.length,
      seatedCount,
      unseatedCount: size(unseated),
      score: 42.5,
      violationCount: 1,
      needsRecalculation: true,
    },
    tables: tables.map((table) => ({ ...table, fill: size(table.clusters), score: 7.5 })),
    unseated,
    guestScores: [],
    violations: [
      {
        code: 'unseated_guests',
        message: 'Some guests have no table.',
        tableNumber: null,
        guestIds: [],
      },
    ],
  }
}

export function makeScenario(capacity: Capacity, plan: SeatingPlan, version = 1): Scenario {
  return { capacity, version, plan }
}

/** The Maciek / Michał / Ola fixture from the contract examples (003-sequences flow 4). */
export const MACIEK = makeGuest({ id: 4, firstName: 'Maciek', links: [link(5, 0), link(6, 1)] })
export const KAROLINA = makeGuest({
  id: 5,
  firstName: 'Karolina',
  lastName: 'Nowak',
  links: [link(4, 0)],
})
export const MICHAL = makeGuest({ id: 6, firstName: 'Michał', links: [link(7, 0), link(4, 1)] })
export const OLA = makeGuest({ id: 7, firstName: 'Ola', links: [link(6, 0)] })

export const MACIEK_FAMILY_GUESTS: Guest[] = [MACIEK, KAROLINA, MICHAL, OLA]

export const MACIEK_FAMILY_OVERVIEW: ClusterOverview = makeOverview([
  makeCluster({ key: 4, guestIds: [4, 5], affinities: [{ clusterKey: 6, level: 1 }] }),
  makeCluster({ key: 6, guestIds: [6, 7], affinities: [{ clusterKey: 4, level: 1 }] }),
])

/** The same plan without violations: what the server returns for a plan that follows every rule. */
export function withoutViolations(plan: SeatingPlan): SeatingPlan {
  return {
    ...plan,
    violations: [],
    summary: { ...plan.summary, violationCount: 0, needsRecalculation: false },
  }
}
