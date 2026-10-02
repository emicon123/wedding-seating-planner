import { guestDetails } from '@/domain/guestDetails'
import type { GuestScore } from '@/domain/types'
import {
  KAROLINA,
  MACIEK,
  MACIEK_FAMILY_GUESTS,
  MACIEK_FAMILY_OVERVIEW,
  MICHAL,
  OLA,
  makeGuest,
  makePlan,
  placement,
} from '@/test/builders'

const score = (guestId: number, tableNumber: number | null): GuestScore => ({
  guestId,
  tableNumber,
  satisfaction: 2,
  preferredTotal: 2,
  preferredAtTable: 1,
  fallbackAtTable: 0,
  strangersAtTable: 3,
})

describe('guestDetails', () => {
  const plan = {
    ...makePlan([
      { number: 1, clusters: [placement(4, [4, 5])] },
      { number: 2, clusters: [placement(6, [6, 7])] },
    ]),
    guestScores: [score(4, 1)],
  }

  it('says where the guest sits and what the server scored', () => {
    const details = guestDetails(MACIEK.id, plan, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)

    expect(details?.table).toBe(1)
    expect(details?.score?.preferredAtTable).toBe(1)
  })

  it('lists every companion with the table they sit at and who they come along through', () => {
    const rows = guestDetails(
      MACIEK.id,
      plan,
      MACIEK_FAMILY_GUESTS,
      MACIEK_FAMILY_OVERVIEW,
    )?.companions

    expect(
      rows?.map((row) => [row.guest.id, row.level, row.via?.id, row.place, row.sameTable]),
    ).toEqual([
      [KAROLINA.id, 0, undefined, 1, true],
      [MICHAL.id, 1, undefined, 2, false],
      [OLA.id, 1, MICHAL.id, 2, false],
    ])
  })

  it('tells unseated and disabled companions apart from seated ones', () => {
    const disabledOla = makeGuest({ ...OLA, enabled: false })
    const guests = [MACIEK, KAROLINA, MICHAL, disabledOla]
    const loose = {
      ...makePlan([{ number: 1, clusters: [placement(4, [4, 5])] }], [placement(6, [6])]),
      guestScores: [],
    }

    const rows = guestDetails(MACIEK.id, loose, guests, MACIEK_FAMILY_OVERVIEW)?.companions
    expect(rows?.map((row) => [row.guest.id, row.place])).toEqual([
      [KAROLINA.id, 1],
      [MICHAL.id, 'unseated'],
      [OLA.id, 'disabled'],
    ])
  })

  it('is undefined for an unknown guest', () => {
    expect(guestDetails(99, plan, MACIEK_FAMILY_GUESTS, MACIEK_FAMILY_OVERVIEW)).toBeUndefined()
  })

  it('reports a disabled guest as not part of the plan', () => {
    const guests = [makeGuest({ ...MACIEK, enabled: false }), KAROLINA]
    const details = guestDetails(MACIEK.id, plan, guests, MACIEK_FAMILY_OVERVIEW)
    expect(details?.table).toBe('disabled')
  })
})
