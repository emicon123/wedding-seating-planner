import { relatedTo, relationsOf, summariseRelations, type Relations } from '@/domain/relations'
import {
  MACIEK_FAMILY_GUESTS,
  MACIEK_FAMILY_OVERVIEW,
  link,
  makeCluster,
  makeGuest,
  makeOverview,
} from '@/test/builders'

// Maciek(4)+Karolina(5) are one family, Michał(6)+Ola(7) another; Maciek-Michał is group 1.
const MACIEK = 4
const KAROLINA = 5
const MICHAL = 6
const OLA = 7

const ids = (relations: Relations, level: 0 | 1 | 2) =>
  relations.blocks[level].families.map((family) => family.members.map((m) => m.guestId))

describe('relationsOf (Maciek / Michał / Ola fixture)', () => {
  it.each([
    {
      who: 'Maciek',
      id: MACIEK,
      group0: [[KAROLINA]],
      group1: [[MICHAL, OLA]],
      total: 3,
    },
    {
      who: 'Karolina (partner sees the family link through Maciek)',
      id: KAROLINA,
      group0: [[MACIEK]],
      group1: [[MICHAL, OLA]],
      total: 3,
    },
    {
      who: 'Michał (symmetric)',
      id: MICHAL,
      group0: [[OLA]],
      group1: [[MACIEK, KAROLINA]],
      total: 3,
    },
    {
      who: 'Ola (reaches Maciek and Karolina through Michał)',
      id: OLA,
      group0: [[MICHAL]],
      group1: [[KAROLINA, MACIEK]],
      total: 3,
    },
  ])('$who', ({ id, group0, group1, total }) => {
    const relations = relationsOf(id, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)

    expect(ids(relations, 0)).toEqual(group0)
    expect(ids(relations, 1)).toEqual(group1)
    expect(ids(relations, 2)).toEqual([])
    expect(relations.total).toBe(total)
  })

  it('says why each person is there: directly, through group 0, or through a cluster-mate', () => {
    const fromMaciek = relationsOf(MACIEK, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)
    const [michal, ola] = fromMaciek.blocks[1].families[0]!.members
    expect(michal).toEqual({ guestId: MICHAL, direct: true })
    expect(ola).toEqual({
      guestId: OLA,
      direct: false,
      via: { guestId: MICHAL, reason: 'cluster' },
    })

    const fromKarolina = relationsOf(KAROLINA, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)
    expect(fromKarolina.blocks[1].families[0]!.members[0]).toEqual({
      guestId: MICHAL,
      direct: false,
      via: { guestId: MACIEK, reason: 'link' },
    })
  })

  it('counts persons and families per block', () => {
    const relations = relationsOf(MACIEK, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)

    expect(relations.blocks[0]).toMatchObject({ personCount: 1, familyCount: 1 })
    expect(relations.blocks[1]).toMatchObject({ personCount: 2, familyCount: 1 })
    expect(relations.blocks[2]).toMatchObject({ personCount: 0, familyCount: 0 })
  })

  it('a whole group-0 chain is one family, with the middle person as the reason', () => {
    const chain = [
      makeGuest({ id: 1, firstName: 'A', links: [link(2, 0)] }),
      makeGuest({ id: 2, firstName: 'B', links: [link(1, 0), link(3, 0)] }),
      makeGuest({ id: 3, firstName: 'C', links: [link(2, 0)] }),
    ]
    const overview = makeOverview([makeCluster({ key: 1, guestIds: [1, 2, 3] })])

    const relations = relationsOf(1, chain, overview)

    expect(relations.blocks[0].families).toHaveLength(1)
    expect(relations.blocks[0].families[0]!.members).toEqual([
      { guestId: 2, direct: true },
      { guestId: 3, direct: false, via: { guestId: 2, reason: 'cluster' } },
    ])
  })

  it('several families in group 1 are listed one by one, sorted by name', () => {
    const guests = [
      makeGuest({ id: 1, firstName: 'Ja', links: [link(2, 1), link(4, 1)] }),
      makeGuest({ id: 2, firstName: 'Zenon', links: [link(1, 1)] }),
      makeGuest({ id: 3, firstName: 'Adam', links: [link(4, 0)] }),
      makeGuest({ id: 4, firstName: 'Bogna', links: [link(3, 0), link(1, 1)] }),
    ]
    const overview = makeOverview([
      makeCluster({
        key: 1,
        guestIds: [1],
        affinities: [
          { clusterKey: 2, level: 1 },
          { clusterKey: 3, level: 1 },
        ],
      }),
      makeCluster({ key: 2, guestIds: [2], affinities: [{ clusterKey: 1, level: 1 }] }),
      makeCluster({ key: 3, guestIds: [3, 4], affinities: [{ clusterKey: 1, level: 1 }] }),
    ])

    const relations = relationsOf(1, guests, overview)

    expect(ids(relations, 1)).toEqual([[4, 3], [2]])
    expect(relations.blocks[1]).toMatchObject({ personCount: 3, familyCount: 2 })
  })

  it('keeps disabled guests in the lists (they are only marked, by the guest record)', () => {
    const guests = MACIEK_FAMILY_GUESTS.map((guest) =>
      guest.id === OLA ? { ...guest, enabled: false } : guest,
    )

    const relations = relationsOf(MACIEK, guests, MACIEK_FAMILY_OVERVIEW)

    expect(ids(relations, 1)).toEqual([[MICHAL, OLA]])
  })

  it('shows direct links alone before the clusters overview has arrived', () => {
    const relations = relationsOf(MACIEK, MACIEK_FAMILY_GUESTS, undefined)

    expect(ids(relations, 0)).toEqual([[KAROLINA]])
    expect(ids(relations, 1)).toEqual([[MICHAL]])
    expect(relations.total).toBe(2)
  })

  it('is empty for a guest without links', () => {
    const lonely = makeGuest({ id: 9, firstName: 'Samotny' })
    const relations = relationsOf(
      9,
      [lonely],
      makeOverview([makeCluster({ key: 9, guestIds: [9] })]),
    )

    expect(relations.total).toBe(0)
  })
})

