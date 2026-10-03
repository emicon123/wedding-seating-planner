import { Link } from 'react-router'
import { tableCountLabel } from '@/domain/labels'
import { PLAN_KEYS, planName } from '@/domain/plans'
import type { PlanKey, Scenario } from '@/domain/types'
import { cn } from '@/lib/utils'

type PlanSwitcherProps = { current: PlanKey; scenarios: Scenario[] }

/**
 * Quick switch between the five plans (9 / 10 / 11 / 12 seats and "Mieszany"), each with its table
 * count. On a phone it scrolls inside its own box, never the page.
 */
export function PlanSwitcher({ current, scenarios }: PlanSwitcherProps) {
  return (
    <nav
      aria-label="Przełącz plan"
      className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-secondary p-1"
    >
      {PLAN_KEYS.map((key) => {
        const tables = scenarios.find((scenario) => scenario.key === key)?.plan.summary.tableCount
        const active = key === current
        return (
          <Link
            key={key}
            to={`/plany/${key}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'min-w-20 flex-1 rounded-md px-2 py-1.5 text-center text-sm leading-tight whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-3',
              active
                ? 'bg-card font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="block">{planName(key)}</span>
            {tables !== undefined && (
              <span className="block text-xs">{tableCountLabel(tables)}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
