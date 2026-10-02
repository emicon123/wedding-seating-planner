import { ApiError } from '@/api/errors'
import { errorLabel } from '@/domain/labels'

/** The Polish sentence for any failure of an API hook, ready for a toast or an inline alert. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Coś poszło nie tak. Spróbuj ponownie.'
  if (error.status === 0) return 'Brak połączenia z serwerem. Sprawdź sieć i spróbuj ponownie.'
  const [first] = error.errors
  return first ? errorLabel(first) : 'Coś poszło nie tak. Spróbuj ponownie.'
}
