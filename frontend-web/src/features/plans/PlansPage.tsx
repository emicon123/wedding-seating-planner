import { useScenarios, useProposals } from '@/api/scenarios'
import { errorMessage } from '@/api/errorMessage'
import { Button } from '@/components/ui/button'
import { GenerateButton } from '@/features/plans/GenerateButton'
import { PlanCard } from '@/features/plans/PlanCard'
import { ProposalPreview } from '@/features/plans/ProposalPreview'

/**
 * The three plans (8, 10, 12 seats) side by side: the answer to "how many tables, how happy, what
 * is wrong". Generate always computes all three; its result is a preview until accepted.
 */
export function PlansPage() {
  const scenarios = useScenarios()
  const proposals = useProposals().data

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-prose space-y-2">
          <h1 className="text-4xl font-semibold">Plany</h1>
          <p className="text-muted-foreground">
            Trzy plany naraz: stoły 8-, 10- i 12-osobowe. Porównaj liczbę stołów, zadowolenie gości
            i naruszenia, a potem otwórz plan, żeby zobaczyć salę.
          </p>
        </div>
        <GenerateButton size="lg" />
      </header>

      {scenarios.isSuccess && proposals && proposals.length > 0 && (
        <ProposalPreview proposals={proposals} scenarios={scenarios.data} />
      )}

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
          <h2 id="aktualne" className="text-2xl font-semibold">
            Plany teraz
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {scenarios.data.map((scenario) => (
              <li key={scenario.capacity}>
                <PlanCard scenario={scenario} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
