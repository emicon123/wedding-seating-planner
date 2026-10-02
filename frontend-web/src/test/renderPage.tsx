import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { createQueryClient } from '@/app/queryClient'
import { Toaster } from '@/components/ui/sonner'
import { BASE_PATH } from '@/lib/basePath'

function LocationProbe() {
  const { search } = useLocation()
  return <output data-testid="search">{search}</output>
}

/** A page inside the app's providers (query cache without retries, router under /wesele, toasts). */
export function renderPage(ui: ReactElement, path = '/') {
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({
    queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    mutations: { retry: false },
  })
  return {
    user: userEvent.setup(),
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter basename={BASE_PATH} initialEntries={[`${BASE_PATH}${path}`]}>
          {ui}
          <LocationProbe />
          <Toaster />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}
