import { useId } from 'react'
import { fillStatus } from '@/domain/tableStatus'
import type { Capacity, SeatingPlan } from '@/domain/types'

const SLOT = 26
const BAR = 19
const HEIGHT = 56
const LABEL_ROOM = 16
const SVG_HEIGHT = HEIGHT + LABEL_ROOM + 10

type FillBarsProps = { plan: SeatingPlan; capacity: Capacity; floor: number }

/**
 * One bar per table, as tall as the table is full. Rule breaks are drawn, not just coloured:
 * an over-full table gets a hatched, full bar with a "!" above it; an under-floor table a
 * dashed outline. The dashed line across is the floor (`floor` guests: 8, or 9 in the mixed plan). The numbers are the fills.
 */
export function FillBars({ plan, capacity, floor }: FillBarsProps) {
  const hatchId = useId()
  const count = plan.tables.length
  if (count === 0) {
    return <p className="text-sm text-muted-foreground">Brak stołów w tym planie.</p>
  }

  const width = count * SLOT - (SLOT - BAR)
  const floorY = SVG_HEIGHT - LABEL_ROOM - (Math.min(floor, capacity) / capacity) * HEIGHT
  const summary = plan.tables.map((table) => table.fill).join(', ')

  return (
    <svg
      role="img"
      aria-label={`Obłożenie stołów (z ${capacity} miejsc): ${summary}`}
      viewBox={`0 0 ${width} ${SVG_HEIGHT}`}
      width={width}
      height={SVG_HEIGHT}
      className="h-auto max-w-full text-ink"
    >
      <defs>
        <pattern
          id={hatchId}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" className="fill-brick" />
          <rect width="2" height="4" className="fill-white/55" />
        </pattern>
      </defs>
      {plan.tables.length > 1 && (
        <line
          x1={0}
          x2={width}
          y1={floorY}
          y2={floorY}
          className="stroke-ink-soft"
          strokeWidth={0.75}
          strokeDasharray="2 2"
        />
      )}
      {plan.tables.map((table, index) => {
        const status = fillStatus(table.fill, capacity, count, floor)
        const x = index * SLOT
        const bottom = SVG_HEIGHT - LABEL_ROOM
        const barHeight = Math.max(Math.min(table.fill / capacity, 1) * HEIGHT, 1.5)
        return (
          <g key={table.number}>
            <rect
              x={x}
              y={bottom - HEIGHT}
              width={BAR}
              height={HEIGHT}
              rx={2}
              className="fill-paper-deep"
            />
            <rect
              x={x}
              y={bottom - barHeight}
              width={BAR}
              height={barHeight}
              rx={2}
              className={
                status === 'over'
                  ? undefined
                  : status === 'under'
                    ? 'fill-brick/25 stroke-brick'
                    : 'fill-ink/80'
              }
              fill={status === 'over' ? `url(#${hatchId})` : undefined}
              strokeDasharray={status === 'under' ? '2 1.5' : undefined}
              strokeWidth={status === 'under' ? 1 : undefined}
            />
            {status === 'over' && (
              <text
                x={x + BAR / 2}
                y={bottom - HEIGHT - 2}
                textAnchor="middle"
                className="fill-brick text-[10px] font-bold"
              >
                !
              </text>
            )}
            <text
              x={x + BAR / 2}
              y={SVG_HEIGHT - 2}
              textAnchor="middle"
              className={
                status === 'ok' ? 'fill-ink-soft text-[11px]' : 'fill-brick text-[11px] font-bold'
              }
            >
              {table.fill}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
