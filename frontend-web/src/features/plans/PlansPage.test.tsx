import { act, screen, waitFor, within } from '@testing-library/react'
import { keys } from '@/api/keys'
import { CAPACITIES, type Capacity } from '@/domain/capacity'
import type { Scenario, ScenariosReplace } from '@/domain/types'
import {
  evenPlan,
  fourProposals,
  fourScenarios,
  serveGenerateFlow,
  serveScenarios,
} from '@/features/plans/fixtures'
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

/** Four plans of 3 tables before, 4 tables after Generate (versions + 1), as the server stores them. */
function generateScenarios() {
  const before = fourScenarios()
  const generated = before.map((s) => makeScenario(s.capacity, evenPlan(4, 6), s.version + 1))
  const proposals = before.map((s) => ({
    capacity: s.capacity,
    basedOnVersion: s.version,
    plan: evenPlan(4, 6),
  }))
  return { before, generated, proposals }
}

const bar = () => screen.getByText(barText).closest('[role=status]')
const barText = 'Wygenerowano nowe plany. Poprzednie można przywrócić.'
const tablesOf = (name: string) => within(card(name)).getByText('Stoły').nextSibling

describe('PlansPage: Generate stores the plans at once', () => {
  it('shows the new tables in the plan cards, with no preview and no accept step', async () => {
    const { before, generated, proposals } = generateScenarios()
    const flow = serveGenerateFlow({ before, proposals, stored: [generated] })
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    expect(tablesOf('Plan na 10 miejsc')).toHaveTextContent('3')

    await user.click(screen.getByRole('button', { name: 'Generuj plany' }))

    await waitFor(() => expect(tablesOf('Plan na 10 miejsc')).toHaveTextContent('4'))
    expect(flow.calculate.calls).toHaveLength(1)
    expect(flow.put.calls).toHaveLength(1)
    const body = flow.put.calls[0] as ScenariosReplace
    expect(body.plans.map((p) => [p.capacity, p.basedOnVersion])).toEqual([
      [9, 4],
      [10, 7],
      [11, 3],
      [12, 2],
    ])
    expect(
      await screen.findByText('Zapisano nowe plany: 9, 10, 11, 12 miejsc.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Propozycje do przejrzenia' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Akceptuj/ })).toBeNull()
    expect(screen.getByText(barText)).toBeInTheDocument()
  })

  it('disables Generate while the server computes and stores, and says so', async () => {
    const { before, generated, proposals } = generateScenarios()
    serveGenerateFlow({ before, proposals, stored: [generated] })
    const hold = gate()
    mockApi('post', '/scenarios/calculate', async () => {
      await hold.opened
      return HttpResponse.json(list(proposals))
    })
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(screen.getByRole('button', { name: 'Generuj plany' }))

    expect(await screen.findByRole('button', { name: 'Liczę i zapisuję plany…' })).toBeDisabled()
    hold.open()
    await screen.findByText(barText)
  })

  it('a failed Generate shows a toast, keeps the plans and offers no Cofnij', async () => {
    const { before, generated, proposals } = generateScenarios()
    serveGenerateFlow({ before, proposals, stored: [generated] })
    mockApi('post', '/scenarios/calculate', () =>
      HttpResponse.json(failure('internal_error'), { status: 500 }),
    )
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(screen.getByRole('button', { name: 'Generuj plany' }))

    expect(await screen.findByText(/Coś poszło nie tak po stronie serwera/)).toBeInTheDocument()
    expect(tablesOf('Plan na 10 miejsc')).toHaveTextContent('3')
    expect(screen.queryByText(barText)).toBeNull()
  })

  it('a 409 (plans changed meanwhile) says to click again and stores nothing', async () => {
    const { before, proposals } = generateScenarios()
    // nothing prepared: the fake refuses the PUT like a server whose versions moved on
    serveGenerateFlow({ before, proposals, stored: [] })
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(screen.getByRole('button', { name: 'Generuj plany' }))

    expect(
      await screen.findByText(
        'Plany zmieniły się w międzyczasie — kliknij „Generuj plany” jeszcze raz.',
      ),
    ).toBeInTheDocument()
    expect(tablesOf('Plan na 10 miejsc')).toHaveTextContent('3')
    expect(screen.queryByText(barText)).toBeNull()
  })

  it('"Przelicz / Generuj" on a card does exactly the same and stays on the page', async () => {
    const { before, generated, proposals } = generateScenarios()
    before[1] = makeScenario(10, makePlan([{ number: 1, clusters: [] }]), 7) // needs recalculation
    const flow = serveGenerateFlow({ before, proposals, stored: [generated] })
    const { user } = renderPage(<PlansPage />)
    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(within(ten).getByRole('button', { name: 'Przelicz / Generuj' }))

    await screen.findByText(barText)
    expect(flow.put.calls).toHaveLength(1)
    expect(tablesOf('Plan na 10 miejsc')).toHaveTextContent('4')
    expect(screen.getByRole('heading', { name: 'Plany' })).toBeInTheDocument()
  })
})

