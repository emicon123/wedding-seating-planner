import { dropPreview } from '@/domain/dropPreview'
import type { PlanKind } from '@/domain/plans'
import { makeCluster, makeOverview, makePlan, placement } from '@/test/builders'

const PLAN_10: PlanKind = { key: '10', capacity: 10 }
const MIXED: PlanKind = { key: 'mixed', capacity: 12 }
const PLAN_12: PlanKind = { key: '12', capacity: 12 }

const family = placement(4, [4, 5, 6]) // 3 seats, sits at table 1
const friends = placement(20, [20, 21]) // liked (group 1) by the family
const acquaintances = placement(30, [30]) // group 2: not "preferred"
const overview = makeOverview([
  makeCluster({
    key: 4,
    guestIds: [4, 5, 6],
    affinities: [
      { clusterKey: 20, level: 1 },
      { clusterKey: 30, level: 2 },
    ],
  }),
  makeCluster({ key: 20, guestIds: [20, 21] }),
  makeCluster({ key: 30, guestIds: [30] }),
])

function planWith(table2Guests: number) {
  const filler = Array.from({ length: table2Guests }, (_, i) => 100 + i)
  return makePlan(
    [
      { number: 1, clusters: [family, placement(50, [50, 51, 52, 53])] }, // 7 at table 1
      { number: 2, clusters: [placement(60, filler), friends, acquaintances] },
    ],
    [],
  )
}

describe('dropPreview', () => {
  it('reports the fill after the drop and no warning when it fits', () => {
    const preview = dropPreview(planWith(4), family, 2, PLAN_10, overview) // 4 + 2 + 1 + 3 = 10
    expect(preview.fillAfter).toBe(10)
    expect(preview.overCapacity).toBe(false)
  })

  it('flags over-capacity at 11/10', () => {
    const preview = dropPreview(planWith(5), family, 2, PLAN_10, overview) // 5 + 2 + 1 + 3 = 11
    expect(preview.fillAfter).toBe(11)
    expect(preview.overCapacity).toBe(true)
  })

  it('flags the source table falling under the floor of 8', () => {
    const preview = dropPreview(planWith(4), family, 2, PLAN_10, overview) // table 1: 7 - 3 = 4 < 8
    expect(preview.underFloorSource).toBe(true)
  })

  it('does not flag the source when it stays at or above the floor', () => {
    const roomy = makePlan([
      { number: 1, clusters: [family, placement(50, [50, 51, 52, 53, 54, 55, 56, 57])] }, // 11 - 3 = 8
      { number: 2, clusters: [] },
    ])
    expect(dropPreview(roomy, family, 2, PLAN_10, overview).underFloorSource).toBe(false)
  })

  it('waives the floor when the plan has a single table', () => {
    const single = makePlan([{ number: 1, clusters: [family] }], [])
    expect(dropPreview(single, family, null, PLAN_10, overview).underFloorSource).toBe(false)
  })

  it('counts preferred (group 1) companions already at the target table, not fallback ones', () => {
    expect(dropPreview(planWith(4), family, 2, PLAN_10, overview).preferredHere).toBe(2)
    expect(dropPreview(planWith(4), family, 1, PLAN_10, overview).preferredHere).toBe(0)
  })

  it('dropping on the table it already sits at changes nothing', () => {
    const preview = dropPreview(planWith(4), family, 1, PLAN_10, overview)
    expect(preview.fillAfter).toBe(7)
    expect(preview.overCapacity).toBe(false)
    expect(preview.underFloorSource).toBe(false)
  })

  it('moving from the tray: nothing to fall under the floor', () => {
    const fromTray = makePlan([{ number: 1, clusters: [] }], [family])
    const preview = dropPreview(fromTray, family, 1, PLAN_10, overview)
    expect(preview).toEqual({
      fillAfter: 3,
      overCapacity: false,
      underFloorSource: false,
      preferredHere: 0,
    })
  })

  it('dropping on the tray has no target fill', () => {
    const preview = dropPreview(planWith(4), family, null, PLAN_10, overview)
    expect(preview.fillAfter).toBe(0)
    expect(preview.overCapacity).toBe(false)
    expect(preview.preferredHere).toBe(0)
    expect(preview.underFloorSource).toBe(true)
  })

  describe('the floor follows the plan kind (task 015: 9 in the mixed plan)', () => {
    const cluster = placement(70, [70, 71])
    // table 1: 10 guests (the cluster of 2 + 8 singles), table 2 elsewhere
    const roomy = makePlan([
      {
        number: 1,
        clusters: [cluster, ...Array.from({ length: 8 }, (_, i) => placement(80 + i, [80 + i]))],
      },
      { number: 2, clusters: [] },
    ])

    it('leaving a table of 10 with a cluster of 2 breaks the mixed floor (8 < 9)', () => {
      expect(dropPreview(roomy, cluster, 2, MIXED, overview).underFloorSource).toBe(true)
    })

    it('the same move in plan 12 is fine (8 is enough there)', () => {
      expect(dropPreview(roomy, cluster, 2, PLAN_12, overview).underFloorSource).toBe(false)
    })

    it('capacity comes from the kind as well', () => {
      expect(dropPreview(roomy, cluster, 1, MIXED, overview).overCapacity).toBe(false)
    })
  })
})
