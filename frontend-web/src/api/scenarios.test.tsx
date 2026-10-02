import { act, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { keys } from '@/api/keys'
import {
  useAcceptProposal,
  useAddTable,
  useCalculateProposals,
  useDeleteAssignment,
  useDeleteTable,
  useDiscardProposals,
  useDropProposal,
  useProposals,
  useScenarios,
  useSetAssignment,
} from '@/api/scenarios'
import type { Proposal, Scenario } from '@/domain/types'
import { makePlan, makeScenario, placement } from '@/test/builders'
import { failure, gate, HttpResponse, list, mockApi, single } from '@/test/server'
import { renderHookWithClient } from '@/test/wrapper'

const maciek = placement(4, [4, 5])
const michal = placement(6, [6, 7])

function scenario10(version = 7) {
  return makeScenario(
    10,
    makePlan(
      [
        { number: 1, clusters: [maciek] },
        { number: 2, clusters: [michal] },
      ],
      [placement(31, [31])],
    ),
    version,
  )
}
const scenario8 = makeScenario(8, makePlan([{ number: 1, clusters: [] }]), 2)
const scenario12 = makeScenario(12, makePlan([{ number: 1, clusters: [] }]), 3)
const initial = (): Scenario[] => [scenario8, scenario10(), scenario12]

/** What the server would answer after Maciek's cluster moved to table 2 (scores recomputed). */
function serverCopyAfterMove(): Scenario {
  const plan = makePlan([
    { number: 1, clusters: [] },
    { number: 2, clusters: [michal, maciek] },
  ])
  return makeScenario(
    10,
    {
      ...plan,
      summary: { ...plan.summary, score: 99, violationCount: 0, needsRecalculation: false },
    },
    8,
  )
}

const cached = (queryClient: QueryClient) => queryClient.getQueryData<Scenario[]>(keys.scenarios)
const tableOf = (scenario: Scenario | undefined, clusterKey: number) =>
  scenario?.plan.tables.find((t) => t.clusters.some((c) => c.clusterKey === clusterKey))?.number ??
  null

function seedScenarios(queryClient: QueryClient) {
  queryClient.setQueryData(keys.scenarios, initial())
}

describe('useScenarios', () => {
  it('returns the three scenarios', async () => {
    mockApi('get', '/scenarios', () => HttpResponse.json(list(initial())))

    const { result } = renderHookWithClient(() => useScenarios())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.map((s) => s.capacity)).toEqual([8, 10, 12])
  })
})

describe('proposals live in the query cache', () => {
  const proposals: Proposal[] = [8, 10, 12].map((capacity) => ({
    capacity: capacity as Proposal['capacity'],
    basedOnVersion: 7,
    plan: scenario10().plan,
  }))

  it('useCalculateProposals writes keys.proposals and nothing is stored on the server', async () => {
    const api = mockApi('post', '/scenarios/calculate', () => HttpResponse.json(list(proposals)))
    const { result, queryClient } = renderHookWithClient(() => ({
      calculate: useCalculateProposals(),
      preview: useProposals(),
    }))
    expect(result.current.preview.data).toBeUndefined()

    await act(() => result.current.calculate.mutateAsync())

    expect(api.calls).toHaveLength(1)
    expect(queryClient.getQueryData(keys.proposals)).toEqual(proposals)
    await waitFor(() => expect(result.current.preview.data).toEqual(proposals))
  })

  it('does not touch the scenarios cache', async () => {
    mockApi('post', '/scenarios/calculate', () => HttpResponse.json(list(proposals)))
    const { result, queryClient } = renderHookWithClient(() => useCalculateProposals())
    seedScenarios(queryClient)

    await act(() => result.current.mutateAsync())

    expect(cached(queryClient)).toEqual(initial())
  })

  it('useDiscardProposals clears the preview', async () => {
    mockApi('post', '/scenarios/calculate', () => HttpResponse.json(list(proposals)))
    const { result } = renderHookWithClient(() => ({
      calculate: useCalculateProposals(),
      preview: useProposals(),
      discard: useDiscardProposals(),
    }))
    await act(() => result.current.calculate.mutateAsync())
    await waitFor(() => expect(result.current.preview.data).toBeDefined())

    act(() => result.current.discard())

    await waitFor(() => expect(result.current.preview.data).toBeUndefined())
  })

  it('useDropProposal removes one accepted proposal and keeps the others', async () => {
    mockApi('post', '/scenarios/calculate', () => HttpResponse.json(list(proposals)))
    const { result } = renderHookWithClient(() => ({
      calculate: useCalculateProposals(),
      preview: useProposals(),
      drop: useDropProposal(),
    }))
    await act(() => result.current.calculate.mutateAsync())
    await waitFor(() => expect(result.current.preview.data).toHaveLength(3))

    act(() => result.current.drop(10))

    await waitFor(() =>
      expect(result.current.preview.data?.map((p) => p.capacity)).toEqual([8, 12]),
    )
  })

  it('a failed Generate leaves the preview empty and rejects with the ApiError', async () => {
    mockApi('post', '/scenarios/calculate', () =>
      HttpResponse.json(failure('internal_error'), { status: 500 }),
    )
    const { result, queryClient } = renderHookWithClient(() => useCalculateProposals())

    const error = await act(() => result.current.mutateAsync().catch((e: unknown) => e))

    expect(error).toBeInstanceOf(ApiError)
    expect(queryClient.getQueryData(keys.proposals)).toBeUndefined()
  })
})

