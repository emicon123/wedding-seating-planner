import {
  BabyIcon,
  EyeOffIcon,
  Link2Icon,
  PencilIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { memo } from 'react'
import { GroupMark } from '@/components/GroupMark'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import type { RelationSummary } from '@/domain/relations'
import type { Guest, LinkLevel } from '@/domain/types'
import { cn } from '@/lib/utils'

const MAX_PARTNER_CHIPS = 3

export type GuestRowProps = {
  guest: Guest
  selected: boolean
  /** The clusters overview raised a data warning involving this guest. */
  warned: boolean
  /** Who is connected to this guest, derived from the cluster overview (see `summariseRelations`). */
  relations: RelationSummary | undefined
  /** With "powiązani z …" on: how this row relates to the chosen person (null = the person). */
  relationLevel?: LinkLevel | null
  onSelect: (guestId: number, selected: boolean) => void
  onToggle: (guestId: number, enabled: boolean) => void
  onOpenLinks: (guestId: number) => void
  onEdit: (guestId: number) => void
  onDelete: (guestId: number) => void
}

/** The tooltip text of the relation strip: every name per group (the panel shows the reasons). */
function relationsTitle(relations: RelationSummary): string {
  const lines = ([0, 1, 2] as const)
    .filter((level) => relations.counts[level] > 0)
    .map((level) => `Grupa ${level}: ${relations.names[level].join(', ')}`)
  return lines.join('\n')
}

/**
 * Names, not just numbers: the group-0 partners as chips (the whole cluster, not only the
 * stored links), then counts for group 1 and 2. The mark shows the group by colour, outline and
 * icon; the text says it too.
 */
function RelationStrip({
  guest,
  relations,
}: {
  guest: Guest
  relations: RelationSummary | undefined
}) {
  const empty = !relations || relations.counts[0] + relations.counts[1] + relations.counts[2] === 0
  if (empty) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <Link2Icon aria-hidden="true" className="size-3.5" />
        Dodaj powiązania
      </span>
    )
  }
  const shown = relations.partners.slice(0, MAX_PARTNER_CHIPS)
  const hidden = relations.partners.length - shown.length
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-guest={guest.id}>
      {shown.map((partner) => (
        <GroupMark key={partner} level={0} text={partner} className="max-w-40 truncate" />
      ))}
      {hidden > 0 && <GroupMark level={0} text={`+${hidden}`} />}
      {relations.counts[1] > 0 && <GroupMark level={1} count={relations.counts[1]} />}
      {relations.counts[2] > 0 && <GroupMark level={2} count={relations.counts[2]} />}
    </span>
  )
}

/** One guest: select, enable switch, name with markers, links, edit, delete. Memoised: 100 rows must stay cheap. */
export const GuestRow = memo(function GuestRow({
  guest,
  selected,
  warned,
  relations,
  relationLevel,
  onSelect,
  onToggle,
  onOpenLinks,
  onEdit,
  onDelete,
}: GuestRowProps) {
  const name = guest.displayName
  return (
    <li
      data-enabled={guest.enabled}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0 sm:flex-nowrap',
        guest.enabled ? 'bg-card' : 'bg-muted/70',
        selected && 'bg-accent',
        relationLevel === null && 'border-l-4 border-l-ink',
      )}
    >
      <div className="flex shrink-0 items-center gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelect(guest.id, checked === true)}
          aria-label={`Zaznacz: ${name}`}
        />
        <Switch
          checked={guest.enabled}
          onCheckedChange={(enabled) => onToggle(guest.id, enabled)}
          aria-label={`Uwzględniony: ${name}`}
        />
      </div>

      <div className={cn('min-w-0 flex-1 basis-24', !guest.enabled && 'text-muted-foreground')}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <button
            type="button"
            onClick={() => onOpenLinks(guest.id)}
            className={cn(
              'rounded text-left font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50',
              guest.enabled && 'text-foreground',
            )}
          >
            {name}
          </button>
          {relationLevel === null && (
            <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-primary-foreground">
              wybrana osoba
            </span>
          )}
          {relationLevel !== undefined && relationLevel !== null && (
            <GroupMark level={relationLevel} />
          )}
          {guest.isChild && (
            <span className="inline-flex items-center gap-1 rounded-full border border-brass bg-brass/15 px-2 py-0.5 text-xs font-medium text-brass-ink">
              <BabyIcon aria-hidden="true" className="size-3.5" />
              Dziecko
            </span>
          )}
          {!guest.enabled && (
            <span className="inline-flex items-center gap-1 text-xs font-medium">
              <EyeOffIcon aria-hidden="true" className="size-3.5" />
              Wyłączony
            </span>
          )}
          {warned && (
            <span
              title="Uwaga do danych: otwórz powiązania, żeby zobaczyć szczegóły"
              className="inline-flex items-center gap-1 text-xs font-medium text-brick"
            >
              <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
              Uwaga do danych
            </span>
          )}
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenLinks(guest.id)}
          aria-label={`Powiązania: ${name}`}
          title={relations ? relationsTitle(relations) : undefined}
          className="mt-0.5 -ml-2 h-auto min-h-8 justify-start px-2 py-1 whitespace-normal"
        >
          <RelationStrip guest={guest} relations={relations} />
        </Button>
        {guest.notes && <p className="truncate text-xs text-muted-foreground">{guest.notes}</p>}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onEdit(guest.id)}
          className="text-muted-foreground"
        >
          <PencilIcon aria-hidden="true" />
          <span className="sr-only">Edytuj: {name}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(guest.id)}
          className="text-muted-foreground hover:text-brick"
        >
          <Trash2Icon aria-hidden="true" />
          <span className="sr-only">Usuń: {name}</span>
        </Button>
      </div>
    </li>
  )
})
