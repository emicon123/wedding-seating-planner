import createClient from 'openapi-fetch'
import type { paths } from '@/api/schema'
import { networkError, toApiError } from '@/api/errors'
import { API_BASE } from '@/lib/basePath'

export { API_BASE }

// The one typed access point to the backend. `fetch` needs an absolute URL outside a browser
// (jsdom tests), so the same-origin path `/wesele/api` is resolved against the page origin.
// `fetch` is looked up per call, not captured at import, so tests can install MSW afterwards.
export const client = createClient<paths>({
  baseUrl: new URL(API_BASE, globalThis.location.origin).href,
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
  if (!outcome.response.ok) throw toApiError(outcome.response.status, outcome.error)
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
