import type { PlanKey, Scenario } from '@/domain/types'

export type { PlanKey }

/** What decides a table's size and its seat count: the plan's key and its capacity (12 for mixed). */
export type PlanKind = Pick<Scenario, 'key' | 'capacity'>

/** The five permanent plans, always shown in this order (the only list of plans, DRY). */
export const PLAN_KEYS: readonly PlanKey[] = ['9', '10', '11', '12', 'mixed']

export const MIXED_KEY: PlanKey = 'mixed'

export const isMixed = (scenario: Pick<Scenario, 'key'>): boolean => scenario.key === MIXED_KEY

/** Hard lower bound for a table (glossary "Floor"): 8 guests in the uniform plans, 9 in the mixed one. */
export const FLOOR = 8
export const MIXED_FLOOR = 9

/** The one place the floor is decided: it belongs to the plan kind, so callers pass the plan, not a number. */
export const minTableFill = (scenario: Pick<Scenario, 'key'>): number =>
  isMixed(scenario) ? MIXED_FLOOR : FLOOR

/** Parses a route parameter ("10", "mixed") into a PlanKey; null when it is not one of the five. */
export function parsePlanKey(raw: string | undefined): PlanKey | null {
  return PLAN_KEYS.find((key) => key === raw) ?? null
}

/**
 * Task 006: the 8-seat plan was converted to the 9-seat plan. A bookmark or link that still says 8
 * means "the smallest plan", so it is sent to 9 instead of to the overview.
 */
const RETIRED_KEY = '8'
export const REPLACEMENT_FOR_RETIRED: PlanKey = '9'

export function isRetiredPlanKey(raw: string | undefined): boolean {
  return raw === RETIRED_KEY
}

/** Short name for cards, the switcher and lists: "10 miejsc", "Mieszany". */
export function planName(key: PlanKey): string {
  return key === MIXED_KEY ? 'Mieszany' : `${key} miejsc`
}

/** Name inside a sentence (dialogs, toasts, aria): "plan na 10 miejsc", "plan mieszany". */
export function planTitle(key: PlanKey): string {
  return key === MIXED_KEY ? 'plan mieszany' : `plan na ${key} miejsc`
}

/** The same name as a heading or an accessible name: "Plan na 10 miejsc", "Plan mieszany". */
export function planHeading(key: PlanKey): string {
  const title = planTitle(key)
  return `${title.charAt(0).toLocaleUpperCase('pl')}${title.slice(1)}`
}
