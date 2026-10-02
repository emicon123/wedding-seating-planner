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
const FAMILIES = [MACIEK, KAROLINA, MICHAL, OLA]

type User = ReturnType<typeof renderPage>['user']

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

async function openEditor(user: User, name: string) {
  await screen.findByRole('button', { name: `Powiązania: ${name}` })
  await user.click(screen.getByRole('button', { name: `Powiązania: ${name}` }))
  return screen.findByRole('dialog', { name: `Powiązania: ${name}` })
}

const block = (dialog: HTMLElement, level: 0 | 1 | 2) =>
  within(dialog).getByRole('region', { name: `Grupa ${level}` })

async function openPicker(user: User, dialog: HTMLElement, level: 0 | 1 | 2, name: string) {
  const section = block(dialog, level)
  const trigger =
    within(section).queryByRole('button', { name: `Edytuj grupę ${level}` }) ??
    within(section).getByRole('button', { name: `Wybierz gości do grupy ${level}` })
  await user.click(trigger)
  return screen.findByRole('dialog', { name: `Grupa ${level}: ${name}` })
}

describe('relationships panel', () => {
  it('shows who is linked at each level, with counts and the reason for each person', async () => {
    serveGuests(FAMILIES, MACIEK_FAMILY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    const group0 = block(dialog, 0)
    expect(await within(group0).findByText('Karolina Nowak')).toBeInTheDocument()
    expect(within(group0).getByText('wpisany bezpośrednio')).toBeInTheDocument()

    const group1 = block(dialog, 1)
    expect(await within(group1).findByText('2 osoby w 1 rodzinie')).toBeInTheDocument()
    expect(within(group1).getByText('Michał')).toBeInTheDocument()
    expect(within(group1).getByText('Ola')).toBeInTheDocument()
    expect(within(group1).getByText('przez grupę 0: Michał')).toBeInTheDocument()

    expect(within(block(dialog, 2)).getByText('brak')).toBeInTheDocument()
    expect(within(dialog).getByText('Łącznie powiązanych: 3')).toBeInTheDocument()
  })

  it('shows the same link on the other guest (symmetric), and who it came through', async () => {
    serveGuests(FAMILIES, MACIEK_FAMILY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Karolina Nowak')

    const group1 = block(dialog, 1)
    expect(await within(group1).findByText('Michał')).toBeInTheDocument()
    expect(within(group1).getAllByText('przez powiązanie: Maciek')).toHaveLength(2)
  })

  it('every name opens that person; "Wróć" walks back along the trail', async () => {
    serveGuests(FAMILIES, MACIEK_FAMILY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    await user.click(
      await within(block(dialog, 1)).findByRole('button', { name: 'Przejdź do: Michał' }),
    )

    expect(await screen.findByRole('dialog', { name: 'Powiązania: Michał' })).toBeInTheDocument()
    const michal = screen.getByRole('dialog')
    expect(within(block(michal, 0)).getByText('Ola')).toBeInTheDocument()
    expect(within(block(michal, 1)).getByText('Maciek')).toBeInTheDocument()

    await user.click(within(michal).getByRole('button', { name: 'Wróć: Maciek' }))

    expect(await screen.findByRole('dialog', { name: 'Powiązania: Maciek' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Wróć:/ })).not.toBeInTheDocument()
  })

  it('marks a disabled person as muted and says "wyłączony"', async () => {
    const disabledOla = { ...OLA, enabled: false }
    serveGuests([MACIEK, KAROLINA, MICHAL, disabledOla], MACIEK_FAMILY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    const ola = (await within(block(dialog, 1)).findByText('Ola')).closest('li')!
    expect(within(ola).getByText('wyłączony')).toBeInTheDocument()
  })

  it('"Pokaż na liście" narrows the guest list to this person and their relations', async () => {
    serveGuests([...FAMILIES, makeGuest({ id: 8, firstName: 'Zosia' })], MACIEK_FAMILY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    await user.click(within(dialog).getByRole('button', { name: 'Pokaż na liście' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('search')).toHaveTextContent('powiazani=4')
    expect(screen.queryByText('Zosia')).not.toBeInTheDocument()
    expect(screen.getByText(/Powiązani z: Maciek/)).toBeInTheDocument()
  })

  it('removing a direct link sends DELETE /guest-links/4-5', async () => {
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
    serveGuests(FAMILIES, overview)
    const { user } = renderPage(<GuestsPage />, '/goscie')

    // page level: a banner, and a flag on the row of every guest involved
    const banner = (await screen.findByText(/Uwagi do danych \(2\)/)).closest('details')!
    expect(within(banner).getByText(/za duża na stół 8-osobowy/)).toBeInTheDocument()
    expect(within(banner).getByText(/jednocześnie grupą 1 i 2/)).toBeInTheDocument()
    const flagged = screen.getByRole('switch', { name: 'Uwzględniony: Michał' }).closest('li')!
    expect(within(flagged).getByText('Uwaga do danych')).toBeInTheDocument()

    // panel level: only the warnings touching this guest's cluster
    const dialog = await openEditor(user, 'Maciek')
    const warnings = await within(dialog).findByRole('list', { name: 'Uwagi do danych' })
    expect(within(warnings).getByText(/jednocześnie grupą 1 i 2/)).toBeInTheDocument()
    expect(within(warnings).queryByText(/8-osobowy/)).not.toBeInTheDocument()
  })

  it("a banner name opens that guest's panel", async () => {
    const overview: ClusterOverview = {
      clusters: MACIEK_FAMILY_OVERVIEW.clusters,
      warnings: [{ code: 'cluster_exceeds_8', message: 'English', guestIds: [6, 7] }],
    }
    serveGuests(FAMILIES, overview)
    const { user } = renderPage(<GuestsPage />, '/goscie')

    const banner = (await screen.findByText(/Uwagi do danych \(1\)/)).closest('details')!
    await user.click(within(banner).getByRole('button', { name: 'Michał' }))

    expect(await screen.findByRole('dialog', { name: 'Powiązania: Michał' })).toBeInTheDocument()
  })
})

describe('group checklist (picker)', () => {
  it('lists every other guest alphabetically, with the group members of that group pre-ticked', async () => {
    serveGuests(FAMILIES, MACIEK_FAMILY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    const picker = await openPicker(user, dialog, 0, 'Maciek')

    const boxes = within(picker).getAllByRole('checkbox')
    expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual([
      'Karolina Nowak',
      'Michał',
      'Ola',
    ])
    expect(within(picker).getByRole('checkbox', { name: 'Karolina Nowak' })).toBeChecked()
    expect(within(picker).getByRole('checkbox', { name: 'Michał' })).not.toBeChecked()
    expect(within(picker).getByText('Zaznaczono: 1')).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: 'Zapisz' })).toBeDisabled()
  })

  it('ticking Michał for group 1 previews Ola, sends nothing until Zapisz, then PUTs and closes', async () => {
    const state = serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const api = serveLinkMichal(state)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 1, 'Maciek')

    await user.click(within(picker).getByRole('checkbox', { name: 'Michał' }))

    expect(within(picker).getByText('Zaznaczono: 1')).toBeInTheDocument()
    expect(within(picker).getByText('Dodaj: 1')).toBeInTheDocument()
    const preview = within(picker).getByRole('region', { name: 'Kto dołączy automatycznie' })
    expect(within(preview).getByText('Ola')).toBeInTheDocument()
    expect(within(preview).getByText(/przez grupę 0: Michał/)).toBeInTheDocument()
    expect(api.calls).toEqual([])

    await user.click(within(picker).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(api.calls).toEqual([{ level: 1 }]))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Grupa 1: Maciek' })).not.toBeInTheDocument(),
    )
    const group1 = block(screen.getByRole('dialog', { name: 'Powiązania: Maciek' }), 1)
    expect(await within(group1).findByText('przez grupę 0: Michał')).toBeInTheDocument()
  })

  it('Anuluj sends nothing, closes only the picker and returns focus to the button that opened it', async () => {
    const state = serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const api = serveLinkMichal(state)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 1, 'Maciek')
    await user.click(within(picker).getByRole('checkbox', { name: 'Michał' }))

    await user.click(within(picker).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Grupa 1: Maciek' })).not.toBeInTheDocument(),
    )
    expect(api.calls).toEqual([])
    expect(screen.getByRole('dialog', { name: 'Powiązania: Maciek' })).toBeInTheDocument()
    await waitFor(() =>
      expect(
        within(block(screen.getByRole('dialog'), 1)).getByRole('button', {
          name: 'Wybierz gości do grupy 1',
        }),
      ).toHaveFocus(),
    )
  })

  it('Esc cancels the picker only', async () => {
    serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    await openPicker(user, dialog, 1, 'Maciek')

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Grupa 1: Maciek' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'Powiązania: Maciek' })).toBeInTheDocument()
  })

  it('works from the keyboard: Tab to a row, Space to tick', async () => {
    serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 1, 'Maciek')

    within(picker).getByRole('checkbox', { name: 'Michał' }).focus()
    await user.keyboard(' ')

    expect(within(picker).getByRole('checkbox', { name: 'Michał' })).toBeChecked()
  })

  it('moving: a guest linked at another level is flagged "teraz: Grupa 1", and ticking moves the link', async () => {
    serveGuests(FAMILIES, MACIEK_FAMILY_OVERVIEW)
    const api = mockApi('put', '/guest-links/4-6', () =>
      HttpResponse.json(single({ key: '4-6', guestIds: [4, 6], level: 2 })),
    )
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 2, 'Maciek')

    const row = within(picker).getByRole('checkbox', { name: 'Michał' }).closest('li')!
    expect(within(row).getByText('teraz: Grupa 1')).toBeInTheDocument()
    await user.click(within(picker).getByRole('checkbox', { name: 'Michał' }))

    expect(within(row).getByText(/z grupy 1 do grupy 2/)).toBeInTheDocument()
    expect(within(picker).getByText('Przenieś z innej grupy: 1')).toBeInTheDocument()
    await user.click(within(picker).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(api.calls).toEqual([{ level: 2 }]))
  })

  it('unticking a guest of that group deletes the link; the summary says so', async () => {
    serveGuests(FAMILIES, MACIEK_FAMILY_OVERVIEW)
    const api = mockApi('delete', '/guest-links/4-5', () => new HttpResponse(null, { status: 204 }))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 0, 'Maciek')

    await user.click(within(picker).getByRole('checkbox', { name: 'Karolina Nowak' }))

    expect(within(picker).getByText('Zaznaczono: 0')).toBeInTheDocument()
    expect(within(picker).getByText('Usuń: 1')).toBeInTheDocument()
    await user.click(within(picker).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(api.calls).toHaveLength(1))
  })

  it('a search box narrows the list; ticks outside the filter are kept and counted', async () => {
    serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 1, 'Maciek')
    await user.click(within(picker).getByRole('checkbox', { name: 'Ola' }))

    await user.type(within(picker).getByRole('searchbox', { name: 'Szukaj gościa' }), 'micha')

    await waitFor(() => expect(within(picker).getAllByRole('checkbox')).toHaveLength(1))
    expect(within(picker).getByRole('checkbox', { name: 'Michał' })).toBeInTheDocument()
    expect(within(picker).getByText('Zaznaczono: 1')).toBeInTheDocument()
  })

  it('"Tylko zaznaczeni" reviews the ticked guests', async () => {
    serveGuests(FAMILIES, MACIEK_FAMILY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 1, 'Maciek')

    await user.click(within(picker).getByRole('button', { name: 'Tylko zaznaczeni' }))

    expect(
      within(picker)
        .getAllByRole('checkbox')
        .map((box) => box.getAttribute('aria-label')),
    ).toEqual(['Michał'])
  })

  it('marks children and disabled guests, who stay selectable', async () => {
    const child = makeGuest({ id: 8, firstName: 'Zosia', isChild: true })
    const off = makeGuest({ id: 9, firstName: 'Staś', enabled: false })
    serveGuests([MACIEK_UNLINKED, KAROLINA, child, off], makeOverview([]))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 2, 'Maciek')

    const zosia = within(picker).getByRole('checkbox', { name: 'Zosia' }).closest('li')!
    expect(within(zosia).getByText('Dziecko')).toBeInTheDocument()
    const stas = within(picker).getByRole('checkbox', { name: 'Staś' })
    expect(within(stas.closest('li')!).getByText('wyłączony')).toBeInTheDocument()
    expect(stas).toBeEnabled()
  })

  it('does not offer a plain group-1 link to a cluster-mate who is already in group 0', async () => {
    const chain = [
      makeGuest({ id: 1, firstName: 'Anna', links: [link(2, 0)] }),
      makeGuest({ id: 2, firstName: 'Bartek', links: [link(1, 0), link(3, 0)] }),
      makeGuest({ id: 3, firstName: 'Cezary', links: [link(2, 0)] }),
    ]
    serveGuests(chain, makeOverview([makeCluster({ key: 1, guestIds: [1, 2, 3] })]))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Anna')
    const picker = await openPicker(user, dialog, 1, 'Anna')

    const cezary = within(picker).getByRole('checkbox', { name: 'Cezary' })
    expect(cezary).toBeDisabled()
    expect(within(cezary.closest('li')!).getByText(/już w paczce/)).toBeInTheDocument()
  })

  it('group 0: previews the merged cluster and warns (without blocking) above 8', async () => {
    const big = Array.from({ length: 8 }, (_, i) =>
      makeGuest({
        id: 20 + i,
        firstName: `Rodzina${i}`,
        links: [...(i > 0 ? [link(19 + i, 0)] : []), ...(i < 7 ? [link(21 + i, 0)] : [])],
      }),
    )
    const overview = makeOverview([
      makeCluster({ key: 4, guestIds: [4, 5] }),
      makeCluster({ key: 20, guestIds: big.map((guest) => guest.id) }),
    ])
    serveGuests([MACIEK_UNLINKED, KAROLINA, ...big], overview)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 0, 'Maciek')

    await user.click(within(picker).getByRole('checkbox', { name: 'Rodzina0' }))

    const preview = within(picker).getByRole('region', { name: 'Kto dołączy automatycznie' })
    expect(within(preview).getByText(/Paczka po zapisie: 10 osób/)).toBeInTheDocument()
    expect(within(preview).getByText(/za duża na stół 8-osobowy/)).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: 'Zapisz' })).toBeEnabled()
  })

  it('a refused change is named, the picker stays open and shows what is left to save', async () => {
    const zosia = makeGuest({ id: 8, firstName: 'Zosia' })
    const state = serveGuests([...SEPARATE_FAMILIES, zosia], SEPARATE_OVERVIEW)
    const ok = serveLinkMichal(state)
    mockApi('put', '/guest-links/4-8', () =>
      HttpResponse.json(failure('not_found'), { status: 404 }),
    )
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 1, 'Maciek')
    await user.click(within(picker).getByRole('checkbox', { name: 'Michał' }))
    await user.click(within(picker).getByRole('checkbox', { name: 'Zosia' }))

    await user.click(within(picker).getByRole('button', { name: 'Zapisz' }))

    const alert = await within(picker).findByRole('alert')
    expect(alert).toHaveTextContent(/Nie udało się zapisać: Zosia/)
    expect(alert).toHaveTextContent(/Nie znaleziono/)
    expect(ok.calls).toEqual([{ level: 1 }])
    expect(screen.getByRole('dialog', { name: 'Grupa 1: Maciek' })).toBeInTheDocument()
    // the refetch made Michał's link real: only Zosia is left to add
    await waitFor(() => expect(within(picker).getByText('Dodaj: 1')).toBeInTheDocument())
  })

  it('"Dodaj «X» jako nowego gościa" creates the guest and ticks them; the link is sent on Zapisz', async () => {
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
    const picker = await openPicker(user, dialog, 1, 'Maciek')

    await user.type(
      within(picker).getByRole('searchbox', { name: 'Szukaj gościa' }),
      'Basia Zielona',
    )
    await user.click(
      await within(picker).findByRole('button', {
        name: 'Dodaj «Basia Zielona» jako nowego gościa',
      }),
    )

    expect(post.calls).toEqual([{ firstName: 'Basia', lastName: 'Zielona', isChild: false }])
    expect(await within(picker).findByRole('checkbox', { name: 'Basia Zielona' })).toBeChecked()
    expect(put.calls).toEqual([])
    await user.click(within(picker).getByRole('button', { name: 'Zapisz' }))
    await waitFor(() => expect(put.calls).toEqual([{ level: 1 }]))
  })

  it('does not offer to create a guest whose exact name exists, and shows a duplicate refusal inline', async () => {
    serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    mockApi('post', '/guests', () =>
      HttpResponse.json(failure('duplicate_name', 'firstName'), { status: 422 }),
    )
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 1, 'Maciek')
    const search = within(picker).getByRole('searchbox', { name: 'Szukaj gościa' })

    await user.type(search, 'ola')
    expect(within(picker).queryByRole('button', { name: /Dodaj «/ })).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'Nowy Gość')
    await user.click(await within(picker).findByRole('button', { name: /Dodaj «Nowy Gość»/ }))

    expect(await within(picker).findByRole('alert')).toHaveTextContent(/już jest na liście/)
  })
})

