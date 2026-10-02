import { EyeIcon, EyeOffIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pluralPl } from '@/domain/labels'

type BulkToggleBarProps = {
  /** Selected guests that are currently visible: exactly the ones a click will change. */
  count: number
  onApply: (enabled: boolean) => void
  onClear: () => void
}

/** Floats at the bottom while a selection exists, so the count is in view before anything is applied. */
export function BulkToggleBar({ count, onApply, onClear }: BulkToggleBarProps) {
  if (count === 0) return null
  return (
    <div
      role="region"
      aria-label="Zaznaczeni goście"
      className="fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-ink p-3 text-primary-foreground shadow-lg"
    >
      <p className="mr-auto text-sm font-medium" aria-live="polite">
        Zaznaczono: {pluralPl(count, 'gość', 'gości', 'gości')}
      </p>
      <Button type="button" variant="secondary" onClick={() => onApply(true)}>
        <EyeIcon aria-hidden="true" />
        Włącz ({count})
      </Button>
      <Button type="button" variant="secondary" onClick={() => onApply(false)}>
        <EyeOffIcon aria-hidden="true" />
        Wyłącz ({count})
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClear}
        className="text-primary-foreground hover:bg-white/10 hover:text-white"
      >
        <XIcon aria-hidden="true" />
        <span className="sr-only">Wyczyść zaznaczenie</span>
      </Button>
    </div>
  )
}
