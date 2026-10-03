import { screen, waitFor, within } from '@testing-library/react'
import { keys } from '@/api/keys'
import { CAPACITIES, type Capacity } from '@/domain/capacity'
import type { Proposal } from '@/domain/types'
import { evenPlan, serveScenarios, fourProposals, fourScenarios } from '@/features/plans/fixtures'
import { PlansPage } from '@/features/plans/PlansPage'
import { makePlan, makeScenario, placement } from '@/test/builders'
import { renderPage } from '@/test/renderPage'
import { failure, gate, HttpResponse, list, mockApi, single } from '@/test/server'

const card = (name: string) => screen.getByRole('article', { name })

describe('PlansPage: compare the four plans', () => {
  it('shows a card per capacity with table count, fill bars, score and violations', async () => {
    serveScenarios(fourScenarios())
    renderPage(<PlansPage />)

    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    expect(within(ten).getByText('Stoły').nextSibling).toHaveTextContent('3')
    expect(within(ten).getByText('Zadowolenie').nextSibling).toHaveTextContent('42,5')
    expect(within(ten).getByText('Bez naruszeń', { exact: false })).toBeInTheDocument()
    expect(within(ten).getByRole('img', { name: /Obłożenie stołów.*8, 8, 8/ })).toBeInTheDocument()

    const cards = screen.getAllByRole('article')
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Plan na 9 miejsc',
      'Plan na 10 miejsc',
      'Plan na 11 miejsc',
      'Plan na 12 miejsc',
    ])
  })

  it('links every card to its floor plan under the router basename', async () => {
    serveScenarios(fourScenarios())
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
    serveScenarios(fourScenarios({ 10: broken }))
    renderPage(<PlansPage />)

    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    expect(within(ten).getByText('Wymaga przeliczenia')).toBeInTheDocument()
    expect(within(ten).getByText('Stół 1 jest przepełniony')).toBeInTheDocument()
    expect(within(ten).getByRole('button', { name: 'Przelicz / Generuj' })).toBeInTheDocument()
    // the calm plans carry no banner
    expect(within(card('Plan na 9 miejsc')).queryByText('Wymaga przeliczenia')).toBeNull()
  })

  it('never regenerates by itself', async () => {
    const calculate = mockApi('post', '/scenarios/calculate', () =>
      HttpResponse.json(list(fourProposals())),
    )
    serveScenarios(fourScenarios({ 10: makePlan([{ number: 1, clusters: [] }]) }))
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
  it('Generate shows four proposals next to the current plans, and writes nothing', async () => {
    serveScenarios(fourScenarios())
    const proposals = fourProposals()
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
    serveScenarios(fourScenarios())
    const hold = gate()
    mockApi('post', '/scenarios/calculate', async () => {
      await hold.opened
      return HttpResponse.json(list(fourProposals()))
    })
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(screen.getByRole('button', { name: 'Generuj plany' }))

    expect(await screen.findByRole('button', { name: 'Liczę plany…' })).toBeDisabled()
    hold.open()
    await screen.findByRole('region', { name: 'Propozycje do przejrzenia' })
  })

  it('a failed Generate shows a toast and no preview', async () => {
    serveScenarios(fourScenarios())
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
    serveScenarios(fourScenarios())
    const { user, queryClient } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    queryClient.setQueryData(keys.proposals, fourProposals())
    await screen.findByRole('region', { name: 'Propozycje do przejrzenia' })

    await user.click(screen.getByRole('button', { name: 'Odrzuć' }))

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Propozycje do przejrzenia' })).toBeNull(),
    )
    expect(screen.getByRole('article', { name: 'Plan na 10 miejsc' })).toBeInTheDocument()
  })

  function acceptHandlers(statusByCapacity: Partial<Record<number, number>> = {}) {
    const store = fourScenarios()
    return ([9, 10, 11, 12] as const).map((capacity) => {
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
    serveScenarios(fourScenarios())
    const handlers = acceptHandlers()
    const { user, queryClient } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    queryClient.setQueryData(keys.proposals, fourProposals())

    await user.click(await screen.findByRole('button', { name: 'Akceptuj wszystkie' }))

    await waitFor(() => handlers.forEach(({ api }) => expect(api.calls).toHaveLength(1)))
    const body = handlers[1]!.api.calls[0] as { basedOnVersion: number; tables: unknown[] }
    expect(body.basedOnVersion).toBe(7)
    expect(body.tables).toHaveLength(3)
    expect(body.tables[0]).toEqual({ number: 1, guestIds: [1, 2, 3, 4, 5, 6, 7, 8] })
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Propozycje do przejrzenia' })).toBeNull(),
    )
    expect(await screen.findByText('Zapisano plany: 9, 10, 11, 12 miejsc.')).toBeInTheDocument()
  })

  it('one 409 shows a toast for that plan while the others stay accepted', async () => {
    serveScenarios(fourScenarios())
    acceptHandlers({ 10: 409 })
    const { user, queryClient } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    queryClient.setQueryData(keys.proposals, fourProposals())

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
    serveScenarios(fourScenarios())
    const handlers = acceptHandlers()
    const { user, queryClient } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    queryClient.setQueryData(keys.proposals, fourProposals())
    const preview = await screen.findByRole('region', { name: 'Propozycje do przejrzenia' })

    await user.click(
      within(within(preview).getByRole('article', { name: 'Propozycja na 12 miejsc' })).getByRole(
        'button',
        { name: /Akceptuj/ },
      ),
    )

    await waitFor(() => expect(handlers[3]!.api.calls).toHaveLength(1))
    expect(handlers[0]!.api.calls).toHaveLength(0)
    await waitFor(() =>
      expect(
        within(preview).queryByRole('article', { name: 'Propozycja na 12 miejsc' }),
      ).toBeNull(),
    )
  })

  it('a proposal older than the stored plan is marked stale and cannot be accepted', async () => {
    const scenarios = fourScenarios()
    scenarios[1] = makeScenario(10, evenPlan(3, 8), 8) // someone moved a chip after Generate
    serveScenarios(scenarios)
    const { queryClient } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    const proposals: Proposal[] = fourProposals()
    queryClient.setQueryData(keys.proposals, proposals)

    const stale = await screen.findByRole('article', { name: 'Propozycja na 10 miejsc' })
    expect(within(stale).getByRole('alert')).toHaveTextContent('zmienił się po wygenerowaniu')
    expect(within(stale).queryByRole('button', { name: /Akceptuj/ })).toBeNull()
    expect(within(stale).getByRole('button', { name: 'Generuj ponownie' })).toBeInTheDocument()
  })
})

