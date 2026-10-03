import { http } from 'msw'
import type { Guest } from '@/domain/types'
import {
  MACIEK_FAMILY_OVERVIEW,
  makeCluster,
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

type Family = { key: number; name: string; size: number; links?: number[] }

/**
 * Families for the missing-links report (task 015): ids are `key * 100 + n`, the first member
 * carries the family name. Anna (5) and Bartek (4) know each other (group of 9), Cezary (6) and
 * Dorota (6) too (12), Ewa (2) and Filip (1) know nobody.
 */
export const REPORT_FAMILIES: Family[] = [
  { key: 10, name: 'Anna Kowal', size: 5, links: [20] },
  { key: 20, name: 'Bartek Lis', size: 4, links: [10] },
  { key: 30, name: 'Cezary Nowak', size: 6, links: [40] },
  { key: 40, name: 'Dorota Maj', size: 6, links: [30] },
  { key: 50, name: 'Ewa Solo', size: 2 },
  { key: 60, name: 'Filip Sam', size: 1 },
]

export function reportGuests(families: Family[] = REPORT_FAMILIES): Guest[] {
  return families.flatMap(({ key, name, size }) =>
    Array.from({ length: size }, (_, i) => {
      const [first, ...rest] = name.split(' ')
      return makeGuest({
        id: key * 100 + i,
        firstName: i === 0 ? first! : `${first}${i}`,
        lastName: rest.join(' ') || null,
      })
    }),
  )
}

export function reportOverview(families: Family[] = REPORT_FAMILIES): ClusterOverview {
  return makeOverview(
    families.map(({ key, size, links = [] }) =>
      makeCluster({
        key,
        guestIds: Array.from({ length: size }, (_, i) => key * 100 + i),
        affinities: links.map((clusterKey) => ({ clusterKey, level: 1 as const })),
      }),
    ),
  )
}

export { MACIEK_FAMILY_OVERVIEW, mockApi }