describe('PlansPage: Cofnij', () => {
  async function afterGenerate(stored: Scenario[][] = []) {
    const { before, generated, proposals } = generateScenarios()
    const flow = serveGenerateFlow({ before, proposals, stored: [generated, ...stored] })
    const rendered = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    await rendered.user.click(screen.getByRole('button', { name: 'Generuj plany' }))
    await screen.findByText(barText)
    return { ...rendered, flow, before, generated }
  }

  it('restores the previous plans with the versions Generate produced, then the bar is gone', async () => {
    const { before, user, flow } = await afterGenerate([
      fourScenarios().map((s) => ({ ...s, version: s.version + 2 })),
    ])
    expect(bar()).toHaveTextContent(barText)

    await user.click(screen.getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(tablesOf('Plan na 10 miejsc')).toHaveTextContent('3'))
    const body = flow.put.calls[1] as ScenariosReplace
    expect(body.plans.map((p) => [p.capacity, p.basedOnVersion])).toEqual([
      [9, 5],
      [10, 8],
      [11, 4],
      [12, 3],
    ])
    expect(body.plans[1]?.tables).toHaveLength(before[1]!.plan.tables.length)
    expect(await screen.findByText('Przywrócono poprzednie plany.')).toBeInTheDocument()
    expect(screen.queryByText(barText)).toBeNull()
  })

  it('says "Przywracam…" and disables the button while it runs', async () => {
    const { user } = await afterGenerate([fourScenarios()])
    const hold = gate()
    mockApi('put', '/scenarios', async () => {
      await hold.opened
      return HttpResponse.json(list(fourScenarios()))
    })

    await user.click(screen.getByRole('button', { name: 'Cofnij' }))

    expect(await screen.findByRole('button', { name: 'Przywracam…' })).toBeDisabled()
    hold.open()
    await waitFor(() => expect(screen.queryByText(barText)).toBeNull())
  })

  it('a 409 explains that the plans changed, drops the offer and shows the stored plans', async () => {
    const { user } = await afterGenerate()
    mockApi('put', '/scenarios', () =>
      HttpResponse.json(failure('version_conflict', 'version'), { status: 409 }),
    )

    await user.click(screen.getByRole('button', { name: 'Cofnij' }))

    expect(
      await screen.findByText('Nie można cofnąć — plany zmieniono po wygenerowaniu.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(barText)).toBeNull()
    expect(tablesOf('Plan na 10 miejsc')).toHaveTextContent('4') // what is stored now
  })

  it('a network error keeps the offer so Cofnij can be retried', async () => {
    const { user } = await afterGenerate()
    mockApi('put', '/scenarios', () => HttpResponse.error())

    await user.click(screen.getByRole('button', { name: 'Cofnij' }))

    expect(await screen.findByText(/Brak połączenia z serwerem/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cofnij' })).toBeEnabled()
  })

  it('hides itself as soon as any plan version moves on (an edit here or on another device)', async () => {
    const { queryClient, generated } = await afterGenerate()

    act(() => {
      queryClient.setQueryData(
        keys.scenarios,
        generated.map((s) => (s.capacity === 12 ? { ...s, version: s.version + 1 } : s)),
      )
    })

    await waitFor(() => expect(screen.queryByText(barText)).toBeNull())
  })

  it('"Zamknij" forgets the snapshot', async () => {
    const { user, queryClient } = await afterGenerate()

    await user.click(screen.getByRole('button', { name: 'Zamknij' }))

    await waitFor(() => expect(screen.queryByText(barText)).toBeNull())
    expect(queryClient.getQueryData(keys.generateUndo)).toBeUndefined()
  })

  it('is not offered when nothing was generated in this session', async () => {
    serveScenarios(fourScenarios())
    renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull()
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

  it('deleting a plan bumps its version, so a pending Cofnij is no longer offered', async () => {
    const { before, generated, proposals } = generateScenarios()
    serveGenerateFlow({ before, proposals, stored: [generated] })
    resetCall(10)
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    await user.click(screen.getByRole('button', { name: 'Generuj plany' }))
    await screen.findByText(barText)

    await user.click(within(card('Plan na 10 miejsc')).getByRole('button', { name: /Usuń plan/ }))
    await user.click(await screen.findByRole('button', { name: 'Usuń plan 10-osobowy' }))

    await screen.findByText('Usunięto plan na 10 miejsc.')
    expect(screen.queryByText(barText)).toBeNull()
  })
})