describe('useAcceptProposal', () => {
  const tables = [{ number: 1, guestIds: [4, 5, 6, 7] }]

  it('PUTs the layout with basedOnVersion and replaces only that scenario with the server copy', async () => {
    const accepted = makeScenario(10, makePlan([{ number: 1, clusters: [maciek, michal] }]), 8)
    const api = mockApi('put', '/scenarios/10/assignments', () =>
      HttpResponse.json(single(accepted)),
    )
    const { result, queryClient } = renderHookWithClient(() => useAcceptProposal())
    seedScenarios(queryClient)

    await act(() => result.current.mutateAsync({ capacity: 10, basedOnVersion: 7, tables }))

    expect(api.calls).toEqual([{ basedOnVersion: 7, tables }])
    const after = cached(queryClient)
    expect(after?.map((s) => s.capacity)).toEqual([8, 10, 12])
    expect(after?.[1]).toEqual(accepted)
    expect(after?.[0]).toEqual(scenario8)
    expect(after?.[2]).toEqual(scenario12)
  })

  it('on a 409 refetches the scenarios and rejects with a version_conflict ApiError', async () => {
    mockApi('put', '/scenarios/10/assignments', () =>
      HttpResponse.json(failure('version_conflict', 'version'), { status: 409 }),
    )
    const fresh = [scenario8, scenario10(9), scenario12]
    const refetch = mockApi('get', '/scenarios', () => HttpResponse.json(list(fresh)))
    const { result } = renderHookWithClient(() => ({
      scenarios: useScenarios(),
      accept: useAcceptProposal(),
    }))
    await waitFor(() => expect(result.current.scenarios.isSuccess).toBe(true))
    expect(refetch.calls).toHaveLength(1)

    const error = await act(() =>
      result.current.accept
        .mutateAsync({ capacity: 10, basedOnVersion: 7, tables })
        .catch((e: unknown) => e),
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).has('version_conflict')).toBe(true)
    await waitFor(() => expect(refetch.calls).toHaveLength(2))
    await waitFor(() => expect(result.current.scenarios.data?.[1]?.version).toBe(9))
  })

  it('does not refetch for other errors', async () => {
    mockApi('put', '/scenarios/10/assignments', () =>
      HttpResponse.json(failure('validation_failed'), { status: 422 }),
    )
    const refetch = mockApi('get', '/scenarios', () => HttpResponse.json(list(initial())))
    const { result } = renderHookWithClient(() => ({
      scenarios: useScenarios(),
      accept: useAcceptProposal(),
    }))
    await waitFor(() => expect(result.current.scenarios.isSuccess).toBe(true))

    await act(() =>
      result.current.accept
        .mutateAsync({ capacity: 10, basedOnVersion: 7, tables })
        .catch((e: unknown) => e),
    )

    expect(refetch.calls).toHaveLength(1)
  })
})

