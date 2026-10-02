import { act, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import {
  useApplyLinkChanges,
  useCreateGuest,
  useDeleteGuest,
  useGuests,
  useToggleGuests,
  useUpdateGuest,
} from '@/api/guests'
import { keys } from '@/api/keys'
import { KAROLINA, MACIEK, makeGuest } from '@/test/builders'
import { failure, gate, HttpResponse, list, mockApi, single } from '@/test/server'
import { renderHookWithClient } from '@/test/wrapper'

function spyOnInvalidation(queryClient: QueryClient) {
  const spy = vi.spyOn(queryClient, 'invalidateQueries')
  return () => spy.mock.calls.map(([filters]) => filters?.queryKey)
}

describe('useGuests', () => {
  it('returns the guests of the list envelope', async () => {
    mockApi('get', '/guests', () => HttpResponse.json(list([MACIEK, KAROLINA])))

    const { result } = renderHookWithClient(() => useGuests())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([MACIEK, KAROLINA])
  })

  it('exposes a failure as an ApiError', async () => {
    mockApi('get', '/guests', () => HttpResponse.json(failure('internal_error'), { status: 500 }))

    const { result } = renderHookWithClient(() => useGuests())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
  })
})

// 003-frontend-design §2: every guest/link mutation invalidates guests, clusters and scenarios,
// and nothing else (in particular not the proposal preview).
const EXPECTED_INVALIDATION = [keys.guests, keys.clusters, keys.scenarios]

describe('guest mutations invalidate guests, clusters and scenarios', () => {
  const guest = makeGuest({ id: 5, firstName: 'Karolina', lastName: 'Nowak' })

  it('useCreateGuest sends POST /guests', async () => {
    const api = mockApi('post', '/guests', () => HttpResponse.json(single(guest), { status: 201 }))
    const { result, queryClient } = renderHookWithClient(() => useCreateGuest())
    const invalidated = spyOnInvalidation(queryClient)

    let created: unknown
    await act(async () => {
      created = await result.current.mutateAsync({ firstName: 'Karolina', lastName: 'Nowak' })
    })

    expect(api.calls).toEqual([{ firstName: 'Karolina', lastName: 'Nowak' }])
    expect(created).toEqual(guest)
    expect(invalidated()).toEqual(EXPECTED_INVALIDATION)
  })

  it('useUpdateGuest sends PATCH /guests/{id} with the version', async () => {
    const api = mockApi('patch', '/guests/5', () => HttpResponse.json(single(guest)))
    const { result, queryClient } = renderHookWithClient(() => useUpdateGuest())
    const invalidated = spyOnInvalidation(queryClient)

    await act(() => result.current.mutateAsync({ guestId: 5, version: 3, notes: 'wegetarianka' }))

    expect(api.calls).toEqual([{ version: 3, notes: 'wegetarianka' }])
    expect(invalidated()).toEqual(EXPECTED_INVALIDATION)
  })

  it('useToggleGuests sends one PATCH /guests with all the ids', async () => {
    const api = mockApi('patch', '/guests', () => HttpResponse.json(list([guest])))
    const { result, queryClient } = renderHookWithClient(() => useToggleGuests())
    const invalidated = spyOnInvalidation(queryClient)

    await act(() => result.current.mutateAsync({ guestIds: [8, 9, 15], enabled: false }))

    expect(api.calls).toEqual([{ guestIds: [8, 9, 15], enabled: false }])
    expect(invalidated()).toEqual(EXPECTED_INVALIDATION)
  })

  it('useDeleteGuest sends DELETE /guests/{id}', async () => {
    const api = mockApi('delete', '/guests/5', () => new HttpResponse(null, { status: 204 }))
    const { result, queryClient } = renderHookWithClient(() => useDeleteGuest())
    const invalidated = spyOnInvalidation(queryClient)

    await act(() => result.current.mutateAsync(5))

    expect(api.calls).toHaveLength(1)
    expect(invalidated()).toEqual(EXPECTED_INVALIDATION)
  })

  it('useApplyLinkChanges sends PUT for a level and DELETE for null, then invalidates once', async () => {
    const put = mockApi('put', '/guest-links/4-6', () =>
      HttpResponse.json(single({ key: '4-6', guestIds: [4, 6], level: 1 })),
    )
    const del = mockApi('delete', '/guest-links/4-5', () => new HttpResponse(null, { status: 204 }))
    const { result, queryClient } = renderHookWithClient(() => useApplyLinkChanges())
    const invalidated = spyOnInvalidation(queryClient)

    const failed = await act(() =>
      result.current.mutateAsync({
        guestId: 4,
        changes: [
          { otherId: 5, level: null },
          { otherId: 6, level: 1 },
        ],
      }),
    )

    expect(failed).toEqual([])
    expect(del.calls).toHaveLength(1)
    expect(put.calls).toEqual([{ level: 1 }])
    expect(invalidated()).toEqual(EXPECTED_INVALIDATION)
  })

  it('useApplyLinkChanges keeps going after a refused change and reports which one failed', async () => {
    mockApi('put', '/guest-links/4-6', () =>
      HttpResponse.json(failure('not_found'), { status: 404 }),
    )
    const second = mockApi('put', '/guest-links/4-7', () =>
      HttpResponse.json(single({ key: '4-7', guestIds: [4, 7], level: 2 })),
    )
    const { result, queryClient } = renderHookWithClient(() => useApplyLinkChanges())
    const invalidated = spyOnInvalidation(queryClient)

    const failed = await act(() =>
      result.current.mutateAsync({
        guestId: 4,
        changes: [
          { otherId: 6, level: 2 },
          { otherId: 7, level: 2 },
        ],
      }),
    )

    expect(failed).toHaveLength(1)
    expect(failed[0]?.otherId).toBe(6)
    expect(failed[0]?.error).toBeInstanceOf(ApiError)
    expect(second.calls).toEqual([{ level: 2 }])
    expect(invalidated()).toEqual(EXPECTED_INVALIDATION)
  })

  it('does not invalidate anything when the request fails, and rejects with the ApiError', async () => {
    mockApi('post', '/guests', () =>
      HttpResponse.json(failure('duplicate_name', 'firstName'), { status: 422 }),
    )
    const { result, queryClient } = renderHookWithClient(() => useCreateGuest())
    const invalidated = spyOnInvalidation(queryClient)

    const error = await act(() =>
      result.current.mutateAsync({ firstName: 'Karolina' }).catch((e: unknown) => e),
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).has('duplicate_name')).toBe(true)
    expect(invalidated()).toEqual([])
  })

  it('refetches the active guest list after a toggle (behaviour, not just keys)', async () => {
    let enabled = true
    mockApi('get', '/guests', () => HttpResponse.json(list([{ ...MACIEK, enabled }])))
    mockApi('patch', '/guests', () => {
      enabled = false
      return HttpResponse.json(list([{ ...MACIEK, enabled }]))
    })
    mockApi('get', '/clusters', () => HttpResponse.json(single({ clusters: [], warnings: [] })))
    mockApi('get', '/scenarios', () => HttpResponse.json(list([])))
    const { result } = renderHookWithClient(() => ({
      guests: useGuests(),
      toggle: useToggleGuests(),
    }))
    await waitFor(() => expect(result.current.guests.data?.[0]?.enabled).toBe(true))

    await act(() => result.current.toggle.mutateAsync({ guestIds: [4], enabled: false }))

    await waitFor(() => expect(result.current.guests.data?.[0]?.enabled).toBe(false))
  })
})

