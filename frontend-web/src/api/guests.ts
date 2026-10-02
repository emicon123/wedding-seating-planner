import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client, unwrap, unwrapEmpty } from '@/api/client'
import { ApiError } from '@/api/errors'
import { invalidateGuestData, keys } from '@/api/keys'
import { applyEnabled, insertGuest, linkKey as linkKeyOf } from '@/domain/guestList'
import type { LinkChange } from '@/domain/linkSelection'
import type { Guest, GuestBulkToggle, GuestCreate, GuestUpdate } from '@/domain/types'

export function useGuests() {
  return useQuery({
    queryKey: keys.guests,
    queryFn: async (): Promise<Guest[]> => (await unwrap(client.GET('/guests'))).data,
  })
}

/** Runs `onSuccess` of every guest/link mutation: invalidate guests, clusters and scenarios. */
function useGuestDataInvalidation() {
  const queryClient = useQueryClient()
  return () => invalidateGuestData(queryClient)
}

/** Quick-add feel: the new guest is in the list the moment the server confirmed, before the refetch. */
export function useCreateGuest() {
  const queryClient = useQueryClient()
  const invalidate = useGuestDataInvalidation()
  return useMutation({
    mutationFn: async (body: GuestCreate): Promise<Guest> =>
      (await unwrap(client.POST('/guests', { body }))).data,
    onSuccess: (created) => {
      queryClient.setQueryData<Guest[]>(keys.guests, (guests) =>
        guests ? insertGuest(guests, created) : guests,
      )
      invalidate()
    },
  })
}

/** A stale `version` (409) means someone else saved first: reload the list so the editor sees it. */
export function useUpdateGuest() {
  const queryClient = useQueryClient()
  const onSuccess = useGuestDataInvalidation()
  return useMutation({
    mutationFn: async ({ guestId, ...body }: GuestUpdate & { guestId: number }): Promise<Guest> =>
      (await unwrap(client.PATCH('/guests/{guestId}', { params: { path: { guestId } }, body })))
        .data,
    onSuccess,
    onError: (error) => {
      if (error instanceof ApiError && error.has('version_conflict')) {
        void queryClient.invalidateQueries({ queryKey: keys.guests })
      }
    },
  })
}

/**
 * One endpoint for the per-row switch (one id) and the bulk toggle (many ids). The switch flips
 * at once in the cached list; a failure reloads the list (the truth) instead of restoring a
 * snapshot, so two quick toggles can never undo each other.
 */
export function useToggleGuests() {
  const queryClient = useQueryClient()
  const onSuccess = useGuestDataInvalidation()
  return useMutation({
    mutationFn: async (body: GuestBulkToggle): Promise<Guest[]> =>
      (await unwrap(client.PATCH('/guests', { body }))).data,
    onMutate: async ({ guestIds, enabled }) => {
      await queryClient.cancelQueries({ queryKey: keys.guests })
      queryClient.setQueryData<Guest[]>(keys.guests, (guests) =>
        guests ? applyEnabled(guests, guestIds, enabled) : guests,
      )
    },
    onError: () => queryClient.invalidateQueries({ queryKey: keys.guests }),
    onSuccess,
  })
}

export function useDeleteGuest() {
  const onSuccess = useGuestDataInvalidation()
  return useMutation({
    mutationFn: (guestId: number): Promise<void> =>
      unwrapEmpty(client.DELETE('/guests/{guestId}', { params: { path: { guestId } } })),
    onSuccess,
  })
}

/** A link change that the server refused (or that never arrived). */
export type LinkChangeFailure = { otherId: number; error: unknown }

async function applyLinkChange(guestId: number, { otherId, level }: LinkChange): Promise<void> {
  const linkKey = linkKeyOf(guestId, otherId)
  const params = { params: { path: { linkKey } } }
  if (level === null) await unwrapEmpty(client.DELETE('/guest-links/{linkKey}', params))
  else await unwrap(client.PUT('/guest-links/{linkKey}', { ...params, body: { level } }))
}

/**
 * Saves the link editor's checklist: one request per changed pair (PUT sets or moves the pair's
 * single link, DELETE removes it), sequentially, so a failure in the middle leaves the rest of the
 * work intact. It never rejects for a refused change: the failures come back as the result, and
 * guests, clusters and scenarios are reloaded once at the end (success or not), so the editor
 * always shows the truth.
 */
export function useApplyLinkChanges() {
  const onSettled = useGuestDataInvalidation()
  return useMutation({
    mutationFn: async ({
      guestId,
      changes,
    }: {
      guestId: number
      changes: LinkChange[]
    }): Promise<LinkChangeFailure[]> => {
      const failed: LinkChangeFailure[] = []
      for (const change of changes) {
        try {
          await applyLinkChange(guestId, change)
        } catch (error) {
          failed.push({ otherId: change.otherId, error })
        }
      }
      return failed
    },
    onSettled,
  })
}
