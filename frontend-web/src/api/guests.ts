import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client, unwrap, unwrapEmpty } from '@/api/client'
import { ApiError } from '@/api/errors'
import { invalidateGuestData, keys } from '@/api/keys'
import { applyEnabled, insertGuest } from '@/domain/guestList'
import type { Guest, GuestBulkToggle, GuestCreate, GuestUpdate, LinkLevel } from '@/domain/types'

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

/** `linkKey` is the pair as `{idA}-{idB}`; either order is accepted by the server. */
export function useUpsertLink() {
  const onSuccess = useGuestDataInvalidation()
  return useMutation({
    mutationFn: async ({ linkKey, level }: { linkKey: string; level: LinkLevel }) =>
      (
        await unwrap(
          client.PUT('/guest-links/{linkKey}', { params: { path: { linkKey } }, body: { level } }),
        )
      ).data,
    onSuccess,
  })
}

export function useDeleteLink() {
  const onSuccess = useGuestDataInvalidation()
  return useMutation({
    mutationFn: (linkKey: string): Promise<void> =>
      unwrapEmpty(client.DELETE('/guest-links/{linkKey}', { params: { path: { linkKey } } })),
    onSuccess,
  })
}
