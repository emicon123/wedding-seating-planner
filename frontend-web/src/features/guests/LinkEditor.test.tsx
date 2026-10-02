import { screen, waitFor, within } from '@testing-library/react'
import type { ClusterOverview, Guest } from '@/domain/types'
import { GuestsPage } from '@/features/guests/GuestsPage'
import { serveGuests } from '@/features/guests/fixtures'
import {
  KAROLINA,
  MACIEK,
  MACIEK_FAMILY_OVERVIEW,
  MICHAL,
  OLA,
  link,
  makeCluster,
  makeGuest,
  makeOverview,
} from '@/test/builders'
import { failure, HttpResponse, mockApi, single } from '@/test/server'
import { renderPage } from '@/test/renderPage'

// Maciek + Karolina are group 0; Michał + Ola are group 0; the two families are NOT linked yet.
const MACIEK_UNLINKED: Guest = { ...MACIEK, links: [link(5, 0)] }
const MICHAL_UNLINKED: Guest = { ...MICHAL, links: [link(7, 0)] }
const SEPARATE_FAMILIES = [MACIEK_UNLINKED, KAROLINA, MICHAL_UNLINKED, OLA]
const SEPARATE_OVERVIEW = makeOverview([
  makeCluster({ key: 4, guestIds: [4, 5] }),
  makeCluster({ key: 6, guestIds: [6, 7] }),
])

/** PUT /guest-links/4-6 that links the families for real: the refetch then shows the expansion. */
function serveLinkMichal(state: { guests: Guest[]; overview: ClusterOverview }) {
  return mockApi('put', '/guest-links/4-6', () => {
    state.guests = state.guests.map((guest) => {
      if (guest.id === 4) return { ...guest, links: [...guest.links, link(6, 1)] }
      if (guest.id === 6) return { ...guest, links: [...guest.links, link(4, 1)] }
      return guest
    })
    state.overview = MACIEK_FAMILY_OVERVIEW
    return HttpResponse.json(single({ key: '4-6', guestIds: [4, 6], level: 1 }))
  })
}

async function openEditor(user: ReturnType<typeof renderPage>['user'], name: string) {
  await screen.findByRole('button', { name: `Powiązania: ${name}` })
  await user.click(screen.getByRole('button', { name: `Powiązania: ${name}` }))
  return screen.findByRole('dialog', { name: `Powiązania: ${name}` })
}

