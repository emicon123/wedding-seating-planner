import { act, screen, waitFor, within } from '@testing-library/react'
import { keys } from '@/api/keys'
import { PLAN_KEYS } from '@/domain/plans'
import type { PlanKey, Scenario, ScenariosReplace, SeatingPlan } from '@/domain/types'
import {
  evenPlan,
  fiveProposals,
  fiveScenarios,
  serveGenerateFlow,
  serveScenarios,
} from '@/features/plans/fixtures'
import { PlansPage } from '@/features/plans/PlansPage'
import { fillsPlan, makePlan, makeScenario, placement } from '@/test/builders'
import { renderPage } from '@/test/renderPage'
import { failure, gate, HttpResponse, list, mockApi, single } from '@/test/server'

const card = (name: string) => screen.getByRole('article', { name })

/** The "Potrzebne stoły: ..." paragraph of a card (its text is spread over icons and spans). */
const neededLine = (name: string): string | null =>
  within(card(name))
    .queryAllByText((_, element) => /^Potrzebne stoły/.test(element?.textContent ?? ''), {
      selector: 'p',
    })
    .map((element) => element.textContent)[0] ?? null

/** The same plan with `count` guests marked as sitting without any acquaintance (satisfaction -1). */
function withIsolated(plan: SeatingPlan, count: number): SeatingPlan {
  return {
    ...plan,
    guestScores: Array.from({ length: count }, (_, i) => ({
      guestId: i + 1,
      tableNumber: 1,
      satisfaction: -1,
      preferredTotal: 1,
      preferredAtTable: 0,
      fallbackAtTable: 0,
      strangersAtTable: 0,
    })),
  }
}

const NOTE = /1 stół więcej niż plan 12/

describe('PlansPage: the mixed card explains its extra table', () => {
  it('says so when it has one table more than plan 12 and fewer guests without acquaintances', async () => {
    serveScenarios(
      fiveScenarios({
        12: withIsolated(fillsPlan([12, 12]), 3),
        mixed: withIsolated(fillsPlan([12, 12, 8]), 1),
      }),
    )
    renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan mieszany' })

    expect(
      within(card('Plan mieszany')).getByText(
        '1 stół więcej niż plan 12 — mniej osób bez znajomych (1 zamiast 3)',
      ),
    ).toBeInTheDocument()
    expect(within(card('Plan na 12 miejsc')).queryByText(NOTE)).toBeNull()
  })

  it('stays silent when the extra table does not reduce the isolated guests', async () => {
    serveScenarios(
      fiveScenarios({
        12: withIsolated(fillsPlan([12, 12]), 2),
        mixed: withIsolated(fillsPlan([12, 12, 8]), 2),
      }),
    )
    renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan mieszany' })

    expect(within(card('Plan mieszany')).queryByText(NOTE)).toBeNull()
  })

  it('stays silent when the table count is the same as plan 12 (also after hand edits)', async () => {
    serveScenarios(
      fiveScenarios({
        12: withIsolated(fillsPlan([12, 12]), 3),
        mixed: withIsolated(fillsPlan([12, 12]), 1),
      }),
    )
    renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan mieszany' })

    expect(within(card('Plan mieszany')).queryByText(NOTE)).toBeNull()
  })
})

