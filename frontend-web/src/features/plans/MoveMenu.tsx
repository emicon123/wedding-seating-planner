import { ArrowRightLeftIcon, CheckIcon, InboxIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ClusterPlacement } from '@/domain/types'
import { usePlanView } from '@/features/plans/planViewContext'

type MoveMenuProps = {
  cluster: ClusterPlacement
  /** Where the cluster is now: a table number, or null in the tray. */
  tableNumber: number | null
  label: string
  /** Stops a drag from starting under the pointer when the menu button is pressed. */
  stopDrag: React.MouseEventHandler & React.TouchEventHandler
}

/**
 * "Przenieś do stołu…": the move that needs no dragging. It is the keyboard and phone path, and
 * works with a screen reader. It shows the seats each table would have after the move, so a full
 * table is visible before choosing it (choosing it is still allowed: a plan is a draft).
 */
export function MoveMenu({ cluster, tableNumber, label, stopDrag }: MoveMenuProps) {
  const { tables, capacity, onMove } = usePlanView()
  const size = cluster.guestIds.length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="pointer-coarse:size-8"
          onMouseDown={stopDrag}
          onTouchStart={stopDrag}
        >
          <ArrowRightLeftIcon aria-hidden="true" />
          <span className="sr-only">Przenieś do stołu… ({label})</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Przenieś do stołu</DropdownMenuLabel>
        {tables.map((table) => {
          const here = table.number === tableNumber
          const after = here ? table.fill : table.fill + size
          const over = after > capacity
          return (
            <DropdownMenuItem
              key={table.number}
              disabled={here}
              onSelect={() => onMove(cluster, table.number)}
            >
              <span className="flex-1">Stół {table.number}</span>
              {here ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CheckIcon aria-hidden="true" />
                  tu
                </span>
              ) : (
                <span
                  className={
                    over
                      ? 'flex items-center gap-1 text-xs font-semibold text-brick'
                      : 'text-xs text-muted-foreground'
                  }
                >
                  {over && <TriangleAlertIcon aria-hidden="true" />}
                  {after}/{capacity}
                  {over && <span className="sr-only"> (za dużo osób)</span>}
                </span>
              )}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={tableNumber === null} onSelect={() => onMove(cluster, null)}>
          <InboxIcon aria-hidden="true" />
          <span className="flex-1">Bez stołu</span>
          {tableNumber === null && <span className="text-xs text-muted-foreground">tu</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
