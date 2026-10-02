import type { ErrorCode, ErrorItem } from '@/domain/types'

/** Thrown by every API hook on a non-2xx response (or a failed fetch, status 0). */
export class ApiError extends Error {
  readonly status: number
  readonly errors: ErrorItem[]
  readonly requestId: string | undefined

  constructor(status: number, errors: ErrorItem[], requestId?: string) {
    super(errors.map((item) => item.message).join('; '))
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
    this.requestId = requestId
  }

  has(code: ErrorCode): boolean {
    return this.errors.some((item) => item.code === code)
  }
}

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'bad_request',
  404: 'not_found',
  409: 'version_conflict',
  413: 'payload_too_large',
  422: 'validation_failed',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isErrorItem(value: unknown): value is ErrorItem {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string'
}

/** Builds an ApiError from the contract's ErrorResponse envelope, or from the bare status. */
export function toApiError(status: number, body: unknown): ApiError {
  if (
    isRecord(body) &&
    Array.isArray(body.errors) &&
    body.errors.length > 0 &&
    body.errors.every(isErrorItem)
  ) {
    const requestId =
      isRecord(body.meta) && typeof body.meta.requestId === 'string'
        ? body.meta.requestId
        : undefined
    return new ApiError(status, body.errors, requestId)
  }
  const code = CODE_BY_STATUS[status] ?? 'internal_error'
  return new ApiError(status, [{ code, field: null, message: `HTTP ${status}` }])
}

export function networkError(): ApiError {
  return new ApiError(0, [{ code: 'internal_error', field: null, message: 'Network error' }])
}
