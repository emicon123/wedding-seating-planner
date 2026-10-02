import { hasGuestNamed, parseGuestName } from '@/domain/guestName'
import { KAROLINA, MACIEK } from '@/test/builders'

describe('parseGuestName', () => {
  it.each([
    ['Karolina Nowak', { firstName: 'Karolina', lastName: 'Nowak' }],
    ['Zosia', { firstName: 'Zosia', lastName: null }],
    ['  Anna   Maria  Kowalska ', { firstName: 'Anna', lastName: 'Maria Kowalska' }],
  ])('parses %j', (input, expected) => {
    expect(parseGuestName(input)).toEqual(expected)
  })

  it.each(['', '   '])('returns null for blank input %j', (input) => {
    expect(parseGuestName(input)).toBeNull()
  })
})

describe('hasGuestNamed', () => {
  const guests = [MACIEK, KAROLINA]

  it('matches a display name ignoring case and extra whitespace', () => {
    expect(hasGuestNamed(guests, '  karolina   NOWAK ')).toBe(true)
  })

  it('does not match a partial name', () => {
    expect(hasGuestNamed(guests, 'Karolina')).toBe(false)
  })

  it('keeps diacritics significant, like the server does', () => {
    expect(hasGuestNamed([{ ...MACIEK, displayName: 'Michał' }], 'Michal')).toBe(false)
  })
})
