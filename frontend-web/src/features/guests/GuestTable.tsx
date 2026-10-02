import { Checkbox } from '@/components/ui/checkbox'
import type { Guest } from '@/domain/types'
import { GuestRow, type GuestRowProps } from '@/features/guests/GuestRow'

type RowHandlers = Pick<
  GuestRowProps,
  'onSelect' | 'onToggle' | 'onOpenLinks' | 'onEdit' | 'onDelete'
>

type GuestTableProps = RowHandlers & {
  guests: Guest[]
  selectedIds: ReadonlySet<number>
  warnedIds: ReadonlySet<number>
  onSelectAll: (selected: boolean) => void
}

export function GuestTable({
  guests,
  selectedIds,
  warnedIds,
  onSelectAll,
  ...handlers
}: GuestTableProps) {
  const selectedCount = guests.filter((guest) => selectedIds.has(guest.id)).length
  const allSelected = guests.length > 0 && selectedCount === guests.length

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-3 border-b bg-muted/60 px-3 py-2">
        <Checkbox
          id="zaznacz-widocznych"
          checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
          onCheckedChange={(checked) => onSelectAll(checked === true)}
        />
        <label htmlFor="zaznacz-widocznych" className="cursor-pointer text-sm font-medium">
          Zaznacz wszystkie widoczne ({guests.length})
        </label>
      </div>
      <ul>
        {guests.map((guest) => (
          <GuestRow
            key={guest.id}
            guest={guest}
            selected={selectedIds.has(guest.id)}
            warned={warnedIds.has(guest.id)}
            {...handlers}
          />
        ))}
      </ul>
    </div>
  )
}
