import type { GuestScore } from '@/domain/types'

/**
 * "Bez znajomych przy stole" (task 011): a seated guest who has group 1/2 partners but none at
 * their table. The contract has no flag for it: the server's satisfaction is negative if and only
 * if the guest is isolated (the penalty is subtracted, and without it satisfaction is never
 * below zero), so the test does not depend on the penalty's value.
 */
export const isIsolated = (score: GuestScore): boolean => score.satisfaction < 0

export const isolatedCount = (scores: readonly GuestScore[]): number =>
  scores.filter(isIsolated).length
