import { ChevronLeftIcon, PrinterIcon, TriangleAlertIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { errorMessage } from '@/api/errorMessage'
import { useGuests } from '@/api/guests'
import { useScenarios } from '@/api/scenarios'
import { Button, buttonVariants } from '@/components/ui/button'
import { buildGuestIndex } from '@/domain/guestIndex'
import { peopleLabel, tableCountLabel, tablesNeededSummary, violationLabel } from '@/domain/labels'
import { isMixed } from '@/domain/plans'
import { buildNameIndex, buildPrintTables } from '@/domain/printPlan'
import { tablesNeeded } from '@/domain/tableSizes'
import type { Guest, PlanKey, Scenario } from '@/domain/types'
import { PrintCluster, PrintTableCard } from '@/features/plans/PrintTableCard'
import { PrintNameIndex } from '@/features/plans/PrintNameIndex'
import { cn } from '@/lib/utils'

const NO_GUESTS: Guest[] = []
const SHOWN_PROBLEMS = 3

/** The paper: a white sheet on screen, the bare page in print (margins come from @page). */
const SHEET =
  'bg-white p-6 shadow-sm ring-1 ring-ink/10 sm:p-10 print:rounded-none print:p-0 print:shadow-none print:ring-0'

/** Nothing accepted yet: no table and nobody seated. */
function isEmptyPlan({ plan }: Scenario): boolean {
  return plan.tables.length === 0 && plan.summary.seatedCount === 0
}

function Toolbar({ planKey }: { planKey: PlanKey }) {
  return (
    <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
      <Link
        to={`/plany/${planKey}`}
        className="inline-flex items-center gap-1 rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
        Wróć do planu
      </Link>
      <Button type="button" size="lg" onClick={() => window.print()}>
        <PrinterIcon aria-hidden="true" />
        Drukuj
      </Button>
    </div>
  )
}

function ProblemsNotice({ scenario }: { scenario: Scenario }) {
  const { plan } = scenario
  if (!plan.summary.needsRecalculation && plan.summary.violationCount === 0) return null
  const shown = plan.violations.slice(0, SHOWN_PROBLEMS)
  const more = plan.violations.length - shown.length
  return (
    <div
      role="status"
      className="mx-auto max-w-[210mm] space-y-2 rounded-lg border border-brick/50 bg-brick/8 p-3 text-sm print:hidden"
    >
      <p className="flex items-center gap-2 font-semibold text-brick">
        <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
        Ten plan ma problemy i wymaga przeliczenia
      </p>
      <p>Możesz go wydrukować, ale wydruk będzie zawierał te same braki:</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {shown.map((violation, index) => (
          <li key={index}>{violationLabel(violation)}</li>
        ))}
        {more > 0 && <li>i jeszcze {more}</li>}
      </ul>
      <Link
        to={`/plany/${scenario.key}`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
      >
        Popraw plan
      </Link>
    </div>
  )
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[210mm] space-y-3 p-6">{children}</div>
}

/**
 * The printout of one plan (route /druk/:planKey, outside the app shell): tables with their
 * guests, then "kto przy którym stole" on a page of its own. The sheet is also the on-screen
 * preview; the toolbar and the problems notice are screen only. Reads the same cache as the
 * hall, so it never shows anything the hall does not.
 */
export function PrintView({ planKey }: { planKey: PlanKey }) {
  const scenarios = useScenarios()
  const guestsQuery = useGuests()
  const guests = guestsQuery.data ?? NO_GUESTS
  const scenario = scenarios.data?.find((candidate) => candidate.key === planKey)
  const index = useMemo(() => buildGuestIndex(guests), [guests])
  const printed = useMemo(
    () => (scenario ? buildPrintTables(scenario.plan, scenario, index) : null),
    [scenario, index],
  )
  const nameIndex = useMemo(
    () => (scenario ? buildNameIndex(scenario.plan, index) : []),
    [scenario, index],
  )

  const failed = scenarios.error ?? guestsQuery.error
  if (failed) {
    return (
      <Message>
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
      </Message>
    )
  }
  if (!scenario || !printed) return <Message>Wczytuję plan do druku…</Message>

  if (isEmptyPlan(scenario)) {
    return (
      <Message>
        <Toolbar planKey={planKey} />
        <section className="space-y-2 rounded-xl border bg-card p-6">
          <h1 className="text-2xl font-semibold">
            Nie ma jeszcze {planKey === 'mixed' ? 'planu mieszanego' : `planu na ${planKey} miejsc`}
          </h1>
          <p className="text-muted-foreground">
            Wygeneruj plany, a potem wydrukuj ten, który wybierzesz.
          </p>
          <Link to="/" className={buttonVariants()}>
            Przejdź do planów
          </Link>
        </section>
      </Message>
    )
  }

  const { plan } = scenario
  const needed = tablesNeeded(scenario)
  const today = new Date().toLocaleDateString('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="min-h-dvh space-y-4 px-3 py-4 [print-color-adjust:exact] sm:px-4 print:min-h-0 print:space-y-0 print:p-0">
      <Toolbar planKey={planKey} />
      <ProblemsNotice scenario={scenario} />

      <main className="mx-auto max-w-[210mm] space-y-6 print:max-w-none print:space-y-0">
        <article className={SHEET} aria-labelledby="druk-tytul">
          <header className="mb-5 space-y-1 border-b-2 border-ink pb-3">
            <h1 id="druk-tytul" className="text-3xl font-semibold">
              {isMixed(scenario)
                ? 'Plan stołów — mieszany (stoły 9–12-osobowe)'
                : `Plan stołów, ${scenario.capacity} miejsc przy stole`}
            </h1>
            <p className="text-sm text-ink-soft print:text-black">
              {tableCountLabel(plan.tables.length)}, {peopleLabel(plan.summary.seatedCount)}{' '}
              posadzonych, stan na {today}
            </p>
            {needed.length > 0 && (
              <p className="text-sm font-medium">{tablesNeededSummary(needed)}</p>
            )}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs">
              <span>Ramka z napisem „Grupa 0”: te osoby siedzą razem.</span>
              <span>Dziecko ma ikonę i napis „dziecko”.</span>
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            {printed.tables.map((table) => (
              <PrintTableCard key={table.number} table={table} kind={scenario} />
            ))}
          </div>

          {printed.unseated.length > 0 && (
            <section
              aria-label="Bez stołu"
              className="mt-4 break-inside-avoid space-y-2 rounded-xl border-2 border-dashed border-ink p-3"
            >
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
                <TriangleAlertIcon aria-hidden="true" className="size-4" />
                Bez stołu
              </h2>
              <ul className="columns-2 gap-4 space-y-1.5">
                {printed.unseated.map((cluster) => (
                  <li key={cluster.key} className="break-inside-avoid">
                    <PrintCluster cluster={cluster} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>

        <article className={cn(SHEET, 'print:break-before-page')} aria-labelledby="druk-indeks">
          <header className="mb-4 border-b-2 border-ink pb-3">
            <h2 id="druk-indeks" className="text-3xl font-semibold">
              Kto przy którym stole
            </h2>
            <p className="text-sm text-ink-soft print:text-black">
              Goście po nazwisku, od A do Z. Numer w ramce to numer stołu.
            </p>
          </header>
          <PrintNameIndex sections={nameIndex} />
        </article>
      </main>
    </div>
  )
}
