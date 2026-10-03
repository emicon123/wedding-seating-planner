import { act, screen, waitFor, within } from '@testing-library/react'
import { PlanDetailPage } from '@/features/plans/PlanDetailPage'
import {
  detailGuestsWithChild,
  detailScenario,
  detailScenarioWithChild,
  mixedDetailPlan,
  serveDetail,
  serveGenerateFlow,
} from '@/features/plans/fixtures'
import { PLAN_KEYS } from '@/domain/plans'
import type { PlanTable, Scenario } from '@/domain/types'
import { makePlan, makeScenario, placement, withoutViolations } from '@/test/builders'
import { renderPage } from '@/test/renderPage'
import { http } from 'msw'
import { apiUrl, failure, gate, HttpResponse, list, mockApi, single, server } from '@/test/server'

const table = (number: number) => screen.getByRole('region', { name: `Stół ${number}` })
const chip = (names: string) =>
  screen.getByRole('button', { name: `Przeciągnij paczkę: ${names}` }).closest('[data-cluster]')!
const tray = () => screen.getByRole('region', { name: /Bez stołu/ })

/** The detail plan with one rule broken, so the "Przelicz / Generuj" call to action shows. */
function brokenDetail(): Scenario {
  const base = detailScenario()
  return {
    ...base,
    plan: {
      ...base.plan,
      violations: [
        { code: 'unseated_guests' as const, message: 'x', tableNumber: null, guestIds: [11] },
      ],
      summary: { ...base.plan.summary, violationCount: 1, needsRecalculation: true },
    },
  }
}

async function renderDetail(path = '/plany/10') {
  serveDetail()
  const rendered = renderPage(<PlanDetailPage planKey="10" />, path)
  await screen.findByRole('region', { name: 'Stół 1' })
  return rendered
}