describe('useSetAssignment (optimistic)', () => {
  it('moves the chip immediately, then replaces the scenario with the server copy', async () => {
    const hold = gate()
    const api = mockApi('put', '/scenarios/10/assignments/4', async () => {
      await hold.opened
      return HttpResponse.json(single(serverCopyAfterMove()))
    })
    const { result, queryClient } = renderHookWithClient(() => useSetAssignment())
    seedScenarios(queryClient)
    expect(tableOf(cached(queryClient)?.[1], 4)).toBe(1)

    act(() => result.current.mutate({ capacity: 10, guestId: 4, tableNumber: 2, pinned: false }))

    // optimistic: visible before the server answered
    await waitFor(() => expect(tableOf(cached(queryClient)?.[1], 4)).toBe(2))
    expect(cached(queryClient)?.[1]?.plan.tables.map((t) => t.fill)).toEqual([0, 4])
    expect(cached(queryClient)?.[1]?.plan.summary.score).toBe(42.5) // scores untouched until the reply
    expect(result.current.isPending).toBe(true)

    hold.open()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(api.calls).toEqual([{ tableNumber: 2, pinned: false }])
    expect(cached(queryClient)?.[1]).toEqual(serverCopyAfterMove())
    expect(cached(queryClient)?.[1]?.plan.summary.score).toBe(99)
    expect(cached(queryClient)?.[0]).toEqual(scenario8)
  })

  it('rolls back to the previous plan when the server refuses, and rejects with the ApiError', async () => {
    const hold = gate()
    mockApi('put', '/scenarios/10/assignments/4', async () => {
      await hold.opened
      return HttpResponse.json(failure('validation_failed', 'tableNumber'), { status: 422 })
    })
    const { result, queryClient } = renderHookWithClient(() => useSetAssignment())
    seedScenarios(queryClient)

    act(() => result.current.mutate({ capacity: 10, guestId: 4, tableNumber: 2, pinned: false }))
    await waitFor(() => expect(tableOf(cached(queryClient)?.[1], 4)).toBe(2))

    hold.open()
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(cached(queryClient)).toEqual(initial())
    expect(result.current.error).toBeInstanceOf(ApiError)
  })

  it('rolls back on a network failure too', async () => {
    mockApi('put', '/scenarios/10/assignments/4', () => HttpResponse.error())
    const { result, queryClient } = renderHookWithClient(() => useSetAssignment())
    seedScenarios(queryClient)

    act(() => result.current.mutate({ capacity: 10, guestId: 4, tableNumber: 2, pinned: false }))
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(cached(queryClient)).toEqual(initial())
  })

  it('shows a pin toggle at once and sends pinned with the current table', async () => {
    const hold = gate()
    const api = mockApi('put', '/scenarios/10/assignments/4', async () => {
      await hold.opened
      return HttpResponse.json(single(scenario10(8)))
    })
    const { result, queryClient } = renderHookWithClient(() => useSetAssignment())
    seedScenarios(queryClient)

    act(() => result.current.mutate({ capacity: 10, guestId: 4, tableNumber: 1, pinned: true }))

    await waitFor(() =>
      expect(
        cached(queryClient)?.[1]?.plan.tables[0]?.clusters.find((c) => c.clusterKey === 4)?.pinned,
      ).toBe(true),
    )
    hold.open()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.calls).toEqual([{ tableNumber: 1, pinned: true }])
  })

  it('finds the cluster by any of its members', async () => {
    const hold = gate()
    mockApi('put', '/scenarios/10/assignments/5', async () => {
      await hold.opened
      return HttpResponse.json(single(serverCopyAfterMove()))
    })
    const { result, queryClient } = renderHookWithClient(() => useSetAssignment())
    seedScenarios(queryClient)

    act(() => result.current.mutate({ capacity: 10, guestId: 5, tableNumber: 2, pinned: false }))

    await waitFor(() => expect(tableOf(cached(queryClient)?.[1], 4)).toBe(2))
    hold.open()
  })
})

describe('useDeleteAssignment (optimistic)', () => {
  it('moves the cluster to the tray at once and takes the server copy on success', async () => {
    const hold = gate()
    const serverCopy = makeScenario(
      10,
      makePlan(
        [
          { number: 1, clusters: [] },
          { number: 2, clusters: [michal] },
        ],
        [maciek, placement(31, [31])],
      ),
      8,
    )
    const api = mockApi('delete', '/scenarios/10/assignments/4', async () => {
      await hold.opened
      return HttpResponse.json(single(serverCopy))
    })
    const { result, queryClient } = renderHookWithClient(() => useDeleteAssignment())
    seedScenarios(queryClient)

    act(() => result.current.mutate({ capacity: 10, guestId: 4 }))

    await waitFor(() =>
      expect(cached(queryClient)?.[1]?.plan.unseated.map((c) => c.clusterKey)).toEqual([31, 4]),
    )
    hold.open()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.calls).toHaveLength(1)
    expect(cached(queryClient)?.[1]).toEqual(serverCopy)
  })

  it('rolls back on error', async () => {
    mockApi('delete', '/scenarios/10/assignments/4', () =>
      HttpResponse.json(failure('not_found', 'guestId'), { status: 404 }),
    )
    const { result, queryClient } = renderHookWithClient(() => useDeleteAssignment())
    seedScenarios(queryClient)

    act(() => result.current.mutate({ capacity: 10, guestId: 4 }))
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(cached(queryClient)).toEqual(initial())
  })
})

describe('table commands replace the scenario with the server copy', () => {
  it('useAddTable (POST → 201)', async () => {
    const withTable = makeScenario(
      10,
      makePlan([
        { number: 1, clusters: [maciek] },
        { number: 2, clusters: [michal] },
        { number: 3, clusters: [] },
      ]),
      8,
    )
    mockApi('post', '/scenarios/10/tables', () =>
      HttpResponse.json(single(withTable), { status: 201 }),
    )
    const { result, queryClient } = renderHookWithClient(() => useAddTable())
    seedScenarios(queryClient)

    await act(() => result.current.mutateAsync({ capacity: 10 }))

    expect(cached(queryClient)?.[1]).toEqual(withTable)
    expect(cached(queryClient)?.[0]).toEqual(scenario8)
  })

  it('useDeleteTable', async () => {
    const without = makeScenario(10, makePlan([{ number: 1, clusters: [maciek] }], [michal]), 8)
    const api = mockApi('delete', '/scenarios/10/tables/2', () =>
      HttpResponse.json(single(without)),
    )
    const { result, queryClient } = renderHookWithClient(() => useDeleteTable())
    seedScenarios(queryClient)

    await act(() => result.current.mutateAsync({ capacity: 10, tableNumber: 2 }))

    expect(api.calls).toHaveLength(1)
    expect(cached(queryClient)?.[1]).toEqual(without)
  })
})
