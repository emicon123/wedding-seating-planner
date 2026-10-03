import { useIsMutating } from '@tanstack/react-query'
import { ChevronLeftIcon, EyeIcon, PlusIcon, PrinterIcon, UserXIcon } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useClusterOverview } from '@/api/clusters'
import { errorMessage } from '@/api/errorMessage'
import { useGuests } from '@/api/guests'
import {
  GENERATE_MUTATION_KEY,
  useAddTable,
  useDeleteAssignment,
  useDeleteTable,
  useResetPlan,
  useScenarios,
  useSetAssignment,
} from '@/api/scenarios'
import { Button, buttonVariants } from '@/components/ui/button'
import type { Capacity } from '@/domain/capacity'
import { tableElementId } from '@/domain/dropTargets'
import { guestDetails, placeOf } from '@/domain/guestDetails'
import { buildGuestIndex } from '@/domain/guestIndex'
import { isolatedCount } from '@/domain/isolation'
import {
  ISOLATED_LABEL,
  peopleLabel,
  scoreLabel,
  tableCountLabel,
  violationCountLabel,
} from '@/domain/labels'
import { guestTableMap } from '@/domain/planView'
import type { ClusterOverview, ClusterPlacement, Guest } from '@/domain/types'
import { DeletePlanButton } from '@/features/plans/DeletePlanButton'
import { DeletePlanDialog } from '@/features/plans/DeletePlanDialog'
import { DeleteTableDialog } from '@/features/plans/DeleteTableDialog'
import { GuestDetailsPanel } from '@/features/plans/GuestDetailsPanel'
import { PlanBoard } from '@/features/plans/PlanBoard'
import { PlanLegend } from '@/features/plans/PlanLegend'
import { PlanSearch } from '@/features/plans/PlanSearch'
import { PlanSwitcher } from '@/features/plans/PlanSwitcher'
import { type PlanView } from '@/features/plans/planViewContext'
import { RecalculationBanner } from '@/features/plans/RecalculationBanner'
import { UndoGenerateBar } from '@/features/plans/UndoGenerateBar'

const NO_GUESTS: Guest[] = []
const NO_OVERVIEW: ClusterOverview = { clusters: [], warnings: [] }
const COMPACT_VALUE = 'stoly'

function revealElement(id: string): void {
  const element = document.getElementById(id)
  const calm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  element?.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'center' })
}

function parseGuestParam(raw: string | null): number | null {
  const id = Number(raw)
  return raw !== null && Number.isInteger(id) && id > 0 ? id : null
}

/**
 * One plan as a hall: tables with seats, guests as chips, the tray of unseated paczki, a details
 * panel and search. The page owns the hooks and the URL (`?guest=` deep link, `?widok=stoly`);
 * the board below only renders and reports moves. Scores and violations are the server's, so they
 * are shown only while no save is in flight.
 */
