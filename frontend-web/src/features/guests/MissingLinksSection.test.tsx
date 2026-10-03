import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { familyReach } from '@/domain/acquaintance'
import { REPORT_FAMILIES, reportGuests, reportOverview } from '@/features/guests/fixtures'
import { MissingLinksSection } from '@/features/guests/MissingLinksSection'

const guests = reportGuests()
const nameOf = (id: number) => guests.find((g) => g.id === id)?.displayName ?? `Gość ${id}`

function renderSection(families = REPORT_FAMILIES) {
  const onOpenLinks = vi.fn()
  const reaches = familyReach(reportGuests(families), reportOverview(families))
  const user = userEvent.setup()
  render(<MissingLinksSection reaches={reaches} nameOf={nameOf} onOpenLinks={onOpenLinks} />)
  return { user, onOpenLinks }
}

const HEADER = 'Braki powiązań: 2 rodziny bez stołu w gronie znajomych, 2 tylko na mniejszy stół'

describe('MissingLinksSection', () => {
  it('shows the counts in the header and is collapsed by default', () => {
    renderSection()

    const header = screen.getByRole('button', { name: HEADER })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Żeby nikt nie siedział z obcymi/)).toBeNull()
  })

  it('expands to the help text and the rows, worst first, then counts the rest', async () => {
    const { user } = renderSection()

    await user.click(screen.getByRole('button', { name: HEADER }))

    expect(screen.getByRole('button', { name: HEADER })).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByText(
        'Żeby nikt nie siedział z obcymi, każda rodzina potrzebuje grupy co najmniej 8 osób, w której wszyscy się znają (grupa 0, 1 lub 2). Dopisz powiązania z grup 1/2 z rodzinami, które znają też ich znajomi.',
      ),
    ).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => within(row).getAllByRole('button')[0]!.textContent)).toEqual([
      'Filip Sam',
      'Ewa Solo, Ewa1 Solo',
      'Anna Kowal, Anna1 Kowal, Anna2 Kowal +2',
      'Bartek Lis, Bartek1 Lis, Bartek2 Lis +1',
    ])
    expect(
      screen.getByText('Pozostałe rodziny (2): wystarczy znajomych na pełny stół.'),
    ).toBeInTheDocument()
  })

  it('gives every row its figures, a badge with text and who they would sit with', async () => {
    const { user } = renderSection()
    await user.click(screen.getByRole('button', { name: HEADER }))
    const [filip, ewa, anna] = screen.getAllByRole('listitem')

    expect(within(filip!).getByText('Zna: 0 os.')).toBeInTheDocument()
    expect(within(filip!).getByText('Największa grupa znajomych: 1 os.')).toBeInTheDocument()
    expect(within(filip!).getByText('Za mało znajomych na stół (min. 8)')).toBeInTheDocument()
    expect(
      within(filip!).getByText('Nikt — dopisz pierwsze powiązania z grup 1/2'),
    ).toBeInTheDocument()
    expect(within(ewa!).getByText('Zna: 1 os.')).toBeInTheDocument()
    expect(within(anna!).getByText('Zna: 8 os.')).toBeInTheDocument()
    expect(within(anna!).getByText('Największa grupa znajomych: 9 os.')).toBeInTheDocument()
    expect(within(anna!).getByText('Stół bez obcych najwyżej na 9 os.')).toBeInTheDocument()
    expect(within(anna!).getByText('Razem z: Bartek Lis')).toBeInTheDocument()
  })

  it('opens the relations panel of the first member of the clicked family', async () => {
    const { user, onOpenLinks } = renderSection()
    await user.click(screen.getByRole('button', { name: HEADER }))

    await user.click(screen.getByRole('button', { name: 'Filip Sam' }))
    expect(onOpenLinks).toHaveBeenLastCalledWith(6000)
    await user.click(screen.getByRole('button', { name: /^Anna Kowal/ }))
    expect(onOpenLinks).toHaveBeenLastCalledWith(1000)
  })

  it('notes that a group of exactly 8 is not enough for the mixed plan', async () => {
    const { user } = renderSection([
      { key: 10, name: 'Anna Kowal', size: 5, links: [20] },
      { key: 20, name: 'Bartek Lis', size: 3, links: [10] },
    ])
    await user.click(screen.getByRole('button', { name: /^Braki powiązań/ }))

    expect(screen.getAllByText('Stół bez obcych najwyżej na 8 os.')).toHaveLength(2)
    expect(screen.getAllByText('Plan mieszany ma minimum 9 osób przy stole.')).toHaveLength(2)
  })

  it('says everything is fine, without an expander, when every family reaches a full table', () => {
    renderSection([
      { key: 30, name: 'Cezary Nowak', size: 6, links: [40] },
      { key: 40, name: 'Dorota Maj', size: 6, links: [30] },
    ])

    expect(screen.getByText('Każda rodzina ma grupę znajomych na pełny stół.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing without families', () => {
    const { container } = render(
      <MissingLinksSection reaches={[]} nameOf={nameOf} onOpenLinks={() => undefined} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
