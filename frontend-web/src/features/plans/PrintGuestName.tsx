import { BabyIcon } from 'lucide-react'
import type { PrintGuest } from '@/domain/printPlan'

/** A guest's full name; a child carries an icon AND the word, so it survives a black-and-white copy. */
export function PrintGuestName({ guest }: { guest: PrintGuest }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span>{guest.name}</span>
      {guest.isChild && (
        <span className="inline-flex items-center gap-0.5 text-[0.8em] text-ink-soft italic print:text-black">
          <BabyIcon aria-hidden="true" className="size-3.5 self-center" />
          dziecko
        </span>
      )}
    </span>
  )
}
