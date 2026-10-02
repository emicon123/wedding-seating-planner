import { BabyIcon, PlusIcon } from 'lucide-react'
import { useId, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '@/api/errorMessage'
import { useCreateGuest } from '@/api/guests'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { parseGuestName } from '@/domain/guestName'
import { cn } from '@/lib/utils'

type Added = { name: string; count: number; child: boolean }

/**
 * The main way to enter guests (003-frontend-design §5): "Imię Nazwisko" + Enter creates the
 * guest, the input is cleared and keeps focus, so a whole list can be typed without the mouse.
 * The "Dziecko" checkbox stays on until it is unticked, so a run of children is just names and
 * Enter; while it is on the whole bar says so. A rejected name (duplicate) keeps the text so it
 * can be fixed.
 */
export function QuickAddBar() {
  const create = useCreateGuest()
  const inputId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const sending = useRef(false)
  // Mouse and touch toggles give focus back to the text field; a keyboard toggle must not move it.
  const pointerToggle = useRef(false)
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
      setError(null)
      setAdded((previous) => ({
        name: guest.displayName,
        count: (previous?.count ?? 0) + 1,
        child: guest.isChild,
      }))
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      sending.current = false
      inputRef.current?.focus()
    }
  }

  function changeChild(checked: boolean) {
    setIsChild(checked)
    if (pointerToggle.current) inputRef.current?.focus()
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className={cn(
        'rounded-xl border bg-card p-3 shadow-xs transition-colors sm:p-4',
        isChild ? 'border-brass bg-brass/15' : 'border-ink/25',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-semibold">
          Dodaj gościa
        </label>
        {isChild && (
          <p className="inline-flex items-center gap-1.5 rounded-full border border-brass bg-brass/25 px-3 py-0.5 text-sm font-semibold text-brass-ink">
            <BabyIcon aria-hidden="true" className="size-4" />
            Dodajesz dzieci
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={inputId}
          ref={inputRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setError(null)
          }}
          placeholder={
            isChild ? 'Imię dziecka, np. Zosia Nowak' : 'Imię Nazwisko, np. Karolina Nowak'
          }
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className="h-12 min-w-56 flex-1 text-lg md:text-lg"
        />
        <label
          onPointerDown={() => {
            pointerToggle.current = true
          }}
          onKeyDown={() => {
            pointerToggle.current = false
          }}
          className={cn(
            'flex h-12 cursor-pointer items-center gap-2.5 rounded-md border px-3.5 text-base font-medium select-none has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
            isChild ? 'border-brass bg-brass/25 text-brass-ink' : 'border-input bg-background',
          )}
        >
          <Checkbox
            checked={isChild}
            onCheckedChange={(checked) => changeChild(checked === true)}
            aria-label="Dziecko"
            className="size-6"
          />
          <BabyIcon aria-hidden="true" className="size-4" />
          Dziecko
        </label>
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
            ? `${added.child ? 'Dodano dziecko' : 'Dodano'}: ${added.name}. W tej sesji dodanych: ${added.count}.`
            : 'Enter dodaje gościa, nazwisko jest opcjonalne.'}
        </p>
      )}
    </form>
  )
}
