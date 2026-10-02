import { ApiError, toApiError } from '@/api/errors'

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
    [404, 'not_found'],
    [409, 'version_conflict'],
    [413, 'payload_too_large'],
    [422, 'validation_failed'],
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
