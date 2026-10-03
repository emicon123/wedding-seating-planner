import { render } from '@testing-library/react'
import { TableSeats } from '@/features/plans/TableSeats'

const CENTER = 60

/** Angles (degrees, 0-360) of the seat circles around the table, in drawing order. */
function seatAngles(container: HTMLElement): number[] {
  const seats = [...container.querySelectorAll('circle')].slice(1) // the first circle is the table
  return seats.map((seat) => {
    const dx = Number(seat.getAttribute('cx')) - CENTER
    const dy = Number(seat.getAttribute('cy')) - CENTER
    return (((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + (dy < 0 ? 360 : 0)
  })
}

describe('TableSeats: seats spread evenly for any count, odd ones included', () => {
  it.each([9, 10, 11, 12])('%i seats are 360 / %i degrees apart', (capacity) => {
    const { container } = render(
      <TableSeats number={1} capacity={capacity} clusterSizes={[3]} status="ok" />,
    )

    const angles = seatAngles(container)
    expect(angles).toHaveLength(capacity)
    const step = 360 / capacity
    angles.forEach((angle, index) => {
      const expected = (270 + index * step) % 360 // the first seat sits at the top
      expect(Math.abs(angle - expected)).toBeLessThan(0.01)
    })
  })

  it('seats beyond an odd capacity fall between the regular seats, outside the ring', () => {
    const { container } = render(
      <TableSeats number={2} capacity={11} clusterSizes={[12]} status="over" />,
    )

    const angles = seatAngles(container)
    expect(angles).toHaveLength(12)
    const extra = angles[11]!
    const gap = 360 / 11
    const offset = (extra - 270 + 360) % gap
    expect(Math.abs(offset - gap / 2)).toBeLessThan(0.01)
  })
})