describe('LinkEditor', () => {
  it('picking Michał in Grupa 1 sends PUT /guest-links/4-6 {level:1}, then shows him and Ola "przez grupę 0"', async () => {
    const state = serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const api = serveLinkMichal(state)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    const search = within(dialog).getByRole('combobox', { name: 'Dodaj do grupy 1' })
    await user.type(search, 'Micha')
    await user.click(await within(dialog).findByRole('option', { name: 'Michał' }))

    await waitFor(() => expect(api.calls).toEqual([{ level: 1 }]))
    const column = within(dialog).getByRole('region', { name: 'Grupa 1' })
    await within(column).findByText('Michał')
    expect(await within(column).findByText(/Ola/)).toBeInTheDocument()
    expect(within(column).getByText(/\(przez grupę 0: Michał\)/)).toBeInTheDocument()
    // the derived companion cannot be removed here: only the direct link can
    expect(within(column).getAllByRole('button', { name: /Usuń powiązanie/ })).toHaveLength(1)
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
  })

  it('works from the keyboard only: type, arrow, Enter', async () => {
    const state = serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const api = serveLinkMichal(state)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    within(dialog).getByRole('combobox', { name: 'Dodaj do grupy 1' }).focus()
    await user.keyboard('l') // Karolina, Michał, Ola contain an "l"
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(api.calls).toEqual([{ level: 1 }]))
  })

  it('shows the same link on the other guest (symmetric)', async () => {
    serveGuests([MACIEK, KAROLINA, MICHAL, OLA], MACIEK_FAMILY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Michał')

    const column = within(dialog).getByRole('region', { name: 'Grupa 1' })
    expect(await within(column).findByText('Maciek')).toBeInTheDocument()
    expect(within(column).getByText(/Karolina Nowak/)).toBeInTheDocument()
    expect(within(column).getByText(/\(przez grupę 0: Maciek\)/)).toBeInTheDocument()
  })

  it('offers "Dodaj «X» jako nowego gościa": POST /guests, then PUT the link', async () => {
    const state = serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const created = makeGuest({ id: 100, firstName: 'Basia', lastName: 'Zielona' })
    const post = mockApi('post', '/guests', () => {
      state.guests = [...state.guests, created]
      return HttpResponse.json(single(created), { status: 201 })
    })
    const put = mockApi('put', '/guest-links/4-100', () =>
      HttpResponse.json(single({ key: '4-100', guestIds: [4, 100], level: 1 })),
    )
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    await user.type(
      within(dialog).getByRole('combobox', { name: 'Dodaj do grupy 1' }),
      'Basia Zielona',
    )
    await user.click(
      await within(dialog).findByRole('option', {
        name: 'Dodaj «Basia Zielona» jako nowego gościa',
      }),
    )

    await waitFor(() => expect(put.calls).toEqual([{ level: 1 }]))
    expect(post.calls).toEqual([{ firstName: 'Basia', lastName: 'Zielona', isChild: false }])
  })

  it('keeps the text and says so inline when the new guest has a duplicate name', async () => {
    serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    mockApi('post', '/guests', () =>
      HttpResponse.json(failure('duplicate_name', 'firstName'), { status: 422 }),
    )
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const search = within(dialog).getByRole('combobox', { name: 'Dodaj do grupy 2' })

    await user.type(search, 'Nowy Gość{Enter}')

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/już jest na liście/)
    expect(search).toHaveValue('Nowy Gość')
  })

  it('does not offer to create a guest whose exact name already exists', async () => {
    serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    await user.type(within(dialog).getByRole('combobox', { name: 'Dodaj do grupy 1' }), 'ola')

    expect(await within(dialog).findByRole('option', { name: 'Ola' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('option', { name: /Dodaj «/ })).not.toBeInTheDocument()
  })

  it('removing a link sends DELETE /guest-links/4-5', async () => {
    serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const api = mockApi('delete', '/guest-links/4-5', () => new HttpResponse(null, { status: 204 }))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    await user.click(
      await within(dialog).findByRole('button', { name: 'Usuń powiązanie: Karolina Nowak' }),
    )

    await waitFor(() => expect(api.calls).toHaveLength(1))
  })

  it('shows cluster_exceeds_8 and conflicting_link_levels next to the guests involved', async () => {
    const overview: ClusterOverview = {
      clusters: MACIEK_FAMILY_OVERVIEW.clusters,
      warnings: [
        { code: 'cluster_exceeds_8', message: 'English', guestIds: [6, 7] },
        { code: 'conflicting_link_levels', message: 'English', guestIds: [4, 5] },
      ],
    }
    serveGuests([MACIEK, KAROLINA, MICHAL, OLA], overview)
    const { user } = renderPage(<GuestsPage />, '/goscie')

    // page level: a banner, and a flag on the row of every guest involved
    const banner = (await screen.findByText(/Uwagi do danych \(2\)/)).closest('details')!
    expect(within(banner).getByText(/za duża na stół 8-osobowy/)).toBeInTheDocument()
    expect(within(banner).getByText(/jednocześnie grupą 1 i 2/)).toBeInTheDocument()
    const flagged = screen.getByRole('switch', { name: 'Uwzględniony: Michał' }).closest('li')!
    expect(within(flagged).getByText('Uwaga do danych')).toBeInTheDocument()

    // editor level: only the warnings touching this guest's cluster
    const dialog = await openEditor(user, 'Maciek')
    const warnings = await within(dialog).findByRole('list', { name: 'Uwagi do danych' })
    expect(within(warnings).getByText(/jednocześnie grupą 1 i 2/)).toBeInTheDocument()
    expect(within(warnings).queryByText(/8-osobowy/)).not.toBeInTheDocument()
  })

  it("a banner name opens that guest's editor", async () => {
    const overview: ClusterOverview = {
      clusters: MACIEK_FAMILY_OVERVIEW.clusters,
      warnings: [{ code: 'cluster_exceeds_8', message: 'English', guestIds: [6, 7] }],
    }
    serveGuests([MACIEK, KAROLINA, MICHAL, OLA], overview)
    const { user } = renderPage(<GuestsPage />, '/goscie')

    const banner = (await screen.findByText(/Uwagi do danych \(1\)/)).closest('details')!
    await user.click(within(banner).getByRole('button', { name: 'Michał' }))

    expect(await screen.findByRole('dialog', { name: 'Powiązania: Michał' })).toBeInTheDocument()
  })
})
