import { delay, http, HttpResponse, type HttpHandler } from 'msw'
import { setupServer } from 'msw/node'
import type { components } from '@/api/schema'
import { API_BASE } from '@/lib/basePath'

// MSW answers the real fetch layer with contract-shaped payloads (003-frontend-design §6).
export const server = setupServer()

export type ErrorResponse = components['schemas']['ErrorResponse']
const META = { requestId: '01JB8Z6Q0K3N' }

/** Absolute URL of an API path, the way the client builds it (jsdom needs an absolute base). */
export function apiUrl(path: string): string {
  return new URL(`${API_BASE}${path}`, globalThis.location.origin).href
}

export const single = <T>(data: T) => ({ data, meta: META })
export const list = <T>(data: T[]) => ({ data, meta: META, page: { total: data.length } })
export const failure = (
  code: ErrorResponse['errors'][number]['code'],
  field: string | null = null,
) =>
  ({
    errors: [{ code, field, message: `English message for ${code}` }],
    meta: META,
  }) satisfies ErrorResponse

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

/** Registers a handler and records each request (method, path, JSON body) for assertions. */
export function mockApi(
  method: Method,
  path: string,
  respond: (body: unknown) => Response | Promise<Response>,
): { calls: unknown[] } {
  const calls: unknown[] = []
  const handler: HttpHandler = http[method](apiUrl(path), async ({ request }) => {
    const text = await request.text()
    const body: unknown = text ? JSON.parse(text) : undefined
    calls.push(body ?? null)
    return respond(body)
  })
  server.use(handler)
  return { calls }
}

export { delay, HttpResponse }

/** A gate to hold a response until the test releases it (to observe optimistic state). */
export function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}
