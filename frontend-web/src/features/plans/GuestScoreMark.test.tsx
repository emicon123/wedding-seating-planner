import { render, screen } from '@testing-library/react'
import type { GuestScore } from '@/domain/types'
import { GuestScoreMark } from '@/features/plans/GuestScoreMark'

function score(over: Partial<GuestScore>): GuestScore {
  return {
    guestId: 1,
    tableNumber: 1,
    satisfaction: 0,
    preferredTotal: 0,
    preferredAtTable: 0,
    fallbackAtTable: 0,
    strangersAtTable: 0,
    ...over,
  }
}

describe('GuestScoreMark: "Bez znajomych przy stole"', () => {
  it('shows the badge for an isolated guest whose partners are all group 2 (nothing else to show)', () => {
    render(<GuestScoreMark score={score({ satisfaction: -1 })} />)

    expect(screen.getByText('Bez znajomych przy stole')).toBeInTheDocument()
    expect(screen.getByTitle(/Bez znajomych przy stole/)).toBeInTheDocument()
  })

  it('shows the badge before the brick hearts for an isolated guest with group 1 partners', () => {
    const { container } = render(
      <GuestScoreMark
        score={score({ satisfaction: -1, preferredTotal: 3, preferredAtTable: 0 })}
      />,
    )

    const badge = screen.getByText('Bez znajomych przy stole')
    const hearts = screen.getByText('Przy stole 0 z 3 preferowanych osób')
    expect(badge.compareDocumentPosition(hearts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('svg')).toHaveLength(2)
  })

  it.each([0, 0.5, 2.5])('is not shown for satisfaction %s', (satisfaction) => {
    render(
      <GuestScoreMark
        score={score({
          satisfaction,
          preferredTotal: 2,
          preferredAtTable: satisfaction > 0 ? 1 : 0,
        })}
      />,
    )

    expect(screen.queryByText('Bez znajomych przy stole')).toBeNull()
  })

  it('renders nothing for a guest without partners', () => {
    const { container } = render(<GuestScoreMark score={score({})} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders no mark and no badge for a child (all-zero score, task 014)', () => {
    const { container } = render(<GuestScoreMark score={score({ tableNumber: 3 })} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Bez znajomych przy stole')).toBeNull()
  })
})
