import { Loader2Icon } from 'lucide-react'
import { useId, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { planContentsLabel } from '@/domain/labels'
import type { Scenario } from '@/domain/types'

type DeletePlanDialogProps = {
  /** One scenario = one plan; several = "all plans". */
  scenarios: Scenario[]
  pending: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}

const DESTRUCTIVE =
  'bg-destructive text-white hover:bg-destructive/90 aria-disabled:cursor-wait aria-disabled:opacity-60'

function Progress() {
  return <Loader2Icon aria-hidden="true" className="animate-spin" />
}

function contentsLine(scenario: Scenario): string {
  const { capacity, plan } = scenario
  const contents = plan.summary.tableCount === 0 ? 'bez stołów' : planContentsLabel(plan.summary)
  return `Plan ${capacity}-osobowy: ${contents}`
}

/**
 * Confirmation for "Usuń plan" / "Usuń wszystkie plany": the plan becomes empty (no tables,
 * everyone unseated, pins gone) and it cannot be undone. Like DeleteTableDialog, but the
 * destructive button never closes the dialog by itself — the owner closes it after the
 * server answers. "Anuluj" has the initial focus.
 */
export function DeletePlanDialog({
  scenarios,
  pending,
  error,
  onConfirm,
  onClose,
}: DeletePlanDialogProps) {
  const [acked, setAcked] = useState(false)
  const ackId = useId()
  const close = () => {
    if (!pending) onClose()
  }

  if (scenarios.length > 1) {
    return (
      <AlertDialog open onOpenChange={(open) => !open && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć wszystkie trzy plany?</AlertDialogTitle>
            <AlertDialogDescription>
              {scenarios.map((scenario) => (
                <span key={scenario.capacity} className="block">
                  {contentsLine(scenario)}
                </span>
              ))}
              <span className="block">
                Stoły znikną, wszyscy trafią do pola „Bez stołu”. Pinezki znikną. Tego nie da się
                cofnąć.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2">
            <Checkbox
              id={ackId}
              checked={acked}
              onCheckedChange={(checked) => setAcked(checked === true)}
            />
            <label htmlFor={ackId} className="text-sm leading-snug">
              Rozumiem, że tego nie da się cofnąć
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-brick">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              disabled={!acked}
              aria-disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                if (!pending && acked) onConfirm()
              }}
              className={DESTRUCTIVE}
            >
              {pending && <Progress />}
              {pending ? 'Usuwam…' : 'Usuń wszystkie plany'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  const [scenario] = scenarios
  if (!scenario) return null
  const { capacity, plan } = scenario
  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunąć plan na {capacity} miejsc?</AlertDialogTitle>
          <AlertDialogDescription>
            Plan ma {planContentsLabel(plan.summary)}. Stoły znikną, wszyscy trafią do pola „Bez
            stołu”. Pinezki znikną. Tego nie da się cofnąć.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm font-medium text-brick">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Anuluj</AlertDialogCancel>
          <AlertDialogAction
            aria-disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              if (!pending) onConfirm()
            }}
            className={DESTRUCTIVE}
          >
            {pending && <Progress />}
            {pending ? 'Usuwam…' : `Usuń plan ${capacity}-osobowy`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
