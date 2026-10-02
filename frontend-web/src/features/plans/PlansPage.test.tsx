import { screen, waitFor, within } from '@testing-library/react'
import { keys } from '@/api/keys'
import type { Proposal } from '@/domain/types'
import { evenPlan, serveScenarios, threeProposals, threeScenarios } from '@/features/plans/fixtures'
import { PlansPage } from '@/features/plans/PlansPage'
import { makePlan, makeScenario, placement } from '@/test/builders'
import { renderPage } from '@/test/renderPage'
import { failure, gate, HttpResponse, list, mockApi, single } from '@/test/server'

const card = (name: string) => screen.getByRole('article', { name })

describe('PlansPage: compare the three plans', () => {
  it('shows a card per capacity with table count, fill bars, score and violations', async () => {
    serveScenarios(threeScenarios())
    renderPage(<PlansPage />)

    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    expect(within(ten).getByText('Stoły').nextSibling).toHaveTextContent('3')
    expect(within(ten).getByText('Zadowolenie').nextSibling).toHaveTextContent('42,5')
    expect(within(ten).getByText('Bez naruszeń', { exact: false })).toBeInTheDocument()
    expect(within(ten).getByRole('img', { name: /Obłożenie stołów.*8, 8, 8/ })).toBeInTheDocument()

    const cards = screen.getAllByRole('article')
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Plan na 8 miejsc',
      'Plan na 10 miejsc',
      'Plan na 12 miejsc',
    ])
  })

  it('links every card to its floor plan under the router basename', async () => {
    serveScenarios(threeScenarios())
    renderPage(<PlansPage />)

    const link = await screen.findByRole('link', { name: /Otwórz plan\s*na 12 miejsc/ })
    expect(link).toHaveAttribute('href', '/wesele/plany/12')
  })

  it('flags a plan that needs recalculation, with the reason and a call to action', async () => {
    const broken = makePlan(
      [
        { number: 1, clusters: [placement(1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])] },
        { number: 2, clusters: [placement(20, [20, 21, 22, 23, 24, 25])] },
      ],
      [],
    )
    broken.violations = [{ code: 'over_capacity', message: 'x', tableNumber: 1, guestIds: [] }]
    broken.summary = { ...broken.summary, violationCount: 1, needsRecalculation: true }
    serveScenarios(threeScenarios({ 10: broken }))
    renderPage(<PlansPage />)

    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    expect(within(ten).getByText('Wymaga przeliczenia')).toBeInTheDocument()
    expect(within(ten).getByText('Stół 1 jest przepełniony')).toBeInTheDocument()
    expect(within(ten).getByRole('button', { name: 'Przelicz / Generuj' })).toBeInTheDocument()
    // the calm plans carry no banner
    expect(within(card('Plan na 8 miejsc')).queryByText('Wymaga przeliczenia')).toBeNull()
  })

  it('never regenerates by itself', async () => {
    const calculate = mockApi('post', '/scenarios/calculate', () =>
      HttpResponse.json(list(threeProposals())),
    )
    serveScenarios(threeScenarios({ 10: makePlan([{ number: 1, clusters: [] }]) }))
    renderPage(<PlansPage />)
    await screen.findByText('Wymaga przeliczenia')

    expect(calculate.calls).toHaveLength(0)
  })

  it('says so and offers a retry when the plans cannot be loaded', async () => {
    mockApi('get', '/scenarios', () => HttpResponse.error())
    renderPage(<PlansPage />)

    expect(await screen.findByText(/Brak połączenia z serwerem/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeInTheDocument()
  })
})

