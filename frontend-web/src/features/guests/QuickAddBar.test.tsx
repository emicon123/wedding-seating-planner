import { screen, waitFor } from '@testing-library/react'
import { GuestsPage } from '@/features/guests/GuestsPage'
import { serveGuests, SMALL_LIST } from '@/features/guests/fixtures'
import type { Guest } from '@/domain/types'
import { makeGuest } from '@/test/builders'
import { failure, HttpResponse, mockApi, single } from '@/test/server'
import { renderPage } from '@/test/renderPage'

/** POST /guests that behaves like the server: assigns an id and appends to the served list. */
function serveCreate(state: { guests: Guest[] }) {
  let nextId = 100
  return mockApi('post', '/guests', (body) => {
    const input = body as { firstName: string; lastName: string | null; isChild: boolean }
    const created = makeGuest({ id: nextId++, ...input })
    state.guests = [...state.guests, created]
    return HttpResponse.json(single(created), { status: 201 })
  })
}

const input = () => screen.getByRole('textbox', { name: 'Dodaj gościa' })

describe('QuickAddBar', () => {
  it('Enter creates the guest from "Imię Nazwisko", clears the input and keeps focus', async () => {
    const state = serveGuests([])
    const api = serveCreate(state)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText(/Lista jest pusta/)

    await user.type(input(), 'Karolina Nowak{Enter}')

    await waitFor(() => expect(input()).toHaveValue(''))
    expect(api.calls).toEqual([{ firstName: 'Karolina', lastName: 'Nowak', isChild: false }])
    expect(input()).toHaveFocus()
    expect(
      await screen.findByText('Dodano: Karolina Nowak. W tej sesji dodanych: 1.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Uwzględniony: Karolina Nowak' })).toBeInTheDocument()
  })

  it('a single word gives lastName null', async () => {
    const api = serveCreate(serveGuests([]))
    const { user } = renderPage(<GuestsPage />, '/goscie')

    await user.type(await screen.findByRole('textbox', { name: 'Dodaj gościa' }), 'Zosia{Enter}')

    await waitFor(() =>
      expect(api.calls).toEqual([{ firstName: 'Zosia', lastName: null, isChild: false }]),
    )
  })

  it('has a visible "Dziecko" checkbox, unchecked at first, and no Ctrl+D shortcut', async () => {
    serveCreate(serveGuests([]))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const field = await screen.findByRole('textbox', { name: 'Dodaj gościa' })

    const child = screen.getByRole('checkbox', { name: 'Dziecko' })
    expect(child).not.toBeChecked()
    expect(screen.queryByText(/Ctrl/)).not.toBeInTheDocument()

    await user.type(field, 'Staś')
    await user.keyboard('{Control>}d{/Control}')
    expect(child).not.toBeChecked()
  })

  it('stays checked after each add, so a run of children is just names and Enter, and sends isChild', async () => {
    const api = serveCreate(serveGuests([]))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const field = await screen.findByRole('textbox', { name: 'Dodaj gościa' })

    await user.click(screen.getByRole('checkbox', { name: 'Dziecko' }))
    await user.type(field, 'Staś{Enter}')
    await waitFor(() => expect(api.calls).toHaveLength(1))
    await user.type(field, 'Zosia{Enter}')
    await waitFor(() => expect(api.calls).toHaveLength(2))

    expect(api.calls).toEqual([
      { firstName: 'Staś', lastName: null, isChild: true },
      { firstName: 'Zosia', lastName: null, isChild: true },
    ])
    expect(screen.getByRole('checkbox', { name: 'Dziecko' })).toBeChecked()
    expect(
      await screen.findByText('Dodano dziecko: Zosia. W tej sesji dodanych: 2.'),
    ).toBeInTheDocument()
  })

  it('unchecking returns to adults, and the confirmation says which kind was added', async () => {
    const api = serveCreate(serveGuests([]))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const field = await screen.findByRole('textbox', { name: 'Dodaj gościa' })

    await user.click(screen.getByRole('checkbox', { name: 'Dziecko' }))
    await user.type(field, 'Staś{Enter}')
    await screen.findByText(/Dodano dziecko: Staś/)
    await user.click(screen.getByRole('checkbox', { name: 'Dziecko' }))
    await user.type(field, 'Ania{Enter}')

    await waitFor(() => expect(api.calls).toHaveLength(2))
    expect(api.calls[1]).toEqual({ firstName: 'Ania', lastName: null, isChild: false })
    expect(await screen.findByText('Dodano: Ania. W tej sesji dodanych: 2.')).toBeInTheDocument()
  })

  it('shows an obvious state while on: "Dodajesz dzieci"', async () => {
    serveCreate(serveGuests([]))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByRole('textbox', { name: 'Dodaj gościa' })
    expect(screen.queryByText('Dodajesz dzieci')).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Dziecko' }))

    expect(screen.getByText('Dodajesz dzieci')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Dziecko' }))
    expect(screen.queryByText('Dodajesz dzieci')).not.toBeInTheDocument()
  })

  it('keeps focus in the text input after a mouse or touch toggle', async () => {
    serveCreate(serveGuests([]))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const field = await screen.findByRole('textbox', { name: 'Dodaj gościa' })

    await user.click(screen.getByRole('checkbox', { name: 'Dziecko' }))

    await waitFor(() => expect(field).toHaveFocus())
  })

  it('is reachable by keyboard: Tab from the input, Space toggles, focus stays on the checkbox', async () => {
    serveCreate(serveGuests([]))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const field = await screen.findByRole('textbox', { name: 'Dodaj gościa' })
    await user.click(field)

    await user.tab()
    expect(screen.getByRole('checkbox', { name: 'Dziecko' })).toHaveFocus()
    await user.keyboard(' ')

    expect(screen.getByRole('checkbox', { name: 'Dziecko' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Dziecko' })).toHaveFocus()
  })

  it('a duplicate name keeps the text and says why, inline', async () => {
    serveGuests(SMALL_LIST)
    mockApi('post', '/guests', () =>
      HttpResponse.json(failure('duplicate_name', 'firstName'), { status: 422 }),
    )
    const { user } = renderPage(<GuestsPage />, '/goscie')
    await screen.findByText('Zosia')

    await user.type(input(), 'Maciek{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Gość o takim imieniu i nazwisku już jest na liście.',
    )
    expect(input()).toHaveValue('Maciek')
    expect(input()).toHaveFocus()
    expect(input()).toBeInvalid()
  })

  it('ten guests in a row need no mouse', async () => {
    const api = serveCreate(serveGuests([]))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const field = await screen.findByRole('textbox', { name: 'Dodaj gościa' })
    await user.click(field)

    for (let n = 1; n <= 10; n++) {
      await user.keyboard(`Gosc${n} Test{Enter}`)
      await waitFor(() => expect(api.calls).toHaveLength(n))
      await waitFor(() => expect(field).toHaveValue(''))
    }

    expect(field).toHaveFocus()
    expect(await screen.findByText(/W tej sesji dodanych: 10/)).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(10)
  })

  it('ignores Enter on an empty field', async () => {
    const api = serveCreate(serveGuests([]))
    const { user } = renderPage(<GuestsPage />, '/goscie')

    await user.type(await screen.findByRole('textbox', { name: 'Dodaj gościa' }), '   {Enter}')

    expect(api.calls).toHaveLength(0)
  })
})
