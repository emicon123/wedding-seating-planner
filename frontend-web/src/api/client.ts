import createClient from 'openapi-fetch'
import type { paths } from '@/api/schema'
import { networkError, parseRetryAfter, toApiError } from '@/api/errors'
import { API_BASE } from '@/lib/basePath'

export { API_BASE }

// The one typed access point to the backend. `fetch` needs an absolute URL outside a browser
// (jsdom tests), so the same-origin path `/wesele/api` is resolved against the page origin.
// `fetch` is looked up per call, not captured at import, so tests can install MSW afterwards.
// Every request carries the CSRF header the access gate requires on state-changing calls
// (05-access-gate §3); it is harmless when the gate is off.
export const client = createClient<paths>({
  baseUrl: new URL(API_BASE, globalThis.location.origin).href,
  headers: { 'X-Stoliki-Request': '1' },
  fetch: (request) => globalThis.fetch(request),
})

type Outcome<T> = { data?: T; error?: unknown; response: Response }
type EmptyOutcome = { error?: unknown; response: Response }

async function settle<R extends { response: Response; error?: unknown }>(
  request: Promise<R>,
): Promise<R> {
  let outcome: R
  try {
    outcome = await request
  } catch {
    throw networkError()
  }
  const { response } = outcome
  if (!response.ok) {
    throw toApiError(
      response.status,
      outcome.error,
      parseRetryAfter(response.headers.get('Retry-After')),
    )
  }
  return outcome
}

/** Resolves with the body of a 2xx response; any other outcome throws an ApiError. */
export async function unwrap<T>(request: Promise<Outcome<T>>): Promise<T> {
  const { data, response } = await settle(request)
  if (data === undefined) throw toApiError(response.status, undefined)
  return data
}

/** For 204 responses: resolves when the call succeeded, throws an ApiError otherwise. */
export async function unwrapEmpty(request: Promise<EmptyOutcome>): Promise<void> {
  await settle(request)
}
