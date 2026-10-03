import { Link } from 'react-router'
import { CAPACITIES, type Capacity } from '@/domain/capacity'
import { tableCountLabel } from '@/domain/labels'
import type { Scenario } from '@/domain/types'
import { cn } from '@/lib/utils'

type PlanSwitcherProps = { current: Capacity; scenarios: Scenario[] }

/** Quick switch between the 9 / 10 / 11 / 12-seat plans, each with its table count. */
export function PlanSwitcher({ current, scenarios }: PlanSwitcherProps) {
  return (
    <nav aria-label="Przełącz plan" className="flex gap-1 rounded-lg bg-secondary p-1">
      {CAPACITIES.map((capacity) => {
        const tables = scenarios.find((scenario) => scenario.capacity === capacity)?.plan.summary
          .tableCount
        const active = capacity === current
        return (
          <Link
            key={capacity}
            to={`/plany/${capacity}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex-1 rounded-md px-2 py-1.5 text-center text-sm leading-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-3',
              active
                ? 'bg-card font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="block">{capacity} miejsc</span>
            {tables !== undefined && (
              <span className="block text-xs">{tableCountLabel(tables)}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
