import { CAPACITIES, isRetiredCapacity, parseCapacity } from '@/domain/capacity'

describe('parseCapacity', () => {
  it.each([
    ['9', 9],
    ['10', 10],
    ['11', 11],
    ['12', 12],
  ])('accepts %s', (raw, expected) => {
    expect(parseCapacity(raw)).toBe(expected)
  })

  it.each([undefined, '', '8', '13', '08', '10.0', 'abc'])('rejects %s', (raw) => {
    expect(parseCapacity(raw)).toBeNull()
  })

  it('lists the four plans in order', () => {
    expect(CAPACITIES).toEqual([9, 10, 11, 12])
  })

  it('recognises the retired 8-seat plan, and nothing else', () => {
    expect(isRetiredCapacity('8')).toBe(true)
    expect(isRetiredCapacity('9')).toBe(false)
    expect(isRetiredCapacity(undefined)).toBe(false)
  })
})
