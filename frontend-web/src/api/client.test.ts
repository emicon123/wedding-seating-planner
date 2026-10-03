import { ApiError } from '@/api/errors'
import { client, unwrap, unwrapEmpty } from '@/api/client'
import { apiUrl, failure, HttpResponse, mockApi, server, single } from '@/test/server'
import { http } from 'msw'
import { MACIEK } from '@/test/builders'

async function guestsRequest() {
  return unwrap(client.GET('/guests'))
}

describe('API client', () => {
  it('talks to /wesele/api and returns the body of a 2xx response', async () => {
    mockApi('get', '/guests', () =>
      HttpResponse.json({ data: [MACIEK], meta: { requestId: 'r' }, page: { total: 1 } }),
    )

    const body = await guestsRequest()

    expect(body.data).toEqual([MACIEK])
  })

  it('treats 204 as success with no body', async () => {
    mockApi('delete', '/guests/4', () => new HttpResponse(null, { status: 204 }))

    await expect(
      unwrapEmpty(client.DELETE('/guests/{guestId}', { params: { path: { guestId: 4 } } })),
    ).resolves.toBeUndefined()
  })

  describe.each([
    [400, 'bad_request'],
    [404, 'not_found'],
    [409, 'version_conflict'],
    [422, 'duplicate_name'],
    [500, 'internal_error'],
  ] as const)('a %i response', (status, code) => {
    it(`becomes an ApiError carrying errors[] (${code})`, async () => {
      mockApi('get', '/guests', () => HttpResponse.json(failure(code, 'firstName'), { status }))

      const error = await guestsRequest().catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({
        status,
        errors: [{ code, field: 'firstName', message: `English message for ${code}` }],
        requestId: '01JB8Z6Q0K3N',
      })
    })
  })

  it('also wraps non-2xx on commands (empty 204 route failing with 404)', async () => {
    mockApi('delete', '/guests/4', () =>
      HttpResponse.json(failure('not_found', 'guestId'), { status: 404 }),
    )

    const error = await unwrapEmpty(
      client.DELETE('/guests/{guestId}', { params: { path: { guestId: 4 } } }),
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).has('not_found')).toBe(true)
  })

  it('synthesises errors[] when the body is not the error envelope (e.g. a proxy page)', async () => {
    mockApi('get', '/guests', () => new HttpResponse('<html>Bad gateway</html>', { status: 502 }))

    const error = await guestsRequest().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 502, errors: [{ code: 'internal_error', field: null }] })
  })

  it('maps a failed fetch (network down) to an ApiError with status 0', async () => {
    mockApi('get', '/guests', () => HttpResponse.error())

    const error = await guestsRequest().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, errors: [{ code: 'internal_error' }] })
  })

  it('does not accept a 2xx without a body where one is expected', async () => {
    mockApi('get', '/guests', () => new HttpResponse(null, { status: 200 }))

    await expect(guestsRequest()).rejects.toBeInstanceOf(ApiError)
  })

  it('keeps single() envelopes honest (sanity of the test helper)', () => {
    expect(single(1)).toEqual({ data: 1, meta: { requestId: '01JB8Z6Q0K3N' } })
  })

  it('sends the CSRF header on every request, reads and writes alike', async () => {
    const seen: (string | null)[] = []
    server.use(
      http.get(apiUrl('/guests'), ({ request }) => {
        seen.push(request.headers.get('X-Stoliki-Request'))
        return HttpResponse.json({ data: [], meta: { requestId: 'r' }, page: { total: 0 } })
      }),
      http.delete(apiUrl('/guests/4'), ({ request }) => {
        seen.push(request.headers.get('X-Stoliki-Request'))
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await guestsRequest()
    await unwrapEmpty(client.DELETE('/guests/{guestId}', { params: { path: { guestId: 4 } } }))

    expect(seen).toEqual(['1', '1'])
  })

  it('carries Retry-After of a 429 on the ApiError', async () => {
    mockApi('get', '/guests', () =>
      HttpResponse.json(failure('too_many_attempts'), {
        status: 429,
        headers: { 'Retry-After': '45' },
      }),
    )

    const error = await guestsRequest().catch((e: unknown) => e)

    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 45 })
  })
})
