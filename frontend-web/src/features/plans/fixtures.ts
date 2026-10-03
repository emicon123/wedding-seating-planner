import { http } from 'msw'
import type {
  Guest,
  GuestScore,
  PlanKey,
  Proposal,
  Scenario,
  ScenariosReplace,
  SeatingPlan,
} from '@/domain/types'
import {
  KAROLINA,
  MACIEK,
  MACIEK_FAMILY_OVERVIEW,
  MICHAL,
  OLA,
  fillsPlan,
  makeGuest,
  makePlan,
  makeScenario,
  placement,
  withoutViolations,
} from '@/test/builders'
import { apiUrl, failure, HttpResponse, list, mockApi, server, single } from '@/test/server'

/** `count` tables with `fill` single guests each; ids are unique per plan. */
export function evenPlan(count: number, fill: number): SeatingPlan {
  return fillsPlan(Array.from({ length: count }, () => fill))
}

/** The mixed plan of the fixtures: tables of 12, 9 and 10 guests (the contract example, task 015). */
export const mixedFixturePlan = (): SeatingPlan => fillsPlan([12, 9, 10])

export function fiveScenarios(overrides: Partial<Record<PlanKey, SeatingPlan>> = {}): Scenario[] {
  return [
    makeScenario('9', overrides['9'] ?? evenPlan(3, 8), 4),
    makeScenario('10', overrides['10'] ?? evenPlan(3, 8), 7),
    makeScenario('11', overrides['11'] ?? evenPlan(2, 11), 3),
    makeScenario('12', overrides['12'] ?? evenPlan(2, 12), 2),
    makeScenario('mixed', overrides.mixed ?? mixedFixturePlan(), 5),
  ]
}

export function fiveProposals(): Proposal[] {
  return [
    { key: '9', capacity: 9, basedOnVersion: 4, plan: evenPlan(3, 8) },
    { key: '10', capacity: 10, basedOnVersion: 7, plan: evenPlan(3, 8) },
    { key: '11', capacity: 11, basedOnVersion: 3, plan: evenPlan(2, 11) },
    { key: '12', capacity: 12, basedOnVersion: 2, plan: evenPlan(2, 12) },
    { key: 'mixed', capacity: 12, basedOnVersion: 5, plan: mixedFixturePlan() },
  ]
}

type GenerateFlow = {
  /** The stored plans before Generate (GET /scenarios answers with them). */
  before: Scenario[]
  /** What POST /scenarios/calculate computes. */
  proposals: Proposal[]
  /** Answers of the successive PUT /scenarios calls: the Generate first, then (optionally) Cofnij. */
  stored: Scenario[][]
}

/**
 * A small server that remembers: GET answers with what is stored, calculate with the proposals, and
 * every PUT /scenarios is checked like the real one (a stale basedOnVersion on any plan = 409,
 * nothing changes) before the next prepared answer becomes the stored state.
 */
export function serveGenerateFlow({ before, proposals, stored }: GenerateFlow) {
  let current = before
  const answers = [...stored]
  server.use(http.get(apiUrl('/scenarios'), () => HttpResponse.json(list(current))))
  const calculate = mockApi('post', '/scenarios/calculate', () =>
    HttpResponse.json(list(proposals)),
  )
  const put = mockApi('put', '/scenarios', (body) => {
    const { plans } = body as ScenariosReplace
    const stale = plans.some(
      (plan) =>
        current.find((scenario) => scenario.key === plan.key)?.version !== plan.basedOnVersion,
    )
    const next = answers.shift()
    if (stale || !next) {
      return HttpResponse.json(failure('version_conflict', 'version'), { status: 409 })
    }
    current = next
    return HttpResponse.json(list(current))
  })
  return { calculate, put }
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
 * Capacity 10. Table 1: Maciek + Karolina (paczka) and Zosia, who do not know each other (2 stranger
 * pairs); table 2: Michał + Ola; Basia has no table. Maciek prefers Michał's paczka, which sits at the other table.
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
    score(4, 1, { satisfaction: -1, preferredTotal: 2, preferredAtTable: 0, strangersAtTable: 1 }),
    score(5, 1, { satisfaction: -1, preferredTotal: 2, preferredAtTable: 0, strangersAtTable: 1 }),
    // strangers are symmetric: Maciek and Karolina each see Zosia, Zosia sees both of them
    score(8, 1, {
      preferredTotal: 1,
      preferredAtTable: 1,
      fallbackAtTable: 2,
      strangersAtTable: 2,
    }),
    score(6, 2),
    score(7, 2),
  ]
  return makeScenario(10, plan, 7)
}

/**
 * Task 014: the detail plan with Zosia as a child. She sits at table 1 with Maciek and Karolina
 * (both without acquaintances there) but is not scored: her `GuestScore` is all zeros, and the
 * adults' strangers count excludes her.
 */
export function detailScenarioWithChild(): Scenario {
  const base = detailScenario()
  const guestScores = base.plan.guestScores.map((entry) =>
    entry.guestId === 8
      ? score(8, 1)
      : entry.guestId === 4 || entry.guestId === 5
        ? { ...entry, strangersAtTable: 0 }
        : entry,
  )
  return { ...base, plan: { ...base.plan, guestScores } }
}

/** The detail guest list with Zosia marked as a child. */
export const detailGuestsWithChild = (): Guest[] =>
  DETAIL_GUESTS.map((guest) => (guest.id === ZOSIA.id ? { ...guest, isChild: true } : guest))

/**
 * The mixed plan in the detail fixture: table 1 has 10 guests (Maciek's paczka and eight guests
 * the guest list does not name), table 2 has Michał and Ola, table 3 is empty.
 */
export function mixedDetailPlan(): SeatingPlan {
  const others = Array.from({ length: 8 }, (_, i) => placement(20 + i, [20 + i]))
  return withoutViolations(
    makePlan([
      { number: 1, clusters: [placement(4, [4, 5]), ...others] },
      { number: 2, clusters: [placement(6, [6, 7])] },
      { number: 3, clusters: [] },
    ]),
  )
}

/** GET /scenarios, /guests and /clusters for the plan-detail page. */
export function serveDetail(
  scenario: Scenario = detailScenario(),
  mixed: Scenario = makeScenario('mixed', mixedDetailPlan(), 1),
) {
  server.use(
    http.get(apiUrl('/scenarios'), () =>
      HttpResponse.json(
        list([
          makeScenario(9, evenPlan(1, 6), 1),
          scenario,
          makeScenario(11, evenPlan(1, 6), 1),
          makeScenario(12, evenPlan(1, 6), 1),
          mixed,
        ]),
      ),
    ),
    http.get(apiUrl('/guests'), () => HttpResponse.json(list(DETAIL_GUESTS))),
    http.get(apiUrl('/clusters'), () => HttpResponse.json(single(DETAIL_OVERVIEW))),
  )
}
