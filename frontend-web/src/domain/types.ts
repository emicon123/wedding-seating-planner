// Named aliases over the generated contract types (src/api/schema.d.ts, never hand-edited).
// `domain/` and `api/` import contract types from here, so the generated file has one consumer.
import type { components } from '@/api/schema'

type Schemas = components['schemas']

export type Capacity = Schemas['Capacity']
export type PlanKey = Schemas['PlanKey']
export type LinkLevel = Schemas['LinkLevel']
export type Guest = Schemas['Guest']
export type GuestLinkRef = Schemas['GuestLinkRef']
export type Cluster = Schemas['Cluster']
export type ClusterOverview = Schemas['ClusterOverview']
export type DataWarning = Schemas['DataWarning']
export type ClusterPlacement = Schemas['ClusterPlacement']
export type PlanTable = Schemas['PlanTable']
export type SeatingPlan = Schemas['SeatingPlan']
export type PlanSummary = Schemas['PlanSummary']
export type Scenario = Schemas['Scenario']
export type Proposal = Schemas['Proposal']
export type Violation = Schemas['Violation']
export type GuestScore = Schemas['GuestScore']
export type Session = Schemas['Session']
export type ErrorCode = Schemas['ErrorCode']
export type ErrorItem = Schemas['ErrorItem']
export type TableLayout = Schemas['TableLayout']
export type GuestCreate = Schemas['GuestCreate']
export type GuestUpdate = Schemas['GuestUpdate']
export type GuestBulkToggle = Schemas['GuestBulkToggle']
export type AssignmentSet = Schemas['AssignmentSet']
export type ScenarioLayout = Schemas['ScenarioLayout']
export type ScenariosReplace = Schemas['ScenariosReplace']

/**
 * The one-slot undo snapshot of the last Generate (task 007): the five plans as they were before it,
 * and the version each plan has right after it (what Cofnij must find unchanged).
 */
export type GenerateUndo = {
  previous: Scenario[]
  generatedVersions: Record<PlanKey, number>
}
