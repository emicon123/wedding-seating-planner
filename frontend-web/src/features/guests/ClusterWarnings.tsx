import { TriangleAlertIcon } from 'lucide-react'
import { warningLabel } from '@/domain/labels'
import type { DataWarning } from '@/domain/types'

const MAX_NAMES = 6

type ClusterWarningsProps = {
  warnings: DataWarning[]
  nameOf: (guestId: number) => string
  /** With a handler the names are buttons (page banner); without, plain text (inside the editor). */
  onOpenGuest?: (guestId: number) => void
}

/** Data warnings from the clusters overview, each with the guests involved (icon + text, never colour alone). */
export function ClusterWarnings({ warnings, nameOf, onOpenGuest }: ClusterWarningsProps) {
  if (warnings.length === 0) return null
  return (
    <ul className="space-y-2" aria-label="Uwagi do danych">
      {warnings.map((warning, position) => {
        const shown = warning.guestIds.slice(0, MAX_NAMES)
        const hidden = warning.guestIds.length - shown.length
        return (
          <li
            key={`${warning.code}-${position}`}
            className="flex gap-2 rounded-lg border border-brick/40 bg-brick/8 p-3 text-sm"
          >
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brick" />
            <div className="space-y-1">
              <p className="font-medium">{warningLabel(warning)}</p>
              <p className="flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground">
                <span>Dotyczy:</span>
                {shown.map((guestId) =>
                  onOpenGuest ? (
                    <button
                      key={guestId}
                      type="button"
                      onClick={() => onOpenGuest(guestId)}
                      className="rounded font-medium text-foreground underline decoration-dotted underline-offset-2 outline-none hover:decoration-solid focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {nameOf(guestId)}
                    </button>
                  ) : (
                    <span key={guestId} className="font-medium text-foreground">
                      {nameOf(guestId)}
                    </span>
                  ),
                )}
                {hidden > 0 && <span>i {hidden} więcej</span>}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