describe('PlanDetailPage: the hall (read)', () => {
  it('links to the print view of this plan', async () => {
    await renderDetail()

    expect(screen.getByRole('link', { name: 'Wersja do druku' })).toHaveAttribute(
      'href',
      '/wesele/druk/10',
    )
  })

  it('draws every table with its fill counter, and the unseated tray', async () => {
    await renderDetail()

    expect(within(table(1)).getByText('3/10')).toBeInTheDocument()
    expect(within(table(2)).getByText('2/10')).toBeInTheDocument()
    expect(within(tray()).getByText('Basia Lis')).toBeInTheDocument()
    expect(within(tray()).getByText('1 osoba')).toBeInTheDocument()
  })

  it('groups the members of a paczka in one chip carrying the group 0 mark', async () => {
    await renderDetail()

    const maciek = chip('Maciek, Karolina Nowak')
    expect(within(maciek as HTMLElement).getByText('Maciek')).toBeInTheDocument()
    expect(within(maciek as HTMLElement).getByText('Karolina Nowak')).toBeInTheDocument()
    expect(within(maciek as HTMLElement).getByText('Grupa 0: 2')).toBeInTheDocument()
    // a lone guest has no group mark
    expect(within(chip('Zosia') as HTMLElement).queryByText(/Grupa 0/)).toBeNull()
  })

  it('shows group 1 and group 2 satisfaction next to each guest, as text', async () => {
    await renderDetail()

    const zosia = chip('Zosia') as HTMLElement
    expect(within(zosia).getByText('Przy stole 1 z 1 preferowanych osób')).toBeInTheDocument()
    expect(within(zosia).getByText('2 z grupy 2 przy stole, tylko awaryjnie')).toBeInTheDocument()
    expect(
      within(chip('Maciek, Karolina Nowak') as HTMLElement).getAllByText(
        'Przy stole 0 z 2 preferowanych osób',
      ),
    ).toHaveLength(2)
  })

  it('marks guests without acquaintances at the table, in the chips, the header and the panel', async () => {
    await renderDetail('/plany/10?guest=4')

    const maciek = chip('Maciek, Karolina Nowak') as HTMLElement
    expect(within(maciek).getAllByText('Bez znajomych przy stole')).toHaveLength(2)
    expect(within(chip('Zosia') as HTMLElement).queryByText('Bez znajomych przy stole')).toBeNull()
    expect(screen.getByText('2 os.').previousSibling).toHaveTextContent('Bez znajomych przy stole')
    const panel = screen.getByRole('region', { name: 'Szczegóły: Maciek' })
    expect(
      within(panel).getByText('Bez znajomych przy stole — nikt z grup 1 i 2 tu nie siedzi.'),
    ).toBeInTheDocument()
  })

  describe('children are not scored (task 014)', () => {
    async function renderWithChild(path: string) {
      serveDetail(detailScenarioWithChild())
      server.use(
        http.get(apiUrl('/guests'), () => HttpResponse.json(list(detailGuestsWithChild()))),
      )
      renderPage(<PlanDetailPage planKey="10" />, path)
      await screen.findByRole('region', { name: 'Stół 1' })
    }

    it('shows the child line instead of the satisfaction block, with no mark or badge on the chip', async () => {
      await renderWithChild('/plany/10?guest=8')

      const panel = screen.getByRole('region', { name: 'Szczegóły: Zosia' })
      expect(
        within(panel).getByText(
          'Dziecko — nie wlicza się do zadowolenia (zajmuje miejsce przy stole).',
        ),
      ).toBeInTheDocument()
      expect(within(panel).queryByText(/Ten gość nie ma preferowanych osób/)).toBeNull()
      expect(within(panel).queryByText(/Obcych/)).toBeNull()
      expect(within(panel).queryByText(/Bez znajomych przy stole/)).toBeNull()
      const zosia = chip('Zosia') as HTMLElement
      expect(within(zosia).queryByText('Bez znajomych przy stole')).toBeNull()
      expect(within(zosia).queryByText(/preferowanych osób/)).toBeNull()
    })

    it('counts adults only: the plan header ignores the child at a table of strangers', async () => {
      await renderWithChild('/plany/10?guest=4')

      expect(screen.getByText('2 os.').previousSibling).toHaveTextContent(
        'Bez znajomych przy stole',
      )
      const panel = screen.getByRole('region', { name: 'Szczegóły: Maciek' })
      expect(within(panel).getByText('Obcych dorosłych przy stole: 0')).toBeInTheDocument()
      expect(within(panel).queryByText(/^Obcych przy stole/)).toBeNull()
    })
  })

  it('flags an over-full and an under-floor table with icon and text, not colour alone', async () => {
    const guests = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => placement(from + i, [from + i]))
    const tables: PlanTable[] = withoutViolations(
      makePlan([
        { number: 1, clusters: guests(100, 11) },
        { number: 2, clusters: guests(200, 4) },
        { number: 3, clusters: guests(300, 8) },
      ]),
    ).tables
    const base = detailScenario()
    serveDetail({ ...base, plan: { ...base.plan, tables, unseated: [] } })
    renderPage(<PlanDetailPage planKey="10" />, '/plany/10')
    await screen.findByRole('region', { name: 'Stół 1' })

    expect(within(table(1)).getByText('Za dużo osób: 11/10')).toBeInTheDocument()
    expect(within(table(2)).getByText('Za mało osób (minimum 8)')).toBeInTheDocument()
    expect(within(table(3)).queryByText(/Za (dużo|mało)/)).toBeNull()
  })

  it('shows the recalculation call to action with the reasons when the plan breaks a rule', async () => {
    const base = detailScenario()
    const plan = {
      ...base.plan,
      violations: [
        { code: 'unseated_guests' as const, message: 'x', tableNumber: null, guestIds: [11] },
      ],
      summary: { ...base.plan.summary, violationCount: 1, needsRecalculation: true },
    }
    serveDetail({ ...base, plan })
    renderPage(<PlanDetailPage planKey="10" />, '/plany/10')

    expect(await screen.findByText('Wymaga przeliczenia')).toBeInTheDocument()
    expect(screen.getByText('1 osoba bez stołu', { selector: 'li' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Przelicz / Generuj' })).toBeInTheDocument()
  })

  it('the call to action stays on screen while Generate runs and sends one calculate request', async () => {
    const base = brokenDetail()
    serveDetail(base)
    const hold = gate()
    const calculate = mockApi('post', '/scenarios/calculate', async () => {
      await hold.opened
      return HttpResponse.json({ data: [], meta: { requestId: 'x' }, page: { total: 0 } })
    })
    const { user } = renderPage(<PlanDetailPage planKey="10" />, '/plany/10')

    await user.click(await screen.findByRole('button', { name: 'Przelicz / Generuj' }))

    expect(await screen.findByRole('button', { name: 'Liczę i zapisuję plany…' })).toBeDisabled()
    expect(screen.getByText('Wymaga przeliczenia')).toBeInTheDocument()
    expect(calculate.calls).toHaveLength(1)
    hold.open()
  })

  it('?guest=8 highlights that guest, opens the panel and says where preferred people sit', async () => {
    await renderDetail('/plany/10?guest=4')

    expect(table(1)).toHaveAttribute('data-highlighted', 'true')
    const panel = screen.getByRole('region', { name: 'Szczegóły: Maciek' })
    expect(within(panel).getByText('Siedzi przy stole 1')).toBeInTheDocument()
    expect(within(panel).getByText('Przy stole 0 z 2 preferowanych osób')).toBeInTheDocument()
    // Karolina is in the same paczka and table; Michał and Ola (via Michał) sit at table 2
    expect(within(panel).getByText('przy tym samym stole')).toBeInTheDocument()
    const michal = within(panel).getByRole('button', { name: 'Michał' }).closest('li')!
    expect(within(michal).getByText('stół 2')).toBeInTheDocument()
    const ola = within(panel).getByRole('button', { name: 'Ola' }).closest('li')!
    expect(within(ola).getByText('(przez grupę 0: Michał)')).toBeInTheDocument()
  })

  it('selecting a guest from a chip writes ?guest= and closing removes it', async () => {
    const { user } = await renderDetail()

    await user.click(within(chip('Zosia') as HTMLElement).getByRole('button', { name: 'Zosia' }))
    expect(screen.getByTestId('search')).toHaveTextContent('?guest=8')
    expect(table(1)).toHaveAttribute('data-highlighted', 'true')

    await user.click(screen.getByRole('button', { name: 'Zamknij szczegóły' }))
    expect(screen.getByTestId('search')).toHaveTextContent('')
  })

  it('finds a guest by name (diacritics-insensitive) and jumps to them', async () => {
    const { user } = await renderDetail()

    await user.type(screen.getByRole('combobox', { name: 'Znajdź gościa' }), 'michal')
    const option = await screen.findByRole('option', { name: /Michał/ })
    expect(within(option).getByText('stół 2')).toBeInTheDocument()
    await user.click(option)

    expect(screen.getByTestId('search')).toHaveTextContent('?guest=6')
    expect(table(2)).toHaveAttribute('data-highlighted', 'true')
  })

  it('finds an unseated guest with the keyboard and highlights the tray', async () => {
    const { user } = await renderDetail()

    await user.type(screen.getByRole('combobox', { name: 'Znajdź gościa' }), 'lis{Enter}')

    expect(screen.getByTestId('search')).toHaveTextContent('?guest=11')
    expect(tray()).toHaveClass('ring-brass')
    expect(screen.getByRole('region', { name: 'Szczegóły: Basia Lis' })).toBeInTheDocument()
  })

  it('"Tylko stoły" hides the chips and keeps the counters', async () => {
    const { user } = await renderDetail()

    await user.click(screen.getByRole('button', { name: 'Tylko stoły' }))

    expect(screen.queryByText('Zosia')).toBeNull()
    expect(within(table(1)).getByText('3/10')).toBeInTheDocument()
    expect(screen.getByTestId('search')).toHaveTextContent('?widok=stoly')
  })

  it('switches between the five plans, mixed last', async () => {
    await renderDetail()

    const nav = screen.getByRole('navigation', { name: 'Przełącz plan' })
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
    expect(within(nav).getAllByRole('link').at(-1)).toHaveTextContent('Mieszany')
    expect(within(nav).getByRole('link', { name: /Mieszany/ })).toHaveAttribute(
      'href',
      '/wesele/plany/mixed',
    )
    expect(within(nav).getByRole('link', { name: /12 miejsc/ })).toHaveAttribute(
      'href',
      '/wesele/plany/12',
    )
    expect(within(nav).getByRole('link', { name: /10 miejsc/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

// --- task 013: the mixed plan -------------------------------------------------------------------

async function renderMixed() {
  serveDetail()
  const rendered = renderPage(<PlanDetailPage planKey="mixed" />, '/plany/mixed')
  await screen.findByRole('region', { name: 'Stół 1' })
  return rendered
}

describe('PlanDetailPage: the mixed plan', () => {
  it('is titled "Plan mieszany", links to its print view and says which tables it needs', async () => {
    await renderMixed()

    expect(screen.getByRole('heading', { level: 1, name: 'Plan mieszany' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Wersja do druku' })).toHaveAttribute(
      'href',
      '/wesele/druk/mixed',
    )
    expect(
      screen.getByText(
        (_, element) => element?.textContent === 'Potrzebne stoły: 1 × 10, 1 × 9 (19 miejsc)',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Przełącz plan' })).getByRole('link', {
        name: /Mieszany/,
      }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('shows each table with the size it needs, "N os." instead of "N/capacity", and marks the empty one', async () => {
    await renderMixed()

    expect(within(table(1)).getByText('stół 10-os.')).toBeInTheDocument()
    expect(within(table(1)).getByText('10 os.')).toBeInTheDocument()
    expect(within(table(2)).getByText('stół 9-os.')).toBeInTheDocument()
    expect(within(table(2)).getByText('2 os.')).toBeInTheDocument()
    expect(within(table(3)).getByText('pusty — niepotrzebny')).toBeInTheDocument()
    expect(within(table(3)).queryByText(/stół \d+-os\./)).toBeNull()
    expect(within(table(1)).queryByText(/\/12/)).toBeNull()
  })

  it('keeps the uniform plan as it was: no size badge, "N/capacity" counter', async () => {
    await renderDetail()

    expect(screen.queryByText(/stół \d+-os\./)).toBeNull()
    expect(within(table(1)).getByText('3/10')).toBeInTheDocument()
  })

  it('shows the size after a move in the menu, and changes the badge at once (optimistic)', async () => {
    const { user } = await renderMixed()
    const hold = gate()
    const moved = makeScenario(
      'mixed',
      withoutViolations(
        makePlan([
          {
            number: 1,
            clusters: [
              ...mixedDetailPlan().tables[0]!.clusters,
              ...mixedDetailPlan().tables[1]!.clusters,
            ],
          },
          { number: 2, clusters: [] },
          { number: 3, clusters: [] },
        ]),
      ),
      2,
    )
    const api = mockApi('put', '/scenarios/mixed/assignments/6', async () => {
      await hold.opened
      return HttpResponse.json(single(moved))
    })

    await user.click(menuOf('Michał, Ola'))
    const item = await screen.findByRole('menuitem', { name: /Stół 1/ })
    expect(within(item).getByText('12 os.')).toBeInTheDocument()
    await user.click(item)

    await waitFor(() => expect(within(table(1)).getByText('stół 12-os.')).toBeInTheDocument())
    expect(within(table(1)).getByText('12 os.')).toBeInTheDocument()
    expect(within(table(2)).getByText('pusty — niepotrzebny')).toBeInTheDocument()
    expect(api.calls).toEqual([{ tableNumber: 1, pinned: false }])
    hold.open()
    await waitFor(() => expect(within(table(1)).queryByText('Zadowolenie …')).toBeNull())
    expect(within(table(1)).getByText('stół 12-os.')).toBeInTheDocument()
  })

  it('deletes only the mixed plan from its own header button', async () => {
    const { user } = await renderMixed()
    const api = mockApi('delete', '/scenarios/mixed/tables', () =>
      HttpResponse.json(single(makeScenario('mixed', makePlan([], []), 2))),
    )

    await user.click(screen.getByRole('button', { name: /Usuń plan/ }))
    await user.click(await screen.findByRole('button', { name: 'Usuń plan mieszany' }))

    expect(await screen.findByText('Usunięto plan mieszany.')).toBeInTheDocument()
    expect(api.calls).toHaveLength(1)
  })
})

// --- F-09: moves, pins, tables ----------------------------------------------------------------

/** Moved copy the server would answer after `clusterKey` went to `toTable`. */
function movedScenario(
  mutate: (tables: PlanTable[], unseated: Scenario['plan']['unseated']) => void,
) {
  const base = detailScenario()
  const tables = structuredClone(base.plan.tables)
  const unseated = structuredClone(base.plan.unseated)
  mutate(tables, unseated)
  const plan = withoutViolations(makePlan(tables, unseated))
  return makeScenario(10, plan, 8)
}

const menuOf = (names: string) =>
  within(chip(names) as HTMLElement).getByRole('button', {
    name: new RegExp(`Przenieś do stołu… \\(${names}\\)`),
  })

describe('PlanDetailPage: moving with the "Przenieś do stołu…" menu', () => {
  it('moves the whole paczka, sends PUT with the pin state and updates the fills at once', async () => {
    const { user } = await renderDetail()
    const hold = gate()
    const api = mockApi('put', '/scenarios/10/assignments/6', async () => {
      await hold.opened
      return HttpResponse.json(
        single(
          movedScenario((tables) => {
            tables[0]!.clusters.push(...tables[1]!.clusters.splice(0))
            tables[0]!.fill = 5
            tables[1]!.fill = 0
          }),
        ),
      )
    })

    await user.click(menuOf('Michał, Ola'))
    await user.click(await screen.findByRole('menuitem', { name: /Stół 1/ }))

    // optimistic: the chip is already at table 1, before the server answered
    await waitFor(() => expect(within(table(1)).getByText('5/10')).toBeInTheDocument())
    expect(within(table(1)).getByText('Michał')).toBeInTheDocument()
    expect(within(table(2)).getByText('0/10')).toBeInTheDocument()
    expect(api.calls).toEqual([{ tableNumber: 1, pinned: false }])
    // server numbers are not shown while the save is in flight
    expect(within(table(1)).getByText('Zadowolenie …')).toBeInTheDocument()

    hold.open()
    await waitFor(() => expect(within(table(1)).queryByText('Zadowolenie …')).toBeNull())
    expect(within(table(1)).getByText('5/10')).toBeInTheDocument()
  })

  it('rolls the chip back and explains why when the server refuses', async () => {
    const { user } = await renderDetail()
    mockApi('put', '/scenarios/10/assignments/6', () =>
      HttpResponse.json(failure('not_found'), { status: 404 }),
    )

    await user.click(menuOf('Michał, Ola'))
    await user.click(await screen.findByRole('menuitem', { name: /Stół 1/ }))

    expect(await screen.findByText(/Nie udało się przenieść paczki/)).toBeInTheDocument()
    await waitFor(() => expect(within(table(2)).getByText('Michał')).toBeInTheDocument())
    expect(within(table(2)).getByText('2/10')).toBeInTheDocument()
    expect(within(table(1)).getByText('3/10')).toBeInTheDocument()
  })

  it('shows the seats a table would have, and warns about a full one, before choosing', async () => {
    const { user } = await renderDetail()

    await user.click(menuOf('Michał, Ola'))

    const item = await screen.findByRole('menuitem', { name: /Stół 1/ })
    expect(within(item).getByText('5/10')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Stół 2/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('"Bez stołu" sends DELETE and the paczka lands in the tray', async () => {
    const { user } = await renderDetail()
    const api = mockApi('delete', '/scenarios/10/assignments/6', () =>
      HttpResponse.json(
        single(
          movedScenario((tables, unseated) => {
            unseated.push(...tables[1]!.clusters.splice(0))
            tables[1]!.fill = 0
          }),
        ),
      ),
    )

    await user.click(menuOf('Michał, Ola'))
    await user.click(await screen.findByRole('menuitem', { name: /Bez stołu/ }))

    await waitFor(() => expect(within(tray()).getByText('Michał')).toBeInTheDocument())
    expect(api.calls).toHaveLength(1)
    expect(within(tray()).getByText('3 osoby')).toBeInTheDocument()
  })
})

describe('PlanDetailPage: pins', () => {
  it('the pin toggle sends pinned: true with the current table', async () => {
    const { user } = await renderDetail()
    const api = mockApi('put', '/scenarios/10/assignments/4', () =>
      HttpResponse.json(
        single(
          movedScenario((tables) => {
            tables[0]!.clusters[0]!.pinned = true
          }),
        ),
      ),
    )

    await user.click(
      within(chip('Maciek, Karolina Nowak') as HTMLElement).getByRole('button', {
        name: /Przypnij do stołu/,
      }),
    )

    await waitFor(() => expect(api.calls).toEqual([{ tableNumber: 1, pinned: true }]))
    expect(
      await within(chip('Maciek, Karolina Nowak') as HTMLElement).findByRole('button', {
        name: /Odepnij od stołu/,
      }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('an unseated paczka has no pin', async () => {
    await renderDetail()
    expect(
      within(chip('Basia Lis') as HTMLElement).queryByRole('button', { name: /Przypnij/ }),
    ).toBeNull()
  })
})

describe('PlanDetailPage: add and remove tables', () => {
  it('"Dodaj stół" sends POST and the new empty table appears', async () => {
    const { user } = await renderDetail()
    const api = mockApi('post', '/scenarios/10/tables', () =>
      HttpResponse.json(
        single(
          movedScenario((tables) => {
            tables.push({ number: 3, fill: 0, score: 0, clusters: [] })
          }),
        ),
        { status: 201 },
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Dodaj stół' }))

    expect(await screen.findByRole('region', { name: 'Stół 3' })).toBeInTheDocument()
    expect(api.calls).toHaveLength(1)
    expect(within(table(3)).getByText('0/10')).toBeInTheDocument()
    expect(within(table(3)).getByText('Za mało osób (minimum 8)')).toBeInTheDocument()
  })

  it('deleting a table asks first, then its guests show up in the tray', async () => {
    const { user } = await renderDetail()
    const api = mockApi('delete', '/scenarios/10/tables/2', () =>
      HttpResponse.json(
        single(
          movedScenario((tables, unseated) => {
            unseated.push(...tables[1]!.clusters)
            tables.pop()
          }),
        ),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Usuń stół 2' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/2 osoby z tego stołu trafi do pola „Bez stołu”/),
    ).toBeInTheDocument()
    expect(api.calls).toHaveLength(0) // nothing is sent before the confirmation

    await user.click(within(dialog).getByRole('button', { name: 'Usuń stół' }))

    await waitFor(() => expect(within(tray()).getByText('Michał')).toBeInTheDocument())
    expect(api.calls).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Stół 2' })).toBeNull()
  })

  it('cancelling the confirmation deletes nothing', async () => {
    const { user } = await renderDetail()
    const api = mockApi('delete', '/scenarios/10/tables/2', () => HttpResponse.json({}))

    await user.click(screen.getByRole('button', { name: 'Usuń stół 2' }))
    await user.click(await screen.findByRole('button', { name: 'Anuluj' }))

    expect(api.calls).toHaveLength(0)
    expect(table(2)).toBeInTheDocument()
  })
})

describe('PlanDetailPage: delete the plan', () => {
  const emptiedScenario = () => {
    const base = detailScenario()
    const unseated = [...base.plan.tables.flatMap((t) => t.clusters), ...base.plan.unseated]
    return makeScenario(10, makePlan([], unseated), 8)
  }

  it('"Usuń plan" in the header empties the floor plan and moves every cluster to the tray, staying on the page', async () => {
    const { user } = await renderDetail()
    const api = mockApi('delete', '/scenarios/10/tables', () =>
      HttpResponse.json(single(emptiedScenario())),
    )

    await user.click(screen.getByRole('button', { name: /^Usuń plan/ }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Usunąć plan na 10 miejsc?' })
    expect(within(dialog).getByText(/2 stoły i 5 osób przy stołach/)).toBeInTheDocument()
    expect(api.calls).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Usuń plan 10-osobowy' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Stół 1' })).toBeNull())
    expect(screen.queryByRole('region', { name: 'Stół 2' })).toBeNull()
    expect(api.calls).toEqual([null])
    expect(within(tray()).getByText('Michał')).toBeInTheDocument()
    expect(within(tray()).getByText('Maciek')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Plan na 10 miejsc' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Przelicz / Generuj' })).toBeInTheDocument()
    expect(await screen.findByText('Usunięto plan na 10 miejsc.')).toBeInTheDocument()
  })

  it('Anuluj and Esc leave the plan alone', async () => {
    const { user } = await renderDetail()
    const api = mockApi('delete', '/scenarios/10/tables', () => HttpResponse.json({}))

    await user.click(screen.getByRole('button', { name: /^Usuń plan/ }))
    await user.click(await screen.findByRole('button', { name: 'Anuluj' }))
    await user.click(screen.getByRole('button', { name: /^Usuń plan/ }))
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.calls).toHaveLength(0)
    expect(table(1)).toBeInTheDocument()
  })

  it('is disabled when the plan has no tables', async () => {
    serveDetail(makeScenario(10, makePlan([], [placement(4, [4, 5])]), 8))
    renderPage(<PlanDetailPage planKey="10" />, '/plany/10')

    const button = await screen.findByRole('button', { name: /^Usuń plan/ })

    expect(button).toBeDisabled()
  })
})

// --- keyboard drag ----------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number }
const asRect = ({ x, y, w, h }: Rect) => ({
  x,
  y,
  left: x,
  top: y,
  right: x + w,
  bottom: y + h,
  width: w,
  height: h,
  toJSON: () => ({}),
})

/** jsdom has no layout: give the tables, the tray and the chips fixed places so dnd-kit can measure. */
function stubGeometry() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const dropId = this.getAttribute('data-drop-id')
    const tableNumber = /^table-(\d+)$/.exec(dropId ?? '')?.[1]
    if (tableNumber) return asRect({ x: Number(tableNumber) * 400, y: 0, w: 300, h: 400 })
    if (dropId === 'tray') return asRect({ x: 3000, y: 0, w: 300, h: 400 })
    if (this.hasAttribute('data-cluster')) return asRect({ x: 0, y: 600, w: 240, h: 60 })
    return asRect({ x: 0, y: 0, w: 0, h: 0 })
  })
}

describe('PlanDetailPage: keyboard drag and drop', () => {
  beforeEach(() => void stubGeometry())
  afterEach(() => vi.restoreAllMocks())

  const handle = (names: string) =>
    screen.getByRole('button', { name: `Przeciągnij paczkę: ${names}` })

  it('Space, arrows to a table, Space moves the paczka (PUT) and shows the preview on the way', async () => {
    const { user } = await renderDetail()
    const api = mockApi('put', '/scenarios/10/assignments/6', () =>
      HttpResponse.json(
        single(
          movedScenario((tables) => {
            tables[0]!.clusters.push(...tables[1]!.clusters.splice(0))
            tables[0]!.fill = 5
            tables[1]!.fill = 0
          }),
        ),
      ),
    )

    act(() => handle('Michał, Ola').focus())
    await user.keyboard(' ')
    await user.keyboard('{ArrowLeft}')

    // the drop preview shows counts only: 3 + 2 seats at table 1
    expect(await within(table(1)).findByText('Po przeniesieniu: 5/10')).toBeInTheDocument()
    expect(api.calls).toHaveLength(0)

    await user.keyboard(' ')

    await waitFor(() => expect(api.calls).toEqual([{ tableNumber: 1, pinned: false }]))
    await waitFor(() => expect(within(table(1)).getByText('Michał')).toBeInTheDocument())
  })

  it('warns about an over-full table while hovering it, but still allows the drop', async () => {
    const guests = Array.from({ length: 9 }, (_, i) => placement(100 + i, [100 + i]))
    const base = detailScenario()
    const full = {
      ...base,
      plan: withoutViolations(
        makePlan(
          [
            { number: 1, clusters: [placement(4, [4, 5]), ...guests] },
            { number: 2, clusters: [placement(6, [6, 7])] },
          ],
          [],
        ),
      ),
    }
    serveDetail(full)
    const { user } = renderPage(<PlanDetailPage planKey="10" />, '/plany/10')
    await screen.findByRole('region', { name: 'Stół 1' })

    act(() => handle('Michał, Ola').focus())
    await user.keyboard(' {ArrowLeft}')

    expect(
      await within(table(1)).findByText('Po przeniesieniu: 13/10, za dużo osób'),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(within(table(1)).queryByText(/Po przeniesieniu/)).toBeNull())
  })

  it('dropping on the tray (End) sends DELETE', async () => {
    const { user } = await renderDetail()
    const api = mockApi('delete', '/scenarios/10/assignments/6', () =>
      HttpResponse.json(
        single(
          movedScenario((tables, unseated) => {
            unseated.push(...tables[1]!.clusters.splice(0))
            tables[1]!.fill = 0
          }),
        ),
      ),
    )

    act(() => handle('Michał, Ola').focus())
    await user.keyboard(' {End}')
    expect(await within(tray()).findByText('Upuść, żeby zdjąć paczkę ze stołu')).toBeInTheDocument()
    await user.keyboard(' ')

    await waitFor(() => expect(api.calls).toHaveLength(1))
  })

  it('Escape cancels without sending anything', async () => {
    const { user } = await renderDetail()
    const api = mockApi('put', '/scenarios/10/assignments/6', () => HttpResponse.json({}))
    server.use(http.delete(apiUrl('/scenarios/10/assignments/6'), () => HttpResponse.json({})))

    act(() => handle('Michał, Ola').focus())
    await user.keyboard(' {ArrowLeft}{Escape}')

    expect(api.calls).toHaveLength(0)
    expect(within(table(2)).getByText('Michał')).toBeInTheDocument()
  })

  it('announces the drag in Polish for screen readers', async () => {
    const { user } = await renderDetail()

    act(() => handle('Michał, Ola').focus())
    await user.keyboard(' {ArrowLeft}')

    const live = await screen.findByText(/Stół 1\. Po przeniesieniu: 5\/10/, {
      selector: '[role="status"]',
    })
    expect(live).toBeInTheDocument()
    expect(document.body).toHaveTextContent('Aby przenieść paczkę, naciśnij spację')
  })
})

describe('PlanDetailPage: Generate stores at once, Cofnij', () => {
  /** After Generate the hall has a third table (Zosia alone) and no violations; versions + 1. */
  function generatedHall(): Scenario[] {
    const base = detailScenario()
    const plan = withoutViolations(
      makePlan(
        [
          { number: 1, clusters: [placement(4, [4, 5], true)] },
          { number: 2, clusters: [placement(6, [6, 7])] },
          { number: 3, clusters: [placement(8, [8]), placement(11, [11])] },
        ],
        [],
      ),
    )
    return PLAN_KEYS.map((key) => makeScenario(key, key === '10' ? plan : base.plan, 9))
  }
  const before = (): Scenario[] =>
    PLAN_KEYS.map((key) =>
      key === '10' ? brokenDetail() : makeScenario(key, detailScenario().plan, 1),
    )

  async function generateOnDetail(stored: Scenario[][] = []) {
    const initial = before()
    serveDetail(brokenDetail())
    const flow = serveGenerateFlow({
      before: initial,
      proposals: PLAN_KEYS.map((key) => ({
        key,
        capacity: makeScenario(key, detailScenario().plan).capacity,
        basedOnVersion: 0,
        plan: generatedHall()[1]!.plan,
      })),
      stored: [generatedHall(), ...stored],
    })
    const rendered = renderPage(<PlanDetailPage planKey="10" />, '/plany/10')
    await rendered.user.click(await screen.findByRole('button', { name: 'Przelicz / Generuj' }))
    await screen.findByText('Wygenerowano nowe plany. Poprzednie można przywrócić.')
    return { ...rendered, flow }
  }

  it('shows the generated tables and guests right here, with no navigation and no preview', async () => {
    const { flow } = await generateOnDetail()

    expect(await screen.findByRole('region', { name: 'Stół 3' })).toBeInTheDocument()
    expect(within(table(3)).getByText('Zosia')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Plan na 10 miejsc' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Przelicz / Generuj' })).toBeNull() // plan is calm now
    expect(screen.getByTestId('search')).toHaveTextContent('')
    expect(flow.put.calls).toHaveLength(1)
    expect(
      await screen.findByText('Zapisano nowe plany: 9, 10, 11, 12 miejsc i mieszany.'),
    ).toBeInTheDocument()
  })

  it('Cofnij brings the previous tables back', async () => {
    const restored = before().map((s) => ({ ...s, version: s.version + 9 }))
    const { user } = await generateOnDetail([restored])
    await screen.findByRole('region', { name: 'Stół 3' })

    await user.click(screen.getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Stół 3' })).toBeNull())
    expect(table(1)).toBeInTheDocument()
    expect(await screen.findByText('Przywrócono poprzednie plany.')).toBeInTheDocument()
    expect(screen.queryByText('Wygenerowano nowe plany. Poprzednie można przywrócić.')).toBeNull()
  })

  it('the bar goes away after a move on this page', async () => {
    const { user } = await generateOnDetail()
    await screen.findByRole('region', { name: 'Stół 3' })
    mockApi('put', '/scenarios/10/assignments/6', () =>
      HttpResponse.json(single(makeScenario(10, generatedHall()[1]!.plan, 10))),
    )

    await user.click(menuOf('Michał, Ola'))
    await user.click(await screen.findByRole('menuitem', { name: /Stół 1/ }))

    await waitFor(() =>
      expect(
        screen.queryByText('Wygenerowano nowe plany. Poprzednie można przywrócić.'),
      ).toBeNull(),
    )
  })
})
