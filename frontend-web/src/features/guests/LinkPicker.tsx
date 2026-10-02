import { BabyIcon, EyeOffIcon, TriangleAlertIcon, UserPlusIcon } from 'lucide-react'
import { memo, useCallback, useDeferredValue, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/errorMessage'
import { useApplyLinkChanges, useCreateGuest } from '@/api/guests'
import { GroupIcon, GroupMark } from '@/components/GroupMark'
import { GROUP_FRAME } from '@/components/groupFrame'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { clusterOf } from '@/domain/companions'
import { buildGuestIndex } from '@/domain/guestIndex'
import { hasGuestNamed, parseGuestName } from '@/domain/guestName'
import { GROUP_HINT, linkDiffLabel, pluralPl, viaLabel, warningLabel } from '@/domain/labels'
import {
  clusterAfter,
  clusterSizeWarning,
  diffIsEmpty,
  diffSelection,
  joiningViaCluster,
  linkChangesOf,
  pickerRows,
  selectedAt,
  type PickerRow,
} from '@/domain/linkSelection'
import type { ClusterOverview, Guest, LinkLevel } from '@/domain/types'
import { cn } from '@/lib/utils'

type PickerItemProps = {
  row: PickerRow
  level: LinkLevel
  nameOf: (guestId: number) => string
  /** Ticked by the user (a link of its own with the edited guest at this level). */
  ticked: boolean
  /** Group 0 only: in the cluster through someone else's link; shown ticked and fixed. */
  reached: boolean
  onToggle: (guestId: number, ticked: boolean) => void
}

/** The line under a name that says what Save will do with this person (or why they are fixed). */
function noteFor(
  { row, level, nameOf, ticked, reached }: PickerItemProps,
  locked: boolean,
): string | null {
  const { currentLevel, via } = row
  if (reached) {
    const who = via === undefined ? null : nameOf(via)
    return who ? `${viaLabel('cluster', who)}. Zmień to przy: ${who}` : 'w paczce grupy 0'
  }
  if (locked) return 'już w paczce (grupa 0): osobne powiązanie nie ma sensu'
  if (ticked && currentLevel !== undefined && currentLevel !== level) {
    return `Powiązanie przejdzie z grupy ${currentLevel} do grupy ${level}`
  }
  if (!ticked && currentLevel === level) return 'Powiązanie zostanie usunięte'
  return null
}

const PickerItem = memo(function PickerItem(props: PickerItemProps) {
  const { row, level, ticked, reached, onToggle } = props
  const { guest, currentLevel } = row
  const id = useId()
  const locked = row.viaCluster && level !== 0 && currentLevel === undefined
  const note = noteFor(props, locked)
  const moving = ticked && currentLevel !== undefined && currentLevel !== level

  return (
    <li
      data-enabled={guest.enabled}
      className={cn(
        'border-b last:border-b-0',
        (ticked || reached) && 'bg-accent/60',
        !guest.enabled && 'bg-muted/60',
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          'flex min-h-14 items-start gap-3 px-5 py-2.5',
          locked || reached ? 'cursor-default' : 'cursor-pointer',
        )}
      >
        <Checkbox
          id={id}
          checked={ticked || reached}
          disabled={locked || reached}
          onCheckedChange={(checked) => onToggle(guest.id, checked === true)}
          aria-label={guest.displayName}
          aria-describedby={note ? `${id}-note` : undefined}
          className="mt-0.5 size-6"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                'font-medium',
                !guest.enabled && 'text-muted-foreground',
                locked && 'text-muted-foreground',
              )}
            >
              {guest.displayName}
            </span>
            {guest.isChild && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brass bg-brass/15 px-2 py-0.5 text-xs font-medium text-brass-ink">
                <BabyIcon aria-hidden="true" className="size-3.5" />
                Dziecko
              </span>
            )}
            {!guest.enabled && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <EyeOffIcon aria-hidden="true" className="size-3.5" />
                wyłączony
              </span>
            )}
            {currentLevel !== undefined && currentLevel !== level && (
              <GroupMark level={currentLevel} text={`teraz: Grupa ${currentLevel}`} />
            )}
          </span>
          {note && (
            <span
              id={`${id}-note`}
              className={cn(
                'mt-0.5 block text-xs',
                moving ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {note}
            </span>
          )}
        </span>
      </label>
    </li>
  )
})

