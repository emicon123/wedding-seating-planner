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
})
