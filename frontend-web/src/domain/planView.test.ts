import { fillStatus } from '@/domain/tableStatus'
import { CAPACITIES } from '@/domain/capacity'
import {
  canUndoGenerate,
  guestTableMap,
  sortPlacements,
  tableViolations,
  toScenariosReplace,
  toTableLayouts,
  versionsOf,
} from '@/domain/planView'
import type { Capacity, GenerateUndo, Scenario, Violation } from '@/domain/types'
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

describe('toTableLayouts', () => {
  it('lists every table with the guests of all its clusters and those of its pinned clusters', () => {
    const plan = makePlan([
      { number: 1, clusters: [placement(4, [4, 5], true), placement(6, [6])] },
      { number: 2, clusters: [placement(8, [8, 9], true)] },
      { number: 3, clusters: [] },
    ])

    expect(toTableLayouts(plan)).toEqual([
      { number: 1, guestIds: [4, 5, 6], pinnedGuestIds: [4, 5] },
      { number: 2, guestIds: [8, 9], pinnedGuestIds: [8, 9] },
      { number: 3, guestIds: [], pinnedGuestIds: [] },
    ])
  })

  it('ignores the unseated tray: those guests are simply not listed', () => {
    const plan = makePlan([{ number: 1, clusters: [placement(4, [4])] }], [placement(9, [9, 10])])
    expect(toTableLayouts(plan)).toEqual([{ number: 1, guestIds: [4], pinnedGuestIds: [] }])
  })
})

describe('toScenariosReplace', () => {
  it('builds one layout per plan with its own basedOnVersion', () => {
    const plan = makePlan([{ number: 1, clusters: [placement(4, [4], true)] }])

    expect(
      toScenariosReplace([
        { capacity: 9, basedOnVersion: 3, plan },
        { capacity: 12, basedOnVersion: 5, plan: makePlan([]) },
      ]),
    ).toEqual({
      plans: [
        {
          capacity: 9,
          basedOnVersion: 3,
          tables: [{ number: 1, guestIds: [4], pinnedGuestIds: [4] }],
        },
        { capacity: 12, basedOnVersion: 5, tables: [] },
      ],
    })
  })
})

describe('versionsOf', () => {
  it('maps each capacity to its version, whatever the order', () => {
    const plan = makePlan([])
    const scenarios = [12, 9, 11, 10].map((c, i) => makeScenario(c as Capacity, plan, i + 1))
    expect(versionsOf(scenarios)).toEqual({ 9: 2, 10: 4, 11: 3, 12: 1 })
  })

  it('throws when a plan is missing', () => {
    expect(() => versionsOf([makeScenario(9, makePlan([]), 1)])).toThrow()
  })
})

describe('canUndoGenerate', () => {
  const plan = makePlan([])
  const scenarios = (versions: [number, number, number, number]): Scenario[] =>
    CAPACITIES.map((capacity, i) => makeScenario(capacity, plan, versions[i] ?? 0))
  const undo: GenerateUndo = {
    previous: scenarios([1, 1, 1, 1]),
    generatedVersions: { 9: 2, 10: 2, 11: 3, 12: 2 },
  }

  it('is true while every plan still has the version Generate produced', () => {
    expect(canUndoGenerate(undo, scenarios([2, 2, 3, 2]))).toBe(true)
  })

  it('is false as soon as one plan moved on (a move, pin, table change, delete, other Generate)', () => {
    expect(canUndoGenerate(undo, scenarios([2, 3, 3, 2]))).toBe(false)
  })

  it('is false without a snapshot or without loaded plans', () => {
    expect(canUndoGenerate(undefined, scenarios([2, 2, 3, 2]))).toBe(false)
    expect(canUndoGenerate(undo, undefined)).toBe(false)
    expect(canUndoGenerate(undo, [])).toBe(false)
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
