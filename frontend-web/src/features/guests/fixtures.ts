import { http } from 'msw'
import type { Guest } from '@/domain/types'
import {
  MACIEK_FAMILY_OVERVIEW,
  makeGuest,
  makeOverview,
  MACIEK,
  KAROLINA,
  MICHAL,
  OLA,
} from '@/test/builders'
import { HttpResponse, list, mockApi, single, server, apiUrl } from '@/test/server'
import type { ClusterOverview } from '@/domain/types'

export const ZOSIA = makeGuest({ id: 8, firstName: 'Zosia', isChild: true })
export const STAS = makeGuest({ id: 9, firstName: 'Staś', isChild: true, enabled: false })
export const EWA = makeGuest({ id: 10, firstName: 'Ewa', enabled: false, notes: 'wegetarianka' })
export const SMALL_LIST: Guest[] = [MACIEK, KAROLINA, MICHAL, OLA, ZOSIA, STAS, EWA]

/** 92 guests: 7 children (ids 1-7), 7 disabled (ids 8-14): the counters example from the ticket. */
export function bigList(): Guest[] {
  return Array.from({ length: 92 }, (_, i) =>
    makeGuest({
      id: i + 1,
      firstName: `Gość${String(i + 1).padStart(2, '0')}`,
      isChild: i < 7,
      enabled: !(i >= 7 && i < 14),
    }),
  )
}

/** GET /guests and GET /clusters served from mutable state, so a refetch sees earlier writes. */
export function serveGuests(initial: Guest[], overview: ClusterOverview = makeOverview([])) {
  const state = { guests: [...initial], overview }
  server.use(
    http.get(apiUrl('/guests'), () => HttpResponse.json(list(state.guests))),
    http.get(apiUrl('/clusters'), () => HttpResponse.json(single(state.overview))),
    http.get(apiUrl('/scenarios'), () => HttpResponse.json(list([]))),
  )
  return state
}

/** PATCH /guests that really applies the toggle to the served state (like the server would). */
export function serveToggle(state: { guests: Guest[] }) {
  return mockApi('patch', '/guests', (body) => {
    const { guestIds, enabled } = body as { guestIds: number[]; enabled: boolean }
    state.guests = state.guests.map((g) => (guestIds.includes(g.id) ? { ...g, enabled } : g))
    return HttpResponse.json(list(state.guests.filter((g) => guestIds.includes(g.id))))
  })
}

export { MACIEK_FAMILY_OVERVIEW, mockApi }
