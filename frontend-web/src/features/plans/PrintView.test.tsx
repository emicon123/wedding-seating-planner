import { screen, within } from '@testing-library/react'
import { http } from 'msw'
import { makeGuest, makePlan, makeScenario, placement, withoutViolations } from '@/test/builders'
import { renderPage } from '@/test/renderPage'
import { apiUrl, HttpResponse, list, server } from '@/test/server'
import {
  detailScenario,
  DETAIL_GUESTS,
  serveDetail,
  serveScenarios,
} from '@/features/plans/fixtures'
import { PrintView } from '@/features/plans/PrintView'

const table = (number: number) => screen.getByRole('region', { name: `Stół ${number}` })

async function renderPrint(path = '/druk/10') {
  const rendered = renderPage(<PrintView planKey="10" />, path)
  await screen.findByRole('heading', { name: /Plan stołów/ })
  return rendered
}

describe('PrintView', () => {
  it('draws one block per table with its fill and full names, paczki framed and marked', async () => {
    serveDetail()
    await renderPrint()

    expect(within(table(1)).getByText('Maciek')).toBeInTheDocument()
    expect(within(table(1)).getByText('Karolina Nowak')).toBeInTheDocument()
    expect(within(table(1)).getByText('Grupa 0')).toBeInTheDocument()
    expect(within(table(1)).getByText('Zosia')).toBeInTheDocument()
    expect(within(table(1)).getByText('3')).toBeInTheDocument()
    expect(within(table(2)).getByText('Michał')).toBeInTheDocument()
    // the lone guests carry no group mark
    expect(within(table(2)).getAllByText('Grupa 0')).toHaveLength(1)
  })

  it('lists the unseated guests apart', async () => {
    serveDetail()
    await renderPrint()

    expect(
      within(screen.getByRole('region', { name: 'Bez stołu' })).getByText('Basia Lis'),
    ).toBeInTheDocument()
  })

  it('has an alphabetical "who sits where" index with table numbers', async () => {
    serveDetail()
    await renderPrint()

    const heading = screen.getByRole('heading', { name: 'Kto przy którym stole' })
    const index = heading.closest('article') as HTMLElement
    const rows = within(index).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Lis Basiabez stołu',
      'Maciekstół 1',
      'Michałstół 2',
      'Nowak Karolinastół 1',
      'Olastół 2',
      'Zosiastół 1',
    ])
  })

  it('leaves out disabled guests: only what the plan lists is printed', async () => {
    const disabled = makeGuest({ id: 99, firstName: 'Wyłączony', enabled: false })
    serveDetail()
    server.use(
      http.get(apiUrl('/guests'), () => HttpResponse.json(list([...DETAIL_GUESTS, disabled]))),
    )
    await renderPrint()

    expect(screen.queryByText(/Wyłączony/)).toBeNull()
  })

  it('marks a child with the word, not colour alone', async () => {
    const plan = withoutViolations(
      makePlan([{ number: 1, clusters: [placement(1, [1]), placement(2, [2])] }]),
    )
    serveScenarios([makeScenario(10, plan)])
    server.use(
      http.get(apiUrl('/guests'), () =>
        HttpResponse.json(
          list([
            makeGuest({ id: 1, firstName: 'Staś', isChild: true }),
            makeGuest({ id: 2, firstName: 'Ola' }),
          ]),
        ),
      ),
    )
    await renderPrint()

    expect(within(table(1)).getAllByText('dziecko')).toHaveLength(1)
  })

  it('shows no interactive control on the sheets, and hides the toolbar and notice in print', async () => {
    serveDetail()
    const { container } = await renderPrint()

    const sheets = container.querySelector('main') as HTMLElement
    expect(within(sheets).queryAllByRole('button')).toHaveLength(0)
    expect(within(sheets).queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Drukuj' }).parentElement).toHaveClass('print:hidden')
  })

  it('warns on screen when the plan has problems, and the warning is not printed', async () => {
    const scenario = detailScenario()
    scenario.plan.summary.needsRecalculation = true
    scenario.plan.summary.violationCount = 1
    scenario.plan.violations = [
      { code: 'unseated_guests', message: 'x', tableNumber: null, guestIds: [11] },
    ]
    serveDetail(scenario)
    await renderPrint()

    const notice = screen.getByText(/wymaga przeliczenia/).closest('[role="status"]')
    expect(notice).toHaveTextContent('wymaga przeliczenia')
    expect(notice).toHaveTextContent('1 osoba bez stołu')
    expect(notice).toHaveClass('print:hidden')
  })

  it('shows no warning for a clean plan', async () => {
    serveDetail()
    await renderPrint()

    expect(screen.queryByText(/wymaga przeliczenia/)).toBeNull()
  })

  it('says so when no plan is accepted yet', async () => {
    serveScenarios([makeScenario(10, withoutViolations(makePlan([])))])
    server.use(http.get(apiUrl('/guests'), () => HttpResponse.json(list([]))))
    renderPage(<PrintView planKey="10" />, '/druk/10')

    expect(await screen.findByText(/Nie ma jeszcze planu na 10 miejsc/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Przejdź do planów' })).toBeInTheDocument()
  })
})

describe('PrintView: sizes and the summary (task 013)', () => {
  const needed = (): string | undefined =>
    screen
      .queryAllByText((_, element) => /^Potrzebne stoły/.test(element?.textContent ?? ''), {
        selector: 'p',
      })
      .map((element) => element.textContent)[0] ?? undefined

  it('a uniform plan names what the venue needs and keeps the capacity heading and "N/capacity"', async () => {
    serveDetail()
    await renderPrint()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Plan stołów, 10 miejsc przy stole' }),
    ).toBeInTheDocument()
    expect(needed()).toBe('Potrzebne stoły: 2 × 10 (20 miejsc)')
    expect(within(table(1)).getByText('/10')).toBeInTheDocument()
  })

  it('the mixed plan prints its heading, the summary and "Stół N · S-osobowy" per table', async () => {
    serveDetail()
    renderPage(<PrintView planKey="mixed" />, '/druk/mixed')

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Plan stołów — mieszany (stoły 9–12-osobowe)',
      }),
    ).toBeInTheDocument()
    expect(needed()).toBe('Potrzebne stoły: 1 × 10, 1 × 9 (19 miejsc)')
    expect(screen.getByRole('heading', { name: 'Stół 1 · 10-osobowy' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Stół 2 · 9-osobowy' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Stół 3' })).toBeInTheDocument()
    expect(screen.queryByText('/12')).toBeNull()
  })

  it('says so when the mixed plan does not exist yet', async () => {
    serveScenarios([makeScenario('mixed', withoutViolations(makePlan([])))])
    server.use(http.get(apiUrl('/guests'), () => HttpResponse.json(list([]))))
    renderPage(<PrintView planKey="mixed" />, '/druk/mixed')

    expect(await screen.findByText(/Nie ma jeszcze planu mieszanego/)).toBeInTheDocument()
  })
})
