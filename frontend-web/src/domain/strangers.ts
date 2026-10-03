import type { GuestScore, SeatingPlan } from '@/domain/types'

/**
 * Stranger pairs (task 015, glossary "Stranger pair"): two adults at one table whose families do
 * not know each other. The server sends no such number; every adult carries `strangersAtTable`
 * (children are all zeros), and each pair is seen from both its ends, so half the sum is exact.
 */
export const strangerPairs = (scores: readonly GuestScore[]): number =>
  scores.reduce((sum, score) => sum + score.strangersAtTable, 0) / 2

/** The same for one table. */
export const tableStrangerPairs = (scores: readonly GuestScore[], tableNumber: number): number =>
  strangerPairs(scores.filter((score) => score.tableNumber === tableNumber))

/** λ: what a stranger pair costs each of its two adults. Mirrors the server's `seating.StrangerPenalty`. */
export const STRANGER_PENALTY = 1

/** Net satisfaction of a plan: the score minus 2·λ per stranger pair (what the mixed plan maximises). */
export const bilans = (plan: Pick<SeatingPlan, 'summary' | 'guestScores'>): number =>
  plan.summary.score - 2 * STRANGER_PENALTY * strangerPairs(plan.guestScores)
