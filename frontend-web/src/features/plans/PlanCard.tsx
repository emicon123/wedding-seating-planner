import { ArrowRightIcon } from 'lucide-react'
import { Link } from 'react-router'
import { TableGlyph } from '@/components/TableGlyph'
import { buttonVariants } from '@/components/ui/button'
import { isolatedCount } from '@/domain/isolation'
import { MIXED_PLAN_SUBLINE } from '@/domain/labels'
import { isMixed, minTableFill, planHeading, planName } from '@/domain/plans'
import { bilans, strangerPairs } from '@/domain/strangers'
import type { PlanKey, Scenario } from '@/domain/types'
import { DeletePlanButton } from '@/features/plans/DeletePlanButton'
import { FillBars } from '@/features/plans/FillBars'
import { PlanFigures } from '@/features/plans/PlanFigures'
import { RecalculationBanner } from '@/features/plans/RecalculationBanner'
import { TablesNeededLine } from '@/features/plans/TablesNeededLine'
import { cn } from '@/lib/utils'

function PlanCardHeader({ scenario }: { scenario: Scenario }) {
  const { key, capacity } = scenario
  if (isMixed(scenario)) {
    return (
      <header className="flex items-center gap-3">
        <span className="relative size-16 shrink-0" aria-hidden="true">
          <TableGlyph seats={12} className="absolute top-0 left-0 size-14 text-ink" />
          <TableGlyph seats={9} className="absolute right-0 bottom-0 size-9 text-ink" />
        </span>
        <div>
          <h3 className="font-display text-2xl leading-tight font-semibold">{planName(key)}</h3>
          <p className="text-sm text-muted-foreground">{MIXED_PLAN_SUBLINE}</p>
        </div>
      </header>
    )
  }
  return (
    <header className="flex items-center gap-3">
      <TableGlyph seats={capacity} className="size-16 shrink-0 text-ink" />
      <div>
        <h3 className="font-display text-2xl leading-tight font-semibold">{planName(key)}</h3>
        <p className="text-sm text-muted-foreground">Stoły {capacity}-osobowe</p>
      </div>
    </header>
  )
}

/** One stored plan on the compare screen: figures, fill bars, the recalculation call to action. */
export function PlanCard({
  scenario,
  onDelete,
}: {
  scenario: Scenario
  onDelete: (key: PlanKey) => void
}) {
  const { key, capacity, plan } = scenario
  const empty = plan.summary.tableCount === 0
  const floor = minTableFill(scenario)
  return (
    <article
      aria-label={planHeading(key)}
      className={cn(
        'flex h-full flex-col gap-4 rounded-xl border bg-card p-4',
        plan.summary.needsRecalculation && 'border-brick/50',
      )}
    >
      <PlanCardHeader scenario={scenario} />

      <PlanFigures
        summary={plan.summary}
        isolated={isolatedCount(plan.guestScores)}
        strangerPairs={strangerPairs(plan.guestScores)}
        bilans={bilans(plan)}
        bilansEmphasised={isMixed(scenario)}
      />
      <TablesNeededLine scenario={scenario} />
      <FillBars plan={plan} capacity={capacity} floor={floor} />

      {plan.summary.needsRecalculation && (
        <RecalculationBanner violations={plan.violations} floor={floor} />
      )}

      <div className="mt-auto flex gap-2">
        <Link to={`/plany/${key}`} className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}>
          Otwórz plan{' '}
          <span className="sr-only">{key === 'mixed' ? 'mieszany' : `na ${key} miejsc`}</span>
          <ArrowRightIcon aria-hidden="true" />
        </Link>
        <DeletePlanButton empty={empty} onClick={() => onDelete(key)} />
      </div>
    </article>
  )
}