describe('summariseRelations (row chips)', () => {
  const summary = summariseRelations(MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)

  it('names the group-0 partners and counts group 1 and 2 with everyone who comes along', () => {
    expect(summary.get(MACIEK)).toEqual({
      partners: ['Karolina Nowak'],
      counts: { 0: 1, 1: 2, 2: 0 },
      names: { 0: ['Karolina Nowak'], 1: ['Michał', 'Ola'], 2: [] },
    })
    expect(summary.get(OLA)?.partners).toEqual(['Michał'])
    expect(summary.get(OLA)?.counts[1]).toBe(2)
  })
})

describe('relatedTo (filter "pokaż osoby powiązane z …")', () => {
  it('lists the person first, then group 0, 1, 2, each alphabetical', () => {
    expect(relatedTo(MACIEK, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)).toEqual([
      { guestId: MACIEK, level: null },
      { guestId: KAROLINA, level: 0 },
      { guestId: MICHAL, level: 1 },
      { guestId: OLA, level: 1 },
    ])
  })
})

// Regression (user report): Emilka lists Justynka, Maks and "os. tow." in group 0. Group 0 is a
// CLUSTER, so every member must see the other three, not only the one who holds the stored link.
describe('group 0 is the whole cluster, not the guest own links', () => {
  const EMILKA = 1
  const JUSTYNKA = 2
  const MAKS = 3
  const OS_TOW = 4
  const PIATY = 5

  const party = (guests: ReturnType<typeof makeGuest>[], keys: number[]) =>
    [guests, makeOverview([makeCluster({ key: 1, guestIds: keys })])] as const

  const FOUR = [
    makeGuest({ id: EMILKA, firstName: 'Emilka', links: [link(2, 0), link(3, 0), link(4, 0)] }),
    makeGuest({ id: JUSTYNKA, firstName: 'Justynka', links: [link(1, 0)] }),
    makeGuest({ id: MAKS, firstName: 'Maks', links: [link(1, 0)] }),
    makeGuest({ id: OS_TOW, firstName: 'os. tow.', links: [link(1, 0)] }),
  ]

  it.each([
    ['Emilka', EMILKA, [JUSTYNKA, MAKS, OS_TOW]],
    ['Justynka', JUSTYNKA, [EMILKA, MAKS, OS_TOW]],
    ['Maks', MAKS, [EMILKA, JUSTYNKA, OS_TOW]],
    ['os. tow.', OS_TOW, [EMILKA, JUSTYNKA, MAKS]],
  ])('%s sees the other three', (_who, id, others) => {
    const [guests, overview] = party(FOUR, [1, 2, 3, 4])

    const relations = relationsOf(id, [...guests], overview)

    expect(relations.blocks[0].personCount).toBe(3)
    expect(relations.blocks[0].families).toHaveLength(1)
    expect(relations.blocks[0].families[0]!.members.map((m) => m.guestId).sort()).toEqual(others)
    expect(relations.total).toBe(3)
  })

  it('says why: direct for the link holder, "przez" Emilka for the others', () => {
    const [guests, overview] = party(FOUR, [1, 2, 3, 4])

    const members = relationsOf(JUSTYNKA, [...guests], overview).blocks[0].families[0]!.members

    expect(members).toEqual([
      { guestId: EMILKA, direct: true },
      { guestId: MAKS, direct: false, via: { guestId: EMILKA, reason: 'cluster' } },
      { guestId: OS_TOW, direct: false, via: { guestId: EMILKA, reason: 'cluster' } },
    ])
  })

  it('row chips: every member lists three partners', () => {
    const [guests, overview] = party(FOUR, [1, 2, 3, 4])

    const summary = summariseRelations([...guests], overview)

    for (const guest of guests) {
      expect(summary.get(guest.id)?.counts[0]).toBe(3)
      expect(summary.get(guest.id)?.partners).toHaveLength(3)
    }
  })

  it('a disabled member stays in everyone list', () => {
    const [guests, overview] = party(
      FOUR.map((guest) => (guest.id === MAKS ? { ...guest, enabled: false } : guest)),
      [1, 2, 3, 4],
    )

    expect(relationsOf(JUSTYNKA, [...guests], overview).blocks[0].personCount).toBe(3)
  })

  it('a fifth person linked to Maks later appears for everyone, via the chain', () => {
    const five = [
      ...FOUR.map((guest) =>
        guest.id === MAKS ? { ...guest, links: [...guest.links, link(PIATY, 0)] } : guest,
      ),
      makeGuest({ id: PIATY, firstName: 'Piąty', links: [link(MAKS, 0)] }),
    ]
    const [guests, overview] = party(five, [1, 2, 3, 4, 5])

    for (const guest of guests) {
      expect(relationsOf(guest.id, [...guests], overview).blocks[0].personCount).toBe(4)
    }
    const fromJustynka = relationsOf(JUSTYNKA, [...guests], overview).blocks[0].families[0]!.members
    expect(fromJustynka.find((m) => m.guestId === PIATY)).toEqual({
      guestId: PIATY,
      direct: false,
      via: { guestId: EMILKA, reason: 'cluster' }, // the first hop of Justynka's own chain
    })
  })

  it('before the clusters overview arrives, only direct links show (the fallback)', () => {
    expect(relationsOf(JUSTYNKA, FOUR, undefined).blocks[0].personCount).toBe(1)
  })
})
