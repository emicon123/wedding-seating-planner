import type { GuestIndex } from '@/domain/guestIndex'
import type { RelatedGuest } from '@/domain/relations'
import type { Guest, LinkLevel } from '@/domain/types'

export type StatusFilter = 'all' | 'on' | 'off'
/** `none` = guests without any link. */
export type GroupFilter = 'all' | 'none' | LinkLevel

export type GuestFilters = {
  query: string
  status: StatusFilter
  childrenOnly: boolean
  group: GroupFilter
  /** Show only this person and everyone related to them (guest id), or null. */
  related: number | null
}

export const NO_FILTERS: GuestFilters = {
  query: '',
  status: 'all',
  childrenOnly: false,
  group: 'all',
  related: null,
}

export function hasActiveFilters(filters: GuestFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.status !== 'all' ||
    filters.childrenOnly ||
    filters.group !== 'all' ||
    filters.related !== null
  )
}

const GROUP_PARAM: Record<string, GroupFilter> = { '0': 0, '1': 1, '2': 2, brak: 'none' }

function parseGuestId(raw: string | null): number | null {
  const id = Number(raw)
  return raw !== null && Number.isInteger(id) && id > 0 ? id : null
}

/** The filters live in the URL query string (003-frontend-design §4): a reload keeps them. */
export function parseFilters(params: URLSearchParams): GuestFilters {
  const status = params.get('status')
  return {
    query: params.get('q') ?? '',
    status: status === 'on' || status === 'off' ? status : 'all',
    childrenOnly: params.get('dzieci') === '1',
    group: GROUP_PARAM[params.get('grupa') ?? ''] ?? 'all',
    related: parseGuestId(params.get('powiazani')),
  }
}

export function filtersToParams(filters: GuestFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.query !== '') params.set('q', filters.query)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.childrenOnly) params.set('dzieci', '1')
  if (filters.group !== 'all')
    params.set('grupa', filters.group === 'none' ? 'brak' : `${filters.group}`)
  if (filters.related !== null) params.set('powiazani', `${filters.related}`)
  return params
}

function matchesGroup(guest: Guest, group: GroupFilter): boolean {
  if (group === 'all') return true
  if (group === 'none') return guest.links.length === 0
  return guest.links.some((link) => link.level === group)
}

export function filterGuests(
  guests: Guest[],
  index: GuestIndex,
  filters: GuestFilters,
  /** Who is related to `filters.related`, in display order; only used when that filter is on. */
  related?: RelatedGuest[],
): Guest[] {
  const found = filters.query.trim() === '' ? guests : index.search(filters.query)
  // A search ranks hits; without one the list order (by name) is kept.
  const matching = found.filter(
    (guest) =>
      (filters.status === 'all' || guest.enabled === (filters.status === 'on')) &&
      (!filters.childrenOnly || guest.isChild) &&
      matchesGroup(guest, filters.group),
  )
  if (filters.related === null || related === undefined) return matching

  const byId = new Map(matching.map((guest) => [guest.id, guest]))
  return related.flatMap(({ guestId }) => byId.get(guestId) ?? [])
}
