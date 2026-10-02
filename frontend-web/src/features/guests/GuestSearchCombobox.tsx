import { UserPlusIcon } from 'lucide-react'
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { errorMessage } from '@/api/errorMessage'
import { Input } from '@/components/ui/input'
import { hasGuestNamed } from '@/domain/guestName'
import type { GuestIndex } from '@/domain/guestIndex'
import { groupLabel } from '@/domain/labels'
import type { Guest, LinkLevel } from '@/domain/types'
import { cn } from '@/lib/utils'

const MAX_RESULTS = 8

type Option = { kind: 'guest'; guest: Guest } | { kind: 'create'; name: string }

type GuestSearchComboboxProps = {
  label: string
  guests: Guest[]
  index: GuestIndex
  /** Guests that must not be offered (the guest itself, those already in this group). */
  excludeIds: ReadonlySet<number>
  /** The group a guest is linked at today, shown as a hint (picking moves the link). */
  currentLevel: (guestId: number) => LinkLevel | undefined
  onPick: (guest: Guest) => Promise<void>
  onCreate: (name: string) => Promise<void>
}

/**
 * Add-by-search (003-frontend-design §5): type, arrow keys, Enter. Offers "Dodaj «X» jako nowego
 * gościa" when no guest has exactly that name. The list is rendered in the flow (not floating), so
 * it never gets clipped inside the dialog on a phone. Focus stays in the input after a pick, to add
 * the next person to the same group.
 */
export function GuestSearchCombobox({
  label,
  guests,
  index,
  excludeIds,
  currentLevel,
  onPick,
  onCreate,
}: GuestSearchComboboxProps) {
  const id = useId()
  const listId = `${id}-list`
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = useMemo<Option[]>(() => {
    const text = query.trim()
    if (text === '') return []
    const found: Option[] = index
      .search(text)
      .filter((guest) => !excludeIds.has(guest.id))
      .slice(0, MAX_RESULTS)
      .map((guest) => ({ kind: 'guest', guest }))
    return hasGuestNamed(guests, text) ? found : [...found, { kind: 'create', name: text }]
  }, [query, index, guests, excludeIds])

  const open = options.length > 0 && !dismissed
  const activeIndex = Math.min(active, options.length - 1)

  async function choose(option: Option) {
    setError(null)
    try {
      if (option.kind === 'guest') await onPick(option.guest)
      else await onCreate(option.name)
      setQuery('')
      setActive(0)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return
      event.preventDefault()
      setDismissed(false)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((activeIndex + step + options.length) % options.length)
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      const option = options[activeIndex]
      if (option) void choose(option)
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setDismissed(true)
    }
  }

  return (
    <div>
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-${activeIndex}` : undefined}
        aria-invalid={error !== null}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setDismissed(false)
          setError(null)
        }}
        onKeyDown={onKeyDown}
        placeholder={`${label}…`}
        autoComplete="off"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm font-medium text-brick">
          {error}
        </p>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label={`${label}: wyniki`}
        hidden={!open}
        className="mt-1 overflow-hidden rounded-md border bg-popover"
      >
        {options.map((option, position) => (
          <li
            key={option.kind === 'guest' ? option.guest.id : 'create'}
            id={`${id}-${position}`}
            role="option"
            aria-selected={position === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(position)}
            onClick={() => void choose(option)}
            className={cn(
              'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm',
              position === activeIndex && 'bg-accent',
              option.kind === 'create' && 'border-t font-medium',
            )}
          >
            {option.kind === 'guest' ? (
              <>
                <span>{option.guest.displayName}</span>
                <OptionHint guest={option.guest} level={currentLevel(option.guest.id)} />
              </>
            ) : (
              <span className="flex items-center gap-2">
                <UserPlusIcon aria-hidden="true" className="size-4" />
                Dodaj «{option.name}» jako nowego gościa
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function OptionHint({ guest, level }: { guest: Guest; level: LinkLevel | undefined }) {
  const hints = [
    level !== undefined ? `teraz: ${groupLabel(level)}` : null,
    guest.enabled ? null : 'wyłączony',
  ].filter(Boolean)
  if (hints.length === 0) return null
  return <span className="text-xs text-muted-foreground">{hints.join(', ')}</span>
}
