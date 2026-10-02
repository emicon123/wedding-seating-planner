import { cn } from '@/lib/utils'

const VIEW = 100
const CENTER = VIEW / 2
const TABLE_RADIUS = 27
const SEAT_ORBIT = 38
const SEAT_RADIUS = 6

type TableGlyphProps = {
  seats: number
  className?: string
}

/** A round table with `seats` seats around it: the app's brand mark and plan-tile illustration. */
export function TableGlyph({ seats, className }: TableGlyphProps) {
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" className={cn('size-12', className)}>
      <circle
        cx={CENTER}
        cy={CENTER}
        r={TABLE_RADIUS}
        className="fill-card stroke-current"
        strokeWidth={4}
      />
      {Array.from({ length: seats }, (_, index) => {
        const angle = (index / seats) * 2 * Math.PI - Math.PI / 2
        return (
          <circle
            key={index}
            cx={CENTER + SEAT_ORBIT * Math.cos(angle)}
            cy={CENTER + SEAT_ORBIT * Math.sin(angle)}
            r={SEAT_RADIUS}
            className="fill-brass"
          />
        )
      })}
    </svg>
  )
}
