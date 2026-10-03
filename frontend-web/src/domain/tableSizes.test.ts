import {
  seatsTotal,
  sizeAfterDrop,
  tablesNeeded,
  tablesNeededLabel,
  tableSize,
} from '@/domain/tableSizes'
import { fillsPlan } from '@/test/builders'
import type { Scenario } from '@/domain/types'

const mixed = { key: 'mixed', capacity: 12 } as const
const ten = { key: '10', capacity: 10 } as const

describe('tableSize', () => {
  it.each([
    [0, null],
    [1, 9],
    [8, 9],
    [9, 9],
    [10, 10],
    [11, 11],
    [12, 12],
    [13, 12],
  ])('mixed plan: fill %i is size %s', (fill, expected) => {
    expect(tableSize(fill, mixed)).toBe(expected)
  })

  it('uniform plan: the capacity for every non-empty table, nothing for an empty one', () => {
    expect(tableSize(7, ten)).toBe(10)
    expect(tableSize(12, ten)).toBe(10)
    expect(tableSize(0, ten)).toBeNull()
  })
})

describe('tablesNeeded', () => {
  const scenario = (kind: Pick<Scenario, 'key' | 'capacity'>, fills: number[]) => ({
    ...kind,
    plan: fillsPlan(fills),
  })

  it('counts mixed tables per derived size, largest first, empty tables left out', () => {
    expect(tablesNeeded(scenario(mixed, [12, 8, 11, 12, 0]))).toEqual([
      { size: 12, count: 2 },
      { size: 11, count: 1 },
      { size: 9, count: 1 },
    ])
  })

  it('counts a uniform plan under its capacity', () => {
    expect(tablesNeeded(scenario(ten, [9, 8, 10, 0]))).toEqual([{ size: 10, count: 3 }])
  })

  it('is empty for a plan without a non-empty table', () => {
    expect(tablesNeeded(scenario(mixed, []))).toEqual([])
    expect(tablesNeeded(scenario(mixed, [0]))).toEqual([])
  })
})

describe('tablesNeededLabel and seatsTotal', () => {
  const needed = [
    { size: 12, count: 2 },
    { size: 11, count: 1 },
    { size: 9, count: 1 },
  ] as const

  it('words the list with "×" and says "brak" for none', () => {
    expect(tablesNeededLabel([...needed])).toBe('2 × 12, 1 × 11, 1 × 9')
    expect(tablesNeededLabel([])).toBe('brak')
  })

  it('adds up the seats the venue provides', () => {
    expect(seatsTotal([...needed])).toBe(44)
    expect(seatsTotal([])).toBe(0)
  })
})

describe('sizeAfterDrop', () => {
  it('is only defined for the mixed plan', () => {
    expect(sizeAfterDrop(11, mixed)).toBe(11)
    expect(sizeAfterDrop(0, mixed)).toBeNull()
    expect(sizeAfterDrop(11, ten)).toBeUndefined()
  })
})