describe('guest list feel', () => {
  const zosia = makeGuest({ id: 8, firstName: 'Zosia' })

  it('useCreateGuest puts the new guest into the cached list at once, in name order', async () => {
    mockApi('post', '/guests', () => HttpResponse.json(single(zosia), { status: 201 }))
    const { result, queryClient } = renderHookWithClient(() => useCreateGuest())
    queryClient.setQueryData(keys.guests, [MACIEK, KAROLINA])

    await act(() => result.current.mutateAsync({ firstName: 'Zosia' }))

    expect(queryClient.getQueryData<{ id: number }[]>(keys.guests)?.map((g) => g.id)).toEqual([
      5, 4, 8,
    ])
  })

  it('useToggleGuests flips the cached guests before the server answers', async () => {
    const release = gate()
    mockApi('patch', '/guests', async () => {
      await release.opened
      return HttpResponse.json(list([{ ...MACIEK, enabled: false }]))
    })
    const { result, queryClient } = renderHookWithClient(() => useToggleGuests())
    queryClient.setQueryData(keys.guests, [MACIEK, KAROLINA])

    act(() => result.current.mutate({ guestIds: [4], enabled: false }))

    await waitFor(() =>
      expect(queryClient.getQueryData<{ enabled: boolean }[]>(keys.guests)?.[0]?.enabled).toBe(
        false,
      ),
    )
    expect(result.current.isPending).toBe(true)
    release.open()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('useToggleGuests reloads the list when the request fails', async () => {
    mockApi('patch', '/guests', () => HttpResponse.json(failure('not_found'), { status: 404 }))
    const { result, queryClient } = renderHookWithClient(() => useToggleGuests())
    queryClient.setQueryData(keys.guests, [MACIEK])
    const invalidated = spyOnInvalidation(queryClient)

    await act(() => result.current.mutateAsync({ guestIds: [4], enabled: false }).catch(() => {}))

    expect(invalidated()).toEqual([keys.guests])
  })

  it('useUpdateGuest reloads the list on a 409 version conflict', async () => {
    mockApi('patch', '/guests/4', () =>
      HttpResponse.json(failure('version_conflict'), { status: 409 }),
    )
    const { result, queryClient } = renderHookWithClient(() => useUpdateGuest())
    const invalidated = spyOnInvalidation(queryClient)

    await act(() =>
      result.current.mutateAsync({ guestId: 4, version: 1, notes: 'x' }).catch(() => {}),
    )

    expect(invalidated()).toEqual([keys.guests])
  })
})
