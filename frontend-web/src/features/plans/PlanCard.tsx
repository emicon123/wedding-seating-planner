import { ArrowRightIcon } from 'lucide-react'
import { Link } from 'react-router'
import { TableGlyph } from '@/components/TableGlyph'
import { buttonVariants } from '@/components/ui/button'
import { isolatedCount } from '@/domain/isolation'
import { EXTRA_TABLE_NOTE } from '@/domain/labels'
import { isMixed, planHeading, planName } from '@/domain/plans'
import type { PlanKey, Scenario } from '@/domain/types'
import { DeletePlanButton } from '@/features/plans/DeletePlanButton'
import { FillBars } from '@/features/plans/FillBars'
import { PlanFigures } from '@/features/plans/PlanFigures'
import { RecalculationBanner } from '@/features/plans/RecalculationBanner'
import { TablesNeededLine } from '@/features/plans/TablesNeededLine'
import { cn } from '@/lib/utils'

const extraTableNote = (scenario: Scenario, twelve: Scenario | undefined): string | null => {
  if (!twelve || !isMixed(scenario)) return null
  const mixedIsolated = isolatedCount(scenario.plan.guestScores)
  const twelveIsolated = isolatedCount(twelve.plan.guestScores)
  const oneMoreTable = scenario.plan.summary.tableCount === twelve.plan.summary.tableCount + 1
  return oneMoreTable && mixedIsolated < twelveIsolated
    ? EXTRA_TABLE_NOTE(mixedIsolated, twelveIsolated)
    : null
}

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
          <p className="text-sm text-muted-foreground">Stoły 9–12-osobowe</p>
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
  twelve,
  onDelete,
}: {
  scenario: Scenario
  /** The 12-seat plan, for the mixed card's "1 stół więcej" note. */
  twelve?: Scenario
  onDelete: (key: PlanKey) => void
}) {
  const { key, capacity, plan } = scenario
  const empty = plan.summary.tableCount === 0
  const note = extraTableNote(scenario, twelve)
  return (
    <article
      aria-label={planHeading(key)}
      className={cn(
        'flex h-full flex-col gap-4 rounded-xl border bg-card p-4',
        plan.summary.needsRecalculation && 'border-brick/50',
      )}
    >
      <PlanCardHeader scenario={scenario} />

      <PlanFigures summary={plan.summary} isolated={isolatedCount(plan.guestScores)} />
      <TablesNeededLine scenario={scenario} />
      {note && (
        <p className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          {note}
        </p>
      )}
      <FillBars plan={plan} capacity={capacity} />

      {plan.summary.needsRecalculation && <RecalculationBanner violations={plan.violations} />}

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
