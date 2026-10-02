import { ArrowRightIcon } from 'lucide-react'
import { Link } from 'react-router'
import { TableGlyph } from '@/components/TableGlyph'
import { buttonVariants } from '@/components/ui/button'
import type { Scenario } from '@/domain/types'
import { FillBars } from '@/features/plans/FillBars'
import { PlanFigures } from '@/features/plans/PlanFigures'
import { RecalculationBanner } from '@/features/plans/RecalculationBanner'
import { cn } from '@/lib/utils'

/** One stored plan on the compare screen: figures, fill bars, the recalculation call to action. */
export function PlanCard({ scenario }: { scenario: Scenario }) {
  const { capacity, plan } = scenario
  return (
    <article
      aria-label={`Plan na ${capacity} miejsc`}
      className={cn(
        'flex h-full flex-col gap-4 rounded-xl border bg-card p-4',
        plan.summary.needsRecalculation && 'border-brick/50',
      )}
    >
      <header className="flex items-center gap-3">
        <TableGlyph seats={capacity} className="size-16 shrink-0 text-ink" />
        <div>
          <h3 className="font-display text-2xl leading-tight font-semibold">{capacity} miejsc</h3>
          <p className="text-sm text-muted-foreground">Stoły {capacity}-osobowe</p>
        </div>
      </header>

      <PlanFigures summary={plan.summary} />
      <FillBars plan={plan} capacity={capacity} />

      {plan.summary.needsRecalculation && <RecalculationBanner violations={plan.violations} />}

      <Link
        to={`/plany/${capacity}`}
        className={cn(buttonVariants({ variant: 'outline' }), 'mt-auto w-full')}
      >
        Otwórz plan <span className="sr-only">na {capacity} miejsc</span>
        <ArrowRightIcon aria-hidden="true" />
      </Link>
    </article>
  )
}
