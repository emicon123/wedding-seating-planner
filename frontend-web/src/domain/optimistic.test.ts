import { applyMove } from '@/domain/optimistic'
import { makePlan, placement } from '@/test/builders'

const maciek = placement(4, [4, 5])
const michal = placement(6, [6, 7], true)
const zosia = placement(8, [8])
const plan = makePlan(
  [
    { number: 1, clusters: [maciek, placement(10, [10, 11, 12])] },
    { number: 2, clusters: [michal] },
  ],
  [zosia],
)

describe('applyMove', () => {
  it('moves a placement to another table and recomputes fills', () => {
    const moved = applyMove(plan, maciek, 2)

    expect(moved.tables.map((table) => [table.number, table.fill])).toEqual([
      [1, 3],
      [2, 4],
    ])
    expect(moved.tables[1]?.clusters.map((cluster) => cluster.clusterKey)).toEqual([6, 4])
    expect(moved.tables[0]?.clusters.map((cluster) => cluster.clusterKey)).toEqual([10])
    expect(moved.summary.seatedCount).toBe(plan.summary.seatedCount)
  })

  it('seats an unseated cluster and updates the seated / unseated counts', () => {
    const moved = applyMove(plan, zosia, 1)

    expect(moved.unseated).toEqual([])
    expect(moved.tables[0]?.fill).toBe(6)
    expect(moved.summary.seatedCount).toBe(plan.summary.seatedCount + 1)
    expect(moved.summary.unseatedCount).toBe(0)
  })

  it('moves a cluster back to the unseated tray', () => {
    const moved = applyMove(plan, michal, null)

    expect(moved.tables[1]?.fill).toBe(0)
    expect(moved.unseated.map((cluster) => cluster.clusterKey)).toEqual([8, 6])
    expect(moved.summary.unseatedCount).toBe(3)
    expect(moved.summary.seatedCount).toBe(plan.summary.seatedCount - 2)
  })

  it('takes the pin from the given placement, so pinning in place updates the chip', () => {
    const moved = applyMove(plan, { ...maciek, pinned: true }, 1)
    expect(moved.tables[0]?.clusters.find((c) => c.clusterKey === 4)?.pinned).toBe(true)
    expect(moved.tables[0]?.fill).toBe(plan.tables[0]?.fill)
  })

  it('never touches scores, violations or the recalculation flag (those come from the server)', () => {
    const moved = applyMove(plan, maciek, 2)

    expect(moved.summary.score).toBe(plan.summary.score)
    expect(moved.summary.violationCount).toBe(plan.summary.violationCount)
    expect(moved.summary.needsRecalculation).toBe(plan.summary.needsRecalculation)
    expect(moved.violations).toBe(plan.violations)
    expect(moved.guestScores).toBe(plan.guestScores)
    expect(moved.tables.map((table) => table.score)).toEqual(
      plan.tables.map((table) => table.score),
    )
  })

  it('does not mutate the input and keeps untouched tables by reference', () => {
    const before = structuredClone(plan)
    const moved = applyMove(plan, zosia, 2)

    expect(plan).toEqual(before)
    expect(moved.tables[0]).toBe(plan.tables[0])
  })

  it('leaves the plan as it is when the target table does not exist', () => {
    expect(applyMove(plan, maciek, 99)).toBe(plan)
  })
})
