import { render, screen } from '@testing-library/react'
import { makePlan } from '@/test/builders'
import { PlanFigures } from '@/features/plans/PlanFigures'

const summary = makePlan([{ number: 1, clusters: [] }]).summary

describe('PlanFigures: isolated guests', () => {
  it('counts them under the figures', () => {
    render(<PlanFigures summary={summary} isolated={4} />)

    expect(screen.getByText('Bez znajomych przy stole: 4 os.')).toBeInTheDocument()
  })

  it.each([0, undefined])('shows nothing for %s', (isolated) => {
    render(<PlanFigures summary={summary} isolated={isolated} />)

    expect(screen.queryByText(/Bez znajomych przy stole/)).toBeNull()
  })

  it('renders a negative plan score', () => {
    render(<PlanFigures summary={{ ...summary, score: -3 }} />)

    expect(screen.getByText('Zadowolenie').nextSibling).toHaveTextContent(/^[-−]3$/)
  })

  it('explains in a tooltip that the score sums adults only', () => {
    render(<PlanFigures summary={summary} />)

    expect(screen.getByTitle('Suma zadowolenia dorosłych — dzieci się nie liczą')).toContainElement(
      screen.getByText('Zadowolenie'),
    )
  })
})

describe('PlanFigures: stranger pairs and bilans (task 015)', () => {
  it.each([0, 7])('shows "Pary obcych: %i", also for zero', (pairs) => {
    render(<PlanFigures summary={summary} strangerPairs={pairs} />)

    expect(screen.getByText(`Pary obcych: ${pairs}`)).toBeInTheDocument()
  })

  it('shows nothing when the props are undefined', () => {
    render(<PlanFigures summary={summary} />)

    expect(screen.queryByText(/Pary obcych/)).toBeNull()
    expect(screen.queryByText(/Bilans/)).toBeNull()
  })

  it('shows the bilans with its tooltip, negative included', () => {
    render(<PlanFigures summary={summary} bilans={-4} />)

    expect(screen.getByText('Bilans: -4')).toHaveAttribute(
      'title',
      'Zadowolenie minus 2 za każdą parę obcych (każda z dwóch osób traci 1)',
    )
  })

  it('explains the pairs in a tooltip and is no violation', () => {
    render(<PlanFigures summary={summary} strangerPairs={3} />)

    expect(screen.getByText('Pary obcych: 3')).toHaveAttribute(
      'title',
      'Pary dorosłych przy jednym stole, którzy się nie znają (ani grupa 0, ani 1, ani 2)',
    )
    expect(screen.getByText('Naruszenia').nextSibling).toHaveTextContent('1')
  })
})
