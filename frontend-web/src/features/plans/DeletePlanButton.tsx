import { Trash2Icon } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const EMPTY_REASON = 'Ten plan nie ma stołów, nie ma co usuwać.'

type DeletePlanButtonProps = {
  /** True when the plan has no tables: there is nothing to clear, so the button is off. */
  empty: boolean
  onClick: () => void
  className?: string
}

/**
 * "Usuń plan" with its reason when it is off. A disabled button gets no hover or focus, so the
 * explanation lives on the wrapper (tooltip for the mouse) and in an accessible description
 * (screen readers); on a phone the plan's own "Brak stołów w tym planie." says the same.
 */
export function DeletePlanButton({ empty, onClick, className }: DeletePlanButtonProps) {
  const reasonId = useId()
  return (
    <span title={empty ? EMPTY_REASON : undefined} className="inline-flex">
      <Button
        type="button"
        variant="outline"
        disabled={empty}
        aria-describedby={empty ? reasonId : undefined}
        onClick={onClick}
        className={cn('text-destructive hover:text-destructive', className)}
      >
        <Trash2Icon aria-hidden="true" />
        Usuń plan
      </Button>
      {empty && (
        <span id={reasonId} className="sr-only">
          {EMPTY_REASON}
        </span>
      )}
    </span>
  )
}
