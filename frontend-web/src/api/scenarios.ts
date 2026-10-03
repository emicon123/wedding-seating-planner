import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { client, unwrap } from '@/api/client'
import { ApiError } from '@/api/errors'
import { keys } from '@/api/keys'
import { applyMove, findPlacement } from '@/domain/optimistic'
import { toScenariosReplace, versionsOf } from '@/domain/planView'
import type { GenerateUndo, PlanKey, Proposal, Scenario, ScenariosReplace } from '@/domain/types'

type PlanArg = { key: PlanKey }

export function useScenarios() {
  return useQuery({
    queryKey: keys.scenarios,
    queryFn: async (): Promise<Scenario[]> => (await unwrap(client.GET('/scenarios'))).data,
  })
}

function replaceScenario(queryClient: QueryClient, scenario: Scenario): void {
  queryClient.setQueryData<Scenario[]>(keys.scenarios, (current) =>
    current?.map((existing) => (existing.key === scenario.key ? scenario : existing)),
  )
}

// --- Generate and Cofnij (task 007): the plans are stored at once; the undo snapshot is transient ---

/** Lets every "Generuj" button know that one of them is running (`useIsMutating`). */
export const GENERATE_MUTATION_KEY = ['generatePlans'] as const

const isConflict = (error: unknown): boolean => error instanceof ApiError && error.status === 409

/** 409 (a plan changed) or 422 (a guest is gone): the stored plans are not what the snapshot expects. */
const refusesStaleSnapshot = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 409 || error.status === 422)

async function putScenarios(body: ScenariosReplace): Promise<Scenario[]> {
  return (await unwrap(client.PUT('/scenarios', { body }))).data
}

/**
 * "Generuj plany": read the five plans fresh (= the undo snapshot), compute the five proposals, and
 * store them in one atomic PUT that names the snapshot's versions, so what is overwritten is exactly
 * the snapshot. Nothing is stored on any error. Toasts are the caller's job.
 */
export function useGeneratePlans() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: GENERATE_MUTATION_KEY,
    mutationFn: async (): Promise<{ stored: Scenario[]; undo: GenerateUndo }> => {
      const snapshot = await queryClient.fetchQuery({
        queryKey: keys.scenarios,
        queryFn: async (): Promise<Scenario[]> => (await unwrap(client.GET('/scenarios'))).data,
        staleTime: 0,
      })
      const versions = versionsOf(snapshot)
      const proposals: Proposal[] = (await unwrap(client.POST('/scenarios/calculate'))).data
      const stored = await putScenarios(
        toScenariosReplace(
          proposals.map(({ key, plan }) => ({ key, basedOnVersion: versions[key], plan })),
        ),
      )
      return { stored, undo: { previous: snapshot, generatedVersions: versionsOf(stored) } }
    },
    onSuccess: ({ stored, undo }) => {
      queryClient.setQueryData(keys.scenarios, stored)
      queryClient.setQueryData(keys.generateUndo, undo)
    },
    onError: (error) => {
      // someone changed a plan meanwhile: show what is stored now
      if (isConflict(error)) void queryClient.invalidateQueries({ queryKey: keys.scenarios })
    },
  })
}

/** The undo snapshot of the last Generate in this tab. Never fetches, `undefined` when there is none. */
export function useGenerateUndo() {
  return useQuery<GenerateUndo>({
    queryKey: keys.generateUndo,
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/** Returns a function that forgets the undo snapshot (the bar's "×"). */
export function useDismissGenerateUndo() {
  const queryClient = useQueryClient()
  return (): void => {
    void queryClient.resetQueries({ queryKey: keys.generateUndo })
  }
}

/**
 * "Cofnij": stores the snapshot again, naming the versions the Generate produced. 409/422: the
 * server changed nothing, so the offer is dropped and the real plans are refetched. Other errors
 * keep the snapshot so the user can retry. Toasts are the caller's job.
 */
export function useUndoGenerate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (undo: GenerateUndo): Promise<Scenario[]> =>
      putScenarios(
        toScenariosReplace(
          undo.previous.map(({ key, plan }) => ({
            key,
            basedOnVersion: undo.generatedVersions[key],
            plan,
          })),
        ),
      ),
    onSuccess: (restored) => {
      queryClient.setQueryData(keys.scenarios, restored)
      void queryClient.resetQueries({ queryKey: keys.generateUndo })
    },
    onError: (error) => {
      if (!refusesStaleSnapshot(error)) return
      void queryClient.resetQueries({ queryKey: keys.generateUndo })
      void queryClient.invalidateQueries({ queryKey: keys.scenarios })
    },
  })
}

