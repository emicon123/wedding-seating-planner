import { TriangleAlertIcon } from 'lucide-react'
import { useDeferredValue, useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/errorMessage'
import { useClusterOverview } from '@/api/clusters'
import { useGuests, useToggleGuests } from '@/api/guests'
import { Button } from '@/components/ui/button'
import {
  NO_FILTERS,
  filterGuests,
  filtersToParams,
  hasActiveFilters,
  parseFilters,
  type GuestFilters as Filters,
} from '@/domain/guestFilters'
import { familyReach } from '@/domain/acquaintance'
import { buildGuestIndex } from '@/domain/guestIndex'
import { guestCounts } from '@/domain/guestList'
import { relatedTo, summariseRelations } from '@/domain/relations'
import { sortByCluster } from '@/domain/companions'
import { guestCountsLabel, pluralPl } from '@/domain/labels'
import type { Guest } from '@/domain/types'
import { BulkToggleBar } from '@/features/guests/BulkToggleBar'
import { ClusterWarnings } from '@/features/guests/ClusterWarnings'
import { DeleteGuestDialog } from '@/features/guests/DeleteGuestDialog'
import { GuestEditDialog } from '@/features/guests/GuestEditDialog'
import { GuestFilters } from '@/features/guests/GuestFilters'
import { GuestTable } from '@/features/guests/GuestTable'
import { LinkEditor } from '@/features/guests/LinkEditor'
import { MissingLinksSection } from '@/features/guests/MissingLinksSection'
import { QuickAddBar } from '@/features/guests/QuickAddBar'

type Dialog = { kind: 'links' | 'edit' | 'delete'; guestId: number }

const NO_GUESTS: Guest[] = []

/**
 * The guest list: the screen where most of the planning time goes. The page owns the hooks, the
 * URL filters, the bulk selection and which dialog is open; everything below only renders.
 */
export function GuestsPage() {
  const guestsQuery = useGuests()
  const overviewQuery = useClusterOverview()
  const { mutateAsync: mutateToggle } = useToggleGuests()
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const guests = guestsQuery.data ?? NO_GUESTS
  const overview = overviewQuery.data
  const filters = useMemo(() => parseFilters(params), [params])
  const deferredFilters = useDeferredValue(filters)
  const index = useMemo(() => buildGuestIndex(guests), [guests])
  const summaries = useMemo(() => summariseRelations(guests, overview), [guests, overview])
  const related = useMemo(
    () =>
      deferredFilters.related === null
        ? undefined
        : relatedTo(deferredFilters.related, guests, overview),
    [deferredFilters.related, guests, overview],
  )
  const relationLevels = useMemo(
    () => related && new Map(related.map(({ guestId, level }) => [guestId, level])),
    [related],
  )
  const visible = useMemo(() => {
    const matching = filterGuests(guests, index, deferredFilters, related)
    // Search hits keep their ranking, "related to …" keeps relation order; the plain list
    // reads family by family (whole group-0 clusters together, § companions.sortByCluster).
    if (deferredFilters.query.trim() !== '' || deferredFilters.related !== null) return matching
    return sortByCluster(matching, overview)
  }, [guests, index, deferredFilters, related, overview])
  const counts = useMemo(() => guestCounts(guests), [guests])
  const reaches = useMemo(() => (overview ? familyReach(guests, overview) : []), [guests, overview])
  const warnedIds = useMemo(
    () => new Set(overview?.warnings.flatMap((warning) => warning.guestIds) ?? []),
    [overview],
  )

  // Only what is on screen can be changed by a bulk action, whatever else was ticked earlier.
  const selectedVisible = useMemo(
    () => visible.filter((guest) => selected.has(guest.id)).map((guest) => guest.id),
    [visible, selected],
  )

  const changeFilters = (next: Filters) => setParams(filtersToParams(next), { replace: true })

  const onSelect = useCallback((guestId: number, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(guestId)
      else next.delete(guestId)
      return next
    })
  }, [])

  const onSelectAll = useCallback(
    (on: boolean) =>
      setSelected((current) => {
        const next = new Set(current)
        for (const guest of visible) {
          if (on) next.add(guest.id)
          else next.delete(guest.id)
        }
        return next
      }),
    [visible],
  )

  const changeEnabled = useCallback(
    async (guestIds: number[], enabled: boolean): Promise<boolean> => {
      try {
        await mutateToggle({ guestIds, enabled })
        return true
      } catch (failure) {
        toast.error(errorMessage(failure))
        return false
      }
    },
    [mutateToggle],
  )

  const onToggleOne = useCallback(
    (guestId: number, enabled: boolean) => void changeEnabled([guestId], enabled),
    [changeEnabled],
  )

  /** One PATCH for the whole selection; the toast repeats the count and offers to take it back. */
  async function onBulk(enabled: boolean) {
    const guestIds = selectedVisible
    setSelected(new Set())
    if (!(await changeEnabled(guestIds, enabled))) return
    toast.success(
      `${enabled ? 'Włączono' : 'Wyłączono'}: ${pluralPl(guestIds.length, 'gość', 'gości', 'gości')}.`,
      { action: { label: 'Cofnij', onClick: () => void changeEnabled(guestIds, !enabled) } },
    )
  }

  const open = useCallback(
    (kind: Dialog['kind']) => (guestId: number) => setDialog({ kind, guestId }),
    [],
  )
  const onOpenLinks = useMemo(() => open('links'), [open])
  const onEdit = useMemo(() => open('edit'), [open])
  const onDelete = useMemo(() => open('delete'), [open])
  const closeDialog = useCallback(() => setDialog(null), [])

  /** From the relationships panel: narrow the list to this person and everyone linked to them. */
  const showRelated = (guestId: number) => {
    changeFilters({ ...filters, related: guestId })
    closeDialog()
  }

  const dialogGuest = dialog ? guests.find((guest) => guest.id === dialog.guestId) : undefined
  const nameOf = (guestId: number) =>
    guests.find((guest) => guest.id === guestId)?.displayName ?? `Gość ${guestId}`

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-24">
      <header className="space-y-1">
        <h1 className="text-4xl font-semibold">Goście</h1>
        <p className="text-muted-foreground" aria-live="polite">
          {guestsQuery.isSuccess ? guestCountsLabel(counts) : 'Wczytuję listę…'}
        </p>
      </header>

      <QuickAddBar />

      {overview && overview.warnings.length > 0 && (
        <details className="group rounded-xl border border-brick/40 bg-card">
          <summary className="flex cursor-pointer items-center gap-2 rounded-xl px-4 py-3 font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <TriangleAlertIcon aria-hidden="true" className="size-4 text-brick" />
            Uwagi do danych ({overview.warnings.length})
            <span className="ml-auto text-sm font-normal text-muted-foreground group-open:hidden">
              pokaż
            </span>
          </summary>
          <div className="px-3 pb-3">
            <ClusterWarnings
              warnings={overview.warnings}
              nameOf={nameOf}
              onOpenGuest={onOpenLinks}
            />
          </div>
        </details>
      )}

      <MissingLinksSection reaches={reaches} nameOf={nameOf} onOpenLinks={onOpenLinks} />

      <GuestFilters
        filters={filters}
        onChange={changeFilters}
        onClear={() => changeFilters(NO_FILTERS)}
      />

      {guestsQuery.isPending && <p className="text-muted-foreground">Wczytuję gości…</p>}

      {guestsQuery.isError && (
        <div role="alert" className="space-y-2 rounded-xl border border-brick/40 bg-brick/8 p-4">
          <p className="font-medium">{errorMessage(guestsQuery.error)}</p>
          <Button type="button" variant="outline" onClick={() => void guestsQuery.refetch()}>
            Spróbuj ponownie
          </Button>
        </div>
      )}

      {guestsQuery.isSuccess && guests.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
          Lista jest pusta. Wpisz pierwszego gościa w polu powyżej i naciśnij Enter.
        </p>
      )}

      {filters.related !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/30 bg-card px-4 py-3">
          <p className="font-medium">
            Powiązani z: {nameOf(filters.related)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              najpierw ta osoba, potem grupa 0, 1 i 2
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => changeFilters({ ...filters, related: null })}
          >
            Pokaż wszystkich
          </Button>
        </div>
      )}

      {guests.length > 0 && visible.length === 0 && (
        <div className="space-y-2 rounded-xl border border-dashed p-6 text-center">
          <p className="text-muted-foreground">Żaden gość nie pasuje do wybranych filtrów.</p>
          {hasActiveFilters(filters) && (
            <Button type="button" variant="outline" onClick={() => changeFilters(NO_FILTERS)}>
              Wyczyść filtry
            </Button>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <>
          {hasActiveFilters(filters) && (
            <p className="text-sm text-muted-foreground">
              Pokazano {visible.length} z {guests.length}.
            </p>
          )}
          <GuestTable
            guests={visible}
            selectedIds={selected}
            warnedIds={warnedIds}
            summaries={summaries}
            relationLevels={relationLevels}
            onSelect={onSelect}
            onSelectAll={onSelectAll}
            onToggle={onToggleOne}
            onOpenLinks={onOpenLinks}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </>
      )}

      <BulkToggleBar
        count={selectedVisible.length}
        onApply={(enabled) => void onBulk(enabled)}
        onClear={() => setSelected(new Set())}
      />

      {dialog?.kind === 'links' && dialogGuest && (
        <LinkEditor
          key={dialogGuest.id}
          guestId={dialogGuest.id}
          guests={guests}
          overview={overview}
          onClose={closeDialog}
          onShowInList={showRelated}
        />
      )}
      {dialog?.kind === 'edit' && dialogGuest && (
        <GuestEditDialog guest={dialogGuest} onClose={closeDialog} />
      )}
      {dialog?.kind === 'delete' && dialogGuest && (
        <DeleteGuestDialog guest={dialogGuest} onClose={closeDialog} />
      )}
    </div>
  )
}
