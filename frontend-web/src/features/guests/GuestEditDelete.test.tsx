import { screen, waitFor, within } from '@testing-library/react'
import { GuestsPage } from '@/features/guests/GuestsPage'
import { serveGuests, SMALL_LIST } from '@/features/guests/fixtures'
import { failure, HttpResponse, mockApi, single } from '@/test/server'
import { renderPage } from '@/test/renderPage'

describe('GuestEditDialog', () => {
  it('saves the edit with the version it was opened on', async () => {
    const state = serveGuests(SMALL_LIST)
    const api = mockApi('patch', '/guests/10', () => {
      state.guests = state.guests.map((g) =>
        g.id === 10 ? { ...g, version: 2, notes: 'wegetarianka, bez glutenu' } : g,
      )
      return HttpResponse.json(single(state.guests.find((g) => g.id === 10)))
    })
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.click(screen.getByRole('button', { name: 'Edytuj: Ewa' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edytuj gościa' })
    await user.type(within(dialog).getByLabelText('Nazwisko (opcjonalnie)'), 'Kowalska')
    await user.clear(within(dialog).getByLabelText('Notatka'))
    await user.type(within(dialog).getByLabelText('Notatka'), 'wegetarianka, bez glutenu')
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual({
      version: 1,
      firstName: 'Ewa',
      lastName: 'Kowalska',
      notes: 'wegetarianka, bez glutenu',
      isChild: false,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('the "Dziecko" checkbox sends isChild and the row shows the badge afterwards', async () => {
    const state = serveGuests(SMALL_LIST)
    const api = mockApi('patch', '/guests/4', () => {
      state.guests = state.guests.map((g) => (g.id === 4 ? { ...g, version: 2, isChild: true } : g))
      return HttpResponse.json(single(state.guests.find((g) => g.id === 4)))
    })
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')
    const row = () => screen.getByRole('switch', { name: 'Uwzględniony: Maciek' }).closest('li')!
    expect(within(row()).queryByText('Dziecko')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edytuj: Maciek' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edytuj gościa' })
    const child = within(dialog).getByRole('checkbox', { name: 'Dziecko' })
    expect(child).not.toBeChecked()
    await user.click(child)
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toMatchObject({ version: 1, isChild: true })
    await waitFor(() => expect(within(row()).getByText('Dziecko')).toBeInTheDocument())
  })

  it('validates the first name before sending anything', async () => {
    serveGuests(SMALL_LIST)
    const api = mockApi('patch', '/guests/10', () => HttpResponse.json(single(SMALL_LIST[6])))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.click(screen.getByRole('button', { name: 'Edytuj: Ewa' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edytuj gościa' })
    await user.clear(within(dialog).getByLabelText('Imię'))
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }))

    expect(await within(dialog).findByText('Wpisz imię.')).toBeInTheDocument()
    expect(api.calls).toHaveLength(0)
  })

  it('on 409 says someone else changed the guest and reloads the fresh data', async () => {
    const state = serveGuests(SMALL_LIST)
    mockApi('patch', '/guests/10', () => {
      // the other editor got there first: the served list now has a newer version
      state.guests = state.guests.map((g) =>
        g.id === 10 ? { ...g, version: 5, notes: 'zmienione przez kogoś' } : g,
      )
      return HttpResponse.json(failure('version_conflict'), { status: 409 })
    })
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.click(screen.getByRole('button', { name: 'Edytuj: Ewa' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edytuj gościa' })
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }))

    expect(await within(dialog).findByText(/Ktoś zmienił tego gościa/)).toBeInTheDocument()
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Notatka')).toHaveValue('zmienione przez kogoś'),
    )
  })
})

describe('DeleteGuestDialog', () => {
  it('asks first, then sends DELETE', async () => {
    serveGuests(SMALL_LIST)
    const api = mockApi('delete', '/guests/10', () => new HttpResponse(null, { status: 204 }))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.click(screen.getByRole('button', { name: 'Usuń: Ewa' }))
    expect(api.calls).toHaveLength(0)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Usunąć gościa Ewa?')
    await user.click(within(dialog).getByRole('button', { name: 'Usuń gościa' }))

    await waitFor(() => expect(api.calls).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('Anuluj changes nothing', async () => {
    serveGuests(SMALL_LIST)
    const api = mockApi('delete', '/guests/10', () => new HttpResponse(null, { status: 204 }))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.click(screen.getByRole('button', { name: 'Usuń: Ewa' }))
    await user.click(await screen.findByRole('button', { name: 'Anuluj' }))

    expect(api.calls).toHaveLength(0)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
