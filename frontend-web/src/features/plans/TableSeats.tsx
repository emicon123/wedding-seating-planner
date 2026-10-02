import { cn } from '@/lib/utils'
import type { FillStatus } from '@/domain/tableStatus'

const VIEW = 120
const CENTER = VIEW / 2
const TABLE_RADIUS = 24
const SEAT_ORBIT = 40
const OVERFLOW_ORBIT = 51
const SEAT_RADIUS = 6.5

type Point = { x: number; y: number }

function onOrbit(angle: number, orbit: number): Point {
  return { x: CENTER + orbit * Math.cos(angle), y: CENTER + orbit * Math.sin(angle) }
}

type Seat = Point & { taken: boolean; extra: boolean; bound: boolean }

type TableSeatsProps = {
  number: number
  capacity: number
  /** Seats taken by each cluster at this table, in display order. */
  clusterSizes: number[]
  status: FillStatus
  className?: string
}

/**
 * A round table seen from above with its seats: taken seats filled, free ones hollow, seats
 * beyond the capacity drawn outside the ring in red. Seats of one paczka (group 0) are filled
 * wine and joined by a bar, so "these sit together" can be seen from across the room.
 */
export function TableSeats({ number, capacity, clusterSizes, status, className }: TableSeatsProps) {
  const fill = clusterSizes.reduce((sum, size) => sum + size, 0)
  const total = Math.max(capacity, fill)

  const seats: Seat[] = Array.from({ length: total }, (_, index) => {
    const extra = index >= capacity
    const angle = extra
      ? ((index - capacity + 0.5) / capacity) * 2 * Math.PI - Math.PI / 2
      : (index / capacity) * 2 * Math.PI - Math.PI / 2
    return {
      ...onOrbit(angle, extra ? OVERFLOW_ORBIT : SEAT_ORBIT),
      taken: index < fill,
      extra,
      bound: false,
    }
  })

  // seats are handed out cluster by cluster; mark the bound ones and remember the bars
  const bars: [Seat, Seat][] = []
  let next = 0
  for (const size of clusterSizes) {
    for (let offset = 0; offset < size; offset++) {
      const seat = seats[next + offset]
      if (seat && size > 1) seat.bound = true
      const following = seats[next + offset + 1]
      if (seat && following && offset < size - 1 && !seat.extra && !following.extra) {
        bars.push([seat, following])
      }
    }
    next += size
  }

  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" className={cn('size-24', className)}>
      {bars.map(([a, b], index) => (
        <line
          key={index}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          className="stroke-group-0"
          strokeWidth={4}
          strokeLinecap="round"
        />
      ))}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={TABLE_RADIUS}
        className={cn(
          'fill-card',
          status === 'ok' ? 'stroke-ink' : 'stroke-brick',
          status === 'under' && '[stroke-dasharray:4_3]',
        )}
        strokeWidth={2.5}
      />
      <text
        x={CENTER}
        y={CENTER}
        textAnchor="middle"
        dominantBaseline="central"
        className={cn(
          'font-display text-[26px] font-semibold',
          status === 'ok' ? 'fill-ink' : 'fill-brick',
        )}
      >
        {number}
      </text>
      {seats.map((seat, index) => (
        <circle
          key={index}
          cx={seat.x}
          cy={seat.y}
          r={SEAT_RADIUS}
          strokeWidth={1.5}
          className={cn(
            seat.extra
              ? 'fill-brick stroke-white'
              : seat.taken
                ? seat.bound
                  ? 'fill-group-0 stroke-group-0'
                  : 'fill-ink stroke-ink'
                : 'fill-card stroke-ink/40',
          )}
        />
      ))}
    </svg>
  )
}
