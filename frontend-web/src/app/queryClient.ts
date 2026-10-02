import { QueryClient } from '@tanstack/react-query'

const STALE_MS = 30_000

/** Fresh client per call so tests never share a cache; `queryClient` below is the app's instance. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_MS,
        refetchOnWindowFocus: true, // no live push (ADR-001 §6): refetching on focus is how editors sync
        retry: 1,
      },
      mutations: { retry: false },
    },
  })
}

export const queryClient = createQueryClient()
