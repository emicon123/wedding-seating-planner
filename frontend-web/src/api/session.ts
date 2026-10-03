import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { client, unwrap, unwrapEmpty } from '@/api/client'
import { isUnauthenticated } from '@/api/errors'
import { keys } from '@/api/keys'
import type { Session } from '@/domain/types'

/** What the app knows about access: let in (with the gate's mode) or asked for the PIN. */
export type SessionState =
  { status: 'open'; pinRequired: boolean; expiresAt: string | null } | { status: 'pinRequired' }

const PIN_REQUIRED: SessionState = { status: 'pinRequired' }

function opened({ pinRequired, expiresAt }: Session): SessionState {
  return { status: 'open', pinRequired, expiresAt }
}

/**
 * Asks the server once. A 401 here is a normal answer ("show the PIN screen"), not an error;
 * `staleTime: Infinity` because every other query's 401 keeps the state honest (see lockApp).
 */
export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: async (): Promise<SessionState> => {
      try {
        return opened((await unwrap(client.GET('/session'))).data)
      } catch (error) {
        if (isUnauthenticated(error)) return PIN_REQUIRED
        throw error
      }
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

/**
 * Back to the PIN screen: forget every cached query except the session itself, so no guest data
 * stays in memory behind it. Used by the global 401 hook and by logout.
 */
export function lockApp(queryClient: QueryClient): void {
  queryClient.setQueryData<SessionState>(keys.session, PIN_REQUIRED)
  // Removed one macrotask later, after React has unmounted the pages: a mounted observer whose
  // query vanishes would immediately re-request it (and meet another 401).
  setTimeout(() => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== keys.session[0] })
  }, 0)
}

/** The PIN is only ever passed to `mutate`; it is never cached, stored or put in the URL. */
export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (pin: string): Promise<Session> =>
      (await unwrap(client.POST('/session', { body: { pin } }))).data,
    onSuccess: (session) => {
      queryClient.setQueryData<SessionState>(keys.session, opened(session))
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== keys.session[0],
      })
    },
  })
}

/** Logout is stateless on the server; whatever it answers, this browser leaves the app. */
export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => unwrapEmpty(client.DELETE('/session')),
    onSettled: () => lockApp(queryClient),
  })
}
