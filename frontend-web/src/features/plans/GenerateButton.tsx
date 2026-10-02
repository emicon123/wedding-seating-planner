import { useIsMutating } from '@tanstack/react-query'
import { Loader2Icon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/errorMessage'
import { CALCULATE_MUTATION_KEY, useCalculateProposals } from '@/api/scenarios'
import { Button } from '@/components/ui/button'

type GenerateButtonProps = {
  label?: string
  variant?: 'default' | 'outline'
  size?: 'default' | 'lg'
  /** Called once the three proposals are in the preview (the detail page uses it to go there). */
  onGenerated?: () => void
}

/**
 * Generate always means all three plans (user requirement). The result is a preview that is
 * only stored when accepted. Any "Generuj" button on the screen disables while one is running.
 */
export function GenerateButton({
  label = 'Generuj plany',
  variant = 'default',
  size = 'default',
  onGenerated,
}: GenerateButtonProps) {
  const { mutateAsync } = useCalculateProposals()
  const running = useIsMutating({ mutationKey: CALCULATE_MUTATION_KEY }) > 0

  // mutateAsync, not mutate-level callbacks: those are dropped when the button unmounts mid-run
  async function generate() {
    try {
      await mutateAsync()
    } catch (error) {
      toast.error(errorMessage(error))
      return
    }
    onGenerated?.()
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
      {running ? 'Liczę plany…' : label}
    </Button>
  )
}
