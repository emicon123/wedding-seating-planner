import {
  NO_FILTERS,
  filterGuests,
  filtersToParams,
  hasActiveFilters,
  parseFilters,
} from '@/domain/guestFilters'
import { buildGuestIndex } from '@/domain/guestIndex'
import { KAROLINA, MACIEK, MICHAL, OLA, link, makeGuest } from '@/test/builders'

const ZOSIA = makeGuest({ id: 8, firstName: 'Zosia', isChild: true })
const STAS = makeGuest({ id: 9, firstName: 'Staś', isChild: true, enabled: false })
const EWA = makeGuest({ id: 10, firstName: 'Ewa', enabled: false, links: [link(8, 2)] })
const GUESTS = [MACIEK, KAROLINA, MICHAL, OLA, ZOSIA, STAS, EWA]
const index = buildGuestIndex(GUESTS)

const names = (filters: Partial<typeof NO_FILTERS>) =>
  filterGuests(GUESTS, index, { ...NO_FILTERS, ...filters }).map((guest) => guest.firstName)

describe('filterGuests', () => {
  it('returns everyone without filters', () => {
    expect(names({})).toHaveLength(GUESTS.length)
  })

  it('children only', () => {
    expect(names({ childrenOnly: true })).toEqual(['Zosia', 'Staś'])
  })

  it('disabled and enabled', () => {
    expect(names({ status: 'off' })).toEqual(['Staś', 'Ewa'])
    expect(names({ status: 'on' })).not.toContain('Ewa')
  })

  it('searches ignoring case and diacritics', () => {
    expect(names({ query: 'MICHAL' })).toEqual(['Michał'])
  })

  it('by group: guests with a link of that level, or no links at all', () => {
    expect(names({ group: 0 })).toEqual(['Maciek', 'Karolina', 'Michał', 'Ola'])
    expect(names({ group: 2 })).toEqual(['Ewa'])
    expect(names({ group: 'none' })).toEqual(['Zosia', 'Staś'])
  })

  it('combines filters', () => {
    expect(names({ childrenOnly: true, status: 'off' })).toEqual(['Staś'])
  })
})

describe('filterGuests: related to a person', () => {
  const related = [
    { guestId: 6, level: null },
    { guestId: 7, level: 0 },
    { guestId: 4, level: 1 },
    { guestId: 5, level: 1 },
  ] as const

  it('shows only that person and their relations, in relation order', () => {
    const filters = { ...NO_FILTERS, related: 6 }
    expect(filterGuests(GUESTS, index, filters, [...related]).map((g) => g.firstName)).toEqual([
      'Michał',
      'Ola',
      'Maciek',
      'Karolina',
    ])
  })

  it('still applies the other filters', () => {
    const filters = { ...NO_FILTERS, related: 6, query: 'ka' }
    expect(filterGuests(GUESTS, index, filters, [...related]).map((g) => g.firstName)).toEqual([
      'Karolina',
    ])
  })

  it('ignores the relations when the filter is off', () => {
    expect(filterGuests(GUESTS, index, NO_FILTERS, [...related])).toHaveLength(GUESTS.length)
  })
})

describe('filters <-> URL', () => {
  it('parses the query string', () => {
    const params = new URLSearchParams('q=ola&status=off&dzieci=1&grupa=1')
    expect(parseFilters(params)).toEqual({
      query: 'ola',
      status: 'off',
      childrenOnly: true,
      group: 1,
      related: null,
    })
  })

  it('reads the person the list is narrowed to', () => {
    expect(parseFilters(new URLSearchParams('powiazani=4')).related).toBe(4)
    expect(parseFilters(new URLSearchParams('powiazani=abc')).related).toBeNull()
    expect(filtersToParams({ ...NO_FILTERS, related: 4 }).toString()).toBe('powiazani=4')
  })

  it('falls back to defaults for garbage values', () => {
    expect(parseFilters(new URLSearchParams('status=x&grupa=7&dzieci=tak'))).toEqual(NO_FILTERS)
  })

  it('omits default values when writing', () => {
    expect(filtersToParams(NO_FILTERS).toString()).toBe('')
    expect(filtersToParams({ ...NO_FILTERS, childrenOnly: true, group: 'none' }).toString()).toBe(
      'dzieci=1&grupa=brak',
    )
  })

  it('round-trips', () => {
    const filters = {
      query: 'ka',
      status: 'on',
      childrenOnly: false,
      group: 0,
      related: 4,
    } as const
    expect(parseFilters(filtersToParams(filters))).toEqual(filters)
  })
})

describe('hasActiveFilters', () => {
  it('is false for the defaults and true for any deviation', () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...NO_FILTERS, query: 'a' })).toBe(true)
    expect(hasActiveFilters({ ...NO_FILTERS, group: 0 })).toBe(true)
    expect(hasActiveFilters({ ...NO_FILTERS, related: 4 })).toBe(true)
  })
})
