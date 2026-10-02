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
import { withoutProposal } from '@/domain/planView'
import type { AcceptPlan, Capacity, Proposal, Scenario } from '@/domain/types'

type CapacityArg = { capacity: Capacity }

export function useScenarios() {
  return useQuery({
    queryKey: keys.scenarios,
    queryFn: async (): Promise<Scenario[]> => (await unwrap(client.GET('/scenarios'))).data,
  })
}

function replaceScenario(queryClient: QueryClient, scenario: Scenario): void {
  queryClient.setQueryData<Scenario[]>(keys.scenarios, (current) =>
    current?.map((existing) => (existing.capacity === scenario.capacity ? scenario : existing)),
  )
}

// --- proposals: transient, server-derived, owned by the query cache (no client store) -------

/** Lets every "Generuj" button know that one of them is running (`useIsMutating`). */
export const CALCULATE_MUTATION_KEY = ['calculateProposals'] as const

/** Generates all three proposals (pure server computation) and parks them in the cache. */
export function useCalculateProposals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: CALCULATE_MUTATION_KEY,
    mutationFn: async (): Promise<Proposal[]> =>
      (await unwrap(client.POST('/scenarios/calculate'))).data,
    onSuccess: (proposals) => queryClient.setQueryData(keys.proposals, proposals),
  })
}

/** The preview: whatever the last Generate stored. Never fetches, `undefined` when there is none. */
export function useProposals() {
  return useQuery<Proposal[]>({
    queryKey: keys.proposals,
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/** Returns a function that clears the preview (after "Akceptuj wszystkie" or "Odrzuć"). */
export function useDiscardProposals() {
  const queryClient = useQueryClient()
  return (): void => {
    void queryClient.resetQueries({ queryKey: keys.proposals })
  }
}

/** Returns a function that removes one accepted proposal from the preview, keeping the others. */
export function useDropProposal() {
  const queryClient = useQueryClient()
  return (capacity: Capacity): void => {
    queryClient.setQueryData<Proposal[]>(keys.proposals, (current) =>
      current ? withoutProposal(current, capacity) : current,
    )
  }
}

type AcceptVars = CapacityArg & AcceptPlan

export function useAcceptProposal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ capacity, ...body }: AcceptVars): Promise<Scenario> =>
      (
        await unwrap(
          client.PUT('/scenarios/{capacity}/assignments', {
            params: { path: { capacity } },
            body,
          }),
        )
      ).data,
    onSuccess: (scenario) => replaceScenario(queryClient, scenario),
    onError: (error) => {
      // stale basedOnVersion: someone changed the plan, so show them what is there now
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: keys.scenarios })
      }
    },
  })
}

// --- moves: optimistic, rolled back on error (state machine §3 Saving / RolledBack) ----------

type MoveVars = CapacityArg & { guestId: number }
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
        ?.find((scenario) => scenario.capacity === vars.capacity)
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
    async ({ capacity, guestId, tableNumber, pinned }) =>
      (
        await unwrap(
          client.PUT('/scenarios/{capacity}/assignments/{guestId}', {
            params: { path: { capacity, guestId } },
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
    async ({ capacity, guestId }) =>
      (
        await unwrap(
          client.DELETE('/scenarios/{capacity}/assignments/{guestId}', {
            params: { path: { capacity, guestId } },
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
    mutationFn: async ({ capacity }: CapacityArg): Promise<Scenario> =>
      (
        await unwrap(
          client.POST('/scenarios/{capacity}/tables', { params: { path: { capacity } } }),
        )
      ).data,
    onSuccess: (scenario) => replaceScenario(queryClient, scenario),
  })
}

export function useDeleteTable() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      capacity,
      tableNumber,
    }: CapacityArg & { tableNumber: number }): Promise<Scenario> =>
      (
        await unwrap(
          client.DELETE('/scenarios/{capacity}/tables/{tableNumber}', {
            params: { path: { capacity, tableNumber } },
          }),
        )
      ).data,
    onSuccess: (scenario) => replaceScenario(queryClient, scenario),
  })
}
