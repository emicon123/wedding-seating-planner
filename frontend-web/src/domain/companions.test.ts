import { clusterOf, effectiveCompanions } from '@/domain/companions'
import {
  KAROLINA,
  MACIEK,
  MACIEK_FAMILY_GUESTS,
  MACIEK_FAMILY_OVERVIEW,
  OLA,
  link,
  makeCluster,
  makeGuest,
  makeOverview,
} from '@/test/builders'

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
