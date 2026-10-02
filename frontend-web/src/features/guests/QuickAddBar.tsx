import { BabyIcon, PlusIcon } from 'lucide-react'
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { errorMessage } from '@/api/errorMessage'
import { useCreateGuest } from '@/api/guests'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseGuestName } from '@/domain/guestName'
import { cn } from '@/lib/utils'

type Added = { name: string; count: number }

/**
 * The main way to enter guests (003-frontend-design §5): "Imię Nazwisko" + Enter creates the
 * guest, the input is cleared and keeps focus, so a whole list can be typed without the mouse.
 * Ctrl+D marks the NEXT guest as a child (the mark resets after each add, so it cannot stick by
 * accident). A rejected name (duplicate) keeps the text so it can be fixed.
 */
export function QuickAddBar() {
  const create = useCreateGuest()
  const inputId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const sending = useRef(false)
  const [text, setText] = useState('')
  const [isChild, setIsChild] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<Added | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const name = parseGuestName(text)
    if (!name || sending.current) return
    sending.current = true
    try {
      const guest = await create.mutateAsync({ ...name, isChild })
      setText('')
      setIsChild(false)
      setError(null)
      setAdded((previous) => ({ name: guest.displayName, count: (previous?.count ?? 0) + 1 }))
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      sending.current = false
      inputRef.current?.focus()
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.ctrlKey && event.key.toLowerCase() === 'd') {
      event.preventDefault() // the browser would bookmark the page
      setIsChild((current) => !current)
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="rounded-xl border border-ink/25 bg-card p-3 shadow-xs sm:p-4"
    >
      <label htmlFor={inputId} className="mb-2 block text-sm font-semibold">
        Dodaj gościa
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={inputId}
          ref={inputRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          placeholder="Imię Nazwisko, np. Karolina Nowak"
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className="h-12 min-w-56 flex-1 text-lg md:text-lg"
        />
        <Button
          type="button"
          variant="outline"
          aria-pressed={isChild}
          onClick={() => {
            setIsChild((current) => !current)
            inputRef.current?.focus()
          }}
          className={cn('h-12 px-4', isChild && 'border-brass bg-brass/20 text-ink')}
        >
          <BabyIcon aria-hidden="true" />
          Dziecko
          <kbd className="bg-paper ml-1 hidden rounded border border-input px-1.5 py-0.5 font-sans text-xs text-muted-foreground sm:inline">
            Ctrl+D
          </kbd>
        </Button>
        <Button type="submit" className="h-12 px-5">
          <PlusIcon aria-hidden="true" />
          Dodaj
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-sm font-medium text-brick">
          {error}
        </p>
      ) : (
        <p role="status" className="mt-2 min-h-5 text-sm text-muted-foreground">
          {added
            ? `Dodano: ${added.name}. W tej sesji dodanych: ${added.count}.`
            : 'Enter dodaje gościa, nazwisko jest opcjonalne.'}
        </p>
      )}
    </form>
  )
}
