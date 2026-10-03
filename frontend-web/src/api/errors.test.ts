import { ApiError, isUnauthenticated, parseRetryAfter, toApiError } from '@/api/errors'

describe('toApiError', () => {
  it('keeps the envelope of a contract error response', () => {
    const error = toApiError(422, {
      errors: [{ code: 'duplicate_name', field: 'firstName', message: 'dup' }],
      meta: { requestId: 'abc' },
    })
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
    expect(error.errors).toEqual([{ code: 'duplicate_name', field: 'firstName', message: 'dup' }])
    expect(error.requestId).toBe('abc')
    expect(error.message).toBe('dup')
    expect(error.has('duplicate_name')).toBe(true)
    expect(error.has('not_found')).toBe(false)
  })

  it.each([
    [400, 'bad_request'],
    [401, 'unauthenticated'],
    [404, 'not_found'],
    [409, 'version_conflict'],
    [413, 'payload_too_large'],
    [422, 'validation_failed'],
    [429, 'too_many_attempts'],
    [500, 'internal_error'],
    [503, 'internal_error'],
  ])('falls back to a code for a bare HTTP %i', (status, code) => {
    const error = toApiError(status, 'Bad gateway')
    expect(error.errors).toEqual([{ code, field: null, message: `HTTP ${status}` }])
    expect(error.requestId).toBeUndefined()
  })

  it.each([undefined, null, {}, { errors: [] }, { errors: [{ code: 1 }] }])(
    'ignores a malformed body %j',
    (body) => {
      expect(toApiError(500, body).errors[0]?.code).toBe('internal_error')
    },
  )
})

describe('isUnauthenticated', () => {
  const body = (code: string) => ({
    errors: [{ code, field: null, message: 'x' }],
    meta: { requestId: 'r' },
  })

  it('matches a 401 with the unauthenticated code only', () => {
    expect(isUnauthenticated(toApiError(401, body('unauthenticated')))).toBe(true)
    expect(isUnauthenticated(toApiError(401, undefined))).toBe(true)
  })

  it('does not match the login failure, other statuses or foreign errors', () => {
    expect(isUnauthenticated(toApiError(401, body('invalid_pin')))).toBe(false)
    expect(isUnauthenticated(toApiError(403, body('csrf_header_missing')))).toBe(false)
    expect(isUnauthenticated(new Error('401'))).toBe(false)
    expect(isUnauthenticated(null)).toBe(false)
  })
})

describe('parseRetryAfter', () => {
  it.each([
    ['30', 30],
    [' 7 ', 7],
    ['0', 0],
  ])('reads delta-seconds %j', (header, seconds) => {
    expect(parseRetryAfter(header)).toBe(seconds)
  })

  it.each([null, '', 'soon', '-5', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT'])(
    'ignores %j',
    (header) => {
      expect(parseRetryAfter(header)).toBeUndefined()
    },
  )
})
