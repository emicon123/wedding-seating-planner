import { useIsMutating } from '@tanstack/react-query'
import { Loader2Icon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/errorMessage'
import { ApiError } from '@/api/errors'
import { GENERATE_MUTATION_KEY, useGeneratePlans } from '@/api/scenarios'
import { Button } from '@/components/ui/button'
import { GENERATE_CONFLICT_MESSAGE, GENERATE_SAVED_MESSAGE } from '@/domain/labels'

type GenerateButtonProps = {
  label?: string
  variant?: 'default' | 'outline'
  size?: 'default' | 'lg'
}

/**
 * Generate always means all five plans (user requirement) and they are stored at once: the page
 * you are on re-renders from the updated cache, nothing to accept, no navigation. "Cofnij" lives in
 * `UndoGenerateBar`. Any "Generuj" button on the screen disables while one is running.
 */
export function GenerateButton({
  label = 'Generuj plany',
  variant = 'default',
  size = 'default',
}: GenerateButtonProps) {
  const { mutateAsync } = useGeneratePlans()
  const running = useIsMutating({ mutationKey: GENERATE_MUTATION_KEY }) > 0

  // mutateAsync, not mutate-level callbacks: those are dropped when the button unmounts mid-run
  async function generate() {
    try {
      const { stored } = await mutateAsync()
      toast.success(GENERATE_SAVED_MESSAGE(stored.map((scenario) => scenario.key)))
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409
      toast.error(conflict ? GENERATE_CONFLICT_MESSAGE : errorMessage(error))
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={running}
      onClick={() => void generate()}
    >
      {running ? (
        <Loader2Icon aria-hidden="true" className="animate-spin" />
      ) : (
        <SparklesIcon aria-hidden="true" />
      )}
      {running ? 'Liczę i zapisuję plany…' : label}
    </Button>
  )
}
