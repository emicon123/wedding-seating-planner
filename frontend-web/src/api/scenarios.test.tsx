import { act, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { keys } from '@/api/keys'
import {
  useAddTable,
  useDeleteAssignment,
  useDeleteTable,
  useGeneratePlans,
  useGenerateUndo,
  useResetPlan,
  useScenarios,
  useSetAssignment,
  useUndoGenerate,
} from '@/api/scenarios'
import { CAPACITIES } from '@/domain/capacity'
import type { GenerateUndo, Proposal, Scenario, ScenariosReplace } from '@/domain/types'
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
const scenario9 = makeScenario(9, makePlan([{ number: 1, clusters: [] }]), 2)
const scenario12 = makeScenario(12, makePlan([{ number: 1, clusters: [] }]), 3)
const scenario11 = makeScenario(11, makePlan([{ number: 1, clusters: [] }]), 4)
const initial = (): Scenario[] => [scenario9, scenario10(), scenario11, scenario12]

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
  it('returns the four scenarios', async () => {
    mockApi('get', '/scenarios', () => HttpResponse.json(list(initial())))

    const { result } = renderHookWithClient(() => useScenarios())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.map((s) => s.capacity)).toEqual([9, 10, 11, 12])
  })
})

describe('Generate and Cofnij (task 007)', () => {
  const pinnedMaciek = placement(4, [4, 5], true)
  /** The plan the server computes for every capacity: one table with a pinned and a free cluster. */
  const proposedPlan = () => makePlan([{ number: 1, clusters: [pinnedMaciek, michal] }])
  const proposals = (): Proposal[] =>
    CAPACITIES.map((capacity) => ({ capacity, basedOnVersion: 0, plan: proposedPlan() }))
  /** What the PUT answers: the proposals stored, every version + 1. */
  const stored = (before: Scenario[]): Scenario[] =>
    before.map((s) => makeScenario(s.capacity, proposedPlan(), s.version + 1))

  const putCall = (respond: (body: unknown) => Response) => mockApi('put', '/scenarios', respond)

  describe('useGeneratePlans', () => {
    it('reads the plans, calculates, then PUTs the proposals with the SNAPSHOT versions and the pins', async () => {
      const order: string[] = []
      const get = mockApi('get', '/scenarios', () => {
        order.push('get')
        return HttpResponse.json(list(initial()))
      })
      mockApi('post', '/scenarios/calculate', () => {
        order.push('calculate')
        return HttpResponse.json(list(proposals()))
      })
      const put = putCall(() => {
        order.push('put')
        return HttpResponse.json(list(stored(initial())))
      })
      const { result } = renderHookWithClient(() => useGeneratePlans())

      await act(() => result.current.mutateAsync())

      expect(order).toEqual(['get', 'calculate', 'put'])
      expect(get.calls).toHaveLength(1)
      const body = put.calls[0] as ScenariosReplace
      expect(body.plans.map((p) => [p.capacity, p.basedOnVersion])).toEqual([
        [9, 2],
        [10, 7],
        [11, 4],
        [12, 3],
      ])
      expect(body.plans[0]?.tables).toEqual([
        { number: 1, guestIds: [4, 5, 6, 7], pinnedGuestIds: [4, 5] },
      ])
    })

    it('fetches the plans fresh even when the cache holds a recent copy', async () => {
      const get = mockApi('get', '/scenarios', () => HttpResponse.json(list(initial())))
      mockApi('post', '/scenarios/calculate', () => HttpResponse.json(list(proposals())))
      putCall(() => HttpResponse.json(list(stored(initial()))))
      const { result, queryClient } = renderHookWithClient(() => useGeneratePlans())
      seedScenarios(queryClient)

      await act(() => result.current.mutateAsync())

      expect(get.calls).toHaveLength(1)
    })

    it('puts the stored plans into the scenarios cache and keeps the undo snapshot', async () => {
      mockApi('get', '/scenarios', () => HttpResponse.json(list(initial())))
      mockApi('post', '/scenarios/calculate', () => HttpResponse.json(list(proposals())))
      putCall(() => HttpResponse.json(list(stored(initial()))))
      const { result, queryClient } = renderHookWithClient(() => ({
        generate: useGeneratePlans(),
        undo: useGenerateUndo(),
      }))
      expect(result.current.undo.data).toBeUndefined()

      await act(() => result.current.generate.mutateAsync())

      expect(cached(queryClient)).toEqual(stored(initial()))
      const expected = { previous: initial(), generatedVersions: { 9: 3, 10: 8, 11: 5, 12: 4 } }
      expect(queryClient.getQueryData(keys.generateUndo)).toEqual(expected)
      await waitFor(() => expect(result.current.undo.data).toEqual(expected))
    })

    it('a replaced Generate replaces the older snapshot', async () => {
      mockApi('get', '/scenarios', () => HttpResponse.json(list(stored(initial()))))
      mockApi('post', '/scenarios/calculate', () => HttpResponse.json(list(proposals())))
      putCall(() => HttpResponse.json(list(stored(stored(initial())))))
      const { result, queryClient } = renderHookWithClient(() => useGeneratePlans())
      queryClient.setQueryData(keys.generateUndo, { previous: initial(), generatedVersions: {} })

      await act(() => result.current.mutateAsync())

      expect(queryClient.getQueryData<GenerateUndo>(keys.generateUndo)?.previous).toEqual(
        stored(initial()),
      )
    })

    it('a 409 refetches the plans, stores nothing and offers no Cofnij', async () => {
      const get = mockApi('get', '/scenarios', () => HttpResponse.json(list(initial())))
      mockApi('post', '/scenarios/calculate', () => HttpResponse.json(list(proposals())))
      putCall(() => HttpResponse.json(failure('version_conflict', 'version'), { status: 409 }))
      const { result, queryClient } = renderHookWithClient(() => ({
        scenarios: useScenarios(),
        generate: useGeneratePlans(),
      }))
      await waitFor(() => expect(result.current.scenarios.isSuccess).toBe(true))
      expect(get.calls).toHaveLength(1)

      const error = await act(() => result.current.generate.mutateAsync().catch((e: unknown) => e))

      expect((error as ApiError).has('version_conflict')).toBe(true)
      await waitFor(() => expect(get.calls.length).toBeGreaterThanOrEqual(3)) // generate read + refetch
      expect(queryClient.getQueryData(keys.generateUndo)).toBeUndefined()
      expect(cached(queryClient)).toEqual(initial())
    })

    it('a failed calculate sends no PUT and leaves the caches alone', async () => {
      mockApi('get', '/scenarios', () => HttpResponse.json(list(initial())))
      mockApi('post', '/scenarios/calculate', () =>
        HttpResponse.json(failure('internal_error'), { status: 500 }),
      )
      const put = putCall(() => HttpResponse.json(list(stored(initial()))))
      const { result, queryClient } = renderHookWithClient(() => useGeneratePlans())
      seedScenarios(queryClient)

      const error = await act(() => result.current.mutateAsync().catch((e: unknown) => e))

      expect(error).toBeInstanceOf(ApiError)
      expect(put.calls).toHaveLength(0)
      expect(cached(queryClient)).toEqual(initial())
      expect(queryClient.getQueryData(keys.generateUndo)).toBeUndefined()
    })
  })

  describe('useUndoGenerate', () => {
    const undoSnapshot = (): GenerateUndo => ({
      previous: initial(),
      generatedVersions: { 9: 3, 10: 8, 11: 5, 12: 4 },
    })

    function setup() {
      const rendered = renderHookWithClient(() => ({
        undo: useGenerateUndo(),
        restore: useUndoGenerate(),
      }))
      rendered.queryClient.setQueryData(keys.scenarios, stored(initial()))
      rendered.queryClient.setQueryData(keys.generateUndo, undoSnapshot())
      return rendered
    }

    it('PUTs the snapshot plans with the versions Generate produced', async () => {
      const put = putCall(() => HttpResponse.json(list(initial())))
      const { result } = setup()

      await act(() => result.current.restore.mutateAsync(undoSnapshot()))

      const body = put.calls[0] as ScenariosReplace
      expect(body.plans.map((p) => [p.capacity, p.basedOnVersion])).toEqual([
        [9, 3],
        [10, 8],
        [11, 5],
        [12, 4],
      ])
      expect(body.plans[1]?.tables).toEqual([
        { number: 1, guestIds: [4, 5], pinnedGuestIds: [] },
        { number: 2, guestIds: [6, 7], pinnedGuestIds: [] },
      ])
    })

    it('200: the restored plans replace the cache and the snapshot is gone', async () => {
      const restored = initial().map((s) => ({ ...s, version: s.version + 2 }))
      putCall(() => HttpResponse.json(list(restored)))
      const { result, queryClient } = setup()

      await act(() => result.current.restore.mutateAsync(undoSnapshot()))

      expect(cached(queryClient)).toEqual(restored)
      await waitFor(() => expect(result.current.undo.data).toBeUndefined())
    })

    it.each([
      [409, 'version_conflict'],
      [422, 'validation_failed'],
    ] as const)('%i drops the snapshot and refetches the real plans', async (status, code) => {
      putCall(() => HttpResponse.json(failure(code), { status }))
      const get = mockApi('get', '/scenarios', () => HttpResponse.json(list(initial())))
      const { result, queryClient } = setup()
      renderHookWithClient(() => useScenarios(), queryClient)

      const error = await act(() =>
        result.current.restore.mutateAsync(undoSnapshot()).catch((e: unknown) => e),
      )

      expect(error).toBeInstanceOf(ApiError)
      await waitFor(() => expect(result.current.undo.data).toBeUndefined())
      await waitFor(() => expect(get.calls).toHaveLength(1))
    })

    it('a 500 keeps the snapshot so Cofnij can be retried', async () => {
      putCall(() => HttpResponse.json(failure('internal_error'), { status: 500 }))
      const { result, queryClient } = setup()

      await act(() => result.current.restore.mutateAsync(undoSnapshot()).catch((e: unknown) => e))

      expect(queryClient.getQueryData(keys.generateUndo)).toEqual(undoSnapshot())
      expect(cached(queryClient)).toEqual(stored(initial()))
    })
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
    expect(cached(queryClient)?.[0]).toEqual(scenario9)
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
    expect(cached(queryClient)?.[0]).toEqual(scenario9)
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

describe('useResetPlan', () => {
  /** What the server answers after "Usuń plan": no tables, every cluster unseated, version + 1. */
  const emptied = () => makeScenario(10, makePlan([], [maciek, michal, placement(31, [31])]), 8)

  it('DELETEs without a body and replaces only that scenario with the server copy', async () => {
    const api = mockApi('delete', '/scenarios/10/tables', () =>
      HttpResponse.json(single(emptied())),
    )
    const { result, queryClient } = renderHookWithClient(() => useResetPlan())
    seedScenarios(queryClient)

    await act(() => result.current.mutateAsync({ capacity: 10 }))

    expect(api.calls).toEqual([null])
    expect(cached(queryClient)?.[1]).toEqual(emptied())
    expect(cached(queryClient)?.[0]).toEqual(scenario9)
    expect(cached(queryClient)?.[2]).toEqual(scenario11)
    expect(cached(queryClient)?.[3]).toEqual(scenario12)
  })

  it('rejects with the ApiError on 404 and leaves the caches alone', async () => {
    mockApi('delete', '/scenarios/10/tables', () =>
      HttpResponse.json(failure('not_found'), { status: 404 }),
    )
    const { result, queryClient } = renderHookWithClient(() => useResetPlan())
    seedScenarios(queryClient)

    const error = await act(() =>
      result.current.mutateAsync({ capacity: 10 }).catch((caught: unknown) => caught),
    )

    expect(error).toBeInstanceOf(ApiError)
    expect(cached(queryClient)).toEqual(initial())
  })

  it('is not optimistic: the plan stays as it was until the server answers', async () => {
    const hold = gate()
    mockApi('delete', '/scenarios/10/tables', async () => {
      await hold.opened
      return HttpResponse.json(single(emptied()))
    })
    const { result, queryClient } = renderHookWithClient(() => useResetPlan())
    seedScenarios(queryClient)

    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.mutateAsync({ capacity: 10 })
    })
    await waitFor(() => expect(result.current.isPending).toBe(true))
    expect(cached(queryClient)?.[1]).toEqual(scenario10())

    hold.open()
    await act(() => pending)
    expect(cached(queryClient)?.[1]).toEqual(emptied())
  })
})