// --- moves: optimistic, rolled back on error (state machine §3 Saving / RolledBack) ----------

type MoveVars = PlanArg & { guestId: number }
type MoveContext = { previous: Scenario | undefined }

/**
 * Shared shape of the two cluster moves: show the move in the cache at once, take the server's
 * evaluated copy on success, put the previous plan back on error.
 */
function useOptimisticMove<V extends MoveVars>(
  request: (vars: V) => Promise<Scenario>,
  target: (vars: V) => { tableNumber: number | null; pinned?: boolean },
) {
  const queryClient = useQueryClient()
  return useMutation<Scenario, Error, V, MoveContext>({
    mutationFn: request,
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: keys.scenarios })
      const previous = queryClient
        .getQueryData<Scenario[]>(keys.scenarios)
        ?.find((scenario) => scenario.key === vars.key)
      if (previous) {
        const placement = findPlacement(previous.plan, vars.guestId)
        const { tableNumber, pinned } = target(vars)
        if (placement) {
          const moved = applyMove(
            previous.plan,
            { ...placement, pinned: pinned ?? placement.pinned },
            tableNumber,
          )
          replaceScenario(queryClient, { ...previous, plan: moved })
        }
      }
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) replaceScenario(queryClient, context.previous)
    },
    onSuccess: (scenario) => replaceScenario(queryClient, scenario),
  })
}

type SetAssignmentVars = MoveVars & { tableNumber: number; pinned: boolean }

/** Moves the guest's whole cluster to a table and sets its pin (also used to toggle the pin). */
export function useSetAssignment() {
  return useOptimisticMove<SetAssignmentVars>(
    async ({ key, guestId, tableNumber, pinned }) =>
      (
        await unwrap(
          client.PUT('/scenarios/{planKey}/assignments/{guestId}', {
            params: { path: { planKey: key, guestId } },
            body: { tableNumber, pinned },
          }),
        )
      ).data,
    ({ tableNumber, pinned }) => ({ tableNumber, pinned }),
  )
}

/** Moves the guest's whole cluster back to the unseated tray. */
export function useDeleteAssignment() {
  return useOptimisticMove<MoveVars>(
    async ({ key, guestId }) =>
      (
        await unwrap(
          client.DELETE('/scenarios/{planKey}/assignments/{guestId}', {
            params: { path: { planKey: key, guestId } },
          }),
        )
      ).data,
    () => ({ tableNumber: null }),
  )
}

// --- tables ---------------------------------------------------------------------------------

export function useAddTable() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ key }: PlanArg): Promise<Scenario> =>
      (
        await unwrap(
          client.POST('/scenarios/{planKey}/tables', { params: { path: { planKey: key } } }),
        )
      ).data,
    onSuccess: (scenario) => replaceScenario(queryClient, scenario),
  })
}

export function useDeleteTable() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      key,
      tableNumber,
    }: PlanArg & { tableNumber: number }): Promise<Scenario> =>
      (
        await unwrap(
          client.DELETE('/scenarios/{planKey}/tables/{tableNumber}', {
            params: { path: { planKey: key, tableNumber } },
          }),
        )
      ).data,
    onSuccess: (scenario) => replaceScenario(queryClient, scenario),
  })
}

/**
 * "Usuń plan": the server empties the plan (no tables, no pins, everyone unseated). Not optimistic:
 * it is destructive and rare, so the UI waits for the evaluated copy. Its version moves, so a pending
 * Cofnij hides itself (`canUndoGenerate`). Toasts are the caller's job.
 */
export function useResetPlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ key }: PlanArg): Promise<Scenario> =>
      (
        await unwrap(
          client.DELETE('/scenarios/{planKey}/tables', { params: { path: { planKey: key } } }),
        )
      ).data,
    onSuccess: (scenario) => replaceScenario(queryClient, scenario),
  })
}
