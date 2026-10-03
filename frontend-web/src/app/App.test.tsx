import { screen } from '@testing-library/react'
import { App } from '@/app/App'
import { serveGuests } from '@/features/guests/fixtures'
import { serveScenarios, fourScenarios } from '@/features/plans/fixtures'
import type { Scenario } from '@/domain/types'
import { renderPage } from '@/test/renderPage'

// The Guests tab loads data, so every test serves an (empty) guest list.
// Scenarios are served before the first render, so a cached lazy route cannot fetch too early.
function renderAt(path: string, scenarios: Scenario[] = []) {
  serveGuests([])
  serveScenarios(scenarios)
  return renderPage(<App />, path)
}

describe('App shell under /wesele', () => {
  it('renders the Plans tab at the root', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1, name: 'Plany' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plany' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders the Guests tab at /wesele/goscie', async () => {
    renderAt('/goscie')
    expect(await screen.findByRole('heading', { level: 1, name: 'Goście' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Goście' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Plany' })).not.toHaveAttribute('aria-current')
  })

  it('keeps the Plans tab active while a plan detail is open', async () => {
    renderAt('/plany/10')
    expect(
      await screen.findByRole('heading', { level: 1, name: /Plan na 10 miejsc/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plany' })).toHaveAttribute('aria-current', 'page')
  })

  it.each(['/nie-ma-takiej-strony', '/plany/7', '/plany/abc', '/druk/13'])(
    'redirects unknown route %s to Plans',
    (path) => {
      renderAt(path)
      expect(screen.getByRole('heading', { level: 1, name: 'Plany' })).toBeInTheDocument()
    },
  )

  it('sends the retired 8-seat plan to the 9-seat plan instead of failing', async () => {
    renderAt('/plany/8')
    expect(
      await screen.findByRole('heading', { level: 1, name: /Plan na 9 miejsc/ }),
    ).toBeInTheDocument()
  })

  it('sends the retired 8-seat print link to the 9-seat print view', async () => {
    renderAt('/druk/8', fourScenarios())
    expect(
      await screen.findByRole('heading', { level: 1, name: /Plan stołów, 9 miejsc/ }),
    ).toBeInTheDocument()
  })

  it('renders the print view without the app chrome', async () => {
    renderAt('/druk/12', fourScenarios())
    expect(
      await screen.findByRole('heading', { level: 1, name: /Plan stołów, 12 miejsc/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('links the brand back to Plans', async () => {
    renderAt('/goscie')
    await screen.findByRole('heading', { level: 1, name: 'Goście' })
    expect(screen.getByRole('link', { name: /Stoliki/ })).toHaveAttribute('href', '/wesele')
  })
})
