import { errorMessage } from '@/api/errorMessage'
import { ApiError, networkError } from '@/api/errors'

describe('errorMessage', () => {
  it('maps the first error code to Polish copy', () => {
    const error = new ApiError(422, [{ code: 'duplicate_name', field: 'firstName', message: 'x' }])
    expect(errorMessage(error)).toBe('Gość o takim imieniu i nazwisku już jest na liście.')
  })

  it('says the server is unreachable for a failed fetch (status 0)', () => {
    expect(errorMessage(networkError())).toMatch(/Brak połączenia/)
  })

  it('has a generic fallback for anything else', () => {
    expect(errorMessage(new Error('boom'))).toMatch(/Coś poszło nie tak/)
  })
})
