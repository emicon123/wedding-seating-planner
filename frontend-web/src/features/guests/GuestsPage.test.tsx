import { screen, waitFor, within } from '@testing-library/react'
import { GuestsPage } from '@/features/guests/GuestsPage'
import { bigList, serveGuests, serveToggle, SMALL_LIST } from '@/features/guests/fixtures'
import { HttpResponse, list, mockApi } from '@/test/server'
import { renderPage } from '@/test/renderPage'

const rowOf = (name: string) =>
  screen.getByRole('switch', { name: `Uwzględniony: ${name}` }).closest('li')!
const rowNames = () =>
  screen
    .getAllByRole('switch')
    .map((el) => el.getAttribute('aria-label')?.replace('Uwzględniony: ', ''))

describe('GuestsPage: list and counters', () => {
  it('shows the counters of the whole list', async () => {
    serveGuests(bigList())
    renderPage(<GuestsPage />, '/goscie')

    expect(await screen.findByText('92 gości, 85 uwzględnionych, 7 dzieci')).toBeInTheDocument()
  })

  it('mutes a disabled row and marks children visibly (text, not only colour)', async () => {
    serveGuests(SMALL_LIST)
    renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    expect(rowOf('Staś')).toHaveAttribute('data-enabled', 'false')
    expect(within(rowOf('Staś')).getByText('Wyłączony')).toBeInTheDocument()
    expect(within(rowOf('Staś')).getByText('Dziecko')).toBeInTheDocument()
    expect(rowOf('Zosia')).toHaveAttribute('data-enabled', 'true')
    expect(within(rowOf('Maciek')).queryByText('Dziecko')).not.toBeInTheDocument()
  })

  it('shows the group marks of a guest with the full group name for screen readers', async () => {
    serveGuests(SMALL_LIST)
    renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    const links = screen.getByRole('button', { name: 'Powiązania: Maciek' })
    expect(within(links).getByText('Grupa 0: 1')).toBeInTheDocument()
    expect(within(links).getByText('Grupa 1: 1')).toBeInTheDocument()
  })

  it('guides an empty list to the quick-add bar', async () => {
    serveGuests([])
    renderPage(<GuestsPage />, '/goscie')

    expect(await screen.findByText(/Lista jest pusta/)).toBeInTheDocument()
  })

  it('says so when the server cannot be reached and offers a retry', async () => {
    mockApi('get', '/guests', () => HttpResponse.error())
    mockApi('get', '/clusters', () => HttpResponse.json({ data: { clusters: [], warnings: [] } }))
    renderPage(<GuestsPage />, '/goscie')

    expect(await screen.findByText(/Brak połączenia z serwerem/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeInTheDocument()
  })
})

describe('GuestsPage: filters (mirrored in the URL)', () => {
  it('Dzieci shows only children and writes ?dzieci=1', async () => {
    serveGuests(SMALL_LIST)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.click(screen.getByRole('button', { name: 'Dzieci' }))

    expect(rowNames().sort()).toEqual(['Staś', 'Zosia'])
    expect(screen.getByTestId('search')).toHaveTextContent('?dzieci=1')
    expect(screen.getByRole('button', { name: 'Dzieci' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Wyłączeni shows only disabled guests', async () => {
    serveGuests(SMALL_LIST)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.click(screen.getByRole('radio', { name: 'Wyłączeni' }))

    expect(rowNames().sort()).toEqual(['Ewa', 'Staś'])
    expect(screen.getByTestId('search')).toHaveTextContent('?status=off')
  })

  it('search ignores case and diacritics', async () => {
    serveGuests(SMALL_LIST)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.type(screen.getByRole('searchbox', { name: 'Szukaj gościa' }), 'MICHAL')

    await waitFor(() => expect(rowNames()).toEqual(['Michał']))
    expect(screen.getByTestId('search')).toHaveTextContent('?q=MICHAL')
    expect(screen.getByText('Pokazano 1 z 7.')).toBeInTheDocument()
  })

  it('restores the filters from the URL after a reload', async () => {
    serveGuests(SMALL_LIST)
    renderPage(<GuestsPage />, '/goscie?dzieci=1&status=off')

    await screen.findByText('Staś')

    expect(rowNames()).toEqual(['Staś'])
    expect(screen.getByRole('radio', { name: 'Wyłączeni' })).toBeChecked()
  })

  it('filters by group and can clear everything', async () => {
    serveGuests(SMALL_LIST)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Grupa' }), 'brak')
    expect(rowNames().sort()).toEqual(['Ewa', 'Staś', 'Zosia'])

    await user.click(screen.getByRole('button', { name: 'Wyczyść filtry' }))
    expect(rowNames()).toHaveLength(SMALL_LIST.length)
    expect(screen.getByTestId('search')).toHaveTextContent('')
  })

  it('explains an empty result', async () => {
    serveGuests(SMALL_LIST)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.type(screen.getByRole('searchbox', { name: 'Szukaj gościa' }), 'zzz')

    expect(await screen.findByText(/Żaden gość nie pasuje/)).toBeInTheDocument()
  })
})

describe('GuestsPage: switch and bulk toggle', () => {
  it('the row switch sends one PATCH /guests with that guest only', async () => {
    const api = serveToggle(serveGuests(SMALL_LIST))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.click(screen.getByRole('switch', { name: 'Uwzględniony: Zosia' }))

    await waitFor(() => expect(api.calls).toEqual([{ guestIds: [8], enabled: false }]))
    // the switch flips at once, before the refetch
    expect(screen.getByRole('switch', { name: 'Uwzględniony: Zosia' })).not.toBeChecked()
  })

  it('"Zaznacz wszystkie widoczne" + "Wyłącz" sends one PATCH with every visible id, count shown first', async () => {
    serveGuests(SMALL_LIST)
    const api = mockApi('patch', '/guests', () => HttpResponse.json(list([])))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.click(screen.getByRole('button', { name: 'Dzieci' }))
    await user.click(screen.getByRole('checkbox', { name: /Zaznacz wszystkie widoczne/ }))

    expect(screen.getByText('Zaznaczono: 2 gości')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Wyłącz (2)' }))

    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual({ guestIds: [8, 9], enabled: false })
    expect(await screen.findByText('Wyłączono: 2 gości.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Zaznaczeni goście' })).not.toBeInTheDocument()
  })

  it('"Cofnij" in the toast sends the opposite toggle', async () => {
    serveGuests(SMALL_LIST)
    const api = mockApi('patch', '/guests', () => HttpResponse.json(list([])))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')
    await user.click(screen.getByRole('checkbox', { name: 'Zaznacz: Zosia' }))
    await user.click(screen.getByRole('button', { name: 'Wyłącz (1)' }))

    await user.click(await screen.findByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(api.calls).toHaveLength(2))
    expect(api.calls[1]).toEqual({ guestIds: [8], enabled: true })
  })

  it('only changes what is visible, even if more was ticked before filtering', async () => {
    serveGuests(SMALL_LIST)
    const api = mockApi('patch', '/guests', () => HttpResponse.json(list([])))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')
    await user.click(screen.getByRole('checkbox', { name: 'Zaznacz: Maciek' }))
    await user.click(screen.getByRole('checkbox', { name: 'Zaznacz: Zosia' }))

    await user.click(screen.getByRole('button', { name: 'Dzieci' }))
    await user.click(screen.getByRole('button', { name: 'Wyłącz (1)' }))

    await waitFor(() => expect(api.calls).toEqual([{ guestIds: [8], enabled: false }]))
  })

  it('shows the Polish error and reloads when a toggle fails', async () => {
    serveGuests(SMALL_LIST)
    mockApi('patch', '/guests', () => HttpResponse.error())
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.click(screen.getByRole('switch', { name: 'Uwzględniony: Zosia' }))

    expect(await screen.findByText(/Brak połączenia z serwerem/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Uwzględniony: Zosia' })).toBeChecked(),
    )
  })
})
