import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { App } from '@/app/App'
import { keys } from '@/api/keys'
import { serveGuests } from '@/features/guests/fixtures'
import { fourScenarios, serveScenarios } from '@/features/plans/fixtures'
import { renderPage } from '@/test/renderPage'
import { apiUrl, failure, HttpResponse, mockApi, server, single } from '@/test/server'
import { FAKE_PIN, serveOpenSession, serveSessionLocked } from '@/test/session'
import { MACIEK } from '@/test/builders'

const SESSION_OPEN = { pinRequired: true, expiresAt: '2026-11-02T10:00:00Z' }

/** Counts GET /guests so a test can prove no data was requested behind the PIN screen. */
function watchGuests(respond: () => Response) {
  const state = { calls: 0 }
  server.use(
    http.get(apiUrl('/guests'), () => {
      state.calls += 1
      return respond()
    }),
  )
  return state
}

const guestsOk = () =>
  HttpResponse.json({ data: [MACIEK], meta: { requestId: 'r' }, page: { total: 1 } })

const pinField = () => screen.getByLabelText('PIN')
const enterButton = () => screen.getByRole('button', { name: /Wejdź|Sprawdzam/ })

describe('AccessGate', () => {
  beforeEach(() => {
    serveGuests([])
    serveScenarios([])
  })

  it('lets the app in without a PIN screen or logout when the gate is off', async () => {
    const session = serveOpenSession(false)
    renderPage(<App />, '/goscie')

    expect(await screen.findByRole('heading', { level: 1, name: 'Goście' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Wyloguj' })).not.toBeInTheDocument()
    expect(session.calls).toHaveLength(1)
  })

  it('shows "Wyloguj" only when the gate is on', async () => {
    serveOpenSession(true)
    renderPage(<App />, '/goscie')

    expect(await screen.findByRole('button', { name: 'Wyloguj' })).toBeInTheDocument()
  })

  it('shows the PIN screen on a 401, keeps the URL and requests no data', async () => {
    serveSessionLocked()
    const guests = watchGuests(guestsOk)
    renderPage(<App />, '/goscie?filtr=x')

    expect(await screen.findByRole('heading', { name: 'Podaj PIN' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.getByTestId('search')).toHaveTextContent('?filtr=x')
    expect(pinField()).toHaveAttribute('inputmode', 'numeric')
    expect(pinField()).not.toHaveAttribute('maxlength')
    expect(guests.calls).toBe(0)
  })

  it('gates the print view too', async () => {
    serveSessionLocked()
    serveScenarios(fourScenarios())
    renderPage(<App />, '/druk/10')

    expect(await screen.findByRole('heading', { name: 'Podaj PIN' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Plan stołów/ })).not.toBeInTheDocument()
  })

  it('offers a retry when the session cannot be checked', async () => {
    mockApi('get', '/session', () => HttpResponse.json(failure('internal_error'), { status: 500 }))
    const { user } = renderPage(<App />, '/')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Coś poszło nie tak po stronie serwera',
    )
    serveOpenSession(true)
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Plany' })).toBeInTheDocument()
  })

  it('logs in with the PIN (header sent), then renders the same route and loads its data', async () => {
    serveSessionLocked()
    const guests = watchGuests(guestsOk)
    let csrf: string | null = null
    const login = mockApi('post', '/session', () => HttpResponse.json(single(SESSION_OPEN)))
    server.use(
      http.post(apiUrl('/session'), ({ request }) => {
        csrf = request.headers.get('X-Stoliki-Request')
        return HttpResponse.json(single(SESSION_OPEN))
      }),
    )
    const { user } = renderPage(<App />, '/goscie')

    await screen.findByRole('heading', { name: 'Podaj PIN' })
    expect(enterButton()).toBeDisabled()
    await user.type(pinField(), `${FAKE_PIN}{Enter}`)

    expect(await screen.findByRole('heading', { level: 1, name: 'Goście' })).toBeInTheDocument()
    expect(await screen.findByText('Maciek')).toBeInTheDocument()
    expect(csrf).toBe('1')
    expect(login.calls).toHaveLength(0) // the later handler took the request
    expect(guests.calls).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Wyloguj' })).toBeInTheDocument()
  })

  it('sends the typed PIN as it is, whatever its length or characters', async () => {
    serveSessionLocked()
    const login = mockApi('post', '/session', () => HttpResponse.json(single(SESSION_OPEN)))
    const { user } = renderPage(<App />, '/')

    await screen.findByRole('heading', { name: 'Podaj PIN' })
    await user.type(pinField(), 'a b-12345678')
    await user.click(enterButton())

    await waitFor(() => expect(login.calls).toEqual([{ pin: 'a b-12345678' }]))
  })

  it('says "Zły PIN", clears the field and keeps the focus in it', async () => {
    serveSessionLocked()
    mockApi('post', '/session', () => HttpResponse.json(failure('invalid_pin'), { status: 401 }))
    const { user } = renderPage(<App />, '/')

    await screen.findByRole('heading', { name: 'Podaj PIN' })
    await user.type(pinField(), FAKE_PIN)
    await user.click(enterButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Zły PIN')
    expect(pinField()).toHaveValue('')
    expect(pinField()).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Podaj PIN' })).toBeInTheDocument()
  })

  it('stores the PIN nowhere', async () => {
    serveSessionLocked()
    mockApi('post', '/session', () => HttpResponse.json(single(SESSION_OPEN)))
    const { user, queryClient } = renderPage(<App />, '/')

    await screen.findByRole('heading', { name: 'Podaj PIN' })
    await user.type(pinField(), FAKE_PIN)
    await user.click(enterButton())
    await screen.findByRole('button', { name: 'Wyloguj' })

    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(FAKE_PIN)
    expect(JSON.stringify({ ...localStorage })).not.toContain(FAKE_PIN)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(FAKE_PIN)
  })

  describe('throttled (429 + Retry-After)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows the message, disables the button and counts down to 0', async () => {
      serveSessionLocked()
      mockApi('post', '/session', () =>
        HttpResponse.json(failure('too_many_attempts'), {
          status: 429,
          headers: { 'Retry-After': '30' },
        }),
      )
      renderPage(<App />, '/')

      await screen.findByRole('heading', { name: 'Podaj PIN' })
      fireEvent.change(pinField(), { target: { value: FAKE_PIN } })
      fireEvent.click(enterButton())

      expect(await screen.findByText('Za dużo prób — spróbuj za chwilę')).toBeInTheDocument()
      expect(screen.getByText('Spróbuj ponownie za 30 s')).toBeInTheDocument()
      fireEvent.change(pinField(), { target: { value: 'x' } })
      expect(enterButton()).toBeDisabled()

      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      expect(screen.getByText('Spróbuj ponownie za 20 s')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(20_000)
      })
      expect(screen.queryByText(/Spróbuj ponownie za/)).not.toBeInTheDocument()
      expect(screen.queryByText('Za dużo prób — spróbuj za chwilę')).not.toBeInTheDocument()
      expect(enterButton()).toBeEnabled()
    })

    it('shows minutes for a long wait', async () => {
      serveSessionLocked()
      mockApi('post', '/session', () =>
        HttpResponse.json(failure('too_many_attempts'), {
          status: 429,
          headers: { 'Retry-After': '300' },
        }),
      )
      renderPage(<App />, '/')

      await screen.findByRole('heading', { name: 'Podaj PIN' })
      fireEvent.change(pinField(), { target: { value: FAKE_PIN } })
      fireEvent.click(enterButton())

      expect(await screen.findByText('Spróbuj ponownie za 5 min')).toBeInTheDocument()
    })
  })

  describe('a 401 in the middle of use', () => {
    it('puts the PIN screen back, drops cached data and keeps the URL', async () => {
      serveOpenSession(true)
      const guests = watchGuests(() =>
        HttpResponse.json(failure('unauthenticated'), { status: 401 }),
      )
      const { queryClient } = renderPage(<App />, '/goscie?filtr=x')

      expect(await screen.findByRole('heading', { name: 'Podaj PIN' })).toBeInTheDocument()
      expect(screen.getByTestId('search')).toHaveTextContent('?filtr=x')
      expect(guests.calls).toBe(1) // a 401 is not retried, and the unmounted page does not re-ask
      await waitFor(() => {
        const keysLeft = queryClient
          .getQueryCache()
          .getAll()
          .map((query) => query.queryKey[0])
        expect(keysLeft).toEqual([keys.session[0]])
      })
      expect(queryClient.getQueryData(keys.guests)).toBeUndefined()
    })

    it('after the PIN the same route refetches', async () => {
      serveOpenSession(true)
      let expired = true
      const guests = watchGuests(() =>
        expired ? HttpResponse.json(failure('unauthenticated'), { status: 401 }) : guestsOk(),
      )
      mockApi('post', '/session', () => {
        expired = false
        return HttpResponse.json(single(SESSION_OPEN))
      })
      const { user } = renderPage(<App />, '/goscie')

      await screen.findByRole('heading', { name: 'Podaj PIN' })
      await user.type(pinField(), `${FAKE_PIN}{Enter}`)

      expect(await screen.findByText('Maciek')).toBeInTheDocument()
      expect(guests.calls).toBeGreaterThan(1)
    })
  })

  describe('"Wyloguj"', () => {
    it('sends DELETE with the header, empties the cache and shows the PIN screen', async () => {
      serveOpenSession(true)
      watchGuests(guestsOk)
      let csrf: string | null = null
      server.use(
        http.delete(apiUrl('/session'), ({ request }) => {
          csrf = request.headers.get('X-Stoliki-Request')
          return new HttpResponse(null, { status: 204 })
        }),
      )
      const { user, queryClient } = renderPage(<App />, '/goscie')
      await screen.findByText('Maciek')

      await user.click(screen.getByRole('button', { name: 'Wyloguj' }))

      expect(await screen.findByRole('heading', { name: 'Podaj PIN' })).toBeInTheDocument()
      expect(csrf).toBe('1')
      await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(1))
      expect(queryClient.getQueryData(keys.guests)).toBeUndefined()
    })
  })
})