// Regression (user report): Emilka lists Justynka, Maks and "os. tow." in group 0. Group 0 is a
// cluster: from Justynka the whole party is there, and Maks / "os. tow." are only reached through
// Emilka, so they cannot be unticked from Justynka.
describe('group 0 is the whole cluster', () => {
  const PARTY = [
    makeGuest({ id: 1, firstName: 'Emilka', links: [link(2, 0), link(3, 0), link(4, 0)] }),
    makeGuest({ id: 2, firstName: 'Justynka', links: [link(1, 0)] }),
    makeGuest({ id: 3, firstName: 'Maks', links: [link(1, 0)] }),
    makeGuest({ id: 4, firstName: 'os. tow.', links: [link(1, 0)] }),
  ]
  const PARTY_OVERVIEW = makeOverview([makeCluster({ key: 1, guestIds: [1, 2, 3, 4] })])

  it('Justynka sees 3 people in group 0, with the reason for each', async () => {
    serveGuests(PARTY, PARTY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Justynka')

    const group0 = block(dialog, 0)
    expect(await within(group0).findByText('3 osoby')).toBeInTheDocument()
    expect(within(group0).getByText('Emilka')).toBeInTheDocument()
    expect(within(group0).getByText('Maks')).toBeInTheDocument()
    expect(within(group0).getByText('os. tow.')).toBeInTheDocument()
    expect(within(group0).getByText('wpisany bezpośrednio')).toBeInTheDocument()
    expect(within(group0).getAllByText('przez grupę 0: Emilka')).toHaveLength(2)
    // only the direct link can be removed from here
    expect(within(group0).getAllByRole('button', { name: /Usuń powiązanie/ })).toHaveLength(1)
  })

  it('the group 0 checklist shows the reached people ticked and fixed, with where to change them', async () => {
    serveGuests(PARTY, PARTY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Justynka')
    const picker = await openPicker(user, dialog, 0, 'Justynka')

    const maks = within(picker).getByRole('checkbox', { name: 'Maks' })
    expect(maks).toBeChecked()
    expect(maks).toBeDisabled()
    expect(within(maks.closest('li')!).getByText(/Zmień to przy: Emilka/)).toBeInTheDocument()
    expect(within(picker).getByRole('checkbox', { name: 'Emilka' })).toBeEnabled()
    expect(within(picker).getByText('Zaznaczono: 1')).toBeInTheDocument()
    expect(within(picker).getByText(/Paczka po zapisie: 4 osoby/)).toBeInTheDocument()
  })

  it('unticking the only direct link releases the people reached through it', async () => {
    serveGuests(PARTY, PARTY_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Justynka')
    const picker = await openPicker(user, dialog, 0, 'Justynka')

    await user.click(within(picker).getByRole('checkbox', { name: 'Emilka' }))

    const maks = within(picker).getByRole('checkbox', { name: 'Maks' })
    expect(maks).not.toBeChecked()
    expect(maks).toBeEnabled()
    expect(within(picker).getByText(/Paczka po zapisie: 1 osoba/)).toBeInTheDocument()
  })

  it('a fifth person linked to Maks later shows up for Justynka too', async () => {
    const five = [
      ...PARTY.map((guest) =>
        guest.id === 3 ? { ...guest, links: [...guest.links, link(5, 0)] } : guest,
      ),
      makeGuest({ id: 5, firstName: 'Piąty', links: [link(3, 0)] }),
    ]
    serveGuests(five, makeOverview([makeCluster({ key: 1, guestIds: [1, 2, 3, 4, 5] })]))
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Justynka')

    const group0 = block(dialog, 0)
    expect(await within(group0).findByText('4 osoby')).toBeInTheDocument()
    expect(within(group0).getByText('Piąty')).toBeInTheDocument()
  })
})

// Regression (user report): Bartek + group 1 Maja. Maja and Darek are a group-0 cluster, so
// ticking Maja ticks Darek too, and one click on the family removes everybody.
describe('group 1 works on whole clusters', () => {
  it('ticking Michał ticks Ola (his group-0 mate) as fixed, unticking releases her', async () => {
    serveGuests(SEPARATE_FAMILIES, SEPARATE_OVERVIEW)
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')
    const picker = await openPicker(user, dialog, 1, 'Maciek')

    await user.click(within(picker).getByRole('checkbox', { name: 'Michał' }))

    const ola = within(picker).getByRole('checkbox', { name: 'Ola' })
    expect(ola).toBeChecked()
    expect(ola).toBeDisabled()
    expect(within(ola.closest('li')!).getByText('przez grupę 0: Michał')).toBeInTheDocument()
    expect(within(picker).getByText('Zaznaczono: 1')).toBeInTheDocument()

    await user.click(within(picker).getByRole('checkbox', { name: 'Michał' }))

    const freed = within(picker).getByRole('checkbox', { name: 'Ola' })
    expect(freed).not.toBeChecked()
    expect(freed).toBeEnabled()
  })

  it('"Usuń rodzinę" removes the whole family with one click', async () => {
    const state = serveGuests(FAMILIES, MACIEK_FAMILY_OVERVIEW)
    const api = mockApi('delete', '/guest-links/4-6', () => {
      state.guests = state.guests.map((guest) => {
        if (guest.id === 4) return { ...guest, links: guest.links.filter((l) => l.guestId !== 6) }
        if (guest.id === 6) return { ...guest, links: guest.links.filter((l) => l.guestId !== 4) }
        return guest
      })
      state.overview = SEPARATE_OVERVIEW
      return new HttpResponse(null, { status: 204 })
    })
    const { user } = renderPage(<GuestsPage />, '/goscie')
    const dialog = await openEditor(user, 'Maciek')

    const group1 = block(dialog, 1)
    expect(await within(group1).findByText('Ola')).toBeInTheDocument()
    // Ola comes along through Michał's group 0, so she has no X of her own…
    expect(
      within(group1).queryByRole('button', { name: 'Usuń powiązanie: Ola' }),
    ).not.toBeInTheDocument()

    await user.click(
      within(group1).getByRole('button', { name: 'Usuń rodzinę: Michał, Ola' }),
    )

    await waitFor(() => expect(api.calls).toHaveLength(1))
    await waitFor(() =>
      expect(within(block(dialog, 1)).getByText('brak')).toBeInTheDocument(),
    )
  })
})
