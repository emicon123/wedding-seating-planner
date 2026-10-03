import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2Icon } from 'lucide-react'
import { useResetPlan, useScenarios } from '@/api/scenarios'
import { errorMessage } from '@/api/errorMessage'
import { Button } from '@/components/ui/button'
import { PLAN_KEYS, planName, planTitle } from '@/domain/plans'
import type { PlanKey, Scenario } from '@/domain/types'
import { DeletePlanDialog } from '@/features/plans/DeletePlanDialog'
import { GenerateButton } from '@/features/plans/GenerateButton'
import { PlanCard } from '@/features/plans/PlanCard'
import { UndoGenerateBar } from '@/features/plans/UndoGenerateBar'

type DeleteTarget = { kind: 'one'; key: PlanKey } | { kind: 'all' }

/**
 * The five plans (9, 10, 11, 12 seats and the mixed one) side by side: the answer to "how many tables, how happy, what
 * is wrong". Generate always computes and stores all five at once (Cofnij undoes it). This
 * page also owns "Usuń plan" / "Usuń wszystkie plany" (task 005): the cards only report the
 * intent, the dialog confirms, and one reset call per plan empties it on the server.
 */
export function PlansPage() {
  const scenarios = useScenarios()
  const reset = useResetPlan()
  const [target, setTarget] = useState<DeleteTarget | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [resettingAll, setResettingAll] = useState(false)

  const openDelete = (next: DeleteTarget) => {
    setDialogError(null)
    setTarget(next)
  }
  const closeDelete = () => {
    setTarget(null)
    setDialogError(null)
  }

  async function confirmSingle(key: PlanKey) {
    setDialogError(null)
    try {
      await reset.mutateAsync({ key })
      toast.success(`Usunięto ${planTitle(key)}.`)
      setTarget(null)
    } catch (failure) {
      const message = errorMessage(failure)
      setDialogError(message)
      toast.error(message)
    }
  }

  async function confirmAll() {
    setDialogError(null)
    setResettingAll(true)
    const settled = await Promise.allSettled(PLAN_KEYS.map((key) => reset.mutateAsync({ key })))
    setResettingAll(false)
    const failed = PLAN_KEYS.filter((_, index) => settled[index]?.status === 'rejected')
    if (failed.length === 0) {
      toast.success('Usunięto wszystkie plany.')
      setTarget(null)
    } else {
      const message = `Nie udało się usunąć planu: ${failed.map(planName).join(', ')}.`
      setDialogError(message)
      toast.error(message)
      // the plans that did go are empty on the server: show the truth, not a guess
      void scenarios.refetch()
    }
  }

  const dialogScenarios: Scenario[] | null =
    !target || !scenarios.data
      ? null
      : target.kind === 'one'
        ? scenarios.data.filter((scenario) => scenario.key === target.key)
        : [...scenarios.data].sort((a, b) => PLAN_KEYS.indexOf(a.key) - PLAN_KEYS.indexOf(b.key))
  const pending = target?.kind === 'one' ? reset.isPending : resettingAll
  const allEmpty = scenarios.data?.every((s) => s.plan.summary.tableCount === 0) ?? false

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-prose space-y-2">
          <h1 className="text-4xl font-semibold">Plany</h1>
          <p className="text-muted-foreground">
            Pięć planów naraz: stoły 9-, 10-, 11-, 12-osobowe i mieszany. Porównaj liczbę stołów,
            zadowolenie gości i naruszenia, a potem otwórz plan, żeby zobaczyć salę.
          </p>
        </div>
        <GenerateButton size="lg" />
      </header>

      <UndoGenerateBar />

      {scenarios.isPending && <p className="text-muted-foreground">Wczytuję plany…</p>}

      {scenarios.isError && (
        <div role="alert" className="space-y-2 rounded-xl border border-brick/40 bg-brick/8 p-4">
          <p className="font-medium">{errorMessage(scenarios.error)}</p>
          <Button type="button" variant="outline" onClick={() => void scenarios.refetch()}>
            Spróbuj ponownie
          </Button>
        </div>
      )}

      {scenarios.isSuccess && (
        <section aria-labelledby="aktualne" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="aktualne" className="text-2xl font-semibold">
              Plany teraz
            </h2>
            <Button
              type="button"
              variant="outline"
              disabled={allEmpty}
              onClick={() => openDelete({ kind: 'all' })}
            >
              <Trash2Icon aria-hidden="true" />
              Usuń wszystkie plany
            </Button>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {scenarios.data.map((scenario) => (
              <li key={scenario.key}>
                <PlanCard
                  scenario={scenario}
                  onDelete={(key) => openDelete({ kind: 'one', key })}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {target && dialogScenarios && dialogScenarios.length > 0 && (
        <DeletePlanDialog
          scenarios={target.kind === 'one' ? dialogScenarios.slice(0, 1) : dialogScenarios}
          pending={pending}
          error={dialogError}
          onConfirm={() => void (target.kind === 'one' ? confirmSingle(target.key) : confirmAll())}
          onClose={closeDelete}
        />
      )}
    </section>
  )
}
