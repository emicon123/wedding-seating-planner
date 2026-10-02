import { buildGuestIndex } from '@/domain/guestIndex'
import { makeGuest } from '@/test/builders'

const guests = [
  makeGuest({ id: 1, firstName: 'Michał', lastName: 'Kowalski' }),
  makeGuest({ id: 2, firstName: 'Łukasz' }),
  makeGuest({ id: 3, firstName: 'Zażółć', lastName: 'Gęślą' }),
  makeGuest({ id: 4, firstName: 'Karolina', lastName: 'Nowak' }),
  makeGuest({ id: 5, firstName: 'Ania', lastName: 'Karolak' }),
]
const index = buildGuestIndex(guests)
const ids = (query: string) => index.search(query).map((guest) => guest.id)

describe('buildGuestIndex', () => {
  it('looks guests up by id', () => {
    expect(index.byId.get(4)?.displayName).toBe('Karolina Nowak')
    expect(index.byId.get(99)).toBeUndefined()
  })

  describe('search', () => {
    it.each([
      ['michal', [1]],
      ['MICHAŁ', [1]],
      ['lukasz', [2]],
      ['zazolc', [3]],
      ['gesla', [3]],
      ['  nowak ', [4]],
    ])('finds %s regardless of case and diacritics', (query, expected) => {
      expect(ids(query)).toEqual(expected)
    })

    it('matches every word of the query against the display name', () => {
      expect(ids('karolina now')).toEqual([4])
      expect(ids('now karolina')).toEqual([4])
    })

    it('matches inside a word too, ranking word starts first', () => {
      // "karol" starts Karolina and Karolak, "olin" is only inside Karolina
      expect(ids('karol')).toEqual([4, 5])
      expect(ids('olin')).toEqual([4])
    })

    it('returns every guest, in order, for an empty query', () => {
      expect(ids('')).toEqual([1, 2, 3, 4, 5])
      expect(ids('   ')).toEqual([1, 2, 3, 4, 5])
    })

    it('returns nothing when no guest matches', () => {
      expect(ids('xyz')).toEqual([])
    })
  })
})
