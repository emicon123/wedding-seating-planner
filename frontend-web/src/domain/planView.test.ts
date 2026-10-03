import { fillStatus } from '@/domain/tableStatus'
import {
  guestTableMap,
  isProposalStale,
  sortPlacements,
  tableViolations,
  toAcceptTables,
  withoutProposal,
} from '@/domain/planView'
import type { Proposal, Violation } from '@/domain/types'
import { makePlan, makeScenario, placement } from '@/test/builders'

describe('fillStatus', () => {
  it.each([
    [10, 10, 3, 'ok'],
    [11, 10, 3, 'over'],
    [8, 10, 3, 'ok'],
    [7, 10, 3, 'under'],
    [0, 10, 3, 'under'],
    [5, 10, 1, 'ok'], // the floor is waived when the plan needs a single table
  ] as const)('fill %i of %i with %i tables is %s', (fill, capacity, tables, expected) => {
    expect(fillStatus(fill, capacity, tables)).toBe(expected)
  })
})

describe('toAcceptTables', () => {
  it('lists every table with the guests of all its clusters, ready for PUT .../assignments', () => {
    const plan = makePlan([
      { number: 1, clusters: [placement(4, [4, 5]), placement(6, [6])] },
      { number: 2, clusters: [] },
    ])

    expect(toAcceptTables(plan)).toEqual([
      { number: 1, guestIds: [4, 5, 6] },
      { number: 2, guestIds: [] },
    ])
  })
})

describe('proposals vs. the stored plan', () => {
  const proposal = (capacity: 9 | 10 | 11 | 12, basedOnVersion: number): Proposal => ({
    capacity,
    basedOnVersion,
    plan: makePlan([]),
  })

  it('is stale once the plan moved on after Generate', () => {
    const plan = makeScenario(10, makePlan([]), 8)
    expect(isProposalStale(proposal(10, 7), plan)).toBe(true)
    expect(isProposalStale(proposal(10, 8), plan)).toBe(false)
    expect(isProposalStale(proposal(10, 8), undefined)).toBe(false)
  })

  it('removes one proposal and keeps the others', () => {
    const all = [proposal(9, 1), proposal(10, 1), proposal(11, 1), proposal(12, 1)]
    expect(withoutProposal(all, 10).map((p) => p.capacity)).toEqual([9, 11, 12])
  })
})

describe('guestTableMap', () => {
  it('maps every listed guest to its table, unseated guests to null', () => {
    const plan = makePlan([{ number: 2, clusters: [placement(4, [4, 5])] }], [placement(9, [9])])
    const map = guestTableMap(plan)
    expect([map.get(4), map.get(5), map.get(9), map.get(77)]).toEqual([2, 2, null, undefined])
  })
})

describe('sortPlacements', () => {
  it('puts bigger clusters first, then sorts by the first member name (Polish collation)', () => {
    const names: Record<number, string> = { 1: 'Zosia', 2: 'Łukasz', 3: 'Adam', 4: 'Ola', 5: 'Ewa' }
    const sorted = sortPlacements(
      [placement(1, [1]), placement(2, [2]), placement(3, [3]), placement(4, [4, 5])],
      (id) => names[id] ?? '',
    )
    expect(sorted.map((c) => c.clusterKey)).toEqual([4, 3, 2, 1])
  })
})

describe('tableViolations', () => {
  const violation = (code: Violation['code'], tableNumber: number | null): Violation => ({
    code,
    message: 'x',
    tableNumber,
    guestIds: [],
  })

  it('keeps only table-specific problems that fill counters cannot show', () => {
    const plan = {
      ...makePlan([]),
      violations: [
        violation('over_capacity', 3),
        violation('under_floor', 3),
        violation('cluster_split', 3),
        violation('cluster_split', 4),
        violation('unseated_guests', null),
      ],
    }
    expect(tableViolations(plan, 3).map((v) => v.code)).toEqual(['cluster_split'])
  })
})
