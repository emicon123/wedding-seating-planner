import { http } from 'msw'
import type { Capacity, Guest, GuestScore, Proposal, Scenario, SeatingPlan } from '@/domain/types'
import {
  KAROLINA,
  MACIEK,
  MACIEK_FAMILY_OVERVIEW,
  MICHAL,
  OLA,
  makeGuest,
  makePlan,
  makeScenario,
  placement,
  withoutViolations,
} from '@/test/builders'
import { apiUrl, HttpResponse, list, server, single } from '@/test/server'

/** `count` tables with `fill` single guests each; ids are unique per plan. */
export function evenPlan(count: number, fill: number): SeatingPlan {
  let id = 1
  const tables = Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    clusters: Array.from({ length: fill }, () => {
      const guestId = id++
      return placement(guestId, [guestId])
    }),
  }))
  return withoutViolations(makePlan(tables))
}

export function fourScenarios(overrides: Partial<Record<Capacity, SeatingPlan>> = {}): Scenario[] {
  return [
    makeScenario(9, overrides[9] ?? evenPlan(3, 8), 4),
    makeScenario(10, overrides[10] ?? evenPlan(3, 8), 7),
    makeScenario(11, overrides[11] ?? evenPlan(2, 11), 3),
    makeScenario(12, overrides[12] ?? evenPlan(2, 12), 2),
  ]
}

export function fourProposals(): Proposal[] {
  return [
    { capacity: 9, basedOnVersion: 4, plan: evenPlan(3, 8) },
    { capacity: 10, basedOnVersion: 7, plan: evenPlan(3, 8) },
    { capacity: 11, basedOnVersion: 3, plan: evenPlan(2, 11) },
    { capacity: 12, basedOnVersion: 2, plan: evenPlan(2, 12) },
  ]
}

/** GET /scenarios served from the given plans. */
export function serveScenarios(scenarios: Scenario[]) {
  server.use(http.get(apiUrl('/scenarios'), () => HttpResponse.json(list(scenarios))))
}

// --- the plan-detail fixture: Maciek's family, Zosia and a few more around two tables ---------

export const ZOSIA = makeGuest({ id: 8, firstName: 'Zosia' })
export const BASIA = makeGuest({ id: 11, firstName: 'Basia', lastName: 'Lis' })
export const DETAIL_GUESTS: Guest[] = [MACIEK, KAROLINA, MICHAL, OLA, ZOSIA, BASIA]
export const DETAIL_OVERVIEW = MACIEK_FAMILY_OVERVIEW

function score(guestId: number, tableNumber: number | null, over: Partial<GuestScore> = {}) {
  return {
    guestId,
    tableNumber,
    satisfaction: 0,
    preferredTotal: 0,
    preferredAtTable: 0,
    fallbackAtTable: 0,
    strangersAtTable: 0,
    ...over,
  }
}

/**
 * Capacity 10. Table 1: Maciek + Karolina (paczka) and Zosia; table 2: Michał + Ola; Basia has
 * no table. Maciek prefers Michał's paczka, which sits at the other table.
 */
export function detailScenario(): Scenario {
  const plan = withoutViolations(
    makePlan(
      [
        { number: 1, clusters: [placement(4, [4, 5]), placement(8, [8])] },
        { number: 2, clusters: [placement(6, [6, 7])] },
      ],
      [placement(11, [11])],
    ),
  )
  plan.guestScores = [
    score(4, 1, { preferredTotal: 2, preferredAtTable: 0, strangersAtTable: 1 }),
    score(5, 1, { preferredTotal: 2, preferredAtTable: 0, strangersAtTable: 1 }),
    score(8, 1, { preferredTotal: 1, preferredAtTable: 1, fallbackAtTable: 2 }),
    score(6, 2),
    score(7, 2),
  ]
  return makeScenario(10, plan, 7)
}

/** GET /scenarios, /guests and /clusters for the plan-detail page. */
export function serveDetail(scenario: Scenario = detailScenario()) {
  server.use(
    http.get(apiUrl('/scenarios'), () =>
      HttpResponse.json(
        list([
          makeScenario(9, evenPlan(1, 6), 1),
          scenario,
          makeScenario(11, evenPlan(1, 6), 1),
          makeScenario(12, evenPlan(1, 6), 1),
        ]),
      ),
    ),
    http.get(apiUrl('/guests'), () => HttpResponse.json(list(DETAIL_GUESTS))),
    http.get(apiUrl('/clusters'), () => HttpResponse.json(single(DETAIL_OVERVIEW))),
  )
}
