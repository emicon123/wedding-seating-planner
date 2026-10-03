import { clusterOf, effectiveCompanions, sortByCluster } from '@/domain/companions'
import {
  KAROLINA,
  MACIEK,
  MACIEK_FAMILY_GUESTS,
  MACIEK_FAMILY_OVERVIEW,
  MICHAL,
  OLA,
  link,
  makeCluster,
  makeGuest,
  makeOverview,
} from '@/test/builders'
import type { ClusterOverview, Guest } from '@/domain/types'

describe('clusterOf', () => {
  it('finds the cluster containing the guest', () => {
    expect(clusterOf(5, MACIEK_FAMILY_OVERVIEW)?.key).toBe(4)
    expect(clusterOf(7, MACIEK_FAMILY_OVERVIEW)?.key).toBe(6)
  })

  it('is undefined for a guest the overview does not know yet', () => {
    expect(clusterOf(99, MACIEK_FAMILY_OVERVIEW)).toBeUndefined()
  })
})

describe('effectiveCompanions (Maciek / Michał / Ola fixture)', () => {
  it('lists the group-0 partner, the direct group-1 link and the one reached through group 0', () => {
    expect(effectiveCompanions(MACIEK.id, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)).toEqual([
      { guestId: 5, level: 0 }, // Karolina: direct group 0
      { guestId: 6, level: 1 }, // Michał: direct group 1
      { guestId: 7, level: 1, via: 6 }, // Ola: through Michał's group 0
    ])
  })

  it('is symmetric: Ola reaches Maciek and Karolina via Michał', () => {
    expect(effectiveCompanions(OLA.id, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)).toEqual([
      { guestId: 6, level: 0 }, // Michał: direct group 0
      { guestId: 4, level: 1, via: 6 }, // Maciek: his cluster is liked by Michał's
      { guestId: 5, level: 1, via: 6 }, // Karolina
    ])
  })

  it('attributes a partner-only link to the cluster-mate who made it', () => {
    // Karolina (not Maciek) is the one linked to Michał at group 2
    const karolina = makeGuest({ ...KAROLINA, links: [link(4, 0), link(6, 2)] })
    const maciek = makeGuest({ ...MACIEK, links: [link(5, 0)] })
    const michal = makeGuest({ id: 6, firstName: 'Michał', links: [link(7, 0), link(5, 2)] })
    const overview = makeOverview([
      makeCluster({ key: 4, guestIds: [4, 5], affinities: [{ clusterKey: 6, level: 2 }] }),
      makeCluster({ key: 6, guestIds: [6, 7], affinities: [{ clusterKey: 4, level: 2 }] }),
    ])
    const guests = [
      maciek,
      karolina,
      michal,
      makeGuest({ id: 7, firstName: 'Ola', links: [link(6, 0)] }),
    ]

    expect(effectiveCompanions(4, guests, overview)).toEqual([
      { guestId: 5, level: 0 },
      { guestId: 6, level: 2, via: 5 },
      { guestId: 7, level: 2, via: 5 },
    ])
  })

  it('shows transitive group-0 members through the member that links them', () => {
    // A(1) - B(2) - C(3): A is not directly linked to C
    const guests = [
      makeGuest({ id: 1, firstName: 'A', links: [link(2, 0)] }),
      makeGuest({ id: 2, firstName: 'B', links: [link(1, 0), link(3, 0)] }),
      makeGuest({ id: 3, firstName: 'C', links: [link(2, 0)] }),
    ]
    const overview = makeOverview([makeCluster({ key: 1, guestIds: [1, 2, 3] })])
    expect(effectiveCompanions(1, guests, overview)).toEqual([
      { guestId: 2, level: 0 },
      { guestId: 3, level: 0, via: 2 },
    ])
  })

  it('is empty for a guest without links or unknown to the overview', () => {
    const loner = makeGuest({ id: 9, firstName: 'Zosia' })
    const overview = makeOverview([makeCluster({ key: 9, guestIds: [9] })])
    expect(effectiveCompanions(9, [loner], overview)).toEqual([])
    expect(effectiveCompanions(404, [loner], overview)).toEqual([])
  })
})

