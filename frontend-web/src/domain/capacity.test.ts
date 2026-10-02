import { CAPACITIES, parseCapacity } from '@/domain/capacity'

describe('parseCapacity', () => {
  it.each([
    ['8', 8],
    ['10', 10],
    ['12', 12],
  ])('accepts %s', (raw, expected) => {
    expect(parseCapacity(raw)).toBe(expected)
  })

  it.each([undefined, '', '9', '08', '10.0', 'abc'])('rejects %s', (raw) => {
    expect(parseCapacity(raw)).toBeNull()
  })

  it('lists the three plans in order', () => {
    expect(CAPACITIES).toEqual([8, 10, 12])
  })
})
