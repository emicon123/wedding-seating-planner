import { ChevronDownIcon, CircleCheckIcon, TriangleAlertIcon, UsersRoundIcon } from 'lucide-react'
import { useId, useState } from 'react'
import type { FamilyReach } from '@/domain/acquaintance'
import { FLOOR } from '@/domain/plans'
import {
  knownPeopleLabel,
  MISSING_LINKS_ALL_OK,
  MISSING_LINKS_HELP,
  MISSING_LINKS_MIXED_NOTE,
  missingLinksSummary,
  REACH_ALONE,
  REACH_NONE_BADGE,
  reachLabel,
  reachPartialBadge,
  reachWithLabel,
  restOkLabel,
} from '@/domain/labels'
import { cn } from '@/lib/utils'

const SHOWN_NAMES = 3

type MissingLinksSectionProps = {
  /** One entry per family, worst first (`familyReach`). */
  reaches: readonly FamilyReach[]
  nameOf: (guestId: number) => string
  onOpenLinks: (guestId: number) => void
}

function familyNames(row: FamilyReach, nameOf: (guestId: number) => string): string {
  const shown = row.memberIds.slice(0, SHOWN_NAMES).map(nameOf).join(', ')
  const more = row.memberIds.length - SHOWN_NAMES
  return more > 0 ? `${shown} +${more}` : shown
}

function ReachBadge({ row }: { row: FamilyReach }) {
  const none = row.status === 'none'
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold',
        none ? 'border-brick/60 bg-brick/10 text-brick' : 'border-ochre/70 bg-ochre/15',
      )}
    >
      <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
      {none ? REACH_NONE_BADGE : reachPartialBadge(row.reach)}
    </span>
  )
}

function FamilyRow({
  row,
  nameOf,
  onOpenLinks,
}: { row: FamilyReach } & Pick<MissingLinksSectionProps, 'nameOf' | 'onOpenLinks'>) {
  const first = row.memberIds[0]
  const together = row.groupGuestIds.map(nameOf).join(', ')
  return (
    <li className="space-y-1 rounded-lg border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {first === undefined ? null : (
          <button
            type="button"
            onClick={() => onOpenLinks(first)}
            className="rounded text-left font-medium underline decoration-dotted underline-offset-2 outline-none hover:decoration-solid focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {familyNames(row, nameOf)}
          </button>
        )}
        <span className="flex flex-wrap gap-x-3 text-muted-foreground">
          <span>{knownPeopleLabel(row.knownPeople)}</span>
          <span>{reachLabel(row.reach)}</span>
        </span>
      </div>
      <ReachBadge row={row} />
      {row.reach === FLOOR && (
        <p className="text-xs text-muted-foreground">{MISSING_LINKS_MIXED_NOTE}</p>
      )}
      <p className="text-muted-foreground">
        {row.groupKeys.length === 0 ? REACH_ALONE : reachWithLabel(together)}
      </p>
    </li>
  )
}

/**
 * "Braki powiązań" (task 015): which families cannot sit with acquaintances only, and what to
 * add. A collapsible section under the data warnings; collapsed by default, its header always
 * shows the counts. The data comes from `familyReach` over the whole enabled list, so it does not
 * follow the page's search or filters.
 */
export function MissingLinksSection({ reaches, nameOf, onOpenLinks }: MissingLinksSectionProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  if (reaches.length === 0) return null

  const none = reaches.filter((row) => row.status === 'none')
  const partial = reaches.filter((row) => row.status === 'partial')
  const problems = [...none, ...partial]
  const rest = reaches.length - problems.length

  if (problems.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0 text-sage" />
        {MISSING_LINKS_ALL_OK}
      </p>
    )
  }

  return (
    <section className="rounded-xl border border-ochre/60 bg-card" aria-label="Braki powiązań">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <UsersRoundIcon aria-hidden="true" className="size-4 shrink-0" />
        <span>{missingLinksSummary(none.length, partial.length)}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn('ml-auto size-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={panelId} className="space-y-3 px-3 pb-3">
          <p className="px-1 text-sm text-muted-foreground">{MISSING_LINKS_HELP}</p>
          <ul className="space-y-2">
            {problems.map((row) => (
              <FamilyRow key={row.clusterKey} row={row} nameOf={nameOf} onOpenLinks={onOpenLinks} />
            ))}
          </ul>
          {rest > 0 && <p className="px-1 text-sm text-muted-foreground">{restOkLabel(rest)}</p>}
        </div>
      )}
    </section>
  )
}
