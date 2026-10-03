import { buildGuestIndex } from '@/domain/guestIndex'
import { buildNameIndex, buildPrintTables } from '@/domain/printPlan'
import { makeGuest, makePlan, placement, withoutViolations } from '@/test/builders'

const guests = [
  makeGuest({ id: 1, firstName: 'Zosia', lastName: 'Żak' }),
  makeGuest({ id: 2, firstName: 'Łukasz', lastName: 'Łaski' }),
  makeGuest({ id: 3, firstName: 'Adam', lastName: 'Nowak' }),
  makeGuest({ id: 4, firstName: 'Karolina', lastName: 'Nowak' }),
  makeGuest({ id: 5, firstName: 'Basia' }),
  makeGuest({ id: 6, firstName: 'Staś', lastName: 'Nowak', isChild: true }),
  makeGuest({ id: 7, firstName: 'Ola', lastName: 'Lis' }),
]
const index = buildGuestIndex(guests)

const plan = withoutViolations(
  makePlan(
    [
      { number: 1, clusters: [placement(4, [4, 3, 6]), placement(1, [1])] },
      { number: 2, clusters: [placement(5, [5]), placement(2, [2])] },
    ],
    [placement(7, [7])],
  ),
)

describe('buildPrintTables', () => {
  const printed = buildPrintTables(plan, 10, index)

  it('lists paczki first, members of a paczka by name, and carries the child flag', () => {
    const [first] = printed.tables
    expect(first?.clusters.map((c) => c.guests.map((g) => g.name))).toEqual([
      ['Adam Nowak', 'Karolina Nowak', 'Staś Nowak'],
      ['Zosia Żak'],
    ])
    expect(first?.clusters[0]?.guests.map((g) => g.isChild)).toEqual([false, false, true])
  })

  it('sorts single guests by name with Polish collation', () => {
    expect(printed.tables[1]?.clusters.map((c) => c.guests[0]?.name)).toEqual([
      'Basia',
      'Łukasz Łaski',
    ])
  })

  it('reports fill and its status against the capacity', () => {
    expect(printed.tables.map((t) => [t.fill, t.status])).toEqual([
      [4, 'under'],
      [2, 'under'],
    ])
    const crowded = withoutViolations(
      makePlan([{ number: 1, clusters: Array.from({ length: 10 }, (_, i) => placement(i, [i])) }]),
    )
    expect(buildPrintTables(crowded, 9, index).tables[0]?.status).toBe('over')
  })

  it('keeps the unseated paczki apart', () => {
    expect(printed.unseated.map((c) => c.guests[0]?.name)).toEqual(['Ola Lis'])
  })
})

describe('buildNameIndex', () => {
  const sections = buildNameIndex(plan, index)

  it('sorts by surname, then first name, in Polish order, grouped by initial letter', () => {
    expect(sections.map((s) => s.letter)).toEqual(['B', 'Ł', 'L', 'N', 'Ż'].toSorted(pl))
    const names = sections.flatMap((s) => s.entries.map((e) => e.displayName))
    expect(names).toEqual([
      'Basia',
      'Ola Lis',
      'Łukasz Łaski',
      'Adam Nowak',
      'Karolina Nowak',
      'Staś Nowak',
      'Zosia Żak',
    ])
  })

  it('splits the name into surname and given name for scanning (a guest without surname has only the first)', () => {
    const all = sections.flatMap((s) => s.entries)
    expect(all.find((e) => e.guestId === 4)).toMatchObject({ surname: 'Nowak', given: 'Karolina' })
    expect(all.find((e) => e.guestId === 5)).toMatchObject({ surname: 'Basia', given: null })
  })

  it('maps every guest to a table, unseated guests to null, and flags children', () => {
    const all = sections.flatMap((s) => s.entries)
    expect(all.find((e) => e.guestId === 3)?.tableNumber).toBe(1)
    expect(all.find((e) => e.guestId === 2)?.tableNumber).toBe(2)
    expect(all.find((e) => e.guestId === 7)?.tableNumber).toBeNull()
    expect(all.find((e) => e.guestId === 6)?.isChild).toBe(true)
  })

  it('leaves out guests the plan does not list (disabled ones)', () => {
    const ids = sections.flatMap((s) => s.entries.map((e) => e.guestId))
    expect(ids).toHaveLength(7)
    const smaller = withoutViolations(makePlan([{ number: 1, clusters: [placement(3, [3])] }]))
    expect(buildNameIndex(smaller, index).flatMap((s) => s.entries)).toHaveLength(1)
  })
})

function pl(a: string, b: string): number {
  return a.localeCompare(b, 'pl')
}