// --- "Usuń plan" / "Usuń wszystkie plany" ------------------------------------------------------

/** What the server answers after a reset: no tables, every guest unseated, version + 1. */
function emptied(capacity: Capacity, guestCount = 24) {
  const unseated = Array.from({ length: guestCount }, (_, i) => placement(i + 1, [i + 1]))
  return makeScenario(capacity, makePlan([], unseated), 9)
}

const resetCall = (capacity: Capacity, respond?: () => Response | Promise<Response>) =>
  mockApi(
    'delete',
    `/scenarios/${capacity}/tables`,
    respond ?? (() => HttpResponse.json(single(emptied(capacity)))),
  )

describe('PlansPage: delete plans', () => {
  it('"Usuń plan" on a card asks first, says how many tables and guests are cleared, and Anuluj sends nothing', async () => {
    serveScenarios(fourScenarios())
    const api = resetCall(10)
    const { user } = renderPage(<PlansPage />)
    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(within(ten).getByRole('button', { name: /Usuń plan/ }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Usunąć plan na 10 miejsc?' })
    expect(within(dialog).getByText(/3 stoły i 24 osoby przy stołach/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Pinezki znikną/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Tego nie da się cofnąć/)).toBeInTheDocument()
    expect(api.calls).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Anuluj' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.calls).toHaveLength(0)
    expect(within(ten).queryByText('Brak stołów w tym planie.')).toBeNull()
  })

  it('confirming deletes only that plan and the card shows the empty state', async () => {
    serveScenarios(fourScenarios())
    const api = resetCall(10)
    const { user } = renderPage(<PlansPage />)
    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(within(ten).getByRole('button', { name: /Usuń plan/ }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Usuń plan 10-osobowy' }))

    expect(await within(ten).findByText('Brak stołów w tym planie.')).toBeInTheDocument()
    expect(within(ten).getByRole('button', { name: 'Przelicz / Generuj' })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await screen.findByText('Usunięto plan na 10 miejsc.')).toBeInTheDocument()
    expect(api.calls).toEqual([null])
    // the other plans are untouched
    expect(within(card('Plan na 9 miejsc')).queryByText('Brak stołów w tym planie.')).toBeNull()
    expect(within(card('Plan na 12 miejsc')).queryByText('Brak stołów w tym planie.')).toBeNull()
  })

  it('keeps the dialog open until the server answers', async () => {
    serveScenarios(fourScenarios())
    const hold = gate()
    resetCall(10, async () => {
      await hold.opened
      return HttpResponse.json(single(emptied(10)))
    })
    const { user } = renderPage(<PlansPage />)
    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    await user.click(within(ten).getByRole('button', { name: /Usuń plan/ }))
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'Usuń plan 10-osobowy' }))
    await user.keyboard('{Escape}')

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Usuwam/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(ten).queryByText('Brak stołów w tym planie.')).toBeNull() // nothing optimistic

    hold.open()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(within(ten).getByText('Brak stołów w tym planie.')).toBeInTheDocument()
  })

  it('a refused delete stays in the dialog with an inline message and a toast', async () => {
    serveScenarios(fourScenarios())
    resetCall(10, () => HttpResponse.json(failure('internal_error'), { status: 500 }))
    const { user } = renderPage(<PlansPage />)
    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    await user.click(within(ten).getByRole('button', { name: /Usuń plan/ }))
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'Usuń plan 10-osobowy' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/po stronie serwera/)
    expect(screen.getAllByText(/Coś poszło nie tak po stronie serwera/)).toHaveLength(2) // inline + toast
    expect(within(dialog).getByRole('button', { name: 'Usuń plan 10-osobowy' })).toBeEnabled()
    expect(within(ten).queryByText('Brak stołów w tym planie.')).toBeNull()
  })

  it('"Usuń plan" is disabled, with the reason, on a plan with no tables', async () => {
    serveScenarios(fourScenarios({ 10: makePlan([], []) }))
    renderPage(<PlansPage />)
    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    const button = within(ten).getByRole('button', { name: /Usuń plan/ })

    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Ten plan nie ma stołów, nie ma co usuwać.')
    expect(
      within(card('Plan na 9 miejsc')).getByRole('button', { name: /Usuń plan/ }),
    ).toBeEnabled()
  })

  it('"Usuń wszystkie plany" needs the acknowledgement checkbox, then sends four DELETEs (9, 10, 11, 12)', async () => {
    serveScenarios(fourScenarios())
    const calls = CAPACITIES.map((capacity) => resetCall(capacity))
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(screen.getByRole('button', { name: 'Usuń wszystkie plany' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Usunąć wszystkie cztery plany?',
    })
    expect(
      within(dialog).getByText(/Plan 9-osobowy: 3 stoły i 24 osoby przy stołach/),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Plan 11-osobowy: 2 stoły i 22 osoby przy stołach/),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Plan 12-osobowy: 2 stoły i 24 osoby przy stołach/),
    ).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Usuń wszystkie plany' })
    expect(confirm).toBeDisabled()

    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Rozumiem, że tego nie da się cofnąć' }),
    )
    expect(confirm).toBeEnabled()
    expect(calls.map((c) => c.calls.length)).toEqual([0, 0, 0, 0])
    await user.click(confirm)

    expect(await screen.findByText('Usunięto wszystkie plany.')).toBeInTheDocument()
    expect(calls.map((c) => c.calls.length)).toEqual([1, 1, 1, 1])
    expect(screen.getAllByText('Brak stołów w tym planie.')).toHaveLength(4)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('when one of the four fails, the toast names that plan and the others stay deleted', async () => {
    // a server that remembers: plans 9, 11 and 12 are empty once deleted, so the refetch agrees
    let stored = fourScenarios()
    const empty = (capacity: Capacity) => () => {
      stored = stored.map((s) => (s.capacity === capacity ? emptied(capacity) : s))
      return HttpResponse.json(single(emptied(capacity)))
    }
    mockApi('get', '/scenarios', () => HttpResponse.json(list(stored)))
    resetCall(9, empty(9))
    resetCall(10, () => HttpResponse.json(failure('internal_error'), { status: 500 }))
    resetCall(11, empty(11))
    resetCall(12, empty(12))
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    await user.click(screen.getByRole('button', { name: 'Usuń wszystkie plany' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('checkbox'))

    await user.click(within(dialog).getByRole('button', { name: 'Usuń wszystkie plany' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /Nie udało się usunąć planu: 10/,
    )
    expect(await screen.findAllByText(/Nie udało się usunąć planu: 10/)).toHaveLength(2) // inline + toast
    await user.click(within(dialog).getByRole('button', { name: 'Anuluj' }))
    expect(
      within(card('Plan na 9 miejsc')).getByText('Brak stołów w tym planie.'),
    ).toBeInTheDocument()
    expect(
      within(card('Plan na 11 miejsc')).getByText('Brak stołów w tym planie.'),
    ).toBeInTheDocument()
    expect(
      within(card('Plan na 12 miejsc')).getByText('Brak stołów w tym planie.'),
    ).toBeInTheDocument()
    expect(within(card('Plan na 10 miejsc')).queryByText('Brak stołów w tym planie.')).toBeNull()
  })

  it('"Usuń wszystkie plany" is disabled when all four plans are empty', async () => {
    const none = makePlan([], [])
    serveScenarios(fourScenarios({ 9: none, 10: none, 11: none, 12: none }))
    renderPage(<PlansPage />)

    expect(await screen.findByRole('button', { name: 'Usuń wszystkie plany' })).toBeDisabled()
  })

  it('a deleted plan leaves the preview, the other proposals stay', async () => {
    serveScenarios(fourScenarios())
    resetCall(10)
    const { user, queryClient } = renderPage(<PlansPage />)
    queryClient.setQueryData(keys.proposals, fourProposals())
    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(within(ten).getByRole('button', { name: /Usuń plan/ }))
    await user.click(await screen.findByRole('button', { name: 'Usuń plan 10-osobowy' }))

    await screen.findByText('Usunięto plan na 10 miejsc.')
    expect(screen.queryByRole('article', { name: 'Propozycja na 10 miejsc' })).toBeNull()
    expect(screen.getByRole('article', { name: 'Propozycja na 9 miejsc' })).toBeInTheDocument()
  })
})