export function PlanDetailPage({ capacity }: { capacity: Capacity }) {
  const scenarios = useScenarios()
  const guestsQuery = useGuests()
  const overviewQuery = useClusterOverview()
  const [params, setParams] = useSearchParams()
  // Generate is not an edit in flight: the plan on screen stays as it is until the result lands, so
  // it must not hide the plan's numbers.
  const saving =
    useIsMutating({
      predicate: (mutation) => mutation.options.mutationKey !== GENERATE_MUTATION_KEY,
    }) > 0
  const { mutateAsync: setAssignment } = useSetAssignment()
  const { mutateAsync: deleteAssignment } = useDeleteAssignment()
  const { mutateAsync: addTable, isPending: addingTable } = useAddTable()
  const { mutateAsync: deleteTable } = useDeleteTable()
  const { mutateAsync: resetPlan, isPending: resettingPlan } = useResetPlan()
  const [tableToDelete, setTableToDelete] = useState<number | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const scenario = scenarios.data?.find((candidate) => candidate.capacity === capacity)
  const plan = scenario?.plan
  const guests = guestsQuery.data ?? NO_GUESTS
  const overview = overviewQuery.data
  const index = useMemo(() => buildGuestIndex(guests), [guests])
  const nameOf = useCallback(
    (guestId: number) => index.byId.get(guestId)?.displayName ?? `Gość ${guestId}`,
    [index],
  )
  const tableOfGuest = useMemo(() => (plan ? guestTableMap(plan) : new Map()), [plan])
  const placeOfId = useCallback(
    (guestId: number) => {
      const guest = index.byId.get(guestId)
      return guest ? placeOf(guest, tableOfGuest) : 'disabled'
    },
    [index, tableOfGuest],
  )

  const selectedGuestId = parseGuestParam(params.get('guest'))
  const compact = params.get('widok') === COMPACT_VALUE
  const selectGuest = useCallback(
    (guestId: number | null) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (guestId === null) next.delete('guest')
          else next.set('guest', String(guestId))
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  const toggleCompact = () =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (compact) next.delete('widok')
        else next.set('widok', COMPACT_VALUE)
        return next
      },
      { replace: true },
    )

  // Picking a guest brings their table (or the tray) into view; later moves must not scroll.
  const reveal = useEffectEvent(() => {
    if (selectedGuestId === null) return
    const place = placeOfId(selectedGuestId)
    if (typeof place === 'number') revealElement(tableElementId(place))
    else if (place === 'unseated') revealElement('bez-stolu')
  })
  useEffect(() => {
    if (plan && guestsQuery.isSuccess) reveal()
  }, [selectedGuestId, plan !== undefined, guestsQuery.isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps -- reveal is an effect event; only a new selection (or the first data) should scroll

  const onMove = useCallback(
    async (cluster: ClusterPlacement, toTable: number | null) => {
      const guestId = cluster.guestIds[0]
      if (guestId === undefined) return
      try {
        if (toTable === null) await deleteAssignment({ capacity, guestId })
        else
          await setAssignment({ capacity, guestId, tableNumber: toTable, pinned: cluster.pinned })
      } catch (failure) {
        toast.error(`Nie udało się przenieść paczki. ${errorMessage(failure)}`)
      }
    },
    [capacity, setAssignment, deleteAssignment],
  )

  const onTogglePin = useCallback(
    async (cluster: ClusterPlacement, tableNumber: number) => {
      const guestId = cluster.guestIds[0]
      if (guestId === undefined) return
      try {
        await setAssignment({ capacity, guestId, tableNumber, pinned: !cluster.pinned })
      } catch (failure) {
        toast.error(`Nie udało się zmienić pinezki. ${errorMessage(failure)}`)
      }
    },
    [capacity, setAssignment],
  )

  async function onAddTable() {
    try {
      const updated = await addTable({ capacity })
      toast.success(`Dodano stół ${updated.plan.tables.length}.`)
    } catch (failure) {
      toast.error(errorMessage(failure))
    }
  }

  async function onConfirmDelete(tableNumber: number) {
    setTableToDelete(null)
    try {
      await deleteTable({ capacity, tableNumber })
      toast.success(`Usunięto stół ${tableNumber}. Jego goście są w polu „Bez stołu”.`)
    } catch (failure) {
      toast.error(errorMessage(failure))
    }
  }

  async function onConfirmReset() {
    setResetError(null)
    try {
      await resetPlan({ capacity })
      toast.success(`Usunięto plan na ${capacity} miejsc.`)
      setConfirmingReset(false)
    } catch (failure) {
      const message = errorMessage(failure)
      setResetError(message)
      toast.error(message)
    }
  }

  const view = useMemo<PlanView | null>(
    () =>
      plan
        ? {
            capacity,
            nameOf,
            scores: saving ? undefined : new Map(plan.guestScores.map((s) => [s.guestId, s])),
            selectedGuestId,
            tables: plan.tables.map((table) => ({ number: table.number, fill: table.fill })),
            onSelectGuest: selectGuest,
            onMove: (cluster, toTable) => void onMove(cluster, toTable),
            onTogglePin: (cluster, tableNumber) => void onTogglePin(cluster, tableNumber),
            onDeleteTable: setTableToDelete,
          }
        : null,
    [plan, capacity, nameOf, saving, selectedGuestId, selectGuest, onMove, onTogglePin],
  )

  const details = useMemo(
    () =>
      plan && selectedGuestId !== null
        ? guestDetails(selectedGuestId, plan, guests, overview ?? NO_OVERVIEW)
        : undefined,
    [plan, selectedGuestId, guests, overview],
  )

  const loading = scenarios.isPending || guestsQuery.isPending
  const failed = scenarios.error ?? guestsQuery.error

  return (
    <section className="space-y-4">
      <Link
        to="/"
        className="inline-flex items-center gap-1 rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
        Wszystkie plany
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-semibold">Plan na {capacity} miejsc</h1>
        {scenarios.data && <PlanSwitcher current={capacity} scenarios={scenarios.data} />}
      </header>

      <UndoGenerateBar />

      {loading && <p className="text-muted-foreground">Wczytuję plan…</p>}

      {failed && (
        <div role="alert" className="space-y-2 rounded-xl border border-brick/40 bg-brick/8 p-4">
          <p className="font-medium">{errorMessage(failed)}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void scenarios.refetch()
              void guestsQuery.refetch()
            }}
          >
            Spróbuj ponownie
          </Button>
        </div>
      )}

      {plan && scenario && view && (
        <>
          <dl
            aria-busy={saving}
            className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border bg-card px-4 py-2 text-sm"
          >
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Stoły</dt>
              <dd className="font-semibold">{tableCountLabel(plan.tables.length)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Posadzeni</dt>
              <dd className="font-semibold">
                {plan.summary.seatedCount}
                {plan.summary.unseatedCount > 0 && (
                  <span className="text-brick">
                    {' '}
                    ({peopleLabel(plan.summary.unseatedCount)} bez stołu)
                  </span>
                )}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Zadowolenie</dt>
              <dd className="font-semibold">{saving ? '…' : scoreLabel(plan.summary.score)}</dd>
            </div>
            {!saving && isolatedCount(plan.guestScores) > 0 && (
              <div className="flex gap-1.5 text-brick">
                <dt className="flex items-center gap-1">
                  <UserXIcon aria-hidden="true" className="size-4" />
                  {ISOLATED_LABEL}
                </dt>
                <dd className="font-semibold">{isolatedCount(plan.guestScores)} os.</dd>
              </div>
            )}
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Naruszenia</dt>
              <dd className="font-semibold">
                {saving ? '…' : violationCountLabel(plan.summary.violationCount)}
              </dd>
            </div>
          </dl>

          {!saving && plan.summary.needsRecalculation && (
            <RecalculationBanner violations={plan.violations} />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <PlanSearch index={index} placeOf={placeOfId} onPick={selectGuest} />
            <Button
              type="button"
              variant="outline"
              disabled={addingTable}
              onClick={() => void onAddTable()}
            >
              <PlusIcon aria-hidden="true" />
              Dodaj stół
            </Button>
            <DeletePlanButton
              empty={plan.tables.length === 0}
              onClick={() => {
                setResetError(null)
                setConfirmingReset(true)
              }}
            />
            <Button type="button" variant="outline" aria-pressed={compact} onClick={toggleCompact}>
              <EyeIcon aria-hidden="true" />
              {compact ? 'Pokaż gości' : 'Tylko stoły'}
            </Button>
            <Link to={`/druk/${capacity}`} className={buttonVariants({ variant: 'outline' })}>
              <PrinterIcon aria-hidden="true" />
              Wersja do druku
            </Link>
          </div>
          <PlanLegend />

          <PlanBoard
            scenario={scenario}
            overview={overview}
            view={view}
            selectedGuestId={selectedGuestId}
            settled={!saving}
            compact={compact}
            details={
              details ? (
                <GuestDetailsPanel
                  details={details}
                  settled={!saving}
                  onClose={() => selectGuest(null)}
                  onSelectGuest={selectGuest}
                  onShowTable={(tableNumber) => revealElement(tableElementId(tableNumber))}
                />
              ) : null
            }
          />

          {tableToDelete !== null && (
            <DeleteTableDialog
              tableNumber={tableToDelete}
              guestCount={plan.tables.find((t) => t.number === tableToDelete)?.fill ?? 0}
              onConfirm={() => void onConfirmDelete(tableToDelete)}
              onClose={() => setTableToDelete(null)}
            />
          )}

          {confirmingReset && (
            <DeletePlanDialog
              scenarios={[scenario]}
              pending={resettingPlan}
              error={resetError}
              onConfirm={() => void onConfirmReset()}
              onClose={() => setConfirmingReset(false)}
            />
          )}
        </>
      )}
    </section>
  )
}
