import { CheckIcon, TriangleAlertIcon } from 'lucide-react'
import { TableGlyph } from '@/components/TableGlyph'
import { Button } from '@/components/ui/button'
import { violationLabel } from '@/domain/labels'
import type { Proposal, Scenario } from '@/domain/types'
import { FillBars } from '@/features/plans/FillBars'
import { GenerateButton } from '@/features/plans/GenerateButton'
import { PlanFigures } from '@/features/plans/PlanFigures'

type ProposalCardProps = {
  proposal: Proposal
  /** The stored plan it would replace, for the "obecnie" comparison. */
  current: Scenario | undefined
  /** The stored plan changed after Generate: accepting would be refused (409). */
  stale: boolean
  busy: boolean
  onAccept: () => void
}

export function ProposalCard({ proposal, current, stale, busy, onAccept }: ProposalCardProps) {
  const { capacity, plan } = proposal
  return (
    <article
      aria-label={`Propozycja na ${capacity} miejsc`}
      className="flex h-full flex-col gap-4 rounded-xl border-2 border-dashed border-brass bg-card p-4"
    >
      <header className="flex items-center gap-3">
        <TableGlyph seats={capacity} className="size-16 shrink-0 text-ink" />
        <div>
          <h3 className="font-display text-2xl leading-tight font-semibold">{capacity} miejsc</h3>
          <p className="text-sm font-medium text-brass-ink">Propozycja, jeszcze niezapisana</p>
        </div>
      </header>

      <PlanFigures summary={plan.summary} current={current?.plan.summary} />
      <FillBars plan={plan} capacity={capacity} />

      {plan.violations.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-brick/50 bg-brick/8 p-3 text-sm">
          {plan.violations.slice(0, 3).map((violation, index) => (
            <li key={index} className="flex items-start gap-2">
              <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brick" />
              {violationLabel(violation)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-2">
        {stale && (
          <p role="alert" className="text-sm font-medium text-brick">
            Plan na {capacity} miejsc zmienił się po wygenerowaniu tej propozycji.
          </p>
        )}
        {stale ? (
          <GenerateButton label="Generuj ponownie" variant="outline" />
        ) : (
          <Button type="button" className="w-full" disabled={busy} onClick={onAccept}>
            <CheckIcon aria-hidden="true" />
            Akceptuj <span className="sr-only">propozycję na {capacity} miejsc</span>
          </Button>
        )}
      </div>
    </article>
  )
}
