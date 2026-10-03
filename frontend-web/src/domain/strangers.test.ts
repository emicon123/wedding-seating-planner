import { bilans, STRANGER_PENALTY, strangerPairs, tableStrangerPairs } from '@/domain/strangers'
import type { GuestScore } from '@/domain/types'
import { makePlan } from '@/test/builders'

const score = (
  guestId: number,
  tableNumber: number | null,
  strangersAtTable: number,
): GuestScore => ({
  guestId,
  tableNumber,
  satisfaction: 0,
  preferredTotal: 0,
  preferredAtTable: 0,
  fallbackAtTable: 0,
  strangersAtTable,
})

// Table 1: A[2 adults] + B[1 adult] strangers: each A adult sees 1 stranger, B sees 2 -> 2 pairs.
// A child of A (id 4) adds a zero. Table 2: C and D, strangers: 1 pair.
const SCORES: GuestScore[] = [
  score(1, 1, 1),
  score(2, 1, 1),
  score(3, 1, 2),
  score(4, 1, 0),
  score(5, 2, 1),
  score(6, 2, 1),
  score(7, null, 0),
]

describe('strangerPairs', () => {
  it('is zero for no scores', () => {
    expect(strangerPairs([])).toBe(0)
  })

  it('counts every pair once although both of its adults see it', () => {
    expect(tableStrangerPairs(SCORES, 1)).toBe(2)
    expect(tableStrangerPairs(SCORES, 2)).toBe(1)
    expect(strangerPairs(SCORES)).toBe(3)
  })

  it('ignores children (their entries are all zeros) and unseated guests', () => {
    expect(strangerPairs([score(4, 1, 0), score(7, null, 0)])).toBe(0)
  })

  it('a table without scores has no pairs', () => {
    expect(tableStrangerPairs(SCORES, 9)).toBe(0)
  })
})

describe('bilans', () => {
  const planWith = (planScore: number, guestScores: GuestScore[]) => {
    const plan = makePlan([])
    return { summary: { ...plan.summary, score: planScore }, guestScores }
  }

  it('is the score minus 2 per stranger pair', () => {
    expect(STRANGER_PENALTY).toBe(1)
    expect(bilans(planWith(64, SCORES))).toBe(58)
  })

  it('equals the score when nobody is a stranger', () => {
    expect(bilans(planWith(64, []))).toBe(64)
  })

  it('can be negative', () => {
    expect(bilans(planWith(2, SCORES))).toBe(-4)
  })
})
