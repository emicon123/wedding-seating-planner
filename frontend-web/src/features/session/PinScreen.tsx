import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { ApiError } from '@/api/errors'
import { errorMessage } from '@/api/errorMessage'
import { useLogin } from '@/api/session'
import { TableGlyph } from '@/components/TableGlyph'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { waitLabel } from '@/domain/labels'
import { useCountdown } from '@/features/session/useCountdown'

// A throttled answer without a usable Retry-After still disables the button for a moment.
const DEFAULT_WAIT_SECONDS = 30

/** The message under the field, or null when there is nothing to say (idle, or the lock ran out). */
function problemText(error: unknown, waiting: boolean): string | null {
  if (error === null) return null
  if (error instanceof ApiError && error.status === 429 && !waiting) return null
  return errorMessage(error)
}

/** Full-screen PIN prompt. The PIN lives only in this component's state and is cleared on submit. */
export function PinScreen() {
  const login = useLogin()
  const countdown = useCountdown()
  const [pin, setPin] = useState('')
  const [visible, setVisible] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const waiting = countdown.remaining > 0
  const problem = problemText(login.error, waiting)
  const canSubmit = pin !== '' && !login.isPending && !waiting

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    login.mutate(pin, {
      onError: (error) => {
        if (error instanceof ApiError && error.status === 429) {
          countdown.start(error.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS)
        }
        inputRef.current?.focus()
      },
    })
    setPin('')
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-6 rounded-xl border border-ink/10 bg-card p-6 shadow-sm sm:p-8"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <TableGlyph seats={10} className="size-20 text-ink" />
          <h1 className="font-display text-3xl font-semibold tracking-tight">Podaj PIN</h1>
          <p className="text-muted-foreground">Stoliki — plan stołów weselnych</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pin" className="text-base">
            PIN
          </Label>
          <div className="relative">
            <Input
              id="pin"
              ref={inputRef}
              type={visible ? 'text' : 'password'}
              inputMode="numeric"
              autoComplete="current-password"
              autoFocus
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              aria-invalid={problem !== null}
              aria-describedby="pin-problem"
              className="h-14 pr-14 text-center text-3xl tracking-[0.3em] md:text-3xl"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="absolute inset-y-0.5 right-0.5 h-auto"
              aria-label={visible ? 'Ukryj PIN' : 'Pokaż PIN'}
              aria-pressed={visible}
              onClick={() => setVisible((shown) => !shown)}
            >
              {visible ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </div>
          <div id="pin-problem" role="alert" className="min-h-6 text-base font-medium text-brick">
            {problem}
          </div>
          {waiting && (
            <p className="text-sm text-muted-foreground">
              Spróbuj ponownie za {waitLabel(countdown.remaining)}
            </p>
          )}
        </div>

        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={!canSubmit}>
          {login.isPending ? 'Sprawdzam…' : 'Wejdź'}
        </Button>
      </form>
    </main>
  )
}