describe('sortByCluster', () => {
  // Adam(9) + Zosia(8) are group 0; alphabetically Zosia would sort last, after Ola.
  const adam = makeGuest({ id: 9, firstName: 'Adam', links: [link(8, 0)] })
  const zosia = makeGuest({ id: 8, firstName: 'Zosia', links: [link(9, 0)] })
  const guests = [MACIEK, KAROLINA, MICHAL, OLA, zosia, adam]
  const overview = makeOverview([
    makeCluster({ key: 4, guestIds: [4, 5] }),
    makeCluster({ key: 6, guestIds: [6, 7] }),
    makeCluster({ key: 8, guestIds: [8, 9] }),
  ])
  const names = (list: { displayName: string }[]) => list.map((guest) => guest.displayName)

  it('keeps whole clusters together, ordered by their first member', () => {
    expect(names(sortByCluster(guests, overview))).toEqual([
      'Adam',
      'Zosia',
      'Karolina Nowak',
      'Maciek',
      'Michał',
      'Ola',
    ])
  })

  it('does not mutate the input and breaks name ties by id', () => {
    const before = [...guests]
    const sorted = sortByCluster(guests, overview)

    expect(guests).toEqual(before)
    expect(sorted).not.toBe(guests)
    const twins = [
      makeGuest({ id: 11, firstName: 'Klon' }),
      makeGuest({ id: 10, firstName: 'Klon' }),
    ]
    expect(sortByCluster(twins, makeOverview([])).map((guest) => guest.id)).toEqual([10, 11])
  })

  it('guests missing from the overview sort as clusters of one', () => {
    expect(names(sortByCluster(guests, makeOverview([])))).toEqual([
      'Adam',
      'Karolina Nowak',
      'Maciek',
      'Michał',
      'Ola',
      'Zosia',
    ])
  })

  it('without an overview the order is left alone', () => {
    expect(sortByCluster(guests, undefined)).toBe(guests)
  })

  describe('group 1 as the second key (003-frontend-design §11)', () => {
    type Pair = readonly [number, number]
    const NAMES = ['Ala', 'Bartek', 'Celina', 'Darek', 'Ewa', 'Franek']
    const [A, B, C, D, E, F] = [1, 2, 3, 4, 5, 6]

    const sixGuests = () => NAMES.map((firstName, index) => makeGuest({ id: index + 1, firstName }))

    /** One cluster per guest; each pair is a level-1 affinity listed on both sides unless one-sided. */
    function clustersFor(
      keys: number[],
      pairs: Pair[],
      { level = 1, bothSides = true }: { level?: 1 | 2; bothSides?: boolean } = {},
    ) {
      return makeOverview(
        keys.map((key) =>
          makeCluster({
            key,
            guestIds: [key],
            affinities: pairs.flatMap(([from, to]) => [
              ...(from === key ? [{ clusterKey: to, level }] : []),
              ...(bothSides && to === key ? [{ clusterKey: from, level }] : []),
            ]),
          }),
        ),
      )
    }
    const sixClusters = (pairs: Pair[], options?: Parameters<typeof clustersFor>[2]) =>
      clustersFor([A, B, C, D, E, F], pairs, options)
    const order = (list: Guest[], overview: ClusterOverview) => names(sortByCluster(list, overview))

    it('1: without affinities the order is alphabetical, as before', () => {
      expect(order(sixGuests(), sixClusters([]))).toEqual(NAMES)
    })

    it('2: a chain A-C-E reads Ala, Celina, Ewa, then the rest', () => {
      expect(
        order(
          sixGuests(),
          sixClusters([
            [A, C],
            [C, E],
          ]),
        ),
      ).toEqual(['Ala', 'Celina', 'Ewa', 'Bartek', 'Darek', 'Franek'])
    })

    it('3: a star puts the centre between its first partners', () => {
      expect(
        order(
          sixGuests(),
          sixClusters([
            [D, A],
            [D, C],
            [D, F],
          ]),
        ),
      ).toEqual(['Ala', 'Darek', 'Celina', 'Franek', 'Bartek', 'Ewa'])
    })

    it('4: a cycle terminates and lists every unit once', () => {
      expect(
        order(
          sixGuests(),
          sixClusters([
            [A, B],
            [B, C],
            [C, A],
          ]),
        ),
      ).toEqual(NAMES)
    })

    it('5: the walk is depth first, not breadth first', () => {
      expect(
        order(
          sixGuests(),
          sixClusters([
            [A, B],
            [A, C],
            [B, D],
          ]),
        ),
      ).toEqual(['Ala', 'Bartek', 'Darek', 'Celina', 'Ewa', 'Franek'])
    })

    it('6: a level-2 link does not move anyone', () => {
      expect(order(sixGuests(), sixClusters([[A, E]], { level: 2 }))).toEqual(NAMES)
    })

    it('7: a hidden neighbour neither drags nor bridges', () => {
      const xawery = 7
      const overview = makeOverview([
        ...[A, B, C, D, E, F].map((key) =>
          makeCluster({
            key,
            guestIds: [key],
            affinities: key === A || key === C ? [{ clusterKey: xawery, level: 1 }] : [],
          }),
        ),
        makeCluster({
          key: xawery,
          guestIds: [xawery],
          affinities: [
            { clusterKey: A, level: 1 },
            { clusterKey: C, level: 1 },
          ],
        }),
      ])
      expect(order(sixGuests(), overview)).toEqual(NAMES)
    })

    it('8: group 0 stays primary and the partner follows the whole cluster', () => {
      const zosia = makeGuest({ id: 8, firstName: 'Zosia', links: [link(9, 0)] })
      const adam = makeGuest({ id: 9, firstName: 'Adam', links: [link(8, 0)] })
      const overview = makeOverview([
        ...[A, B, C, D, F].map((key) => makeCluster({ key, guestIds: [key] })),
        makeCluster({ key: E, guestIds: [E], affinities: [{ clusterKey: 8, level: 1 }] }),
        makeCluster({ key: 8, guestIds: [8, 9], affinities: [{ clusterKey: E, level: 1 }] }),
      ])
      expect(order([...sixGuests(), zosia, adam], overview)).toEqual([
        'Adam',
        'Zosia',
        'Ewa',
        'Ala',
        'Bartek',
        'Celina',
        'Darek',
        'Franek',
      ])
    })

    it('9: a hidden member does not name the unit (it no longer jumps to the top)', () => {
      // Aaron (10) is filtered out, so the unit is named after Wiktor and sorts after Franek.
      const wiktor = makeGuest({ id: 11, firstName: 'Wiktor', links: [link(10, 0)] })
      const overview = makeOverview([
        ...[A, B, C, D, E, F].map((key) => makeCluster({ key, guestIds: [key] })),
        makeCluster({ key: 10, guestIds: [10, 11] }),
      ])
      expect(order([...sixGuests(), wiktor], overview)).toEqual([...NAMES, 'Wiktor'])
    })

    it('10: an affinity listed on one side only still joins the units', () => {
      expect(order(sixGuests(), sixClusters([[A, E]], { bothSides: false }))).toEqual([
        'Ala',
        'Ewa',
        'Bartek',
        'Celina',
        'Darek',
        'Franek',
      ])
    })

    it('11: an affinity to an unknown cluster key is ignored', () => {
      const overview = makeOverview(
        [A, B, C, D, E, F].map((key) =>
          makeCluster({
            key,
            guestIds: [key],
            affinities: key === A ? [{ clusterKey: 999, level: 1 }] : [],
          }),
        ),
      )
      expect(order(sixGuests(), overview)).toEqual(NAMES)
    })

    it('12: a guest unknown to the overview is a unit of one, ties broken by key', () => {
      const newcomer = makeGuest({ id: 20, firstName: 'Celina' })
      const result = sortByCluster([newcomer, ...sixGuests()], sixClusters([]))
      expect(result.map((guest) => guest.id)).toEqual([A, B, C, 20, D, E, F])
    })

    it('13: the result does not depend on the order of the inputs', () => {
      const pairs: Pair[] = [
        [D, A],
        [D, C],
        [D, F],
      ]
      const expected = ['Ala', 'Darek', 'Celina', 'Franek', 'Bartek', 'Ewa']
      const shuffled = {
        clusters: [...sixClusters(pairs).clusters]
          .reverse()
          .map((cluster) => ({ ...cluster, affinities: [...cluster.affinities].reverse() })),
        warnings: [],
      }
      expect(order(sixGuests(), sixClusters(pairs))).toEqual(expected)
      expect(order([...sixGuests()].reverse(), shuffled)).toEqual(expected)
      expect(
        order(
          [...sixGuests()].sort((a, b) => (a.id % 3) - (b.id % 3)),
          shuffled,
        ),
      ).toEqual(expected)
    })

    it('14: returns a new array and leaves the input alone; no overview returns the input', () => {
      const input = sixGuests()
      const before = [...input]
      const overview = sixClusters([[A, C]])
      const sorted = sortByCluster(input, overview)

      expect(sorted).not.toBe(input)
      expect(input).toEqual(before)
      expect(sortByCluster(input, undefined)).toBe(input)
    })
  })
})
