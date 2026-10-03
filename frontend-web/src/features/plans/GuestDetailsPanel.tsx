import { CheckIcon, MapPinIcon, UserXIcon, XIcon } from 'lucide-react'
import { GroupMark } from '@/components/GroupMark'
import { Button } from '@/components/ui/button'
import type { CompanionRow, GuestDetails } from '@/domain/guestDetails'
import { isIsolated } from '@/domain/isolation'
import { ISOLATED_HINT, ISOLATED_LABEL, peopleLabel, placeLabel, viaLabel } from '@/domain/labels'
import type { LinkLevel } from '@/domain/types'
import { cn } from '@/lib/utils'

const LEVELS: LinkLevel[] = [0, 1, 2]

type GuestDetailsPanelProps = {
  details: GuestDetails
  /** Server satisfaction numbers are stale while a save is in flight. */
  settled: boolean
  onClose: () => void
  onSelectGuest: (guestId: number) => void
  onShowTable: (tableNumber: number) => void
}

function Dots({ filled, total }: { filled: number; total: number }) {
  return (
    <span aria-hidden="true" className="flex flex-wrap gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            'size-2.5 rounded-full border-2 border-group-1',
            index < filled && 'bg-group-1',
          )}
        />
      ))}
    </span>
  )
}

function Satisfaction({ details }: { details: GuestDetails }) {
  const { score } = details
  if (!score) return null
  return (
    <div className="space-y-1.5 rounded-lg border bg-background p-2.5 text-sm">
      {isIsolated(score) && (
        <p className="flex items-start gap-1.5 font-semibold text-brick">
          <UserXIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {ISOLATED_LABEL} — {ISOLATED_HINT}.
          </span>
        </p>
      )}
      {score.preferredTotal > 0 ? (
        <>
          <p className="font-semibold">
            Przy stole {score.preferredAtTable} z {score.preferredTotal} preferowanych osób
          </p>
          <Dots filled={score.preferredAtTable} total={score.preferredTotal} />
        </>
      ) : (
        <p className="text-muted-foreground">Ten gość nie ma preferowanych osób (grupa 1).</p>
      )}
      {score.fallbackAtTable > 0 && (
        <p>
          Z grupy 2 przy stole: {score.fallbackAtTable}{' '}
          <span className="text-muted-foreground">(tylko awaryjnie)</span>
        </p>
      )}
      <p className="text-muted-foreground">Obcych przy stole: {score.strangersAtTable}</p>
    </div>
  )
}

function CompanionItem({
  row,
  onSelect,
}: {
  row: CompanionRow
  onSelect: (guestId: number) => void
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <button
        type="button"
        onClick={() => onSelect(row.guest.id)}
        className="rounded font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {row.guest.displayName}
      </button>
      <span className="text-muted-foreground">{placeLabel(row.place)}</span>
      {row.sameTable && (
        <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-sage">
          <CheckIcon aria-hidden="true" className="size-3.5" />
          przy tym samym stole
        </span>
      )}
      {row.via && row.viaReason && (
        <span className="text-xs text-muted-foreground">
          ({viaLabel(row.viaReason, row.via.displayName)})
        </span>
      )}
    </li>
  )
}

/**
 * Where one guest sits and how happy they are there (UC-14, UC-16): the server's satisfaction
 * numbers and where each companion of group 0 / 1 / 2 sits, including who brings whom along.
 */
export function GuestDetailsPanel({
  details,
  settled,
  onClose,
  onSelectGuest,
  onShowTable,
}: GuestDetailsPanelProps) {
  const { guest, table } = details
  return (
    <section
      aria-label={`Szczegóły: ${guest.displayName}`}
      className="space-y-3 rounded-xl border-2 border-brass bg-card p-3"
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl leading-tight font-semibold">{guest.displayName}</h2>
          <p className="text-sm text-muted-foreground">
            {typeof table === 'number' && `Siedzi przy stole ${table}`}
            {table === 'unseated' && 'Nie ma jeszcze stołu'}
            {table === 'disabled' && 'Wyłączony: nie ma go w tym planie'}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose}>
          <XIcon aria-hidden="true" />
          <span className="sr-only">Zamknij szczegóły</span>
        </Button>
      </header>

      {typeof table === 'number' && (
        <Button type="button" variant="outline" size="sm" onClick={() => onShowTable(table)}>
          <MapPinIcon aria-hidden="true" />
          Pokaż stół {table}
        </Button>
      )}

      {settled ? (
        <Satisfaction details={details} />
      ) : (
        <p className="text-sm text-muted-foreground">Przeliczam zadowolenie…</p>
      )}

      {LEVELS.map((level) => {
        const rows = details.companions.filter((row) => row.level === level)
        if (rows.length === 0) return null
        return (
          <div key={level} className="space-y-1">
            <h3 className="font-sans text-sm font-semibold">
              <GroupMark level={level} />{' '}
              <span className="font-normal text-muted-foreground">
                {level === 0 && 'siedzą razem'}
                {level === 1 && 'preferowani'}
                {level === 2 && 'awaryjnie'} · {peopleLabel(rows.length)}
              </span>
            </h3>
            <ul className="space-y-0.5">
              {rows.map((row) => (
                <CompanionItem key={row.guest.id} row={row} onSelect={onSelectGuest} />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