describe('PlansPage: generate, preview, accept', () => {
  it('Generate shows three proposals next to the current plans, and writes nothing', async () => {
    serveScenarios(threeScenarios())
    const proposals = threeProposals()
    proposals[1] = { ...proposals[1]!, plan: evenPlan(4, 6) }
    const calculate = mockApi('post', '/scenarios/calculate', () =>
      HttpResponse.json(list(proposals)),
    )
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(screen.getByRole('button', { name: 'Generuj plany' }))

    const preview = await screen.findByRole('region', { name: 'Propozycje do przejrzenia' })
    expect(calculate.calls).toHaveLength(1)
    const ten = within(preview).getByRole('article', { name: 'Propozycja na 10 miejsc' })
    expect(within(ten).getByText('Stoły').nextSibling).toHaveTextContent('4')
    expect(within(ten).getByText('obecnie 3')).toBeInTheDocument() // the stored plan, for comparison
    // the stored plans are still shown below
    expect(screen.getByRole('article', { name: 'Plan na 10 miejsc' })).toBeInTheDocument()
  })

  it('disables Generate while the server computes and says so', async () => {
    serveScenarios(threeScenarios())
    const hold = gate()
    mockApi('post', '/scenarios/calculate', async () => {
      await hold.opened
      return HttpResponse.json(list(threeProposals()))
    })
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(screen.getByRole('button', { name: 'Generuj plany' }))

    expect(await screen.findByRole('button', { name: 'Liczę plany…' })).toBeDisabled()
    hold.open()
    await screen.findByRole('region', { name: 'Propozycje do przejrzenia' })
  })

  it('a failed Generate shows a toast and no preview', async () => {
    serveScenarios(threeScenarios())
    mockApi('post', '/scenarios/calculate', () =>
      HttpResponse.json(failure('internal_error'), { status: 500 }),
    )
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(screen.getByRole('button', { name: 'Generuj plany' }))

    expect(await screen.findByText(/Coś poszło nie tak po stronie serwera/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Propozycje do przejrzenia' })).toBeNull()
  })

  it('Odrzuć clears the preview and keeps the stored plans', async () => {
    serveScenarios(threeScenarios())
    const { user, queryClient } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    queryClient.setQueryData(keys.proposals, threeProposals())
    await screen.findByRole('region', { name: 'Propozycje do przejrzenia' })

    await user.click(screen.getByRole('button', { name: 'Odrzuć' }))

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Propozycje do przejrzenia' })).toBeNull(),
    )
    expect(screen.getByRole('article', { name: 'Plan na 10 miejsc' })).toBeInTheDocument()
  })

  function acceptHandlers(statusByCapacity: Partial<Record<number, number>> = {}) {
    const store = threeScenarios()
    return ([8, 10, 12] as const).map((capacity) => {
      const stored = store.find((s) => s.capacity === capacity)!
      return {
        capacity,
        api: mockApi('put', `/scenarios/${capacity}/assignments`, () => {
          const status = statusByCapacity[capacity] ?? 200
          if (status === 409) {
            return HttpResponse.json(failure('version_conflict'), { status })
          }
          return HttpResponse.json(single({ ...stored, version: stored.version + 1 }))
        }),
      }
    })
  }

  it('"Akceptuj wszystkie" sends one PUT per plan with basedOnVersion and the proposal tables', async () => {
    serveScenarios(threeScenarios())
    const handlers = acceptHandlers()
    const { user, queryClient } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    queryClient.setQueryData(keys.proposals, threeProposals())

    await user.click(await screen.findByRole('button', { name: 'Akceptuj wszystkie' }))

    await waitFor(() => handlers.forEach(({ api }) => expect(api.calls).toHaveLength(1)))
    const body = handlers[1]!.api.calls[0] as { basedOnVersion: number; tables: unknown[] }
    expect(body.basedOnVersion).toBe(7)
    expect(body.tables).toHaveLength(3)
    expect(body.tables[0]).toEqual({ number: 1, guestIds: [1, 2, 3, 4, 5, 6, 7, 8] })
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Propozycje do przejrzenia' })).toBeNull(),
    )
    expect(await screen.findByText('Zapisano plany: 8, 10, 12 miejsc.')).toBeInTheDocument()
  })

  it('one 409 shows a toast for that plan while the others stay accepted', async () => {
    serveScenarios(threeScenarios())
    acceptHandlers({ 10: 409 })
    const { user, queryClient } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    queryClient.setQueryData(keys.proposals, threeProposals())

    await user.click(await screen.findByRole('button', { name: 'Akceptuj wszystkie' }))

    expect(
      await screen.findByText(/Plan na 10 miejsc zmienił się od wygenerowania propozycji/),
    ).toBeInTheDocument()
    // only the conflicting proposal is left in the preview
    await waitFor(() => {
      const preview = screen.getByRole('region', { name: 'Propozycje do przejrzenia' })
      expect(within(preview).getAllByRole('article')).toHaveLength(1)
      expect(
        within(preview).getByRole('article', { name: 'Propozycja na 10 miejsc' }),
      ).toBeInTheDocument()
    })
  })

  it('accepts one proposal alone', async () => {
    serveScenarios(threeScenarios())
    const handlers = acceptHandlers()
    const { user, queryClient } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    queryClient.setQueryData(keys.proposals, threeProposals())
    const preview = await screen.findByRole('region', { name: 'Propozycje do przejrzenia' })

    await user.click(
      within(within(preview).getByRole('article', { name: 'Propozycja na 12 miejsc' })).getByRole(
        'button',
        { name: /Akceptuj/ },
      ),
    )

    await waitFor(() => expect(handlers[2]!.api.calls).toHaveLength(1))
    expect(handlers[0]!.api.calls).toHaveLength(0)
    await waitFor(() =>
      expect(
        within(preview).queryByRole('article', { name: 'Propozycja na 12 miejsc' }),
      ).toBeNull(),
    )
  })

  it('a proposal older than the stored plan is marked stale and cannot be accepted', async () => {
    const scenarios = threeScenarios()
    scenarios[1] = makeScenario(10, evenPlan(3, 8), 8) // someone moved a chip after Generate
    serveScenarios(scenarios)
    const { queryClient } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    const proposals: Proposal[] = threeProposals()
    queryClient.setQueryData(keys.proposals, proposals)

    const stale = await screen.findByRole('article', { name: 'Propozycja na 10 miejsc' })
    expect(within(stale).getByRole('alert')).toHaveTextContent('zmienił się po wygenerowaniu')
    expect(within(stale).queryByRole('button', { name: /Akceptuj/ })).toBeNull()
    expect(within(stale).getByRole('button', { name: 'Generuj ponownie' })).toBeInTheDocument()
  })
})
