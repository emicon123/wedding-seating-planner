import type { QueryClient } from '@tanstack/react-query'

// One key per resource (003-frontend-design §2). Hooks and invalidation rules are the only
// consumers, so a key is spelled in exactly one place.
export const keys = {
  session: ['session'],
  guests: ['guests'],
  clusters: ['clusters'],
  scenarios: ['scenarios'],
  generateUndo: ['generateUndo'],
} as const

/**
 * Changing a guest or a link changes who counts, the derived clusters and every plan's
 * evaluation. Not awaited on purpose: a mutation settles as soon as the server accepted it.
 */
export function invalidateGuestData(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: keys.guests })
  void queryClient.invalidateQueries({ queryKey: keys.clusters })
  void queryClient.invalidateQueries({ queryKey: keys.scenarios })
}
