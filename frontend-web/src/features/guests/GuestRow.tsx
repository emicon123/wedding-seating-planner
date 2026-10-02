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
import type { Guest, LinkLevel } from '@/domain/types'
import { cn } from '@/lib/utils'

const LEVELS: LinkLevel[] = [0, 1, 2]

export type GuestRowProps = {
  guest: Guest
  selected: boolean
  /** The clusters overview raised a data warning involving this guest. */
  warned: boolean
  onSelect: (guestId: number, selected: boolean) => void
  onToggle: (guestId: number, enabled: boolean) => void
  onOpenLinks: (guestId: number) => void
  onEdit: (guestId: number) => void
  onDelete: (guestId: number) => void
}

function LinksSummary({ guest }: { guest: Guest }) {
  const counts = LEVELS.map((level) => ({
    level,
    count: guest.links.filter((link) => link.level === level).length,
  })).filter(({ count }) => count > 0)

  if (counts.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <Link2Icon aria-hidden="true" className="size-3.5" />
        Dodaj powiązania
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {counts.map(({ level, count }) => (
        <GroupMark key={level} level={level} count={count} />
      ))}
    </span>
  )
}

/** One guest: select, enable switch, name with markers, links, edit, delete. Memoised: 100 rows must stay cheap. */
export const GuestRow = memo(function GuestRow({
  guest,
  selected,
  warned,
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

      <div className={cn('min-w-0 flex-1 basis-40', !guest.enabled && 'text-muted-foreground')}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn('truncate font-medium', guest.enabled && 'text-foreground')}>
            {name}
          </span>
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
        {guest.notes && <p className="truncate text-xs text-muted-foreground">{guest.notes}</p>}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenLinks(guest.id)}
          aria-label={`Powiązania: ${name}`}
          className="h-9 px-2"
        >
          <LinksSummary guest={guest} />
        </Button>
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
