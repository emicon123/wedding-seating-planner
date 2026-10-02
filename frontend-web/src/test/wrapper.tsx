import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createQueryClient } from '@/app/queryClient'

/** Renders a hook inside a fresh (retry-free) QueryClient; returns the client for cache assertions. */
export function renderHookWithClient<T>(hook: () => T, queryClient?: QueryClient) {
  const client = queryClient ?? createQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    mutations: { retry: false },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { ...renderHook(hook, { wrapper }), queryClient: client }
}
