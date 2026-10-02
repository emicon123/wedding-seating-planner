import { applyEnabled, guestCounts, insertGuest, linkKey } from '@/domain/guestList'
import { KAROLINA, MACIEK, MICHAL, makeGuest } from '@/test/builders'

describe('guestCounts', () => {
  it('counts all, enabled and children', () => {
    const guests = [
      MACIEK,
      makeGuest({ id: 8, firstName: 'Zosia', isChild: true }),
      makeGuest({ id: 9, firstName: 'Staś', isChild: true, enabled: false }),
    ]
    expect(guestCounts(guests)).toEqual({ total: 3, enabled: 2, children: 2 })
  })
})

describe('applyEnabled', () => {
  it('switches only the listed guests and keeps the others untouched', () => {
    const result = applyEnabled([MACIEK, KAROLINA, MICHAL], [5], false)
    expect(result.map((guest) => guest.enabled)).toEqual([true, false, true])
    expect(result[0]).toBe(MACIEK)
  })
})

describe('insertGuest', () => {
  it('keeps the list ordered by display name, Polish collation', () => {
    const lukasz = makeGuest({ id: 10, firstName: 'Łukasz' })
    const zosia = makeGuest({ id: 11, firstName: 'Zosia' })
    const result = insertGuest([MACIEK, zosia], lukasz)
    expect(result.map((guest) => guest.displayName)).toEqual(['Łukasz', 'Maciek', 'Zosia'])
  })

  it('replaces a guest that is already there', () => {
    const renamed = { ...MACIEK, notes: 'wegetarianin' }
    expect(insertGuest([MACIEK, KAROLINA], renamed)).toHaveLength(2)
  })
})

describe('linkKey', () => {
  it('is the normalised {smaller}-{larger} pair', () => {
    expect(linkKey(6, 4)).toBe('4-6')
    expect(linkKey(4, 6)).toBe('4-6')
  })
})
