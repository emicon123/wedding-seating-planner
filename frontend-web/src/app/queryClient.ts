import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { isUnauthenticated } from '@/api/errors'
import { lockApp } from '@/api/session'

const STALE_MS = 30_000

/**
 * Fresh client per call so tests never share a cache; `queryClient` below is the app's instance.
 * The one place that maps any 401 `unauthenticated` (an expired or missing session cookie) to the
 * PIN screen, and never retries it (003-frontend-design §10).
 */
export function createQueryClient() {
  const onError = (error: unknown) => {
    if (isUnauthenticated(error)) lockApp(client)
  }
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: STALE_MS,
        refetchOnWindowFocus: true, // no live push (ADR-001 §6): refetching on focus is how editors sync
        retry: (failureCount, error) => !isUnauthenticated(error) && failureCount < 1,
      },
      mutations: { retry: false },
    },
  })
  return client
}

export const queryClient = createQueryClient()
