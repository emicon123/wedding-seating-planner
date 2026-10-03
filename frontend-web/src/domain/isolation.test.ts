import { describe, expect, it } from 'vitest'
import { isIsolated, isolatedCount } from '@/domain/isolation'
import type { GuestScore } from '@/domain/types'

function score(guestId: number, satisfaction: number): GuestScore {
  return {
    guestId,
    tableNumber: 1,
    satisfaction,
    preferredTotal: 0,
    preferredAtTable: 0,
    fallbackAtTable: 0,
    strangersAtTable: 0,
  }
}

describe('isIsolated', () => {
  it('is true for a negative satisfaction', () => {
    expect(isIsolated(score(1, -1))).toBe(true)
    expect(isIsolated(score(1, -0.5))).toBe(true)
  })

  it('is false for zero (no partners, or unseated) and for positive satisfaction', () => {
    expect(isIsolated(score(1, 0))).toBe(false)
    expect(isIsolated(score(1, 0.5))).toBe(false)
    expect(isIsolated(score(1, 2.5))).toBe(false)
  })
})

describe('isolatedCount', () => {
  it('counts the isolated guests of a plan', () => {
    expect(isolatedCount([score(1, -1), score(2, 0), score(3, -1), score(4, 3.5)])).toBe(2)
  })

  it('is 0 for an empty list', () => {
    expect(isolatedCount([])).toBe(0)
  })

  it('ignores a child: its all-zero score is never isolated, even at a table of strangers', () => {
    const child = { ...score(9, 0), strangersAtTable: 6 }

    expect(isIsolated(child)).toBe(false)
    expect(isolatedCount([score(1, -1), child, score(3, -1)])).toBe(2)
  })
})