type PreviewProps = {
  level: LinkLevel
  guest: Guest
  guests: Guest[]
  overview: ClusterOverview | undefined
  selected: ReadonlySet<number>
  nameOf: (guestId: number) => string
}

/** Who comes along automatically, before anything is saved (display only: the server decides). */
function Preview({ level, guest, guests, overview, selected, nameOf }: PreviewProps) {
  const own = overview ? clusterOf(guest.id, overview) : undefined

  if (level === 0) {
    const after = clusterAfter(guest, guests, selected)
    const before = new Set(own?.guestIds ?? [guest.id])
    const joining = after.memberIds.filter((id) => !before.has(id) && !selected.has(id))
    const warning = clusterSizeWarning(after.seatedSize)
    return (
      <section aria-label="Kto dołączy automatycznie" className="space-y-1 text-sm">
        <p className="font-medium">
          Paczka po zapisie: {pluralPl(after.seatedSize, 'osoba', 'osoby', 'osób')} przy jednym
          stole
        </p>
        {joining.length > 0 && (
          <p className="text-muted-foreground">
            Dołączą przez ich paczki: {joining.map(nameOf).join(', ')}
          </p>
        )}
        {warning && (
          <p className="flex items-start gap-1.5 font-medium text-brick">
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {warningLabel({ code: warning })}
          </p>
        )}
      </section>
    )
  }

  const joining = overview ? joiningViaCluster(guest.id, selected, overview) : []
  const mates = (own?.guestIds ?? []).filter((id) => id !== guest.id)
  if (joining.length === 0 && (selected.size === 0 || mates.length === 0)) return null
  return (
    <section aria-label="Kto dołączy automatycznie" className="space-y-1 text-sm">
      {joining.length > 0 && (
        <>
          <p className="font-medium">Dołączą automatycznie (grupa {level} obejmuje całe paczki):</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
            {joining.map(({ guestId, viaId }) => (
              <li key={guestId}>
                <span className="font-medium">{nameOf(guestId)}</span>{' '}
                <span className="text-muted-foreground">{viaLabel('cluster', nameOf(viaId))}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {selected.size > 0 && mates.length > 0 && (
        <p className="text-muted-foreground">
          Obejmie też paczkę tego gościa (grupa 0): {mates.map(nameOf).join(', ')}
        </p>
      )}
    </section>
  )
}

type LinkPickerProps = {
  guest: Guest
  guests: Guest[]
  overview: ClusterOverview | undefined
  level: LinkLevel
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}

/**
 * The checklist for ONE group of one guest (003-frontend-design §5): every other guest, tick who
 * belongs, then "Zapisz". Nothing is sent before that. Save applies the difference to the guest's
 * current links: ticked and new = set the link at this level, ticked and linked at another level =
 * MOVE it (a pair has one link), unticked and linked here = delete. A nested dialog, so Esc and
 * "Anuluj" only close the checklist and focus returns to the button that opened it.
 */
export function LinkPicker({
  guest,
  guests,
  overview,
  level,
  onClose,
  onCloseAutoFocus,
}: LinkPickerProps) {
  const apply = useApplyLinkChanges()
  const create = useCreateGuest()
  const searchRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => selectedAt(guest, level))
  const [query, setQuery] = useState('')
  const [onlySelected, setOnlySelected] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(query)

  const rows = useMemo(() => pickerRows(guest, guests, overview), [guest, guests, overview])
  const index = useMemo(() => buildGuestIndex(guests), [guests])
  const names = useMemo(
    () => new Map(guests.map((other) => [other.id, other.displayName])),
    [guests],
  )
  const nameOf = useCallback((id: number) => names.get(id) ?? `Gość ${id}`, [names])

  const diff = diffSelection(guest, level, selected)
  const changed = !diffIsEmpty(diff)
  // Group 0 only: who is in the cluster after the edits through someone else's link.
  const clusterIds = useMemo(
    () => (level === 0 ? new Set(clusterAfter(guest, guests, selected).memberIds) : undefined),
    [level, guest, guests, selected],
  )

  const visible = useMemo(() => {
    const found = new Set(index.search(deferredQuery).map((match) => match.id))
    return rows.filter(
      (row) => found.has(row.guest.id) && (!onlySelected || selected.has(row.guest.id)),
    )
  }, [rows, index, deferredQuery, onlySelected, selected])

  const text = query.trim()
  const canCreate = text !== '' && !hasGuestNamed(guests, text)

  const toggle = useCallback((guestId: number, ticked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (ticked) next.add(guestId)
      else next.delete(guestId)
      return next
    })
  }, [])

  async function createAndTick() {
    const parsed = parseGuestName(text)
    if (!parsed) return
    setProblem(null)
    try {
      const created = await create.mutateAsync({ ...parsed, isChild: false })
      toggle(created.id, true)
      setQuery('')
      searchRef.current?.focus()
    } catch (failure) {
      setProblem(errorMessage(failure))
    }
  }

  async function save() {
    setProblem(null)
    const failed = await apply.mutateAsync({
      guestId: guest.id,
      changes: linkChangesOf(level, diff),
    })
    if (failed.length === 0) {
      toast.success(`Zapisano powiązania: Grupa ${level}.`)
      onClose()
      return
    }
    const who = failed.map(({ otherId }) => nameOf(otherId)).join(', ')
    const why = [...new Set(failed.map(({ error }) => errorMessage(error)))].join(' ')
    const message = `Nie udało się zapisać: ${who}. ${why}`
    setProblem(message)
    toast.error(message)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="h-[92dvh] gap-0 overflow-hidden p-0 sm:h-[85dvh] sm:max-w-xl"
      >
        <div className={cn('shrink-0 rounded-t-[inherit] px-5 pt-4 pb-3', GROUP_FRAME[level])}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <GroupIcon level={level} className="size-5" />
              Grupa {level}: {guest.displayName}
            </DialogTitle>
            <DialogDescription>
              {GROUP_HINT[level]} Kto jest teraz w innej grupie, zostanie do tej przeniesiony (jedna
              para to jedno powiązanie).
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-3">
          <Input
            ref={searchRef}
            type="search"
            aria-label="Szukaj gościa"
            placeholder="Szukaj, np. michal"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setProblem(null)
            }}
            autoComplete="off"
            className="h-11 min-w-44 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            aria-pressed={onlySelected}
            onClick={() => setOnlySelected((current) => !current)}
            className={cn('h-11', onlySelected && 'border-ink bg-accent')}
          >
            Tylko zaznaczeni
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {visible.length === 0 && !canCreate && (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">
              {onlySelected ? 'Nikt nie jest zaznaczony.' : 'Nikt nie pasuje do tego wyszukiwania.'}
            </p>
          )}
          <ul aria-label="Goście do wyboru">
            {visible.map((row) => (
              <PickerItem
                key={row.guest.id}
                row={row}
                level={level}
                nameOf={nameOf}
                ticked={selected.has(row.guest.id)}
                reached={
                  level === 0 &&
                  row.viaCluster &&
                  !selected.has(row.guest.id) &&
                  clusterIds?.has(row.guest.id) === true
                }
                onToggle={toggle}
              />
            ))}
          </ul>
          {canCreate && !onlySelected && (
            <button
              type="button"
              onClick={() => void createAndTick()}
              disabled={create.isPending}
              className="flex min-h-14 w-full items-center gap-3 border-t px-5 py-2.5 text-left font-medium outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <UserPlusIcon aria-hidden="true" className="size-5" />
              Dodaj «{text}» jako nowego gościa
            </button>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t bg-card px-5 py-3">
          <div className="max-h-32 overflow-y-auto">
            <Preview
              level={level}
              guest={guest}
              guests={guests}
              overview={overview}
              selected={selected}
              nameOf={nameOf}
            />
          </div>
          {problem && (
            <p role="alert" className="text-sm font-medium text-brick">
              {problem}
            </p>
          )}
          <p className="flex flex-wrap items-baseline gap-x-3 text-sm" aria-live="polite">
            <span className="font-semibold">Zaznaczono: {selected.size}</span>
            <span className="text-muted-foreground">
              {changed ? linkDiffLabel(diff) : 'Bez zmian'}
            </span>
          </p>
          <DialogFooter className="flex-row justify-end">
            <Button type="button" variant="outline" onClick={onClose} className="h-11">
              Anuluj
            </Button>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={!changed || apply.isPending}
              className="h-11"
            >
              Zapisz
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
