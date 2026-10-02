import { TriangleAlertIcon } from 'lucide-react'
import { violationLabel } from '@/domain/labels'
import type { Violation } from '@/domain/types'
import { GenerateButton } from '@/features/plans/GenerateButton'

const SHOWN = 2

type RecalculationBannerProps = {
  violations: Violation[]
  onGenerated?: () => void
}

/**
 * The call to action of a plan that breaks a rule (a re-enabled guest overfilling a table, a new
 * guest without a table, ...). Never regenerates on its own: it says what is wrong and lets the
 * editor decide (A-17). The reasons are the server's violations, in Polish.
 */
export function RecalculationBanner({ violations, onGenerated }: RecalculationBannerProps) {
  const shown = violations.slice(0, SHOWN)
  const more = violations.length - shown.length
  return (
    <div
      role="status"
      className="space-y-2 rounded-lg border border-brick/50 bg-brick/8 p-3 text-sm"
    >
      <p className="flex items-center gap-2 font-semibold text-brick">
        <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
        Wymaga przeliczenia
      </p>
      {shown.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5">
          {shown.map((violation, index) => (
            <li key={index}>{violationLabel(violation)}</li>
          ))}
          {more > 0 && <li>i jeszcze {more}</li>}
        </ul>
      )}
      <GenerateButton label="Przelicz / Generuj" onGenerated={onGenerated} />
    </div>
  )
}