describe('PlansPage: compare the five plans', () => {
  it('shows a card per plan, mixed last, with table count, fill bars, score and violations', async () => {
    serveScenarios(fiveScenarios())
    renderPage(<PlansPage />)

    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    expect(within(ten).getByText('Stoły').nextSibling).toHaveTextContent('3')
    expect(within(ten).getByText('Zadowolenie').nextSibling).toHaveTextContent('42')
    expect(within(ten).getByText('Bez naruszeń', { exact: false })).toBeInTheDocument()
    expect(within(ten).getByRole('img', { name: /Obłożenie stołów.*8, 8, 8/ })).toBeInTheDocument()

    const cards = screen.getAllByRole('article')
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Plan na 9 miejsc',
      'Plan na 10 miejsc',
      'Plan na 11 miejsc',
      'Plan na 12 miejsc',
      'Plan mieszany',
    ])
    expect(within(card('Plan mieszany')).getByText('Mieszany')).toBeInTheDocument()
    expect(within(card('Plan mieszany')).getByText('Stoły 9–12-osobowe')).toBeInTheDocument()
  })

  it('says on every card which tables the venue must provide, and how many seats that is', async () => {
    serveScenarios(fiveScenarios())
    renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    expect(neededLine('Plan na 9 miejsc')).toBe('Potrzebne stoły: 3 × 9 (27 miejsc)')
    expect(neededLine('Plan na 10 miejsc')).toBe('Potrzebne stoły: 3 × 10 (30 miejsc)')
    expect(neededLine('Plan na 11 miejsc')).toBe('Potrzebne stoły: 2 × 11 (22 miejsca)')
    expect(neededLine('Plan na 12 miejsc')).toBe('Potrzebne stoły: 2 × 12 (24 miejsca)')
    expect(neededLine('Plan mieszany')).toBe('Potrzebne stoły: 1 × 12, 1 × 11, 1 × 9 (32 miejsca)')
  })

  it('leaves the line out of a plan without tables', async () => {
    serveScenarios(fiveScenarios({ 10: makePlan([], []) }))
    renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    expect(neededLine('Plan na 10 miejsc')).toBeNull()
    expect(neededLine('Plan na 9 miejsc')).not.toBeNull()
  })

  it('sizes the page header copy for five plans', async () => {
    serveScenarios(fiveScenarios())
    renderPage(<PlansPage />)

    expect(
      await screen.findByText(/Pięć planów naraz: stoły 9-, 10-, 11-, 12-osobowe i mieszany/),
    ).toBeInTheDocument()
  })

  it('counts the guests without acquaintances at the table on the card', async () => {
    const plan = {
      ...makePlan([{ number: 1, clusters: [] }]),
      guestScores: [-1, -1, 0].map((satisfaction, id) => ({
        guestId: id + 1,
        tableNumber: 1,
        satisfaction,
        preferredTotal: 0,
        preferredAtTable: 0,
        fallbackAtTable: 0,
        strangersAtTable: 0,
      })),
    }
    serveScenarios([makeScenario(10, plan)])
    renderPage(<PlansPage />)

    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    expect(within(ten).getByText('Bez znajomych przy stole: 2 os.')).toBeInTheDocument()
  })

  it('links every card to its floor plan under the router basename', async () => {
    serveScenarios(fiveScenarios())
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
    serveScenarios(fiveScenarios({ 10: broken }))
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
      HttpResponse.json(list(fiveProposals())),
    )
    serveScenarios(fiveScenarios({ 10: makePlan([{ number: 1, clusters: [] }]) }))
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

/** Five plans of 3 tables before, 4 tables after Generate (versions + 1), as the server stores them. */
function generateScenarios() {
  const before = fiveScenarios()
  const generated = before.map((s) => makeScenario(s.key, evenPlan(4, 6), s.version + 1))
  const proposals = before.map((s) => ({
    key: s.key,
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
    expect(body.plans.map((p) => [p.key, p.basedOnVersion])).toEqual([
      ['9', 4],
      ['10', 7],
      ['11', 3],
      ['12', 2],
      ['mixed', 5],
    ])
    expect(
      await screen.findByText('Zapisano nowe plany: 9, 10, 11, 12 miejsc i mieszany.'),
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
      fiveScenarios().map((s) => ({ ...s, version: s.version + 2 })),
    ])
    expect(bar()).toHaveTextContent(barText)

    await user.click(screen.getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(tablesOf('Plan na 10 miejsc')).toHaveTextContent('3'))
    const body = flow.put.calls[1] as ScenariosReplace
    expect(body.plans.map((p) => [p.key, p.basedOnVersion])).toEqual([
      ['9', 5],
      ['10', 8],
      ['11', 4],
      ['12', 3],
      ['mixed', 6],
    ])
    expect(body.plans[1]?.tables).toHaveLength(before[1]!.plan.tables.length)
    expect(await screen.findByText('Przywrócono poprzednie plany.')).toBeInTheDocument()
    expect(screen.queryByText(barText)).toBeNull()
  })

  it('says "Przywracam…" and disables the button while it runs', async () => {
    const { user } = await afterGenerate([fiveScenarios()])
    const hold = gate()
    mockApi('put', '/scenarios', async () => {
      await hold.opened
      return HttpResponse.json(list(fiveScenarios()))
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
        generated.map((s) => (s.key === 'mixed' ? { ...s, version: s.version + 1 } : s)),
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
    serveScenarios(fiveScenarios())
    renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull()
  })
})

// --- "Usuń plan" / "Usuń wszystkie plany" ------------------------------------------------------

/** What the server answers after a reset: no tables, every guest unseated, version + 1. */
function emptied(key: PlanKey, guestCount = 24) {
  const unseated = Array.from({ length: guestCount }, (_, i) => placement(i + 1, [i + 1]))
  return makeScenario(key, makePlan([], unseated), 9)
}

const resetCall = (key: PlanKey, respond?: () => Response | Promise<Response>) =>
  mockApi(
    'delete',
    `/scenarios/${key}/tables`,
    respond ?? (() => HttpResponse.json(single(emptied(key)))),
  )

describe('PlansPage: delete plans', () => {
  it('"Usuń plan" on a card asks first, says how many tables and guests are cleared, and Anuluj sends nothing', async () => {
    serveScenarios(fiveScenarios())
    const api = resetCall('10')
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
    serveScenarios(fiveScenarios())
    const api = resetCall('10')
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
    serveScenarios(fiveScenarios())
    const hold = gate()
    resetCall('10', async () => {
      await hold.opened
      return HttpResponse.json(single(emptied('10')))
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
    serveScenarios(fiveScenarios())
    resetCall('10', () => HttpResponse.json(failure('internal_error'), { status: 500 }))
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
    serveScenarios(fiveScenarios({ 10: makePlan([], []) }))
    renderPage(<PlansPage />)
    const ten = await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    const button = within(ten).getByRole('button', { name: /Usuń plan/ })

    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Ten plan nie ma stołów, nie ma co usuwać.')
    expect(
      within(card('Plan na 9 miejsc')).getByRole('button', { name: /Usuń plan/ }),
    ).toBeEnabled()
  })

  it('"Usuń wszystkie plany" needs the acknowledgement checkbox, then sends five DELETEs (9, 10, 11, 12, mixed)', async () => {
    serveScenarios(fiveScenarios())
    const calls = PLAN_KEYS.map((key) => resetCall(key))
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })

    await user.click(screen.getByRole('button', { name: 'Usuń wszystkie plany' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Usunąć wszystkie pięć planów?',
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
    expect(
      within(dialog).getByText(/Plan mieszany: 3 stoły i 31 osób przy stołach/),
    ).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Usuń wszystkie plany' })
    expect(confirm).toBeDisabled()

    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Rozumiem, że tego nie da się cofnąć' }),
    )
    expect(confirm).toBeEnabled()
    expect(calls.map((c) => c.calls.length)).toEqual([0, 0, 0, 0, 0])
    await user.click(confirm)

    expect(await screen.findByText('Usunięto wszystkie plany.')).toBeInTheDocument()
    expect(calls.map((c) => c.calls.length)).toEqual([1, 1, 1, 1, 1])
    expect(screen.getAllByText('Brak stołów w tym planie.')).toHaveLength(5)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('when one of the five fails, the toast names that plan and the others stay deleted', async () => {
    // a server that remembers: every deleted plan is empty, so the refetch agrees
    let stored = fiveScenarios()
    const empty = (key: PlanKey) => () => {
      stored = stored.map((s) => (s.key === key ? emptied(key) : s))
      return HttpResponse.json(single(emptied(key)))
    }
    mockApi('get', '/scenarios', () => HttpResponse.json(list(stored)))
    for (const key of ['9', '10', '11', '12'] as const) resetCall(key, empty(key))
    resetCall('mixed', () => HttpResponse.json(failure('internal_error'), { status: 500 }))
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan na 10 miejsc' })
    await user.click(screen.getByRole('button', { name: 'Usuń wszystkie plany' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('checkbox'))

    await user.click(within(dialog).getByRole('button', { name: 'Usuń wszystkie plany' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /Nie udało się usunąć planu: Mieszany/,
    )
    expect(await screen.findAllByText(/Nie udało się usunąć planu: Mieszany/)).toHaveLength(2) // inline + toast
    await user.click(within(dialog).getByRole('button', { name: 'Anuluj' }))
    for (const name of [
      'Plan na 9 miejsc',
      'Plan na 10 miejsc',
      'Plan na 11 miejsc',
      'Plan na 12 miejsc',
    ]) {
      expect(within(card(name)).getByText('Brak stołów w tym planie.')).toBeInTheDocument()
    }
    expect(within(card('Plan mieszany')).queryByText('Brak stołów w tym planie.')).toBeNull()
  })

  it('deletes just the mixed plan from its card, after asking', async () => {
    serveScenarios(fiveScenarios())
    const api = resetCall('mixed')
    const { user } = renderPage(<PlansPage />)
    await screen.findByRole('article', { name: 'Plan mieszany' })

    await user.click(within(card('Plan mieszany')).getByRole('button', { name: /Usuń plan/ }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Usunąć plan mieszany?' })
    expect(api.calls).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Usuń plan mieszany' }))

    expect(await screen.findByText('Usunięto plan mieszany.')).toBeInTheDocument()
    expect(api.calls).toHaveLength(1)
    expect(within(card('Plan mieszany')).getByText('Brak stołów w tym planie.')).toBeInTheDocument()
  })

  it('"Usuń wszystkie plany" is disabled when all five plans are empty', async () => {
    const none = makePlan([], [])
    serveScenarios(fiveScenarios({ 9: none, 10: none, 11: none, 12: none, mixed: none }))
    renderPage(<PlansPage />)

    expect(await screen.findByRole('button', { name: 'Usuń wszystkie plany' })).toBeDisabled()
  })

  it('deleting a plan bumps its version, so a pending Cofnij is no longer offered', async () => {
    const { before, generated, proposals } = generateScenarios()
    serveGenerateFlow({ before, proposals, stored: [generated] })
    resetCall('10')
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
