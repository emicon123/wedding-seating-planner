import type { ErrorCode, ErrorItem } from '@/domain/types'

/** Thrown by every API hook on a non-2xx response (or a failed fetch, status 0). */
export class ApiError extends Error {
  readonly status: number
  readonly errors: ErrorItem[]
  readonly requestId: string | undefined
  /** Seconds from the `Retry-After` header of a 429; undefined when absent or not a number. */
  readonly retryAfterSeconds: number | undefined

  constructor(status: number, errors: ErrorItem[], requestId?: string, retryAfterSeconds?: number) {
    super(errors.map((item) => item.message).join('; '))
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
    this.requestId = requestId
    this.retryAfterSeconds = retryAfterSeconds
  }

  has(code: ErrorCode): boolean {
    return this.errors.some((item) => item.code === code)
  }
}

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'bad_request',
  401: 'unauthenticated',
  404: 'not_found',
  409: 'version_conflict',
  413: 'payload_too_large',
  422: 'validation_failed',
  429: 'too_many_attempts',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isErrorItem(value: unknown): value is ErrorItem {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string'
}

/** Builds an ApiError from the contract's ErrorResponse envelope, or from the bare status. */
export function toApiError(status: number, body: unknown, retryAfterSeconds?: number): ApiError {
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
    return new ApiError(status, body.errors, requestId, retryAfterSeconds)
  }
  const code = CODE_BY_STATUS[status] ?? 'internal_error'
  return new ApiError(
    status,
    [{ code, field: null, message: `HTTP ${status}` }],
    undefined,
    retryAfterSeconds,
  )
}

export function networkError(): ApiError {
  return new ApiError(0, [{ code: 'internal_error', field: null, message: 'Network error' }])
}

/** A protected call without a valid session. The login's own 401 is `invalid_pin`, so it never matches. */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.has('unauthenticated')
}

/** `Retry-After` as whole seconds (the contract sends delta-seconds); anything else is ignored. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || !/^\d+$/.test(header.trim())) return undefined
  return Number(header)
}
