import { SearchIcon } from 'lucide-react'
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import type { GuestIndex } from '@/domain/guestIndex'
import { placeLabel } from '@/domain/labels'
import type { Place } from '@/domain/guestDetails'
import { cn } from '@/lib/utils'

const MAX_RESULTS = 8

type PlanSearchProps = {
  index: GuestIndex
  placeOf: (guestId: number) => Place
  onPick: (guestId: number) => void
}

/** "Gdzie siedzi Ania?": type a name, pick it, and the plan jumps to the guest's table. */
export function PlanSearch({ index, placeOf, onPick }: PlanSearchProps) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  const results = useMemo(
    () => (query.trim() === '' ? [] : index.search(query).slice(0, MAX_RESULTS)),
    [index, query],
  )
  const open = results.length > 0 && !dismissed
  const activeIndex = Math.min(active, results.length - 1)

  function pick(guestId: number) {
    onPick(guestId)
    setQuery('')
    setActive(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (results.length === 0) return
      event.preventDefault()
      setDismissed(false)
      setActive(
        (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length,
      )
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      const result = results[activeIndex]
      if (result) pick(result.id)
    } else if (event.key === 'Escape') {
      setDismissed(true)
    }
  }

  return (
    <div className="relative w-full sm:max-w-sm">
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        role="combobox"
        aria-label="Znajdź gościa"
        aria-expanded={open}
        aria-controls={`${id}-lista`}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-${activeIndex}` : undefined}
        placeholder="Gdzie siedzi… (imię lub nazwisko)"
        autoComplete="off"
        className="pl-9"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setDismissed(false)
        }}
        onKeyDown={onKeyDown}
      />
      <ul
        id={`${id}-lista`}
        role="listbox"
        aria-label="Wyniki wyszukiwania"
        hidden={!open}
        className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md"
      >
        {results.map((guest, position) => (
          <li
            key={guest.id}
            id={`${id}-${position}`}
            role="option"
            aria-selected={position === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(position)}
            onClick={() => pick(guest.id)}
            className={cn(
              'flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-sm',
              position === activeIndex && 'bg-accent',
            )}
          >
            <span>{guest.displayName}</span>
            <span className="text-xs text-muted-foreground">{placeLabel(placeOf(guest.id))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
