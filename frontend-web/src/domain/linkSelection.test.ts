import {
  clusterAfter,
  clusterSizeWarning,
  diffIsEmpty,
  diffSelection,
  joiningViaCluster,
  linkChangesOf,
  pickerRows,
  selectedAt,
} from '@/domain/linkSelection'
import {
  KAROLINA,
  MACIEK,
  MACIEK_FAMILY_GUESTS,
  link,
  makeCluster,
  makeGuest,
  makeOverview,
} from '@/test/builders'

// Maciek(4): Karolina(5) group 0, Michał(6) group 1. Michał(6): Ola(7) group 0.
const ZOSIA = makeGuest({ id: 8, firstName: 'Zosia' })
const ADAM = makeGuest({ id: 9, firstName: 'Ćma', links: [link(4, 2)] })
const GUEST4 = { ...MACIEK, links: [link(5, 0), link(6, 1), link(9, 2)] }
const GUESTS = [GUEST4, KAROLINA, ...MACIEK_FAMILY_GUESTS.slice(2), ZOSIA, ADAM]

describe('pickerRows', () => {
  it('lists every other guest in Polish alphabetical order with the level they have today', () => {
    const rows = pickerRows(GUEST4, GUESTS, undefined)

    expect(rows.map((row) => row.guest.displayName)).toEqual([
      'Ćma',
      'Karolina Nowak',
      'Michał',
      'Ola',
      'Zosia',
    ])
    expect(rows.find((row) => row.guest.id === 6)?.currentLevel).toBe(1)
    expect(rows.find((row) => row.guest.id === 8)?.currentLevel).toBeUndefined()
  })

  it('marks cluster-mates that are not linked directly (a link inside the cluster is pointless)', () => {
    const chain = [
      makeGuest({ id: 1, firstName: 'A', links: [link(2, 0)] }),
      makeGuest({ id: 2, firstName: 'B', links: [link(1, 0), link(3, 0)] }),
      makeGuest({ id: 3, firstName: 'C', links: [link(2, 0)] }),
    ]
    const overview = makeOverview([makeCluster({ key: 1, guestIds: [1, 2, 3] })])

    const rows = pickerRows(chain[0]!, chain, overview)

    expect(rows.map((row) => [row.guest.id, row.viaCluster, row.via])).toEqual([
      [2, false, undefined],
      [3, true, 2], // reached through B
    ])
  })
})

describe('selectedAt / diffSelection', () => {
  it('starts with the guests linked at exactly that level', () => {
    expect([...selectedAt(GUEST4, 1)]).toEqual([6])
    expect([...selectedAt(GUEST4, 2)]).toEqual([9])
  })

  it('no change means an empty diff', () => {
    expect(diffIsEmpty(diffSelection(GUEST4, 1, selectedAt(GUEST4, 1)))).toBe(true)
  })

  it('splits changes into add / move (from another level) / remove', () => {
    // group 1 picker: keep nobody, tick Zosia (new), Karolina (moves from 0), Ćma (moves from 2)
    const diff = diffSelection(GUEST4, 1, new Set([8, 5, 9]))

    expect(diff).toEqual({
      add: [8],
      move: [
        { guestId: 5, from: 0 },
        { guestId: 9, from: 2 },
      ],
      remove: [6],
    })
  })

  it('a link at another level that stays unticked is left alone', () => {
    const diff = diffSelection(GUEST4, 1, new Set([6]))
    expect(diffIsEmpty(diff)).toBe(true)
  })
})

describe('linkChangesOf', () => {
  it('removals first, then moves and additions as upserts at the picked level', () => {
    const changes = linkChangesOf(1, {
      add: [8],
      move: [{ guestId: 5, from: 0 }],
      remove: [6],
    })

    expect(changes).toEqual([
      { otherId: 6, level: null },
      { otherId: 5, level: 1 },
      { otherId: 8, level: 1 },
    ])
  })
})

describe('joiningViaCluster', () => {
  const overview = makeOverview([
    makeCluster({ key: 4, guestIds: [4, 5] }),
    makeCluster({ key: 6, guestIds: [6, 7] }),
  ])

  it('ticking Michał brings Ola along through his group 0', () => {
    expect(joiningViaCluster(4, new Set([6]), overview)).toEqual([{ guestId: 7, viaId: 6 }])
  })

  it('nobody extra when the partner is ticked too, or when the cluster has one member', () => {
    expect(joiningViaCluster(4, new Set([6, 7]), overview)).toEqual([])
    expect(joiningViaCluster(4, new Set([8]), overview)).toEqual([])
  })

  it('never lists the guest own cluster', () => {
    expect(joiningViaCluster(4, new Set([5]), overview)).toEqual([])
  })
})

describe('clusterAfter (group 0 picker preview)', () => {
  it('adding Michał merges the two families: 4 people', () => {
    const result = clusterAfter(GUEST4, GUESTS, new Set([5, 6]))
    expect(result.memberIds.sort()).toEqual([4, 5, 6, 7])
    expect(result.seatedSize).toBe(4)
  })

  it('unticking the partner splits the cluster', () => {
    const result = clusterAfter(GUEST4, GUESTS, new Set())
    expect(result.memberIds).toEqual([4])
  })

  it('disabled guests stay in the cluster but do not take a seat', () => {
    const guests = GUESTS.map((guest) => (guest.id === 5 ? { ...guest, enabled: false } : guest))
    const result = clusterAfter(GUEST4, guests, new Set([5]))
    expect(result.memberIds.sort()).toEqual([4, 5])
    expect(result.seatedSize).toBe(1)
  })
})

describe('clusterSizeWarning', () => {
  it.each([
    [9, null],
    [10, 'cluster_exceeds_9'],
    [12, 'cluster_exceeds_9'],
    [13, 'cluster_exceeds_12'],
  ] as const)('%i seats -> %s', (size, code) => {
    expect(clusterSizeWarning(size)).toBe(code)
  })
})
