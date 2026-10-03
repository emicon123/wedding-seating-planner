import { Undo2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/errorMessage'
import { ApiError } from '@/api/errors'
import {
  useDismissGenerateUndo,
  useGenerateUndo,
  useScenarios,
  useUndoGenerate,
} from '@/api/scenarios'
import { Button } from '@/components/ui/button'
import { UNDO_DONE_MESSAGE, UNDO_REFUSED_MESSAGE } from '@/domain/labels'
import { canUndoGenerate } from '@/domain/planView'

/**
 * The offer to take back the last Generate (state machine §2 "Undoable"). It shows only while every
 * plan still has the version that Generate produced, so it vanishes by itself after any edit: the
 * visibility is derived from the cache, nothing has to clear it.
 */
export function UndoGenerateBar() {
  const undo = useGenerateUndo().data
  const scenarios = useScenarios().data
  const { mutateAsync, isPending } = useUndoGenerate()
  const dismiss = useDismissGenerateUndo()

  if (!undo || !canUndoGenerate(undo, scenarios)) return null

  async function restore(snapshot: NonNullable<typeof undo>) {
    try {
      await mutateAsync(snapshot)
      toast.success(UNDO_DONE_MESSAGE)
    } catch (error) {
      const refused = error instanceof ApiError && (error.status === 409 || error.status === 422)
      toast.error(refused ? UNDO_REFUSED_MESSAGE : errorMessage(error))
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brass bg-brass/10 px-4 py-3"
    >
      <p className="text-sm font-medium">Wygenerowano nowe plany. Poprzednie można przywrócić.</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => void restore(undo)}
        >
          <Undo2Icon aria-hidden="true" />
          {isPending ? 'Przywracam…' : 'Cofnij'}
        </Button>
        <Button type="button" variant="ghost" size="icon" disabled={isPending} onClick={dismiss}>
          <XIcon aria-hidden="true" />
          <span className="sr-only">Zamknij</span>
        </Button>
      </div>
    </div>
  )
}
