import { QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { ApiError, toApiError } from '@/api/errors'
import { keys } from '@/api/keys'
import { createQueryClient } from '@/app/queryClient'

const UNAUTHENTICATED = toApiError(401, {
  errors: [{ code: 'unauthenticated', field: null, message: 'x' }],
  meta: { requestId: 'r' },
})

function retryOf(client: ReturnType<typeof createQueryClient>) {
  const retry = client.getDefaultOptions().queries?.retry
  if (typeof retry !== 'function') throw new Error('retry must be a function')
  return retry
}

describe('createQueryClient', () => {
  it('never retries a 401 but still retries other failures once', () => {
    const retry = retryOf(createQueryClient())
    expect(retry(0, UNAUTHENTICATED)).toBe(false)
    expect(retry(0, toApiError(500, undefined))).toBe(true)
    expect(retry(1, toApiError(500, undefined))).toBe(false)
  })

  it('does not retry a 401 query: one request, then the PIN state', async () => {
    const client = createQueryClient()
    let calls = 0
    function Probe() {
      useQuery({
        queryKey: keys.guests,
        queryFn: () => {
          calls += 1
          return Promise.reject(UNAUTHENTICATED)
        },
      })
      return null
    }
    // Like AccessGate: the page is unmounted as soon as the session says "PIN required".
    function Gate() {
      const locked = useQuery({
        queryKey: keys.session,
        queryFn: () => ({ status: 'open' }),
        staleTime: Infinity,
      })
      return locked.data?.status === 'open' ? <Probe /> : null
    }
    render(
      <QueryClientProvider client={client}>
        <Gate />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(client.getQueryData(keys.session)).toEqual({ status: 'pinRequired' }),
    )
    expect(calls).toBe(1)
  })

  it('turns a 401 on a mutation into the PIN state and drops other data', async () => {
    const client = createQueryClient()
    client.setQueryData(keys.guests, ['someone'])
    function Probe() {
      const mutation = useMutation({ mutationFn: () => Promise.reject(UNAUTHENTICATED) })
      return <button onClick={() => mutation.mutate()}>go</button>
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )

    screen.getByRole('button', { name: 'go' }).click()

    await waitFor(() => {
      expect(client.getQueryData(keys.session)).toEqual({ status: 'pinRequired' })
      expect(client.getQueryData(keys.guests)).toBeUndefined()
    })
  })

  it('leaves other errors alone, including the login failure (invalid_pin)', async () => {
    const client = createQueryClient()
    const wrongPin = toApiError(401, {
      errors: [{ code: 'invalid_pin', field: null, message: 'x' }],
      meta: { requestId: 'r' },
    })
    expect(wrongPin).toBeInstanceOf(ApiError)
    function Probe() {
      const mutation = useMutation({ mutationFn: () => Promise.reject(wrongPin) })
      return <button onClick={() => mutation.mutate()}>go</button>
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )

    screen.getByRole('button', { name: 'go' }).click()

    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'))
    expect(client.getQueryData(keys.session)).toBeUndefined()
  })
})
