import { linkColumns, warningsForGuest } from '@/domain/linkColumns'
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

describe('linkColumns (Maciek / Michał / Ola fixture)', () => {
  const columns = linkColumns(MACIEK.id, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)

  it('puts the direct group-0 link in column 0, removable', () => {
    expect(columns[0]).toEqual([{ guestId: KAROLINA.id, direct: true }])
  })

  it('shows Michał directly and Ola as coming along through his group 0', () => {
    expect(columns[1]).toEqual([
      { guestId: MICHAL.id, direct: true },
      { guestId: OLA.id, direct: false, via: { guestId: MICHAL.id, reason: 'cluster' } },
    ])
  })

  it('has an empty group 2', () => {
    expect(columns[2]).toEqual([])
  })

  it('mirrors the link on the other side (symmetric)', () => {
    const fromMichal = linkColumns(MICHAL.id, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)
    expect(fromMichal[1].map((entry) => entry.guestId)).toEqual([MACIEK.id, KAROLINA.id])
  })
})

describe('linkColumns edge cases', () => {
  it('shows direct links before the clusters overview has arrived', () => {
    const columns = linkColumns(MACIEK.id, MACIEK_FAMILY_GUESTS, undefined)
    expect(columns[0]).toEqual([{ guestId: KAROLINA.id, direct: true }])
    expect(columns[1]).toEqual([{ guestId: MICHAL.id, direct: true }])
  })

  it('credits a cluster-mate whose own link brings the companion along', () => {
    const maciek = makeGuest({ id: 4, firstName: 'Maciek', links: [link(5, 0)] })
    const karolina = makeGuest({ id: 5, firstName: 'Karolina', links: [link(4, 0), link(6, 1)] })
    const michal = makeGuest({ id: 6, firstName: 'Michał', links: [link(5, 1)] })
    const overview = makeOverview([
      makeCluster({ key: 4, guestIds: [4, 5], affinities: [{ clusterKey: 6, level: 1 }] }),
      makeCluster({ key: 6, guestIds: [6], affinities: [{ clusterKey: 4, level: 1 }] }),
    ])

    const columns = linkColumns(4, [maciek, karolina, michal], overview)

    expect(columns[1]).toEqual([{ guestId: 6, direct: false, via: { guestId: 5, reason: 'link' } }])
  })

  it('is empty for an unknown guest', () => {
    expect(linkColumns(99, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)).toEqual({
      0: [],
      1: [],
      2: [],
    })
  })
})

describe('warningsForGuest', () => {
  const overview = {
    clusters: MACIEK_FAMILY_OVERVIEW.clusters,
    warnings: [
      { code: 'cluster_exceeds_8' as const, message: 'x', guestIds: [6, 7] },
      { code: 'conflicting_link_levels' as const, message: 'y', guestIds: [5] },
    ],
  }

  it('returns warnings touching the guest or their cluster-mates', () => {
    expect(warningsForGuest(4, overview).map((w) => w.code)).toEqual(['conflicting_link_levels'])
    expect(warningsForGuest(6, overview).map((w) => w.code)).toEqual(['cluster_exceeds_8'])
  })
})
