import { dropPreview } from '@/domain/dropPreview'
import { makeCluster, makeOverview, makePlan, placement } from '@/test/builders'

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
    const preview = dropPreview(planWith(4), family, 2, 10, overview) // 4 + 2 + 1 + 3 = 10
    expect(preview.fillAfter).toBe(10)
    expect(preview.overCapacity).toBe(false)
  })

  it('flags over-capacity at 11/10', () => {
    const preview = dropPreview(planWith(5), family, 2, 10, overview) // 5 + 2 + 1 + 3 = 11
    expect(preview.fillAfter).toBe(11)
    expect(preview.overCapacity).toBe(true)
  })

  it('flags the source table falling under the floor of 8', () => {
    const preview = dropPreview(planWith(4), family, 2, 10, overview) // table 1: 7 - 3 = 4 < 8
    expect(preview.underFloorSource).toBe(true)
  })

  it('does not flag the source when it stays at or above the floor', () => {
    const roomy = makePlan([
      { number: 1, clusters: [family, placement(50, [50, 51, 52, 53, 54, 55, 56, 57])] }, // 11 - 3 = 8
      { number: 2, clusters: [] },
    ])
    expect(dropPreview(roomy, family, 2, 10, overview).underFloorSource).toBe(false)
  })

  it('waives the floor when the plan has a single table', () => {
    const single = makePlan([{ number: 1, clusters: [family] }], [])
    expect(dropPreview(single, family, null, 10, overview).underFloorSource).toBe(false)
  })

  it('counts preferred (group 1) companions already at the target table, not fallback ones', () => {
    expect(dropPreview(planWith(4), family, 2, 10, overview).preferredHere).toBe(2)
    expect(dropPreview(planWith(4), family, 1, 10, overview).preferredHere).toBe(0)
  })

  it('dropping on the table it already sits at changes nothing', () => {
    const preview = dropPreview(planWith(4), family, 1, 10, overview)
    expect(preview.fillAfter).toBe(7)
    expect(preview.overCapacity).toBe(false)
    expect(preview.underFloorSource).toBe(false)
  })

  it('moving from the tray: nothing to fall under the floor', () => {
    const fromTray = makePlan([{ number: 1, clusters: [] }], [family])
    const preview = dropPreview(fromTray, family, 1, 10, overview)
    expect(preview).toEqual({
      fillAfter: 3,
      overCapacity: false,
      underFloorSource: false,
      preferredHere: 0,
    })
  })

  it('dropping on the tray has no target fill', () => {
    const preview = dropPreview(planWith(4), family, null, 10, overview)
    expect(preview.fillAfter).toBe(0)
    expect(preview.overCapacity).toBe(false)
    expect(preview.preferredHere).toBe(0)
    expect(preview.underFloorSource).toBe(true)
  })
})
