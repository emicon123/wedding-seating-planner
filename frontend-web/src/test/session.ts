import type { Session } from '@/domain/types'
import { failure, HttpResponse, mockApi, single } from '@/test/server'

/** An obviously fake PIN: the real one never appears in code, tests or fixtures. */
export const FAKE_PIN = '0000-test'

/** GET /session as an open app. `pinRequired: false` is the gate switched off. */
export function serveOpenSession(pinRequired = false) {
  const session: Session = {
    pinRequired,
    expiresAt: pinRequired ? '2026-11-02T10:00:00Z' : null,
  }
  return mockApi('get', '/session', () => HttpResponse.json(single(session)))
}

/** GET /session answering 401: the PIN screen shows. */
export function serveSessionLocked() {
  return mockApi('get', '/session', () =>
    HttpResponse.json(failure('unauthenticated'), { status: 401 }),
  )
}
